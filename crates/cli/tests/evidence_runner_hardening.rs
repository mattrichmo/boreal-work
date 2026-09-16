#![cfg(unix)]

use boreal_application::sha256_content_digest;
use boreal_store::SqliteStore;
use serde_json::{json, Value};
use std::{
    fs,
    os::unix::fs::PermissionsExt,
    path::{Path, PathBuf},
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

const SCHEMA: &str = include_str!("../../../project/spec/schema-v2.sql");
const PROJECT: &str = "evidence-project";
const WORK: &str = "evidence-task";
const ACTOR: &str = "evidence-agent";
const HARNESS: &str = "evidence-harness";
const SESSION: &str = "evidence-session";
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
                    ACTOR.to_owned(),
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
                    ACTOR.to_owned(),
                    "--operation-id".to_owned(),
                    "op_evidence_work".to_owned(),
                    "--json".to_owned(),
                ],
            ),
            "work create",
        );
        assert_success(
            &run(
                &self.root,
                &vec![
                    "work".to_owned(),
                    "claim".to_owned(),
                    PROJECT.to_owned(),
                    WORK.to_owned(),
                    "--actor".to_owned(),
                    ACTOR.to_owned(),
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
                    ACTOR.to_owned(),
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
                ACTOR.to_owned(),
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
