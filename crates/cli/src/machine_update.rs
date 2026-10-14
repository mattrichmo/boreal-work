//! Per-installation journal and command adapter for machine updates.
//!
//! The journal lives beside the installed package, never in project SQLite.
//! Existing operations can be read back or reconciled, but an existing stage
//! never grants permission to invoke the updater again.

use super::update::MachineUpdateJournalPort;
use super::*;
use std::{
    fs::{self, File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

const JOURNAL_FORMAT: &str = "boreal.machine-update/1";
const JOURNAL_DIRECTORY: &str = ".boreal-update";
const LOCK_FILE: &str = "journal.lock";
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, Serialize)]
struct JournalEnvelope {
    format: String,
    record: update::MachineUpdateRecord,
}

#[derive(Debug)]
struct MachineUpdateJournal {
    prefix: PathBuf,
    root: PathBuf,
    _lock: Option<File>,
}

#[derive(Clone, Debug)]
struct InstalledPackage {
    artifact_identity: String,
    target: String,
    version: String,
}

impl MachineUpdateJournal {
    fn open_locked(prefix: &Path) -> Result<Self, String> {
        let prefix = canonical_prefix(prefix)?;
        let root = prefix.join(JOURNAL_DIRECTORY);
        ensure_private_directory(&root)?;
        let lock_path = root.join(LOCK_FILE);
        let lock = open_lock_file(&lock_path)?;
        acquire_lock(&lock).map_err(|error| {
            format!(
                "another machine update or recovery owns {}: {error}",
                lock_path.display()
            )
        })?;
        Ok(Self {
            prefix,
            root,
            _lock: Some(lock),
        })
    }

    fn open_read_only(prefix: &Path) -> Result<Self, String> {
        let prefix = canonical_prefix(prefix)?;
        let root = prefix.join(JOURNAL_DIRECTORY);
        match fs::symlink_metadata(&root) {
            Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
                return Err(format!(
                    "machine update journal directory is not a real directory: {}",
                    root.display()
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => {
                return Err(format!(
                    "could not inspect machine update journal directory {}: {error}",
                    root.display()
                ));
            }
        }
        Ok(Self {
            prefix,
            root,
            _lock: None,
        })
    }

    fn record_path(&self, operation_id: &str) -> Result<PathBuf, String> {
        validate_operation_id(operation_id)?;
        let digest = boreal_application::sha256_content_digest(operation_id.as_bytes());
        let digest = digest
            .strip_prefix("sha256:")
            .ok_or_else(|| "could not derive machine journal filename".to_owned())?;
        Ok(self.root.join(format!("{digest}.json")))
    }

    fn load(&self, operation_id: &str) -> Result<update::MachineUpdateRecord, String> {
        self.try_load(operation_id)?.ok_or_else(|| {
            format!("machine update operation {operation_id:?} has no journal record")
        })
    }

    fn try_load(&self, operation_id: &str) -> Result<Option<update::MachineUpdateRecord>, String> {
        let path = self.record_path(operation_id)?;
        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(format!(
                    "could not inspect machine update record {operation_id:?}: {error}"
                ));
            }
        };
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "machine update journal record is not a regular file: {}",
                path.display()
            ));
        }
        let bytes = fs::read(&path).map_err(|error| {
            format!(
                "could not read machine update journal {}: {error}",
                path.display()
            )
        })?;
        if bytes.len() > 128 * 1024 {
            return Err("machine update journal record exceeds the size limit".to_owned());
        }
        let envelope: JournalEnvelope = serde_json::from_slice(&bytes)
            .map_err(|error| format!("machine update journal is invalid: {error}"))?;
        if envelope.format != JOURNAL_FORMAT
            || envelope.record.format != JOURNAL_FORMAT
            || envelope.record.operation_id != operation_id
        {
            return Err("machine update journal identity is invalid".to_owned());
        }
        update::validate_machine_update_record(&envelope.record)?;
        if Path::new(&envelope.record.prefix) != self.prefix {
            return Err("machine update journal prefix does not match its installation".to_owned());
        }
        Ok(Some(envelope.record))
    }

    fn save(&self, record: &update::MachineUpdateRecord) -> Result<(), String> {
        if self._lock.is_none() {
            return Err("machine update journal writes require exclusive admission".to_owned());
        }
        update::validate_machine_update_record(record)?;
        if Path::new(&record.prefix) != self.prefix {
            return Err("machine update record prefix does not match its journal".to_owned());
        }
        let path = self.record_path(&record.operation_id)?;
        let mut bytes = serde_json::to_vec(&JournalEnvelope {
            format: JOURNAL_FORMAT.to_owned(),
            record: record.clone(),
        })
        .map_err(|error| format!("could not encode machine update journal: {error}"))?;
        bytes.push(b'\n');
        atomic_replace(&path, &bytes)
    }

    fn records(&self) -> Result<Vec<update::MachineUpdateRecord>, String> {
        let entries = match fs::read_dir(&self.root) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
            Err(error) => {
                return Err(format!(
                    "could not list machine update journal {}: {error}",
                    self.root.display()
                ));
            }
        };
        let mut records = Vec::new();
        for entry in entries {
            let entry = entry.map_err(|error| format!("could not read journal entry: {error}"))?;
            let path = entry.path();
            if path.file_name().is_some_and(|name| name == LOCK_FILE)
                || path.extension().is_none_or(|extension| extension != "json")
            {
                continue;
            }
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                format!("could not inspect machine update journal entry: {error}")
            })?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(format!(
                    "machine update journal contains a non-regular record: {}",
                    path.display()
                ));
            }
            let bytes = fs::read(&path).map_err(|error| {
                format!("could not read machine update journal record: {error}")
            })?;
            if bytes.len() > 128 * 1024 {
                return Err(format!(
                    "machine update journal record exceeds the size limit: {}",
                    path.display()
                ));
            }
            let envelope: JournalEnvelope = serde_json::from_slice(&bytes)
                .map_err(|error| format!("machine update journal is invalid: {error}"))?;
            if envelope.format != JOURNAL_FORMAT || envelope.record.format != JOURNAL_FORMAT {
                return Err(format!(
                    "machine update journal format is unsupported: {}",
                    path.display()
                ));
            }
            update::validate_machine_update_record(&envelope.record)?;
            if self.record_path(&envelope.record.operation_id)? != path {
                return Err(format!(
                    "machine update journal filename does not match its operation identity: {}",
                    path.display()
                ));
            }
            if Path::new(&envelope.record.prefix) != self.prefix {
                return Err("machine update journal contains a foreign prefix record".to_owned());
            }
            records.push(envelope.record);
        }
        records.sort_by(|left, right| {
            left.created_at
                .cmp(&right.created_at)
                .then_with(|| left.operation_id.cmp(&right.operation_id))
        });
        Ok(records)
    }

    fn validate_request(
        &self,
        operation_id: &str,
        request_digest: &str,
    ) -> Result<update::MachineUpdateRecord, String> {
        let record = self.load(operation_id)?;
        if record.request_digest != request_digest || Path::new(&record.prefix) != self.prefix {
            return Err("machine update operation conflicts with its original request".to_owned());
        }
        Ok(record)
    }
}

