//! Project selection and path confinement shared by every local adapter.
//! Absence of local metadata is never permission to select another database.
use super::*;
use serde::Deserialize;
use std::path::Component;

#[derive(Clone, Debug)]
pub(super) struct ProjectContext {
    pub project_id: String,
    pub root: PathBuf,
    pub database: PathBuf,
}

#[derive(Deserialize)]
struct Metadata {
    project_id: String,
    project_root: PathBuf,
    database: PathBuf,
}

pub(super) fn confined_path(
    root: &Path,
    path: &Path,
    allow_missing: bool,
) -> Result<PathBuf, CliError> {
    if path.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err(CliError::invalid(
            "parent traversal is not permitted in project paths",
        ));
    }
    let root = fs::canonicalize(root)
        .map_err(|e| CliError::invalid(format!("project root unavailable: {e}")))?;
    let target = if path.is_absolute() {
        path.to_path_buf()
    } else {
        root.join(path)
    };
    let relative = relative_below_root(&root, &target).ok_or_else(|| {
        CliError::invalid(format!(
            "path {} lies outside the selected project {}",
            target.display(),
            root.display()
        ))
    })?;
    let mut checked = root.clone();
    for part in relative.components() {
        if matches!(part, Component::CurDir) {
            continue;
        }
        if !matches!(part, Component::Normal(_)) {
            return Err(CliError::invalid("invalid project path component"));
        }
        checked.push(part.as_os_str());
        match fs::symlink_metadata(&checked) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(CliError::invalid(format!(
                    "project path may not traverse a symlink: {}",
                    checked.display()
                )))
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && allow_missing => {}
            Err(error) => {
                return Err(CliError::invalid(format!(
                    "project path unavailable {}: {error}",
                    checked.display()
                )))
            }
        }
    }
    Ok(checked)
}

/// Finds the path suffix below the canonical project root. macOS commonly
/// exposes `/var` as a symlink to `/private/var`; a path written through the
/// former must still match a root canonicalized through the latter. Walk to
/// the physical root boundary first, then check every remaining component
/// lexically so an in-project symlink is still rejected below.
fn relative_below_root(root: &Path, target: &Path) -> Option<PathBuf> {
    if let Ok(relative) = target.strip_prefix(root) {
        return Some(relative.to_path_buf());
    }

    let components = target.components().collect::<Vec<_>>();
    let mut prefix = PathBuf::new();
    for (index, component) in components.iter().enumerate() {
        prefix.push(component.as_os_str());
        if fs::canonicalize(&prefix).ok().as_deref() == Some(root) {
            let mut relative = PathBuf::new();
            for component in components.iter().skip(index + 1) {
                relative.push(component.as_os_str());
            }
            return Some(relative);
        }
    }
    None
}

pub(super) fn resolve(parsed: &ParsedCommand) -> Result<ProjectContext, CliError> {
    #[cfg(test)]
    if let Some(fixture_root) = super::test_fixture_project_root(parsed) {
        return resolve_from(parsed, &fixture_root);
    }
    let cwd = env::current_dir().map_err(|e| CliError::invalid(e.to_string()))?;
    resolve_from(parsed, &cwd)
}

/// Resolves local project scope from an explicit starting directory. The
/// production adapter passes the process cwd through `resolve`; unit tests
/// use this form to exercise isolated temporary project roots without
/// mutating process-global cwd while Rust tests run in parallel.
pub(super) fn resolve_from(
    parsed: &ParsedCommand,
    working_directory: &Path,
) -> Result<ProjectContext, CliError> {
    let cwd = fs::canonicalize(working_directory).map_err(|e| CliError::invalid(e.to_string()))?;
    let root = cwd
        .ancestors()
        .find(|p| p.join(".boreal/project.json").exists())
        .ok_or_else(|| {
            CliError::with(
                ErrorCode::NotFound,
                ApplicationOutcome::Rejected,
                "this directory is not initialized for Boreal; run `bwrk init` here first",
            )
        })?
        .to_path_buf();
    let metadata_path = confined_path(&root, Path::new(".boreal/project.json"), false)?;
    let metadata: Metadata = serde_json::from_slice(
        &fs::read(metadata_path).map_err(|e| CliError::invalid(e.to_string()))?,
    )
    .map_err(|e| CliError::invalid(format!("project metadata is invalid: {e}")))?;
    let declared_root = if metadata.project_root.is_absolute() {
        metadata.project_root
    } else {
        root.join(metadata.project_root)
    };
    if metadata.project_id.trim().is_empty()
        || fs::canonicalize(&declared_root).map_err(|e| CliError::invalid(e.to_string()))? != root
    {
        return Err(CliError::invalid(
            "project metadata is not bound to this directory",
        ));
    }
    if parsed
        .options
        .project
        .as_deref()
        .is_some_and(|p| p != metadata.project_id)
    {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "--project does not match the initialized local project",
        ));
    }
    let database = confined_path(&root, &metadata.database, false)?;
    if !database.is_file() {
        return Err(CliError::invalid("initialized project database is missing"));
    }
    if parsed.options.db != ".boreal/boreal.sqlite" {
        let explicit = PathBuf::from(&parsed.options.db);
        let explicit = if explicit.is_absolute() {
            explicit
        } else {
            cwd.join(explicit)
        };
        if confined_path(&root, &explicit, false)? != database {
            return Err(CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Rejected,
                "--db does not match the initialized project database",
            ));
        }
    }
    if let Some(socket) = parsed.options.socket.as_deref() {
        confined_path(&root, Path::new(socket), parsed.path == ["service", "run"])?;
    }
    Ok(ProjectContext {
        project_id: metadata.project_id,
        root,
        database,
    })
}

pub(super) fn validate_store(
    context: &ProjectContext,
    store: &SqliteStore,
) -> Result<(), CliError> {
    let identities = boreal_store::identity::IdentityStore::new(store);
    let identity = identities.context(&context.project_id).map_err(|e| {
        CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            format!("workspace identity binding is invalid: {e}"),
        )
    })?;
    let binding = identities
        .workspace_binding(&context.project_id)
        .map_err(|e| {
            CliError::with(
                ErrorCode::OperationConflict,
                ApplicationOutcome::Rejected,
                format!("workspace identity binding is invalid: {e}"),
            )
        })?;
    if Path::new(binding.canonical_root()) != context.root
        || !Path::new(binding.canonical_worktree()).starts_with(&context.root)
    {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "database belongs to a different workspace",
        ));
    }
    if store.list_project_ids().map_err(map_store_error)? != vec![context.project_id.clone()] {
        return Err(CliError::with(
            ErrorCode::OperationConflict,
            ApplicationOutcome::Rejected,
            "project-local database must contain exactly its bound project",
        ));
    }
    let _ = identity; // Reading it also validates database instance and restore epoch.
    Ok(())
}
