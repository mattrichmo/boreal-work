#![cfg(unix)]

use boreal_application::sha256_content_digest;
use boreal_store::SqliteStore;
use serde_json::{json, Value};
use std::{
    fs,
    io::{Read, Write},
    os::unix::fs::{OpenOptionsExt, PermissionsExt},
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PROJECT: &str = "evidence-project";
const WORK: &str = "evidence-task";
const OPERATOR: &str = "evidence-operator";
const AGENT: &str = "evidence-agent";
const HARNESS: &str = "evidence-harness";
const SESSION: &str = "evidence-session";
const SETUP_SESSION: &str = "evidence-setup-session";
const SOURCE: &str = "source-hardening";
const CONFIG: &str = "config-hardening";

#[test]
fn evidence_run_retains_streams_and_hashes_exact_combined_reference() {
    let fixture = Fixture::new(
        "streams",
        "./emit-streams",
        vec!["./emit-streams"],
        vec!["stdout-observable", "stderr-diagnostic"],
    );
    fixture.executable(
        "emit-streams",
        "#!/bin/sh\nprintf stdout-observable\nprintf stderr-diagnostic >&2\n",
    );

    let output = fixture.evidence_run("op_streams");
    assert_success(&output, "evidence run");
    let envelope = envelope(&output);
    assert_eq!(envelope["outcome"], "changed");
    assert_eq!(envelope["data"]["result"], "passed");
    assert_eq!(envelope["data"]["execution_outcome"], "passed");

    let stdout_ref = path_value(&envelope["data"]["stdout_ref"]);
    let stderr_ref = path_value(&envelope["data"]["stderr_ref"]);
    let combined_ref = path_value(&envelope["data"]["output_ref"]);
    let stdout = fs::read(&stdout_ref).expect("stdout artifact remains inspectable");
    let stderr = fs::read(&stderr_ref).expect("stderr artifact remains inspectable");
    let combined = fs::read(&combined_ref).expect("combined artifact remains inspectable");

    assert_eq!(stdout, b"stdout-observable");
    assert_eq!(stderr, b"stderr-diagnostic");
    let mut expected_combined = stdout.clone();
    expected_combined.extend_from_slice(&stderr);
    assert_eq!(combined, expected_combined);
    assert_eq!(
        envelope["data"]["output_digest"],
        sha256_content_digest(&combined)
    );
    assert_eq!(
        envelope["data"]["observables"],
        json!(["stdout-observable", "stderr-diagnostic"])
    );

    let receipt = envelope["data"]["receipt_path"]
        .as_str()
        .map(PathBuf::from)
        .expect("receipt path");
    let receipt_json: Value = serde_json::from_slice(&fs::read(receipt).unwrap()).unwrap();
    assert_eq!(
        receipt_json["output_ref"],
        combined_ref.to_string_lossy().as_ref()
    );
    assert_eq!(
        receipt_json["stdout_ref"],
        stdout_ref.to_string_lossy().as_ref()
    );
    assert_eq!(
        receipt_json["stderr_ref"],
        stderr_ref.to_string_lossy().as_ref()
    );
    assert_eq!(
        receipt_json["output_digest"],
        sha256_content_digest(&combined)
    );

    fixture.remove();
}

#[test]
fn evidence_run_rejects_a_declared_observable_that_was_not_measured() {
    let fixture = Fixture::new(
        "missing-observable",
        "printf",
        vec!["printf", "actual-output"],
        vec!["required-observable"],
    );

    let output = fixture.evidence_run("op_missing_observable");
    assert_eq!(output.status.code(), Some(7), "{}", text(&output));
    let envelope = envelope(&output);
    assert_eq!(envelope["outcome"], "rejected");
    assert_eq!(envelope["error"]["code"], "receipt_observable_missing");
    assert_eq!(envelope["data"], Value::Null);

    let store = SqliteStore::open(&fixture.database, SCHEMA).unwrap();
    let execution = store
        .evidence_execution("op_missing_observable")
        .unwrap()
        .expect("admitted execution remains recorded");
    assert_eq!(
        format!("{:?}", execution.state).to_ascii_lowercase(),
        "exited"
    );

    fixture.remove();
}

#[test]
fn evidence_run_caps_capture_before_an_unbounded_file_can_grow() {
    let fixture = Fixture::new("output-bound", "yes", vec!["yes", "x"], vec!["x"]);

    let output = fixture.evidence_run("op_output_bound");
    assert_eq!(output.status.code(), Some(11), "{}", text(&output));
    let envelope = envelope(&output);
    assert_eq!(envelope["outcome"], "unknown");
    assert_eq!(envelope["error"]["code"], "unknown_outcome");

    let store = SqliteStore::open(&fixture.database, SCHEMA).unwrap();
    let execution = store
        .evidence_execution("op_output_bound")
        .unwrap()
        .expect("bounded execution remains recorded");
    assert_eq!(
        format!("{:?}", execution.state).to_ascii_lowercase(),
        "unknown"
    );
    let combined = PathBuf::from(execution.artifact_ref);
    let stdout = combined.with_extension("out");
    let stderr = combined.with_extension("err");
    let captured = fs::metadata(&stdout).unwrap().len() + fs::metadata(&stderr).unwrap().len();
    assert!(
        captured <= boreal_application::MAX_OUTPUT_BYTES,
        "capture exceeded bound: {captured} bytes"
    );
    assert!(
        !combined.exists(),
        "rejected oversized runs do not mint a digest artifact"
    );

    fixture.remove();
}

struct Fixture {
    root: PathBuf,
    database: PathBuf,
    executable: String,
    argv: Vec<String>,
    observables: Vec<String>,
}

impl Fixture {
    fn new(label: &str, executable: &str, argv: Vec<&str>, observables: Vec<&str>) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "boreal-cli-evidence-{label}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(root.join("gates")).unwrap();
        let database = root.join("boreal.sqlite");
        let fixture = Self {
            root,
            database,
            executable: executable.to_owned(),
            argv: argv.into_iter().map(str::to_owned).collect(),
            observables: observables.into_iter().map(str::to_owned).collect(),
        };
        fixture.initialize();
        fixture
    }

    fn initialize(&self) {
        assert_success(
            &run(
                &self.root,
                &vec![
                    "init".to_owned(),
                    PROJECT.to_owned(),
                    "--db".to_owned(),
                    path(&self.database),
                    "--actor".to_owned(),
                    OPERATOR.to_owned(),
                    "--operation-id".to_owned(),
                    "op_evidence_init".to_owned(),
                    "--json".to_owned(),
                ],
            ),
            "init",
        );
        let store = SqliteStore::open(&self.database, SCHEMA).unwrap();
        store
            .execute_batch(&format!(
                "INSERT INTO source_version
                 (source_version_id, project_id, origin, access_scope, content_digest,
                  media_type, byte_count, captured_at, parser_identity, availability, citation_json)
                 VALUES ('{SOURCE}', '{PROJECT}', 'fixture', 'project',
                         'sha256:source-hardening', 'text/plain', 0, 'unix-ms:1',
                         'fixture/1', 'available', '[]');"
            ))
            .unwrap();
        assert_success(
            &run(
                &self.root,
                &vec![
                    "session".to_owned(),
                    "start".to_owned(),
                    "--project".to_owned(),
                    PROJECT.to_owned(),
                    "--actor".to_owned(),
                    OPERATOR.to_owned(),
                    "--harness".to_owned(),
                    HARNESS.to_owned(),
                    "--session".to_owned(),
                    SETUP_SESSION.to_owned(),
                    "--db".to_owned(),
                    path(&self.database),
                    "--operation-id".to_owned(),
                    "op_evidence_setup_session".to_owned(),
                    "--json".to_owned(),
                ],
            ),
            "setup session start",
        );
        let expected_revision = store.project_revision(PROJECT).unwrap().0;
        assert_success(
            &run(
                &self.root,
                &vec![
                    "work".to_owned(),
                    "create".to_owned(),
                    PROJECT.to_owned(),
                    WORK.to_owned(),
                    "Evidence hardening".to_owned(),
                    "--kind".to_owned(),
                    "task".to_owned(),
                    "--db".to_owned(),
                    path(&self.database),
                    "--actor".to_owned(),
                    OPERATOR.to_owned(),
                    "--session".to_owned(),
                    SETUP_SESSION.to_owned(),
                    "--expected-revision".to_owned(),
                    expected_revision.to_string(),
                    "--operation-id".to_owned(),
                    "op_evidence_work".to_owned(),
                    "--json".to_owned(),
                ],
            ),
            "work create",
        );

        // Initialization creates an Operator, not an execution Agent. Keep
        // setup on that bootstrap identity, then enroll a separate Agent using
        // the production credential and principal APIs used by the CLI.
        let agent_credential = write_private_credential(&self.root, PROJECT, AGENT);
        let operator_credential = read_private_credential(&self.root, PROJECT, OPERATOR);
        let operator = store
            .authenticate_principal(
                PROJECT,
                &operator_credential,
                boreal_domain::TimestampMs::from_millis(now_ms()),
            )
            .expect("bootstrap Operator credential authenticates for this project");
        assert_eq!(operator.actor_id, OPERATOR);
        assert_eq!(operator.role, boreal_domain::ActorRole::Operator);
        store
            .grant_principal(&boreal_store::principals::PrincipalGrantRequest {
                project_id: PROJECT.to_owned(),
                actor_id: OPERATOR.to_owned(),
                session_id: Some(SETUP_SESSION.to_owned()),
                principal_actor_id: AGENT.to_owned(),
                role: boreal_domain::ActorRole::Agent,
                independent: false,
                credential: agent_credential.clone(),
                expires_at_ms: None,
                display_name: "Evidence hardening test Agent".to_owned(),
                reason: "enroll the Agent used by this isolated evidence fixture".to_owned(),
                expected_revision: store.project_revision(PROJECT).unwrap().0,
                operation_id: "op_evidence_agent_grant".to_owned(),
                at: format!("unix-ms:{}", now_ms()),
            })
            .expect("production principal grant API enrolls the fixture Agent");
        let agent = store
            .authenticate_principal(
                PROJECT,
                &agent_credential,
                boreal_domain::TimestampMs::from_millis(now_ms()),
            )
            .expect("fixture Agent credential authenticates for this project");
        assert_eq!(agent.project_id, PROJECT);
        assert_eq!(agent.actor_id, AGENT);
        assert_eq!(agent.role, boreal_domain::ActorRole::Agent);

        assert_success(
            &run(
                &self.root,
                &vec![
                    "work".to_owned(),
                    "claim".to_owned(),
                    PROJECT.to_owned(),
                    WORK.to_owned(),
                    "--actor".to_owned(),
                    AGENT.to_owned(),
                    "--harness".to_owned(),
                    HARNESS.to_owned(),
                    "--session".to_owned(),
                    SESSION.to_owned(),
                    "--source-version".to_owned(),
                    SOURCE.to_owned(),
                    "--config-identity".to_owned(),
                    CONFIG.to_owned(),
                    "--db".to_owned(),
                    path(&self.database),
                    "--operation-id".to_owned(),
                    "op_evidence_claim".to_owned(),
                    "--json".to_owned(),
                ],
            ),
            "work claim",
        );
        assert_success(
            &run(
                &self.root,
                &vec![
                    "agent".to_owned(),
                    "start".to_owned(),
                    WORK.to_owned(),
                    "--project".to_owned(),
                    PROJECT.to_owned(),
                    "--actor".to_owned(),
                    AGENT.to_owned(),
                    "--harness".to_owned(),
                    HARNESS.to_owned(),
                    "--session".to_owned(),
                    SESSION.to_owned(),
                    "--db".to_owned(),
                    path(&self.database),
                    "--operation-id".to_owned(),
                    "op_evidence_start".to_owned(),
                    "--json".to_owned(),
                ],
            ),
            "agent start",
        );
    }

    fn executable(&self, name: &str, contents: &str) {
        let path = self.root.join(name);
        fs::write(&path, contents).unwrap();
        let mut permissions = fs::metadata(&path).unwrap().permissions();
        permissions.set_mode(0o755);
        fs::set_permissions(path, permissions).unwrap();
        self.write_gate();
    }

    fn write_gate(&self) {
        fs::write(
            self.root.join("gates/verification.json"),
            serde_json::to_vec(&json!({
                "gate_id": "verification",
                "kind": "verification",
                "executable": self.executable,
                "argv": self.argv,
                "cwd": ".",
                "source_snapshot_hash": SOURCE,
                "config_identity": CONFIG,
                "environment_fingerprint": "env-hardening",
                "observables": self.observables,
                "max_runtime_ms": 30_000
            }))
            .unwrap(),
        )
        .unwrap();
    }

    fn evidence_run(&self, operation: &str) -> Output {
        self.write_gate();
        run(
            &self.root,
            &vec![
                "evidence".to_owned(),
                "run".to_owned(),
                "--project".to_owned(),
                PROJECT.to_owned(),
                "--work".to_owned(),
                WORK.to_owned(),
                "--gate".to_owned(),
                "verification".to_owned(),
                "--actor".to_owned(),
                AGENT.to_owned(),
                "--harness".to_owned(),
                HARNESS.to_owned(),
                "--session".to_owned(),
                SESSION.to_owned(),
                "--operation-id".to_owned(),
                operation.to_owned(),
                "--db".to_owned(),
                path(&self.database),
                "--json".to_owned(),
            ],
        )
    }

    fn remove(self) {
        fs::remove_dir_all(self.root).unwrap();
    }
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn run(root: &Path, args: &[String]) -> Output {
    Command::new(binary())
        .current_dir(root)
        .args(args)
        .output()
        .unwrap()
}

fn assert_success(output: &Output, command: &str) {
    assert!(
        output.status.success(),
        "{command} failed: status={:?} stdout={} stderr={}",
        output.status.code(),
        text(output),
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

fn path(value: &Path) -> String {
    value.to_str().unwrap().to_owned()
}

fn path_value(value: &Value) -> PathBuf {
    value.as_str().map(PathBuf::from).expect("artifact path")
}

fn text(output: &Output) -> String {
    format!(
        "stdout={} stderr={}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

fn write_private_credential(root: &Path, project: &str, actor: &str) -> String {
    let runtime = root.join(".boreal");
    let directory = runtime.join("credentials");
    fs::create_dir_all(&directory).expect("fixture credentials directory is created");
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
        &fs::read(credential_path).expect("fixture principal credential exists"),
    )
    .expect("fixture credential is valid JSON");
    assert_eq!(credential["schema_version"], "boreal.local-credential.v1");
    assert_eq!(credential["project_id"], project);
    assert_eq!(credential["actor_id"], actor);
    credential["credential"]
        .as_str()
        .expect("fixture credential is present")
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