impl update::MachineUpdateJournalPort for MachineUpdateJournal {
    fn register_machine_update(
        &self,
        record: &update::MachineUpdateRecord,
    ) -> Result<update::MachineUpdateRecord, String> {
        if self._lock.is_none() {
            return Err("machine update registration requires exclusive admission".to_owned());
        }
        if !record.stage.is_terminal()
            && self.records()?.iter().any(|prior| {
                prior.operation_id != record.operation_id && !prior.stage.is_terminal()
            })
        {
            return Err(
                "another machine update is unresolved; run `bwrk update status` and `bwrk update recover --yes` first"
                    .to_owned(),
            );
        }
        let path = self.record_path(&record.operation_id)?;
        match fs::symlink_metadata(&path) {
            Ok(_) => {
                let current = self.load(&record.operation_id)?;
                if current.request_digest != record.request_digest
                    || current.source_package_identity != record.source_package_identity
                    || current.target_package_identity != record.target_package_identity
                    || current.target_version != record.target_version
                    || current.prefix != record.prefix
                {
                    return Err("machine update operation ID conflicts with another request".into());
                }
                Ok(current)
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                self.save(record)?;
                self.load(&record.operation_id)
            }
            Err(error) => Err(format!("could not inspect machine update record: {error}")),
        }
    }

    fn acquire_machine_update(
        &self,
        operation_id: &str,
        request_digest: &str,
        side_effect_ref: &str,
        updated_at: &str,
    ) -> Result<update::MachineUpdateAcquisition, String> {
        let mut record = self.validate_request(operation_id, request_digest)?;
        if record.stage != update::MachineUpdateStage::Registered {
            return Ok(update::MachineUpdateAcquisition::Existing(record));
        }
        if self
            .records()?
            .iter()
            .any(|prior| prior.operation_id != operation_id && !prior.stage.is_terminal())
        {
            return Err(
                "another machine update is unresolved; run `bwrk update status` and `bwrk update recover --yes` first"
                    .to_owned(),
            );
        }
        record.stage = update::MachineUpdateStage::Running;
        record.side_effect_ref = Some(side_effect_ref.to_owned());
        record.updated_at = updated_at.to_owned();
        self.save(&record)?;
        Ok(update::MachineUpdateAcquisition::Won(record))
    }

