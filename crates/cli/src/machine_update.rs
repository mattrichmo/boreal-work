//! Per-installation update state and recovery.
//!
//! Machine update deliberately runs before project discovery. Its journal
//! lives beside the installation prefix, while a physical Global backup is
//! kept under the invoking user's Global data root.

use super::*;
use boreal_application::GlobalManagerApplication;
use boreal_service::{ElectionError, ProjectElection};
use serde::{Deserialize, Serialize};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::time::{SystemTime, UNIX_EPOCH};

const JOURNAL_NAME: &str = ".bwrk-update.json";
const STAGE_NAME: &str = ".bwrk-update.stage";
const TARGET_NAME: &str = ".bwrk-update.target";
const GLOBAL_RESTORE_NAME: &str = ".bwrk-update.global-restore";
const MAX_JOURNAL_BYTES: u64 = 64 * 1024;
const MAX_RELEASE_BYTES: u64 = 1024 * 1024;
const MAX_BINARY_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, Serialize, Deserialize)]
struct UpdateJournal {
    format: String,
    format_version: u64,
    operation_id: String,
    stage: String,
    prefix: PathBuf,
    source_package_identity: String,
    target_package_identity: Option<String>,
    global_root: PathBuf,
    global_database: PathBuf,
    global_schema_version: Option<u64>,
    global_database_id: Option<String>,
    recovered_global_database_id: Option<String>,
    recovered_global_revision: Option<u64>,
    global_revision: Option<u64>,
    global_backup_ref: Option<PathBuf>,
    package_backup_ref: PathBuf,
    created_at: String,
}

#[derive(Clone, Debug)]
struct InstallIdentity {
    version: String,
    binary_digest: String,
    manifest_digest: String,
}

pub(crate) fn is_route(parsed: &ParsedCommand) -> bool {
    match parsed
        .path
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["update"] | ["update", "status"] | ["update", "recover"] => true,
        ["upgrade"] => parsed.options.machine,
        _ => false,
    }
}

pub(crate) fn run(parsed: &ParsedCommand, operation: &str) -> Result<CliResult, CliError> {
    validate_machine_selectors(parsed)?;
    let prefix = installation_prefix()?;
    let state_root = prefix.join(".boreal-update");
    if parsed.path.as_slice() == ["update", "status"] {
        reject_symlink(&state_root)?;
        return status_result(&prefix, &state_root);
    }
    ensure_private_dir(&state_root)?;
    let runtime_root = prefix.join(".boreal-update-runtime");
    reject_symlink(&runtime_root)?;
    let owner = format!(
        "machine-update:{}:{}",
        std::process::id(),
        safe_token(operation)
    );
    let _lock = ProjectElection::try_acquire(
        &runtime_root,
        format!("installation:{}", prefix.display()),
        owner,
    )
    .map_err(|error| match error {
        ElectionError::Busy(_) => CliError::with(
            ErrorCode::ServiceBusy,
            ApplicationOutcome::Busy,
            format!("another update or recovery operation owns this installation: {error}"),
        ),
        other => CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot acquire machine update ownership: {other}"),
        ),
    })?;

    match parsed
        .path
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        .as_slice()
    {
        ["update", "recover"] => recover_result(parsed, &prefix, &state_root, operation),
        _ => update_result(parsed, &prefix, &state_root, operation),
    }
}

fn validate_machine_selectors(parsed: &ParsedCommand) -> Result<(), CliError> {
    let options = &parsed.options;
    if options.project.is_some() || options.socket.is_some() || options.db_explicit {
        return Err(CliError::invalid(
            "machine update is scoped to the installed prefix; omit --project, --socket, and --db",
        ));
    }
    if options.actor_explicit
        || options.actor_role.is_some()
        || options.session_explicit
        || options.harness != DEFAULT_HARNESS
        || options.source_version.is_some()
        || options.config_identity.is_some()
        || options.expected_revision.is_some()
        || options.attempt.is_some()
        || options.fence.is_some()
        || options.work.is_some()
        || options.gate.is_some()
        || options.input.is_some()
        || !options.extra.is_empty()
        || !options.positionals.is_empty()
    {
        return Err(CliError::invalid(
            "machine update accepts only its installation operation ID and JSON output; project, actor, and data selectors are not valid",
        ));
    }
    let route = parsed.path.iter().map(String::as_str).collect::<Vec<_>>();
    if route == ["update", "recover"] && !options.setup.yes {
        return Err(CliError::invalid("update recovery requires --yes"));
    }
    if route != ["update", "recover"] && options.setup.yes {
        return Err(CliError::invalid(
            "--yes is only valid with `bwrk update recover`",
        ));
    }
    Ok(())
}

