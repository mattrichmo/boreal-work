#![cfg(unix)]

//! Public-surface regression coverage for the witnessed evidence executor.
//!
//! These tests deliberately set up only the source-version foreign-key row
//! directly.  There is no public source-ingestion route in the current CLI;
//! the evidence journey itself is exercised through `bwrk evidence run`.

use boreal_store::SqliteStore;
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PROJECT: &str = "executor-regression-project";
const WORK: &str = "executor-regression-task";
const ACTOR: &str = "executor-regression-agent";
const HARNESS: &str = "executor-regression-harness";
const SESSION: &str = "executor-regression-session";
const SOURCE: &str = "executor-regression-source";
const CONFIG: &str = "executor-regression-config";

#[test]
fn standard_boreal_layout_runs_declared_command_from_workspace_root() {
    let fixture = Fixture::new("workspace-root", true);
    fs::write(
        fixture.root.join("workspace-marker.txt"),
        "workspace-root-marker",
    )
    .unwrap();
    fixture.executable(
        "check-workspace-root",
        "#!/bin/sh\ncat workspace-marker.txt\n",
    );
    fixture.write_gate(
        "./check-workspace-root",
        vec!["./check-workspace-root"],
        vec!["workspace-root-marker"],
        30_000,
        None,
    );

    let output = fixture.evidence_run("op_workspace_root");
    assert_success(&output, "workspace-root evidence run");
    let envelope = envelope(&output);
    assert_eq!(envelope["outcome"], "changed");
    assert_eq!(envelope["data"]["result"], "passed");
    let stdout_ref = path_value(&envelope["data"]["stdout_ref"]);
    assert_eq!(fs::read(stdout_ref).unwrap(), b"workspace-root-marker");
}

#[test]
fn executor_uses_allowlisted_environment_and_records_measured_fingerprint() {
    let fixture = Fixture::new("environment", false);
    fixture.executable(
        "inspect-environment",
        "#!/bin/sh\nif [ -n \"${PATH:-}\" ]; then printf path-present; else printf path-missing; fi\nif [ -n \"${HOME:-}\" ]; then printf home-present; else printf home-absent; fi\n",
    );
    fixture.write_gate(
        "./inspect-environment",
        vec!["./inspect-environment"],
        vec!["path-present", "home-absent"],
        30_000,
        None,
    );

    let output = fixture.evidence_run("op_environment");
    assert_success(&output, "environment evidence run");
    let data = envelope(&output)["data"].clone();
    let stdout_ref = path_value(&data["stdout_ref"]);
    assert_eq!(fs::read(stdout_ref).unwrap(), b"path-presenthome-absent");

    let receipt = read_json(path_value(&data["receipt_path"]));
    let allowlist = receipt["environment_allowlist"]
        .as_array()
        .expect("receipt carries environment allowlist");
    assert!(allowlist.iter().any(|value| value == "PATH"));
    assert!(!allowlist.iter().any(|value| value == "HOME"));
    let measured = receipt["environment_fingerprint"]
        .as_str()
        .expect("measured environment fingerprint");
    assert!(measured.starts_with("sha256:"), "fingerprint={measured}");
    assert_ne!(measured, receipt["declared_environment_fingerprint"]);

    // A sensitive variable is rejected before admission, so an executor
    // cannot opt back into credentials by editing a declaration.
    fixture.write_gate(
        "./inspect-environment",
        vec!["./inspect-environment"],
        vec!["path-present"],
        30_000,
        Some(vec!["SECRET_TOKEN".to_owned()]),
    );
    let rejected = fixture.evidence_run_without_rewriting("op_sensitive_environment");
    assert_eq!(rejected.status.code(), Some(2), "{}", text(&rejected));
    let rejected_envelope = envelope(&rejected);
    assert_eq!(rejected_envelope["outcome"], "rejected");
    assert_eq!(rejected_envelope["error"]["code"], "unsafe_command");
    let store = SqliteStore::open(&fixture.database, SCHEMA).unwrap();
    assert!(store
        .evidence_execution("op_sensitive_environment")
        .unwrap()
        .is_none());
}

#[test]
fn timeout_kills_descendants_in_the_declared_process_group() {
    let fixture = Fixture::new("descendants", false);
    let survivor = fixture.root.join("descendant-survived.txt");
    let survivor_literal = shell_literal(&survivor);
    fixture.executable(
        "spawn-descendant",
        &format!(
            "#!/bin/sh\n(sleep 1; printf survived > {survivor_literal}) &\nprintf descendant-started\nwhile :; do sleep 1; done\n"
        ),
    );
    fixture.write_gate(
        "./spawn-descendant",
        vec!["./spawn-descendant"],
        vec![],
        100,
        None,
    );

    let output = fixture.evidence_run("op_descendant_timeout");
    let response = envelope(&output);
    assert_eq!(response["outcome"], "changed", "{}", text(&output));
    assert_eq!(response["data"]["execution_outcome"], "timedout");
    assert_eq!(response["data"]["result"], "failed");

    // Give a surviving descendant enough time to run.  A process that was
    // merely detached from the direct child would create this marker.
    thread::sleep(Duration::from_millis(1_200));
    assert!(
        !survivor.exists(),
        "descendant outlived the timed-out evidence operation"
    );
}

