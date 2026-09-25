//! Public release acceptance for doctor and bounded status output.

use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn temporary_root() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("boreal-cli-release-{}-{stamp}", std::process::id()))
}

fn envelope(output: &std::process::Output) -> Value {
    assert!(
        output.status.success(),
        "command failed: status={:?}\nstdout={}\nstderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("command emits JSON")
}

#[test]
fn doctor_reports_schema_runtime_and_bounded_status_payload() {
    let root = temporary_root();
    fs::create_dir_all(&root).expect("temporary root");
    let database = root.join("boreal.sqlite");
    let binary = env!("CARGO_BIN_EXE_bwrk");

    let initialized = Command::new(binary)
        .current_dir(&root)
        .args([
            "init",
            "release-project",
            "--actor",
            "release-agent",
            "--db",
        ])
        .arg(&database)
        .args(["--operation-id", "release-init", "--json"])
        .output()
        .expect("init starts");
    let _ = envelope(&initialized);

    let session = Command::new(binary)
        .current_dir(&root)
        .args([
            "session",
            "start",
            "--project",
            "release-project",
            "--actor",
            "release-agent",
            "--harness",
            "release-acceptance-test",
            "--session",
            "release-session",
            "--db",
        ])
        .arg(&database)
        .args(["--operation-id", "release-session-start", "--json"])
        .output()
        .expect("session start starts");
    let session_value = envelope(&session);
    let mut expected_revision = session_value["revision"]
        .as_u64()
        .expect("session start returns the project revision");

    let doctor = Command::new(binary)
        .current_dir(&root)
        .args([
            "doctor",
            "--project",
            "release-project",
            "--actor",
            "release-agent",
            "--harness",
            "release-acceptance-test",
            "--session",
            "release-session",
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("doctor starts");
    let doctor_value = envelope(&doctor);
    assert_eq!(doctor_value["data"]["checks"]["database_open"], "pass");
    assert!(
        doctor_value["data"]["checks"]["sqlite_runtime"]["libversion"]
            .as_str()
            .is_some_and(|value| !value.is_empty())
    );
    assert_eq!(doctor_value["data"]["repair"]["available"], false);

    for index in 0..32 {
        let work_id = format!("work-{index}");
        let expected_revision_arg = expected_revision.to_string();
        let created = Command::new(binary)
            .current_dir(&root)
            .args(["work", "create", "release-project"])
            .arg(&work_id)
            .args(["release acceptance item", "--actor", "release-agent"])
            .args(["--session", "release-session", "--expected-revision"])
            .arg(&expected_revision_arg)
            .args(["--db"])
            .arg(&database)
            .args(["--json"])
            .output()
            .expect("work create starts");
        let created_value = envelope(&created);
        expected_revision = created_value["revision"]
            .as_u64()
            .expect("work create returns the project revision");
    }

    let status = Command::new(binary)
        .current_dir(&root)
        .args([
            "status",
            "release-project",
            "--actor",
            "release-agent",
            "--harness",
            "release-acceptance-test",
            "--session",
            "release-session",
            "--limit",
            "7",
            "--offset",
            "3",
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("status starts");
    let status_value = envelope(&status);
    let items = status_value["data"]["items"]
        .as_array()
        .expect("status items");
    assert!(items.len() <= 7, "status page exceeded requested limit");
    assert_eq!(status_value["data"]["limit"], 7);
    assert_eq!(status_value["data"]["offset"], 3);

    let _ = fs::remove_dir_all(root);
}