fn update_result(
    _parsed: &ParsedCommand,
    prefix: &Path,
    state_root: &Path,
    operation: &str,
) -> Result<CliResult, CliError> {
    if operation.is_empty()
        || operation.len() > 128
        || operation
            .chars()
            .any(|character| !(character.is_ascii_alphanumeric() || ":._+-".contains(character)))
    {
        return Err(CliError::invalid(
            "machine update operation ID must be 1 to 128 letters, digits, or :._+- characters",
        ));
    }
    let journal_path = state_root.join(JOURNAL_NAME);
    let stage_path = state_root.join(STAGE_NAME);
    let target_path = state_root.join(TARGET_NAME);
    let global_restore_path = state_root.join(GLOBAL_RESTORE_NAME);
    if let Some(mut prior) = read_journal(&journal_path)? {
        validate_journal_paths(&prior, prefix)?;
        prior.stage = read_stage(&stage_path)?.unwrap_or_else(|| prior.stage.clone());
        if prior.stage != "committed" && prior.stage != "rolled_back" && prior.stage != "aborted" {
            return Err(CliError::unknown_delivery(
                &prior.operation_id,
                "an earlier machine update has an unresolved journal; inspect `bwrk update status` and run `bwrk update recover --yes`",
            ));
        }
        apply_global_restore_marker(&mut prior, &global_restore_path)?;
        if prior.operation_id == operation {
            let verified = match prior.stage.as_str() {
                "committed" => readback_pair(&prior)?.is_some_and(|installed| {
                    prior
                        .target_package_identity
                        .as_deref()
                        .map_or(true, |expected| expected == identity_string(&installed))
                }),
                "rolled_back" | "aborted" => {
                    match read_install_identity(prefix, &prefix.join("bin/bwrk")) {
                        Ok(installed)
                            if identity_string(&installed) == prior.source_package_identity =>
                        {
                            installed_source_pair_is_compatible(&prior, &installed)?
                        }
                        _ => false,
                    }
                }
                _ => false,
            };
            if !verified {
                return Err(CliError::unknown_delivery(
                    &prior.operation_id,
                    "terminal update replay failed package and Global readback; no update was retried",
                ));
            }
            write_journal(&journal_path, &prior)?;
            return Ok(journal_result(&prior, ApplicationOutcome::Unchanged, true));
        }
    }

    reject_symlink(&global_restore_path)?;
    match fs::remove_file(&global_restore_path) {
        Ok(()) => sync_dir(state_root)?,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(io_failure(error)),
    }

    let identity = read_install_identity(prefix, &prefix.join("bin/bwrk"))?;
    let installer = prefix.join("share/boreal/install.sh");
    verify_regular_file(&installer, "installed updater")?;
    let global_database = global_commands::global_db_path()?;
    let global_root = global_database
        .parent()
        .ok_or_else(|| CliError::invalid("Global database path has no data root"))?
        .to_path_buf();
    let token = safe_token(operation);
    let package_backup_ref = state_root.join(&token).join("package-backup");
    let backup_parent = package_backup_ref
        .parent()
        .ok_or_else(|| CliError::invalid("machine update journal has no parent"))?;
    ensure_private_dir(backup_parent)?;
    if package_backup_ref.exists() {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "the package recovery location for this operation already exists; review update status before retrying",
        ));
    }

    let mut journal = UpdateJournal {
        format: "boreal.machine-update".to_owned(),
        format_version: 1,
        operation_id: operation.to_owned(),
        stage: "preparing".to_owned(),
        prefix: prefix.to_path_buf(),
        source_package_identity: identity_string(&identity),
        target_package_identity: None,
        global_root: global_root.clone(),
        global_database: global_database.clone(),
        global_schema_version: None,
        global_database_id: None,
        recovered_global_database_id: None,
        recovered_global_revision: None,
        global_revision: None,
        global_backup_ref: None,
        package_backup_ref: package_backup_ref.clone(),
        created_at: now(),
    };
    write_journal(&journal_path, &journal)?;
    write_marker(&stage_path, "preparing")?;

    if global_database.exists() {
        verify_regular_file(&global_database, "Global database")?;
        let backup_root = global_root.join(".boreal-recovery/update");
        ensure_private_dir(&backup_root)?;
        let backup = backup_root.join(&token);
        let report =
            GlobalManagerApplication::backup_database_package_to(&global_database, &backup)
                .map_err(|error| {
                    CliError::with(
                        ErrorCode::ServiceUnavailable,
                        ApplicationOutcome::Failed,
                        format!("could not create a verified pre-update Global backup: {error}"),
                    )
                })?;
        let manifest_bytes = read_bounded_file(&report.manifest_path, MAX_RELEASE_BYTES)?;
        let manifest: Value = serde_json::from_slice(&manifest_bytes).map_err(|error| {
            CliError::invalid(format!("Global backup manifest is invalid: {error}"))
        })?;
        journal.global_schema_version = manifest["schema"]["version"].as_u64();
        journal.global_database_id = manifest["database_id"].as_str().map(ToOwned::to_owned);
        journal.global_revision = manifest["revision"].as_u64();
        journal.global_backup_ref = Some(report.package_path);
        journal.stage = "backup_complete".to_owned();
        write_journal(&journal_path, &journal)?;
    }
    write_marker(&stage_path, "prepared")?;
    journal.stage = "running".to_owned();
    write_journal(&journal_path, &journal)?;

    let mut child = Command::new("sh");
    child
        .arg(&installer)
        .arg("--prefix")
        .arg(prefix)
        .arg("--yes")
        .env("BOREAL_PREFIX", prefix)
        .env("BOREAL_GLOBAL_ROOT", &global_root)
        .env("BOREAL_UPDATE_OPERATION_ID", operation)
        .env("BOREAL_UPDATE_JOURNAL_PATH", &journal_path)
        .env("BOREAL_UPDATE_STAGE_PATH", &stage_path)
        .env("BOREAL_UPDATE_TARGET_IDENTITY_PATH", &target_path)
        .env("BOREAL_UPDATE_GLOBAL_RESTORE_PATH", &global_restore_path)
        .env("BOREAL_UPDATE_PACKAGE_BACKUP_PATH", &package_backup_ref)
        .env(
            "BOREAL_UPDATE_RECOVERY_OPERATION_ID",
            format!("update-recovery-{token}"),
        );
    if let Some(global_backup) = &journal.global_backup_ref {
        child.env("BOREAL_UPDATE_GLOBAL_BACKUP_PATH", global_backup);
    } else {
        child.env_remove("BOREAL_UPDATE_GLOBAL_BACKUP_PATH");
    }
    let result = child.output().map_err(|error| {
        CliError::unknown_delivery(
            operation,
            format!("could not start the installed updater; its journal was preserved: {error}"),
        )
    })?;
    let installer_stage = read_stage(&stage_path)?.unwrap_or_else(|| "running".to_owned());
    apply_global_restore_marker(&mut journal, &global_restore_path)?;
    if let Ok(target) = read_install_identity(prefix, &prefix.join("bin/bwrk")) {
        let target_identity = identity_string(&target);
        journal.target_package_identity = Some(target_identity.clone());
        let _ = atomic_replace(&target_path, target_identity.as_bytes());
    }
    journal.stage = installer_stage.clone();
    write_journal(&journal_path, &journal)?;

    if installer_stage == "rolled_back" {
        if installed_source_pair_is_compatible(&journal, &identity)? {
            journal.stage = "rolled_back".to_owned();
            write_journal(&journal_path, &journal)?;
            let _ = fs::remove_dir_all(&package_backup_ref);
            return Ok(journal_result(&journal, ApplicationOutcome::Failed, false));
        }
    }
    if !matches!(
        installer_stage.as_str(),
        "package_publish_started"
            | "package_published"
            | "global_migration_started"
            | "global_migrated"
            | "global_restore_started"
            | "global_restored"
            | "package_rollback_started"
            | "recovery_required"
            | "installer_complete"
    ) && !package_backup_has_material(&package_backup_ref)
    {
        if installed_source_pair_is_compatible(&journal, &identity)? {
            journal.stage = "aborted".to_owned();
            write_journal(&journal_path, &journal)?;
            write_marker(&stage_path, "aborted")?;
            let _ = fs::remove_dir_all(&package_backup_ref);
            return Ok(journal_result(&journal, ApplicationOutcome::Failed, false));
        }
    }
    if result.status.success() || installer_stage == "installer_complete" {
        if let Some(target) = readback_pair(&journal)? {
            journal.target_package_identity = Some(identity_string(&target));
            journal.stage = "committed".to_owned();
            write_journal(&journal_path, &journal)?;
            write_marker(&stage_path, "committed")?;
            let _ = fs::remove_dir_all(&package_backup_ref);
            return Ok(journal_result(&journal, ApplicationOutcome::Changed, false));
        }
    }
    let error_detail = bounded_child_error(&result.stderr);
    Err(CliError::unknown_delivery(
        operation,
        format!(
            "machine update outcome is unresolved (installer stage: {installer_stage}; exit: {}); {error_detail}; inspect `bwrk update status` before recovery",
            result.status
        ),
    ))
}

