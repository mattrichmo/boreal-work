#![cfg(unix)]

use boreal_service::{JsonRequest, TransportConfig, UnixSocketClient};
use serde_json::{Value, json};
use std::{
    fs,
    path::PathBuf,
    process::{Command, Stdio},
    thread,
    time::{Duration, Instant},
};

fn temp_root(name: &str) -> PathBuf {
    std::env::temp_dir().join(format!("{name}-{}", std::process::id()))
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

#[test]
fn global_service_rejects_an_unknown_request_schema_in_a_versioned_envelope() {
    let root = temp_root("boreal-global-service-contract");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let state = root.join("state");
    let runtime = root.join("runtime");
    fs::create_dir(&runtime).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700)).unwrap();
    }
    let socket = runtime.join("s");
    let mut service = Command::new(binary())
        .args([
            "global",
            "service",
            "run",
            "--socket",
            socket.to_str().unwrap(),
            "--max-requests",
            "1",
        ])
        .env("BOREAL_GLOBAL_ROOT", &state)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    let deadline = Instant::now() + Duration::from_secs(5);
    while !socket.exists() && service.try_wait().unwrap().is_none() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    if !socket.exists() {
        let output = service.wait_with_output().unwrap();
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("Operation not permitted") || stderr.contains("Permission denied") {
            let _ = fs::remove_dir_all(root);
            return;
        }
        panic!("global service failed to bind socket: {stderr}");
    }

    let request = JsonRequest::new(
        "contract-version-check",
        json!({
            "api_version": "2",
            "schema_version": "boreal.global.request.unsupported",
            "operation_id": "op_contract_version_check",
            "command": "snapshot",
            "payload": {},
        })
        .to_string(),
    )
    .unwrap();
    let mut client = UnixSocketClient::connect(&socket, TransportConfig::default()).unwrap();
    let response = client.request(request).unwrap();
    assert_eq!(response.request_id(), "contract-version-check");
    let envelope: Value = serde_json::from_str(response.payload().unwrap()).unwrap();
    assert_eq!(envelope["api_version"], "2");
    assert_eq!(envelope["schema_version"], "boreal.protocol.envelope.v1");
    assert_eq!(envelope["operation_id"], "op_contract_version_check");
    assert_eq!(envelope["error"]["code"], "protocol_mismatch");
    assert_eq!(envelope["outcome"], "rejected");

    let output = service.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(!socket.exists(), "global service left its socket behind");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn global_commands_are_independent_of_cwd_and_workspace_links_are_validated() {
    let root = temp_root("boreal-global-cwd");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let cwd = root.join("uninitialized");
    fs::create_dir(&cwd).unwrap();
    let global = root.join("global");
    let run = |args: &[&str]| {
        Command::new(binary())
            .args(args)
            .current_dir(&cwd)
            .env("BOREAL_GLOBAL_ROOT", &global)
            .output()
            .unwrap()
    };
    let created = run(&["global", "project", "add", "--name", "Personal", "--json"]);
    assert!(
        created.status.success(),
        "{}",
        String::from_utf8_lossy(&created.stdout)
    );
    let project: Value = serde_json::from_slice(&created.stdout).unwrap();
    let project_id = project["data"]["id"].as_str().unwrap();

    let not_a_workspace = root.join("ordinary-folder");
    fs::create_dir(&not_a_workspace).unwrap();
    let invalid_link = run(&[
        "global",
        "project",
        "link",
        project_id,
        "--workspace",
        not_a_workspace.to_str().unwrap(),
        "--json",
    ]);
    assert!(!invalid_link.status.success());
    let error: Value = serde_json::from_slice(&invalid_link.stdout).unwrap();
    assert_eq!(error["error"]["code"], "invalid_argument");

    let snapshot = run(&["global", "snapshot", "--json"]);
    assert!(snapshot.status.success());
    let snapshot: Value = serde_json::from_slice(&snapshot.stdout).unwrap();
    assert_eq!(snapshot["data"]["projects"].as_array().unwrap().len(), 1);
    assert!(
        snapshot["data"]["associations"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    assert!(
        !cwd.join(".boreal").exists(),
        "global commands initialized the cwd"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn linked_workspace_rollup_uses_the_recorded_operator_actor() {
    let root = temp_root("boreal-global-rollup");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let workspace = root.join("workspace");
    fs::create_dir(&workspace).unwrap();
    let database = workspace.join(".boreal/boreal.sqlite");
    let global = root.join("global");
    let invoke = |cwd: &std::path::Path, args: &[&str]| {
        Command::new(binary())
            .args(args)
            .current_dir(cwd)
            .env("BOREAL_GLOBAL_ROOT", &global)
            .output()
            .unwrap()
    };

    let init = invoke(
        &workspace,
        &[
            "init",
            "--project",
            "linked-project",
            "--actor",
            "linked-operator",
            "--db",
            database.to_str().unwrap(),
            "--json",
        ],
    );
    assert!(
        init.status.success(),
        "{}",
        String::from_utf8_lossy(&init.stdout)
    );

    let started = invoke(
        &workspace,
        &[
            "session",
            "start",
            "--project",
            "linked-project",
            "--actor",
            "linked-operator",
            "--harness",
            "global-rollup-test",
            "--session",
            "rollup-session",
            "--db",
            database.to_str().unwrap(),
            "--json",
        ],
    );
    assert!(
        started.status.success(),
        "{}",
        String::from_utf8_lossy(&started.stdout)
    );
    let revision: u64 = serde_json::from_slice::<Value>(&started.stdout).unwrap()["revision"]
        .as_u64()
        .unwrap();
    let revision = revision.to_string();
    let created_work = invoke(
        &workspace,
        &[
            "work",
            "create",
            "linked-project",
            "rollup-work",
            "A linked task",
            "--kind",
            "task",
            "--actor",
            "linked-operator",
            "--session",
            "rollup-session",
            "--expected-revision",
            &revision,
            "--db",
            database.to_str().unwrap(),
            "--json",
        ],
    );
    assert!(
        created_work.status.success(),
        "{}",
        String::from_utf8_lossy(&created_work.stdout)
    );

    let management = invoke(
        &workspace,
        &["global", "project", "add", "--name", "Linked", "--json"],
    );
    assert!(
        management.status.success(),
        "{}",
        String::from_utf8_lossy(&management.stdout)
    );
    let management_id = serde_json::from_slice::<Value>(&management.stdout).unwrap()["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let linked = invoke(
        &workspace,
        &[
            "global",
            "project",
            "link",
            &management_id,
            "--workspace",
            workspace.to_str().unwrap(),
            "--json",
        ],
    );
    assert!(
        linked.status.success(),
        "{}",
        String::from_utf8_lossy(&linked.stdout)
    );

    let dashboard = invoke(&workspace, &["dashboard", "global", "--json"]);
    assert!(
        dashboard.status.success(),
        "{}",
        String::from_utf8_lossy(&dashboard.stdout)
    );
    let snapshot: Value = serde_json::from_slice(&dashboard.stdout).unwrap();
    let row = snapshot["data"]["linked_projects"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["management_project_id"] == management_id)
        .expect("linked workspace rollup");
    assert_eq!(row["availability"], "available", "{row}");
    assert_eq!(row["project_id"], "linked-project");
    assert_eq!(row["counts"]["total"], 1);
    assert!(row["revision"].as_u64().is_some());
    assert!(row["as_of"].as_str().is_some());

    let detail = invoke(
        &workspace,
        &[
            "global",
            "linked",
            "show",
            &management_id,
            "linked-project",
            "--json",
        ],
    );
    assert!(
        detail.status.success(),
        "{}",
        String::from_utf8_lossy(&detail.stdout)
    );
    let detail: Value = serde_json::from_slice(&detail.stdout).unwrap();
    assert_eq!(detail["data"]["availability"], "available");
    assert_eq!(detail["data"]["items_total"], 1);
    assert_eq!(detail["data"]["items"][0]["work_id"], "rollup-work");
    let _ = fs::remove_dir_all(root);
}

#[test]
fn global_todo_flags_and_recent_activity_are_visible() {
    let root = temp_root("boreal-global-todo-flags");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let global = root.join("global");
    let add = Command::new(binary())
        .args([
            "global",
            "todo",
            "add",
            "--title",
            "Flag title",
            "--description",
            "Flag description",
            "--json",
        ])
        .env("BOREAL_GLOBAL_ROOT", &global)
        .output()
        .unwrap();
    assert!(
        add.status.success(),
        "{}",
        String::from_utf8_lossy(&add.stdout)
    );
    let item: Value = serde_json::from_slice(&add.stdout).unwrap();
    let item_id = item["data"]["id"].as_str().unwrap();
    assert_eq!(item["data"]["title"], "Flag title");
    assert_eq!(item["data"]["description"], "Flag description");
    for action in ["archive", "unarchive"] {
        let changed = Command::new(binary())
            .args(["global", "todo", action, item_id, "--json"])
            .env("BOREAL_GLOBAL_ROOT", &global)
            .output()
            .unwrap();
        assert!(
            changed.status.success(),
            "{}",
            String::from_utf8_lossy(&changed.stdout)
        );
    }
    let second = Command::new(binary())
        .args(["global", "todo", "add", "--title", "Second title", "--json"])
        .env("BOREAL_GLOBAL_ROOT", &global)
        .output()
        .unwrap();
    assert!(
        second.status.success(),
        "{}",
        String::from_utf8_lossy(&second.stdout)
    );
    let second_id = serde_json::from_slice::<Value>(&second.stdout).unwrap()["data"]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    let reorder = Command::new(binary())
        .args([
            "global",
            "todo",
            "reorder",
            item_id,
            "--direction",
            "down",
            "--json",
        ])
        .env("BOREAL_GLOBAL_ROOT", &global)
        .output()
        .unwrap();
    assert!(
        reorder.status.success(),
        "{}",
        String::from_utf8_lossy(&reorder.stdout)
    );
    let reorder: Value = serde_json::from_slice(&reorder.stdout).unwrap();
    assert_eq!(reorder["data"]["moved"], true);
    assert_eq!(reorder["data"]["ordered_ids"], json!([second_id, item_id]));
    let history = Command::new(binary())
        .args([
            "global", "history", "--limit", "1", "--item", item_id, "--json",
        ])
        .env("BOREAL_GLOBAL_ROOT", &global)
        .output()
        .unwrap();
    assert!(
        history.status.success(),
        "{}",
        String::from_utf8_lossy(&history.stdout)
    );
    let history: Value = serde_json::from_slice(&history.stdout).unwrap();
    assert_eq!(history["data"]["events"][0]["entity_id"], item_id);
    assert_eq!(history["data"]["events"][0]["title"], "Flag title");
    let _ = fs::remove_dir_all(root);
}