    fn mark_machine_readback_required(
        &self,
        operation_id: &str,
        request_digest: &str,
        updated_at: &str,
    ) -> Result<update::MachineUpdateRecord, String> {
        let mut record = self.validate_request(operation_id, request_digest)?;
        if matches!(
            record.stage,
            update::MachineUpdateStage::Running | update::MachineUpdateStage::ReadbackRequired
        ) {
            record.stage = update::MachineUpdateStage::ReadbackRequired;
            record.updated_at = updated_at.to_owned();
            self.save(&record)?;
        }
        Ok(record)
    }

    fn reconcile_machine_update(
        &self,
        operation_id: &str,
        request_digest: &str,
        observed_package_identity: &str,
        version: &str,
        updated_at: &str,
    ) -> Result<update::MachineUpdateRecord, String> {
        let mut record = self.validate_request(operation_id, request_digest)?;
        if record.stage.is_terminal() {
            return Ok(record);
        }
        record.observed_package_identity = Some(observed_package_identity.to_owned());
        record.version = Some(version.to_owned());
        record.stage = update::MachineUpdateStage::Reconciled;
        record.error = None;
        record.updated_at = updated_at.to_owned();
        self.save(&record)?;
        Ok(record)
    }

    fn reject_machine_update(
        &self,
        operation_id: &str,
        request_digest: &str,
        reason: &str,
        updated_at: &str,
    ) -> Result<update::MachineUpdateRecord, String> {
        let mut record = self.validate_request(operation_id, request_digest)?;
        if !record.stage.is_terminal() {
            record.stage = update::MachineUpdateStage::Rejected;
            record.error = Some(reason.to_owned());
            record.updated_at = updated_at.to_owned();
            self.save(&record)?;
        }
        Ok(record)
    }

    fn read_machine_update(
        &self,
        operation_id: &str,
        request_digest: &str,
    ) -> Result<update::MachineUpdateRecord, String> {
        self.validate_request(operation_id, request_digest)
    }
}

pub(crate) fn run(parsed: &ParsedCommand, operation_id: &str) -> Result<CliResult, CliError> {
    let prefix = installation_prefix().map_err(machine_error)?;
    match parsed
        .path
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["update", "status"] => status_result(&prefix),
        ["update", "recover"] => recover_result(&prefix, parsed.options.operation_id.as_deref()),
        ["update"] | ["upgrade"] => update_result(&prefix, operation_id),
        _ => Err(CliError::invalid("unsupported machine update route")),
    }
}

