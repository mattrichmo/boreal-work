#![cfg(unix)]

//! Public-surface regression coverage for the witnessed evidence executor.
//!
//! Project sources are captured and registered through `bwrk source add`, and
//! evidence is executed through `bwrk evidence run`. The verifier declarations
//! and executable commands are disposable test fixtures, not production proof.

use boreal_store::SqliteStore;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PROJECT: &str = "executor-regression-project";
const WORK: &str = "executor-regression-task";
const OPERATOR: &str = "executor-regression-operator";
const AGENT: &str = "executor-regression-agent";
const HARNESS: &str = "executor-regression-harness";
const SETUP_SESSION: &str = "executor-regression-setup-session";
const SESSION: &str = "executor-regression-session";
const CONFIG: &str = "executor-regression-config";

#[test]
fn standard_boreal_layout_runs_declared_command_from_workspace_root() {
    let fixture = Fixture::new("workspace-root");
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
fn full_service_gate_id_uses_only_the_scoped_local_policy_declaration() {
    let fixture = Fixture::new("namespaced-gate");
    // This verifier exists only in the disposable test fixture; its receipt is
    // not production verification evidence.
    fixture.executable(
        "test-only-verifier",
        "#!/bin/sh\nprintf namespaced-gate-marker\n",
    );
    fixture.write_gate(
        "./test-only-verifier",
        vec!["./test-only-verifier"],
        vec!["namespaced-gate-marker"],
        30_000,
        None,
    );

    // A full service-issued ID is not a policy filename. Leave a malformed
    // decoy at that path so success proves lookup used gates/verification.json.
    let gate_root = fixture.database.parent().unwrap().join("gates");
    let local_policy = gate_root.join("verification.json");
    let full_id_policy = gate_root.join(format!("{WORK}:verification.json"));
    fs::write(&full_id_policy, b"this must not be read as policy").unwrap();
    assert!(local_policy.is_file());

    let full_gate_id = fixture
        .status_gate_id("verification")
        .expect("status exposes the service-issued verification gate ID");
    assert_eq!(full_gate_id, format!("{WORK}:verification"));

    let output = fixture.evidence_run_for_gate("op_namespaced_gate", &full_gate_id);
    assert_success(&output, "test-only namespaced evidence run");
    let result = envelope(&output);
    assert_eq!(result["outcome"], "changed");
    assert_eq!(result["data"]["result"], "passed");
    assert_eq!(result["data"]["gate_id"], full_gate_id);
    let receipt = read_json(path_value(&result["data"]["receipt_path"]));
    assert_eq!(receipt["subject"]["gate_id"], full_gate_id);
    assert_eq!(receipt["executable"], "./test-only-verifier");
    assert_eq!(
        fs::read(&full_id_policy).unwrap(),
        b"this must not be read as policy"
    );
}

#[test]
fn public_source_registration_and_evidence_execution_use_the_rust_service_socket() {
    let fixture = Fixture::new("socket-evidence");
    fixture.executable(
        "socket-verifier",
        "#!/bin/sh\nprintf socket-evidence-marker\n",
    );
    fixture.write_gate(
        "./socket-verifier",
        vec!["./socket-verifier"],
        vec!["socket-evidence-marker"],
        30_000,
        None,
    );

    let socket = fixture.root.join(".boreal/runtime/evidence.sock");
    fs::create_dir_all(socket.parent().unwrap()).unwrap();
    let Some(mut service) = start_recovery_service(&fixture.root, &fixture.database, &socket)
    else {
        return;
    };
    let output =
        fixture.evidence_run_for_gate_via_socket("op_socket_evidence", "verification", &socket);
    let _ = service.kill();
    let _ = service.wait();

    assert_success(&output, "service-backed evidence run");
    let result = envelope(&output);
    assert_eq!(result["outcome"], "changed");
    assert_eq!(result["data"]["result"], "passed");
    let receipt = read_json(path_value(&result["data"]["receipt_path"]));
    assert_eq!(receipt["source_snapshot_hash"], fixture.source_version);
    assert_eq!(receipt["config_identity"], CONFIG);
    assert_eq!(receipt["executable"], "./socket-verifier");
}

#[test]
fn executor_uses_allowlisted_environment_and_records_measured_fingerprint() {
    let fixture = Fixture::new("environment");
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
    let fixture = Fixture::new("descendants");
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
    let fixture = Fixture::new("replay");
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
        fixture
            .database
            .parent()
            .unwrap()
            .join("gates/verification.json"),
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
    let fixture = Fixture::new("fault-after-admission");
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

    let socket = fixture.root.join(".boreal/runtime/recovery.sock");
    fs::create_dir_all(socket.parent().unwrap()).unwrap();
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
        if format!("{:?}", execution.state).eq_ignore_ascii_case("unknown") {
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
    source_version: String,
}

impl Fixture {
    fn new(label: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            % 1_000_000_000;
        // Keep fixture roots short enough for Unix-domain socket paths on
        // macOS, whose default TMPDIR is a long /var/folders path.
        let root = Path::new("/tmp").join(format!("bex-{label}-{}-{nonce:x}", std::process::id()));
        let state_root = root.join(".boreal");
        fs::create_dir_all(state_root.join("gates")).unwrap();
        let database = state_root.join("boreal.sqlite");
        let mut fixture = Self {
            root,
            database,
            source_version: String::new(),
        };
        fixture.initialize();
        fixture
    }

    fn initialize(&mut self) {
        let output = self.run(&[
            "init",
            PROJECT,
            "--project-root",
            &path(&self.root),
            "--actor",
            OPERATOR,
            "--operation-id",
            "op_executor_init",
            "--json",
        ]);
        assert_success(&output, "init");

        fs::write(
            self.root.join("source-input.txt"),
            b"source-bound executor regression input\n",
        )
        .unwrap();
        let source_output = self.run(&[
            "source",
            "add",
            PROJECT,
            "--input",
            "source-input.txt",
            "--origin",
            "executor-regression/source-input.txt",
            "--media-type",
            "text/plain",
            "--actor",
            OPERATOR,
            "--operation-id",
            "op_executor_source",
            "--json",
        ]);
        assert_success(&source_output, "project source add");
        let source_version = envelope(&source_output)["data"]["source"]["source_version_id"]
            .as_str()
            .expect("source add returns a registered source version")
            .to_owned();

        let store = SqliteStore::open(&self.database, SCHEMA).unwrap();
        // Public source registration must be sufficient for the later claim;
        // do not manufacture the source-version foreign-key row in SQLite.
        self.source_version = source_version;

        let output = self.run(&[
            "session",
            "start",
            "--project",
            PROJECT,
            "--actor",
            OPERATOR,
            "--harness",
            HARNESS,
            "--session",
            SETUP_SESSION,
            "--db",
            &path(&self.database),
            "--operation-id",
            "op_executor_setup_session",
            "--json",
        ]);
        assert_success(&output, "setup session start");
        let expected_revision = store.project_revision(PROJECT).unwrap().0;

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
            OPERATOR,
            "--session",
            SETUP_SESSION,
            "--expected-revision",
            &expected_revision.to_string(),
            "--operation-id",
            "op_executor_work",
            "--json",
        ]);
        assert_success(&output, "work create");

        // Bootstrap is intentionally an Operator. Ordinary execution belongs
        // to a separately enrolled, project-local Agent with its own private
        // credential; never make this fixture pass by weakening claim policy.
        let agent_credential = write_private_credential(&self.root, PROJECT, AGENT);
        let operator_credential = read_private_credential(&self.root, PROJECT, OPERATOR);
        let operator = store
            .authenticate_principal(
                PROJECT,
                &operator_credential,
                boreal_domain::TimestampMs::from_millis(unix_now_ms()),
            )
            .expect("bootstrap Operator credential authenticates for this project");
        assert_eq!(operator.actor_id, OPERATOR);
        assert_eq!(operator.role, boreal_domain::ActorRole::Operator);
        let grant = store
            .grant_principal(&boreal_store::principals::PrincipalGrantRequest {
                project_id: PROJECT.to_owned(),
                actor_id: OPERATOR.to_owned(),
                session_id: Some(SETUP_SESSION.to_owned()),
                principal_actor_id: AGENT.to_owned(),
                role: boreal_domain::ActorRole::Agent,
                independent: false,
                credential: agent_credential.clone(),
                expires_at_ms: None,
                display_name: "Evidence executor test Agent".to_owned(),
                reason: "enroll the Agent used by this isolated executor fixture".to_owned(),
                expected_revision: store.project_revision(PROJECT).unwrap().0,
                operation_id: "op_executor_agent_grant".to_owned(),
                at: format!("unix-ms:{}", unix_now_ms()),
            })
            .expect("production principal grant API enrolls the fixture Agent");
        assert!(!grant.replayed);
        let agent = store
            .authenticate_principal(
                PROJECT,
                &agent_credential,
                boreal_domain::TimestampMs::from_millis(unix_now_ms()),
            )
            .expect("fixture Agent credential authenticates for this project");
        assert_eq!(agent.project_id, PROJECT);
        assert_eq!(agent.actor_id, AGENT);
        assert_eq!(agent.role, boreal_domain::ActorRole::Agent);

        let output = self.run(&[
            "work",
            "claim",
            PROJECT,
            WORK,
            "--actor",
            AGENT,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--source-version",
            &self.source_version,
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
            AGENT,
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
            "source_snapshot_hash": self.source_version,
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
        self.evidence_run_for_gate(operation, "verification")
    }

    fn evidence_run_for_gate(&self, operation: &str, gate_id: &str) -> Output {
        self.run(&[
            "evidence",
            "run",
            "--project",
            PROJECT,
            "--work",
            WORK,
            "--gate",
            gate_id,
            "--actor",
            AGENT,
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

    fn evidence_run_for_gate_via_socket(
        &self,
        operation: &str,
        gate_id: &str,
        socket: &Path,
    ) -> Output {
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
                gate_id,
                "--actor",
                AGENT,
                "--harness",
                HARNESS,
                "--session",
                SESSION,
                "--operation-id",
                operation,
                "--socket",
            ])
            .arg(socket)
            .arg("--db")
            .arg(&self.database)
            .args(["--json"])
            .output()
            .unwrap()
    }

    fn status_gate_id(&self, local_gate_id: &str) -> Option<String> {
        let output = self.run(&[
            "status",
            "--project",
            PROJECT,
            "--actor",
            AGENT,
            "--harness",
            HARNESS,
            "--session",
            SESSION,
            "--db",
            &path(&self.database),
            "--json",
        ]);
        assert_success(&output, "status gate-ID readback");
        let response = envelope(&output);
        let item = response["data"]["items"]
            .as_array()?
            .iter()
            .find(|item| item["work_id"] == WORK)?;
        ["open", "satisfied"]
            .into_iter()
            .filter_map(|state| item["gates"][state].as_array())
            .flatten()
            .filter_map(|gate| gate["gate_id"].as_str())
            .find(|gate_id| gate_id.ends_with(&format!(":{local_gate_id}")))
            .map(str::to_owned)
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
                AGENT,
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

fn write_private_credential(root: &Path, project: &str, actor: &str) -> String {
    let runtime = root.join(".boreal");
    let directory = runtime.join("credentials");
    fs::create_dir_all(&directory).expect("fixture credential directory is created");
    fs::set_permissions(&runtime, fs::Permissions::from_mode(0o700))
        .expect("fixture runtime directory is private");
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))
        .expect("fixture credentials directory is private");

    let mut random = [0_u8; 32];
    fs::File::open("/dev/urandom")
        .and_then(|mut source| source.read_exact(&mut random))
        .expect("operating-system randomness is available for the fixture credential");
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
        .expect("fixture Agent credential file is created exclusively");
    file.write_all(&serde_json::to_vec(&body).expect("credential JSON serializes"))
        .and_then(|()| file.sync_all())
        .expect("fixture Agent credential is written privately");
    secret
}

fn read_private_credential(root: &Path, project: &str, actor: &str) -> String {
    let credential_path = root.join(".boreal/credentials").join(format!(
        "{}.json",
        boreal_store::checksum(actor.as_bytes()).replace(':', "-")
    ));
    let credential = serde_json::from_slice::<Value>(
        &fs::read(credential_path).expect("fixture Operator credential exists"),
    )
    .expect("fixture Operator credential is valid JSON");
    assert_eq!(credential["schema_version"], "boreal.local-credential.v1");
    assert_eq!(credential["project_id"], project);
    assert_eq!(credential["actor_id"], actor);
    credential["credential"]
        .as_str()
        .expect("fixture Operator credential is present")
        .to_owned()
}

fn unix_now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system time is after Unix epoch")
        .as_millis()
        .try_into()
        .expect("current Unix timestamp fits in u64 milliseconds")
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
