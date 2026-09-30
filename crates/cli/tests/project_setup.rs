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
    assert!(
        first.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&first.stdout),
        String::from_utf8_lossy(&first.stderr)
    );
    assert!(root.join(".boreal/project.json").is_file());
    assert!(root.join(".boreal/boreal.sqlite").is_file());
    assert!(root.join("memory/index.md").is_file());
    assert!(root.join(".agents/skills/boreal-route/SKILL.md").is_file());

    let second = Command::new(binary)
        .current_dir(&root)
        .args(["init", "--yes", "--json"])
        .output()
        .expect("repeat init starts");
    assert!(
        second.status.success(),
        "{}",
        String::from_utf8_lossy(&second.stderr)
    );
    let envelope: serde_json::Value =
        serde_json::from_slice(&second.stdout).expect("json envelope");
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
    assert!(
        dry_run.status.success(),
        "{}",
        String::from_utf8_lossy(&dry_run.stderr)
    );
    assert!(!root.join(".boreal").exists());

    let both = Command::new(binary)
        .current_dir(&root)
        .args(["setup", "--agents", "codex,claude", "--yes", "--json"])
        .output()
        .expect("both-agent setup starts");
    assert!(
        both.status.success(),
        "{}",
        String::from_utf8_lossy(&both.stderr)
    );
    assert!(root.join(".agents/skills/boreal-route/SKILL.md").is_file());
    assert!(root.join(".claude/skills/boreal-route/SKILL.md").is_file());

    let _ = fs::remove_dir_all(root);
}

fn run_init(root: &std::path::Path, args: &[&str]) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(root)
        .args(args)
        .output()
        .expect("init starts")
}

