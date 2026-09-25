#![cfg(unix)]

use boreal_store::SqliteStore;
use serde_json::Value;
use std::{
    fs,
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Output},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const PROJECT: &str = "source-service-project";
const ACTOR: &str = "source-service-operator";
const HARNESS: &str = "source-service-test";
const SESSION: &str = "source-service-session";
const MAX_SOURCE_BYTES: u64 = 16 * 1024 * 1024;

fn unique_root() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!("bwrk-source-service-{stamp}"))
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "command did not emit JSON: {error}\nstdout: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn assert_success(output: &Output, label: &str) -> Value {
    assert!(
        output.status.success(),
        "{label} failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    json(output)
}

fn start_service(project_root: &Path, database: &Path, socket: &Path) -> Child {
    let mut child = Command::new(binary())
        .current_dir(project_root)
        .args(["service", "run", "--db"])
        .arg(database)
        .args(["--socket"])
        .arg(socket)
        .args(["--max-requests", "7", "--json"])
        .spawn()
        .expect("service starts");
    for _ in 0..200 {
        if socket.exists() && UnixStream::connect(socket).is_ok() {
            return child;
        }
        if let Some(status) = child.try_wait().expect("service status reads") {
            panic!("service exited before binding the socket: {status}");
        }
        thread::sleep(Duration::from_millis(10));
    }
    let _ = child.kill();
    panic!("service did not bind its socket in time");
}

#[allow(clippy::too_many_arguments)]
fn source_add(
    project_root: &Path,
    database: &Path,
    socket: &Path,
    input: &Path,
    actor: &str,
    harness: &str,
    session: &str,
    expected_revision: u64,
    operation_id: &str,
) -> Output {
    Command::new(binary())
        .current_dir(project_root)
        .args(["source", "add", PROJECT, "--input"])
        .arg(input)
        .args(["--origin", "integration/source.md", "--media-type", "text/markdown"])
        .args(["--actor", actor, "--harness", harness, "--session", session])
        .args(["--expected-revision", &expected_revision.to_string()])
        .args(["--operation-id", operation_id, "--socket"])
        .arg(socket)
        .args(["--db"])
        .arg(database)
        .args(["--json"])
        .output()
        .expect("source add launches")
}

