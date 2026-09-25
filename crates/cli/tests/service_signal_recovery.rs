#![cfg(unix)]

use boreal_store::SqliteStore;
use serde_json::Value;
use std::{
    fs,
    io::{Read, Write},
    os::raw::c_int,
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const BOOTSTRAP_OPERATOR: &str = "recovery-operator";
const RECOVERY_AGENT: &str = "recovery-agent";
const RECOVERY_HARNESS: &str = "recovery-harness";
const SIGINT: c_int = 2;
const SIGTERM: c_int = 15;
const SIGKILL: c_int = 9;

unsafe extern "C" {
    fn kill(process: c_int, signal: c_int) -> c_int;
}

#[test]
fn service_run_handles_sigterm_and_removes_socket() {
    let temp = TempDir::new("service-signal");
    let database = temp.path().join("boreal.sqlite");
    let socket = short_socket_path(temp.path());
    let Some(child) = start_service(temp.path(), &database, &socket) else {
        return;
    };

    let output = stop_service(child, &socket, SIGTERM);
    assert!(
        output.status.success(),
        "service did not shut down cleanly: {}",
        text(&output)
    );
    let envelope: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "service shutdown did not emit a JSON envelope: {error}; {}",
            text(&output)
        )
    });
    assert_eq!(envelope["data"]["service"], "stopped");
    assert_socket_removed(&socket);
}

#[test]
fn service_run_recovers_a_stale_socket_after_sigkill_without_breaking_live_service() {
    let temp = TempDir::new("service-sigkill");
    let database = temp.path().join("boreal.sqlite");
    let socket = short_socket_path(temp.path());
    let Some(mut child) = start_service(temp.path(), &database, &socket) else {
        return;
    };

    let competing = Command::new(binary())
        .current_dir(temp.path())
        .args(["service", "run", "--db"])
        .arg(&database)
        .args(["--socket"])
        .arg(&socket)
        .args(["--json"])
        .output()
        .expect("competing service launches");
    assert!(
        !competing.status.success(),
        "a live service endpoint was replaced"
    );
    assert!(
        text(&competing).contains("already in use"),
        "competing service did not report live ownership: {}",
        text(&competing)
    );
    assert!(
        UnixStream::connect(&socket).is_ok(),
        "the original live service endpoint must remain connectable"
    );

    // SIGKILL prevents the service's Drop cleanup, so the pathname is a
    // realistic stale endpoint for the next process to inspect.
    terminate_if_running(&mut child, SIGKILL);
    assert!(
        socket.exists(),
        "SIGKILL should leave a stale socket pathname"
    );

    let Some(restarted) = start_service(temp.path(), &database, &socket) else {
        return;
    };
    let output = stop_service(restarted, &socket, SIGTERM);
    assert!(
        output.status.success(),
        "restarted service did not shut down cleanly: {}",
        text(&output)
    );
}

