//! Machine update adapter for release-installed Boreal binaries.
//!
//! The release archive carries the same verified installer used for the
//! initial install. Keeping the update operation here means users can run
//! `bwrk update` (or the v1-compatible `bwrk upgrade --machine`) without
//! remembering a curl command, while the installer remains responsible for
//! archive verification and atomic replacement.

use super::ParsedCommand;
use boreal_application::sha256_content_digest;
use serde::{Deserialize, Serialize};
use std::{env, path::PathBuf, process::Command};

const MAX_UPDATE_IDENTITY_BYTES: usize = 4 * 1024;

/// Durable stages for the per-installation update journal. `Running` is an
/// intent/readback boundary only; the caller that atomically wins
/// `acquire_machine_update` is the sole caller allowed to start the updater.
/// A later read of this label never grants another callback permission.
#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum MachineUpdateStage {
    Registered,
    Running,
    ReadbackRequired,
    Reconciled,
    Rejected,
}

impl MachineUpdateStage {
    pub(crate) const fn as_str(self) -> &'static str {
        match self {
            Self::Registered => "registered",
            Self::Running => "running",
            Self::ReadbackRequired => "readback_required",
            Self::Reconciled => "reconciled",
            Self::Rejected => "rejected",
        }
    }

    pub(crate) const fn is_terminal(self) -> bool {
        matches!(self, Self::Reconciled | Self::Rejected)
    }
}

