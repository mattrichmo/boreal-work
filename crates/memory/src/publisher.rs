//! Durable admission/readback adapter for the Git memory publisher.
//!
//! This module is intentionally storage-neutral. The memory crate already
//! owns the serialized Git writer and its publication journal; this adapter
//! owns only the contract that must surround that external effect. A caller
//! may invoke Publisher::publish only from the Won callback and may return
//! Reconciled only after Publisher::publication_readback proves the
//! operation, manifest, note bytes, and Git revision. Registration in
//! lib.rs and the application/store port remain an explicit integration
//! request because the monolithic root is outside this worker's write set.

const MAX_PUBLICATION_IDENTITY_BYTES: usize = 4 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum PublicationJobState {
    Registered,
    Admitted,
    Running,
    SideEffectStarted,
    SideEffectFinished,
    Pending,
    ReadbackRequired,
    Committed,
    Reconciled,
    Rejected,
    Failed,
    CancelRequested,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicationJobRequest {
    pub project_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub entry_id: String,
    pub content_digest: String,
    pub manifest_identity: String,
    pub memory_root_identity: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub source_identity: Option<String>,
    pub config_identity: Option<String>,
    pub deadline: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicationJobRecord {
    pub project_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub entry_id: String,
    pub content_digest: String,
    pub manifest_identity: String,
    pub memory_root_identity: String,
    pub state: PublicationJobState,
    pub side_effect_ref: Option<String>,
    pub git_revision: Option<String>,
    pub result_digest: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PublicationJobReadback {
    pub project_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub entry_id: String,
    pub content_digest: String,
    pub manifest_identity: String,
    pub side_effect_ref: String,
    pub git_revision: String,
    pub result_digest: String,
    pub observed_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PublicationJobObservation {
    Pending,
    ReadbackRequired {
        side_effect_ref: String,
    },
    Reconciled {
        side_effect_ref: String,
        git_revision: String,
        result_digest: String,
        manifest_identity: String,
        observed_at: String,
    },
    Rejected {
        reason: String,
    },
    Failed {
        side_effect_ref: Option<String>,
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PublicationJobAcquisition {
    /// This caller owns the only callback permission for the Git effect.
    Won(PublicationJobRecord),
    /// Another caller owns the running boundary. Never invoke Git here.
    AlreadyRunning(PublicationJobRecord),
    Pending(PublicationJobRecord),
    Terminal(PublicationJobRecord),
    Conflict {
        current: Option<PublicationJobRecord>,
        reason: String,
    },
}

pub trait PublicationJobPort {
    fn register(&self, request: &PublicationJobRequest) -> Result<PublicationJobRecord, String>;
    /// Atomically acquires admitted -> running. Only Won grants the
    /// publication callback permission.
    fn acquire(
        &self,
        request: &PublicationJobRequest,
        started_at: &str,
    ) -> Result<PublicationJobAcquisition, String>;
    fn mark_readback_required(
        &self,
        request: &PublicationJobRequest,
        side_effect_ref: &str,
    ) -> Result<PublicationJobRecord, String>;
    fn readback(&self, request: &PublicationJobRequest) -> Result<PublicationJobRecord, String>;
    fn reconcile(
        &self,
        request: &PublicationJobRequest,
        readback: &PublicationJobReadback,
    ) -> Result<PublicationJobRecord, String>;
    fn reject(
        &self,
        request: &PublicationJobRequest,
        reason: &str,
    ) -> Result<PublicationJobRecord, String>;
    fn fail(
        &self,
        request: &PublicationJobRequest,
        side_effect_ref: Option<&str>,
        reason: &str,
    ) -> Result<PublicationJobRecord, String>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum PublicationJobOutcome {
    Pending(PublicationJobRecord),
    ReadbackRequired(PublicationJobRecord),
    Reconciled(PublicationJobRecord),
    Rejected(PublicationJobRecord),
    Failed(PublicationJobRecord),
}

impl PublicationJobOutcome {
    pub const fn is_resolved(&self) -> bool {
        matches!(self, Self::Reconciled(_))
    }

    pub fn record(&self) -> &PublicationJobRecord {
        match self {
            Self::Pending(record)
            | Self::ReadbackRequired(record)
            | Self::Reconciled(record)
            | Self::Rejected(record)
            | Self::Failed(record) => record,
        }
    }
}

/// Run one publication callback behind durable admission and attributable
/// readback. The callback is invoked exactly once and only for Won.
pub fn run_with_durable_job<J, F>(
    jobs: &J,
    request: &PublicationJobRequest,
    started_at: &str,
    publish: F,
) -> Result<PublicationJobOutcome, String>
where
    J: PublicationJobPort,
    F: FnOnce(&PublicationJobRecord) -> Result<PublicationJobObservation, String>,
{
    request.validate()?;
    validate_identity(started_at, "memory publication start timestamp")?;
    let registered = jobs.register(request)?;
    validate_record_identity(request, &registered)?;
    if registered.state != PublicationJobState::Registered {
        return readback_outcome(jobs, request);
    }

    let running = match jobs.acquire(request, started_at)? {
        PublicationJobAcquisition::Won(record) => {
            validate_record_identity(request, &record)?;
            record
        }
        PublicationJobAcquisition::AlreadyRunning(_)
        | PublicationJobAcquisition::Pending(_)
        | PublicationJobAcquisition::Terminal(_) => return readback_outcome(jobs, request),
        PublicationJobAcquisition::Conflict { reason, .. } => {
            return Err(bounded_error(
                reason,
                "memory publication acquisition conflict",
            ));
        }
    };

    let observation = match publish(&running) {
        Ok(observation) => observation,
        Err(_) => {
            // Git may have committed before the caller observed an error. The
            // original job remains readable; do not create a fresh operation.
            return readback_outcome(jobs, request);
        }
    };
    match observation {
        PublicationJobObservation::Pending => Ok(PublicationJobOutcome::Pending(running)),
        PublicationJobObservation::ReadbackRequired { side_effect_ref } => {
            validate_identity(&side_effect_ref, "memory publication side-effect reference")?;
            jobs.mark_readback_required(request, &side_effect_ref)?;
            readback_outcome(jobs, request)
        }
        PublicationJobObservation::Reconciled {
            side_effect_ref,
            git_revision,
            result_digest,
            manifest_identity,
            observed_at,
        } => {
            let readback = PublicationJobReadback {
                project_id: request.project_id.clone(),
                operation_id: request.operation_id.clone(),
                request_digest: request.request_digest.clone(),
                entry_id: request.entry_id.clone(),
                content_digest: request.content_digest.clone(),
                manifest_identity,
                side_effect_ref,
                git_revision,
                result_digest,
                observed_at,
            };
            validate_readback(request, &readback)?;
            Ok(PublicationJobOutcome::Reconciled(
                jobs.reconcile(request, &readback)?,
            ))
        }
        PublicationJobObservation::Rejected { reason } => {
            validate_identity(&reason, "memory publication rejection reason")?;
            Ok(PublicationJobOutcome::Rejected(
                jobs.reject(request, &reason)?,
            ))
        }
        PublicationJobObservation::Failed {
            side_effect_ref,
            reason,
        } => {
            validate_identity(&reason, "memory publication failure reason")?;
            Ok(PublicationJobOutcome::Failed(jobs.fail(
                request,
                side_effect_ref.as_deref(),
                &reason,
            )?))
        }
    }
}

impl PublicationJobRequest {
    fn validate(&self) -> Result<(), String> {
        for (value, label) in [
            (&self.project_id, "memory publication project identity"),
            (&self.operation_id, "memory publication operation identity"),
            (&self.request_digest, "memory publication request digest"),
            (&self.entry_id, "memory publication entry identity"),
            (&self.content_digest, "memory publication content digest"),
            (
                &self.manifest_identity,
                "memory publication manifest identity",
            ),
            (
                &self.memory_root_identity,
                "memory publication root identity",
            ),
            (&self.actor_id, "memory publication actor identity"),
            (&self.created_at, "memory publication creation timestamp"),
        ] {
            validate_identity(value, label)?;
        }
        for (value, label) in [
            (
                self.session_id.as_ref(),
                "memory publication session identity",
            ),
            (
                self.source_identity.as_ref(),
                "memory publication source identity",
            ),
            (
                self.config_identity.as_ref(),
                "memory publication configuration identity",
            ),
            (self.deadline.as_ref(), "memory publication deadline"),
        ] {
            if let Some(value) = value {
                validate_identity(value, label)?;
            }
        }
        Ok(())
    }
}

fn readback_outcome<J: PublicationJobPort>(
    jobs: &J,
    request: &PublicationJobRequest,
) -> Result<PublicationJobOutcome, String> {
    let record = jobs.readback(request)?;
    validate_record_identity(request, &record)?;
    Ok(outcome_from_record(record))
}

fn validate_record_identity(
    request: &PublicationJobRequest,
    record: &PublicationJobRecord,
) -> Result<(), String> {
    if record.project_id != request.project_id
        || record.operation_id != request.operation_id
        || record.request_digest != request.request_digest
        || record.entry_id != request.entry_id
        || record.content_digest != request.content_digest
        || record.manifest_identity != request.manifest_identity
        || record.memory_root_identity != request.memory_root_identity
    {
        return Err(
            "memory publication readback identity does not match the admitted request".to_owned(),
        );
    }
    Ok(())
}

fn validate_readback(
    request: &PublicationJobRequest,
    readback: &PublicationJobReadback,
) -> Result<(), String> {
    for (value, label) in [
        (&readback.project_id, "memory readback project identity"),
        (&readback.operation_id, "memory readback operation identity"),
        (&readback.request_digest, "memory readback request digest"),
        (&readback.entry_id, "memory readback entry identity"),
        (&readback.content_digest, "memory readback content digest"),
        (
            &readback.manifest_identity,
            "memory readback manifest identity",
        ),
        (
            &readback.side_effect_ref,
            "memory readback side-effect reference",
        ),
        (&readback.git_revision, "memory readback Git revision"),
        (&readback.result_digest, "memory readback result digest"),
        (&readback.observed_at, "memory readback timestamp"),
    ] {
        validate_identity(value, label)?;
    }
    if readback.project_id != request.project_id
        || readback.operation_id != request.operation_id
        || readback.request_digest != request.request_digest
        || readback.entry_id != request.entry_id
        || readback.content_digest != request.content_digest
        || readback.manifest_identity != request.manifest_identity
    {
        return Err(
            "memory publication readback identity does not match the admitted request".to_owned(),
        );
    }
    Ok(())
}

fn outcome_from_record(record: PublicationJobRecord) -> PublicationJobOutcome {
    match record.state {
        PublicationJobState::Reconciled => PublicationJobOutcome::Reconciled(record),
        PublicationJobState::ReadbackRequired
        | PublicationJobState::Running
        | PublicationJobState::SideEffectStarted
        | PublicationJobState::SideEffectFinished
        | PublicationJobState::Committed => PublicationJobOutcome::ReadbackRequired(record),
        PublicationJobState::Pending
        | PublicationJobState::Registered
        | PublicationJobState::Admitted => PublicationJobOutcome::Pending(record),
        PublicationJobState::Rejected => PublicationJobOutcome::Rejected(record),
        PublicationJobState::Failed | PublicationJobState::CancelRequested => {
            PublicationJobOutcome::Failed(record)
        }
    }
}

fn validate_identity(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().any(char::is_control) {
        return Err(format!("{label} must not be empty"));
    }
    if value.len() > MAX_PUBLICATION_IDENTITY_BYTES {
        return Err(format!(
            "{label} exceeds {MAX_PUBLICATION_IDENTITY_BYTES} bytes"
        ));
    }
    Ok(())
}

fn bounded_error(message: String, label: &str) -> String {
    let original_len = message.len();
    let mut bounded = message
        .chars()
        .take(MAX_PUBLICATION_IDENTITY_BYTES)
        .collect::<String>();
    if bounded.len() < original_len {
        bounded.push('…');
    }
    if bounded.is_empty() {
        label.to_owned()
    } else {
        format!("{label}: {bounded}")
    }
}