fn status_result(prefix: &Path, state_root: &Path) -> Result<CliResult, CliError> {
    let journal_path = state_root.join(JOURNAL_NAME);
    let Some(mut journal) = read_journal(&journal_path)? else {
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            data: Some(json!({"active": false, "prefix": prefix, "stage": "idle"})),
            ..CliResult::default()
        });
    };
    validate_journal_paths(&journal, prefix)?;
    journal.stage = read_stage(&state_root.join(STAGE_NAME))?.unwrap_or(journal.stage.clone());
    if let Some(target) = read_target_identity(&state_root.join(TARGET_NAME))? {
        journal.target_package_identity.get_or_insert(target);
    }
    Ok(journal_result(
        &journal,
        ApplicationOutcome::Unchanged,
        false,
    ))
}

fn recover_result(
    _parsed: &ParsedCommand,
    prefix: &Path,
    state_root: &Path,
    _operation: &str,
) -> Result<CliResult, CliError> {
    let journal_path = state_root.join(JOURNAL_NAME);
    let stage_path = state_root.join(STAGE_NAME);
    let Some(mut journal) = read_journal(&journal_path)? else {
        return Ok(CliResult {
            outcome: ApplicationOutcome::Unchanged,
            data: Some(json!({"recovered": false, "reason": "no update journal"})),
            ..CliResult::default()
        });
    };
    validate_journal_paths(&journal, prefix)?;
    let global_restore_path = state_root.join(GLOBAL_RESTORE_NAME);
    let previous_restored_id = journal.recovered_global_database_id.clone();
    let previous_restored_revision = journal.recovered_global_revision;
    apply_global_restore_marker(&mut journal, &global_restore_path)?;
    if journal.recovered_global_database_id != previous_restored_id
        || journal.recovered_global_revision != previous_restored_revision
    {
        write_journal(&journal_path, &journal)?;
    }
    let stage = read_stage(&stage_path)?.unwrap_or(journal.stage.clone());
    journal.stage = stage.clone();
    if stage == "committed" {
        if let Some(installed) = readback_pair(&journal)? {
            let identity = identity_string(&installed);
            if journal
                .target_package_identity
                .as_deref()
                .map_or(true, |expected| expected == identity)
            {
                return Ok(journal_result(
                    &journal,
                    ApplicationOutcome::Unchanged,
                    true,
                ));
            }
        }
        return Err(CliError::unknown_delivery(
            &journal.operation_id,
            "committed update journal failed package and Global readback; recovery made no changes",
        ));
    }
    if stage == "rolled_back" || stage == "aborted" {
        let installed = read_install_identity(prefix, &prefix.join("bin/bwrk"))?;
        if identity_string(&installed) != journal.source_package_identity
            || !installed_source_pair_is_compatible(&journal, &installed)?
        {
            return Err(CliError::unknown_delivery(
                &journal.operation_id,
                "terminal update journal failed package and Global readback; no recovery change was attempted",
            ));
        }
        return Ok(journal_result(
            &journal,
            ApplicationOutcome::Unchanged,
            true,
        ));
    }
    reconcile_installer_lock(prefix)?;

    if stage == "installer_complete" {
        if let Some(target) = readback_pair(&journal)? {
            journal.target_package_identity = Some(identity_string(&target));
            journal.stage = "committed".to_owned();
            write_journal(&journal_path, &journal)?;
            write_marker(&stage_path, "committed")?;
            let _ = fs::remove_dir_all(&journal.package_backup_ref);
            return Ok(journal_result(&journal, ApplicationOutcome::Changed, false));
        }
        return Err(CliError::unknown_delivery(
            &journal.operation_id,
            "installer reported completion but package and Global readback did not validate; recovery did not modify either resource",
        ));
    }

    let package_backup_exists = journal.package_backup_ref.is_dir();
    let global_may_have_changed = matches!(
        stage.as_str(),
        "global_migration_started"
            | "global_migrated"
            | "global_restore_started"
            | "global_restored"
            | "package_rollback_started"
            | "rollback_started"
            | "recovery_required"
    );
    if global_may_have_changed {
        if let Some(global_backup) = journal.global_backup_ref.as_deref() {
            let replaying_restore =
                matches!(stage.as_str(), "global_restore_started" | "global_restored")
                    || (matches!(
                        stage.as_str(),
                        "package_rollback_started" | "rollback_started"
                    ) && journal.recovered_global_database_id.is_some());
            if replaying_restore || should_restore_global(&journal)? {
                journal.stage = "global_restore_started".to_owned();
                write_journal(&journal_path, &journal)?;
                write_marker(&stage_path, "global_restore_started")?;
                let restored = GlobalManagerApplication::restore_backup(
                    &journal.global_database,
                    global_backup,
                    &format!("update-recovery-{}", safe_token(&journal.operation_id)),
                )
                .map_err(|error| {
                    CliError::unknown_delivery(
                        &journal.operation_id,
                        format!("Global recovery failed; package backup was retained: {error}"),
                    )
                })?;
                journal.recovered_global_database_id = Some(restored.current_database_id);
                journal.recovered_global_revision = Some(restored.current_revision);
                journal.stage = "global_restored".to_owned();
                write_journal(&journal_path, &journal)?;
                write_marker(&stage_path, "global_restored")?;
            }
        } else if journal.global_database.exists() {
            return Err(CliError::unknown_delivery(
                &journal.operation_id,
                "Global mutation may have started without a pre-update backup; package rollback was withheld",
            ));
        }
    }

    if package_backup_exists {
        restore_package_files(
            prefix,
            &journal.package_backup_ref,
            &journal.source_package_identity,
            &journal.operation_id,
        )?;
    } else if stage == "prepared" || stage == "preparing" || stage == "backup_complete" {
        // The installer did not publish anything. There is nothing to roll
        // back, and the source package must still be the active package.
        let source = read_install_identity(prefix, &prefix.join("bin/bwrk"))?;
        if identity_string(&source) != journal.source_package_identity {
            return Err(CliError::unknown_delivery(
                &journal.operation_id,
                "the source package changed before installer publication; recovery left it untouched",
            ));
        }
    } else {
        return Err(CliError::unknown_delivery(
            &journal.operation_id,
            "package backup is missing for an update that may have published files; recovery left the installation untouched",
        ));
    }
    journal.stage = "rolled_back".to_owned();
    write_journal(&journal_path, &journal)?;
    write_marker(&stage_path, "rolled_back")?;
    if package_backup_exists {
        let _ = fs::remove_dir_all(&journal.package_backup_ref);
    }
    Ok(journal_result(&journal, ApplicationOutcome::Changed, false))
}

