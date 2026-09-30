//! Owner-only local credential files. Secrets never appear in command arguments,
//! display output, operation receipts or application error messages.
use super::*;
use serde::{Deserialize, Serialize};
use std::io::Read;

#[derive(Serialize, Deserialize)]
struct CredentialFile {
    schema_version: String,
    project_id: String,
    actor_id: String,
    credential: String,
}

fn key_path(root: &Path, actor: &str) -> Result<PathBuf, CliError> {
    let digest = boreal_store::checksum(actor.as_bytes()).replace(':', "-");
    project_context::confined_path(
        root,
        &PathBuf::from(format!(".boreal/credentials/{digest}.json")),
        true,
    )
}

#[cfg(unix)]
pub(super) fn check_owner(path: &Path) -> Result<(), CliError> {
    use std::os::unix::fs::MetadataExt;
    unsafe extern "C" {
        fn geteuid() -> u32;
    }
    let metadata = fs::symlink_metadata(path).map_err(|e| CliError::invalid(e.to_string()))?;
    if metadata.file_type().is_symlink()
        || metadata.uid() != unsafe { geteuid() }
        || metadata.mode() & 0o077 != 0
    {
        return Err(CliError::with(ErrorCode::PermissionDenied,ApplicationOutcome::Rejected,format!("credential/runtime path must be owned by this user and private (0700 directory or 0600 file): {}",path.display())));
    }
    Ok(())
}
#[cfg(not(unix))]
pub(super) fn check_owner(_path: &Path) -> Result<(), CliError> {
    Err(CliError::with(
        ErrorCode::UnsupportedPlatform,
        ApplicationOutcome::Rejected,
        "project-key ownership verification currently requires a Unix platform",
    ))
}

pub(super) fn load(root: &Path, project: &str, actor: &str) -> Result<String, CliError> {
    if let Ok(secret) = env::var("BOREAL_CREDENTIAL") {
        boreal_store::principals::credential_digest(project, &secret).map_err(map_store_error)?;
        return Ok(secret);
    }
    let path = key_path(root, actor)?;
    check_owner(
        path.parent()
            .ok_or_else(|| CliError::invalid("credential parent missing"))?,
    )?;
    check_owner(&path)?;
    let encoded=fs::read(&path).map_err(|_| CliError::with(ErrorCode::PermissionDenied,ApplicationOutcome::Rejected,"no local credential for this project/actor; enroll a key or use `bwrk auth bootstrap` for a pre-key workspace"))?;
    let file: CredentialFile = serde_json::from_slice(&encoded)
        .map_err(|_| CliError::invalid("local credential file is malformed"))?;
    if file.schema_version != "boreal.local-credential.v1"
        || file.project_id != project
        || file.actor_id != actor
    {
        return Err(CliError::with(
            ErrorCode::PermissionDenied,
            ApplicationOutcome::Rejected,
            "local credential belongs to a different project or actor",
        ));
    }
    boreal_store::principals::credential_digest(project, &file.credential)
        .map_err(map_store_error)?;
    Ok(file.credential)
}

pub(super) fn for_command(parsed: &ParsedCommand) -> Result<String, CliError> {
    let context = project_context::resolve(parsed)?;
    load(&context.root, &context.project_id, &parsed.options.actor)
}

pub(super) fn create(root: &Path, project: &str, actor: &str) -> Result<String, CliError> {
    use std::io::Write;
    let path = key_path(root, actor)?;
    if path.exists() {
        return load(root, project, actor);
    }
    let runtime = project_context::confined_path(root, Path::new(".boreal"), true)?;
    let parent = path
        .parent()
        .ok_or_else(|| CliError::invalid("credential parent missing"))?;
    fs::create_dir_all(parent).map_err(|e| CliError::invalid(e.to_string()))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700))
            .map_err(|e| CliError::invalid(e.to_string()))?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))
            .map_err(|e| CliError::invalid(e.to_string()))?;
    }
    check_owner(parent)?;
    let mut random = [0u8; 32];
    fs::File::open("/dev/urandom")
        .and_then(|mut f| f.read_exact(&mut random))
        .map_err(|_| {
            CliError::with(
                ErrorCode::UnsupportedPlatform,
                ApplicationOutcome::Rejected,
                "secure operating-system randomness unavailable; no credential was generated",
            )
        })?;
    let secret = format!(
        "bwrk1_{}",
        random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>()
    );
    let file = CredentialFile {
        schema_version: "boreal.local-credential.v1".into(),
        project_id: project.into(),
        actor_id: actor.into(),
        credential: secret.clone(),
    };
    let encoded =
        serde_json::to_vec(&file).map_err(|_| CliError::invalid("cannot encode credential"))?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut destination = options.open(&path).map_err(|_| {
        CliError::invalid("credential file already exists or cannot be created safely")
    })?;
    destination
        .write_all(&encoded)
        .and_then(|_| destination.sync_all())
        .map_err(|_| {
            CliError::invalid(
                "credential file write failed; inspect local key before retrying bootstrap",
            )
        })?;
    Ok(secret)
}

pub(super) fn authenticate(
    parsed: &ParsedCommand,
    store: &SqliteStore,
) -> Result<boreal_store::principals::AuthenticatedPrincipal, CliError> {
    let context = project_context::resolve(parsed)?;
    project_context::validate_store(&context, store)?;
    let secret = load(&context.root, &context.project_id, &parsed.options.actor)?;
    let principal = store
        .authenticate_principal(&context.project_id, &secret, TimestampMs(now_ms_u64()))
        .map_err(|_| {
            CliError::with(
                ErrorCode::PermissionDenied,
                ApplicationOutcome::Rejected,
                "project credential is unknown, expired or revoked",
            )
        })?;
    if principal.actor_id != parsed.options.actor {
        return Err(CliError::with(
            ErrorCode::PermissionDenied,
            ApplicationOutcome::Rejected,
            "credential does not authorize the selected actor",
        ));
    }
    Ok(principal)
}
