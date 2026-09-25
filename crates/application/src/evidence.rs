//! Pure evidence, acceptance, and closeout contracts.
//!
//! This module deliberately contains no persistence or process execution. It
//! validates facts supplied by a coordinator and returns deterministic gate
//! diagnostics that an adapter can persist or expose through a protocol.

use boreal_domain::{
    ActorId, ActorRole, AttemptId, AttemptPhase, ConfigIdentity, Fence, GateId, GateKind,
    GateState, OperationId, ProfileId, ReceiptId, ReceiptResult, SourceVersionId, TimestampMs,
    WorkId,
};
use boreal_store::{
    identity::IdentityContext,
    jobs::{ExternalJobInput, ExternalJobRecord, ExternalJobTransitionInput},
    SqliteStore, StoreError,
};

use crate::{ApplicationError, AttemptSnapshot};

pub const RECEIPT_SCHEMA_VERSION: &str = "boreal.receipt.v1";
pub const MAX_COMMAND_PARTS: usize = 128;
pub const MAX_COMMAND_BYTES: usize = 16 * 1024;
pub const MAX_OUTPUT_BYTES: u64 = 64 * 1024;
pub const MAX_TEXT_LENGTH: usize = 4_096;
pub const MAX_OBSERVABLES: usize = 32;
pub const MAX_EXTERNAL_IDENTITY_BYTES: usize = 4_096;

/// The supported external-job categories share one durable identity and
/// readback protocol. The adapter remains agnostic about how a verifier,
/// backup, publication, or update performs its side effect.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExternalJobKind {
    Verifier,
    Evidence,
    Backup,
    MemoryPublication,
    Update,
}

impl ExternalJobKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Verifier => "verifier",
            Self::Evidence => "evidence",
            Self::Backup => "backup",
            Self::MemoryPublication => "memory_publication",
            Self::Update => "update",
        }
    }
}

/// The durable identity used when an application adapter invokes an external
/// verifier or other side-effecting worker.  The store job is registered
/// before the external effect starts; an uncertain effect therefore remains
/// visible to readback instead of being converted into a successful receipt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalEffectRequest {
    pub job_id: String,
    pub operation_id: String,
    pub project_id: String,
    pub subject_type: String,
    pub subject_id: String,
    pub kind: String,
    pub request_digest: String,
    pub source_identity: Option<String>,
    pub config_identity: Option<String>,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub deadline: Option<String>,
    pub created_at: String,
}

impl ExternalEffectRequest {
    fn validate(&self) -> Result<(), StoreError> {
        for (value, label) in [
            (&self.job_id, "external job id"),
            (&self.operation_id, "external operation id"),
            (&self.project_id, "external project id"),
            (&self.subject_type, "external subject type"),
            (&self.subject_id, "external subject id"),
            (&self.kind, "external job kind"),
            (&self.request_digest, "external request digest"),
            (&self.actor_id, "external actor id"),
            (&self.created_at, "external creation timestamp"),
        ] {
            if value.trim().is_empty() {
                return Err(StoreError::Invalid(format!("{label} must not be empty")));
            }
            if value.len() > MAX_EXTERNAL_IDENTITY_BYTES {
                return Err(StoreError::Invalid(format!(
                    "{label} exceeds the external identity limit"
                )));
            }
        }
        Ok(())
    }

    fn as_store_input(&self) -> ExternalJobInput {
        ExternalJobInput {
            job_id: self.job_id.clone(),
            operation_id: self.operation_id.clone(),
            project_id: self.project_id.clone(),
            subject_type: self.subject_type.clone(),
            subject_id: self.subject_id.clone(),
            kind: self.kind.clone(),
            request_digest: self.request_digest.clone(),
            source_identity: self.source_identity.clone(),
            config_identity: self.config_identity.clone(),
            actor_id: self.actor_id.clone(),
            session_id: self.session_id.clone(),
            deadline: self.deadline.clone(),
            created_at: self.created_at.clone(),
        }
    }
}

/// The only input accepted for resolving a side effect after the external
/// process has run. Every field is read back or supplied by the attributable
/// adapter result; a bare result digest is not enough to authorize
/// reconciliation.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExternalEffectReadback {
    pub project_id: String,
    pub job_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub side_effect_ref: String,
    pub result_digest: String,
    pub observed_at: String,
}

/// A readback result is deliberately not a boolean.  Only `Reconciled` or
/// `Committed` represents a resolved external effect; pending and
/// readback-required stages cannot authorize a passing evidence receipt.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExternalEffectResolution {
    Pending(ExternalJobRecord),
    ReadbackRequired(ExternalJobRecord),
    Reconciled(ExternalJobRecord),
    Committed(ExternalJobRecord),
    Rejected(ExternalJobRecord),
    Failed(ExternalJobRecord),
}

impl ExternalEffectResolution {
    pub fn is_resolved(&self) -> bool {
        matches!(self, Self::Reconciled(_) | Self::Committed(_))
    }

    pub fn record(&self) -> &ExternalJobRecord {
        match self {
            Self::Pending(record)
            | Self::ReadbackRequired(record)
            | Self::Reconciled(record)
            | Self::Committed(record)
            | Self::Rejected(record)
            | Self::Failed(record) => record,
        }
    }

    pub fn is_pending(&self) -> bool {
        matches!(self, Self::Pending(_))
    }

    pub fn is_readback_required(&self) -> bool {
        matches!(self, Self::ReadbackRequired(_))
    }

    pub fn is_rejected(&self) -> bool {
        matches!(self, Self::Rejected(_))
    }
}

/// Result of trying to acquire the one callback permission for an admitted
/// external job.  The winning transition is distinct from merely observing
/// a job that another caller already started.  This distinction is the
/// at-most-once boundary for verifiers, installers, backups, and publication
/// adapters.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExternalEffectAcquisition {
    /// This caller atomically changed `admitted` to `running` and may invoke
    /// the external callback exactly once.
    Won(ExternalJobRecord),
    /// Another caller owns the running boundary.  The observer must not
    /// invoke the callback and should use readback for any later result.
    AlreadyRunning(ExternalJobRecord),
    /// The job has not crossed the running boundary, or is otherwise still
    /// pending without granting this caller callback authority.
    Pending(ExternalJobRecord),
    /// The job has a terminal/readback state that must be returned to the
    /// caller rather than retried as a new external effect.
    Terminal(ExternalEffectResolution),
    /// The compare-and-transition lost a race or could not establish a safe
    /// current classification.  No callback authority is granted.
    Conflict {
        current: Option<ExternalJobRecord>,
        reason: String,
    },
}

/// Observation returned by the adapter that actually performs an external
/// effect. `Pending` intentionally carries no invented side-effect identity;
/// the durable job remains readable by operation ID after a restart.
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ExternalEffectObservation {
    Reconciled {
        side_effect_ref: String,
        result_digest: String,
        observed_at: String,
    },
    ReadbackRequired {
        side_effect_ref: String,
        observed_at: String,
    },
    Pending,
    Failed {
        side_effect_ref: Option<String>,
        reason: String,
        observed_at: String,
    },
}

/// Application-owned adapter for the durable external-job/readback seam.
///
/// This is intentionally narrower than a process runner: it records the
/// identity and lifecycle of an effect, while the caller remains responsible
/// for invoking the verifier and supplying an attributable side-effect or
/// result identity.  It never manufactures a receipt or treats a timeout as
/// success.
pub struct ExternalEffectAdapter<'a> {
    store: &'a SqliteStore,
    identity: Option<&'a IdentityContext>,
}

impl<'a> ExternalEffectAdapter<'a> {
    pub fn new(store: &'a SqliteStore) -> Self {
        Self {
            store,
            identity: None,
        }
    }

    /// Constructs the production adapter. The context is captured so every
    /// job read and mutation uses the identity-bound store seam; callers must
    /// not downgrade a canonical project to the legacy fixture path.
    pub fn new_with_identity(store: &'a SqliteStore, identity: &'a IdentityContext) -> Self {
        Self {
            store,
            identity: Some(identity),
        }
    }

    pub fn admit(
        &self,
        request: &ExternalEffectRequest,
    ) -> Result<ExternalEffectResolution, StoreError> {
        self.admit_with_replay(request)
    }

    fn admit_with_replay(
        &self,
        request: &ExternalEffectRequest,
    ) -> Result<ExternalEffectResolution, StoreError> {
        request.validate()?;
        let registration = if let Some(identity) = self.identity {
            self.store
                .register_external_job_with_identity(identity, &request.as_store_input())?
        } else {
            self.store
                .register_external_job(&request.as_store_input())?
        };
        if registration.job.stage == "registered" {
            let job = self.transition(&registration.job, "admitted", None, None, None, None)?;
            Ok(ExternalEffectResolution::Pending(job))
        } else {
            Ok(resolve_stage(registration.job))
        }
    }