#[test]
fn init_targets_current_directory_without_creating_a_test_project_child() {
    let root = temp_project();
    let output = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(root.join(".boreal/project.json").is_file());
    assert!(!root.join("test-project").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn repeated_init_without_identity_options_preserves_custom_actor_and_both_agents() {
    let root = temp_project();
    let first = run_init(
        &root,
        &[
            "init",
            "--yes",
            "--json",
            "--project",
            "custom-work",
            "--actor",
            "operator-custom",
            "--agents",
            "codex,claude",
        ],
    );
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let metadata_path = root.join(".boreal/project.json");
    let original: serde_json::Value =
        serde_json::from_slice(&fs::read(&metadata_path).unwrap()).unwrap();

    let repeat = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        repeat.status.success(),
        "{}",
        String::from_utf8_lossy(&repeat.stderr)
    );
    let envelope: serde_json::Value = serde_json::from_slice(&repeat.stdout).unwrap();
    assert_eq!(envelope["outcome"], "unchanged");
    let repeated: serde_json::Value =
        serde_json::from_slice(&fs::read(&metadata_path).unwrap()).unwrap();
    assert_eq!(repeated["project_id"], "custom-work");
    assert_eq!(repeated["operator_actor"], "operator-custom");
    assert_eq!(
        repeated["skill_targets"],
        serde_json::json!(["codex", "claude"])
    );
    assert_eq!(repeated["project_id"], original["project_id"]);
    assert_eq!(repeated["operator_actor"], original["operator_actor"]);
    assert!(root.join(".agents/skills/boreal-route/SKILL.md").is_file());
    assert!(root.join(".claude/skills/boreal-route/SKILL.md").is_file());
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn symlinked_memory_root_is_rejected_before_database_or_credentials() {
    use std::os::unix::fs::symlink;

    let root = temp_project();
    let outside = temp_project();
    symlink(&outside, root.join("memory")).expect("memory symlink creates");
    let output = run_init(&root, &["init", "--yes", "--json"]);
    assert!(!output.status.success());
    assert!(!root.join(".boreal/boreal.sqlite").exists());
    assert!(!root.join(".boreal/credentials").exists());
    assert!(outside.read_dir().unwrap().next().is_none());
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}

#[cfg(unix)]
#[test]
fn symlinked_skill_root_is_rejected_before_database_or_credentials() {
    use std::os::unix::fs::symlink;

    let root = temp_project();
    let outside = temp_project();
    fs::create_dir_all(root.join(".agents")).unwrap();
    symlink(&outside, root.join(".agents/skills")).expect("skill-root symlink creates");
    let output = run_init(&root, &["init", "--yes", "--json"]);
    assert!(!output.status.success());
    assert!(!root.join(".boreal/boreal.sqlite").exists());
    assert!(!root.join(".boreal/credentials").exists());
    assert!(outside.read_dir().unwrap().next().is_none());
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}

#[test]
fn external_skill_install_root_is_rejected_before_database_or_credentials() {
    let root = temp_project();
    let outside = temp_project();
    let output = run_init(
        &root,
        &[
            "init",
            "--yes",
            "--json",
            "--install-root",
            outside.to_str().expect("temporary path is UTF-8"),
        ],
    );
    assert!(!output.status.success());
    assert!(!root.join(".boreal/boreal.sqlite").exists());
    assert!(!root.join(".boreal/credentials").exists());
    assert!(outside.read_dir().unwrap().next().is_none());
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}

#[test]
fn memory_index_directory_collision_is_rejected_before_database_creation() {
    let root = temp_project();
    fs::create_dir_all(root.join("memory/index.md")).expect("file collision fixture creates");
    let output = run_init(&root, &["init", "--yes", "--json"]);
    assert!(!output.status.success());
    assert!(!root.join(".boreal/boreal.sqlite").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn public_status_does_not_cross_nested_git_or_incomplete_boreal_boundaries() {
    let root = temp_project();
    let init = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        init.status.success(),
        "{}",
        String::from_utf8_lossy(&init.stderr)
    );

    let nested_git = root.join("nested-git");
    fs::create_dir_all(nested_git.join(".git")).unwrap();
    let status = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(&nested_git)
        .args(["status", "--json"])
        .output()
        .unwrap();
    assert!(!status.status.success());

    let nested_marker = root.join("nested-marker");
    fs::create_dir_all(nested_marker.join(".boreal")).unwrap();
    let status = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(&nested_marker)
        .args(["status", "--json"])
        .output()
        .unwrap();
    assert!(!status.status.success());
    let status_output = format!(
        "{}{}",
        String::from_utf8_lossy(&status.stdout),
        String::from_utf8_lossy(&status.stderr)
    );
    assert!(
        status_output.contains("incomplete Boreal project marker"),
        "output: {status_output}"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn repeat_init_preserves_modified_installed_skill() {
    let root = temp_project();
    let init = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        init.status.success(),
        "{}",
        String::from_utf8_lossy(&init.stderr)
    );
    let skill = root.join(".agents/skills/boreal-route/SKILL.md");
    fs::write(&skill, "user-owned skill customization\n").unwrap();
    let repeat = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        repeat.status.success(),
        "{}",
        String::from_utf8_lossy(&repeat.stderr)
    );
    assert_eq!(
        fs::read_to_string(skill).unwrap(),
        "user-owned skill customization\n"
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn child_memory_scaffold_has_a_clean_git_baseline() {
    let root = temp_project();
    let init = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        init.status.success(),
        "{}",
        String::from_utf8_lossy(&init.stderr)
    );
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(root.join("memory"))
        .output()
        .expect("git status starts");
    assert!(status.status.success());
    assert!(
        status.stdout.is_empty(),
        "{}",
        String::from_utf8_lossy(&status.stdout)
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn second_project_identity_is_rejected_and_first_identity_remains_intact() {
    let root = temp_project();
    let first = run_init(&root, &["init", "--yes", "--json", "--project", "first"]);
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    let second = run_init(&root, &["init", "--yes", "--json", "--project", "second"]);
    assert!(!second.status.success());
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(".boreal/project.json")).unwrap()).unwrap();
    assert_eq!(metadata["project_id"], "first");
    let _ = fs::remove_dir_all(root);
}

#[cfg(unix)]
#[test]
fn symlinked_project_metadata_is_rejected_before_database_or_credentials() {
    use std::os::unix::fs::symlink;

    let root = temp_project();
    let outside = temp_project();
    let external_metadata = outside.join("project.json");
    fs::write(&external_metadata, "{}\n").unwrap();
    fs::create_dir_all(root.join(".boreal")).unwrap();
    symlink(&external_metadata, root.join(".boreal/project.json")).unwrap();

    let output = run_init(&root, &["init", "--yes", "--json"]);
    assert!(!output.status.success());
    assert!(!root.join(".boreal/boreal.sqlite").exists());
    assert!(!root.join(".boreal/credentials").exists());
    assert_eq!(fs::read_to_string(external_metadata).unwrap(), "{}\n");
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}

#[test]
fn interrupted_setup_pending_metadata_resumes_and_commits() {
    let root = temp_project();
    let boreal = root.join(".boreal");
    fs::create_dir_all(&boreal).unwrap();
    let project_root = fs::canonicalize(&root).unwrap();
    let pending = serde_json::json!({
        "schema_version": "boreal.project-setup.v2",
        "project_id": "resumable-project",
        "project_root": project_root,
        "database": project_root.join(".boreal/boreal.sqlite"),
        "memory_root": project_root.join("memory"),
        "memory_layout": "child",
        "skill_targets": ["codex", "claude"],
        "operator_actor": "resumed-operator",
        "skill_roots": [
            {"agent": "codex", "path": project_root.join(".agents/skills")},
            {"agent": "claude", "path": project_root.join(".claude/skills")}
        ],
        "created_at": "unix-ms:1"
    });
    fs::write(
        boreal.join("setup-pending.json"),
        serde_json::to_vec_pretty(&pending).unwrap(),
    )
    .unwrap();

    let output = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let committed: serde_json::Value =
        serde_json::from_slice(&fs::read(boreal.join("project.json")).unwrap()).unwrap();
    assert_eq!(committed["project_id"], "resumable-project");
    assert_eq!(committed["operator_actor"], "resumed-operator");
    assert_eq!(committed["created_at"], "unix-ms:1");
    assert!(!boreal.join("setup-pending.json").exists());
    assert!(root.join(".boreal/boreal.sqlite").is_file());
    assert!(root.join(".agents/skills/boreal-route/SKILL.md").is_file());
    assert!(root.join(".claude/skills/boreal-route/SKILL.md").is_file());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn in_repo_memory_initializes_and_repeats_without_a_nested_git_repository() {
    let root = temp_project();
    let git_init = Command::new("git")
        .args(["init", "--quiet"])
        .current_dir(&root)
        .output()
        .expect("git init starts");
    assert!(git_init.status.success());

    let first = run_init(
        &root,
        &["init", "--yes", "--json", "--memory-layout", "in-repo"],
    );
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    assert!(!root.join("memory/.git").exists());
    let first_envelope: serde_json::Value = serde_json::from_slice(&first.stdout).unwrap();
    assert_eq!(
        first_envelope["data"]["result"]["memory_publication_ready"],
        true
    );
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(root.join(".boreal/project.json")).unwrap()).unwrap();
    assert_eq!(metadata["memory_layout"], "in-repo");

    let repeated = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        repeated.status.success(),
        "{}",
        String::from_utf8_lossy(&repeated.stderr)
    );
    assert!(!root.join("memory/.git").exists());
    let repeated_envelope: serde_json::Value = serde_json::from_slice(&repeated.stdout).unwrap();
    assert_eq!(
        repeated_envelope["data"]["result"]["memory_publication_ready"],
        true
    );
    let status = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(&root)
        .output()
        .expect("git status starts");
    assert!(status.status.success());
    assert!(
        status.stdout.is_empty(),
        "{}",
        String::from_utf8_lossy(&status.stdout)
    );
    let _ = fs::remove_dir_all(root);
}

#[test]
fn in_repo_memory_requires_a_git_root_before_database_creation() {
    let root = temp_project();
    let output = run_init(
        &root,
        &["init", "--yes", "--json", "--memory-layout", "in-repo"],
    );
    assert!(!output.status.success());
    assert!(!root.join(".boreal/boreal.sqlite").exists());
    assert!(!root.join(".boreal/credentials").exists());
    assert!(!root.join("memory").exists());
    let _ = fs::remove_dir_all(root);
}

#[test]
fn positional_target_init_persists_identity_actor_and_supports_status() {
    let parent = temp_project();
    let target = parent.join("chosen-folder");
    let first = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(&parent)
        .args([
            "init",
            "chosen-folder",
            "--project",
            "chosen-project",
            "--actor",
            "chosen-operator",
            "--yes",
            "--json",
        ])
        .output()
        .unwrap();
    assert!(
        first.status.success(),
        "{}",
        String::from_utf8_lossy(&first.stderr)
    );
    assert!(target.join(".boreal/project.json").is_file());
    assert!(!parent.join(".boreal").exists());

    let repeated = run_init(&target, &["init", "--yes", "--json"]);
    assert!(
        repeated.status.success(),
        "{}",
        String::from_utf8_lossy(&repeated.stderr)
    );
    let metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(target.join(".boreal/project.json")).unwrap()).unwrap();
    assert_eq!(metadata["project_id"], "chosen-project");
    assert_eq!(metadata["operator_actor"], "chosen-operator");
    let status = Command::new(env!("CARGO_BIN_EXE_bwrk"))
        .current_dir(&target)
        .args(["status", "--json"])
        .output()
        .unwrap();
    assert!(
        status.status.success(),
        "{}",
        String::from_utf8_lossy(&status.stderr)
    );
    let _ = fs::remove_dir_all(parent);
}

#[test]
fn same_basename_projects_keep_independent_local_status() {
    let parent = temp_project();
    let left = parent.join("left/shared-name");
    let right = parent.join("right/shared-name");
    fs::create_dir_all(&left).unwrap();
    fs::create_dir_all(&right).unwrap();
    for root in [&left, &right] {
        let init = run_init(root, &["init", "--yes", "--json"]);
        assert!(
            init.status.success(),
            "{}",
            String::from_utf8_lossy(&init.stderr)
        );
    }
    let left_metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(left.join(".boreal/project.json")).unwrap()).unwrap();
    let right_metadata: serde_json::Value =
        serde_json::from_slice(&fs::read(right.join(".boreal/project.json")).unwrap()).unwrap();
    assert_eq!(left_metadata["project_id"], right_metadata["project_id"]);
    assert_ne!(
        left_metadata["project_root"],
        right_metadata["project_root"]
    );
    for root in [&left, &right] {
        let status = Command::new(env!("CARGO_BIN_EXE_bwrk"))
            .current_dir(root)
            .args(["status", "--json"])
            .output()
            .unwrap();
        assert!(
            status.status.success(),
            "{}",
            String::from_utf8_lossy(&status.stderr)
        );
    }
    let _ = fs::remove_dir_all(parent);
}

#[cfg(unix)]
#[test]
fn symlinked_gitignore_and_individual_skill_file_are_rejected_before_database() {
    use std::os::unix::fs::symlink;

    let root = temp_project();
    let outside = temp_project();
    let external_file = outside.join("owned.txt");
    fs::write(&external_file, "external user data\n").unwrap();
    symlink(&external_file, root.join(".gitignore")).unwrap();
    let output = run_init(&root, &["init", "--yes", "--json"]);
    assert!(!output.status.success());
    assert!(!root.join(".boreal/boreal.sqlite").exists());
    assert_eq!(
        fs::read_to_string(&external_file).unwrap(),
        "external user data\n"
    );
    let _ = fs::remove_file(root.join(".gitignore"));

    fs::create_dir_all(root.join(".agents/skills/boreal-route")).unwrap();
    symlink(
        &external_file,
        root.join(".agents/skills/boreal-route/SKILL.md"),
    )
    .unwrap();
    let output = run_init(&root, &["init", "--yes", "--json"]);
    assert!(!output.status.success());
    assert!(!root.join(".boreal/boreal.sqlite").exists());
    assert_eq!(
        fs::read_to_string(&external_file).unwrap(),
        "external user data\n"
    );
    let _ = fs::remove_dir_all(root);
    let _ = fs::remove_dir_all(outside);
}

#[test]
fn custom_install_root_is_restored_on_repeat_init() {
    let root = temp_project();
    let install_root = "custom/skills";
    let first = run_init(
        &root,
        &[
            "init",
            "--yes",
            "--json",
            "--agents",
            "codex",
            "--install-root",
            install_root,
        ],
    );
    assert!(
        first.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&first.stdout),
        String::from_utf8_lossy(&first.stderr)
    );
    let repeated = run_init(&root, &["init", "--yes", "--json"]);
    assert!(
        repeated.status.success(),
        "{}",
        String::from_utf8_lossy(&repeated.stderr)
    );
    assert!(root.join("custom/skills/boreal-route/SKILL.md").is_file());
    assert!(!root.join(".agents/skills/boreal-route/SKILL.md").exists());
    let _ = fs::remove_dir_all(root);
}