#[test]
fn source_add_uses_authenticated_service_context_and_durable_readback() {
    let root = unique_root();
    let project_root = root.join("project");
    fs::create_dir_all(project_root.join(".boreal")).expect("create project root");
    let database = project_root.join(".boreal/boreal.sqlite");
    let socket = project_root.join(".boreal/s.sock");
    let input = project_root.join("notes.md");
    fs::write(&input, b"service captured source bytes\n").expect("write source input");
    let outside = root.join("outside.md");
    fs::write(&outside, b"must not be captured across the workspace boundary\n")
        .expect("write outside source");
    let oversized = project_root.join("oversized.md");
    fs::File::create(&oversized)
        .expect("create oversized sparse fixture")
        .set_len(MAX_SOURCE_BYTES + 1)
        .expect("set oversized fixture length");

    let init = Command::new(binary())
        .current_dir(&project_root)
        .args(["init", PROJECT, "--actor", ACTOR, "--db"])
        .arg(&database)
        .args(["--operation-id", "op-source-service-init", "--json"])
        .output()
        .expect("project init launches");
    assert_success(&init, "project init");

    let session_start = Command::new(binary())
        .current_dir(&project_root)
        .args([
            "session",
            "start",
            "--project",
            PROJECT,
            "--actor",
            ACTOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--operation-id",
            "op-source-service-session",
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("session start launches");
    assert_success(&session_start, "session start");

    let store = SqliteStore::open(
        &database,
        include_str!("../../../project/spec/schema-v2.sql"),
    )
    .expect("project database opens");
    let expected_revision = store
        .project_revision(PROJECT)
        .expect("project revision reads")
        .0;
    drop(store);

    let child = start_service(&project_root, &database, &socket);

    let stale = source_add(
        &project_root,
        &database,
        &socket,
        &input,
        ACTOR,
        HARNESS,
        SESSION,
        expected_revision + 1,
        "op-source-service-stale",
    );
    assert!(!stale.status.success(), "stale revision must be rejected");
    assert_eq!(json(&stale)["error"]["code"], "revision_conflict");

    let wrong_session = source_add(
        &project_root,
        &database,
        &socket,
        &input,
        ACTOR,
        HARNESS,
        "unregistered-session",
        expected_revision,
        "op-source-service-wrong-session",
    );
    assert!(
        !wrong_session.status.success(),
        "unregistered session must be rejected"
    );
    assert_eq!(json(&wrong_session)["error"]["code"], "permission_denied");

    let escaped = source_add(
        &project_root,
        &database,
        &socket,
        Path::new("../outside.md"),
        ACTOR,
        HARNESS,
        SESSION,
        expected_revision,
        "op-source-service-path-escape",
    );
    assert!(!escaped.status.success(), "outside path must be rejected");

    let too_large = source_add(
        &project_root,
        &database,
        &socket,
        Path::new("oversized.md"),
        ACTOR,
        HARNESS,
        SESSION,
        expected_revision,
        "op-source-service-too-large",
    );
    assert!(!too_large.status.success(), "oversized source must be rejected");

    let added = assert_success(
        &source_add(
            &project_root,
            &database,
            &socket,
            Path::new("notes.md"),
            ACTOR,
            HARNESS,
            SESSION,
            expected_revision,
            "op-source-service-capture",
        ),
        "service source add",
    );
    assert_eq!(added["outcome"], "changed");
    assert_eq!(added["data"]["registration"]["state"], "store_committed");
    assert_eq!(added["data"]["request_context"]["project_id"], PROJECT);
    assert_eq!(added["data"]["request_context"]["actor_id"], ACTOR);
    assert_eq!(added["data"]["request_context"]["harness_id"], HARNESS);
    assert_eq!(added["data"]["request_context"]["session_id"], SESSION);
    assert_eq!(
        added["data"]["request_context"]["expected_revision"],
        expected_revision
    );
    assert_eq!(
        added["data"]["request_context"]["operation_id"],
        "op-source-service-capture"
    );
    let source_id = added["data"]["source"]["source_version_id"]
        .as_str()
        .expect("service response returns source version identity")
        .to_owned();

    let replay = assert_success(
        &source_add(
            &project_root,
            &database,
            &socket,
            Path::new("notes.md"),
            ACTOR,
            HARNESS,
            SESSION,
            expected_revision,
            "op-source-service-capture",
        ),
        "same-operation source replay",
    );
    assert_eq!(replay["outcome"], "unchanged");
    assert_eq!(replay["data"]["registration"]["replayed"], true);
    assert_eq!(
        replay["data"]["source"]["source_version_id"],
        source_id
    );

    let readback = Command::new(binary())
        .current_dir(&project_root)
        .args([
            "operation",
            "show",
            PROJECT,
            "op-source-service-capture",
            "--actor",
            ACTOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--socket",
        ])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--operation-id", "op-source-service-readback", "--json"])
        .output()
        .expect("source operation readback launches");
    let readback = assert_success(&readback, "source operation readback");
    assert_eq!(
        readback["data"]["operation"]["result"]["source_version_id"],
        source_id
    );
    assert_eq!(
        readback["data"]["operation"]["project_id"],
        PROJECT
    );
    assert_eq!(
        readback["data"]["operation"]["actor_id"],
        ACTOR
    );

    let service_output = child
        .wait_with_output()
        .expect("request-limited service exits cleanly");
    assert_success(&service_output, "service shutdown");

    let store = SqliteStore::open(
        &database,
        include_str!("../../../project/spec/schema-v2.sql"),
    )
    .expect("project database reopens");
    assert!(
        store
            .operation("op-source-service-stale")
            .expect("stale operation lookup succeeds")
            .is_none(),
        "stale request must not register a durable source operation"
    );
    assert!(
        store
            .operation("op-source-service-capture")
            .expect("successful operation lookup succeeds")
            .is_some(),
        "successful source capture must retain its durable registration"
    );

    let _ = fs::remove_dir_all(root);
}