    /// Admit and run one external effect. The callback is invoked only after
    /// the durable job has reached `running`. A callback that cannot provide
    /// attributable readback leaves the job pending; it cannot manufacture a
    /// successful receipt or a committed outcome.
    pub fn execute<F>(
        &self,
        request: &ExternalEffectRequest,
        started_at: &str,
        execute: F,
    ) -> Result<ExternalEffectResolution, StoreError>
    where
        F: FnOnce(&ExternalJobRecord) -> Result<ExternalEffectObservation, StoreError>,
    {
        let admitted = self.admit(request)?;
        let job = match admitted {
            ExternalEffectResolution::Pending(job) if job.stage == "admitted" => {
                match self.start_acquisition(&request.project_id, &request.job_id, started_at)? {
                    ExternalEffectAcquisition::Won(job) => job,
                    ExternalEffectAcquisition::AlreadyRunning(job)
                    | ExternalEffectAcquisition::Pending(job) => {
                        return Ok(ExternalEffectResolution::Pending(job));
                    }
                    ExternalEffectAcquisition::Terminal(resolution) => return Ok(resolution),
                    ExternalEffectAcquisition::Conflict { reason, .. } => {
                        return Err(StoreError::Conflict(reason));
                    }
                }
            }
            other => return Ok(other),
        };

        match execute(&job)? {
            ExternalEffectObservation::Pending => Ok(ExternalEffectResolution::Pending(job)),
            ExternalEffectObservation::ReadbackRequired {
                side_effect_ref,
                observed_at,
            } => {
                self.mark_side_effect_started(
                    &request.project_id,
                    &request.job_id,
                    &side_effect_ref,
                    &observed_at,
                )?;
                self.mark_readback_required(
                    &request.project_id,
                    &request.job_id,
                    &side_effect_ref,
                    &observed_at,
                )
            }
            ExternalEffectObservation::Reconciled {
                side_effect_ref,
                result_digest,
                observed_at,
            } => {
                self.mark_side_effect_started(
                    &request.project_id,
                    &request.job_id,
                    &side_effect_ref,
                    &observed_at,
                )?;
                self.mark_readback_required(
                    &request.project_id,
                    &request.job_id,
                    &side_effect_ref,
                    &observed_at,
                )?;
                self.reconcile_readback(&ExternalEffectReadback {
                    project_id: request.project_id.clone(),
                    job_id: request.job_id.clone(),
                    operation_id: request.operation_id.clone(),
                    request_digest: request.request_digest.clone(),
                    side_effect_ref,
                    result_digest,
                    observed_at,
                })
            }
            ExternalEffectObservation::Failed {
                side_effect_ref,
                reason,
                observed_at,
            } => {
                if let Some(side_effect_ref) = side_effect_ref {
                    self.mark_side_effect_started(
                        &request.project_id,
                        &request.job_id,
                        &side_effect_ref,
                        &observed_at,
                    )?;
                }
                self.fail(&request.project_id, &request.job_id, &observed_at, &reason)
            }
        }
    }

    pub fn start(
        &self,
        project_id: &str,
        job_id: &str,
        at: &str,
    ) -> Result<ExternalEffectResolution, StoreError> {
        match self.start_acquisition(project_id, job_id, at)? {
            ExternalEffectAcquisition::Won(job)
            | ExternalEffectAcquisition::AlreadyRunning(job)
            | ExternalEffectAcquisition::Pending(job) => Ok(resolve_stage(job)),
            ExternalEffectAcquisition::Terminal(resolution) => Ok(resolution),
            ExternalEffectAcquisition::Conflict { reason, .. } => Err(StoreError::Conflict(reason)),
        }
    }

    /// Attempts the sole durable `admitted -> running` acquisition.  A
    /// compare-and-transition conflict is re-read and classified before it is
    /// returned, so a caller that lost to another process can never be
    /// mistaken for the owner.  Only [`ExternalEffectAcquisition::Won`]
    /// authorizes an external callback.
    pub fn start_acquisition(
        &self,
        project_id: &str,
        job_id: &str,
        at: &str,
    ) -> Result<ExternalEffectAcquisition, StoreError> {
        self.validate_project(project_id)?;
        let job = self.require_job(project_id, job_id)?;
        if job.stage != "admitted" {
            return Ok(classify_acquisition_observation(job));
        }

        match self.transition(&job, "running", Some(at), None, None, None) {
            Ok(running) => Ok(ExternalEffectAcquisition::Won(running)),
            Err(StoreError::Conflict(reason)) => {
                let current = self.require_job(project_id, job_id)?;
                if current.stage == "admitted" {
                    Ok(ExternalEffectAcquisition::Conflict {
                        current: Some(current),
                        reason,
                    })
                } else {
                    Ok(classify_acquisition_observation(current))
                }
            }
            Err(error) => Err(error),
        }
    }

    pub fn mark_side_effect_started(
        &self,
        project_id: &str,
        job_id: &str,
        side_effect_ref: &str,
        at: &str,
    ) -> Result<ExternalEffectResolution, StoreError> {
        require_external_text(side_effect_ref, "external side-effect reference")?;
        self.validate_project(project_id)?;
        let job = self.require_job(project_id, job_id)?;
        let job = if job.stage == "running" {
            self.transition(
                &job,
                "side_effect_started",
                Some(at),
                Some(side_effect_ref),
                None,
                None,
            )?
        } else if job.stage == "side_effect_started"
            && job.side_effect_ref.as_deref() != Some(side_effect_ref)
        {
            return Err(StoreError::Conflict(
                "external side-effect reference changed during replay".to_owned(),
            ));
        } else {
            job
        };
        Ok(resolve_stage(job))
    }

    pub fn mark_readback_required(
        &self,
        project_id: &str,
        job_id: &str,
        side_effect_ref: &str,
        at: &str,
    ) -> Result<ExternalEffectResolution, StoreError> {
        require_external_text(side_effect_ref, "external side-effect reference")?;
        self.validate_project(project_id)?;
        let job = if let Some(identity) = self.identity {
            self.store
                .mark_external_job_readback_required_with_identity(
                    identity,
                    job_id,
                    side_effect_ref,
                    at,
                )?
        } else {
            self.store.mark_external_job_readback_required(
                project_id,
                job_id,
                side_effect_ref,
                at,
            )?
        };
        Ok(ExternalEffectResolution::ReadbackRequired(job))
    }

    pub fn reject(
        &self,
        project_id: &str,
        job_id: &str,
        at: &str,
        reason: &str,
    ) -> Result<ExternalEffectResolution, StoreError> {
        require_external_text(at, "external rejection timestamp")?;
        require_external_text(reason, "external rejection reason")?;
        self.validate_project(project_id)?;
        let job = self.require_job(project_id, job_id)?;
        if job.stage == "rejected" {
            return Ok(ExternalEffectResolution::Rejected(job));
        }
        let job = self.transition(&job, "rejected", Some(at), None, None, Some(reason))?;
        Ok(ExternalEffectResolution::Rejected(job))
    }

    pub fn fail(
        &self,
        project_id: &str,
        job_id: &str,
        at: &str,
        reason: &str,
    ) -> Result<ExternalEffectResolution, StoreError> {
        require_external_text(at, "external failure timestamp")?;
        require_external_text(reason, "external failure reason")?;
        self.validate_project(project_id)?;
        let job = self.require_job(project_id, job_id)?;
        if job.stage == "failed" {
            return Ok(ExternalEffectResolution::Failed(job));
        }
        let job = self.transition(&job, "failed", Some(at), None, None, Some(reason))?;
        Ok(ExternalEffectResolution::Failed(job))
    }

    pub fn reconcile_readback(
        &self,
        readback: &ExternalEffectReadback,
    ) -> Result<ExternalEffectResolution, StoreError> {
        for (value, label) in [
            (&readback.project_id, "readback project id"),
            (&readback.job_id, "readback job id"),
            (&readback.operation_id, "readback operation id"),
            (&readback.request_digest, "readback request digest"),
            (&readback.side_effect_ref, "readback side-effect reference"),
            (&readback.result_digest, "readback result digest"),
            (&readback.observed_at, "readback timestamp"),
        ] {
            require_external_text(value, label)?;
        }
        self.validate_project(&readback.project_id)?;
        let job = self.require_job(&readback.project_id, &readback.job_id)?;
        if job.operation_id != readback.operation_id
            || job.request_digest != readback.request_digest
        {
            return Err(StoreError::Conflict(
                "external readback identity does not match the admitted operation".to_owned(),
            ));
        }
        if job.side_effect_ref.as_deref() != Some(readback.side_effect_ref.as_str()) {
            return Err(StoreError::Conflict(
                "external readback side-effect identity does not match the admitted effect"
                    .to_owned(),
            ));
        }
        if job.stage == "reconciled" {
            if job.result_digest.as_deref() != Some(readback.result_digest.as_str()) {
                return Err(StoreError::Conflict(
                    "external operation was reconciled with a different result".to_owned(),
                ));
            }
            return Ok(ExternalEffectResolution::Reconciled(job));
        }
        if job.stage != "readback_required" {
            return Err(StoreError::Conflict(
                "external effect must be read back before reconciliation".to_owned(),
            ));
        }
        let job = self.transition(
            &job,
            "reconciled",
            Some(&readback.observed_at),
            None,
            Some(&readback.result_digest),
            None,
        )?;
        Ok(ExternalEffectResolution::Reconciled(job))
    }

    pub fn readback(
        &self,
        project_id: &str,
        operation_id: &str,
        request_digest: &str,
    ) -> Result<ExternalEffectResolution, StoreError> {
        require_external_text(request_digest, "external request digest")?;
        self.validate_project(project_id)?;
        let job = if let Some(identity) = self.identity {
            self.store
                .external_job_by_operation_with_identity(identity, operation_id)?
        } else {
            self.store
                .external_job_by_operation(project_id, operation_id)?
        }
        .ok_or_else(|| StoreError::NotFound {
            entity: "external_job",
            id: operation_id.to_owned(),
        })?;
        if job.request_digest != request_digest {
            return Err(StoreError::Conflict(
                "external effect operation was reused with a different request digest".to_owned(),
            ));
        }
        Ok(resolve_stage(job))
    }