fn update_result(prefix: &Path, operation_id: &str) -> Result<CliResult, CliError> {
    let journal = MachineUpdateJournal::open_locked(prefix).map_err(machine_error)?;
    let installer = prefix.join("share/boreal/install.sh");
    if !installer.is_file() {
        return Err(CliError::with(
            ErrorCode::UnsupportedTarget,
            ApplicationOutcome::Rejected,
            if prefix.to_string_lossy().contains("/Cellar/") {
                "this bwrk installation is managed by Homebrew; run `brew upgrade boreal`"
                    .to_owned()
            } else {
                format!(
                    "this bwrk installation does not include its updater ({})",
                    installer.display()
                )
            },
        ));
    }
    if let Some(existing) = journal.try_load(operation_id).map_err(machine_error)? {
        if existing.stage.is_terminal() {
            return Ok(record_result(existing));
        }
        let side_effect_ref = update::machine_update_side_effect_ref(&existing);
        let invocation = update::run_machine_update_once(
            &journal,
            &existing,
            &side_effect_ref,
            &now(),
            |running| update::run_machine_installer(prefix, &running.target_version),
        )
        .map_err(machine_error)?;
        let durable = invocation.record;
        let record = if durable.stage.is_terminal() {
            durable
        } else {
            reconcile_from_package(
                &journal,
                &durable.operation_id,
                &durable.request_digest,
                invocation.execution_error.as_deref(),
            )?
        };
        return Ok(record_result(record));
    }
    let package = installed_package(prefix).map_err(machine_error)?;
    let target = update::latest_machine_update_target(&package.target).map_err(machine_error)?;
    let global_root = Some(
        global_commands::global_db_path()?
            .to_string_lossy()
            .into_owned(),
    );
    let created_at = now();
    let request_digest = boreal_application::sha256_content_digest(
        serde_json::to_vec(&json!({
            "operation_id": operation_id,
            "prefix": prefix,
            "source_package_identity": package.artifact_identity,
            "target_package_identity": target.artifact_identity,
            "target_version": target.version,
            "global_root": global_root,
        }))
        .map_err(|error| machine_error(format!("could not bind update request: {error}")))?
        .as_slice(),
    );
    let record = update::MachineUpdateRecord {
        format: JOURNAL_FORMAT.to_owned(),
        operation_id: operation_id.to_owned(),
        request_digest,
        prefix: prefix.to_string_lossy().into_owned(),
        source_package_identity: package.artifact_identity.clone(),
        target_package_identity: target.artifact_identity.clone(),
        target_version: target.version.clone(),
        global_root,
        source_schema: None,
        source_revision: None,
        backup_ref: None,
        stage: update::MachineUpdateStage::Registered,
        side_effect_ref: None,
        observed_package_identity: None,
        version: None,
        error: None,
        created_at: created_at.clone(),
        updated_at: created_at.clone(),
    };
    if record.source_package_identity == record.target_package_identity {
        let mut unchanged = record;
        unchanged.stage = update::MachineUpdateStage::Reconciled;
        unchanged.observed_package_identity = Some(package.artifact_identity);
        unchanged.version = Some(target.version);
        journal
            .register_machine_update(&unchanged)
            .map_err(machine_error)?;
        let record = journal
            .read_machine_update(&unchanged.operation_id, &unchanged.request_digest)
            .map_err(machine_error)?;
        return Ok(record_result(record));
    }
    let side_effect_ref = update::machine_update_side_effect_ref(&record);
    let invocation =
        update::run_machine_update_once(&journal, &record, &side_effect_ref, &now(), |running| {
            update::run_machine_installer(prefix, &running.target_version)
        })
        .map_err(machine_error)?;
    let durable = invocation.record;
    let record = if durable.stage.is_terminal() {
        durable
    } else {
        reconcile_from_package(
            &journal,
            &durable.operation_id,
            &durable.request_digest,
            invocation.execution_error.as_deref(),
        )?
    };
    Ok(record_result(record))
}

fn status_result(prefix: &Path) -> Result<CliResult, CliError> {
    let journal = MachineUpdateJournal::open_read_only(prefix).map_err(machine_error)?;
    let records = journal.records().map_err(machine_error)?;
    let unresolved = records
        .iter()
        .filter(|record| !record.stage.is_terminal())
        .count();
    Ok(CliResult {
        outcome: ApplicationOutcome::Unchanged,
        revision: None,
        data: Some(json!({
            "command": "update status",
            "prefix": journal.prefix,
            "records": records,
            "unresolved_count": unresolved,
            "read_only": true,
        })),
        human: None,
        as_of: Some(now()),
        next_status_change_at: None,
        detail_ref: None,
    })
}

fn recover_result(prefix: &Path, requested_operation: Option<&str>) -> Result<CliResult, CliError> {
    let journal = MachineUpdateJournal::open_locked(prefix).map_err(machine_error)?;
    let records = journal.records().map_err(machine_error)?;
    let unresolved = records
        .iter()
        .filter(|record| !record.stage.is_terminal())
        .cloned()
        .collect::<Vec<_>>();
    let selected = if let Some(operation_id) = requested_operation {
        records
            .into_iter()
            .find(|record| record.operation_id == operation_id)
            .ok_or_else(|| {
                CliError::with(
                    ErrorCode::NotFound,
                    ApplicationOutcome::Rejected,
                    format!("no unresolved machine update operation {operation_id:?}"),
                )
            })?
    } else {
        match unresolved.as_slice() {
            [] => {
                return Ok(CliResult {
                    outcome: ApplicationOutcome::Unchanged,
                    revision: None,
                    data: Some(json!({
                        "command": "update recover",
                        "prefix": journal.prefix,
                        "recovered": false,
                        "unresolved_count": 0,
                    })),
                    human: Some("no unresolved machine update journal".to_owned()),
                    as_of: Some(now()),
                    next_status_change_at: None,
                    detail_ref: None,
                });
            }
            [only] => only.clone(),
            _ => {
                return Err(CliError::invalid(
                    "multiple machine update operations need recovery; pass --operation-id to select one",
                ));
            }
        }
    };

    if selected.stage.is_terminal() {
        return Ok(record_result(selected));
    }

    if selected.stage == update::MachineUpdateStage::Registered {
        // Registration proves the atomic running acquisition never occurred.
        // Explicit recovery closes this unused intent; it does not acquire or
        // invoke the updater.
        let rejected = journal
            .reject_machine_update(
                &selected.operation_id,
                &selected.request_digest,
                "recovery closed an update that never acquired side-effect permission",
                &now(),
            )
            .map_err(machine_error)?;
        return Ok(record_result(rejected));
    }
    let expected_ref = update::machine_update_side_effect_ref(&selected);
    if selected.side_effect_ref.as_deref() != Some(expected_ref.as_str()) {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Unknown,
            "machine update side-effect identity is unavailable; refusing to infer or replay",
        ));
    }
    let result = reconcile_from_package(
        &journal,
        &selected.operation_id,
        &selected.request_digest,
        None,
    )?;
    let mut result = record_result(result);
    if result.outcome == ApplicationOutcome::Unknown {
        result.human = Some(
            "package readback still matches the source identity; the updater was not replayed"
                .to_owned(),
        );
    }
    Ok(result)
}

