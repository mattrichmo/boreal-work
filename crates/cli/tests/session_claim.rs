use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

const PROJECT: &str = "session-claim-project";
const OPERATOR: &str = "session-claim-operator";
const HARNESS: &str = "session-claim-regression";
const SESSION: &str = "registered-operator-session";
const FIRST_CLAIM_SESSION: &str = "first-claim-session";

struct TempDir(PathBuf);

impl TempDir {
    fn new(label: &str) -> Self {
        for attempt in 0..64_u32 {
            let stamp = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock is after epoch")
                .as_nanos();
            let path = std::env::temp_dir().join(format!(
                "boreal-{label}-{}-{stamp}-{attempt}",
                std::process::id()
            ));
            match fs::create_dir(&path) {
                Ok(()) => return Self(path),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(error) => panic!("create temporary project directory: {error}"),
            }
        }
        panic!("temporary project directory name did not become unique");
    }

    fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

fn invoke(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(args)
        .output()
        .expect("bwrk starts")
}

fn envelope(output: &Output, action: &str) -> Value {
    assert!(
        output.status.success(),
        "{action} failed: stdout={}, stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "{action} did not return a JSON envelope: {error}; stdout={}, stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

#[test]
fn claim_reuses_registered_session_and_first_claim_registration_replays_stably() {
    let temp = TempDir::new("session-claim");
    let root = temp.path();
    let database = root.join(".boreal/boreal.sqlite");

    let initialized = invoke(
        root,
        &[
            "init",
            PROJECT,
            "--actor",
            OPERATOR,
            "--db",
            database.to_str().expect("database path is UTF-8"),
            "--operation-id",
            "op-session-claim-init",
            "--json",
        ],
    );
    envelope(&initialized, "init");

    let registered = invoke(
        root,
        &[
            "session",
            "start",
            "--project",
            PROJECT,
            "--actor",
            OPERATOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--db",
            database.to_str().expect("database path is UTF-8"),
            "--operation-id",
            "op-session-claim-register-session",
            "--json",
        ],
    );
    let registered = envelope(&registered, "session start");
    assert_eq!(registered["data"]["session_id"], SESSION);
    assert_eq!(registered["data"]["state"], "active");

    let source_file = root.join("claim-source.md");
    fs::write(&source_file, "A small source bound to this claim test.\n")
        .expect("write source file");
    let captured = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(["source", "add", PROJECT, "--input"])
        .arg(&source_file)
        .args(["--origin", "claim-source.md", "--actor", OPERATOR, "--db"])
        .arg(&database)
        .args([
            "--operation-id",
            "op-session-claim-capture-source",
            "--json",
        ])
        .output()
        .expect("source add starts");
    let captured = envelope(&captured, "source add");
    let source_version = captured["data"]["source"]["source_version_id"]
        .as_str()
        .expect("source add returns a registered source version")
        .to_owned();

    let expected_revision = captured["revision"]
        .as_u64()
        .expect("source registration returns the current project revision")
        .to_string();
    let created = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args([
            "work",
            "create",
            PROJECT,
            "operator-only-task",
            "Claim from an existing session",
            "--kind",
            "task",
            "--dispatch",
            "operator_only",
            "--actor",
            OPERATOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--expected-revision",
            &expected_revision,
            "--db",
        ])
        .arg(&database)
        .args(["--operation-id", "op-session-claim-create-task", "--json"])
        .output()
        .expect("work create starts");
    let created = envelope(&created, "work create");
    assert_eq!(created["data"]["work_id"], "operator-only-task");

    let claim = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args([
            "work",
            "claim",
            PROJECT,
            "operator-only-task",
            "--actor",
            OPERATOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--source-version",
            &source_version,
            "--config-identity",
            "session-claim-config-v1",
            "--db",
        ])
        .arg(&database)
        .args(["--operation-id", "op-session-claim-claim-task", "--json"])
        .output()
        .expect("work claim starts");
    let claim = envelope(&claim, "work claim");

    assert_ne!(
        claim["operation_id"], registered["operation_id"],
        "claim must use its own operation ID instead of re-registering the session"
    );
    assert_eq!(claim["operation_id"], "op-session-claim-claim-task");
    assert_eq!(claim["outcome"], "changed");
    assert_eq!(claim["data"]["phase"], "claimed");
    assert!(
        claim["data"]["attempt_id"]
            .as_str()
            .is_some_and(|attempt_id| !attempt_id.is_empty()),
        "claim returns the claimed attempt ID: {claim}"
    );
    assert!(
        claim["data"]["fence"]
            .as_u64()
            .is_some_and(|fence| fence > 0),
        "claim returns a positive attempt fence: {claim}"
    );

    let replay = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args([
            "work",
            "claim",
            PROJECT,
            "operator-only-task",
            "--actor",
            OPERATOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--source-version",
            &source_version,
            "--config-identity",
            "session-claim-config-v1",
            "--db",
        ])
        .arg(&database)
        .args(["--operation-id", "op-session-claim-claim-task", "--json"])
        .output()
        .expect("replay work claim starts");
    let replay = envelope(&replay, "replay work claim");
    assert_eq!(replay["operation_id"], claim["operation_id"]);
    assert_eq!(replay["data"]["attempt_id"], claim["data"]["attempt_id"]);
    assert_eq!(replay["data"]["fence"], claim["data"]["fence"]);

    let first_task = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args([
            "work",
            "create",
            PROJECT,
            "first-claim-task",
            "Claim creates its first session",
            "--kind",
            "task",
            "--dispatch",
            "operator_only",
            "--actor",
            OPERATOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--expected-revision",
            &claim["revision"]
                .as_u64()
                .expect("claim returns project revision")
                .to_string(),
            "--db",
        ])
        .arg(&database)
        .args([
            "--operation-id",
            "op-session-claim-create-first-task",
            "--json",
        ])
        .output()
        .expect("first-claim task creation starts");
    envelope(&first_task, "first-claim task creation");

    let first_claim_args = [
        "work",
        "claim",
        PROJECT,
        "first-claim-task",
        "--actor",
        OPERATOR,
        "--harness",
        HARNESS,
        "--session",
        FIRST_CLAIM_SESSION,
        "--source-version",
        &source_version,
        "--config-identity",
        "session-claim-config/v1",
        "--db",
    ];
    let first_claim = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(first_claim_args)
        .arg(&database)
        .args(["--operation-id", "op-session-claim-first-claim", "--json"])
        .output()
        .expect("first claim starts");
    let first_claim = envelope(&first_claim, "first claim");

    // The same operation ID reads back the original attempt and fence rather
    // than trying to acquire a second attempt in the registered session.
    let first_claim_replay = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(first_claim_args)
        .arg(&database)
        .args(["--operation-id", "op-session-claim-first-claim", "--json"])
        .output()
        .expect("first claim replay starts");
    let first_claim_replay = envelope(&first_claim_replay, "first claim replay");
    assert_eq!(
        first_claim_replay["data"]["attempt_id"],
        first_claim["data"]["attempt_id"]
    );
    assert_eq!(
        first_claim_replay["data"]["fence"],
        first_claim["data"]["fence"]
    );

    // Reusing the same operation ID with a different registration
    // precondition must not silently inherit the original session identity.
    let changed_revision = first_claim["revision"]
        .as_u64()
        .expect("first claim returns project revision")
        .to_string();
    let conflicting_replay = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(&first_claim_args[..first_claim_args.len() - 1])
        .args(["--expected-revision", &changed_revision, "--db"])
        .arg(&database)
        .args(["--operation-id", "op-session-claim-first-claim", "--json"])
        .output()
        .expect("conflicting first claim replay starts");
    assert!(
        !conflicting_replay.status.success(),
        "changed expected revision must reject operation replay: stdout={}, stderr={}",
        String::from_utf8_lossy(&conflicting_replay.stdout),
        String::from_utf8_lossy(&conflicting_replay.stderr)
    );
    let conflicting_replay: Value = serde_json::from_slice(&conflicting_replay.stdout)
        .expect("conflicting replay returns a JSON error envelope");
    assert_eq!(conflicting_replay["error"]["code"], "claim_conflict");
    assert!(conflicting_replay["error"]["message"]
        .as_str()
        .is_some_and(|message| message.contains("another immutable identity")));
}