/// Machine-scoped identity recorded beside the installation it updates.
/// Global fields are optional until the paired backup/maintenance integration
/// supplies read-only source metadata and a committed backup reference.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub(crate) struct MachineUpdateRecord {
    pub format: String,
    pub operation_id: String,
    pub request_digest: String,
    pub prefix: String,
    pub source_package_identity: String,
    /// Immutable release manifest identity selected before package mutation.
    pub target_package_identity: String,
    pub target_version: String,
    pub global_root: Option<String>,
    pub source_schema: Option<String>,
    pub source_revision: Option<u64>,
    pub backup_ref: Option<String>,
    pub stage: MachineUpdateStage,
    pub side_effect_ref: Option<String>,
    pub observed_package_identity: Option<String>,
    pub version: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum MachineUpdateAcquisition {
    /// This atomic transition grants the only invocation permission.
    Won(MachineUpdateRecord),
    /// Existing work is returned for readback only. It never grants replay.
    Existing(MachineUpdateRecord),
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MachineUpdateRun {
    pub record: MachineUpdateRecord,
    pub invoked: bool,
    pub execution_error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct MachineUpdateTarget {
    pub artifact_identity: String,
    pub version: String,
}

pub(crate) trait MachineUpdateJournalPort {
    fn register_machine_update(
        &self,
        record: &MachineUpdateRecord,
    ) -> Result<MachineUpdateRecord, String>;
    fn acquire_machine_update(
        &self,
        operation_id: &str,
        request_digest: &str,
        side_effect_ref: &str,
        updated_at: &str,
    ) -> Result<MachineUpdateAcquisition, String>;
    fn mark_machine_readback_required(
        &self,
        operation_id: &str,
        request_digest: &str,
        updated_at: &str,
    ) -> Result<MachineUpdateRecord, String>;
    fn reconcile_machine_update(
        &self,
        operation_id: &str,
        request_digest: &str,
        observed_package_identity: &str,
        version: &str,
        updated_at: &str,
    ) -> Result<MachineUpdateRecord, String>;
    fn reject_machine_update(
        &self,
        operation_id: &str,
        request_digest: &str,
        reason: &str,
        updated_at: &str,
    ) -> Result<MachineUpdateRecord, String>;
    fn read_machine_update(
        &self,
        operation_id: &str,
        request_digest: &str,
    ) -> Result<MachineUpdateRecord, String>;
}

/// Persist registration, acquire the unique callback permission, and force
/// every non-winning retry through durable readback. Storage adapters own the
/// atomic compare-and-transition and must return `Won` only for that caller.
pub(crate) fn acquire_machine_update<J: MachineUpdateJournalPort>(
    journal: &J,
    record: &MachineUpdateRecord,
    side_effect_ref: &str,
    updated_at: &str,
) -> Result<MachineUpdateAcquisition, String> {
    validate_machine_update_record(record)?;
    validate_identity(side_effect_ref, "machine update side-effect reference")?;
    validate_identity(updated_at, "machine update timestamp")?;
    let registered = journal.register_machine_update(record)?;
    validate_machine_record_identity(record, &registered)?;
    if registered.stage != MachineUpdateStage::Registered {
        return Ok(MachineUpdateAcquisition::Existing(registered));
    }
    journal.acquire_machine_update(
        &record.operation_id,
        &record.request_digest,
        side_effect_ref,
        updated_at,
    )
}

/// Invoke the updater only after the journal adapter atomically grants the
/// initial winner. All replays return the durable record for readback without
/// invoking the closure. The readback-required stage is synced before the
/// external callback begins, so interruption cannot turn a stage label into
/// permission to replay.
pub(crate) fn run_machine_update_once<J, F>(
    journal: &J,
    record: &MachineUpdateRecord,
    side_effect_ref: &str,
    updated_at: &str,
    execute: F,
) -> Result<MachineUpdateRun, String>
where
    J: MachineUpdateJournalPort,
    F: FnOnce(&MachineUpdateRecord) -> Result<(), String>,
{
    match acquire_machine_update(journal, record, side_effect_ref, updated_at)? {
        MachineUpdateAcquisition::Won(running) => {
            journal.mark_machine_readback_required(
                &running.operation_id,
                &running.request_digest,
                updated_at,
            )?;
            let execution_error = execute(&running).err();
            let durable =
                journal.read_machine_update(&running.operation_id, &running.request_digest)?;
            validate_machine_record_identity(&running, &durable)?;
            Ok(MachineUpdateRun {
                record: durable,
                invoked: true,
                execution_error,
            })
        }
        MachineUpdateAcquisition::Existing(existing) => {
            let durable =
                journal.read_machine_update(&existing.operation_id, &existing.request_digest)?;
            validate_machine_record_identity(&existing, &durable)?;
            Ok(MachineUpdateRun {
                record: durable,
                invoked: false,
                execution_error: None,
            })
        }
    }
}

pub(crate) fn validate_machine_update_record(record: &MachineUpdateRecord) -> Result<(), String> {
    for (value, label) in [
        (&record.format, "machine update journal format"),
        (&record.operation_id, "machine update operation identity"),
        (&record.request_digest, "machine update request digest"),
        (&record.prefix, "machine update prefix"),
        (
            &record.source_package_identity,
            "machine update source package identity",
        ),
        (
            &record.target_package_identity,
            "machine update target package identity",
        ),
        (&record.target_version, "machine update target version"),
        (&record.created_at, "machine update creation timestamp"),
        (&record.updated_at, "machine update timestamp"),
    ] {
        validate_identity(value, label)?;
    }
    for (value, label) in [
        (record.global_root.as_ref(), "machine update Global root"),
        (
            record.source_schema.as_ref(),
            "machine update source schema",
        ),
        (
            record.backup_ref.as_ref(),
            "machine update backup reference",
        ),
        (
            record.side_effect_ref.as_ref(),
            "machine update side-effect reference",
        ),
        (
            record.observed_package_identity.as_ref(),
            "machine update observed package identity",
        ),
        (record.version.as_ref(), "machine update version"),
        (record.error.as_ref(), "machine update error"),
    ] {
        if let Some(value) = value {
            validate_identity(value, label)?;
        }
    }
    Ok(())
}

pub(crate) fn machine_update_side_effect_ref(record: &MachineUpdateRecord) -> String {
    let identity = format!(
        "{}\0{}\0{}\0{}",
        record.prefix, record.operation_id, record.request_digest, record.source_package_identity
    );
    format!("installer:{}", sha256_content_digest(identity.as_bytes()))
}

/// Invoke the updater shipped inside the selected installation. The caller
/// must first win the machine journal's atomic acquisition and persist its
/// side-effect reference. The exit status alone is never treated as proof of
/// package activation; callers must perform verified package readback.
pub(crate) fn run_machine_installer(prefix: &std::path::Path, version: &str) -> Result<(), String> {
    let installer = prefix.join("share/boreal/install.sh");
    if !installer.is_file() {
        if prefix.to_string_lossy().contains("/Cellar/") {
            return Err(
                "this bwrk installation is managed by Homebrew; run `brew upgrade boreal`"
                    .to_owned(),
            );
        }
        return Err(format!(
            "this bwrk installation does not include its updater ({})",
            installer.display()
        ));
    }
    let status = Command::new("sh")
        .arg(&installer)
        .arg("--prefix")
        .arg(prefix)
        // Pin the installer to the release manifest whose immutable artifact
        // identity was written into the journal before this side effect.
        .env("BOREAL_VERSION", version)
        .status()
        .map_err(|error| format!("could not start the Boreal updater: {error}"))?;
    if !status.success() {
        return Err(format!(
            "the Boreal updater exited with {}; package activation requires readback",
            status
                .code()
                .map_or_else(|| "a signal".to_owned(), |code| code.to_string())
        ));
    }
    Ok(())
}

/// Resolve and verify the exact target package manifest before the updater is
/// invoked. The installer still verifies the archive against SHA256SUMS; this
/// preflight binds the journal and installer to one release version.
pub(crate) fn latest_machine_update_target(target: &str) -> Result<MachineUpdateTarget, String> {
    validate_identity(target, "machine update release target")?;
    let repository = env!("CARGO_PKG_REPOSITORY")
        .strip_prefix("https://github.com/")
        .filter(|value| {
            let mut parts = value.trim_end_matches(".git").split('/');
            parts.next().is_some_and(|part| !part.is_empty())
                && parts.next().is_some_and(|part| !part.is_empty())
                && parts.next().is_none()
        })
        .ok_or_else(|| {
            "the package repository is not a supported GitHub release source".to_owned()
        })?
        .trim_end_matches(".git");
    let latest_url = format!("https://github.com/{repository}/releases/latest");
    let latest = Command::new("curl")
        .args(["-fsSL", "-o", "/dev/null", "-w", "%{url_effective}"])
        .arg(&latest_url)
        .output()
        .map_err(|error| format!("could not resolve the latest Boreal release: {error}"))?;
    if !latest.status.success() {
        return Err(format!(
            "could not resolve the latest Boreal release: {}",
            bounded_process_error(&latest.stderr)
        ));
    }
    let latest_url = String::from_utf8(latest.stdout)
        .map_err(|_| "latest release URL was not valid UTF-8".to_owned())?;
    let tag_prefix = format!("https://github.com/{repository}/releases/tag/");
    let tag = latest_url
        .trim()
        .strip_prefix(&tag_prefix)
        .filter(|tag| !tag.is_empty() && !tag.contains('/'))
        .ok_or_else(|| "latest release URL did not resolve to a Boreal version tag".to_owned())?;
    let version = tag.strip_prefix('v').unwrap_or(tag);
    if version.len() > 128
        || !version
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'+' | b'-'))
        || !version.bytes().any(|byte| byte.is_ascii_digit())
    {
        return Err("latest release tag is not a safe version identity".to_owned());
    }
    let manifest_name = format!("bwrk-v{version}-{target}.release.json");
    let manifest_url =
        format!("https://github.com/{repository}/releases/download/v{version}/{manifest_name}");
    let manifest = Command::new("curl")
        .args(["-fsSL", "--max-filesize", "16777216"])
        .arg(&manifest_url)
        .output()
        .map_err(|error| format!("could not read target release manifest: {error}"))?;
    if !manifest.status.success() {
        return Err(format!(
            "could not read target release manifest: {}",
            bounded_process_error(&manifest.stderr)
        ));
    }
    if manifest.stdout.len() > 16 * 1024 * 1024 {
        return Err("target release manifest exceeds the size limit".to_owned());
    }
    let (artifact_identity, observed_target, observed_version) =
        verified_release_manifest_identity(&manifest.stdout)?;
    if observed_target != target || observed_version != version {
        return Err(
            "target release manifest identity does not match the selected release".to_owned(),
        );
    }
    Ok(MachineUpdateTarget {
        artifact_identity,
        version: observed_version,
    })
}