fn installed_source_pair_is_compatible(
    journal: &UpdateJournal,
    expected: &InstallIdentity,
) -> Result<bool, CliError> {
    let installed = match read_install_identity(&journal.prefix, &journal.prefix.join("bin/bwrk")) {
        Ok(identity) => identity,
        Err(_) => return Ok(false),
    };
    if identity_string(&installed) != journal.source_package_identity
        || identity_string(expected) != journal.source_package_identity
    {
        return Ok(false);
    }
    if let Some(global_backup) = &journal.global_backup_ref {
        let source = GlobalManagerApplication::inspect_database(&journal.global_database).map_err(
            |error| CliError::unknown_delivery(&journal.operation_id, error.to_string()),
        )?;
        let expected_database_id = journal
            .recovered_global_database_id
            .as_deref()
            .or(journal.global_database_id.as_deref());
        if expected_database_id != Some(source.database_id.as_str())
            || Some(source.schema_version) != journal.global_schema_version
            || journal
                .recovered_global_revision
                .or(journal.global_revision)
                .is_some_and(|revision| source.revision < revision)
        {
            return Ok(false);
        }
        let _ = global_backup;
    } else if journal.global_database.exists() {
        return Ok(false);
    }
    Ok(true)
}

fn should_restore_global(journal: &UpdateJournal) -> Result<bool, CliError> {
    let source_id = journal.global_database_id.as_deref().ok_or_else(|| {
        CliError::unknown_delivery(
            &journal.operation_id,
            "Global backup journal has no database identity",
        )
    })?;
    let source_schema = journal.global_schema_version.ok_or_else(|| {
        CliError::unknown_delivery(
            &journal.operation_id,
            "Global backup journal has no schema version",
        )
    })?;
    let source_revision = journal.global_revision.ok_or_else(|| {
        CliError::unknown_delivery(
            &journal.operation_id,
            "Global backup journal has no revision",
        )
    })?;
    let active =
        GlobalManagerApplication::inspect_database(&journal.global_database).map_err(|error| {
            CliError::unknown_delivery(
                &journal.operation_id,
                format!("cannot inspect current Global database before recovery: {error}"),
            )
        })?;
    if journal.recovered_global_database_id.as_deref() == Some(active.database_id.as_str())
        && Some(active.schema_version) == journal.global_schema_version
        && journal
            .recovered_global_revision
            .is_some_and(|revision| active.revision >= revision)
    {
        return Ok(false);
    }
    if active.database_id == source_id && active.schema_version == source_schema {
        if active.revision >= source_revision {
            return Ok(false);
        }
    }
    if active.database_id == source_id
        && active.revision == source_revision
        && active.schema_version > source_schema
    {
        return Ok(true);
    }
    Err(CliError::unknown_delivery(
        &journal.operation_id,
        "Global data changed after the recovery snapshot or has an unexpected identity; package rollback was withheld",
    ))
}

fn package_backup_has_material(path: &Path) -> bool {
    [
        "bin/bwrk",
        "lib/boreal/tui",
        "apps/tui",
        "lib/boreal/global-tui",
        "apps/global-tui",
        "share/boreal/release.json",
        "share/boreal/LICENSE",
        "share/boreal/install.sh",
        ".published.binary",
        ".published.tui",
        ".published.tui_source",
        ".published.global_tui",
        ".published.global_tui_source",
        ".published.manifest",
        ".published.license",
        ".published.updater",
    ]
    .iter()
    .any(|relative| fs::symlink_metadata(path.join(relative)).is_ok())
}

fn readback_pair(journal: &UpdateJournal) -> Result<Option<InstallIdentity>, CliError> {
    let installed = match read_install_identity(&journal.prefix, &journal.prefix.join("bin/bwrk")) {
        Ok(identity) => identity,
        Err(_) => return Ok(None),
    };
    let active = match GlobalManagerApplication::inspect_database(&journal.global_database) {
        Ok(active) => active,
        Err(_) => return Ok(None),
    };
    if journal
        .global_schema_version
        .is_some_and(|source_version| active.schema_version < source_version)
    {
        return Ok(None);
    }
    let expected_global_id = journal
        .recovered_global_database_id
        .as_deref()
        .or(journal.global_database_id.as_deref());
    if expected_global_id.is_some_and(|source_id| active.database_id != source_id) {
        return Ok(None);
    }
    Ok(Some(installed))
}

fn read_install_identity(prefix: &Path, binary: &Path) -> Result<InstallIdentity, CliError> {
    let manifest_path = prefix.join("share/boreal/release.json");
    read_install_identity_files(binary, &manifest_path)
}