fn reconcile_from_package(
    journal: &MachineUpdateJournal,
    operation_id: &str,
    request_digest: &str,
    installer_error: Option<&str>,
) -> Result<update::MachineUpdateRecord, CliError> {
    let current = journal
        .read_machine_update(operation_id, request_digest)
        .map_err(machine_error)?;
    if current.stage.is_terminal() {
        return Ok(current);
    }
    if current.stage != update::MachineUpdateStage::Registered {
        let expected_ref = update::machine_update_side_effect_ref(&current);
        if current.side_effect_ref.as_deref() != Some(expected_ref.as_str()) {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Unknown,
                "machine update side-effect identity does not verify; refusing to infer or replay",
            ));
        }
    }
    let package = match installed_package(&journal.prefix) {
        Ok(package) => package,
        Err(error) => {
            let reason = installer_error
                .map(|installer| format!("{installer}; package readback failed: {error}"))
                .unwrap_or(error);
            let _ = journal.mark_machine_readback_required(operation_id, request_digest, &now());
            let mut unresolved = current;
            unresolved.error = Some(reason.chars().take(4096).collect());
            unresolved.updated_at = now();
            journal.save(&unresolved).map_err(machine_error)?;
            return Ok(unresolved);
        }
    };
    if package.artifact_identity == current.source_package_identity {
        let mut unresolved = journal
            .mark_machine_readback_required(operation_id, request_digest, &now())
            .map_err(machine_error)?;
        unresolved.error =
            installer_error.map(|error| error.chars().take(4096).collect::<String>());
        unresolved.updated_at = now();
        journal.save(&unresolved).map_err(machine_error)?;
        return Ok(unresolved);
    }
    if package.artifact_identity != current.target_package_identity {
        let mut unresolved = journal
            .mark_machine_readback_required(operation_id, request_digest, &now())
            .map_err(machine_error)?;
        unresolved.error =
            Some("installed package identity does not match the journaled target".to_owned());
        unresolved.updated_at = now();
        journal.save(&unresolved).map_err(machine_error)?;
        return Ok(unresolved);
    }
    journal
        .reconcile_machine_update(
            operation_id,
            request_digest,
            &package.artifact_identity,
            &package.version,
            &now(),
        )
        .map_err(machine_error)
}

fn record_result(record: update::MachineUpdateRecord) -> CliResult {
    let outcome = match record.stage {
        update::MachineUpdateStage::Reconciled
            if record.observed_package_identity.as_deref()
                == Some(record.source_package_identity.as_str()) =>
        {
            ApplicationOutcome::Unchanged
        }
        update::MachineUpdateStage::Reconciled => ApplicationOutcome::Changed,
        update::MachineUpdateStage::Rejected => ApplicationOutcome::Rejected,
        update::MachineUpdateStage::Registered
        | update::MachineUpdateStage::Running
        | update::MachineUpdateStage::ReadbackRequired => ApplicationOutcome::Unknown,
    };
    CliResult {
        outcome,
        revision: None,
        data: Some(json!({
            "command": "update",
            "operation_id": record.operation_id,
            "request_digest": record.request_digest,
            "prefix": record.prefix,
            "source_package_identity": record.source_package_identity,
            "target_package_identity": record.target_package_identity,
            "target_version": record.target_version,
            "observed_package_identity": record.observed_package_identity,
            "global_root": record.global_root,
            "source_schema": record.source_schema,
            "source_revision": record.source_revision,
            "backup_ref": record.backup_ref,
            "stage": record.stage.as_str(),
            "version": record.version,
            "side_effect_ref": record.side_effect_ref,
            "error": record.error,
            "readback_required": !record.stage.is_terminal(),
        })),
        human: None,
        as_of: Some(now()),
        next_status_change_at: None,
        detail_ref: None,
    }
}

