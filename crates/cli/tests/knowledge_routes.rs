use std::{
    fs,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn unique_root() -> std::path::PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    std::env::temp_dir().join(format!("boreal-cli-source-{stamp}"))
}

fn run(root: &std::path::Path, args: &[&str]) -> serde_json::Value {
    let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(args)
        .output()
        .expect("bwrk should start");
    assert!(
        output.status.success(),
        "bwrk failed: {}\n{}",
        String::from_utf8_lossy(&output.stderr),
        String::from_utf8_lossy(&output.stdout)
    );
    serde_json::from_slice(&output.stdout).expect("bwrk should emit JSON")
}

#[test]
fn source_routes_capture_register_read_list_and_verify() {
    let root = unique_root();
    fs::create_dir_all(&root).expect("create test root");
    let db = root.join("project.sqlite");
    let input = root.join("notes.md");
    fs::write(&input, b"a durable source\n").expect("write source");

    let db_string = db.to_string_lossy().into_owned();
    let input_string = input.to_string_lossy().into_owned();
    run(
        &root,
        &["init", "knowledge-project", "--db", &db_string, "--json"],
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