    fn require_job(&self, project_id: &str, job_id: &str) -> Result<ExternalJobRecord, StoreError> {
        let job = if let Some(identity) = self.identity {
            self.store.external_job_with_identity(identity, job_id)?
        } else {
            self.store.external_job(project_id, job_id)?
        };
        job.ok_or_else(|| StoreError::NotFound {
            entity: "external_job",
            id: job_id.to_owned(),
        })
    }

    fn transition(
        &self,
        job: &ExternalJobRecord,
        next_stage: &str,
        at: Option<&str>,
        side_effect_ref: Option<&str>,
        result_digest: Option<&str>,
        error_message: Option<&str>,
    ) -> Result<ExternalJobRecord, StoreError> {
        let input = ExternalJobTransitionInput {
            project_id: job.project_id.clone(),
            job_id: job.job_id.clone(),
            expected_stage: job.stage.clone(),
            next_stage: next_stage.to_owned(),
            at: at.unwrap_or(&job.updated_at).to_owned(),
            side_effect_ref: side_effect_ref.map(str::to_owned),
            result_digest: result_digest.map(str::to_owned),
            error_message: error_message.map(str::to_owned),
        };
        if let Some(identity) = self.identity {
            self.store
                .advance_external_job_with_identity(identity, &input)
        } else {
            self.store.advance_external_job(&input)
        }
    }

    fn validate_project(&self, project_id: &str) -> Result<(), StoreError> {
        require_external_text(project_id, "external project id")?;
        if let Some(identity) = self.identity {
            if identity.project_id != project_id {
                return Err(StoreError::WrongSubject {
                    expected: identity.project_id.clone(),
                    actual: project_id.to_owned(),
                });
            }
        }
        Ok(())
    }
}

fn require_external_text(value: &str, label: &str) -> Result<(), StoreError> {
    if value.trim().is_empty() {
        Err(StoreError::Invalid(format!("{label} must not be empty")))
    } else {
        Ok(())
    }
}

fn resolve_stage(job: ExternalJobRecord) -> ExternalEffectResolution {
    match job.stage.as_str() {
        "readback_required" | "side_effect_started" | "side_effect_finished" => {
            ExternalEffectResolution::ReadbackRequired(job)
        }
        "reconciled" => ExternalEffectResolution::Reconciled(job),
        "committed" => ExternalEffectResolution::Committed(job),
        "rejected" => ExternalEffectResolution::Rejected(job),
        "failed" => ExternalEffectResolution::Failed(job),
        _ => ExternalEffectResolution::Pending(job),
    }
}

fn classify_acquisition_observation(job: ExternalJobRecord) -> ExternalEffectAcquisition {
    // Match against an owned stage snapshot so the fallback can move the
    // complete job into the conflict result without retaining a borrow into
    // the record. This is classification only; callback authority still
    // comes exclusively from `ExternalEffectAcquisition::Won`.
    let stage = job.stage.clone();
    match stage.as_str() {
        "running" => ExternalEffectAcquisition::AlreadyRunning(job),
        "registered" | "admitted" => ExternalEffectAcquisition::Pending(job),
        "side_effect_started"
        | "side_effect_finished"
        | "readback_required"
        | "reconciled"
        | "committed"
        | "rejected"
        | "failed"
        | "cancel_requested" => ExternalEffectAcquisition::Terminal(resolve_stage(job)),
        stage => ExternalEffectAcquisition::Conflict {
            current: Some(job),
            reason: format!("external job has unclassifiable acquisition stage: {stage}"),
        },
    }
}

/// The command identity expected by a declared acceptance gate.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CommandSpec {
    pub executable: String,
    pub argv: Vec<String>,
}

impl CommandSpec {
    pub fn new(executable: impl Into<String>, argv: Vec<String>) -> Self {
        Self {
            executable: executable.into(),
            argv,
        }
    }

    pub fn validate(&self) -> Result<(), EvidenceValidationError> {
        if self.executable.trim().is_empty() || self.argv.is_empty() {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        if self.argv.len() > MAX_COMMAND_PARTS || self.argv[0] != self.executable {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptCommandMismatch,
            ));
        }
        if self
            .argv
            .iter()
            .map(String::len)
            .sum::<usize>()
            .saturating_add(self.argv.len().saturating_sub(1))
            > MAX_COMMAND_BYTES
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::CommandArgvOversized,
            ));
        }
        if self
            .argv
            .iter()
            .any(|part| part.is_empty() || part.len() > MAX_TEXT_LENGTH || !safe_text(part))
            || self.executable.len() > MAX_TEXT_LENGTH
            || !safe_text(&self.executable)
            || is_shell_executable(&self.executable)
            || self.argv.iter().any(|part| has_parent_path(part))
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::UnsafeCommand,
            ));
        }
        Ok(())
    }
}

/// The only command execution boundary owned by the application layer. An
/// adapter may execute a policy-declared command, but it must return data in
/// this bounded shape; it must not pass a shell command or raw unbounded
/// output into the application.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvidenceExecutionOutcome {
    Passed,
    Failed,
    TimedOut,
    Uncertain,
}

/// Bounded facts returned by a process adapter. This type intentionally
/// contains no process handle, shell string, or persistence concern.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BoundedExecutionResult {
    pub outcome: EvidenceExecutionOutcome,
    pub exit_code: Option<i32>,
    pub started_at: TimestampMs,
    pub ended_at: TimestampMs,
    pub output_size_bytes: u64,
    pub output_digest: Option<String>,
    pub output_ref: Option<String>,
    pub observables: Vec<String>,
}

/// Inputs frozen by the application before an adapter is allowed to execute
/// a gate. The command is read from the acceptance gate, never from authored
/// task prose or adapter output.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceRunRequest {
    pub receipt_id: ReceiptId,
    pub operation_id: OperationId,
    pub expectation: ReceiptExpectation,
    /// Digest of the exact trusted gate declaration used to prepare this run.
    /// It is carried into durable admission identity so a changed declaration
    /// cannot be mistaken for a replay of the same verifier request.
    pub gate_policy_identity: String,
    pub cwd: String,
    pub environment_fingerprint: String,
    pub attestation: ExecutorAttestation,
}

/// A typed runner result retains adapter uncertainty even though the current
/// domain receipt enum only has Passed/Failed/Stale. Timeout and uncertainty
/// therefore become failed receipts that can never satisfy a passing gate,
/// while callers can still distinguish their recovery semantics here.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EvidenceRunResult {
    pub outcome: EvidenceExecutionOutcome,
    pub receipt: ReceiptPayload,
}

impl EvidenceRunResult {
    pub const fn is_passed(&self) -> bool {
        matches!(self.outcome, EvidenceExecutionOutcome::Passed)
    }
}

/// Validate a declared gate and adapter result, then construct the complete
/// application receipt. This is pure: it neither executes a process nor
/// writes a store row.
pub fn build_bounded_evidence_receipt(
    request: &EvidenceRunRequest,
    execution: &BoundedExecutionResult,
) -> Result<EvidenceRunResult, EvidenceValidationError> {
    let command = request
        .expectation
        .gate
        .command
        .as_ref()
        .ok_or_else(|| EvidenceValidationError::new(EvidenceErrorCode::CommandNotDeclared))?;
    command.validate()?;
    validate_execution_result(execution)?;

    let receipt = ReceiptPayload {
        schema_version: RECEIPT_SCHEMA_VERSION.to_owned(),
        receipt_id: request.receipt_id.clone(),
        operation_id: request.operation_id.clone(),
        work_id: request.expectation.work_id.clone(),
        attempt_id: request.expectation.attempt_id.clone(),
        fence: request.expectation.fence,
        gate_id: request.expectation.gate.id.clone(),
        executable: command.executable.clone(),
        argv: command.argv.clone(),
        cwd: request.cwd.clone(),
        exit_code: execution.exit_code.unwrap_or(-1),
        started_at: execution.started_at,
        ended_at: execution.ended_at,
        source_snapshot_hash: request.expectation.source_snapshot_hash.clone(),
        config_identity: request.expectation.config_identity.clone(),
        environment_fingerprint: request.environment_fingerprint.clone(),
        output_digest: execution.output_digest.clone(),
        output_ref: execution.output_ref.clone(),
        coverage: ReceiptCoverage {
            kind: request.expectation.gate.kind,
            profile_id: request.expectation.profile_id.clone(),
            profile_version: request.expectation.profile_version.clone(),
            observables: execution.observables.clone(),
        },
        attestation: request.attestation,
        result: match execution.outcome {
            EvidenceExecutionOutcome::Passed => ReceiptResult::Passed,
            EvidenceExecutionOutcome::Failed
            | EvidenceExecutionOutcome::TimedOut
            | EvidenceExecutionOutcome::Uncertain => ReceiptResult::Failed,
        },
    };
    receipt.validate_for(&request.expectation)?;

    Ok(EvidenceRunResult {
        outcome: execution.outcome,
        receipt,
    })
}

