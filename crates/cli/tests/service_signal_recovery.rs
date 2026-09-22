#![cfg(unix)]

use boreal_store::SqliteStore;
use serde_json::Value;
use std::{
    fs,
    os::raw::c_int,
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
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
    let socket = short_socket_path("signal");
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
    let socket = short_socket_path("sigkill");
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
    let socket = short_socket_path("direct-owner");
    let Some(service) = start_service(temp.path(), &database, &socket) else {
        return;
    };

    let direct = Command::new(binary())
        .current_dir(temp.path())
        .args([
            "init",
            "direct-owner-project",
            "--actor",
            "direct-owner-agent",
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
    let socket = short_socket_path("recovery");

    assert_success(
        Command::new(binary())
            .current_dir(temp.path())
            .args(["init", "recovery-project", "--db"])
            .arg(&database)
            .args([
                "--actor",
                "recovery-agent",
                "--operation-id",
                "op-recovery-init",
                "--json",
            ])
            .output()
            .expect("init launches"),
        "init",
    );
    assert_success(
        Command::new(binary())
            .current_dir(temp.path())
            .args([
                "work",
                "create",
                "recovery-project",
                "recovery-task",
                "Recover evidence",
                "--kind",
                "task",
                "--db",
            ])
            .arg(&database)
            .args([
                "--actor",
                "recovery-agent",
                "--operation-id",
                "op-recovery-work",
                "--json",
            ])
            .output()
            .expect("work create launches"),
        "work create",
    );
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
                "recovery-agent",
                "--harness",
                "recovery-harness",
                "--session",
                "recovery-session",
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
              'recovery-agent', 'recovery-session', 'digest-recovered',
              'artifact-recovered', 'admitted', 'unix-ms:1')",
        attempt.attempt_id, attempt.fence
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
            "recovery-agent",
            "--harness",
            "recovery-harness",
            "--session",
            "recovery-session",
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

fn start_service(root: &Path, database: &Path, socket: &Path) -> Option<Child> {
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

fn short_socket_path(kind: &str) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock is after the Unix epoch")
        .as_nanos();
    PathBuf::from(format!(
        "/tmp/boreal-cli-{kind}-{}-{nonce}.sock",
        std::process::id()
    ))
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
