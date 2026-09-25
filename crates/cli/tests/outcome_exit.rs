#![cfg(unix)]

use boreal_store::SqliteStore;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    os::unix::net::UnixListener,
    path::{Path, PathBuf},
    process::{Command, Output},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const BOOTSTRAP_OPERATOR: &str = "bootstrap-operator";
const FIXTURE_HARNESS: &str = "outcome-exit-test";

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
    let summary = root.join("summary.txt");
    assert_success(run(
        &root,
        [
            "init",
            "p",
            "--actor",
            BOOTSTRAP_OPERATOR,
            "--db",
            path(&database),
            "--json",
        ],
    ));
    let expected_revision =
        start_session(&root, &database, "p", BOOTSTRAP_OPERATOR, "close-session");
    assert_success(run(
        &root,
        [
            "work",
            "create",
            "p",
            "w",
            "task",
            "--actor",
            BOOTSTRAP_OPERATOR,
            "--session",
            "close-session",
            "--harness",
            FIXTURE_HARNESS,
            "--expected-revision",
            &expected_revision.to_string(),
            "--db",
            path(&database),
            "--json",
        ],
    ));
    enroll_agent(
        &root,
        &database,
        "p",
        BOOTSTRAP_OPERATOR,
        "close-session",
        "close-agent",
        "op_close_agent_grant",
    );
    SqliteStore::open(&database, SCHEMA)
        .unwrap()
        .execute_batch(
            "INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('source-1', 'p', 'fixture.md', 'project',
                     'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                     'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');",
        )
        .unwrap();
    let started = run(
        &root,
        [
            "agent",
            "start",
            "w",
            "--project",
            "p",
            "--actor",
            "close-agent",
            "--session",
            "close-agent-session",
            "--harness",
            FIXTURE_HARNESS,
            "--source-version",
            "source-1",
            "--config-identity",
            "config-1",
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
            "UPDATE attempt SET source_version_id = 'source-1', config_identity = 'config-1'
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
    fs::write(&summary, "The required checkpoint is still open.").unwrap();

    let output = run(
        &root,
        [
            "agent",
            "finish",
            "w",
            "--close",
            "--project",
            "p",
            "--actor",
            "close-agent",
            "--session",
            "close-agent-session",
            "--harness",
            FIXTURE_HARNESS,
            "--attempt",
            &attempt_id,
            "--fence",
            &fence.to_string(),
            "--receipt",
            path(&receipt),
            "--summary",
            path(&summary),
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
    assert_success(run(
        &root,
        [
            "init",
            "p",
            "--actor",
            BOOTSTRAP_OPERATOR,
            "--db",
            path(&database),
            "--json",
        ],
    ));
    let expected_revision =
        start_session(&root, &database, "p", BOOTSTRAP_OPERATOR, "claim-session");
    assert_success(run(
        &root,
        [
            "work",
            "create",
            "p",
            "w",
            "task",
            "--actor",
            BOOTSTRAP_OPERATOR,
            "--session",
            "claim-session",
            "--harness",
            FIXTURE_HARNESS,
            "--expected-revision",
            &expected_revision.to_string(),
            "--db",
            path(&database),
            "--json",
        ],
    ));
    enroll_agent(
        &root,
        &database,
        "p",
        BOOTSTRAP_OPERATOR,
        "claim-session",
        "claim-owner",
        "op_claim_owner_grant",
    );
    enroll_agent(
        &root,
        &database,
        "p",
        BOOTSTRAP_OPERATOR,
        "claim-session",
        "claim-contender",
        "op_claim_contender_grant",
    );
    SqliteStore::open(&database, SCHEMA)
        .unwrap()
        .execute_batch(
            "INSERT INTO source_version
             (source_version_id, project_id, origin, access_scope, content_digest,
              media_type, byte_count, captured_at, parser_identity, availability, citation_json)
             VALUES ('source-1', 'p', 'fixture.md', 'project',
                     'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
                     'text/markdown', 1, 'unix-ms:0', 'parser/1', 'available', '[]');",
        )
        .unwrap();
    assert_success(run(
        &root,
        [
            "work",
            "claim",
            "p",
            "w",
            "--actor",
            "claim-owner",
            "--session",
            "owner-session",
            "--harness",
            FIXTURE_HARNESS,
            "--source-version",
            "source-1",
            "--config-identity",
            "config-1",
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
            "--actor",
            "claim-contender",
            "--session",
            "contender-session",
            "--harness",
            FIXTURE_HARNESS,
            "--source-version",
            "source-1",
            "--config-identity",
            "config-1",
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

fn start_session(root: &Path, database: &Path, project: &str, actor: &str, session: &str) -> u64 {
    let output = run(
        root,
        [
            "session",
            "start",
            "--project",
            project,
            "--actor",
            actor,
            "--session",
            session,
            "--harness",
            FIXTURE_HARNESS,
            "--db",
            path(database),
            "--json",
        ],
    );
    assert_success(output.clone());
    envelope(&output)["revision"]
        .as_u64()
        .expect("session start returns the project revision")
}

fn enroll_agent(
    root: &Path,
    database: &Path,
    project: &str,
    operator: &str,
    operator_session: &str,
    agent: &str,
    operation_id: &str,
) {
    let credential = write_private_credential(root, project, agent);
    let operator_credential = read_private_credential(root, project, operator);
    let store = SqliteStore::open(database, SCHEMA).expect("fixture database opens");
    let authenticated_operator = store
        .authenticate_principal(
            project,
            &operator_credential,
            boreal_domain::TimestampMs::from_millis(now_ms()),
        )
        .expect("bootstrap Operator credential authenticates");
    assert_eq!(authenticated_operator.actor_id, operator);
    assert_eq!(
        authenticated_operator.role,
        boreal_domain::ActorRole::Operator
    );

    let grant = store
        .grant_principal(&boreal_store::principals::PrincipalGrantRequest {
            project_id: project.to_owned(),
            actor_id: authenticated_operator.actor_id,
            session_id: Some(operator_session.to_owned()),
            principal_actor_id: agent.to_owned(),
            role: boreal_domain::ActorRole::Agent,
            independent: false,
            credential: credential.clone(),
            expires_at_ms: None,
            display_name: format!("{agent} test Agent"),
            reason: "enroll a project-local Agent for the CLI integration test".to_owned(),
            expected_revision: store
                .project_revision(project)
                .expect("project revision reads")
                .0,
            operation_id: operation_id.to_owned(),
            at: format!("unix-ms:{}", now_ms()),
        })
        .expect("production principal grant API enrolls the Agent");
    assert!(!grant.replayed);
    let authenticated_agent = store
        .authenticate_principal(
            project,
            &credential,
            boreal_domain::TimestampMs::from_millis(now_ms()),
        )
        .expect("private local Agent credential authenticates");
    assert_eq!(authenticated_agent.actor_id, agent);
    assert_eq!(authenticated_agent.role, boreal_domain::ActorRole::Agent);
}

fn write_private_credential(root: &Path, project: &str, actor: &str) -> String {
    let runtime = root.join(".boreal");
    let directory = runtime.join("credentials");
    fs::create_dir_all(&directory).expect("credential directory creates");
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700))
        .expect("project runtime directory is private");
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
        .expect("credential directory is private");

    let mut random = [0_u8; 32];
    fs::File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut random))
        .expect("operating-system randomness is available");
    let secret = format!(
        "bwrk1_{}",
        random
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>()
    );
    let credential_path = directory.join(format!(
        "{}.json",
        boreal_store::checksum(actor.as_bytes()).replace(':', "-")
    ));
    let body = json!({
        "schema_version": "boreal.local-credential.v1",
        "project_id": project,
        "actor_id": actor,
        "credential": secret,
    });
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true).mode(0o600);
    let mut file = options
        .open(&credential_path)
        .expect("private Agent credential file is created exclusively");
    file.write_all(&serde_json::to_vec(&body).expect("credential JSON serializes"))
        .and_then(|()| file.sync_all())
        .expect("private Agent credential is written");
    secret
}

fn read_private_credential(root: &Path, project: &str, actor: &str) -> String {
    let credential_path = root.join(".boreal/credentials").join(format!(
        "{}.json",
        boreal_store::checksum(actor.as_bytes()).replace(':', "-")
    ));
    let credential = serde_json::from_slice::<Value>(
        &fs::read(credential_path).expect("bootstrap Operator credential exists"),
    )
    .expect("bootstrap Operator credential is valid JSON");
    assert_eq!(credential["schema_version"], "boreal.local-credential.v1");
    assert_eq!(credential["project_id"], project);
    assert_eq!(credential["actor_id"], actor);
    credential["credential"]
        .as_str()
        .expect("bootstrap Operator credential is present")
        .to_owned()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_millis()
        .try_into()
        .expect("current Unix timestamp fits in u64 milliseconds")
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