#[test]
fn completed_evidence_operation_replays_without_relaunching_or_reading_policy() {
    let fixture = Fixture::new("replay", false);
    let launch_count = fixture.root.join("launch-count.txt");
    let count_literal = shell_literal(&launch_count);
    fixture.executable(
        "count-launches",
        &format!("#!/bin/sh\nprintf x >> {count_literal}\nprintf replay-marker\n"),
    );
    fixture.write_gate(
        "./count-launches",
        vec!["./count-launches"],
        vec!["replay-marker"],
        30_000,
        None,
    );

    let first = fixture.evidence_run("op_replay_execution");
    assert_success(&first, "initial evidence run");
    assert_eq!(fs::read(&launch_count).unwrap(), b"x");

    // If replay admission happened after declaration parsing or spawn, this
    // malformed policy would either relaunch or turn the retry into an error.
    fs::write(
        fixture.root.join("gates/verification.json"),
        b"{ this is intentionally no longer valid JSON",
    )
    .unwrap();
    let replay = fixture.evidence_run_without_rewriting("op_replay_execution");
    assert_success(&replay, "replayed evidence run");
    let replay_envelope = envelope(&replay);
    assert_eq!(replay_envelope["outcome"], "unchanged");
    assert_eq!(replay_envelope["data"]["replayed"], true);
    assert_eq!(fs::read(launch_count).unwrap(), b"x");
}

#[test]
fn failpoint_after_admission_recovers_as_unknown_on_service_restart() {
    let fixture = Fixture::new("fault-after-admission", false);
    let launch_count = fixture.root.join("launch-count.txt");
    let count_literal = shell_literal(&launch_count);
    fixture.executable(
        "fault-command",
        &format!("#!/bin/sh\nprintf x >> {count_literal}\nprintf should-not-run\n"),
    );
    fixture.write_gate(
        "./fault-command",
        vec!["./fault-command"],
        vec!["should-not-run"],
        30_000,
        None,
    );

    let crashed =
        fixture.evidence_run_with_failpoint("op_fault_after_admission", "after_evidence_admission");
    assert!(
        !crashed.status.success(),
        "failpoint process unexpectedly succeeded: {}",
        text(&crashed)
    );
    assert!(
        !launch_count.exists(),
        "the command must not launch before admission recovery"
    );

    let store = SqliteStore::open(&fixture.database, SCHEMA).unwrap();
    let execution = store
        .evidence_execution("op_fault_after_admission")
        .unwrap()
        .expect("the admission must survive the process crash");
    assert_eq!(
        format!("{:?}", execution.state).to_ascii_lowercase(),
        "admitted"
    );
    drop(store);

    let socket = std::env::temp_dir().join(format!(
        "boreal-evidence-recovery-{}.sock",
        std::process::id()
    ));
    let _ = fs::remove_file(&socket);
    let Some(mut service) = start_recovery_service(&fixture.root, &fixture.database, &socket)
    else {
        return;
    };
    let deadline = Instant::now() + Duration::from_secs(3);
    let execution = loop {
        let store = SqliteStore::open(&fixture.database, SCHEMA).unwrap();
        let execution = store
            .evidence_execution("op_fault_after_admission")
            .unwrap()
            .expect("recovered execution remains queryable");
        if format!("{:?}", execution.state).to_ascii_lowercase() == "unknown" {
            break execution;
        }
        assert!(
            Instant::now() < deadline,
            "service restart did not reconcile the admitted execution"
        );
        thread::sleep(Duration::from_millis(10));
    };
    assert_eq!(
        format!("{:?}", execution.state).to_ascii_lowercase(),
        "unknown"
    );
    assert_eq!(
        execution.failure_code.as_deref(),
        Some("service_restart_recovery")
    );
    let _ = service.kill();
    let _ = service.wait();
    let _ = fs::remove_file(socket);
}

struct Fixture {
    root: PathBuf,
    database: PathBuf,
}