fn read_install_identity_files(
    binary: &Path,
    manifest_path: &Path,
) -> Result<InstallIdentity, CliError> {
    verify_regular_file(binary, "installed bwrk binary")?;
    verify_regular_file(manifest_path, "release manifest")?;
    let binary_bytes = read_bounded_file(binary, MAX_BINARY_BYTES)?;
    let manifest_bytes = read_bounded_file(manifest_path, MAX_RELEASE_BYTES)?;
    let manifest: Value = serde_json::from_slice(&manifest_bytes)
        .map_err(|error| CliError::invalid(format!("release manifest is invalid: {error}")))?;
    let version = manifest["version"]
        .as_str()
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CliError::invalid("release manifest has no version"))?
        .to_owned();
    if version.len() > 128 || version.chars().any(char::is_control) {
        return Err(CliError::invalid("release manifest version is invalid"));
    }
    let expected_binary = manifest
        .pointer("/binary/sha256")
        .and_then(Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| CliError::invalid("release manifest has no binary checksum"))?;
    let binary_digest = sha256_content_digest(&binary_bytes);
    if expected_binary != binary_digest {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "installed bwrk bytes do not match the release manifest",
        ));
    }
    Ok(InstallIdentity {
        version,
        binary_digest,
        manifest_digest: sha256_content_digest(&manifest_bytes),
    })
}

fn identity_string(identity: &InstallIdentity) -> String {
    format!(
        "{}:{}:{}",
        identity.version, identity.binary_digest, identity.manifest_digest
    )
}

fn installation_prefix() -> Result<PathBuf, CliError> {
    let executable = env::current_exe().map_err(|error| {
        CliError::with(
            ErrorCode::UnsupportedTarget,
            ApplicationOutcome::Rejected,
            format!("could not locate the running bwrk executable: {error}"),
        )
    })?;
    let executable = fs::canonicalize(&executable).map_err(|error| {
        CliError::with(
            ErrorCode::UnsupportedTarget,
            ApplicationOutcome::Rejected,
            format!("could not resolve the running bwrk executable: {error}"),
        )
    })?;
    let prefix = executable
        .parent()
        .filter(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy() == "bin")
        })
        .and_then(Path::parent)
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::UnsupportedTarget,
                ApplicationOutcome::Rejected,
                "machine update is available only from a prefix-installed bwrk binary",
            )
        })?;
    if prefix == Path::new("/") || prefix.join("bin/bwrk") != executable {
        return Err(CliError::invalid(
            "machine update installation prefix is invalid",
        ));
    }
    Ok(prefix.to_path_buf())
}

fn read_journal(path: &Path) -> Result<Option<UpdateJournal>, CliError> {
    if !path.exists() {
        return Ok(None);
    }
    verify_regular_file(path, "machine update journal")?;
    let bytes = read_bounded_file(path, MAX_JOURNAL_BYTES)?;
    let journal: UpdateJournal = serde_json::from_slice(&bytes).map_err(|error| {
        CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            format!("machine update journal is invalid: {error}"),
        )
    })?;
    if journal.format != "boreal.machine-update" || journal.format_version != 1 {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "machine update journal format is unsupported; no files were changed",
        ));
    }
    if journal.operation_id.is_empty()
        || journal.operation_id.len() > 128
        || journal
            .operation_id
            .chars()
            .any(|character| !(character.is_ascii_alphanumeric() || ":._+-".contains(character)))
    {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Unknown,
            "machine update journal operation identity is invalid",
        ));
    }
    Ok(Some(journal))
}

fn validate_journal_paths(journal: &UpdateJournal, prefix: &Path) -> Result<(), CliError> {
    if journal.prefix != prefix {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "machine update journal belongs to a different installation prefix",
        ));
    }
    let global_database = global_commands::global_db_path()?;
    let global_root = global_database
        .parent()
        .ok_or_else(|| CliError::invalid("Global database path has no data root"))?;
    if journal.global_database != global_database || journal.global_root != global_root {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "Global recovery journal belongs to a different invoking-user data root",
        ));
    }
    let state_root = prefix.join(".boreal-update");
    let operation_root = state_root.join(safe_token(&journal.operation_id));
    let expected_package_backup = operation_root.join("package-backup");
    if journal.package_backup_ref != expected_package_backup {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "package recovery path does not match the update operation",
        ));
    }
    reject_symlink(&state_root)?;
    reject_symlink(&state_root.join(GLOBAL_RESTORE_NAME))?;
    reject_symlink(&operation_root)?;
    reject_symlink(&journal.package_backup_ref)?;
    if let Some(global_backup) = &journal.global_backup_ref {
        let expected_global_backup = global_root
            .join(".boreal-recovery/update")
            .join(safe_token(&journal.operation_id));
        if *global_backup != expected_global_backup {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Rejected,
                "Global recovery path does not match the update operation",
            ));
        }
        reject_symlink(&global_backup.parent().unwrap_or(global_root).to_path_buf())?;
        reject_symlink(global_backup)?;
    }
    Ok(())
}

fn write_journal(path: &Path, journal: &UpdateJournal) -> Result<(), CliError> {
    let bytes = serde_json::to_vec_pretty(journal).map_err(|error| {
        CliError::invalid(format!("cannot encode machine update journal: {error}"))
    })?;
    atomic_replace(path, &bytes)
}

fn write_marker(path: &Path, value: &str) -> Result<(), CliError> {
    if !valid_stage(value) {
        return Err(CliError::invalid("unsupported machine update stage"));
    }
    atomic_replace(path, value.as_bytes())
}

fn read_stage(path: &Path) -> Result<Option<String>, CliError> {
    if !path.exists() {
        return Ok(None);
    }
    verify_regular_file(path, "machine update stage marker")?;
    let value = fs::read_to_string(path).map_err(|error| {
        CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            format!("cannot read machine update stage: {error}"),
        )
    })?;
    let value = value.trim().to_owned();
    if !valid_stage(&value) {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Unknown,
            "machine update stage marker is unknown; recovery was not attempted",
        ));
    }
    Ok(Some(value))
}

fn read_target_identity(path: &Path) -> Result<Option<String>, CliError> {
    if !path.exists() {
        return Ok(None);
    }
    verify_regular_file(path, "machine update target identity")?;
    let value = fs::read_to_string(path).map_err(|error| {
        CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            format!("cannot read target package identity: {error}"),
        )
    })?;
    let value = value.trim().to_owned();
    if value.is_empty() || value.len() > 512 || value.chars().any(char::is_control) {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Unknown,
            "target package identity is invalid",
        ));
    }
    Ok(Some(value))
}

