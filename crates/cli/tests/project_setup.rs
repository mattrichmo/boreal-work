use std::{
    fs,
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

fn temp_project() -> std::path::PathBuf {
    for attempt in 0..64_u32 {
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock is after epoch")
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "boreal-cli-project-{}-{stamp}-{attempt}",
            std::process::id()
        ));
        match fs::create_dir(&path) {
            Ok(()) => return path,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => panic!("temporary project creates: {error}"),
        }
    }
    panic!("temporary project name did not become unique");
}

#[test]
fn init_scaffolds_skills_and_is_safe_to_repeat() {
    let root = temp_project();
    let binary = env!("CARGO_BIN_EXE_bwrk");

    let first = Command::new(binary)
        .current_dir(&root)
        .args(["init", "--yes"])
        .output()
        .expect("init starts");
    assert!(first.status.success(), "{}", String::from_utf8_lossy(&first.stderr));
    assert!(root.join(".boreal/project.json").is_file());
    assert!(root.join(".boreal/boreal.sqlite").is_file());
    assert!(root.join("memory/index.md").is_file());
    assert!(root.join(".agents/skills/boreal-route/SKILL.md").is_file());

    let second = Command::new(binary)
        .current_dir(&root)
        .args(["init", "--yes", "--json"])
        .output()
        .expect("repeat init starts");
    assert!(second.status.success(), "{}", String::from_utf8_lossy(&second.stderr));
    let envelope: serde_json::Value = serde_json::from_slice(&second.stdout).expect("json envelope");
    assert_eq!(envelope["outcome"], "unchanged");
    assert_eq!(envelope["data"]["result"]["changed"], false);

    let _ = fs::remove_dir_all(root);
}

#[test]
fn setup_dry_run_does_not_write_and_both_installs_two_harness_roots() {
    let root = temp_project();
    let binary = env!("CARGO_BIN_EXE_bwrk");

    let dry_run = Command::new(binary)
        .current_dir(&root)
        .args(["init", "--dry-run"])
        .output()
        .expect("dry-run starts");
    assert!(dry_run.status.success(), "{}", String::from_utf8_lossy(&dry_run.stderr));
    assert!(!root.join(".boreal").exists());

    let both = Command::new(binary)
        .current_dir(&root)
        .args(["setup", "--agents", "codex,claude", "--yes", "--json"])
        .output()
        .expect("both-agent setup starts");
    assert!(both.status.success(), "{}", String::from_utf8_lossy(&both.stderr));
    assert!(root.join(".agents/skills/boreal-route/SKILL.md").is_file());
    assert!(root.join(".claude/skills/boreal-route/SKILL.md").is_file());

    let _ = fs::remove_dir_all(root);
}