impl Fixture {
    fn new(label: &str, standard_layout: bool) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "boreal-cli-executor-{label}-{}-{nonce}",
            std::process::id()
        ));
        let state_root = if standard_layout {
            root.join(".boreal")
        } else {
            root.clone()
        };
        fs::create_dir_all(state_root.join("gates")).unwrap();
        let database = state_root.join("boreal.sqlite");
        let fixture = Self { root, database };
        fixture.initialize();
        fixture
    }

    fn initialize(&self) {
        let output = self.run(&[
            "init",
            PROJECT,
            "--db",
            &path(&self.database),
            "--actor",
            ACTOR,
            "--operation-id",
            "op_executor_init",
            "--json",
        ]);
        assert_success(&output, "init");

        let store = SqliteStore::open(&self.database, SCHEMA).unwrap();
        store
            .execute_batch(&format!(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('{SOURCE}', '{PROJECT}', 'fixture', 'project',
                         'sha256:executor-source', 'text/plain', 0, 'unix-ms:1',
                         'executor-regression/1', 'available', '[]');"
            ))
            .unwrap();

        let output = self.run(&[
            "work",
            "create",
            PROJECT,
            WORK,
            "Executor regression task",
            "--kind",
            "task",
            "--db",
            &path(&self.database),
            "--actor",
            ACTOR,
            "--operation-id",
            "op_executor_work",
            "--json",
        ]);
        assert_success(&output, "work create");

        let output = self.run(&[
            "work",
            "claim",
            PROJECT,
            WORK,
            "--actor",
            ACTOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--source-version",
            SOURCE,
            "--config-identity",
            CONFIG,
            "--db",
            &path(&self.database),
            "--operation-id",
            "op_executor_claim",
            "--json",
        ]);
        assert_success(&output, "work claim");

        let output = self.run(&[
            "agent",
            "start",
            WORK,
            "--project",
            PROJECT,
            "--actor",
            ACTOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--db",
            &path(&self.database),
            "--operation-id",
            "op_executor_start",
            "--json",
        ]);
        assert_success(&output, "agent start");
    }

    fn executable(&self, name: &str, contents: &str) {
        let executable = self.root.join(name);
        fs::write(&executable, contents).unwrap();
        let mut permissions = fs::metadata(&executable).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(executable, permissions).unwrap();
    }

    fn write_gate(
        &self,
        executable: &str,
        argv: Vec<&str>,
        observables: Vec<&str>,
        max_runtime_ms: u64,
        environment_allowlist: Option<Vec<String>>,
    ) {
        let state_root = self.database.parent().unwrap();
        let mut declaration = json!({
            "gate_id": "verification",
            "kind": "verification",
            "executable": executable,
            "argv": argv,
            "cwd": ".",
            "source_snapshot_hash": SOURCE,
            "config_identity": CONFIG,
            "environment_fingerprint": "declared-environment-fingerprint",
            "observables": observables,
            "max_runtime_ms": max_runtime_ms
        });
        if let Some(environment_allowlist) = environment_allowlist {
            declaration["environment_allowlist"] = json!(environment_allowlist);
        }
        fs::write(
            state_root.join("gates/verification.json"),
            serde_json::to_vec(&declaration).unwrap(),
        )
        .unwrap();
    }

    fn evidence_run(&self, operation: &str) -> Output {
        self.evidence_run_without_rewriting(operation)
    }

    fn evidence_run_without_rewriting(&self, operation: &str) -> Output {
        self.run(&[
            "evidence",
            "run",
            "--project",
            PROJECT,
            "--work",
            WORK,
            "--gate",
            "verification",
            "--actor",
            ACTOR,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--operation-id",
            operation,
            "--db",
            &path(&self.database),
            "--json",
        ])
    }

    fn evidence_run_with_failpoint(&self, operation: &str, failpoint: &str) -> Output {
        Command::new(binary())
            .current_dir(&self.root)
            .args([
                "evidence",
                "run",
                "--project",
                PROJECT,
                "--work",
                WORK,
                "--gate",
                "verification",
                "--actor",
                ACTOR,
                "--harness",
                HARNESS,
                "--session",
                SESSION,
                "--operation-id",
                operation,
                "--db",
            ])
            .arg(&self.database)
            .args(["--json"])
            .env("BOREAL_VALIDATION_FAILPOINT", failpoint)
            .output()
            .unwrap()
    }

    fn run(&self, args: &[&str]) -> Output {
        Command::new(binary())
            .current_dir(&self.root)
            .args(args)
            .output()
            .unwrap()
    }
}

impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn start_recovery_service(root: &Path, database: &Path, socket: &Path) -> Option<Child> {
    let child = Command::new(binary())
        .current_dir(root)
        .args(["service", "run", "--db"])
        .arg(database)
        .args(["--socket"])
        .arg(socket)
        .args(["--json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    for _ in 0..300 {
        if socket.exists() && UnixStream::connect(socket).is_ok() {
            return Some(child);
        }
        thread::sleep(Duration::from_millis(10));
    }
    let output = child.wait_with_output().unwrap();
    let output_text = text(&output).to_ascii_lowercase();
    if output_text.contains("operation not permitted") || output_text.contains("eperm") {
        eprintln!("BOREAL_VALIDATION_SKIP: Unix socket creation is unavailable");
        None
    } else {
        panic!("recovery service did not become ready: {}", text(&output));
    }
}

fn assert_success(output: &Output, command: &str) {
    assert!(
        output.status.success(),
        "{command} failed: status={:?} stdout={} stderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn envelope(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "stdout was not an envelope: {error}; stdout={} stderr={}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

fn read_json(path: PathBuf) -> Value {
    serde_json::from_slice(&fs::read(path).unwrap()).unwrap()
}

fn path(path: &Path) -> String {
    path.to_str().unwrap().to_owned()
}

fn path_value(value: &Value) -> PathBuf {
    value.as_str().map(PathBuf::from).expect("artifact path")
}

fn shell_literal(path: &Path) -> String {
    let value = path.to_str().unwrap();
    format!("'{}'", value.replace('\'', "'\\\"'\\\"'"))
}

fn text(output: &Output) -> String {
    format!(
        "stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}
