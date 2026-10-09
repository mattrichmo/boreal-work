use std::{
    fs,
    path::Path,
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

const PROJECT: &str = "knowledge-project";
const OPERATOR: &str = "knowledge-operator";
const REVIEWER: &str = "knowledge-reviewer";
const HARNESS: &str = "knowledge-routes-test";
const OPERATOR_SESSION: &str = "knowledge-operator-session";
const REVIEWER_SESSION: &str = "knowledge-reviewer-session";

fn unique_root() -> std::path::PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!("boreal-cli-source-{stamp}"))
}

fn run(root: &std::path::Path, args: &[&str]) -> serde_json::Value {
    let output = invoke(root, args);
    assert!(
        output.status.success(),
        "bwrk failed: {}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    serde_json::from_slice(&output.stdout).expect("bwrk should emit JSON")
}

fn invoke(root: &Path, args: &[&str]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(args)
        .output()
        .expect("bwrk should start")
}

fn invoke_owned(root: &Path, args: &[String]) -> Output {
    Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(args)
        .output()
        .expect("bwrk should start")
}

fn memory_args(
    database: &Path,
    action: &str,
    target: Option<&str>,
    input: Option<&str>,
    actor: &str,
    session: &str,
    operation: &str,
    expected_revision: Option<u64>,
) -> Vec<String> {
    let mut args = vec![
        "memory".to_owned(),
        action.to_owned(),
        "--project".to_owned(),
        PROJECT.to_owned(),
    ];
    if let Some(target) = target {
        args.push(target.to_owned());
    }
    if let Some(input) = input {
        args.extend(["--input".to_owned(), input.to_owned()]);
    }
    if let Some(expected_revision) = expected_revision {
        args.extend([
            "--yes".to_owned(),
            "--expected-revision".to_owned(),
            expected_revision.to_string(),
        ]);
    }
    args.extend([
        "--actor".to_owned(),
        actor.to_owned(),
        "--harness".to_owned(),
        HARNESS.to_owned(),
        "--session".to_owned(),
        session.to_owned(),
        "--operation-id".to_owned(),
        operation.to_owned(),
        "--db".to_owned(),
        database.to_string_lossy().into_owned(),
        "--json".to_owned(),
    ]);
    args
}

fn memory_success(root: &Path, args: &[String], action: &str) -> serde_json::Value {
    let output = invoke_owned(root, args);
    assert!(
        output.status.success(),
        "{action} failed: {}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    serde_json::from_slice(&output.stdout).expect("bwrk should emit JSON")
}

#[test]
fn source_routes_capture_register_read_list_and_verify() {
    let root = unique_root();
    fs::create_dir_all(&root).expect("create test root");
    let db = root.join(".boreal/boreal.sqlite");
    let input = root.join("notes.md");
    fs::write(&input, b"a durable source\n").expect("write source");

    let db_string = db.to_string_lossy().into_owned();
    let input_string = input.to_string_lossy().into_owned();
    run(
        &root,
        &[
            "init",
            "--project",
            "knowledge-project",
            "--db",
            &db_string,
            "--json",
        ],
    );
    let added = run(
        &root,
        &[
            "source",
            "add",
            "knowledge-project",
            "--input",
            &input_string,
            "--origin",
            "notes.md",
            "--operation-id",
            "source-cli-op",
            "--db",
            &db_string,
            "--json",
        ],
    );
    assert_eq!(added["outcome"], "changed");
    assert_eq!(added["data"]["registration"]["state"], "store_committed");
    let source_id = added["data"]["source"]["source_version_id"]
        .as_str()
        .expect("source id")
        .to_owned();

    let shown = run(
        &root,
        &[
            "source",
            "show",
            "knowledge-project",
            &source_id,
            "--db",
            &db_string,
            "--json",
        ],
    );
    assert_eq!(shown["data"]["source"]["source_version_id"], source_id);
    assert!(shown["data"]["sqlite_registration"].is_object());

    let listed = run(
        &root,
        &[
            "source",
            "list",
            "knowledge-project",
            "--limit",
            "1",
            "--db",
            &db_string,
            "--json",
        ],
    );
    assert_eq!(listed["data"]["total"], 1);
    assert_eq!(listed["data"]["items"].as_array().unwrap().len(), 1);

    let verified = run(
        &root,
        &[
            "source",
            "verify",
            "knowledge-project",
            &source_id,
            "--db",
            &db_string,
            "--json",
        ],
    );
    assert_eq!(verified["data"]["availability"], "available");
    assert_eq!(verified["data"]["verified"], true);

    let retry = run(
        &root,
        &[
            "source",
            "add",
            "knowledge-project",
            "--input",
            &input_string,
            "--origin",
            "notes.md",
            "--operation-id",
            "source-cli-op",
            "--db",
            &db_string,
            "--json",
        ],
    );
    assert_eq!(retry["outcome"], "unchanged");
    assert_eq!(retry["data"]["registration"]["replayed"], true);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn memory_routes_recover_a_git_commit_before_database_reconciliation() {
    use boreal_store::SqliteStore;

    let root = unique_root();
    fs::create_dir_all(&root).expect("create test root");
    let database = root.join(".boreal/boreal.sqlite");
    let database_string = database.to_string_lossy().into_owned();
    let source_path = root.join("release-notes.md");
    fs::write(
        &source_path,
        b"A release needs a cited independent review before publication.\n",
    )
    .expect("write source fixture");

    run(
        &root,
        &[
            "init",
            "--project",
            PROJECT,
            "--actor",
            OPERATOR,
            "--db",
            &database_string,
            "--json",
        ],
    );
    run(
        &root,
        &[
            "session",
            "start",
            "--project",
            PROJECT,
            "--actor",
            OPERATOR,
            "--harness",
            HARNESS,
            "--session",
            OPERATOR_SESSION,
            "--db",
            &database_string,
            "--operation-id",
            "op_knowledge_operator_session",
            "--json",
        ],
    );

    // Create a disposable reviewer key and grant it an independent authority
    // root so the route exercises the real review rule without user data.
    let key = run(
        &root,
        &[
            "auth",
            "key",
            "--project",
            PROJECT,
            "--actor",
            REVIEWER,
            "--actor-role",
            "reviewer",
            "--db",
            &database_string,
            "--json",
        ],
    );
    let enrollment_path = key["data"]["enrollment_path"]
        .as_str()
        .expect("reviewer key returns its local enrollment path");
    let enrollment: serde_json::Value =
        serde_json::from_slice(&fs::read(enrollment_path).expect("read disposable enrollment"))
            .expect("enrollment is JSON");
    let mut enrollment = enrollment;
    enrollment["independent"] = serde_json::json!(true);
    fs::write(
        enrollment_path,
        serde_json::to_vec(&enrollment).expect("encode independent enrollment"),
    )
    .expect("mark synthetic reviewer independent");

    let store = SqliteStore::open(
        &database,
        include_str!("../../../project/spec/schema-v2.sql"),
    )
    .expect("synthetic project store opens");
    let revision = store.project_revision(PROJECT).expect("revision reads").0;
    drop(store);
    run(
        &root,
        &[
            "auth",
            "grant",
            "--project",
            PROJECT,
            "--actor",
            OPERATOR,
            "--input",
            enrollment_path,
            "--expected-revision",
            &revision.to_string(),
            "--reason",
            "grant independent synthetic memory reviewer",
            "--yes",
            "--db",
            &database_string,
            "--operation-id",
            "op_knowledge_reviewer_grant",
            "--json",
        ],
    );

    run(
        &root,
        &[
            "session",
            "start",
            "--project",
            PROJECT,
            "--actor",
            REVIEWER,
            "--harness",
            HARNESS,
            "--session",
            REVIEWER_SESSION,
            "--db",
            &database_string,
            "--operation-id",
            "op_knowledge_reviewer_session",
            "--json",
        ],
    );

    let captured = run(
        &root,
        &[
            "source",
            "add",
            PROJECT,
            "--input",
            source_path.to_str().unwrap(),
            "--origin",
            "release-notes.md",
            "--media-type",
            "text/markdown",
            "--actor",
            OPERATOR,
            "--operation-id",
            "op_knowledge_source",
            "--db",
            &database_string,
            "--json",
        ],
    );
    assert_eq!(captured["data"]["index"]["state"], "indexed");
    let source_version = captured["data"]["source"]["source_version_id"]
        .as_str()
        .unwrap();

    let draft_input = root.join("memory-draft.json");
    fs::write(
        &draft_input,
        serde_json::to_vec(&serde_json::json!({
            "draft_id": "release-review-draft",
            "entry_id": "release-review",
            "title": "Release review",
            "body": "A release needs a cited independent review before publication.",
            "citations": [{
                "source_version_id": source_version,
                "location": "line:1",
                "excerpt": "cited independent review"
            }]
        }))
        .unwrap(),
    )
    .expect("write draft request");
    let draft = memory_success(
        &root,
        &memory_args(
            &database,
            "draft",
            Some("release-review-draft"),
            Some("memory-draft.json"),
            OPERATOR,
            OPERATOR_SESSION,
            "op_knowledge_memory_draft",
            Some(captured["revision"].as_u64().unwrap()),
        ),
        "memory draft",
    );
    assert_eq!(draft["outcome"], "changed");

    let draft_readback = memory_success(
        &root,
        &memory_args(
            &database,
            "show",
            Some("release-review-draft"),
            None,
            OPERATOR,
            OPERATOR_SESSION,
            "op_knowledge_memory_draft_show",
            None,
        ),
        "memory show before review",
    );
    assert_eq!(
        draft_readback["data"]["citations"][0]["excerpt_digest"]
            .as_str()
            .unwrap()
            .len(),
        71
    );

    let review_input = root.join("memory-review.json");
    fs::write(
        &review_input,
        br#"{"decision":"approved","reason":"Independent reviewer verified the cited source."}"#,
    )
    .expect("write review request");
    let review = memory_success(
        &root,
        &memory_args(
            &database,
            "review",
            Some("release-review-draft"),
            Some("memory-review.json"),
            REVIEWER,
            REVIEWER_SESSION,
            "op_knowledge_memory_review",
            Some(draft["revision"].as_u64().unwrap()),
        ),
        "memory review",
    );
    assert_eq!(review["data"]["decision"], "approved");

    // Force the recoverable boundary after Git has committed but before the
    // SQLite job can acknowledge that commit. This is confined to this temp DB.
    let store = SqliteStore::open(
        &database,
        include_str!("../../../project/spec/schema-v2.sql"),
    )
    .expect("synthetic project store reopens");
    store
        .execute_batch(
            r#"CREATE TRIGGER fail_knowledge_publication_ack
               BEFORE UPDATE ON boreal_external_job
               WHEN OLD.operation_id='op_knowledge_memory_publish' AND NEW.stage='reconciled'
               BEGIN
                 SELECT RAISE(ABORT, 'synthetic publication acknowledgement interruption');
               END;"#,
        )
        .expect("install one-shot local publication fault");
    drop(store);

    let publish_input = root.join("memory-publish.json");
    fs::write(&publish_input, br#"{"expected_manifest_identity":""}"#)
        .expect("write publish request");
    let publish = invoke_owned(
        &root,
        &memory_args(
            &database,
            "publish",
            Some("op_knowledge_memory_review"),
            Some("memory-publish.json"),
            OPERATOR,
            OPERATOR_SESSION,
            "op_knowledge_memory_publish",
            Some(review["revision"].as_u64().unwrap()),
        ),
    );
    assert!(
        !publish.status.success(),
        "injected acknowledgement fault must surface"
    );
    let uncertain: serde_json::Value = serde_json::from_slice(&publish.stdout)
        .expect("unknown publication response keeps its JSON envelope");
    assert_eq!(uncertain["outcome"], "unknown");
    assert_eq!(uncertain["error"]["code"], "unknown_outcome");
    assert_eq!(
        uncertain["error"]["operation_id"],
        "op_knowledge_memory_publish"
    );
    assert_eq!(uncertain["error"]["readback_required"], true);
    assert!(uncertain["error"]["message"]
        .as_str()
        .unwrap()
        .contains("bwrk memory readback"));

    let first_readback = memory_success(
        &root,
        &memory_args(
            &database,
            "readback",
            Some("op_knowledge_memory_publish"),
            None,
            OPERATOR,
            OPERATOR_SESSION,
            "op_knowledge_memory_readback",
            None,
        ),
        "memory publication readback",
    );
    assert_eq!(
        first_readback["data"]["reconciliation_state"],
        "git_committed_db_pending"
    );
    assert_eq!(first_readback["data"]["git_verified"], true);
    assert_eq!(first_readback["data"]["readback_required"], true);

    let store = SqliteStore::open(
        &database,
        include_str!("../../../project/spec/schema-v2.sql"),
    )
    .expect("synthetic project store reopens for recovery");
    store
        .execute_batch("DROP TRIGGER fail_knowledge_publication_ack")
        .expect("remove local publication fault");
    drop(store);

    let reconciled = memory_success(
        &root,
        &memory_args(
            &database,
            "reconcile",
            Some("op_knowledge_memory_publish"),
            None,
            OPERATOR,
            OPERATOR_SESSION,
            "op_knowledge_memory_reconcile",
            Some(first_readback["revision"].as_u64().unwrap()),
        ),
        "memory publication reconcile",
    );
    assert_eq!(
        reconciled["data"]["readback"]["reconciliation_state"],
        "reconciled"
    );

    let final_readback = memory_success(
        &root,
        &memory_args(
            &database,
            "readback",
            Some("op_knowledge_memory_publish"),
            None,
            OPERATOR,
            OPERATOR_SESSION,
            "op_knowledge_memory_readback_final",
            None,
        ),
        "memory publication final readback",
    );
    assert_eq!(final_readback["data"]["readback_required"], false);
    assert_eq!(final_readback["data"]["git_verified"], true);

    let search = memory_success(
        &root,
        &memory_args(
            &database,
            "search",
            Some("cited independent review"),
            None,
            OPERATOR,
            OPERATOR_SESSION,
            "op_knowledge_memory_search",
            None,
        ),
        "memory search",
    );
    assert_eq!(search["data"]["hits"][0]["entry_id"], "release-review");
    assert_eq!(
        search["data"]["hits"][0]["citations"][0]["source_version_id"],
        source_version
    );

    fs::remove_dir_all(root).expect("remove disposable memory workflow fixture");
}