fn apply_global_restore_marker(
    journal: &mut UpdateJournal,
    marker_path: &Path,
) -> Result<(), CliError> {
    let Some(bytes) = (|| {
        if !marker_path.exists() {
            return Ok(None);
        }
        verify_regular_file(marker_path, "Global restore identity marker")?;
        read_bounded_file(marker_path, MAX_JOURNAL_BYTES).map(Some)
    })()?
    else {
        return Ok(());
    };
    let marker: Value = serde_json::from_slice(&bytes).map_err(|error| {
        CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Unknown,
            format!("Global restore identity marker is invalid: {error}"),
        )
    })?;
    if marker["operation_id"].as_str() != Some(journal.operation_id.as_str()) {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "Global restore identity marker belongs to another machine update",
        ));
    }
    let database_id = marker["database_id"]
        .as_str()
        .filter(|value| {
            value.len() == 40
                && value.starts_with("restore-")
                && value[8..].bytes().all(|byte| byte.is_ascii_hexdigit())
        })
        .ok_or_else(|| {
            CliError::invalid("Global restore identity marker has an invalid database ID")
        })?;
    let revision = marker["revision"].as_u64().ok_or_else(|| {
        CliError::invalid("Global restore identity marker has an invalid revision")
    })?;
    if journal.global_revision != Some(revision) {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "Global restore identity marker revision does not match the pre-update backup",
        ));
    }
    let active = GlobalManagerApplication::inspect_database(&journal.global_database)
        .map_err(|error| CliError::unknown_delivery(&journal.operation_id, error.to_string()))?;
    if active.database_id != database_id
        || Some(active.schema_version) != journal.global_schema_version
        || active.revision != revision
    {
        return Err(CliError::unknown_delivery(
            &journal.operation_id,
            "Global restore identity marker does not match the active database; recovery was withheld",
        ));
    }
    journal.recovered_global_database_id = Some(database_id.to_owned());
    journal.recovered_global_revision = Some(revision);
    Ok(())
}

fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<(), CliError> {
    let parent = path
        .parent()
        .ok_or_else(|| CliError::invalid("journal path has no parent"))?;
    ensure_private_dir(parent)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let temporary = parent.join(format!(
        ".{}.{}.{}.tmp",
        safe_token(&path.display().to_string()),
        std::process::id(),
        nonce
    ));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary).map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot create journal staging file: {error}"),
        )
    })?;
    let result = (|| {
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        File::open(parent)?.sync_all()?;
        Ok::<_, std::io::Error>(())
    })();
    if result.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    result.map_err(|error| {
        CliError::with(
            ErrorCode::ServiceUnavailable,
            ApplicationOutcome::Failed,
            format!("cannot persist machine update journal: {error}"),
        )
    })
}

fn journal_result(
    journal: &UpdateJournal,
    outcome: ApplicationOutcome,
    replayed: bool,
) -> CliResult {
    CliResult {
        outcome,
        data: Some(json!({
            "active": !matches!(journal.stage.as_str(), "committed" | "rolled_back" | "aborted"),
            "operation_id": journal.operation_id,
            "stage": journal.stage,
            "prefix": journal.prefix,
            "source_package_identity": journal.source_package_identity,
            "target_package_identity": journal.target_package_identity,
            "global_root": journal.global_root,
            "global_database": journal.global_database,
            "global_schema_version": journal.global_schema_version,
            "global_database_id": journal.global_database_id,
            "recovered_global_database_id": journal.recovered_global_database_id,
            "recovered_global_revision": journal.recovered_global_revision,
            "global_revision": journal.global_revision,
            "global_backup_ref": journal.global_backup_ref,
            "package_backup_ref": journal.package_backup_ref,
            "replayed": replayed,
        })),
        as_of: Some(now()),
        ..CliResult::default()
    }
}

fn restore_package_files(
    prefix: &Path,
    backup: &Path,
    source_identity: &str,
    operation_id: &str,
) -> Result<(), CliError> {
    if !backup.starts_with(prefix) || backup == prefix {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "package backup path is outside the installation prefix",
        ));
    }
    reject_symlink(backup)?;
    for relative in ["bin", "lib", "lib/boreal", "apps", "share", "share/boreal"] {
        reject_symlink(&prefix.join(relative))?;
    }
    let backup_binary = backup.join("bin/bwrk");
    let active_binary = prefix.join("bin/bwrk");
    let candidate_binary = if fs::symlink_metadata(&backup_binary).is_ok() {
        backup_binary
    } else {
        active_binary
    };
    let backup_manifest = backup.join("share/boreal/release.json");
    let active_manifest = prefix.join("share/boreal/release.json");
    let candidate_manifest = if fs::symlink_metadata(&backup_manifest).is_ok() {
        backup_manifest
    } else {
        active_manifest
    };
    let candidate_identity = read_install_identity_files(&candidate_binary, &candidate_manifest)?;
    if identity_string(&candidate_identity) != source_identity {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "package recovery files do not match the journaled source identity",
        ));
    }
    let entries = [
        ("bin/bwrk", "binary"),
        ("lib/boreal/tui", "tui"),
        ("apps/tui", "tui_source"),
        ("lib/boreal/global-tui", "global_tui"),
        ("apps/global-tui", "global_tui_source"),
        ("share/boreal/release.json", "manifest"),
        ("share/boreal/LICENSE", "license"),
        ("share/boreal/install.sh", "updater"),
    ];
    for (relative, marker) in entries {
        let source = backup.join(relative);
        let target = prefix.join(relative);
        if fs::symlink_metadata(&source).is_ok() {
            let published = backup.join(format!(".published.{marker}"));
            match fs::remove_file(&published) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => return Err(io_failure(error)),
            }
            remove_any(&target)?;
            if let Some(parent) = target.parent() {
                fs::create_dir_all(parent).map_err(io_failure)?;
            }
            fs::rename(&source, &target).map_err(io_failure)?;
        } else if backup.join(format!(".published.{marker}")).exists() {
            remove_any(&target)?;
            fs::remove_file(backup.join(format!(".published.{marker}"))).map_err(io_failure)?;
        }
    }
    sync_dir(prefix)?;
    let restored = read_install_identity(prefix, &prefix.join("bin/bwrk"))?;
    if identity_string(&restored) != source_identity {
        return Err(CliError::unknown_delivery(
            operation_id,
            "package file recovery did not restore the journaled source identity",
        ));
    }
    Ok(())
}

