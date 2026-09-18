use serde_json::Value;
use std::{
    fs,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn public_cli_builds_and_reads_a_typed_work_hierarchy() {
    let root = temporary_root();
    fs::create_dir_all(&root).unwrap();
    let database = root.join("boreal.sqlite");

    let initialized = Command::new(binary())
        .current_dir(&root)
        .args([
            "init",
            "hierarchy-project",
            "--db",
            database.to_str().unwrap(),
            "--operation-id",
            "hierarchy-init",
            "--json",
        ])
        .output()
        .unwrap();
    assert_success(&initialized, "init");

    create(
        &root,
        &database,
        "milestone-1",
        "Release milestone",
        "milestone",
        None,
    );
    create(
        &root,
        &database,
        "sprint-1",
        "First sprint",
        "sprint",
        Some("milestone-1"),
    );
    create(
        &root,
        &database,
        "task-1",
        "Implement proof boundary",
        "task",
        Some("sprint-1"),
    );

    let shown = Command::new(binary())
        .current_dir(&root)
        .args([
            "work",
            "show",
            "hierarchy-project",
            "task-1",
            "--db",
            database.to_str().unwrap(),
            "--json",
        ])
        .output()
        .unwrap();
    assert_success(&shown, "work show");
    let shown_envelope = envelope(&shown);
    assert_eq!(shown_envelope["data"]["work_id"], "task-1");
    assert_eq!(shown_envelope["data"]["kind"], "task");
    assert_eq!(shown_envelope["data"]["parent_id"], "sprint-1");
    assert_eq!(shown_envelope["data"]["priority"], 0);

    let status = Command::new(binary())
        .current_dir(&root)
        .args([
            "status",
            "hierarchy-project",
            "--db",
            database.to_str().unwrap(),
            "--limit",
            "10",
            "--json",
        ])
        .output()
        .unwrap();
    assert_success(&status, "status");
    let status_envelope = envelope(&status);
    let items = status_envelope["data"]["items"].as_array().unwrap();
    assert_eq!(items.len(), 3);
    assert!(items.iter().any(|item| {
        item["work_id"] == "task-1" && item["parent_id"] == "sprint-1" && item["kind"] == "task"
    }));

    let invalid_root_sprint = Command::new(binary())
        .current_dir(&root)
        .args([
            "work",
            "create",
            "hierarchy-project",
            "invalid-sprint",
            "Invalid root sprint",
            "--kind",
            "sprint",
            "--db",
            database.to_str().unwrap(),
            "--operation-id",
            "hierarchy-invalid-root-sprint",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(!invalid_root_sprint.status.success());
    let rejected = envelope(&invalid_root_sprint);
    assert_eq!(rejected["outcome"], "rejected");
    assert!(rejected["error"]["message"]
        .as_str()
        .unwrap()
        .contains("sprints require a parent"));

    fs::remove_dir_all(root).unwrap();
}

fn create(
    root: &Path,
    database: &Path,
    work_id: &str,
    title: &str,
    kind: &str,
    parent: Option<&str>,
) {
    let mut args = vec![
        "work",
        "create",
        "hierarchy-project",
        work_id,
        title,
        "--kind",
        kind,
        "--db",
        database.to_str().unwrap(),
        "--operation-id",
        work_id,
        "--json",
    ];
    if let Some(parent) = parent {
        args.extend(["--parent", parent]);
    }
    let output = Command::new(binary())
        .current_dir(root)
        .args(args)
        .output()
        .unwrap();
    assert_success(&output, "work create");
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn envelope(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout was not a JSON envelope: {error}; stdout={}; stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn assert_success(output: &Output, operation: &str) {
    assert!(
        output.status.success(),
        "{operation} failed: stdout={}, stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn temporary_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-hierarchy-public-{}-{nonce}",
        std::process::id()
    ))
}
