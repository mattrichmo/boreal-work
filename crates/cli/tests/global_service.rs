#![cfg(unix)]

use boreal_application::GlobalManagerApplication;
use boreal_service::{JsonRequest, TransportConfig, UnixSocketClient};
use serde_json::{json, Value};
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
fn global_service_survives_abandoned_connections_and_answers_next_snapshot() {
    use std::{io::Write, os::unix::net::UnixStream};
    let root = temp_root("boreal-global-service-liveness");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
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
            "7",
        ])
        .env("BOREAL_GLOBAL_ROOT", root.join("state"))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !socket.exists() && service.try_wait().unwrap().is_none() && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(20));
    }
    if !socket.exists() {
        let out = service.wait_with_output().unwrap();
        let message = String::from_utf8_lossy(&out.stderr);
        if message.contains("Permission denied") || message.contains("Operation not permitted") {
            let _ = fs::remove_dir_all(root);
            return;
        }
        panic!(
            "global service failed to bind: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }
    let assert_healthy_snapshot = |operation_id: &str| {
        let request = JsonRequest::new(
            format!("healthy-{operation_id}"),
            json!({"api_version":"2","schema_version":"boreal.global.request.v1","operation_id":operation_id,"command":"snapshot","payload":{}}).to_string(),
        ).unwrap();
        let mut client = UnixSocketClient::connect(&socket, TransportConfig::default()).unwrap();
        let response = client.request(request).unwrap();
        let envelope: Value = serde_json::from_str(response.payload().unwrap()).unwrap();
        assert_eq!(envelope["outcome"], "unchanged");
        assert_eq!(
            envelope["data"]["revision"], 0,
            "failed connection changed state"
        );
    };
    drop(UnixStream::connect(&socket).unwrap()); // EOF before prefix.
    assert_healthy_snapshot("after-eof");
    let mut prefix = UnixStream::connect(&socket).unwrap();
    prefix.write_all(&[0, 0]).unwrap();
    drop(prefix);
    assert_healthy_snapshot("after-partial-prefix");
    let mut partial = UnixStream::connect(&socket).unwrap();
    partial.write_all(&[0, 0, 0, 8, b'{']).unwrap();
    drop(partial);
    assert_healthy_snapshot("after-partial-frame");
    let mut oversized = UnixStream::connect(&socket).unwrap();
    oversized.write_all(&u32::MAX.to_be_bytes()).unwrap();
    drop(oversized);
    assert_healthy_snapshot("after-invalid-size");
    let idle = UnixStream::connect(&socket).unwrap();
    thread::sleep(Duration::from_millis(650));
    drop(idle);
    assert_healthy_snapshot("after-idle-timeout");
    let operation_id = "op_global_disconnect_once";
    // The transport envelope embeds payload as raw JSON, so preserve it as an
    // object instead of stringifying the inner request into a JSON string.
    let inner = json!({
        "api_version": "2",
        "schema_version": "boreal.global.request.v1",
        "operation_id": operation_id,
        "command": "todo add",
        "payload": {"title": "One committed action"},
    });
    let encoded = serde_json::to_vec(&json!({
        "request_id": "disconnect-write",
        "payload": inner,
    }))
    .unwrap();
    let mut raw = UnixStream::connect(&socket).unwrap();
    raw.write_all(&(encoded.len() as u32).to_be_bytes())
        .unwrap();
    raw.write_all(&encoded).unwrap();
    raw.shutdown(std::net::Shutdown::Both).unwrap();
    drop(raw);
    thread::sleep(Duration::from_millis(150));
    let request = JsonRequest::new("read-receipt",json!({"api_version":"2","schema_version":"boreal.global.request.v1","operation_id":"op_receipt_readback","command":"operation show","payload":{"operation_id":operation_id}}).to_string()).unwrap();
    let mut client = UnixSocketClient::connect(&socket, TransportConfig::default()).unwrap();
    let response = client.request(request).unwrap();
    let envelope: Value = serde_json::from_str(response.payload().unwrap()).unwrap();
    assert_eq!(envelope["data"]["operation_id"], operation_id);
    assert_eq!(envelope["data"]["result"]["title"], "One committed action");
    drop(client);
    let request = JsonRequest::new("healthy-snapshot",json!({"api_version":"2","schema_version":"boreal.global.request.v1","operation_id":"op_healthy_snapshot","command":"snapshot","payload":{}}).to_string()).unwrap();
    let mut client = UnixSocketClient::connect(&socket, TransportConfig::default()).unwrap();
    let response = client.request(request).unwrap();
    let envelope: Value = serde_json::from_str(response.payload().unwrap()).unwrap();
    assert_eq!(envelope["data"]["totals"]["items"], 1);
    assert_eq!(envelope["data"]["revision"], 1);
    let out = service.wait_with_output().unwrap();
    assert!(
        out.status.success(),
        "{}",
        String::from_utf8_lossy(&out.stderr)
    );
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
    let default_priority = run(&[
        "global",
        "todo",
        "add",
        "--title",
        "Optional priority",
        "--json",
    ]);
    assert!(
        default_priority.status.success(),
        "{}",
        String::from_utf8_lossy(&default_priority.stdout)
    );
    let default_priority: Value = serde_json::from_slice(&default_priority.stdout).unwrap();
    assert_eq!(default_priority["data"]["priority"], 0);
    let selected_priority = run(&[
        "global",
        "todo",
        "add",
        "--title",
        "Chosen priority",
        "--priority",
        "7",
        "--json",
    ]);
    assert!(
        selected_priority.status.success(),
        "{}",
        String::from_utf8_lossy(&selected_priority.stdout)
    );
    let selected_priority: Value = serde_json::from_slice(&selected_priority.stdout).unwrap();
    assert_eq!(selected_priority["data"]["priority"], 7);

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
    assert!(snapshot["data"]["associations"]
        .as_array()
        .unwrap()
        .is_empty());
    assert!(
        !cwd.join(".boreal").exists(),
        "global commands initialized the cwd"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn file_export_bypasses_interactive_frame_limit_even_with_socket_routing() {
    let root = temp_root("boreal-global-large-export");
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    let database = root.join("state/global.sqlite");
    let app = GlobalManagerApplication::open(&database).unwrap();
    let project = app
        .execute("project add", &json!({"name":"Large"}), "p")
        .unwrap();
    let body = "x".repeat(100_000);
    for n in 0..12 {
        app.execute(
            "note add",
            &json!({"project_id":project["id"],"title":format!("Note {n}"),"body":body}),
            &format!("n{n}"),
        )
        .unwrap();
    }
    drop(app);
    let backup = root.join("backup.json");
    let output = Command::new(binary())
        .args([
            "global",
            "export",
            "--out",
            backup.to_str().unwrap(),
            "--socket",
            root.join("no-service.sock").to_str().unwrap(),
            "--json",
        ])
        .env("BOREAL_GLOBAL_ROOT", root.join("state"))
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    let response: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(response["data"]["exported"], true);
    let bytes = fs::read(&backup).unwrap();
    assert!(bytes.len() > 1024 * 1024);
    let exported: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(exported["notes"].as_array().unwrap().len(), 12);

    let restore_root = root.join("restored-state");
    let restored = Command::new(binary())
        .args([
            "global",
            "import",
            "--input",
            backup.to_str().unwrap(),
            "--socket",
            root.join("no-service.sock").to_str().unwrap(),
            "--json",
        ])
        .env("BOREAL_GLOBAL_ROOT", &restore_root)
        .output()
        .unwrap();
    assert!(
        restored.status.success(),
        "{}",
        String::from_utf8_lossy(&restored.stdout)
    );
    let restored: Value = serde_json::from_slice(&restored.stdout).unwrap();
    assert_eq!(restored["data"]["imported"], true);
    let snapshot = Command::new(binary())
        .args(["global", "snapshot", "--json"])
        .env("BOREAL_GLOBAL_ROOT", &restore_root)
        .output()
        .unwrap();
    assert!(snapshot.status.success());
    let snapshot: Value = serde_json::from_slice(&snapshot.stdout).unwrap();
    assert_eq!(snapshot["data"]["totals"]["notes"], 12);
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