fn reconcile_installer_lock(prefix: &Path) -> Result<(), CliError> {
    let lock = prefix.join(".bwrk-install.lock");
    let metadata = match fs::symlink_metadata(&lock) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(io_failure(error)),
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "installer lock is not a regular directory; it was left untouched",
        ));
    }
    let pid_path = lock.join("pid");
    verify_regular_file(&pid_path, "installer lock owner")?;
    let pid = fs::read_to_string(&pid_path).map_err(io_failure)?;
    let pid = pid.trim();
    if pid.is_empty() || !pid.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Unknown,
            "installer lock owner is invalid; it was left untouched",
        ));
    }
    let alive = Command::new("kill")
        .args(["-0", pid])
        .status()
        .is_ok_and(|status| status.success());
    if alive {
        return Err(CliError::with(
            ErrorCode::ServiceBusy,
            ApplicationOutcome::Busy,
            format!("installer process {pid} still owns the package lock"),
        ));
    }
    fs::remove_dir_all(&lock).map_err(io_failure)
}

fn remove_any(path: &Path) -> Result<(), CliError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || metadata.is_file() => {
            fs::remove_file(path).map_err(io_failure)
        }
        Ok(metadata) if metadata.is_dir() => fs::remove_dir_all(path).map_err(io_failure),
        Ok(_) => Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "cannot replace a special package path during recovery",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_failure(error)),
    }
}

fn verify_regular_file(path: &Path, label: &str) -> Result<(), CliError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| {
        CliError::with(
            ErrorCode::NotFound,
            ApplicationOutcome::Rejected,
            format!("{label} is unavailable at {}: {error}", path.display()),
        )
    })?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_BINARY_BYTES {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            format!("{label} is not a regular bounded file"),
        ));
    }
    Ok(())
}

fn reject_symlink(path: &Path) -> Result<(), CliError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            format!("recovery path must not be a symlink: {}", path.display()),
        )),
        Ok(_) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(io_failure(error)),
    }
}

fn read_bounded_file(path: &Path, maximum: u64) -> Result<Vec<u8>, CliError> {
    let metadata = fs::symlink_metadata(path).map_err(io_failure)?;
    if !metadata.file_type().is_file() || metadata.len() > maximum {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            format!(
                "file {} is not regular or exceeds its size limit",
                path.display()
            ),
        ));
    }
    let file = File::open(path).map_err(io_failure)?;
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(maximum + 1)
        .read_to_end(&mut bytes)
        .map_err(io_failure)?;
    if bytes.len() as u64 > maximum {
        return Err(CliError::invalid(format!(
            "file {} exceeds its size limit",
            path.display()
        )));
    }
    Ok(bytes)
}

fn ensure_private_dir(path: &Path) -> Result<(), CliError> {
    if let Ok(metadata) = fs::symlink_metadata(path) {
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Rejected,
                format!(
                    "private update directory is not a real directory: {}",
                    path.display()
                ),
            ));
        }
    }
    fs::create_dir_all(path).map_err(io_failure)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700)).map_err(io_failure)?;
    }
    Ok(())
}

fn sync_dir(path: &Path) -> Result<(), CliError> {
    File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(io_failure)
}

fn safe_token(value: &str) -> String {
    sha256_content_digest(value.as_bytes())
        .strip_prefix("sha256:")
        .unwrap_or("update")
        .to_owned()
}

fn valid_stage(value: &str) -> bool {
    matches!(
        value,
        "preparing"
            | "backup_complete"
            | "prepared"
            | "running"
            | "installer_starting"
            | "target_verified"
            | "package_publish_started"
            | "package_published"
            | "global_migration_started"
            | "global_migrated"
            | "global_restore_started"
            | "global_restored"
            | "package_rollback_started"
            | "rollback_started"
            | "installer_complete"
            | "rolled_back"
            | "recovery_required"
            | "committed"
            | "aborted"
    )
}

fn io_failure(error: std::io::Error) -> CliError {
    CliError::with(
        ErrorCode::ServiceUnavailable,
        ApplicationOutcome::Failed,
        error.to_string(),
    )
}