fn installation_prefix() -> Result<PathBuf, String> {
    let executable = env::current_exe()
        .map_err(|error| format!("could not locate the running bwrk executable: {error}"))?;
    let executable = fs::canonicalize(&executable).unwrap_or(executable);
    let prefix = executable
        .parent()
        .and_then(Path::parent)
        .ok_or_else(|| "could not determine the Boreal installation prefix".to_owned())?;
    canonical_prefix(prefix)
}

fn canonical_prefix(prefix: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(prefix).map_err(|error| {
        format!(
            "machine update prefix is not available: {}: {error}",
            prefix.display()
        )
    })
}

fn installed_package(prefix: &Path) -> Result<InstalledPackage, String> {
    let binary = prefix.join("bin/bwrk");
    let manifest_path = prefix.join("share/boreal/release.json");
    for path in [&binary, &manifest_path] {
        let metadata = fs::symlink_metadata(path).map_err(|error| {
            format!(
                "installed package readback failed at {}: {error}",
                path.display()
            )
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "installed package readback is not a regular file: {}",
                path.display()
            ));
        }
    }
    let manifest_bytes = fs::read(&manifest_path)
        .map_err(|error| format!("could not read installed release manifest: {error}"))?;
    if manifest_bytes.len() > 16 * 1024 * 1024 {
        return Err("installed release manifest exceeds the size limit".to_owned());
    }
    let manifest: Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| format!("installed release manifest is invalid: {error}"))?;
    let (artifact_identity, target, version) =
        update::verified_release_manifest_identity(&manifest_bytes)?;
    let binary_bytes = fs::read(&binary)
        .map_err(|error| format!("could not read installed bwrk binary: {error}"))?;
    let binary_identity = manifest
        .pointer("/binary/sha256")
        .and_then(Value::as_str)
        .filter(|identity| is_sha256_identity(identity))
        .ok_or_else(|| "installed release manifest has no binary digest".to_owned())?;
    if boreal_application::sha256_content_digest(&binary_bytes) != binary_identity {
        return Err("installed bwrk binary does not match its release manifest".to_owned());
    }
    Ok(InstalledPackage {
        artifact_identity,
        target,
        version,
    })
}

fn is_sha256_identity(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|digest| {
        digest.len() == 64
            && digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    })
}

fn validate_operation_id(operation_id: &str) -> Result<(), String> {
    if operation_id.is_empty()
        || operation_id.len() > 512
        || !operation_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-' | b':'))
    {
        return Err("machine update operation identity is invalid".to_owned());
    }
    Ok(())
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err(format!(
                "machine update journal path is not a real directory: {}",
                path.display()
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir(path).map_err(|error| {
                format!("could not create machine update journal directory: {error}")
            })?;
        }
        Err(error) => {
            return Err(format!(
                "could not inspect machine update directory: {error}"
            ));
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(|error| {
            format!("could not secure machine update journal directory: {error}")
        })?;
    }
    Ok(())
}

fn open_lock_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true).write(true).create(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let file = options
        .open(path)
        .map_err(|error| format!("could not open machine update lock: {error}"))?;
    let metadata = file
        .metadata()
        .map_err(|error| format!("could not inspect machine update lock: {error}"))?;
    if !metadata.is_file() {
        return Err("machine update lock is not a regular file".to_owned());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        file.set_permissions(fs::Permissions::from_mode(0o600))
            .map_err(|error| format!("could not secure machine update lock: {error}"))?;
    }
    Ok(file)
}

#[cfg(unix)]
fn acquire_lock(file: &File) -> std::io::Result<()> {
    use std::os::fd::AsRawFd;
    use std::os::raw::c_int;
    const LOCK_EX: c_int = 2;
    const LOCK_NB: c_int = 4;
    unsafe extern "C" {
        fn flock(fd: c_int, operation: c_int) -> c_int;
    }
    // SAFETY: the open file descriptor remains owned by `file` for this call.
    if unsafe { flock(file.as_raw_fd(), LOCK_EX | LOCK_NB) } == 0 {
        Ok(())
    } else {
        Err(std::io::Error::last_os_error())
    }
}

#[cfg(not(unix))]
fn acquire_lock(_file: &File) -> std::io::Result<()> {
    Err(std::io::Error::new(
        std::io::ErrorKind::Unsupported,
        "machine update journals require Unix advisory locks",
    ))
}

fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "machine update journal path has no parent directory".to_owned())?;
    let temp = loop {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        let temp = parent.join(format!(
            ".update-journal.{}.{}.tmp",
            std::process::id(),
            sequence
        ));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&temp) {
            Ok(mut file) => {
                file.write_all(bytes)
                    .map_err(|error| format!("could not write machine update journal: {error}"))?;
                file.sync_all()
                    .map_err(|error| format!("could not sync machine update journal: {error}"))?;
                break temp;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => {
                return Err(format!("could not stage machine update journal: {error}"));
            }
        }
    };
    if let Err(error) = fs::rename(&temp, path) {
        let _ = fs::remove_file(&temp);
        return Err(format!(
            "could not atomically replace machine update journal: {error}"
        ));
    }
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("could not sync machine update journal directory: {error}"))
}

fn machine_error(message: impl Into<String>) -> CliError {
    CliError::with(
        ErrorCode::ServiceUnavailable,
        ApplicationOutcome::Unknown,
        message,
    )
}

fn now() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("unix-ms:{millis}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{cell::Cell, fs};

    fn temp_prefix(label: &str) -> PathBuf {
        let sequence = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "boreal-machine-update-{label}-{}-{sequence}",
            std::process::id()
        ))
    }

    fn request(prefix: &Path, operation_id: &str) -> update::MachineUpdateRecord {
        let prefix = canonical_prefix(prefix).expect("canonical test prefix");
        let created_at = now();
        update::MachineUpdateRecord {
            format: JOURNAL_FORMAT.to_owned(),
            operation_id: operation_id.to_owned(),
            request_digest: boreal_application::sha256_content_digest(
                format!("{operation_id}:request").as_bytes(),
            ),
            prefix: prefix.to_string_lossy().into_owned(),
            source_package_identity: format!("sha256:{}", "a".repeat(64)),
            target_package_identity: format!("sha256:{}", "b".repeat(64)),
            target_version: "9.8.7".to_owned(),
            global_root: Some(prefix.join("global.sqlite").to_string_lossy().into_owned()),
            source_schema: None,
            source_revision: None,
            backup_ref: None,
            stage: update::MachineUpdateStage::Registered,
            side_effect_ref: None,
            observed_package_identity: None,
            version: None,
            error: None,
            created_at: created_at.clone(),
            updated_at: created_at,
        }
    }

    fn test_target() -> &'static str {
        match (std::env::consts::OS, std::env::consts::ARCH) {
            ("macos", "aarch64") => "aarch64-apple-darwin",
            ("macos", "x86_64") => "x86_64-apple-darwin",
            ("linux", "x86_64") => "x86_64-unknown-linux-gnu",
            _ => "unsupported-test-target",
        }
    }

    fn install_fixture_package(prefix: &Path) -> InstalledPackage {
        let binary = prefix.join("bin/bwrk");
        let manifest_path = prefix.join("share/boreal/release.json");
        fs::create_dir_all(binary.parent().expect("binary parent")).expect("bin dir");
        fs::create_dir_all(manifest_path.parent().expect("manifest parent")).expect("share dir");
        let binary_bytes = b"verified fixture package";
        fs::write(&binary, binary_bytes).expect("write fixture binary");
        let mut manifest = json!({
            "manifest_version": "boreal.binary_release.v1",
            "package_id": "boreal-work",
            "version": "9.8.7",
            "target": test_target(),
            "binary": {
                "path": "bin/bwrk",
                "sha256": boreal_application::sha256_content_digest(binary_bytes),
            },
        });
        let mut canonical = serde_json::to_vec(&manifest).expect("encode manifest basis");
        canonical.push(b'\n');
        let artifact_identity = boreal_application::sha256_content_digest(&canonical);
        manifest["artifact_identity"] = json!(artifact_identity);
        let mut bytes = serde_json::to_vec(&manifest).expect("encode fixture manifest");
        bytes.push(b'\n');
        fs::write(manifest_path, bytes).expect("write fixture manifest");
        InstalledPackage {
            artifact_identity,
            target: test_target().to_owned(),
            version: "9.8.7".to_owned(),
        }
    }

    #[test]
    fn update_replay_reads_back_without_invoking_installer_again() {
        let prefix = temp_prefix("replay");
        fs::create_dir_all(&prefix).expect("create prefix");
        let record = request(&prefix, "op_machine_replay");
        let side_effect = update::machine_update_side_effect_ref(&record);
        let calls = Cell::new(0);
        {
            let journal = MachineUpdateJournal::open_locked(&prefix).expect("open journal");
            let first =
                update::run_machine_update_once(&journal, &record, &side_effect, &now(), |_| {
                    calls.set(calls.get() + 1);
                    Ok(())
                })
                .expect("first invocation");
            assert!(first.invoked);
            assert_eq!(calls.get(), 1);
            assert_eq!(
                first.record.stage,
                update::MachineUpdateStage::ReadbackRequired
            );

            let replay =
                update::run_machine_update_once(&journal, &record, &side_effect, &now(), |_| {
                    calls.set(calls.get() + 1);
                    Ok(())
                })
                .expect("replay is a readback");
            assert!(!replay.invoked);
            assert_eq!(calls.get(), 1);
            assert_eq!(
                replay.record.stage,
                update::MachineUpdateStage::ReadbackRequired
            );
        }
        fs::remove_dir_all(prefix).expect("remove test prefix");
    }

    #[test]
    fn status_is_read_only_and_recovery_reconciles_verified_package_without_replay() {
        let prefix = temp_prefix("recovery");
        fs::create_dir_all(&prefix).expect("create prefix");
        let installed = install_fixture_package(&prefix);
        let marker = prefix.join("installer-was-run");
        let installer = prefix.join("share/boreal/install.sh");
        fs::write(
            &installer,
            format!("#!/bin/sh\ntouch {}\n", marker.display()),
        )
        .expect("write installer marker fixture");
        let mut record = request(&prefix, "op_machine_recovery");
        record.target_package_identity = installed.artifact_identity.clone();
        record.stage = update::MachineUpdateStage::ReadbackRequired;
        record.side_effect_ref = Some(update::machine_update_side_effect_ref(&record));
        {
            let journal = MachineUpdateJournal::open_locked(&prefix).expect("open journal");
            journal
                .register_machine_update(&record)
                .expect("register recovery fixture");
        }
        let journal_path = MachineUpdateJournal::open_read_only(&prefix)
            .expect("read-only journal")
            .record_path(&record.operation_id)
            .expect("record path");
        let before = fs::read(&journal_path).expect("read journal bytes");
        let status = status_result(&prefix).expect("read-only status");
        assert_eq!(status.outcome, ApplicationOutcome::Unchanged);
        assert_eq!(fs::read(&journal_path).expect("read journal bytes"), before);

        let recovered = recover_result(&prefix, None).expect("explicit readback recovery");
        assert_eq!(recovered.outcome, ApplicationOutcome::Changed);
        assert!(!marker.exists(), "recovery must never invoke the installer");
        let journal = MachineUpdateJournal::open_read_only(&prefix).expect("read journal");
        let record = journal
            .load("op_machine_recovery")
            .expect("load reconciled operation");
        assert_eq!(record.stage, update::MachineUpdateStage::Reconciled);
        assert_eq!(
            record.observed_package_identity.as_deref(),
            Some(installed.artifact_identity.as_str())
        );
        fs::remove_dir_all(prefix).expect("remove test prefix");
    }

    #[test]
    fn recovery_keeps_a_mismatched_package_unresolved_without_replay() {
        let prefix = temp_prefix("mismatch");
        fs::create_dir_all(&prefix).expect("create prefix");
        let installed = install_fixture_package(&prefix);
        let marker = prefix.join("installer-was-run");
        fs::write(
            prefix.join("share/boreal/install.sh"),
            format!("#!/bin/sh\ntouch {}\n", marker.display()),
        )
        .expect("write installer marker fixture");
        let mut record = request(&prefix, "op_machine_mismatch");
        assert_ne!(record.target_package_identity, installed.artifact_identity);
        record.stage = update::MachineUpdateStage::ReadbackRequired;
        record.side_effect_ref = Some(update::machine_update_side_effect_ref(&record));
        {
            let journal = MachineUpdateJournal::open_locked(&prefix).expect("open journal");
            journal
                .register_machine_update(&record)
                .expect("register mismatch fixture");
        }

        let recovered = recover_result(&prefix, None).expect("package mismatch is read back");
        assert_eq!(recovered.outcome, ApplicationOutcome::Unknown);
        assert!(!marker.exists(), "recovery must never invoke the installer");
        let journal = MachineUpdateJournal::open_read_only(&prefix).expect("read journal");
        let unresolved = journal
            .load("op_machine_mismatch")
            .expect("load unresolved operation");
        assert_eq!(
            unresolved.stage,
            update::MachineUpdateStage::ReadbackRequired
        );
        assert_eq!(
            unresolved.observed_package_identity, None,
            "a mismatched package is not a successful readback"
        );
        assert!(
            unresolved
                .error
                .as_deref()
                .is_some_and(|error| error.contains("does not match the journaled target"))
        );
        fs::remove_dir_all(prefix).expect("remove test prefix");
    }
}
