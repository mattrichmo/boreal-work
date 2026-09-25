use serde_json::Value;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

fn temporary_root() -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    std::env::temp_dir().join(format!("boreal-cli-backup-{}-{stamp}", std::process::id()))
}

fn json(output: std::process::Output) -> Value {
    assert!(
        output.status.success(),
        "command failed: {}\nstdout: {}\nstderr: {}",
        output.status,
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("command emits JSON")
}

#[test]
fn cli_backup_and_restore_use_manifest_and_new_restore_epoch() {
    let root = temporary_root();
    fs::create_dir_all(&root).expect("temporary root");
    let database = root.join("source.sqlite");
    let package = root.join("backup-package");
    let binary = env!("CARGO_BIN_EXE_bwrk");

    json(
        Command::new(binary)
            .current_dir(&root)
            .args(["init", "cli-backup-project", "--db"])
            .arg(&database)
            .args(["--json"])
            .output()
            .expect("init starts"),
    );

    let backup = json(
        Command::new(binary)
            .current_dir(&root)
            .args(["backup"])
            .arg(&package)
            .args(["--db"])
            .arg(&database)
            .args(["--operation-id", "backup-readback-1"])
            .args(["--json"])
            .output()
            .expect("backup starts"),
    );
    assert_eq!(backup["data"]["restore_supported"], true);
    assert!(package.join("database.sqlite").exists());
    assert!(package.join("manifest.json").exists());

    let backup_readback = json(
        Command::new(binary)
            .current_dir(&root)
            .args(["backup"])
            .arg(&package)
            .args(["--db"])
            .arg(&database)
            .args(["--operation-id", "backup-readback-1"])
            .args(["--json"])
            .output()
            .expect("backup readback starts"),
    );
    assert_eq!(backup_readback["outcome"], "unchanged");
    assert_eq!(
        backup_readback["data"]["manifest_sha256"],
        backup["data"]["manifest_sha256"]
    );

    let restore = json(
        Command::new(binary)
            .current_dir(&root)
            .args(["restore"])
            .arg(&package)
            .args(["--yes"])
            .args(["--db"])
            .arg(&database)
            .args(["--json"])
            .output()
            .expect("restore starts"),
    );
    assert!(restore["data"]["current_restore_epoch"]
        .as_u64()
        .is_some_and(|epoch| epoch > restore["data"]["source_restore_epoch"].as_u64().unwrap()));

    let _ = fs::remove_dir_all(root);
}
