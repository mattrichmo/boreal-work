//! Machine update routes stay bound to the installed package, independent of cwd.

use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn temporary_root() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-machine-update-authority-{}-{stamp}",
        std::process::id()
    ))
}

#[test]
fn update_status_ignores_project_database_and_uses_no_working_directory_authority() {
    let root = temporary_root();
    let project = root.join("arbitrary-project");
    let global_root = root.join("invoking-user-global");
    let project_database = project.join(".boreal/boreal.sqlite");
    fs::create_dir_all(project_database.parent().expect("project db parent"))
        .expect("create arbitrary project");
    fs::write(&project_database, b"not a project database").expect("write invalid db fixture");
    let before = fs::read(&project_database).expect("read db fixture");

    let output = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(&project)
        .args(["update", "status", "--json"])
        .env("BOREAL_GLOBAL_ROOT", &global_root)
        .output()
        .expect("run machine update status");
    assert!(
        output.status.success(),
        "machine status should not resolve the project database: status={:?}\nstdout={}\nstderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let envelope: Value = serde_json::from_slice(&output.stdout).expect("JSON response");
    assert_eq!(envelope["error"], Value::Null);
    assert_eq!(envelope["data"]["command"], "update status");
    assert_eq!(envelope["data"]["read_only"], true);
    assert_eq!(
        fs::read(&project_database).expect("project db remains"),
        before
    );
    assert!(
        !global_root.exists(),
        "status must not bootstrap Global state"
    );

    let rejected_selector = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(&project)
        .args(["update", "status", "--db"])
        .arg(&project_database)
        .args(["--json"])
        .output()
        .expect("run machine route with project selector");
    assert!(!rejected_selector.status.success());
    let diagnostic = format!(
        "{}\n{}",
        String::from_utf8_lossy(&rejected_selector.stdout),
        String::from_utf8_lossy(&rejected_selector.stderr)
    );
    assert!(
        diagnostic.contains("machine update does not accept --db"),
        "selector rejection should identify the machine authority boundary: {diagnostic}"
    );
    assert_eq!(
        fs::read(&project_database).expect("project db remains"),
        before
    );

    fs::remove_dir_all(root).expect("remove fixtures");
}