fn validate_execution_result(
    execution: &BoundedExecutionResult,
) -> Result<(), EvidenceValidationError> {
    if execution.ended_at < execution.started_at {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ExecutionResultInvalid,
        ));
    }
    if execution.output_size_bytes > MAX_OUTPUT_BYTES {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::OutputOversized,
        ));
    }
    if execution.output_size_bytes > 0
        && execution.output_digest.is_none()
        && execution.output_ref.is_none()
    {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ExecutionResultInvalid,
        ));
    }
    match execution.outcome {
        EvidenceExecutionOutcome::Passed if execution.exit_code != Some(0) => Err(
            EvidenceValidationError::new(EvidenceErrorCode::ExecutionResultInvalid),
        ),
        EvidenceExecutionOutcome::Failed => match execution.exit_code {
            Some(0) | None => Err(EvidenceValidationError::new(
                EvidenceErrorCode::ExecutionResultInvalid,
            )),
            Some(_) => Ok(()),
        },
        EvidenceExecutionOutcome::TimedOut | EvidenceExecutionOutcome::Uncertain
            if execution.exit_code.is_some() =>
        {
            Err(EvidenceValidationError::new(
                EvidenceErrorCode::ExecutionResultInvalid,
            ))
        }
        _ => Ok(()),
    }
}

/// How the coordinator knows who or what witnessed a receipt.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ExecutorAttestation {
    BorealWitnessed,
    ExternalAttested,
    SelfReported,
    Unknown,
}

impl ExecutorAttestation {
    pub const fn is_gate_trusted(self) -> bool {
        matches!(self, Self::BorealWitnessed | Self::ExternalAttested)
    }
}

/// Typed coverage attached to a receipt. The observable names are data, not
/// executable instructions; a gate definition decides which names are needed.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptCoverage {
    pub kind: GateKind,
    pub profile_id: ProfileId,
    pub profile_version: String,
    pub observables: Vec<String>,
}

/// The complete application-layer receipt payload. Failed and stale payloads
/// are valid historical facts and must not be discarded by adapters.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptPayload {
    pub schema_version: String,
    pub receipt_id: ReceiptId,
    pub operation_id: OperationId,
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub gate_id: GateId,
    pub executable: String,
    pub argv: Vec<String>,
    pub cwd: String,
    pub exit_code: i32,
    pub started_at: TimestampMs,
    pub ended_at: TimestampMs,
    pub source_snapshot_hash: SourceVersionId,
    pub config_identity: ConfigIdentity,
    pub environment_fingerprint: String,
    pub output_digest: Option<String>,
    pub output_ref: Option<String>,
    pub coverage: ReceiptCoverage,
    pub attestation: ExecutorAttestation,
    pub result: ReceiptResult,
}

impl ReceiptPayload {
    pub fn validate(&self) -> Result<(), EvidenceValidationError> {
        if self.schema_version != RECEIPT_SCHEMA_VERSION
            || !valid_id(self.receipt_id.as_str())
            || !valid_id(self.operation_id.as_str())
            || !valid_id(self.work_id.as_str())
            || !valid_id(self.attempt_id.as_str())
            || !valid_id(self.gate_id.as_str())
            || self.fence.get() == 0
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        CommandSpec::new(self.executable.clone(), self.argv.clone()).validate()?;
        if self.cwd.trim().is_empty() || self.cwd.len() > MAX_TEXT_LENGTH || !safe_text(&self.cwd) {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        if self.ended_at < self.started_at {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        if !valid_id(self.source_snapshot_hash.as_str())
            || !valid_id(self.config_identity.as_str())
            || self.environment_fingerprint.trim().is_empty()
            || self.environment_fingerprint.len() > MAX_TEXT_LENGTH
            || !safe_text(&self.environment_fingerprint)
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        if self.output_digest.as_ref().is_some_and(|value| {
            value.is_empty() || value.len() > MAX_TEXT_LENGTH || !safe_text(value)
        }) || self.output_ref.as_ref().is_some_and(|value| {
            value.is_empty() || value.len() > MAX_TEXT_LENGTH || !safe_text(value)
        }) {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        if !valid_id(self.coverage.profile_id.as_str())
            || self.coverage.profile_version.trim().is_empty()
            || self.coverage.profile_version.len() > MAX_TEXT_LENGTH
            || !safe_text(&self.coverage.profile_version)
            || self.coverage.observables.len() > MAX_OBSERVABLES
            || self
                .coverage
                .observables
                .iter()
                .any(|value| value.is_empty() || value.len() > MAX_TEXT_LENGTH || !safe_text(value))
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        Ok(())
    }

    pub fn command(&self) -> CommandSpec {
        CommandSpec::new(self.executable.clone(), self.argv.clone())
    }

    pub fn validate_for(
        &self,
        expected: &ReceiptExpectation,
    ) -> Result<(), EvidenceValidationError> {
        self.validate()?;
        self.validate_context_for(expected)?;
        if expected.gate.requires_attestation && !self.attestation.is_gate_trusted() {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptAttestationMissing,
            ));
        }
        self.validate_observables(expected)?;
        self.validate_passed_result()
    }

    /// Validate an imported fact against the current subject and policy
    /// context without granting it witnessed authority. Imported failed facts
    /// remain retainable even when their attestation or observable claims are
    /// not trusted; the durable façade must downgrade an untrusted `Passed`
    /// result before persisting it.
    pub fn validate_for_import(
        &self,
        expected: &ReceiptExpectation,
    ) -> Result<(), EvidenceValidationError> {
        self.validate()?;
        self.validate_context_for(expected)
    }

    fn validate_context_for(
        &self,
        expected: &ReceiptExpectation,
    ) -> Result<(), EvidenceValidationError> {
        if self.work_id != expected.work_id {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptSubjectMismatch,
            ));
        }
        if self.attempt_id != expected.attempt_id || self.fence != expected.fence {
            return Err(EvidenceValidationError::new(EvidenceErrorCode::StaleFence));
        }
        if self.gate_id != expected.gate.id {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptSubjectMismatch,
            ));
        }
        if self.source_snapshot_hash != expected.source_snapshot_hash {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptSourceMismatch,
            ));
        }
        if self.config_identity != expected.config_identity {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptConfigMismatch,
            ));
        }
        if self.coverage.profile_id != expected.profile_id
            || self.coverage.profile_version != expected.profile_version
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptPolicyMismatch,
            ));
        }
        if self.coverage.kind != expected.gate.kind {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptObservableMissing,
            ));
        }
        if let Some(command) = &expected.gate.command {
            if self.command() != *command {
                return Err(EvidenceValidationError::new(
                    EvidenceErrorCode::ReceiptCommandMismatch,
                ));
            }
        }
        Ok(())
    }

    fn validate_observables(
        &self,
        expected: &ReceiptExpectation,
    ) -> Result<(), EvidenceValidationError> {
        if expected.gate.required_observables.iter().any(|required| {
            !self
                .coverage
                .observables
                .iter()
                .any(|value| value == required)
        }) {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptObservableMissing,
            ));
        }
        Ok(())
    }

    fn validate_passed_result(&self) -> Result<(), EvidenceValidationError> {
        if self.result == ReceiptResult::Passed && self.exit_code != 0 {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptExitNonzero,
            ));
        }
        if self.result == ReceiptResult::Passed
            && self.output_digest.is_none()
            && self.output_ref.is_none()
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptObservableMissing,
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptExpectation {
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub source_snapshot_hash: SourceVersionId,
    pub config_identity: ConfigIdentity,
    pub profile_id: ProfileId,
    pub profile_version: String,
    pub gate: AcceptanceGateDefinition,
}

/// A versioned acceptance gate definition. `command` is optional because the
/// initial domain profile only names gate kinds; coordinators can freeze a
/// concrete bounded command when one is available.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceGateDefinition {
    pub id: GateId,
    pub kind: GateKind,
    pub required: bool,
    pub command: Option<CommandSpec>,
    pub requires_attestation: bool,
    pub required_observables: Vec<String>,
}

impl AcceptanceGateDefinition {
    pub fn required(id: GateId, kind: GateKind) -> Self {
        Self {
            id,
            kind,
            required: true,
            command: None,
            requires_attestation: true,
            required_observables: Vec::new(),
        }
    }

    pub fn optional(id: GateId, kind: GateKind) -> Self {
        Self {
            required: false,
            ..Self::required(id, kind)
        }
    }

    pub fn with_command(mut self, command: CommandSpec) -> Self {
        self.command = Some(command);
        self
    }

