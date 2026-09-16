use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn operation_show_reads_completed_create_operation() {
    let temp = TempDir::new("operation-readback");
    let database = temp.path().join("boreal.sqlite");

    let initialized = Command::new(binary())
        .current_dir(temp.path())
        .args(["init", "project-readback", "--db"])
        .arg(&database)
        .args(["--operation-id", "op-init-readback", "--json"])
        .output()
        .expect("init launches");
    assert_success(&initialized, "init");

    let created = Command::new(binary())
        .current_dir(temp.path())
        .args([
            "work",
            "create",
            "project-readback",
            "task-readback",
            "Read operation state",
            "--kind",
            "task",
            "--db",
        ])
        .arg(&database)
        .args(["--operation-id", "op-create-readback", "--json"])
        .output()
        .expect("work create launches");
    assert_success(&created, "work create");
    let created_envelope = envelope(&created);
    assert_eq!(created_envelope["operation_id"], "op-create-readback");
    assert_eq!(created_envelope["outcome"], "changed");
    assert_eq!(created_envelope["data"]["work_id"], "task-readback");

    let shown = Command::new(binary())
        .current_dir(temp.path())
        .args([
            "operation",
            "show",
            "project-readback",
            "op-create-readback",
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("operation show launches");
    assert_success(&shown, "operation show");
    let shown_envelope = envelope(&shown);

    assert_eq!(shown_envelope["transport"], "ok");
    assert_eq!(shown_envelope["outcome"], "changed");
    assert_eq!(shown_envelope["data"]["readback_required"], false);
    assert_eq!(
        shown_envelope["data"]["operation"]["operation_id"],
        "op-create-readback"
    );
    assert_eq!(
        shown_envelope["data"]["operation"]["project_id"],
        "project-readback"
    );
    assert_eq!(
        shown_envelope["data"]["operation"]["command"],
        "work.create"
    );
    assert_eq!(
        shown_envelope["data"]["operation"]["result"]["work_id"],
        "task-readback"
    );
    assert!(shown_envelope["data"]["execution"].is_null());

    let shown_with_explicit_project = Command::new(binary())
        .current_dir(temp.path())
        .args([
            "operation",
            "show",
            "--project",
            "project-readback",
            "op-create-readback",
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("operation show with explicit project launches");
    assert_success(
        &shown_with_explicit_project,
        "operation show with explicit project",
    );
    let explicit_envelope = envelope(&shown_with_explicit_project);
    assert_eq!(
        explicit_envelope["data"]["operation"]["operation_id"],
        "op-create-readback"
    );
    assert_eq!(explicit_envelope["data"]["readback_required"], false);
}

#[test]
fn operation_show_reports_missing_operation_through_public_error_envelope() {
    let temp = TempDir::new("operation-readback-missing");
    let database = temp.path().join("boreal.sqlite");

    let initialized = Command::new(binary())
        .current_dir(temp.path())
        .args(["init", "project-readback", "--db"])
        .arg(&database)
        .args(["--operation-id", "op-init-readback-missing", "--json"])
        .output()
        .expect("init launches");
    assert_success(&initialized, "init");

    let missing = Command::new(binary())
        .current_dir(temp.path())
        .args([
            "operation",
            "show",
            "project-readback",
            "op-does-not-exist",
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("operation show launches");
    assert_eq!(
        missing.status.code(),
        Some(3),
        "stderr: {}",
        text(&missing.stderr)
    );
    let missing_envelope = envelope(&missing);
    // The request was decoded and handled successfully at the transport
    // layer; the missing operation is an application-level rejection.
    assert_eq!(missing_envelope["transport"], "ok");
    assert_eq!(missing_envelope["outcome"], "rejected");
    assert_eq!(missing_envelope["error"]["code"], "not_found");
    assert!(missing_envelope["error"]["message"]
        .as_str()
        .is_some_and(|message| message.contains("op-does-not-exist")));
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn envelope(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout was not a JSON envelope: {error}; stdout={}; stderr={}",
            text(&output.stdout),
            text(&output.stderr)
        )
    })
}

fn assert_success(output: &Output, operation: &str) {
    assert!(
        output.status.success(),
        "{operation} failed with {:?}: stdout={} stderr={}",
        output.status.code(),
        text(&output.stdout),
        text(&output.stderr)
    );
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is after the Unix epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "boreal-cli-{prefix}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).expect("temporary directory creates");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
