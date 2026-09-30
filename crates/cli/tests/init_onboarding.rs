use serde_json::Value;
use std::{
    fs,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

#[test]
fn fresh_project_enrolls_a_distinct_worker_without_printing_secrets() {
    let root = std::env::temp_dir().join(format!(
        "boreal-onboard-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir(&root).unwrap();
    let run = |args: &[&str]| {
        let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
            .current_dir(&root)
            .args(args)
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{} {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(!String::from_utf8_lossy(&output.stdout).contains("bwrk1_"));
        serde_json::from_slice::<Value>(&output.stdout).unwrap()
    };
    let init = run(&["init", "--yes", "--json"]);
    let key = run(&["auth", "key", "--actor", "worker-a", "--json"]);
    assert_eq!(key["data"]["authority_granted"], false);
    let enrollment = key["data"]["enrollment_path"].as_str().unwrap();
    let bytes = fs::read(enrollment).unwrap();
    let repeated = run(&["auth", "key", "--actor", "worker-a", "--json"]);
    assert_eq!(key["data"], repeated["data"]);
    assert_eq!(fs::read(enrollment).unwrap(), bytes);
    let revision = init["revision"].as_u64().unwrap().to_string();
    run(&[
        "auth",
        "grant",
        "--input",
        enrollment,
        "--expected-revision",
        &revision,
        "--reason",
        "Enroll project worker",
        "--yes",
        "--json",
    ]);
    let principal = run(&["auth", "show", "--actor", "worker-a", "--json"]);
    assert_eq!(principal["data"]["role"], "agent");
    run(&[
        "session",
        "start",
        "--actor",
        "worker-a",
        "--session",
        "worker-a-session",
        "--json",
    ]);
    run(&[
        "status",
        "--actor",
        "worker-a",
        "--session",
        "worker-a-session",
        "--json",
    ]);
    fs::remove_dir_all(root).unwrap();
}
