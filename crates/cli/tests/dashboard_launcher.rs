#![cfg(unix)]

use serde_json::Value;
use std::{
    fs::{self, File},
    io::{self, Read, Write},
    os::{
        fd::{FromRawFd, RawFd},
        raw::{c_char, c_int, c_ulong, c_void},
    },
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};

#[cfg(any(target_os = "linux", target_os = "macos"))]
use std::os::unix::process::CommandExt;

#[cfg_attr(target_os = "linux", link(name = "util"))]
unsafe extern "C" {
    fn openpty(
        master: *mut c_int,
        slave: *mut c_int,
        name: *mut c_char,
        termios: *const c_void,
        winsize: *const c_void,
    ) -> c_int;
}

struct PtyOutput {
    status: ExitStatus,
    stdout: String,
    stderr: String,
}

#[test]
fn one_command_dashboard_supervises_private_service_and_tui() {
    let root = temporary_root();
    fs::create_dir_all(&root).unwrap();
    // Keep the database outside the workspace metadata directory. This
    // proves that dashboard discovery uses the current workspace even when
    // --db points at an external state location.
    let database = root.join("external-state/boreal.sqlite");
    fs::write(
        root.join("project.json"),
        r#"{"project_id":"project-smoke"}"#,
    )
    .unwrap();
    let fixture = root.join("fixture-tui.js");
    let socket_log = root.join("socket.log");
    let invocation_log = root.join("invocation.log");
    let nested_workspace = root.join("nested/child");
    fs::create_dir_all(&nested_workspace).unwrap();
    write_fixture_tui(&fixture);

    let initialized = Command::new(binary())
        .current_dir(&root)
        .args(["init", "project-smoke", "--actor", "bootstrap", "--db"])
        .arg(&database)
        .arg("--json")
        .output()
        .unwrap();
    assert!(initialized.status.success(), "init failed: {initialized:?}");

    let successful_dashboard =
        dashboard_command(&root, &database, &fixture, &socket_log, &invocation_log, 0);
    let successful = run_in_pty(successful_dashboard, None);
    if successful.stderr.contains("Operation not permitted")
        || successful.stderr.contains("Permission denied")
    {
        // Some restricted CI/macOS sandboxes disallow Unix-domain socket
        // creation even though the feature is supported by the target
        // runtime. The service-level socket tests use the same escape hatch;
        // retain the integration test for normal developer/release hosts.
        fs::remove_dir_all(&root).unwrap();
        return;
    }
    assert!(
        successful.status.success(),
        "dashboard failed: {}",
        successful.stderr
    );
    assert!(successful.stdout.contains("fixture-tui"));
    assert!(
        !successful
            .stdout
            .lines()
            .any(|line| line.trim() == "ok" || line.trim_start().starts_with('{')),
        "interactive dashboard printed a launcher epilogue: {:?}",
        successful.stdout
    );

    let socket = PathBuf::from(fs::read_to_string(&socket_log).unwrap().trim());
    assert!(
        !socket.exists(),
        "dashboard left {} behind",
        socket.display()
    );
    assert!(
        !socket.parent().unwrap().exists(),
        "dashboard left its private runtime directory behind"
    );
    assert_no_process_uses(&socket);
    let invocation = fs::read_to_string(&invocation_log).unwrap();
    for expected in [
        "--socket",
        "--project",
        "project-smoke",
        "--actor",
        "bootstrap",
        "--harness",
        "tui",
        "--session",
        "--interactive",
    ] {
        assert!(invocation.lines().any(|line| line == expected));
    }

    let mut interactive_dashboard =
        dashboard_command(&root, &database, &fixture, &socket_log, &invocation_log, 0);
    interactive_dashboard.env("BOREAL_DASHBOARD_WAIT_FOR_INPUT", "1");
    let interactive = run_in_pty(interactive_dashboard, Some(b"q"));
    assert!(
        interactive.status.success(),
        "interactive dashboard failed: {}",
        interactive.stderr
    );
    assert!(interactive.stdout.contains("fixture-tui-input"));
    assert!(
        !interactive.stdout.contains("fixture-sigttin"),
        "TUI was stopped by terminal job control: {:?}",
        interactive.stdout
    );

    let failing_dashboard =
        dashboard_command(&root, &database, &fixture, &socket_log, &invocation_log, 23);
    let failed = run_in_pty(failing_dashboard, None);
    assert_eq!(failed.status.code(), Some(23), "stderr: {}", failed.stderr);
    let failed_socket = PathBuf::from(fs::read_to_string(&socket_log).unwrap().trim());
    assert!(!failed_socket.exists());
    assert!(!failed_socket.parent().unwrap().exists());
    assert_no_process_uses(&failed_socket);

    let discovered = run_in_pty(
        dashboard_command_without_project(
            &nested_workspace,
            &database,
            &fixture,
            &socket_log,
            &invocation_log,
            0,
        ),
        None,
    );
    assert!(
        discovered.status.success(),
        "dashboard metadata discovery failed: {}",
        discovered.stderr
    );
    assert!(discovered.stdout.contains("fixture-tui"));
    let discovered_invocation = fs::read_to_string(&invocation_log).unwrap();
    assert!(discovered_invocation
        .lines()
        .any(|line| line == "project-smoke"));
    let discovered_socket = PathBuf::from(fs::read_to_string(&socket_log).unwrap().trim());
    assert!(!discovered_socket.exists());
    assert!(!discovered_socket.parent().unwrap().exists());

    fs::remove_file(&invocation_log).unwrap();
    let json = Command::new(binary())
        .current_dir(&root)
        .env("BOREAL_TUI_ENTRYPOINT", &fixture)
        .env("BOREAL_DASHBOARD_INVOCATION_LOG", &invocation_log)
        .args([
            "dashboard",
            "--project",
            "project-smoke",
            "--actor",
            "bootstrap",
            "--db",
        ])
        .arg(&database)
        .arg("--json")
        .output()
        .unwrap();
    assert!(json.status.success(), "json dashboard failed: {json:?}");
    assert!(
        !invocation_log.exists(),
        "--json unexpectedly launched the TUI"
    );
    let envelope: Value = serde_json::from_slice(&json.stdout).unwrap();
    assert_eq!(envelope["transport"], "ok");
    assert!(envelope["data"].is_object());

    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn dashboard_requires_initialization_in_an_uninitialized_directory() {
    let root = temporary_root();
    fs::create_dir_all(&root).unwrap();

    let result = Command::new(binary())
        .current_dir(&root)
        .args(["dashboard", "--json"])
        .output()
        .unwrap();

    assert!(!result.status.success());
    let message = format!(
        "{}{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(message.contains("run `bwrk init`"), "{message}");
    fs::remove_dir_all(&root).unwrap();
}

#[test]
fn dashboard_keeps_two_project_roots_with_overlapping_ids_local() {
    let first = temporary_root().join("first");
    let second = temporary_root().join("second");
    fs::create_dir_all(first.join(".boreal")).unwrap();
    fs::create_dir_all(second.join(".boreal")).unwrap();

    for root in [&first, &second] {
        let initialized = Command::new(binary())
            .current_dir(root)
            .args(["init", "shared-project", "--actor", "bootstrap", "--json"])
            .output()
            .unwrap();
        assert!(initialized.status.success(), "init failed: {initialized:?}");

        let dashboard = Command::new(binary())
            .current_dir(root)
            .args(["dashboard", "--actor", "bootstrap", "--json"])
            .output()
            .unwrap();
        assert!(
            dashboard.status.success(),
            "dashboard failed: {dashboard:?}"
        );
        let envelope: Value = serde_json::from_slice(&dashboard.stdout).unwrap();
        assert_eq!(envelope["transport"], "ok");
        assert_eq!(envelope["data"]["project_id"], "shared-project");
    }

    fs::remove_dir_all(first).unwrap();
    fs::remove_dir_all(second).unwrap();
}

#[test]
fn dashboard_rejects_metadata_copied_from_another_project_root() {
    let source = temporary_root().join("source");
    let copied = temporary_root().join("copied");
    fs::create_dir_all(source.join(".boreal")).unwrap();
    fs::create_dir_all(&copied).unwrap();
    fs::write(
        source.join(".boreal/project.json"),
        serde_json::json!({
            "project_id": "project-a",
            "project_root": source,
            "database": source.join(".boreal/boreal.sqlite"),
        })
        .to_string(),
    )
    .unwrap();
    fs::create_dir_all(copied.join(".boreal")).unwrap();
    fs::copy(
        source.join(".boreal/project.json"),
        copied.join(".boreal/project.json"),
    )
    .unwrap();

    let result = Command::new(binary())
        .current_dir(&copied)
        .args(["dashboard", "--json"])
        .output()
        .unwrap();
    let message = format!(
        "{}{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(!result.status.success());
    assert!(message.contains("not bound to this directory"), "{message}");
    fs::remove_dir_all(source.parent().unwrap()).unwrap();
    fs::remove_dir_all(copied.parent().unwrap()).unwrap();
}

#[test]
fn dashboard_rejects_plausible_metadata_with_a_mismatched_stored_workspace_binding() {
    let source = temporary_root().join("source");
    let copied = temporary_root().join("copied");
    fs::create_dir_all(&source).unwrap();
    fs::create_dir_all(copied.join(".boreal")).unwrap();

    let initialized = Command::new(binary())
        .current_dir(&source)
        .args(["init", "identity-project", "--yes", "--json"])
        .output()
        .unwrap();
    assert!(initialized.status.success(), "init failed: {initialized:?}");

    let source_database = source.join(".boreal/boreal.sqlite");
    let copied_database = copied.join(".boreal/boreal.sqlite");
    fs::copy(&source_database, &copied_database).unwrap();
    let copied_root = fs::canonicalize(&copied).unwrap();
    fs::write(
        copied.join(".boreal/project.json"),
        serde_json::json!({
            "project_id": "identity-project",
            "project_root": copied_root,
            "database": ".boreal/boreal.sqlite",
        })
        .to_string(),
    )
    .unwrap();

    let result = Command::new(binary())
        .current_dir(&copied)
        .args(["dashboard", "--json"])
        .output()
        .unwrap();
    let message = format!(
        "{}{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(!result.status.success(), "dashboard unexpectedly succeeded");
    assert!(message.contains("different workspace"), "{message}");

    fs::remove_dir_all(source.parent().unwrap()).unwrap();
    fs::remove_dir_all(copied.parent().unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn dashboard_rejects_a_database_symlink_escape_before_opening_it() {
    let root = temporary_root();
    let outside = temporary_root().with_extension("outside");
    fs::create_dir_all(root.join(".boreal")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    let outside_database = outside.join("boreal.sqlite");
    fs::write(&outside_database, b"not a database").unwrap();
    std::os::unix::fs::symlink(&outside_database, root.join(".boreal/linked.sqlite")).unwrap();
    fs::write(
        root.join(".boreal/project.json"),
        serde_json::json!({
            "project_id": "project-a",
            "project_root": root,
            "database": root.join(".boreal/linked.sqlite"),
        })
        .to_string(),
    )
    .unwrap();

    let result = Command::new(binary())
        .current_dir(&root)
        .args(["dashboard", "--json"])
        .output()
        .unwrap();
    let message = format!(
        "{}{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(!result.status.success());
    assert!(
        message.contains("symlink") || message.contains("outside this project"),
        "{message}"
    );
    fs::remove_dir_all(&root).unwrap();
    fs::remove_dir_all(&outside).unwrap();
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn temporary_root() -> PathBuf {
    static TEMP_ROOT_COUNTER: AtomicU64 = AtomicU64::new(0);
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos()
        % 1_000_000_000;
    let counter = TEMP_ROOT_COUNTER.fetch_add(1, Ordering::Relaxed);
    // Unix-domain socket paths have a small fixed limit. Keep this fixture
    // root short so macOS's long TMPDIR prefix does not prevent launch tests.
    Path::new("/tmp").join(format!("bdi-{}-{nonce:x}-{counter:x}", std::process::id(),))
}

fn write_fixture_tui(path: &Path) {
    fs::write(
        path,
        r#"const fs = require("node:fs");
const net = require("node:net");

const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const socketPath = valueAfter("--socket");
const project = valueAfter("--project");
fs.writeFileSync(process.env.BOREAL_DASHBOARD_INVOCATION_LOG, `${args.join("\n")}\n`);
if (!socketPath || !fs.statSync(socketPath).isSocket()) process.exit(97);

const operationId = "op_dashboard_process_smoke";
const application = {
  api_version: "2",
  schema_version: "boreal.protocol.envelope.v1",
  operation_id: operationId,
  data: {
    command: "status",
    project_id: project,
    actor_id: valueAfter("--actor"),
    harness_id: valueAfter("--harness"),
    session_id: valueAfter("--session"),
    limit: 5,
    offset: 0,
  },
};
const body = Buffer.from(JSON.stringify({ request_id: operationId, payload: application }));
const frame = Buffer.allocUnsafe(body.length + 4);
frame.writeUInt32BE(body.length, 0);
body.copy(frame, 4);

let received = Buffer.alloc(0);
const client = net.createConnection(socketPath, () => client.write(frame));
client.on("data", (chunk) => {
  received = Buffer.concat([received, chunk]);
  if (received.length < 4) return;
  const size = received.readUInt32BE(0);
  if (received.length < size + 4) return;
  const response = JSON.parse(received.subarray(4, size + 4).toString("utf8"));
  if (response.request_id !== operationId || response.payload?.data?.transport !== "ok") {
    console.error(`unexpected service response: ${JSON.stringify(response)}`);
    process.exit(98);
  }
  fs.writeFileSync(process.env.BOREAL_DASHBOARD_SOCKET_LOG, `${socketPath}\n`);
  process.stdout.write("fixture-tui\n");
  const finish = (marker) => {
    if (marker) process.stdout.write(`${marker}\n`);
    process.stdin.setRawMode?.(false);
    client.end();
    process.exit(Number(process.env.BOREAL_DASHBOARD_FIXTURE_EXIT));
  };
  if (process.env.BOREAL_DASHBOARD_WAIT_FOR_INPUT === "1") {
    process.on("SIGTTIN", () => {
      process.stdout.write("fixture-sigttin\n");
      process.exit(96);
    });
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", (chunk) => {
      if (chunk.toString().includes("q")) finish("fixture-tui-input");
    });
  } else {
    finish();
  }
});
client.on("error", (error) => {
  console.error(error);
  process.exit(99);
});
"#,
    )
    .unwrap();
}

fn dashboard_command(
    root: &Path,
    database: &Path,
    fixture: &Path,
    socket_log: &Path,
    invocation_log: &Path,
    exit: i32,
) -> Command {
    let mut command = Command::new(binary());
    command
        .current_dir(root)
        .env("BOREAL_TUI_ENTRYPOINT", fixture)
        .env("BOREAL_DASHBOARD_SOCKET_LOG", socket_log)
        .env("BOREAL_DASHBOARD_INVOCATION_LOG", invocation_log)
        .env("BOREAL_DASHBOARD_FIXTURE_EXIT", exit.to_string())
        .args([
            "dashboard",
            "--project",
            "project-smoke",
            "--actor",
            "bootstrap",
            "--db",
        ])
        .arg(database);
    command
}

fn dashboard_command_without_project(
    root: &Path,
    database: &Path,
    fixture: &Path,
    socket_log: &Path,
    invocation_log: &Path,
    exit: i32,
) -> Command {
    let mut command = Command::new(binary());
    command
        .current_dir(root)
        .env("BOREAL_TUI_ENTRYPOINT", fixture)
        .env("BOREAL_DASHBOARD_SOCKET_LOG", socket_log)
        .env("BOREAL_DASHBOARD_INVOCATION_LOG", invocation_log)
        .env("BOREAL_DASHBOARD_FIXTURE_EXIT", exit.to_string())
        .args(["dashboard", "--actor", "bootstrap", "--db"])
        .arg(database);
    command
}

fn run_in_pty(mut command: Command, input: Option<&[u8]>) -> PtyOutput {
    let mut master: RawFd = -1;
    let mut slave: RawFd = -1;
    let opened = unsafe {
        openpty(
            &mut master,
            &mut slave,
            std::ptr::null_mut(),
            std::ptr::null(),
            std::ptr::null(),
        )
    };
    assert_eq!(opened, 0, "openpty failed: {}", io::Error::last_os_error());
    let mut master = unsafe { File::from_raw_fd(master) };
    let slave = unsafe { File::from_raw_fd(slave) };
    let stdin = slave.try_clone().unwrap();
    command
        .stdin(Stdio::from(stdin))
        .stdout(Stdio::from(slave))
        .stderr(Stdio::piped());

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    unsafe {
        command.pre_exec(|| {
            if setsid() == -1 {
                return Err(io::Error::last_os_error());
            }
            if ioctl(0, TIOCSCTTY, 0) == -1 {
                return Err(io::Error::last_os_error());
            }
            if tcsetpgrp(0, getpgrp()) == -1 {
                return Err(io::Error::last_os_error());
            }
            Ok(())
        });
    }

    let mut input_writer = input.map(|_| master.try_clone().unwrap());
    let child = command.spawn().unwrap();
    drop(command);
    if let (Some(writer), Some(input)) = (input_writer.as_mut(), input) {
        writer.write_all(input).unwrap();
    }
    drop(input_writer);
    let reader = std::thread::spawn(move || {
        let mut stdout = Vec::new();
        read_pty_to_end(&mut master, &mut stdout).unwrap();
        stdout
    });
    let output = child.wait_with_output().unwrap();
    let stdout = reader.join().unwrap();
    PtyOutput {
        status: output.status,
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    }
}

fn read_pty_to_end(reader: &mut File, output: &mut Vec<u8>) -> io::Result<()> {
    let mut buffer = [0_u8; 4096];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => return Ok(()),
            Ok(read) => output.extend_from_slice(&buffer[..read]),
            Err(error) if error.raw_os_error() == Some(5) => return Ok(()),
            Err(error) => return Err(error),
        }
    }
}

fn assert_no_process_uses(socket: &Path) {
    let processes = Command::new("ps")
        .args(["-ax", "-o", "command="])
        .output()
        .unwrap();
    assert!(processes.status.success());
    let listing = String::from_utf8_lossy(&processes.stdout);
    assert!(
        !listing.contains(&socket.to_string_lossy().to_string()),
        "a dashboard child still references {}",
        socket.display()
    );
}

#[cfg(any(target_os = "linux", target_os = "macos"))]
unsafe extern "C" {
    fn setsid() -> c_int;
    fn getpgrp() -> c_int;
    fn ioctl(fd: c_int, request: c_ulong, ...) -> c_int;
    fn tcsetpgrp(fd: c_int, pgrp: c_int) -> c_int;
}

#[cfg(target_os = "linux")]
const TIOCSCTTY: c_ulong = 0x540e;
#[cfg(target_os = "macos")]
const TIOCSCTTY: c_ulong = 0x2000_7461;
