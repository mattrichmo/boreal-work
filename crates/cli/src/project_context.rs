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
    let relative = target
        .strip_prefix(&root)
        .map_err(|_| CliError::invalid("path lies outside the selected project"))?;
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

pub(super) fn resolve(parsed: &ParsedCommand) -> Result<ProjectContext, CliError> {
    let cwd = fs::canonicalize(env::current_dir().map_err(|e| CliError::invalid(e.to_string()))?)
        .map_err(|e| CliError::invalid(e.to_string()))?;
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
    let identity = identities
        .context(&context.project_id)
        .map_err(|e| CliError::invalid(format!("project/database identity mismatch: {e}")))?;
    let binding = identities
        .workspace_binding(&context.project_id)
        .map_err(|e| CliError::invalid(format!("workspace identity mismatch: {e}")))?;
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

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    struct TempRoot(PathBuf);

    impl TempRoot {
        fn new() -> Self {
            static NEXT: AtomicUsize = AtomicUsize::new(0);
            let path = env::temp_dir().join(format!(
                "boreal-project-context-test-{}-{}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            fs::create_dir(&path).expect("unique temporary project root creates");
            Self(path)
        }
    }

    impl Drop for TempRoot {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn confinement_rejects_parent_traversal_and_absolute_foreign_paths() {
        let root = TempRoot::new();
        assert!(confined_path(&root.0, Path::new("../outside"), true).is_err());
        assert!(confined_path(&root.0, Path::new("/tmp/foreign-project/key"), true).is_err());
    }

    #[test]
    #[cfg(unix)]
    fn confinement_rejects_symlinked_credential_ancestor() {
        use std::os::unix::fs::symlink;

        let root = TempRoot::new();
        let foreign = TempRoot::new();
        fs::create_dir(root.0.join(".boreal")).expect("project metadata directory creates");
        symlink(&foreign.0, root.0.join(".boreal/credentials"))
            .expect("foreign credential directory symlink creates");

        assert!(confined_path(
            &root.0,
            Path::new(".boreal/credentials/operator.json"),
            true
        )
        .is_err());
    }
}
