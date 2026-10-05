use serde_json::Value;
use std::{
    fs,
    path::PathBuf,
    process::{Command, Output},
    time::{SystemTime, UNIX_EPOCH},
};

const PROJECT: &str = "prime-inline-project";
const ACTOR: &str = "prime-inline-agent";
const SESSION: &str = "prime-inline-session";
const ITEM_COUNT: u64 = 100;
const INLINE_BOUND: usize = 65_536;

struct TemporaryRoot(PathBuf);

impl Drop for TemporaryRoot {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn default_prime_is_bounded_and_keeps_pagination_for_large_projects() {
    let root = temporary_root();
    fs::create_dir_all(&root.0).expect("temporary project root");
    let database = root.0.join(".boreal/boreal.sqlite");
    let binary = env!("CARGO_BIN_EXE_bwrk");

    let initialized = Command::new(binary)
        .current_dir(&root.0)
        .args(["init", "--project", PROJECT, "--actor", ACTOR, "--db"])
        .arg(&database)
        .args(["--operation-id", "prime-inline-init", "--json"])
        .output()
        .expect("init starts");
    envelope(&initialized, "init");

    let session = Command::new(binary)
        .current_dir(&root.0)
        .args([
            "session",
            "start",
            "--project",
            PROJECT,
            "--actor",
            ACTOR,
            "--harness",
            "prime-inline-test",
            "--session",
            SESSION,
            "--db",
        ])
        .arg(&database)
        .args(["--operation-id", "prime-inline-session-start", "--json"])
        .output()
        .expect("session start starts");
    let mut revision = envelope(&session, "session start")["revision"]
        .as_u64()
        .expect("session start returns a revision");

    // A multi-row status page uses most of its own byte budget before prime
    // adds its guide and project-authored instructions.
    let description = "d".repeat(5_000);
    for index in 0..ITEM_COUNT {
        let work_id = format!("task-{index:03}");
        let operation_id = format!("prime-inline-create-{index:03}");
        let expected_revision = revision.to_string();
        let created = Command::new(binary)
            .current_dir(&root.0)
            .args([
                "work",
                "create",
                PROJECT,
                work_id.as_str(),
                "Inline-bound regression item",
                "--actor",
                ACTOR,
                "--session",
                SESSION,
                "--expected-revision",
                expected_revision.as_str(),
                "--db",
            ])
            .arg(&database)
            .args(["--operation-id", operation_id.as_str(), "--description"])
            .arg(&description)
            .args(["--json"])
            .output()
            .expect("work create starts");
        revision = envelope(&created, "work create")["revision"]
            .as_u64()
            .expect("work create returns a revision");
    }

    // Fill the complete documented 16 KiB guidance budget to exercise the
    // extra context that makes a multi-row prime page exceed the protocol cap.
    for (relative, directory) in [
        ("AGENTS.md", None),
        ("CLAUDE.md", None),
        (".agents/AGENTS.md", Some(".agents")),
        (".agents/CLAUDE.md", Some(".agents")),
    ] {
        if let Some(directory) = directory {
            fs::create_dir_all(root.0.join(directory)).expect("guidance directory");
        }
        fs::write(root.0.join(relative), "g".repeat(4_096)).expect("project guidance");
    }

    // Standalone status has its own byte-aware row trimming; keep its default
    // page size while verifying it continues to advertise the returned page.
    let status = Command::new(binary)
        .current_dir(&root.0)
        .args([
            "status",
            PROJECT,
            "--actor",
            ACTOR,
            "--session",
            SESSION,
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("status starts");
    let status = envelope(&status, "status");
    assert_eq!(status["data"]["limit"], 100);
    assert_eq!(status["data"]["total"], ITEM_COUNT);
    assert!(status["data"]["returned_rows"].as_u64().unwrap() > 1);
    assert!(status["data"]["returned_rows"].as_u64().unwrap() < ITEM_COUNT);
    assert_eq!(status["data"]["has_more"], true);
    assert_eq!(
        status["data"]["next_offset"],
        status["data"]["returned_rows"]
    );

    let prime = Command::new(binary)
        .current_dir(&root.0)
        .args([
            "prime",
            "--project",
            PROJECT,
            "--actor",
            ACTOR,
            "--session",
            SESSION,
            "--db",
        ])
        .arg(&database)
        .args(["--json"])
        .output()
        .expect("prime starts");
    let prime_value = envelope(&prime, "default prime");
    assert!(
        prime.stdout.len() <= INLINE_BOUND,
        "prime exceeded the inline bound"
    );
    assert_eq!(prime_value["data"]["kind"], "project_brief");
    assert_eq!(prime_value["data"]["status"]["limit"], 1);
    assert_eq!(prime_value["data"]["status"]["offset"], 0);
    assert_eq!(prime_value["data"]["status"]["total"], ITEM_COUNT);
    assert_eq!(prime_value["data"]["status"]["returned_rows"], 1);
    assert_eq!(
        prime_value["data"]["status"]["items"]
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert_eq!(prime_value["data"]["status"]["has_more"], true);
    assert_eq!(prime_value["data"]["status"]["next_offset"], 1);
    let guidance_bytes = prime_value["data"]["project_guidance"]["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|file| file["content"].as_str().unwrap().len())
        .sum::<usize>();
    assert_eq!(guidance_bytes, 16 * 1024);

    // Remove the full guidance fixture so the larger explicit status page can
    // fit; both caller-supplied pagination values must pass through unchanged.
    for relative in [
        "AGENTS.md",
        "CLAUDE.md",
        ".agents/AGENTS.md",
        ".agents/CLAUDE.md",
    ] {
        fs::remove_file(root.0.join(relative)).expect("remove guidance fixture");
    }
    let explicit = Command::new(binary)
        .current_dir(&root.0)
        .args([
            "prime",
            "--project",
            PROJECT,
            "--actor",
            ACTOR,
            "--session",
            SESSION,
            "--db",
        ])
        .arg(&database)
        .args(["--limit", "2", "--offset", "50", "--json"])
        .output()
        .expect("explicitly paged prime starts");
    let explicit_value = envelope(&explicit, "explicitly paged prime");
    assert_eq!(explicit_value["data"]["status"]["limit"], 2);
    assert_eq!(explicit_value["data"]["status"]["offset"], 50);
    assert_eq!(explicit_value["data"]["status"]["total"], ITEM_COUNT);
    assert_eq!(explicit_value["data"]["status"]["returned_rows"], 2);
    assert_eq!(explicit_value["data"]["status"]["has_more"], true);
    assert_eq!(explicit_value["data"]["status"]["next_offset"], 52);
}

fn envelope(output: &Output, operation: &str) -> Value {
    assert!(
        output.status.success(),
        "{operation} failed: status={:?}\nstdout={}\nstderr={}",
        output.status.code(),
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    serde_json::from_slice(&output.stdout).expect("command emits JSON")
}

fn temporary_root() -> TemporaryRoot {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock before unix epoch")
        .as_nanos();
    TemporaryRoot(std::env::temp_dir().join(format!(
        "boreal-prime-inline-{}-{stamp}",
        std::process::id()
    )))
}