#[test]
fn direct_mutation_is_rejected_while_the_service_owns_the_database() {
    let temp = TempDir::new("service-direct-owner");
    let database = temp.path().join("boreal.sqlite");
    let socket = short_socket_path(temp.path());
    let Some(service) = start_service(temp.path(), &database, &socket) else {
        return;
    };

    let direct = Command::new(binary())
        .current_dir(temp.path())
        .args([
            "init",
            "direct-owner-project",
            "--actor",
            "direct-owner-operator",
            "--operation-id",
            "op-direct-owner-init",
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("direct mutation launches");
    let _ = stop_service(service, &socket, SIGTERM);

    assert!(
        !direct.status.success(),
        "direct mutation bypassed ownership"
    );
    let envelope = json(&direct);
    assert_eq!(envelope["error"]["code"], "service_busy");
    assert_eq!(envelope["outcome"], "busy");
}

#[test]
fn recovered_evidence_retry_returns_unknown_readback_instead_of_duplicate_protocol_error() {
    let temp = TempDir::new("service-recovery");
    let database = temp.path().join("boreal.sqlite");
    let socket = short_socket_path(temp.path());

    assert_success(
        Command::new(binary())
            .current_dir(temp.path())
            .args([
                "init",
                "recovery-project",
                "--actor",
                BOOTSTRAP_OPERATOR,
                "--db",
            ])
            .arg(&database)
            .args(["--operation-id", "op-recovery-init", "--json"])
            .output()
            .expect("init launches"),
        "init",
    );
    let operator_session = start_session(
        temp.path(),
        &database,
        "recovery-project",
        BOOTSTRAP_OPERATOR,
        "recovery-operator-session",
        "recovery-operator-harness",
    );
    let expected_revision = json(&operator_session)["revision"]
        .as_u64()
        .expect("Operator session start returns the project revision");
    let work_created = Command::new(binary())
        .current_dir(temp.path())
        .args([
            "work",
            "create",
            "recovery-project",
            "recovery-task",
            "Recover evidence",
            "--kind",
            "task",
            "--actor",
            BOOTSTRAP_OPERATOR,
            "--session",
            "recovery-operator-session",
            "--harness",
            "recovery-operator-harness",
            "--expected-revision",
        ])
        .arg(expected_revision.to_string())
        .args(["--db"])
        .arg(&database)
        .args(["--operation-id", "op-recovery-work", "--json"])
        .output()
        .expect("work create launches");
    assert_success(work_created, "work create");
    enroll_agent(
        temp.path(),
        &database,
        "recovery-project",
        BOOTSTRAP_OPERATOR,
        "recovery-operator-session",
        RECOVERY_AGENT,
        "op-recovery-agent-grant",
    );
    start_session(
        temp.path(),
        &database,
        "recovery-project",
        RECOVERY_AGENT,
        "recovery-session",
        RECOVERY_HARNESS,
    );
    let source_input = temp.path().join("recovery-source.txt");
    fs::write(&source_input, "source-bound recovery fixture\n")
        .expect("source-bound recovery fixture writes");
    let source_added = Command::new(binary())
        .current_dir(temp.path())
        .args(["source", "add", "recovery-project", "--input"])
        .arg(&source_input)
        .args([
            "--origin",
            "service-signal-recovery",
            "--actor",
            RECOVERY_AGENT,
            "--harness",
            RECOVERY_HARNESS,
            "--session",
            "recovery-session",
            "--expected-revision",
        ])
        .arg(
            SqliteStore::open(&database, SCHEMA)
                .expect("recovery database opens")
                .project_revision("recovery-project")
                .expect("project revision reads")
                .0
                .to_string(),
        )
        .args(["--db"])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("source add launches");
    assert!(
        source_added.status.success(),
        "source add failed: {}",
        text(&source_added)
    );
    let source_added_value = json(&source_added);
    let source_version = source_added_value["data"]["source"]["source_version_id"]
        .as_str()
        .unwrap_or_else(|| {
            panic!(
                "source add returns a source version id: {}",
                serde_json::to_string(&source_added_value).unwrap()
            )
        })
        .to_owned();
    assert_success(
        Command::new(binary())
            .current_dir(temp.path())
            .args([
                "agent",
                "start",
                "recovery-task",
                "--project",
                "recovery-project",
                "--actor",
                RECOVERY_AGENT,
                "--source-version",
                &source_version,
                "--config-identity",
                "recovery-config-v1",
                "--harness",
                RECOVERY_HARNESS,
                "--session",
                "recovery-execution-session",
                "--db",
            ])
            .arg(&database)
            .args(["--operation-id", "op-recovery-start", "--json"])
            .output()
            .expect("agent start launches"),
        "agent start",
    );

    let store = SqliteStore::open(&database, SCHEMA).expect("recovery database opens");
    let attempt = store
        .current_attempt_for_work("recovery-project", "recovery-task")
        .expect("current attempt reads")
        .expect("start creates a current attempt");
    assert_eq!(attempt.phase, boreal_domain::AttemptPhase::Running);
    let execution_sql = format!(
        "INSERT INTO evidence_execution
             (operation_id, project_id, work_id, attempt_id, fence, gate_id,
              actor_id, session_id, request_digest, artifact_ref, state, admitted_at)
             VALUES
             ('op_recovered_evidence', 'recovery-project', 'recovery-task',
              '{}', {}, 'recovery-task:verification',
              '{}', 'recovery-execution-session', 'digest-recovered',
              'artifact-recovered', 'admitted', 'unix-ms:1')",
        attempt.attempt_id, attempt.fence, RECOVERY_AGENT
    );
    store
        .execute_batch(&execution_sql)
        .expect("incomplete evidence execution seeds");
    drop(store);

    let Some(service) = start_service(temp.path(), &database, &socket) else {
        return;
    };
    let retry = Command::new(binary())
        .current_dir(temp.path())
        .args([
            "evidence",
            "run",
            "--project",
            "recovery-project",
            "--work",
            "recovery-task",
            "--gate",
            "verification",
            "--actor",
            RECOVERY_AGENT,
            "--harness",
            RECOVERY_HARNESS,
            "--session",
            "recovery-execution-session",
            "--operation-id",
            "op_recovered_evidence",
            "--socket",
        ])
        .arg(&socket)
        .args(["--db", "unused-local.sqlite", "--json"])
        .output()
        .expect("evidence retry launches");
    let _ = stop_service(service, &socket, SIGINT);

    assert_eq!(
        retry.status.code(),
        Some(11),
        "retry output: {}",
        text(&retry)
    );
    let envelope = json(&retry);
    assert_eq!(envelope["transport"], "ok");
    assert_eq!(envelope["outcome"], "unknown");
    assert_eq!(envelope["error"]["code"], "unknown_outcome");
    assert_eq!(envelope["error"]["readback_required"], true);
    assert_eq!(
        envelope["data"]["execution"]["state"], "unknown",
        "the retry should expose operation readback data"
    );
    assert_ne!(
        envelope["error"]["code"], "invalid_field",
        "recovery must not surface the host journal duplicate error"
    );
    assert_socket_removed(&socket);
}

fn start_session(
    root: &Path,
    database: &Path,
    project: &str,
    actor: &str,
    session: &str,
    harness: &str,
) -> Output {
    let operation_id = format!("op-session-{actor}-{session}");
    let output = Command::new(binary())
        .current_dir(root)
        .args([
            "session",
            "start",
            "--project",
            project,
            "--actor",
            actor,
            "--harness",
            harness,
            "--session",
            session,
            "--db",
        ])
        .arg(database)
        .args(["--operation-id", &operation_id, "--json"])
        .output()
        .expect("session start launches");
    assert_success(output.clone(), "session start");
    output
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
            display_name: format!("{agent} recovery-test Agent"),
            reason: "enroll a project-local Agent for the service integration test".to_owned(),
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
    fs::create_dir_all(&directory).expect("fixture credential directory creates");
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
    let body = serde_json::json!({
        "schema_version": "boreal.local-credential.v1",
        "project_id": project,
        "actor_id": actor,
        "credential": secret,
    });
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true).mode(0o600);
    let mut file = options
        .open(&credential_path)
        .expect("private Agent credential file creates exclusively");
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

fn start_service(root: &Path, database: &Path, socket: &Path) -> Option<Child> {
    if !root.join(".boreal/project.json").exists() {
        let initialized = Command::new(binary())
            .current_dir(root)
            .args([
                "init",
                "service-test-project",
                "--actor",
                "service-operator",
                "--db",
            ])
            .arg(database)
            .args(["--operation-id", "service-test-init", "--json"])
            .output()
            .expect("service test project initializes");
        assert_success(initialized, "service test init");
    }

    let mut child = Command::new(binary())
        .current_dir(root)
        .args(["service", "run", "--db"])
        .arg(database)
        .args(["--socket"])
        .arg(socket)
        .args(["--json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("service launches");

    for _ in 0..300 {
        if socket.exists() && UnixStream::connect(socket).is_ok() {
            return Some(child);
        }
        if child.try_wait().expect("service status reads").is_some() {
            let output = child
                .wait_with_output()
                .expect("service output reads after early exit");
            let combined = text(&output);
            if combined.contains("Operation not permitted")
                || combined.contains("Permission denied")
            {
                return None;
            }
            panic!("service exited before becoming ready: {combined}");
        }
        thread::sleep(Duration::from_millis(10));
    }

    terminate_if_running(&mut child, SIGKILL);
    panic!("service did not create its socket within the startup timeout");
}

fn stop_service(mut child: Child, socket: &Path, signal: c_int) -> Output {
    terminate_if_running(&mut child, signal);
    let output = child
        .wait_with_output()
        .expect("service output reads after signal");
    assert_socket_removed(socket);
    output
}

fn terminate_if_running(child: &mut Child, signal: c_int) {
    unsafe {
        assert_eq!(kill(child.id() as c_int, signal), 0, "service signal sends");
    }
    for _ in 0..300 {
        if child.try_wait().expect("service status reads").is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    unsafe {
        let _ = kill(child.id() as c_int, SIGKILL);
    }
    let _ = child.wait();
    panic!("service did not exit after signal {signal}");
}

fn assert_socket_removed(socket: &Path) {
    for _ in 0..100 {
        if !socket.exists() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        !socket.exists(),
        "service left socket {} behind",
        socket.display()
    );
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn short_socket_path(root: &Path) -> PathBuf {
    root.join("bwrk.sock")
}

fn assert_success(output: Output, command: &str) {
    assert!(
        output.status.success(),
        "{command} failed: {}",
        text(&output)
    );
}

fn json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("output is not a JSON envelope: {error}; {}", text(output)))
}

fn text(output: &Output) -> String {
    let mut bytes = output.stdout.clone();
    bytes.extend_from_slice(&output.stderr);
    String::from_utf8_lossy(&bytes).into_owned()
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
        let path = PathBuf::from("/tmp").join(format!(
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
