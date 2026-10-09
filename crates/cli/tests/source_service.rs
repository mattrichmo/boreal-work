#![cfg(unix)]

use boreal_store::SqliteStore;
use serde_json::Value;
use std::{
    fs,
    io::Read,
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
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
    std::env::temp_dir().join(format!("bwrk-{stamp}"))
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

fn output_text(output: &Output) -> String {
    format!(
        "stdout: {}; stderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn assert_success(output: &Output, label: &str) -> Value {
    assert!(
        output.status.success(),
        "{label} failed:\nstdout: {}\nstderr: {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        !output.stdout.is_empty(),
        "{label} succeeded without a response envelope; stderr: {}",
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
        .args(["--max-requests", "20", "--json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("service starts");
    for _ in 0..200 {
        if socket.exists() && UnixStream::connect(socket).is_ok() {
            return child;
        }
        if let Some(status) = child.try_wait().expect("service status reads") {
            let mut stdout = String::new();
            let mut stderr = String::new();
            let _ = child.stdout.take().unwrap().read_to_string(&mut stdout);
            let _ = child.stderr.take().unwrap().read_to_string(&mut stderr);
            panic!("service exited before binding the socket: {status}\nstdout: {stdout}\nstderr: {stderr}");
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
    source_add_with_media_type(
        project_root,
        database,
        socket,
        input,
        "integration/source.md",
        "text/markdown",
        actor,
        harness,
        session,
        expected_revision,
        operation_id,
    )
}

#[allow(clippy::too_many_arguments)]
fn source_add_with_media_type(
    project_root: &Path,
    database: &Path,
    socket: &Path,
    input: &Path,
    origin: &str,
    media_type: &str,
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
        .args(["--origin", origin, "--media-type", media_type])
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
    let project_root = root.join("p");
    fs::create_dir_all(project_root.join(".boreal")).expect("create project root");
    let database = project_root.join(".boreal/boreal.sqlite");
    let socket = project_root.join("s.sock");
    let input = project_root.join("notes.md");
    fs::write(&input, b"service captured source bytes\n").expect("write source input");
    let outside = root.join("outside.md");
    fs::write(
        &outside,
        b"must not be captured across the workspace boundary\n",
    )
    .expect("write outside source");
    let oversized = project_root.join("oversized.md");
    fs::File::create(&oversized)
        .expect("create oversized sparse fixture")
        .set_len(MAX_SOURCE_BYTES + 1)
        .expect("set oversized fixture length");

    let init = Command::new(binary())
        .current_dir(&project_root)
        .args(["init", "--project", PROJECT, "--actor", ACTOR, "--db"])
        .arg(&database)
        .args(["--operation-id", "op_source_service_init", "--json"])
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
            "op_source_service_session",
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
        "op_source_service_stale",
    );
    assert!(!stale.status.success(), "stale revision must be rejected");
    assert_eq!(
        json(&stale)["error"]["code"],
        "revision_conflict",
        "{}",
        output_text(&stale)
    );

    let wrong_session = source_add(
        &project_root,
        &database,
        &socket,
        &input,
        ACTOR,
        HARNESS,
        "unregistered-session",
        expected_revision,
        "op_source_service_wrong_session",
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
        "op_source_service_path_escape",
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
        "op_source_service_too_large",
    );
    assert!(
        !too_large.status.success(),
        "oversized source must be rejected"
    );

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
            "op_source_service_capture",
        ),
        "service source add",
    );
    assert_eq!(added["outcome"], "changed");
    assert_eq!(added["data"]["registration"]["state"], "store_committed");
    assert_eq!(added["data"]["index"]["state"], "indexed");
    assert!(added["data"].get("input").is_none());
    assert!(added["data"].get("catalog_root").is_none());
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
        "op_source_service_capture"
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
            "op_source_service_capture",
        ),
        "same-operation source replay",
    );
    assert_eq!(replay["outcome"], "unchanged");
    assert_eq!(replay["data"]["registration"]["replayed"], true);
    assert_eq!(replay["data"]["source"]["source_version_id"], source_id);

    let second_input = project_root.join("second-notes.md");
    fs::write(&second_input, b"a second distinct service source\n")
        .expect("write second source input");
    let second_expected_revision = added["data"]["registration"]["revision"]
        .as_u64()
        .expect("first source registration returns its revision");
    let second_added = assert_success(
        &source_add(
            &project_root,
            &database,
            &socket,
            Path::new("second-notes.md"),
            ACTOR,
            HARNESS,
            SESSION,
            second_expected_revision,
            "op_source_service_capture_second",
        ),
        "service second source capture",
    );
    let second_source_id = second_added["data"]["source"]["source_version_id"]
        .as_str()
        .expect("second service capture returns a source version identity")
        .to_owned();
    assert_ne!(second_source_id, source_id);

    // Catalog pages are sorted by source version ID, so assert against both
    // known IDs instead of assuming capture order is list order.
    let mut expected_ids = vec![source_id.clone(), second_source_id.clone()];
    expected_ids.sort();

    let readback = Command::new(binary())
        .current_dir(&project_root)
        .args([
            "operation",
            "show",
            PROJECT,
            "op_source_service_capture",
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
        .args(["--operation-id", "op_source_service_readback", "--json"])
        .output()
        .expect("source operation readback launches");
    let readback = assert_success(&readback, "source operation readback");
    assert_eq!(
        readback["data"]["operation"]["result"]["source_version_id"],
        source_id
    );
    assert_eq!(readback["data"]["operation"]["project_id"], PROJECT);
    assert_eq!(readback["data"]["operation"]["actor_id"], ACTOR);

    let search = Command::new(binary())
        .current_dir(&project_root)
        .args(["source", "search", PROJECT, "captured source bytes"])
        .args(["--actor", ACTOR, "--harness", HARNESS, "--session", SESSION])
        .args(["--socket"])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("service source search launches");
    let search = assert_success(&search, "service source search");
    assert_eq!(search["data"]["project_id"], PROJECT);
    assert_eq!(search["data"]["query"], "captured source bytes");
    assert_eq!(search["data"]["index_lag"], 0);
    let search_items = search["data"]["items"].as_array().unwrap();
    assert_eq!(search_items.len(), 2);
    assert!(search_items
        .iter()
        .any(|item| item["source_version_id"] == source_id));

    let shown = Command::new(binary())
        .current_dir(&project_root)
        .args(["source", "show", PROJECT, &source_id, "--socket"])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("service source show launches");
    let shown = assert_success(&shown, "service source show");
    assert_eq!(shown["data"]["source"]["source_version_id"], source_id);
    assert!(shown["data"].get("catalog_root").is_none());
    assert_eq!(
        shown["data"]["source"]["content_digest"],
        added["data"]["source"]["content_digest"]
    );

    let verified = Command::new(binary())
        .current_dir(&project_root)
        .args(["source", "verify", PROJECT, &source_id, "--socket"])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("service source verify launches");
    let verified = assert_success(&verified, "service source verify");
    assert_eq!(verified["data"]["verified"], true);
    assert_eq!(
        verified["data"]["verified_digest"],
        added["data"]["source"]["content_digest"]
    );

    let portable_read = Command::new(binary())
        .current_dir(&project_root)
        .args([
            "source", "read", PROJECT, &source_id, "--offset", "0", "--length", "65536", "--socket",
        ])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("service source read launches");
    let portable_read = assert_success(&portable_read, "service source read");
    assert_eq!(portable_read["data"]["encoding"], "hex");
    assert_eq!(portable_read["data"]["next_offset"], Value::Null);
    let decoded = hex_decode(portable_read["data"]["bytes_hex"].as_str().unwrap());
    assert_eq!(decoded, b"service captured source bytes\n");

    let binary_bytes = b"design\0asset\xff\x80";
    let binary_input = project_root.join("creative-asset.bin");
    fs::write(&binary_input, binary_bytes).expect("write binary source fixture");
    let binary_expected_revision = second_added["data"]["registration"]["revision"]
        .as_u64()
        .expect("second capture returns a project revision");
    let binary_added = assert_success(
        &source_add_with_media_type(
            &project_root,
            &database,
            &socket,
            Path::new("creative-asset.bin"),
            "integration/creative-asset.bin",
            "application/octet-stream",
            ACTOR,
            HARNESS,
            SESSION,
            binary_expected_revision,
            "op_source_service_binary_capture",
        ),
        "service binary source capture",
    );
    let binary_id = binary_added["data"]["source"]["source_version_id"]
        .as_str()
        .expect("binary capture returns its immutable version ID")
        .to_owned();
    let binary_digest = binary_added["data"]["source"]["content_digest"]
        .as_str()
        .expect("binary capture returns its digest")
        .to_owned();
    assert_eq!(
        binary_added["data"]["source"]["media_type"],
        "application/octet-stream"
    );
    fs::remove_file(&binary_input).expect("remove original binary input");

    // The service returns bounded hex ranges; materialize only after the
    // originating file has disappeared and verify the full content identity.
    let mut materialized = Vec::new();
    let mut offset = 0_usize;
    loop {
        let offset_text = offset.to_string();
        let operation_id = format!("op_source_service_binary_read_{offset}");
        let output = Command::new(binary())
            .current_dir(&project_root)
            .args([
                "source",
                "read",
                PROJECT,
                &binary_id,
                "--offset",
                &offset_text,
                "--length",
                "5",
                "--actor",
                ACTOR,
                "--harness",
                HARNESS,
                "--session",
                SESSION,
                "--operation-id",
                &operation_id,
                "--socket",
            ])
            .arg(&socket)
            .args(["--db"])
            .arg(&database)
            .args(["--json"])
            .output()
            .expect("service binary source read launches");
        let read = assert_success(&output, "service binary source read");
        assert_eq!(read["data"]["content_digest"], binary_digest);
        assert_eq!(read["data"]["offset"], offset as u64);
        assert_eq!(read["data"]["total_bytes"], binary_bytes.len() as u64);
        let chunk = hex_decode(read["data"]["bytes_hex"].as_str().unwrap());
        assert!(chunk.len() <= 5, "each service read stays within its bound");
        materialized.extend_from_slice(&chunk);
        match read["data"]["next_offset"].as_u64() {
            Some(next) => offset = next as usize,
            None => break,
        }
    }
    let materialized_path = project_root.join("materialized-creative-asset.bin");
    fs::write(&materialized_path, materialized).expect("write bounded materialization");
    let materialized = fs::read(&materialized_path).expect("read bounded materialization");
    assert_eq!(materialized, binary_bytes);
    assert_eq!(boreal_source::content_digest(&materialized), binary_digest);
    expected_ids.push(binary_id.clone());
    expected_ids.sort();

    let invalid_offset = (binary_bytes.len() + 1).to_string();
    let invalid_read = Command::new(binary())
        .current_dir(&project_root)
        .args([
            "source",
            "read",
            PROJECT,
            &binary_id,
            "--offset",
            &invalid_offset,
            "--length",
            "5",
            "--actor",
            ACTOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--operation-id",
            "op_source_service_binary_read_invalid_range",
            "--socket",
        ])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("invalid service source read launches");
    assert!(!invalid_read.status.success());
    assert_eq!(json(&invalid_read)["error"]["code"], "invalid_argument");

    let listed_first = Command::new(binary())
        .current_dir(&project_root)
        .args(["source", "list", PROJECT, "--limit", "1", "--offset", "0"])
        .args(["--actor", ACTOR, "--harness", HARNESS, "--session", SESSION])
        .args(["--socket"])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--operation-id", "op_source_service_list", "--json"])
        .output()
        .expect("first service source list page launches");
    let listed_first = assert_success(&listed_first, "first service source list page");
    assert_eq!(listed_first["data"]["project_id"], PROJECT);
    assert!(listed_first["data"].get("catalog_root").is_none());
    assert_eq!(listed_first["data"]["total"], 3);
    assert_eq!(listed_first["data"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        listed_first["data"]["items"][0]["source_version_id"],
        expected_ids[0]
    );
    assert_eq!(listed_first["data"]["offset"], 0);
    assert_eq!(listed_first["data"]["limit"], 1);
    assert_eq!(listed_first["data"]["has_more"], true);

    let listed_second = Command::new(binary())
        .current_dir(&project_root)
        .args(["source", "list", PROJECT, "--limit", "1", "--offset", "1"])
        .args(["--actor", ACTOR, "--harness", HARNESS, "--session", SESSION])
        .args(["--socket"])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--operation-id", "op_source_service_list_page_2", "--json"])
        .output()
        .expect("second service source list page launches");
    let listed_second = assert_success(&listed_second, "second service source list page");
    assert_eq!(listed_second["data"]["project_id"], PROJECT);
    assert_eq!(listed_second["data"]["total"], 3);
    assert_eq!(listed_second["data"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        listed_second["data"]["items"][0]["source_version_id"],
        expected_ids[1]
    );
    assert_eq!(listed_second["data"]["offset"], 1);
    assert_eq!(listed_second["data"]["limit"], 1);
    assert_eq!(listed_second["data"]["has_more"], true);

    let listed_third = Command::new(binary())
        .current_dir(&project_root)
        .args(["source", "list", PROJECT, "--limit", "1", "--offset", "2"])
        .args(["--actor", ACTOR, "--harness", HARNESS, "--session", SESSION])
        .args(["--socket"])
        .arg(&socket)
        .args(["--db"])
        .arg(&database)
        .args(["--operation-id", "op_source_service_list_page_3", "--json"])
        .output()
        .expect("third service source list page launches");
    let listed_third = assert_success(&listed_third, "third service source list page");
    assert_eq!(listed_third["data"]["total"], 3);
    assert_eq!(listed_third["data"]["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        listed_third["data"]["items"][0]["source_version_id"],
        expected_ids[2]
    );
    assert_eq!(listed_third["data"]["offset"], 2);
    assert_eq!(listed_third["data"]["limit"], 1);
    assert_eq!(listed_third["data"]["has_more"], false);

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
            .operation("op_source_service_stale")
            .expect("stale operation lookup succeeds")
            .is_none(),
        "stale request must not register a durable source operation"
    );
    assert!(
        store
            .operation("op_source_service_capture")
            .expect("successful operation lookup succeeds")
            .is_some(),
        "successful source capture must retain its durable registration"
    );

    let _ = fs::remove_dir_all(root);
}

fn hex_decode(value: &str) -> Vec<u8> {
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let pair = std::str::from_utf8(pair).unwrap();
            u8::from_str_radix(pair, 16).unwrap()
        })
        .collect()
}
