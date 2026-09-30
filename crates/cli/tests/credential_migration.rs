//! Exercises the explicit local recovery and legacy enrollment commands on a
//! disposable initialized project. This is not an installed-release claim.

#![cfg(unix)]

use boreal_domain::TimestampMs;
use boreal_store::identity::{IdentityStore, WorkspaceBinding};
use boreal_store::{checksum, SqliteStore};
use serde_json::{json, Value};
use std::fs;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicUsize, Ordering};

const PRODUCTION_SCHEMA: &str = include_str!("../../../project/spec/schema-production.sql");

struct TempProject(PathBuf);

impl TempProject {
    fn new() -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!(
            "boreal-cli-credential-migration-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir(&root).expect("unique temporary project directory creates");
        Self(root)
    }
}

impl Drop for TempProject {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn run_cli(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .args(args)
        .current_dir(root)
        .output()
        .expect("bwrk process starts")
}

fn local_key(root: &Path, actor: &str) -> Value {
    let digest = checksum(actor.as_bytes()).replace(':', "-");
    let path = root
        .join(".boreal/credentials")
        .join(format!("{digest}.json"));
    serde_json::from_slice(&fs::read(path).expect("local key file exists"))
        .expect("local key file is JSON")
}

#[test]
fn pre_key_project_bootstraps_a_new_operator_then_explicitly_enrolls_legacy_agent() {
    let project = TempProject::new();
    let root = project
        .0
        .canonicalize()
        .expect("project root canonicalizes");
    let boreal_dir = root.join(".boreal");
    fs::create_dir(&boreal_dir).expect("project metadata directory creates");
    fs::set_permissions(&boreal_dir, fs::Permissions::from_mode(0o700))
        .expect("project metadata directory is private");

    let project_id = format!("legacy-project-{}", std::process::id());
    let database_path = boreal_dir.join("boreal.sqlite");
    let binding = WorkspaceBinding::new(
        root.to_string_lossy(),
        root.to_string_lossy(),
        "sha256:credential-migration-binding",
    )
    .expect("workspace binding is valid");
    let store =
        SqliteStore::open(&database_path, PRODUCTION_SCHEMA).expect("production database opens");
    let database_identity = IdentityStore::new(&store)
        .database_identity()
        .expect("database open establishes its instance identity");
    store
        .initialize_project_with_workspace(
            &project_id,
            "legacy-agent",
            "agent",
            "historical-os-user:legacy-agent",
            "Historical OS user",
            "op-legacy-init",
            "sha256:legacy-init",
            &database_identity,
            &binding,
            "unix-ms:1",
        )
        .expect("pre-key project with legacy actor initializes");
    let initial_revision = store.project_revision(&project_id).unwrap().0;
    drop(store);

    fs::write(
        boreal_dir.join("project.json"),
        serde_json::to_vec(&json!({
            "project_id": project_id,
            "project_root": root,
            "database": ".boreal/boreal.sqlite"
        }))
        .unwrap(),
    )
    .expect("project metadata writes");
    let initial_revision_text = initial_revision.to_string();

    let accidental_promotion = run_cli(
        &root,
        &[
            "auth",
            "bootstrap",
            "--actor",
            "legacy-agent",
            "--expected-revision",
            &initial_revision_text,
            "--reason",
            "Recover old project authority",
            "--yes",
            "--json",
        ],
    );
    assert!(!accidental_promotion.status.success());
    let accidental_promotion_output = format!(
        "{}{}",
        String::from_utf8_lossy(&accidental_promotion.stdout),
        String::from_utf8_lossy(&accidental_promotion.stderr)
    );
    assert!(
        accidental_promotion_output.contains("cannot promote a historical actor identity"),
        "unexpected bootstrap rejection: {accidental_promotion_output}"
    );
    let store = SqliteStore::open(&database_path, PRODUCTION_SCHEMA).unwrap();
    assert!(!store.has_project_principals(&project_id).unwrap());
    assert_eq!(
        store.project_revision(&project_id).unwrap().0,
        initial_revision
    );
    drop(store);

    let bootstrap = run_cli(
        &root,
        &[
            "auth",
            "bootstrap",
            "--actor",
            "recovered-operator",
            "--expected-revision",
            &initial_revision_text,
            "--reason",
            "Recover old project authority",
            "--yes",
            "--json",
        ],
    );
    assert!(
        bootstrap.status.success(),
        "bootstrap failed: {}",
        String::from_utf8_lossy(&bootstrap.stderr)
    );
    let operator_key = local_key(&root, "recovered-operator")["credential"]
        .as_str()
        .unwrap()
        .to_owned();

    let key_creation = run_cli(&root, &["auth", "key", "--actor", "legacy-agent", "--json"]);
    assert!(
        key_creation.status.success(),
        "key creation failed: {}",
        String::from_utf8_lossy(&key_creation.stderr)
    );
    let legacy_key = local_key(&root, "legacy-agent")["credential"]
        .as_str()
        .unwrap()
        .to_owned();
    let enrollment_path = boreal_dir.join("credentials/enrollment.json");
    let mut enrollment = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&enrollment_path)
        .expect("owner-only enrollment file creates");
    use std::io::Write;
    enrollment
        .write_all(
            &serde_json::to_vec(&json!({
                "project_id": project_id,
                "actor_id": "legacy-agent",
                "credential": legacy_key,
                "role": "agent",
                "display_name": "Historical OS user"
            }))
            .unwrap(),
        )
        .unwrap();
    enrollment.sync_all().unwrap();
    drop(enrollment);

    let store = SqliteStore::open(&database_path, PRODUCTION_SCHEMA).unwrap();
    let revision = store.project_revision(&project_id).unwrap().0.to_string();
    drop(store);
    let enrollment_arg = enrollment_path
        .strip_prefix(&root)
        .unwrap()
        .to_string_lossy()
        .into_owned();
    let granted = run_cli(
        &root,
        &[
            "auth",
            "grant",
            "--actor",
            "recovered-operator",
            "--input",
            &enrollment_arg,
            "--expected-revision",
            &revision,
            "--reason",
            "Explicitly migrate historical agent access",
            "--yes",
            "--json",
        ],
    );
    assert!(
        granted.status.success(),
        "legacy actor grant failed: {}",
        String::from_utf8_lossy(&granted.stderr)
    );

    let store = SqliteStore::open(&database_path, PRODUCTION_SCHEMA).unwrap();
    let migrated = store
        .authenticate_principal(&project_id, &legacy_key, TimestampMs(5))
        .expect("explicitly enrolled legacy actor has a project credential");
    assert_eq!(migrated.actor_id, "legacy-agent");
    assert_eq!(migrated.role, boreal_domain::ActorRole::Agent);
    assert_eq!(migrated.authority_root, "recovered-operator");
    assert!(store
        .authenticate_principal(&project_id, &operator_key, TimestampMs(5))
        .is_ok());
    store
        .ensure_actor(
            "legacy-agent",
            "agent",
            "historical-os-user:legacy-agent",
            "Historical OS user",
            "unix-ms:1",
        )
        .expect("legacy actor attributes remain unchanged");
}
