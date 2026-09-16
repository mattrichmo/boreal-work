#![cfg(unix)]

use serde_json::Value;
use std::{
    fs::{self, File},
    io::{self, Read},
    os::{
        fd::{FromRawFd, RawFd},
        raw::{c_char, c_int, c_void},
    },
    path::{Path, PathBuf},
    process::{Command, ExitStatus, Stdio},
    time::{SystemTime, UNIX_EPOCH},
};

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
        .args(["init", "project-smoke", "--db"])
        .arg(&database)
        .arg("--json")
        .output()
        .unwrap();
    assert!(initialized.status.success(), "init failed: {initialized:?}");

    let successful_dashboard =
        dashboard_command(&root, &database, &fixture, &socket_log, &invocation_log, 0);
    let successful = run_in_pty(successful_dashboard);
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
        "agent-1",
        "--harness",
        "tui",
        "--session",
        "--interactive",
    ] {
        assert!(invocation.lines().any(|line| line == expected));
    }

    let failing_dashboard =
        dashboard_command(&root, &database, &fixture, &socket_log, &invocation_log, 23);
    let failed = run_in_pty(failing_dashboard);
    assert_eq!(failed.status.code(), Some(23), "stderr: {}", failed.stderr);
    let failed_socket = PathBuf::from(fs::read_to_string(&socket_log).unwrap().trim());
    assert!(!failed_socket.exists());
    assert!(!failed_socket.parent().unwrap().exists());
    assert_no_process_uses(&failed_socket);

    let discovered = run_in_pty(dashboard_command_without_project(
        &nested_workspace,
        &database,
        &fixture,
        &socket_log,
        &invocation_log,
        0,
    ));
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
        .args(["dashboard", "--project", "project-smoke", "--db"])
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

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

fn temporary_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    std::env::temp_dir().join(format!(
        "boreal-dashboard-integration-{}-{nonce}",
        std::process::id()
    ))
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
  client.end();
  process.exit(Number(process.env.BOREAL_DASHBOARD_FIXTURE_EXIT));
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
        .args(["dashboard", "--project", "project-smoke", "--db"])
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
        .args(["dashboard", "--db"])
        .arg(database);
    command
}

fn run_in_pty(mut command: Command) -> PtyOutput {
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
    let child = command.spawn().unwrap();
    drop(command);
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