    pub fn with_observables(mut self, observables: Vec<String>) -> Self {
        self.required_observables = observables;
        self
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceDefinition {
    pub id: ProfileId,
    pub version: String,
    pub gates: Vec<AcceptanceGateDefinition>,
    pub close_requires_intent: bool,
}

impl AcceptanceDefinition {
    pub fn from_domain(profile: &boreal_domain::AcceptanceProfile) -> Self {
        Self {
            id: profile.id.clone(),
            version: profile.version.clone(),
            gates: profile
                .gates
                .iter()
                .map(|gate| AcceptanceGateDefinition {
                    id: gate.id.clone(),
                    kind: gate.kind,
                    required: gate.required,
                    command: None,
                    requires_attestation: true,
                    required_observables: Vec::new(),
                })
                .collect(),
            close_requires_intent: true,
        }
    }

    pub fn focused() -> Self {
        Self::from_domain(&boreal_domain::AcceptanceProfile::focused())
    }

    pub fn reviewed() -> Self {
        Self::from_domain(&boreal_domain::AcceptanceProfile::reviewed())
    }

    pub fn operator() -> Self {
        Self {
            id: ProfileId::new("operator"),
            version: "v1".to_owned(),
            gates: vec![
                AcceptanceGateDefinition::required(
                    GateId::new("verification"),
                    GateKind::Verification,
                ),
                AcceptanceGateDefinition::required(
                    GateId::new("operator_approval"),
                    GateKind::OperatorApproval,
                ),
                AcceptanceGateDefinition::required(GateId::new("audit"), GateKind::Audit),
            ],
            close_requires_intent: true,
        }
    }

    pub fn requires_independent_review(&self) -> bool {
        self.gates
            .iter()
            .any(|gate| gate.required && gate.kind == GateKind::Review)
    }

    fn validate(&self) -> Result<(), EvidenceValidationError> {
        if !valid_id(self.id.as_str())
            || self.version.trim().is_empty()
            || self.version.len() > MAX_TEXT_LENGTH
            || !safe_text(&self.version)
            || self.gates.is_empty()
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        let mut ids = self
            .gates
            .iter()
            .map(|gate| gate.id.as_str())
            .collect::<Vec<_>>();
        ids.sort_unstable();
        if ids.windows(2).any(|window| window[0] == window[1]) {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::ReceiptInvalid,
            ));
        }
        for gate in &self.gates {
            if !valid_id(gate.id.as_str())
                || gate.required_observables.len() > MAX_OBSERVABLES
                || gate
                    .required_observables
                    .iter()
                    .any(|value| value.is_empty() || !safe_text(value))
            {
                return Err(EvidenceValidationError::new(
                    EvidenceErrorCode::ReceiptInvalid,
                ));
            }
            if let Some(command) = &gate.command {
                command.validate()?;
            }
        }
        Ok(())
    }
}

pub type AcceptanceGate = AcceptanceGateDefinition;
pub type AcceptanceProfileDefinition = AcceptanceDefinition;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceGateResult {
    pub gate_id: GateId,
    pub kind: GateKind,
    pub state: GateState,
    pub receipt_id: Option<ReceiptId>,
    pub reason: Option<EvidenceErrorCode>,
}

pub type GateResult = AcceptanceGateResult;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AcceptanceEvaluation {
    pub profile_id: ProfileId,
    pub profile_version: String,
    pub gates: Vec<AcceptanceGateResult>,
}

impl AcceptanceEvaluation {
    pub fn required_satisfied(&self, profile: &AcceptanceDefinition) -> bool {
        profile
            .gates
            .iter()
            .filter(|gate| gate.required)
            .all(|gate| {
                self.gates
                    .iter()
                    .find(|result| result.gate_id == gate.id)
                    .is_some_and(|result| result.state == GateState::Satisfied)
            })
    }

    pub fn open_required(&self, profile: &AcceptanceDefinition) -> Vec<GateId> {
        let mut ids = profile
            .gates
            .iter()
            .filter(|gate| gate.required)
            .filter(|gate| {
                self.gates
                    .iter()
                    .find(|result| result.gate_id == gate.id)
                    .is_none_or(|result| result.state != GateState::Satisfied)
            })
            .map(|gate| gate.id.clone())
            .collect::<Vec<_>>();
        ids.sort();
        ids
    }
}