pub(crate) fn verified_release_manifest_identity(
    bytes: &[u8],
) -> Result<(String, String, String), String> {
    let manifest: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| format!("release manifest is invalid: {error}"))?;
    if manifest
        .get("manifest_version")
        .and_then(serde_json::Value::as_str)
        != Some("boreal.binary_release.v1")
    {
        return Err("release manifest version is unsupported".to_owned());
    }
    let artifact_identity = manifest
        .get("artifact_identity")
        .and_then(serde_json::Value::as_str)
        .filter(|identity| is_sha256_identity(identity))
        .ok_or_else(|| "release manifest identity is missing or invalid".to_owned())?;
    let mut basis = manifest.clone();
    basis
        .as_object_mut()
        .ok_or_else(|| "release manifest is not an object".to_owned())?
        .remove("artifact_identity");
    let mut canonical = serde_json::to_vec(&basis)
        .map_err(|error| format!("could not canonicalize release manifest: {error}"))?;
    canonical.push(b'\n');
    if sha256_content_digest(&canonical) != artifact_identity {
        return Err("release manifest identity does not verify".to_owned());
    }
    let target = manifest
        .get("target")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "release manifest has no target identity".to_owned())?;
    let version = manifest
        .get("version")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "release manifest has no version".to_owned())?;
    Ok((
        artifact_identity.to_owned(),
        target.to_owned(),
        version.to_owned(),
    ))
}

