#![cfg(unix)]

use boreal_store::SqliteStore;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    os::unix::net::UnixListener,
    path::{Path, PathBuf},
    process::{Command, Output},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");

#[test]
fn no_ready_is_unchanged_json_and_exits_zero() {
    let root = temporary_root("no-ready");
    fs::create_dir_all(&root).unwrap();
    let database = root.join("boreal.sqlite");
    assert_success(run(&root, ["init", "p", "--db", path(&database), "--json"]));

    let output = run(
        &root,
        ["next", "--project", "p", "--db", path(&database), "--json"],
    );
    assert!(output.status.success(), "stderr: {}", stderr(&output));
    let envelope = envelope(&output);
    assert_eq!(envelope["outcome"], "unchanged");
    assert_eq!(envelope["error"], Value::Null);
    assert_eq!(envelope["data"]["selection"], "none");

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn rejected_close_preserves_revision_and_gate_obligations_with_exit_seven() {
    let root = temporary_root("rejected-close");
    fs::create_dir_all(&root).unwrap();
    let database = root.join("boreal.sqlite");
    let receipt = root.join("receipt.json");
    assert_success(run(&root, ["init", "p", "--db", path(&database), "--json"]));
    assert_success(run(
        &root,
        [
            "work",
            "create",
            "p",
            "w",
            "task",
            "--db",
            path(&database),
            "--json",
        ],
    ));
    let started = run(
        &root,
        [
            "agent",
            "start",
            "w",
            "--project",
            "p",
            "--session",
            "s",
            "--db",
            path(&database),
            "--json",
        ],
    );
    assert_success(started.clone());
    let started_envelope = envelope(&started);
    let attempt_id = started_envelope["data"]["attempt_id"]
        .as_str()
        .unwrap()
        .to_owned();
    let fence = started_envelope["data"]["fence"].as_u64().unwrap();

    SqliteStore::open(&database, SCHEMA)
        .unwrap()
        .execute_batch(&format!(
            "INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('source-1', 'p', 'fixture.md', 'project',
                     'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                     'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');
             UPDATE attempt SET source_version_id = 'source-1', config_identity = 'config-1'
             WHERE attempt_id = '{}';",
            attempt_id
        ))
        .unwrap();
    fs::write(
        &receipt,
        serde_json::to_vec(&json!({
            "schema_version": "boreal.receipt.v1",
            "fixture_id": "cli.process.rejected-close.v1",
            "receipt_id": "receipt-process-rejected-close",
            "operation_id": "op_process_rejected_close_receipt",
            "subject": {
                "work_id": "w",
                "attempt_id": attempt_id,
                "fence": fence,
                "gate_id": "verification"
            },
            "executable": "./check",
            "argv": ["./check"],
            "cwd": "/workspace",
            "exit_code": 0,
            "started_at": "unix-ms:10",
            "ended_at": "unix-ms:11",
            "source_snapshot_hash": "source-1",
            "config_identity": "config-1",
            "environment_fingerprint": "env-1",
            "output_digest": "output-1",
            "output_ref": null,
            "coverage": {"kind": "verification", "profile_id": "focused", "profile_version": "1"},
            "attestation": "external_attested",
            "result": "passed",
            "retention": null
        }))
        .unwrap(),
    )
    .unwrap();

    let output = run(
        &root,
        [
            "agent",
            "finish",
            "w",
            "--close",
            "--project",
            "p",
            "--session",
            "s",
            "--attempt",
            &attempt_id,
            "--fence",
            &fence.to_string(),
            "--receipt",
            path(&receipt),
            "--db",
            path(&database),
            "--json",
        ],
    );
    assert_eq!(output.status.code(), Some(7), "stderr: {}", stderr(&output));
    let envelope = envelope(&output);
    assert_eq!(envelope["outcome"], "rejected");
    assert_eq!(envelope["error"]["code"], "gate_unsatisfied");
    assert_eq!(envelope["error"]["retryable"], true);
    assert_eq!(envelope["error"]["observed_revision"], envelope["revision"]);
    assert_eq!(envelope["data"]["close_state"], "open");
    let missing = envelope["data"]["gates"]["missing"].as_array().unwrap();
    assert!(!missing.is_empty());
    for obligation in missing.iter().filter_map(Value::as_str) {
        assert!(
            envelope["error"]["message"]
                .as_str()
                .unwrap()
                .contains(obligation),
            "error message omitted obligation {obligation}"
        );
    }

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn direct_claim_conflict_emits_error_and_nonzero_exit() {
    let root = temporary_root("claim-conflict");
    fs::create_dir_all(&root).unwrap();
    let database = root.join("boreal.sqlite");
    assert_success(run(&root, ["init", "p", "--db", path(&database), "--json"]));
    assert_success(run(
        &root,
        [
            "work",
            "create",
            "p",
            "w",
            "task",
            "--db",
            path(&database),
            "--json",
        ],
    ));
    assert_success(run(
        &root,
        [
            "work",
            "claim",
            "p",
            "w",
            "--session",
            "owner-session",
            "--db",
            path(&database),
            "--json",
        ],
    ));

    let conflict = run(
        &root,
        [
            "work",
            "claim",
            "p",
            "w",
            "--session",
            "contender-session",
            "--db",
            path(&database),
            "--json",
        ],
    );
    assert_eq!(
        conflict.status.code(),
        Some(4),
        "stderr: {}",
        stderr(&conflict)
    );
    let envelope = envelope(&conflict);
    assert_eq!(envelope["outcome"], "conflict");
    assert_eq!(envelope["error"]["code"], "claim_conflict");
    assert!(envelope["error"]["message"]
        .as_str()
        .is_some_and(|value| !value.is_empty()));

    fs::remove_dir_all(root).unwrap();
}

#[test]
fn socket_busy_and_unknown_outcomes_have_documented_exits() {
    assert_socket_outcome("busy", "service_busy", 6, false);
    assert_socket_outcome("unknown", "unknown_outcome", 11, true);
}

fn assert_socket_outcome(outcome: &str, code: &str, expected_exit: i32, readback: bool) {
    let root = temporary_root(outcome);
    fs::create_dir_all(&root).unwrap();
    let socket = short_socket(outcome);
    let _ = fs::remove_file(&socket);
    let listener = match UnixListener::bind(&socket) {
        Ok(listener) => listener,
        Err(error)
            if error.kind() == std::io::ErrorKind::PermissionDenied
                || error.to_string().contains("Operation not permitted") =>
        {
            // Restricted CI/macOS sandboxes may prohibit Unix sockets. The
            // outcome contract is exercised on normal hosts and by the
            // service transport suite; do not turn the environment limit
            // into a product failure here.
            fs::remove_dir_all(root).unwrap();
            return;
        }
        Err(error) => panic!("fixture socket binds: {error}"),
    };
    let outcome = outcome.to_owned();
    let code = code.to_owned();
    let response_outcome = outcome.clone();
    let response_code = code.clone();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_frame(&mut stream);
        let request: Value = serde_json::from_slice(&request).unwrap();
        let request_id = request["request_id"].as_str().unwrap();
        let operation = request["payload"]["operation_id"].as_str().unwrap();
        let application_envelope = json!({
            "api_version": "2",
            "schema_version": "boreal.protocol.envelope.v1",
            "operation_id": operation,
            "revision": null,
            "as_of": "unix-ms:1",
            "next_status_change_at": null,
            "transport": "ok",
            "outcome": response_outcome,
            "data": null,
            "detail_ref": null,
            "error": {
                "code": response_code,
                "message": format!("fixture {response_outcome} outcome"),
                "retryable": true
            }
        });
        let response = json!({
            "request_id": request_id,
            "payload": {
                "api_version": "2",
                "schema_version": "boreal.protocol.envelope.v1",
                "operation_id": operation,
                "data": application_envelope
            }
        });
        write_frame(&mut stream, &serde_json::to_vec(&response).unwrap());
    });

    let output = run(
        &root,
        [
            "status",
            "p",
            "--socket",
            path(&socket),
            "--operation-id",
            "op_socket_outcome_fixture",
            "--json",
        ],
    );
    server.join().unwrap();
    assert_eq!(
        output.status.code(),
        Some(expected_exit),
        "stderr: {}",
        stderr(&output)
    );
    let envelope = envelope(&output);
    assert_eq!(envelope["outcome"], outcome);
    assert_eq!(envelope["error"]["code"], code);
    if readback {
        assert_eq!(envelope["error"]["readback_required"], true);
        assert_eq!(
            envelope["error"]["operation_id"],
            "op_socket_outcome_fixture"
        );
    }

    let _ = fs::remove_file(socket);
    fs::remove_dir_all(root).unwrap();
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn temporary_root(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-cli-outcome-{label}-{}-{nonce}",
        std::process::id()
    ))
}

fn short_socket(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    PathBuf::from("/tmp").join(format!("boe-{label}-{}-{nonce}.sock", std::process::id()))
}

fn path(path: &Path) -> &str {
    path.to_str().unwrap()
}

fn run<const N: usize>(root: &Path, arguments: [&str; N]) -> Output {
    Command::new(binary())
        .current_dir(root)
        .args(arguments)
        .output()
        .unwrap()
}

fn assert_success(output: Output) {
    assert!(
        output.status.success(),
        "command failed: status={:?} stdout={} stderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn envelope(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout was not an envelope: {error}; stdout={}; stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn read_frame(stream: &mut impl Read) -> Vec<u8> {
    let mut prefix = [0_u8; 4];
    stream.read_exact(&mut prefix).unwrap();
    let mut body = vec![0; u32::from_be_bytes(prefix) as usize];
    stream.read_exact(&mut body).unwrap();
    body
}

fn write_frame(stream: &mut impl Write, body: &[u8]) {
    stream
        .write_all(&(body.len() as u32).to_be_bytes())
        .unwrap();
    stream.write_all(body).unwrap();
    stream.flush().unwrap();
}