fn bounded_child_error(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .chars()
        .filter(|character| !character.is_control() || *character == '\n')
        .take(1200)
        .collect::<String>()
        .trim()
        .to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct RestoreGlobalRoot(Option<OsString>);

    impl Drop for RestoreGlobalRoot {
        fn drop(&mut self) {
            if let Some(root) = self.0.take() {
                env::set_var("BOREAL_GLOBAL_ROOT", root);
            } else {
                env::remove_var("BOREAL_GLOBAL_ROOT");
            }
        }
    }

    fn temp_root() -> PathBuf {
        env::temp_dir().join(format!(
            "boreal-machine-update-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock after epoch")
                .as_nanos()
        ))
    }

    fn parsed(values: &[&str]) -> ParsedCommand {
        super::super::parse(
            &values
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>(),
        )
        .expect("command parses")
    }

    #[test]
    fn machine_update_routes_precede_project_authority_and_reject_project_selectors() {
        let status = parsed(&["update", "status", "--json"]);
        let recover = parsed(&["update", "recover", "--yes", "--json"]);
        let alias = parsed(&["upgrade", "--machine", "--json"]);
        assert!(is_route(&status));
        assert!(is_route(&recover));
        assert!(is_route(&alias));
        assert!(super::super::parse(&["upgrade".to_owned()]).is_err());
        validate_machine_selectors(&status).unwrap();
        validate_machine_selectors(&recover).unwrap();
        validate_machine_selectors(&alias).unwrap();

        assert!(super::super::parse(&["update".to_owned(), "recover".to_owned()]).is_err());
        let mut project_scoped = status.clone();
        project_scoped.options.project = Some("example".into());
        assert!(validate_machine_selectors(&project_scoped).is_err());
        let mut explicit_database = status.clone();
        explicit_database.options.db_explicit = true;
        assert!(validate_machine_selectors(&explicit_database).is_err());
        let mut socket_scoped = status;
        socket_scoped.options.socket = Some("/tmp/boreal.sock".into());
        assert!(validate_machine_selectors(&socket_scoped).is_err());
    }

    #[test]
    fn update_journal_and_stage_markers_round_trip_atomically() {
        let root = temp_root();
        ensure_private_dir(&root).unwrap();
        let journal_path = root.join(JOURNAL_NAME);
        let stage_path = root.join(STAGE_NAME);
        let journal = UpdateJournal {
            format: "boreal.machine-update".into(),
            format_version: 1,
            operation_id: "fixture-update".into(),
            stage: "prepared".into(),
            prefix: root.clone(),
            source_package_identity: "source:binary:manifest".into(),
            target_package_identity: None,
            global_root: root.clone(),
            global_database: root.join("global.sqlite"),
            global_schema_version: Some(2),
            global_database_id: Some("global-id".into()),
            recovered_global_database_id: None,
            recovered_global_revision: None,
            global_revision: Some(4),
            global_backup_ref: Some(root.join("global-backup")),
            package_backup_ref: root.join("package-backup"),
            created_at: "fixture-time".into(),
        };
        write_journal(&journal_path, &journal).unwrap();
        write_marker(&stage_path, "prepared").unwrap();
        let loaded = read_journal(&journal_path).unwrap().unwrap();
        assert_eq!(loaded.operation_id, journal.operation_id);
        assert_eq!(
            loaded.source_package_identity,
            journal.source_package_identity
        );
        assert_eq!(loaded.global_database_id, journal.global_database_id);
        assert_eq!(loaded.global_revision, Some(4));
        assert_eq!(
            read_stage(&stage_path).unwrap().as_deref(),
            Some("prepared")
        );

        write_marker(&stage_path, "global_migration_started").unwrap();
        assert_eq!(
            read_stage(&stage_path).unwrap().as_deref(),
            Some("global_migration_started")
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn prepared_update_recovery_replays_only_after_source_package_readback() {
        let root = temp_root();
        let prefix = root.join("prefix");
        let state_root = prefix.join(".boreal-update");
        let global_root = root.join("global");
        ensure_private_dir(&prefix).unwrap();
        ensure_private_dir(&state_root).unwrap();
        ensure_private_dir(&global_root).unwrap();
        let previous_global_root = env::var_os("BOREAL_GLOBAL_ROOT");
        let _restore_environment = RestoreGlobalRoot(previous_global_root);
        env::set_var("BOREAL_GLOBAL_ROOT", &global_root);

        let binary = prefix.join("bin/bwrk");
        fs::create_dir_all(binary.parent().unwrap()).unwrap();
        fs::write(&binary, b"synthetic Boreal source executable").unwrap();
        let binary_digest = sha256_content_digest(&fs::read(&binary).unwrap());
        let manifest = prefix.join("share/boreal/release.json");
        fs::create_dir_all(manifest.parent().unwrap()).unwrap();
        let manifest_bytes = serde_json::to_vec(&json!({
            "version": "0.2.1",
            "binary": {"sha256": binary_digest},
        }))
        .unwrap();
        fs::write(&manifest, &manifest_bytes).unwrap();
        let identity = read_install_identity(&prefix, &binary).unwrap();
        let operation_id = "fixture-recovery";
        let package_backup_ref = state_root
            .join(safe_token(operation_id))
            .join("package-backup");
        let journal_path = state_root.join(JOURNAL_NAME);
        let stage_path = state_root.join(STAGE_NAME);
        let journal = UpdateJournal {
            format: "boreal.machine-update".into(),
            format_version: 1,
            operation_id: operation_id.into(),
            stage: "prepared".into(),
            prefix: prefix.clone(),
            source_package_identity: identity_string(&identity),
            target_package_identity: None,
            global_root: global_root.clone(),
            global_database: global_root.join("global.sqlite"),
            global_schema_version: None,
            global_database_id: None,
            recovered_global_database_id: None,
            recovered_global_revision: None,
            global_revision: None,
            global_backup_ref: None,
            package_backup_ref,
            created_at: "fixture-time".into(),
        };
        write_journal(&journal_path, &journal).unwrap();
        write_marker(&stage_path, "prepared").unwrap();

        let recovery = parsed(&["update", "recover", "--yes"]);
        let first = recover_result(&recovery, &prefix, &state_root, "fixture-recovery-retry")
            .expect("prepared operation is safely marked rolled back");
        assert_eq!(
            first.data.as_ref().unwrap()["stage"].as_str(),
            Some("rolled_back")
        );
        let replay = recover_result(&recovery, &prefix, &state_root, "fixture-recovery-retry")
            .expect("terminal replay verifies the source package and stays unchanged");
        assert_eq!(replay.outcome, ApplicationOutcome::Unchanged);
        assert_eq!(
            read_journal(&journal_path).unwrap().unwrap().stage,
            "rolled_back"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn installer_global_restore_marker_reconciles_fresh_database_identity() {
        let root = temp_root();
        let prefix = root.join("prefix");
        let state_root = prefix.join(".boreal-update");
        let global_root = root.join("global");
        ensure_private_dir(&state_root).unwrap();
        ensure_private_dir(&global_root).unwrap();
        let global_database = global_root.join("global.sqlite");
        let global_backup = global_root.join("global-backup");
        let app = GlobalManagerApplication::open(&global_database).unwrap();
        let backup =
            GlobalManagerApplication::backup_database_package_to(&global_database, &global_backup)
                .unwrap();
        drop(app);
        let operation_id = "fixture-paired-update";
        let restored = GlobalManagerApplication::restore_backup(
            &global_database,
            &global_backup,
            "update-recovery-fixture",
        )
        .unwrap();
        assert_ne!(restored.current_database_id, backup.database_id);

        let journal = UpdateJournal {
            format: "boreal.machine-update".into(),
            format_version: 1,
            operation_id: operation_id.into(),
            stage: "rolled_back".into(),
            prefix,
            source_package_identity: "source:binary:manifest".into(),
            target_package_identity: None,
            global_root,
            global_database,
            global_schema_version: Some(backup.schema_version),
            global_database_id: Some(backup.database_id),
            recovered_global_database_id: None,
            recovered_global_revision: None,
            global_revision: Some(backup.revision),
            global_backup_ref: Some(backup.package_path),
            package_backup_ref: state_root.join("package-backup"),
            created_at: "fixture-time".into(),
        };
        let marker_path = state_root.join(GLOBAL_RESTORE_NAME);
        atomic_replace(
            &marker_path,
            serde_json::to_vec(&json!({
                "operation_id": operation_id,
                "database_id": restored.current_database_id,
                "revision": restored.current_revision,
            }))
            .unwrap()
            .as_slice(),
        )
        .unwrap();
        let mut journal = journal;
        apply_global_restore_marker(&mut journal, &marker_path).unwrap();
        assert_eq!(
            journal.recovered_global_database_id.as_deref(),
            Some(restored.current_database_id.as_str())
        );
        assert_eq!(
            journal.recovered_global_revision,
            Some(restored.current_revision)
        );
        assert!(!should_restore_global(&journal).unwrap());
        let _ = fs::remove_dir_all(root);
    }
}