fn is_sha256_identity(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn bounded_process_error(bytes: &[u8]) -> String {
    let message = String::from_utf8_lossy(bytes);
    let bounded = message
        .chars()
        .take(MAX_UPDATE_IDENTITY_BYTES)
        .collect::<String>();
    if bounded.trim().is_empty() {
        "release server returned an unsuccessful status".to_owned()
    } else {
        bounded
    }
}

fn validate_machine_record_identity(
    request: &MachineUpdateRecord,
    current: &MachineUpdateRecord,
) -> Result<(), String> {
    if current.format != request.format
        || current.operation_id != request.operation_id
        || current.request_digest != request.request_digest
        || current.prefix != request.prefix
        || current.source_package_identity != request.source_package_identity
        || current.target_package_identity != request.target_package_identity
        || current.target_version != request.target_version
    {
        return Err(
            "machine update journal identity does not match the requested operation".into(),
        );
    }
    Ok(())
}

/// These public spellings update the running Boreal installation, so they
/// must be dispatched before project context is discovered or authenticated.
pub(crate) fn is_machine_route(parsed: &ParsedCommand) -> bool {
    (parsed.path.as_slice() == ["update"]
        || parsed.path.as_slice() == ["update", "status"]
        || parsed.path.as_slice() == ["update", "recover"])
        || (parsed.path.as_slice() == ["upgrade"] && parsed.options.machine)
}

/// Explicit project/service selectors have no meaning for a machine update
/// and could otherwise make its authority depend on the caller's cwd.
pub(crate) fn explicit_authority_selector(args: &[String]) -> Option<&'static str> {
    [
        "--project",
        "--db",
        "--socket",
        "--project-root",
        "--install-root",
    ]
    .into_iter()
    .find(|selector| {
        args.iter().any(|argument| {
            argument == selector
                || argument
                    .strip_prefix(selector)
                    .is_some_and(|suffix| suffix.starts_with('='))
        })
    })
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum UpdateJobState {
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
pub(crate) struct UpdateJobRequest {
    pub project_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub target_identity: String,
    pub actor_id: String,
    pub session_id: Option<String>,
    pub source_identity: Option<String>,
    pub config_identity: Option<String>,
    pub deadline: Option<String>,
    pub created_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UpdateJobRecord {
    pub project_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub target_identity: String,
    pub state: UpdateJobState,
    pub version: Option<String>,
    pub side_effect_ref: Option<String>,
    pub result_digest: Option<String>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum UpdateJobObservation {
    ReadbackRequired {
        side_effect_ref: String,
    },
    Reconciled {
        side_effect_ref: String,
        result_digest: String,
        version: String,
        observed_at: String,
    },
    Rejected {
        reason: String,
    },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum UpdateJobAcquisition {
    /// This caller owns the only callback permission for the admitted job.
    Won(UpdateJobRecord),
    /// Another caller already crossed the running boundary.  This result is
    /// never permission to invoke the installer.
    AlreadyRunning(UpdateJobRecord),
    Pending(UpdateJobRecord),
    Terminal(UpdateJobRecord),
    Conflict {
        current: Option<UpdateJobRecord>,
        reason: String,
    },
}

pub(crate) trait UpdateJobPort {
    fn register(&self, request: &UpdateJobRequest) -> Result<UpdateJobRecord, String>;
    /// Atomically acquires `admitted -> running`.  Only `Won` grants the
    /// external callback permission; a label such as `running` is not enough.
    fn acquire(
        &self,
        request: &UpdateJobRequest,
        started_at: &str,
    ) -> Result<UpdateJobAcquisition, String>;
    fn mark_readback_required(
        &self,
        request: &UpdateJobRequest,
        side_effect_ref: &str,
    ) -> Result<UpdateJobRecord, String>;
    fn readback(&self, request: &UpdateJobRequest) -> Result<UpdateJobRecord, String>;
    fn reconcile(
        &self,
        request: &UpdateJobRequest,
        readback: &UpdateJobReadback,
    ) -> Result<UpdateJobRecord, String>;
    fn reject(&self, request: &UpdateJobRequest, reason: &str) -> Result<UpdateJobRecord, String>;
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct UpdateJobReadback {
    pub project_id: String,
    pub operation_id: String,
    pub request_digest: String,
    pub side_effect_ref: String,
    pub result_digest: String,
    pub version: String,
    pub observed_at: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum UpdateJobOutcome {
    Pending(UpdateJobRecord),
    ReadbackRequired(UpdateJobRecord),
    Reconciled(UpdateJobRecord),
    Rejected(UpdateJobRecord),
    Failed(UpdateJobRecord),
}

impl UpdateJobOutcome {
    pub(crate) const fn is_resolved(&self) -> bool {
        matches!(self, Self::Reconciled(_))
    }

    pub(crate) fn record(&self) -> &UpdateJobRecord {
        match self {
            Self::Pending(record)
            | Self::ReadbackRequired(record)
            | Self::Reconciled(record)
            | Self::Rejected(record)
            | Self::Failed(record) => record,
        }
    }
}

/// Execute an update only after the application/store has admitted its
/// operation and this caller has won the durable `admitted -> running`
/// transition. Exact replay and every non-winning acquisition are read back by
/// the original operation identity; they never invoke the installer again.
pub(crate) fn run_with_durable_job<J, F>(
    jobs: &J,
    request: &UpdateJobRequest,
    started_at: &str,
    execute: F,
) -> Result<UpdateJobOutcome, String>
where
    J: UpdateJobPort,
    F: FnOnce(&UpdateJobRecord) -> Result<UpdateJobObservation, String>,
{
    request.validate()?;
    validate_identity(started_at, "update start timestamp")?;
    let admitted = jobs.register(request)?;
    validate_record_identity(request, &admitted)?;
    if admitted.state != UpdateJobState::Registered {
        return readback_outcome(jobs, request);
    }
    let running = match jobs.acquire(request, started_at)? {
        UpdateJobAcquisition::Won(record) => {
            validate_record_identity(request, &record)?;
            record
        }
        UpdateJobAcquisition::AlreadyRunning(_)
        | UpdateJobAcquisition::Pending(_)
        | UpdateJobAcquisition::Terminal(_) => return readback_outcome(jobs, request),
        UpdateJobAcquisition::Conflict { reason, .. } => {
            return Err(bounded_error(reason, "update acquisition conflict"));
        }
    };
    let observation = match execute(&running) {
        Ok(observation) => observation,
        Err(_) => {
            // A callback error is not evidence that the installer did not
            // take effect. Preserve the durable running record for original
            // operation readback instead of guessing failed or retrying.
            return readback_outcome(jobs, request);
        }
    };
    match observation {
        UpdateJobObservation::ReadbackRequired { side_effect_ref } => {
            validate_identity(&side_effect_ref, "update side-effect reference")?;
            jobs.mark_readback_required(request, &side_effect_ref)?;
            readback_outcome(jobs, request)
        }
        UpdateJobObservation::Reconciled {
            side_effect_ref,
            result_digest,
            version,
            observed_at,
        } => {
            validate_identity(&side_effect_ref, "update side-effect reference")?;
            validate_identity(&result_digest, "update result digest")?;
            validate_identity(&version, "updated version")?;
            validate_identity(&observed_at, "update readback timestamp")?;
            let readback = UpdateJobReadback {
                project_id: request.project_id.clone(),
                operation_id: request.operation_id.clone(),
                request_digest: request.request_digest.clone(),
                side_effect_ref,
                result_digest,
                version,
                observed_at,
            };
            validate_readback(request, &readback)?;
            Ok(UpdateJobOutcome::Reconciled(
                jobs.reconcile(request, &readback)?,
            ))
        }
        UpdateJobObservation::Rejected { reason } => {
            validate_identity(&reason, "update rejection reason")?;
            Ok(UpdateJobOutcome::Rejected(jobs.reject(request, &reason)?))
        }
    }
}

fn readback_outcome<J: UpdateJobPort>(
    jobs: &J,
    request: &UpdateJobRequest,
) -> Result<UpdateJobOutcome, String> {
    let record = jobs.readback(request)?;
    validate_record_identity(request, &record)?;
    Ok(outcome_from_record(record))
}

impl UpdateJobRequest {
    fn validate(&self) -> Result<(), String> {
        for (value, label) in [
            (&self.project_id, "update project identity"),
            (&self.operation_id, "update operation identity"),
            (&self.request_digest, "update request digest"),
            (&self.target_identity, "update target identity"),
            (&self.actor_id, "update actor identity"),
            (&self.created_at, "update creation timestamp"),
        ] {
            validate_identity(value, label)?;
        }
        for (value, label) in [
            (self.session_id.as_ref(), "update session identity"),
            (self.source_identity.as_ref(), "update source identity"),
            (
                self.config_identity.as_ref(),
                "update configuration identity",
            ),
            (self.deadline.as_ref(), "update deadline"),
        ] {
            if let Some(value) = value {
                validate_identity(value, label)?;
            }
        }
        Ok(())
    }
}

fn validate_identity(value: &str, label: &str) -> Result<(), String> {
    if value.trim().is_empty() || value.chars().any(char::is_control) {
        return Err(format!("{label} must not be empty"));
    }
    if value.len() > MAX_UPDATE_IDENTITY_BYTES {
        return Err(format!("{label} exceeds {MAX_UPDATE_IDENTITY_BYTES} bytes"));
    }
    Ok(())
}

fn validate_record_identity(
    request: &UpdateJobRequest,
    record: &UpdateJobRecord,
) -> Result<(), String> {
    if record.project_id != request.project_id
        || record.operation_id != request.operation_id
        || record.request_digest != request.request_digest
        || record.target_identity != request.target_identity
    {
        return Err("update job readback identity does not match the admitted request".to_owned());
    }
    Ok(())
}

fn validate_readback(
    request: &UpdateJobRequest,
    readback: &UpdateJobReadback,
) -> Result<(), String> {
    for (value, label) in [
        (&readback.project_id, "update readback project identity"),
        (&readback.operation_id, "update readback operation identity"),
        (&readback.request_digest, "update readback request digest"),
        (
            &readback.side_effect_ref,
            "update readback side-effect reference",
        ),
        (&readback.result_digest, "update readback result digest"),
        (&readback.version, "update readback version"),
        (&readback.observed_at, "update readback timestamp"),
    ] {
        validate_identity(value, label)?;
    }
    if readback.project_id != request.project_id
        || readback.operation_id != request.operation_id
        || readback.request_digest != request.request_digest
    {
        return Err("update readback identity does not match the admitted request".to_owned());
    }
    Ok(())
}

fn bounded_error(message: String, label: &str) -> String {
    let mut bounded = message
        .chars()
        .take(MAX_UPDATE_IDENTITY_BYTES)
        .collect::<String>();
    if bounded.len() < message.len() {
        bounded.push('…');
    }
    if bounded.is_empty() {
        label.to_owned()
    } else {
        format!("{label}: {bounded}")
    }
}

fn outcome_from_record(record: UpdateJobRecord) -> UpdateJobOutcome {
    match record.state {
        UpdateJobState::Reconciled => UpdateJobOutcome::Reconciled(record),
        UpdateJobState::ReadbackRequired
        | UpdateJobState::Running
        | UpdateJobState::SideEffectStarted
        | UpdateJobState::SideEffectFinished
        | UpdateJobState::Committed => UpdateJobOutcome::ReadbackRequired(record),
        UpdateJobState::Pending | UpdateJobState::Registered | UpdateJobState::Admitted => {
            UpdateJobOutcome::Pending(record)
        }
        UpdateJobState::Rejected => UpdateJobOutcome::Rejected(record),
        UpdateJobState::Failed | UpdateJobState::CancelRequested => {
            UpdateJobOutcome::Failed(record)
        }
    }
}

/// Execute the installer only from a caller that has already won the durable
/// update-job acquisition. The canonical CLI caller must pass this function as
/// the job callback and provide project, operation, actor, and request-digest
/// context.
pub(crate) fn execute_installer(
    _parsed: &ParsedCommand,
    running: &UpdateJobRecord,
) -> Result<UpdateJobObservation, String> {
    let executable = env::current_exe()
        .map_err(|error| format!("could not locate the running bwrk executable: {error}"))?;
    let executable = executable.canonicalize().unwrap_or(executable);
    let prefix = executable
        .parent()
        .and_then(|bin| bin.parent())
        .map(PathBuf::from)
        .ok_or_else(|| "could not determine the Boreal installation prefix".to_owned())?;
    let installer = prefix.join("share/boreal/install.sh");
    if !installer.is_file() {
        if executable.to_string_lossy().contains("/Cellar/") {
            return Ok(UpdateJobObservation::Rejected {
                reason: "this bwrk installation is managed by Homebrew; run `brew upgrade boreal`"
                    .to_owned(),
            });
        }
        return Ok(UpdateJobObservation::Rejected {
            reason: format!(
                "this bwrk installation does not include its updater ({}); canonical job integration must read back the original operation before retry",
                installer.display()
            ),
        });
    }

    Command::new("sh")
        .arg(&installer)
        .arg("--prefix")
        .arg(&prefix)
        .status()
        .map_err(|error| format!("could not start the Boreal updater: {error}"))?;

    // Installer stdout is process output, not an attributable post-install
    // artifact readback. Even a zero exit status therefore remains unresolved
    // until the canonical caller reads the installed manifest/binary identity
    // and returns `UpdateJobObservation::Reconciled` through the job port.
    Ok(UpdateJobObservation::ReadbackRequired {
        side_effect_ref: installer_side_effect_ref(running),
    })
}

fn installer_side_effect_ref(running: &UpdateJobRecord) -> String {
    format!(
        "installer:{}",
        sha256_content_digest(running.target_identity.as_bytes())
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    struct FakeJobs {
        record: RefCell<UpdateJobRecord>,
        events: RefCell<Vec<&'static str>>,
        acquisition: RefCell<Option<UpdateJobAcquisition>>,
    }

    impl FakeJobs {
        fn new(state: UpdateJobState) -> Self {
            Self {
                record: RefCell::new(UpdateJobRecord {
                    project_id: "project-update".to_owned(),
                    operation_id: "op-update".to_owned(),
                    request_digest: "sha256:update".to_owned(),
                    target_identity: "target-binary".to_owned(),
                    state,
                    version: None,
                    side_effect_ref: None,
                    result_digest: None,
                    error: None,
                }),
                events: RefCell::new(Vec::new()),
                acquisition: RefCell::new(None),
            }
        }

        fn snapshot(&self) -> UpdateJobRecord {
            self.record.borrow().clone()
        }
    }

    impl UpdateJobPort for FakeJobs {
        fn register(&self, request: &UpdateJobRequest) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("register");
            let record = self.snapshot();
            if record.project_id != request.project_id
                || record.operation_id != request.operation_id
                || record.request_digest != request.request_digest
                || record.target_identity != request.target_identity
            {
                return Err("update identity mismatch".to_owned());
            }
            Ok(record)
        }

        fn acquire(
            &self,
            request: &UpdateJobRequest,
            _started_at: &str,
        ) -> Result<UpdateJobAcquisition, String> {
            self.events.borrow_mut().push("acquire");
            if let Some(acquisition) = self.acquisition.borrow_mut().take() {
                if let UpdateJobAcquisition::AlreadyRunning(record) = &acquisition {
                    *self.record.borrow_mut() = record.clone();
                }
                return Ok(acquisition);
            }
            let mut record = self.record.borrow_mut();
            if record.operation_id != request.operation_id {
                return Err("update operation mismatch".to_owned());
            }
            record.state = UpdateJobState::Running;
            Ok(UpdateJobAcquisition::Won(record.clone()))
        }

        fn mark_readback_required(
            &self,
            request: &UpdateJobRequest,
            side_effect_ref: &str,
        ) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("mark_readback");
            let mut record = self.record.borrow_mut();
            if record.operation_id != request.operation_id {
                return Err("update operation mismatch".to_owned());
            }
            record.state = UpdateJobState::ReadbackRequired;
            record.side_effect_ref = Some(side_effect_ref.to_owned());
            Ok(record.clone())
        }

        fn readback(&self, request: &UpdateJobRequest) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("readback");
            let record = self.record.borrow();
            if record.operation_id != request.operation_id {
                return Err("update operation mismatch".to_owned());
            }
            Ok(record.clone())
        }

        fn reconcile(
            &self,
            request: &UpdateJobRequest,
            readback: &UpdateJobReadback,
        ) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("reconcile");
            let mut record = self.record.borrow_mut();
            if record.operation_id != request.operation_id {
                return Err("update operation mismatch".to_owned());
            }
            record.state = UpdateJobState::Reconciled;
            record.side_effect_ref = Some(readback.side_effect_ref.clone());
            record.result_digest = Some(readback.result_digest.clone());
            record.version = Some(readback.version.clone());
            Ok(record.clone())
        }

        fn reject(
            &self,
            request: &UpdateJobRequest,
            reason: &str,
        ) -> Result<UpdateJobRecord, String> {
            self.events.borrow_mut().push("reject");
            let mut record = self.record.borrow_mut();
            if record.operation_id != request.operation_id {
                return Err("update operation mismatch".to_owned());
            }
            record.state = UpdateJobState::Rejected;
            record.error = Some(reason.to_owned());
            Ok(record.clone())
        }
    }

    fn request() -> UpdateJobRequest {
        UpdateJobRequest {
            project_id: "project-update".to_owned(),
            operation_id: "op-update".to_owned(),
            request_digest: "sha256:update".to_owned(),
            target_identity: "target-binary".to_owned(),
            actor_id: "actor-update".to_owned(),
            session_id: Some("session-update".to_owned()),
            source_identity: Some("sha256:source".to_owned()),
            config_identity: Some("sha256:config".to_owned()),
            deadline: Some("unix-ms:100".to_owned()),
            created_at: "unix-ms:1".to_owned(),
        }
    }

    #[test]
    fn update_job_registers_and_leaves_pending_before_claiming_success() {
        let jobs = FakeJobs::new(UpdateJobState::Admitted);
        let outcome = run_with_durable_job(&jobs, &request(), "unix-ms:2", |_| {
            panic!("a persisted pending update must not invoke the installer")
        })
        .expect("pending update");

        assert!(matches!(outcome, UpdateJobOutcome::Pending(_)));
        assert!(!outcome.is_resolved());
        assert_eq!(jobs.events.borrow().as_slice(), ["register", "readback"]);
    }

    #[test]
    fn update_job_readback_is_required_after_interrupted_installer() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let outcome = run_with_durable_job(&jobs, &request(), "unix-ms:2", |_| {
            Ok(UpdateJobObservation::ReadbackRequired {
                side_effect_ref: "installer:pid-1".to_owned(),
            })
        })
        .expect("readback-required update");

        assert!(matches!(outcome, UpdateJobOutcome::ReadbackRequired(_)));
        assert!(!outcome.is_resolved());
        assert_eq!(
            jobs.events.borrow().as_slice(),
            ["register", "acquire", "mark_readback", "readback"]
        );
    }

    #[test]
    fn update_job_reconciles_only_from_attributable_installer_readback() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let outcome = run_with_durable_job(&jobs, &request(), "unix-ms:2", |_| {
            Ok(UpdateJobObservation::Reconciled {
                side_effect_ref: "installer:pid-1".to_owned(),
                result_digest: "sha256:installed".to_owned(),
                version: "2.0.0".to_owned(),
                observed_at: "unix-ms:3".to_owned(),
            })
        })
        .expect("reconciled update");

        assert!(outcome.is_resolved());
        assert_eq!(outcome.record().version.as_deref(), Some("2.0.0"));
        assert_eq!(
            jobs.events.borrow().as_slice(),
            ["register", "acquire", "reconcile"]
        );
    }

    #[test]
    fn update_job_rejection_is_durable_and_not_success() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let outcome = run_with_durable_job(&jobs, &request(), "unix-ms:2", |_| {
            Ok(UpdateJobObservation::Rejected {
                reason: "target identity mismatch".to_owned(),
            })
        })
        .expect("rejected update");

        assert!(matches!(outcome, UpdateJobOutcome::Rejected(_)));
        assert!(!outcome.is_resolved());
        assert_eq!(
            outcome.record().error.as_deref(),
            Some("target identity mismatch")
        );
        assert_eq!(
            jobs.events.borrow().as_slice(),
            ["register", "acquire", "reject"]
        );
    }

    #[test]
    fn update_job_restart_reads_running_state_without_reinvoking_installer() {
        let jobs = FakeJobs::new(UpdateJobState::Running);
        let outcome = run_with_durable_job(&jobs, &request(), "unix-ms:2", |_| {
            Err("installer must not run during restart readback".to_owned())
        })
        .expect("restart readback");

        assert!(matches!(outcome, UpdateJobOutcome::ReadbackRequired(_)));
        assert_eq!(jobs.events.borrow().as_slice(), ["register", "readback"]);
    }

    #[test]
    fn update_job_callback_error_preserves_unknown_readback_without_retrying() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let calls = std::cell::Cell::new(0_u8);
        let outcome = run_with_durable_job(&jobs, &request(), "unix-ms:2", |_| {
            calls.set(calls.get() + 1);
            Err("installer delivery became uncertain".to_owned())
        })
        .expect("unknown update outcome is retained");

        assert!(matches!(outcome, UpdateJobOutcome::ReadbackRequired(_)));
        assert_eq!(calls.get(), 1);
        assert_eq!(
            jobs.events.borrow().as_slice(),
            ["register", "acquire", "readback"]
        );
        assert!(!outcome.is_resolved());
    }

    #[test]
    fn update_job_exact_replay_reads_original_outcome_without_running_installer() {
        let jobs = FakeJobs::new(UpdateJobState::Reconciled);
        jobs.record.borrow_mut().version = Some("2.0.0".to_owned());
        let outcome = run_with_durable_job(&jobs, &request(), "unix-ms:2", |_| {
            panic!("exact update replay must not invoke the installer")
        })
        .expect("replayed update");

        assert!(outcome.is_resolved());
        assert_eq!(outcome.record().version.as_deref(), Some("2.0.0"));
        assert_eq!(jobs.events.borrow().as_slice(), ["register", "readback"]);
    }

    #[test]
    fn update_job_losing_acquisition_reads_back_without_running_installer() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let mut running = jobs.snapshot();
        running.state = UpdateJobState::Running;
        jobs.acquisition
            .borrow_mut()
            .replace(UpdateJobAcquisition::AlreadyRunning(running));
        let calls = std::cell::Cell::new(0_u8);
        let outcome = run_with_durable_job(&jobs, &request(), "unix-ms:2", |_| {
            calls.set(calls.get() + 1);
            panic!("a losing acquisition must not invoke the installer")
        })
        .expect("losing update acquisition");

        assert!(matches!(outcome, UpdateJobOutcome::ReadbackRequired(_)));
        assert_eq!(calls.get(), 0);
        assert_eq!(
            jobs.events.borrow().as_slice(),
            ["register", "acquire", "readback"]
        );
    }

    #[test]
    fn update_job_rejects_oversized_identity_before_admission() {
        let jobs = FakeJobs::new(UpdateJobState::Registered);
        let mut request = request();
        request.target_identity = "x".repeat(MAX_UPDATE_IDENTITY_BYTES + 1);
        let error = run_with_durable_job(&jobs, &request, "unix-ms:2", |_| {
            panic!("oversized update reached external callback")
        })
        .expect_err("oversized update identity must be rejected");
        assert!(error.contains("target identity"));
        assert!(jobs.events.borrow().is_empty());
    }
}