pub fn evaluate_acceptance(
    definition: &AcceptanceDefinition,
    receipts: &[ReceiptPayload],
    base: &ReceiptExpectationBase,
) -> Result<AcceptanceEvaluation, EvidenceValidationError> {
    definition.validate()?;
    let mut gates = definition.gates.clone();
    gates.sort_by(|left, right| left.id.cmp(&right.id));
    let results = gates
        .into_iter()
        .map(|gate| {
            let expected = ReceiptExpectation {
                work_id: base.work_id.clone(),
                attempt_id: base.attempt_id.clone(),
                fence: base.fence,
                source_snapshot_hash: base.source_snapshot_hash.clone(),
                config_identity: base.config_identity.clone(),
                profile_id: definition.id.clone(),
                profile_version: definition.version.clone(),
                gate: gate.clone(),
            };
            let mut candidates = receipts
                .iter()
                .filter(|receipt| receipt.gate_id == gate.id)
                .collect::<Vec<_>>();
            candidates.sort_by(|left, right| {
                left.ended_at
                    .cmp(&right.ended_at)
                    .then_with(|| left.receipt_id.cmp(&right.receipt_id))
            });
            let result = candidates.last().map_or_else(
                || AcceptanceGateResult {
                    gate_id: gate.id.clone(),
                    kind: gate.kind,
                    state: GateState::Open,
                    receipt_id: None,
                    reason: None,
                },
                |receipt| match receipt.validate_for(&expected) {
                    Ok(()) if receipt.result == ReceiptResult::Passed => AcceptanceGateResult {
                        gate_id: gate.id.clone(),
                        kind: gate.kind,
                        state: GateState::Satisfied,
                        receipt_id: Some(receipt.receipt_id.clone()),
                        reason: None,
                    },
                    Ok(()) => AcceptanceGateResult {
                        gate_id: gate.id.clone(),
                        kind: gate.kind,
                        state: GateState::Failed,
                        receipt_id: Some(receipt.receipt_id.clone()),
                        reason: Some(EvidenceErrorCode::ReceiptExitNonzero),
                    },
                    Err(error) => AcceptanceGateResult {
                        gate_id: gate.id.clone(),
                        kind: gate.kind,
                        state: GateState::Failed,
                        receipt_id: Some(receipt.receipt_id.clone()),
                        reason: Some(error.code()),
                    },
                },
            );
            result
        })
        .collect();
    Ok(AcceptanceEvaluation {
        profile_id: definition.id.clone(),
        profile_version: definition.version.clone(),
        gates: results,
    })
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReceiptExpectationBase {
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub source_snapshot_hash: SourceVersionId,
    pub config_identity: ConfigIdentity,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ReviewDecision {
    Accepted,
    Rejected,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewDecisionRequest {
    pub review_id: String,
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub reviewer_actor_id: ActorId,
    pub attempt_actor_id: ActorId,
    pub reviewer_role: ActorRole,
    pub decision: ReviewDecision,
    pub reason: String,
    pub source_snapshot_hash: SourceVersionId,
    pub config_identity: ConfigIdentity,
    pub policy_version: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReviewExpectation {
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub source_snapshot_hash: SourceVersionId,
    pub config_identity: ConfigIdentity,
    pub policy_version: String,
}

pub fn validate_review_decision(
    review: &ReviewDecisionRequest,
    definition: &AcceptanceDefinition,
    expected: &ReviewExpectation,
) -> Result<(), EvidenceValidationError> {
    if !definition.requires_independent_review() {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ReviewGateNotRequired,
        ));
    }
    if review.reviewer_role != ActorRole::Reviewer && review.reviewer_role != ActorRole::Operator {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ReviewerRoleDenied,
        ));
    }
    if review.reviewer_actor_id == review.attempt_actor_id {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ReviewerCannotReviewOwnAttempt,
        ));
    }
    if !valid_id(&review.review_id)
        || !valid_id(review.work_id.as_str())
        || !valid_id(review.attempt_id.as_str())
        || !valid_id(review.reviewer_actor_id.as_str())
        || !valid_id(review.attempt_actor_id.as_str())
        || review.fence.get() == 0
        || review.reason.trim().is_empty()
        || review.reason.len() > MAX_TEXT_LENGTH
        || !safe_text(&review.reason)
    {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ReviewInvalid,
        ));
    }
    if review.work_id != expected.work_id || review.attempt_id != expected.attempt_id {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ReceiptSubjectMismatch,
        ));
    }
    if review.fence != expected.fence {
        return Err(EvidenceValidationError::new(EvidenceErrorCode::StaleFence));
    }
    if review.source_snapshot_hash != expected.source_snapshot_hash {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ReceiptSourceMismatch,
        ));
    }
    if review.config_identity != expected.config_identity {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ReceiptConfigMismatch,
        ));
    }
    if review.policy_version != expected.policy_version {
        return Err(EvidenceValidationError::new(
            EvidenceErrorCode::ReceiptPolicyMismatch,
        ));
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct SummaryPayload {
    pub summary_id: String,
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub source_snapshot_hash: SourceVersionId,
    pub config_identity: ConfigIdentity,
    pub profile_id: ProfileId,
    pub profile_version: String,
    pub body_digest: String,
    pub body_size: u64,
}

impl SummaryPayload {
    pub fn validate(&self) -> Result<(), EvidenceValidationError> {
        if self.summary_id.trim().is_empty()
            || self.work_id.as_str().trim().is_empty()
            || self.attempt_id.as_str().trim().is_empty()
            || self.fence.get() == 0
            || self.source_snapshot_hash.as_str().trim().is_empty()
            || self.config_identity.as_str().trim().is_empty()
            || self.profile_id.as_str().trim().is_empty()
            || self
                .profile_version
                .parse::<u64>()
                .ok()
                .is_none_or(|version| version == 0)
            || self.body_size == 0
            || self.body_size > MAX_OUTPUT_BYTES
            || !valid_summary_digest(&self.body_digest)
        {
            return Err(EvidenceValidationError::new(
                EvidenceErrorCode::SummaryInvalid,
            ));
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloseIntent {
    pub work_id: WorkId,
    pub attempt_id: AttemptId,
    pub fence: Fence,
    pub source_snapshot_hash: SourceVersionId,
    pub config_identity: ConfigIdentity,
    pub profile_id: ProfileId,
    pub profile_version: String,
    pub summary_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloseoutInput {
    pub definition: AcceptanceDefinition,
    pub work_id: WorkId,
    pub attempt: AttemptSnapshot,
    pub expected_fence: Fence,
    pub source_snapshot_hash: SourceVersionId,
    pub config_identity: ConfigIdentity,
    pub policy_version: String,
    /// Immutable receipt facts for the current attempt. `gates` is retained
    /// as a compatibility/read-model field, but close readiness must be
    /// derived from these receipts rather than trusting caller-supplied gate
    /// states.
    pub receipts: Vec<ReceiptPayload>,
    pub gates: Vec<AcceptanceGateResult>,
    pub review: Option<ReviewDecisionRequest>,
    pub summary: Option<SummaryPayload>,
    pub close_intent: Option<CloseIntent>,
}

pub type CloseReadinessInput = CloseoutInput;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CloseoutGap {
    AttemptNotCurrent,
    AttemptNotVerifying,
    StaleFence,
    GateUnsatisfied(GateId),
    ReviewRequired(GateId),
    ReviewRejected(GateId),
    SummaryMissing,
    SummaryMismatch,
    CloseIntentMissing,
    CloseIntentMismatch,
}

impl CloseoutGap {
    pub fn code(&self) -> &'static str {
        match self {
            Self::AttemptNotCurrent => "attempt_not_current",
            Self::AttemptNotVerifying => "attempt_not_verifying",
            Self::StaleFence => "stale_fence",
            Self::GateUnsatisfied(_) => "gate_unsatisfied",
            Self::ReviewRequired(_) => "review_required",
            Self::ReviewRejected(_) => "review_rejected",
            Self::SummaryMissing => "summary_missing",
            Self::SummaryMismatch => "summary_mismatch",
            Self::CloseIntentMissing => "close_intent_missing",
            Self::CloseIntentMismatch => "close_intent_invalid",
        }
    }
}

pub type CloseGap = CloseoutGap;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CloseReadiness {
    pub ready: bool,
    pub gates: Vec<AcceptanceGateResult>,
    pub gaps: Vec<CloseoutGap>,
}

impl CloseReadiness {
    pub const fn is_ready(&self) -> bool {
        self.ready
    }
}

pub fn evaluate_close_readiness(
    input: &CloseoutInput,
) -> Result<CloseReadiness, EvidenceValidationError> {
    input.definition.validate()?;
    let review_gate = input
        .definition
        .gates
        .iter()
        .find(|gate| gate.required && gate.kind == GateKind::Review);
    let review_expected = ReviewExpectation {
        work_id: input.work_id.clone(),
        attempt_id: input.attempt.attempt_id.clone(),
        fence: input.expected_fence,
        source_snapshot_hash: input.source_snapshot_hash.clone(),
        config_identity: input.config_identity.clone(),
        policy_version: input.policy_version.clone(),
    };
    let mut gaps = Vec::new();
    if input.attempt.work_id != input.work_id || input.attempt.fence != input.expected_fence {
        gaps.push(CloseoutGap::StaleFence);
    }
    if !input.attempt.current {
        gaps.push(CloseoutGap::AttemptNotCurrent);
    }
    if !matches!(
        input.attempt.phase,
        AttemptPhase::Verifying | AttemptPhase::Completed
    ) {
        gaps.push(CloseoutGap::AttemptNotVerifying);
    }
    if input.definition.close_requires_intent {
        match &input.close_intent {
            None => gaps.push(CloseoutGap::CloseIntentMissing),
            Some(intent) if !close_intent_matches(intent, input) => {
                gaps.push(CloseoutGap::CloseIntentMismatch)
            }
            Some(_) => {}
        }
    }

    let base = ReceiptExpectationBase {
        work_id: input.work_id.clone(),
        attempt_id: input.attempt.attempt_id.clone(),
        fence: input.expected_fence,
        source_snapshot_hash: input.source_snapshot_hash.clone(),
        config_identity: input.config_identity.clone(),
    };
    let evaluated = evaluate_acceptance(&input.definition, &input.receipts, &base)?;
    let mut definitions = input.definition.gates.clone();
    definitions.sort_by(|left, right| left.id.cmp(&right.id));
    let results = evaluated.gates;
    for gate in definitions.iter().filter(|gate| gate.required) {
        if Some(gate.id.clone()) == review_gate.map(|value| value.id.clone()) {
            match &input.review {
                None => gaps.push(CloseoutGap::ReviewRequired(gate.id.clone())),
                Some(review) => {
                    match validate_review_decision(review, &input.definition, &review_expected) {
                        Ok(()) if review.decision == ReviewDecision::Accepted => {}
                        Ok(()) | Err(_) => gaps.push(CloseoutGap::ReviewRejected(gate.id.clone())),
                    }
                }
            }
            continue;
        }
        let satisfied = results
            .iter()
            .find(|result| result.gate_id == gate.id)
            .is_some_and(|result| result.state == GateState::Satisfied);
        if satisfied {
            continue;
        }
        gaps.push(CloseoutGap::GateUnsatisfied(gate.id.clone()));
    }

    if input
        .definition
        .gates
        .iter()
        .any(|gate| gate.required && gate.kind == GateKind::Summary)
    {
        match &input.summary {
            None => gaps.push(CloseoutGap::SummaryMissing),
            Some(summary) if !summary_matches(summary, input) => {
                gaps.push(CloseoutGap::SummaryMismatch)
            }
            Some(_) => {}
        }
    }
    gaps.sort_by(|left, right| {
        left.code()
            .cmp(right.code())
            .then_with(|| close_gap_id(left).cmp(close_gap_id(right)))
    });
    gaps.dedup();
    Ok(CloseReadiness {
        ready: gaps.is_empty(),
        gates: results,
        gaps,
    })
}

pub fn evaluate_close(input: &CloseoutInput) -> Result<CloseReadiness, EvidenceValidationError> {
    evaluate_close_readiness(input)
}

fn close_intent_matches(intent: &CloseIntent, input: &CloseoutInput) -> bool {
    intent.work_id == input.work_id
        && intent.attempt_id == input.attempt.attempt_id
        && intent.fence == input.expected_fence
        && intent.source_snapshot_hash == input.source_snapshot_hash
        && intent.config_identity == input.config_identity
        && intent.profile_id == input.definition.id
        && intent.profile_version == input.definition.version
        && intent.summary_id.as_ref().is_none_or(|summary_id| {
            input
                .summary
                .as_ref()
                .is_some_and(|summary| &summary.summary_id == summary_id)
        })
}

fn summary_matches(summary: &SummaryPayload, input: &CloseoutInput) -> bool {
    summary.validate().is_ok()
        && summary.work_id == input.work_id
        && summary.attempt_id == input.attempt.attempt_id
        && summary.fence == input.expected_fence
        && summary.source_snapshot_hash == input.source_snapshot_hash
        && summary.config_identity == input.config_identity
        && summary.profile_id == input.definition.id
        && summary.profile_version == input.definition.version
}

fn valid_summary_digest(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn close_gap_id(gap: &CloseoutGap) -> &str {
    match gap {
        CloseoutGap::GateUnsatisfied(id)
        | CloseoutGap::ReviewRequired(id)
        | CloseoutGap::ReviewRejected(id) => id.as_str(),
        _ => "",
    }
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= MAX_TEXT_LENGTH
        && value
            .chars()
            .all(|character| !character.is_control() && !character.is_whitespace())
}

fn safe_text(value: &str) -> bool {
    !value.chars().any(|character| {
        character.is_control() || matches!(character, ';' | '|' | '&' | '>' | '<' | '`' | '$')
    })
}

fn is_shell_executable(value: &str) -> bool {
    matches!(
        value
            .rsplit('/')
            .next()
            .unwrap_or(value)
            .to_ascii_lowercase()
            .as_str(),
        "sh" | "bash"
            | "dash"
            | "zsh"
            | "fish"
            | "ksh"
            | "csh"
            | "tcsh"
            | "cmd"
            | "powershell"
            | "pwsh"
    )
}

fn has_parent_path(value: &str) -> bool {
    value.split(['/', '\\']).any(|component| component == "..")
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum EvidenceErrorCode {
    ReceiptInvalid,
    UnsafeCommand,
    CommandNotDeclared,
    CommandArgvOversized,
    OutputOversized,
    ExecutionResultInvalid,
    ReceiptSubjectMismatch,
    StaleFence,
    ReceiptSourceMismatch,
    ReceiptConfigMismatch,
    ReceiptPolicyMismatch,
    ReceiptCommandMismatch,
    ReceiptAttestationMissing,
    WitnessedReceiptImportDenied,
    ReceiptObservableMissing,
    ReceiptExitNonzero,
    ReviewGateNotRequired,
    ReviewerRoleDenied,
    ReviewerCannotReviewOwnAttempt,
    ReviewInvalid,
    SummaryInvalid,
}

impl EvidenceErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReceiptInvalid => "receipt_invalid",
            Self::UnsafeCommand => "unsafe_command",
            Self::CommandNotDeclared => "command_not_declared",
            Self::CommandArgvOversized => "command_argv_oversized",
            Self::OutputOversized => "output_oversized",
            Self::ExecutionResultInvalid => "execution_result_invalid",
            Self::ReceiptSubjectMismatch => "receipt_subject_mismatch",
            Self::StaleFence => "stale_fence",
            Self::ReceiptSourceMismatch => "receipt_source_mismatch",
            Self::ReceiptConfigMismatch => "receipt_config_mismatch",
            Self::ReceiptPolicyMismatch => "receipt_policy_mismatch",
            Self::ReceiptCommandMismatch => "receipt_command_mismatch",
            Self::ReceiptAttestationMissing => "receipt_attestation_missing",
            Self::WitnessedReceiptImportDenied => "witnessed_receipt_import_denied",
            Self::ReceiptObservableMissing => "receipt_observable_missing",
            Self::ReceiptExitNonzero => "receipt_exit_nonzero",
            Self::ReviewGateNotRequired => "review_gate_not_required",
            Self::ReviewerRoleDenied => "role_denied",
            Self::ReviewerCannotReviewOwnAttempt => "reviewer_cannot_review_own_attempt",
            Self::ReviewInvalid => "review_invalid",
            Self::SummaryInvalid => "summary_invalid",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct EvidenceValidationError {
    code: EvidenceErrorCode,
}

impl EvidenceValidationError {
    pub(crate) const fn new(code: EvidenceErrorCode) -> Self {
        Self { code }
    }

    pub const fn code(self) -> EvidenceErrorCode {
        self.code
    }

    pub const fn code_str(self) -> &'static str {
        self.code.as_str()
    }
}

impl std::fmt::Display for EvidenceValidationError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(match self.code {
            EvidenceErrorCode::ReceiptInvalid => {
                "The receipt is missing a required typed field or has invalid provenance."
            }
            EvidenceErrorCode::UnsafeCommand => {
                "The command or path is not allowed by the trusted runner policy."
            }
            EvidenceErrorCode::CommandNotDeclared => {
                "The acceptance gate does not declare an executable command."
            }
            EvidenceErrorCode::CommandArgvOversized => {
                "The declared command argument vector exceeds the bounded limit."
            }
            EvidenceErrorCode::OutputOversized => {
                "The adapter reported output larger than the bounded limit."
            }
            EvidenceErrorCode::ExecutionResultInvalid => {
                "The adapter returned an internally inconsistent execution result."
            }
            EvidenceErrorCode::ReceiptSubjectMismatch => {
                "The receipt subject does not match the requested work."
            }
            EvidenceErrorCode::StaleFence => "The attempt fence is no longer current.",
            EvidenceErrorCode::ReceiptSourceMismatch => {
                "The receipt source snapshot does not match the attempt."
            }
            EvidenceErrorCode::ReceiptConfigMismatch => {
                "The receipt configuration identity does not match the attempt."
            }
            EvidenceErrorCode::ReceiptPolicyMismatch => {
                "The receipt acceptance policy does not match the work profile."
            }
            EvidenceErrorCode::ReceiptCommandMismatch => {
                "The receipt command is not the declared bounded gate command."
            }
            EvidenceErrorCode::ReceiptAttestationMissing => {
                "The receipt lacks the required executor attestation."
            }
            EvidenceErrorCode::WitnessedReceiptImportDenied => {
                "A witnessed receipt must be committed by the trusted execution path."
            }
            EvidenceErrorCode::ReceiptObservableMissing => {
                "The receipt does not contain the required observable coverage."
            }
            EvidenceErrorCode::ReceiptExitNonzero => "The declared gate command exited nonzero.",
            EvidenceErrorCode::ReviewGateNotRequired => {
                "The acceptance profile does not contain an independent review gate."
            }
            EvidenceErrorCode::ReviewerRoleDenied => {
                "The actor role cannot perform this review operation."
            }
            EvidenceErrorCode::ReviewerCannotReviewOwnAttempt => {
                "An attempt actor cannot independently review the same attempt."
            }
            EvidenceErrorCode::ReviewInvalid => {
                "The review decision is missing a required typed field."
            }
            EvidenceErrorCode::SummaryInvalid => {
                "The summary is missing a required field or has an invalid body digest or size."
            }
        })
    }
}

impl std::error::Error for EvidenceValidationError {}

impl From<EvidenceValidationError> for ApplicationError {
    fn from(error: EvidenceValidationError) -> Self {
        Self::Evidence(error)
    }
}

impl crate::WorkApplication<'_> {
    pub fn validate_receipt(
        &self,
        receipt: &ReceiptPayload,
        expected: &ReceiptExpectation,
    ) -> Result<(), ApplicationError> {
        receipt
            .validate_for(expected)
            .map_err(ApplicationError::from)
    }

    pub fn evaluate_acceptance(
        &self,
        definition: &AcceptanceDefinition,
        receipts: &[ReceiptPayload],
        base: &ReceiptExpectationBase,
    ) -> Result<AcceptanceEvaluation, ApplicationError> {
        evaluate_acceptance(definition, receipts, base).map_err(ApplicationError::from)
    }

    pub fn validate_review(
        &self,
        review: &ReviewDecisionRequest,
        definition: &AcceptanceDefinition,
        expected: &ReviewExpectation,
    ) -> Result<(), ApplicationError> {
        validate_review_decision(review, definition, expected).map_err(ApplicationError::from)
    }

    pub fn evaluate_close_readiness(
        &self,
        input: &CloseoutInput,
    ) -> Result<CloseReadiness, ApplicationError> {
        evaluate_close_readiness(input).map_err(ApplicationError::from)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn base() -> ReceiptExpectationBase {
        ReceiptExpectationBase {
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-1"),
            fence: Fence::new(1),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
        }
    }

    fn receipt(result: ReceiptResult) -> ReceiptPayload {
        ReceiptPayload {
            schema_version: RECEIPT_SCHEMA_VERSION.to_owned(),
            receipt_id: ReceiptId::new("receipt-1"),
            operation_id: OperationId::new("operation-1"),
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-1"),
            fence: Fence::new(1),
            gate_id: GateId::new("verification"),
            executable: "./check".to_owned(),
            argv: vec!["./check".to_owned(), "--json".to_owned()],
            cwd: "/workspace/project".to_owned(),
            exit_code: 0,
            started_at: TimestampMs::from_millis(10),
            ended_at: TimestampMs::from_millis(11),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
            environment_fingerprint: "env-1".to_owned(),
            output_digest: Some("sha256:output".to_owned()),
            output_ref: None,
            coverage: ReceiptCoverage {
                kind: GateKind::Verification,
                profile_id: ProfileId::new("focused"),
                profile_version: "1".to_owned(),
                observables: vec!["verification".to_owned()],
            },
            attestation: ExecutorAttestation::BorealWitnessed,
            result,
        }
    }

    fn passed_receipts(definition: &AcceptanceDefinition) -> Vec<ReceiptPayload> {
        definition
            .gates
            .iter()
            .enumerate()
            .map(|(index, gate)| {
                let mut value = receipt(ReceiptResult::Passed);
                value.receipt_id = ReceiptId::new(format!("receipt-{}", gate.id.as_str()));
                value.gate_id = gate.id.clone();
                value.coverage.kind = gate.kind;
                value.coverage.profile_id = definition.id.clone();
                value.coverage.profile_version = definition.version.clone();
                value.operation_id = OperationId::new(format!("operation-{index}"));
                value
            })
            .collect()
    }

    fn run_request() -> EvidenceRunRequest {
        EvidenceRunRequest {
            receipt_id: ReceiptId::new("receipt-run"),
            operation_id: OperationId::new("operation-run"),
            gate_policy_identity: format!("sha256:{}", "1".repeat(64)),
            expectation: ReceiptExpectation {
                gate: AcceptanceGateDefinition::required(
                    GateId::new("verification"),
                    GateKind::Verification,
                )
                .with_command(CommandSpec::new(
                    "./check",
                    vec!["./check".to_owned(), "--json".to_owned()],
                )),
                work_id: WorkId::new("work-1"),
                attempt_id: AttemptId::new("attempt-1"),
                fence: Fence::new(1),
                source_snapshot_hash: SourceVersionId::new("source-1"),
                config_identity: ConfigIdentity::new("config-1"),
                profile_id: ProfileId::new("focused"),
                profile_version: "1".to_owned(),
            },
            cwd: "/workspace/project".to_owned(),
            environment_fingerprint: "env-1".to_owned(),
            attestation: ExecutorAttestation::BorealWitnessed,
        }
    }

    fn execution(outcome: EvidenceExecutionOutcome) -> BoundedExecutionResult {
        BoundedExecutionResult {
            outcome,
            exit_code: match outcome {
                EvidenceExecutionOutcome::Passed => Some(0),
                EvidenceExecutionOutcome::Failed => Some(2),
                EvidenceExecutionOutcome::TimedOut | EvidenceExecutionOutcome::Uncertain => None,
            },
            started_at: TimestampMs::from_millis(10),
            ended_at: TimestampMs::from_millis(11),
            output_size_bytes: 12,
            output_digest: Some("sha256:output".to_owned()),
            output_ref: None,
            observables: vec!["verification".to_owned()],
        }
    }

    #[test]
    fn bounded_runner_freezes_declared_command_and_provenance() {
        let result = build_bounded_evidence_receipt(
            &run_request(),
            &execution(EvidenceExecutionOutcome::Passed),
        )
        .unwrap();
        assert!(result.is_passed());
        assert_eq!(result.receipt.argv, vec!["./check", "--json"]);
        assert_eq!(result.receipt.work_id, WorkId::new("work-1"));
        assert_eq!(
            result.receipt.operation_id,
            OperationId::new("operation-run")
        );
        assert_eq!(result.receipt.result, ReceiptResult::Passed);
    }

    #[test]
    fn bounded_runner_retains_timeout_as_failed_and_rejects_oversized_output() {
        let timeout = build_bounded_evidence_receipt(
            &run_request(),
            &execution(EvidenceExecutionOutcome::TimedOut),
        )
        .unwrap();
        assert_eq!(timeout.outcome, EvidenceExecutionOutcome::TimedOut);
        assert_eq!(timeout.receipt.result, ReceiptResult::Failed);

        let mut oversized = execution(EvidenceExecutionOutcome::Passed);
        oversized.output_size_bytes = MAX_OUTPUT_BYTES + 1;
        assert_eq!(
            build_bounded_evidence_receipt(&run_request(), &oversized)
                .unwrap_err()
                .code_str(),
            "output_oversized"
        );
    }

    #[test]
    fn bounded_runner_rejects_undeclared_or_inconsistent_execution() {
        let mut request = run_request();
        request.expectation.gate.command = None;
        assert_eq!(
            build_bounded_evidence_receipt(&request, &execution(EvidenceExecutionOutcome::Passed))
                .unwrap_err()
                .code_str(),
            "command_not_declared"
        );

        let mut invalid = execution(EvidenceExecutionOutcome::Passed);
        invalid.exit_code = Some(1);
        assert_eq!(
            build_bounded_evidence_receipt(&run_request(), &invalid)
                .unwrap_err()
                .code_str(),
            "execution_result_invalid"
        );
    }

    #[test]
    fn receipt_matching_is_structured_and_prose_free() {
        let definition = AcceptanceDefinition::focused();
        let gate = definition
            .gates
            .iter()
            .find(|gate| gate.kind == GateKind::Verification)
            .unwrap()
            .clone();
        let expected = ReceiptExpectation {
            work_id: base().work_id.clone(),
            attempt_id: base().attempt_id.clone(),
            fence: base().fence,
            source_snapshot_hash: base().source_snapshot_hash.clone(),
            config_identity: base().config_identity.clone(),
            profile_id: definition.id.clone(),
            profile_version: definition.version.clone(),
            gate,
        };
        assert!(receipt(ReceiptResult::Passed)
            .validate_for(&expected)
            .is_ok());
        let mut changed_prose = receipt(ReceiptResult::Passed);
        changed_prose.cwd = "/another-but-safe-path".to_owned();
        assert!(changed_prose.validate_for(&expected).is_ok());
    }

    #[test]
    fn receipt_mismatches_have_stable_safe_codes_and_messages() {
        let definition = AcceptanceDefinition::focused();
        let gate = definition.gates[1].clone();
        let mut expected = ReceiptExpectation {
            work_id: base().work_id.clone(),
            attempt_id: base().attempt_id.clone(),
            fence: base().fence,
            source_snapshot_hash: base().source_snapshot_hash.clone(),
            config_identity: base().config_identity.clone(),
            profile_id: definition.id.clone(),
            profile_version: definition.version.clone(),
            gate,
        };
        let mut stale = receipt(ReceiptResult::Passed);
        stale.fence = Fence::new(2);
        let error = stale.validate_for(&expected).unwrap_err();
        assert_eq!(error.code_str(), "stale_fence");
        assert!(!error.to_string().contains("attempt-1"));
        expected.gate.command = Some(CommandSpec::new("./declared", vec!["./declared".into()]));
        assert_eq!(
            receipt(ReceiptResult::Passed)
                .validate_for(&expected)
                .unwrap_err()
                .code_str(),
            "receipt_command_mismatch"
        );
    }

    #[test]
    fn acceptance_uses_deterministic_gate_order_and_retains_failures() {
        let definition = AcceptanceDefinition::focused();
        let evaluation =
            evaluate_acceptance(&definition, &[receipt(ReceiptResult::Failed)], &base()).unwrap();
        assert_eq!(evaluation.gates[0].gate_id.as_str(), "checkpoint");
        assert_eq!(evaluation.gates[1].gate_id.as_str(), "summary");
        let verification = evaluation
            .gates
            .iter()
            .find(|gate| gate.kind == GateKind::Verification)
            .unwrap();
        assert_eq!(verification.state, GateState::Failed);
        assert_eq!(verification.receipt_id, Some(ReceiptId::new("receipt-1")));
    }

    fn attempt() -> AttemptSnapshot {
        AttemptSnapshot {
            project_id: boreal_domain::ProjectId::new("project-1"),
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-1"),
            actor_id: ActorId::new("agent-1"),
            harness_id: None,
            session_id: None,
            fence: Fence::new(1),
            phase: AttemptPhase::Verifying,
            claimed_at: TimestampMs::from_millis(1),
            accepted_at: Some(TimestampMs::from_millis(2)),
            lease_deadline: TimestampMs::from_millis(100),
            hard_deadline: TimestampMs::from_millis(200),
            current: true,
        }
    }

    fn summary(definition: &AcceptanceDefinition) -> SummaryPayload {
        SummaryPayload {
            summary_id: "summary-1".to_owned(),
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-1"),
            fence: Fence::new(1),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
            profile_id: definition.id.clone(),
            profile_version: definition.version.clone(),
            body_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000"
                .to_owned(),
            body_size: 10,
        }
    }

    #[test]
    fn close_readiness_requires_intent_and_summary_and_is_sorted() {
        let definition = AcceptanceDefinition::focused();
        let mut input = CloseoutInput {
            definition: definition.clone(),
            work_id: WorkId::new("work-1"),
            attempt: attempt(),
            expected_fence: Fence::new(1),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
            policy_version: "v1".to_owned(),
            receipts: vec![],
            gates: vec![],
            review: None,
            summary: None,
            close_intent: None,
        };
        let not_ready = evaluate_close_readiness(&input).unwrap();
        assert!(!not_ready.is_ready());
        assert_eq!(not_ready.gaps[0].code(), "close_intent_missing");
        input.receipts = passed_receipts(&definition);
        input.gates = definition
            .gates
            .iter()
            .map(|gate| AcceptanceGateResult {
                gate_id: gate.id.clone(),
                kind: gate.kind,
                state: GateState::Satisfied,
                receipt_id: None,
                reason: None,
            })
            .collect();
        input.summary = Some(summary(&definition));
        input.close_intent = Some(CloseIntent {
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-1"),
            fence: Fence::new(1),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
            profile_id: definition.id,
            profile_version: "1".to_owned(),
            summary_id: Some("summary-1".to_owned()),
        });
        assert!(evaluate_close_readiness(&input).unwrap().is_ready());
    }

    #[test]
    fn reviewed_profile_requires_authorized_independent_review() {
        let definition = AcceptanceDefinition::reviewed();
        let expected = ReviewExpectation {
            work_id: WorkId::new("work-1"),
            attempt_id: AttemptId::new("attempt-1"),
            fence: Fence::new(1),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
            policy_version: "v1".to_owned(),
        };
        let review = ReviewDecisionRequest {
            review_id: "review-1".to_owned(),
            work_id: expected.work_id.clone(),
            attempt_id: expected.attempt_id.clone(),
            fence: expected.fence,
            reviewer_actor_id: ActorId::new("agent-1"),
            attempt_actor_id: ActorId::new("agent-1"),
            reviewer_role: ActorRole::Reviewer,
            decision: ReviewDecision::Accepted,
            reason: "checked".to_owned(),
            source_snapshot_hash: expected.source_snapshot_hash.clone(),
            config_identity: expected.config_identity.clone(),
            policy_version: expected.policy_version.clone(),
        };
        assert_eq!(
            validate_review_decision(&review, &definition, &expected)
                .unwrap_err()
                .code_str(),
            "reviewer_cannot_review_own_attempt"
        );
        let mut independent = review;
        independent.reviewer_actor_id = ActorId::new("reviewer-1");
        assert!(validate_review_decision(&independent, &definition, &expected).is_ok());
    }

    #[test]
    fn reviewed_gate_row_cannot_replace_an_independent_review_decision() {
        let definition = AcceptanceDefinition::reviewed();
        let gates = definition
            .gates
            .iter()
            .map(|gate| AcceptanceGateResult {
                gate_id: gate.id.clone(),
                kind: gate.kind,
                state: GateState::Satisfied,
                receipt_id: None,
                reason: None,
            })
            .collect();
        let input = CloseoutInput {
            definition: definition.clone(),
            work_id: WorkId::new("work-1"),
            attempt: attempt(),
            expected_fence: Fence::new(1),
            source_snapshot_hash: SourceVersionId::new("source-1"),
            config_identity: ConfigIdentity::new("config-1"),
            policy_version: "v1".to_owned(),
            receipts: passed_receipts(&definition),
            gates,
            review: None,
            summary: Some(summary(&definition)),
            close_intent: Some(CloseIntent {
                work_id: WorkId::new("work-1"),
                attempt_id: AttemptId::new("attempt-1"),
                fence: Fence::new(1),
                source_snapshot_hash: SourceVersionId::new("source-1"),
                config_identity: ConfigIdentity::new("config-1"),
                profile_id: definition.id.clone(),
                profile_version: definition.version.clone(),
                summary_id: Some("summary-1".to_owned()),
            }),
        };
        let readiness = evaluate_close_readiness(&input).unwrap();
        assert!(readiness
            .gaps
            .contains(&CloseoutGap::ReviewRequired(GateId::new("review"))));
        assert!(!readiness.is_ready());
    }

    #[test]
    fn unsafe_commands_fail_closed_without_echoing_payload() {
        let command = CommandSpec::new("./check;rm", vec!["./check;rm".into()]);
        let error = command.validate().unwrap_err();
        assert_eq!(error.code_str(), "unsafe_command");
        assert!(!error.to_string().contains("rm"));
    }
}
