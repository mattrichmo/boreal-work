#![cfg(unix)]

use serde_json::Value;
use std::{
    fs,
    os::raw::c_int,
    os::unix::net::UnixStream,
    path::{Path, PathBuf},
    process::{Child, Command, Output, Stdio},
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

const SIGTERM: c_int = 15;
const SIGKILL: c_int = 9;

unsafe extern "C" {
    fn kill(process: c_int, signal: c_int) -> c_int;
}

#[test]
fn service_workflow_queries_match_direct_assets_without_project_context() {
    let temp = TempDir::new("workflow-discovery");
    let database = temp.path().join("boreal.sqlite");
    let socket = temp.path().join("s.sock");

    let initialized = Command::new(binary())
        .current_dir(temp.path())
        .args(["init", "workflow-discovery-project", "--db"])
        .arg(&database)
        .args(["--actor", "workflow-discovery-agent", "--json"])
        .output()
        .expect("disposable service project initializes");
    assert_success(&initialized, "initialize service project");

    let Some(service) = start_service(temp.path(), &database, &socket) else {
        return;
    };

    let list = Command::new(binary())
        .current_dir(temp.path())
        .args(["workflows", "list", "--socket"])
        .arg(&socket)
        .args(["--json"])
        .output()
        .expect("service workflow list launches");
    let show = Command::new(binary())
        .current_dir(temp.path())
        .args(["workflows", "show", "boreal.workflow.audit.v1", "--socket"])
        .arg(&socket)
        .args(["--json"])
        .output()
        .expect("service workflow show launches");

    let _ = stop_service(service, &socket);

    assert_success(&list, "service workflow list");
    assert_success(&show, "service workflow show");
    let direct_list: Value = serde_json::from_slice(
        &Command::new(binary())
            .args(["workflows", "list", "--json"])
            .output()
            .expect("direct workflow list launches")
            .stdout,
    )
    .expect("direct workflow list is JSON");
    let service_list: Value = json(&list);
    let service_show: Value = json(&show);
    assert_eq!(
        service_list["data"]["asset_identity"],
        direct_list["data"]["asset_identity"]
    );
    assert_eq!(
        service_list["data"]["assets"],
        direct_list["data"]["assets"]
    );
    assert_eq!(
        service_show["data"]["asset"]["reference"],
        "boreal.workflow.audit.v1"
    );
}

fn start_service(root: &Path, database: &Path, socket: &Path) -> Option<Child> {
    let mut child = Command::new(binary())
        .current_dir(root)
        .args(["service", "run", "--db"])
        .arg(database)
        .args(["--socket"])
        .arg(socket)
        .args(["--json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("service launches");

    for _ in 0..300 {
        if socket.exists() && UnixStream::connect(socket).is_ok() {
            return Some(child);
        }
        if child.try_wait().expect("service status reads").is_some() {
            let output = child
                .wait_with_output()
                .expect("service output reads after early exit");
            let combined = text(&output);
            if combined.contains("Operation not permitted")
                || combined.contains("Permission denied")
            {
                return None;
            }
            panic!("service exited before becoming ready: {combined}");
        }
        thread::sleep(Duration::from_millis(10));
    }

    terminate_if_running(&mut child, SIGKILL);
    panic!("service did not create its socket within the startup timeout");
}

fn stop_service(mut child: Child, socket: &Path) -> Output {
    terminate_if_running(&mut child, SIGTERM);
    let output = child
        .wait_with_output()
        .expect("service output reads after signal");
    for _ in 0..100 {
        if !socket.exists() {
            return output;
        }
        thread::sleep(Duration::from_millis(10));
    }
    assert!(
        !socket.exists(),
        "service left socket {} behind",
        socket.display()
    );
    output
}

fn terminate_if_running(child: &mut Child, signal: c_int) {
    unsafe {
        assert_eq!(kill(child.id() as c_int, signal), 0, "service signal sends");
    }
    for _ in 0..300 {
        if child.try_wait().expect("service status reads").is_some() {
            return;
        }
        thread::sleep(Duration::from_millis(10));
    }
    unsafe {
        let _ = kill(child.id() as c_int, SIGKILL);
    }
    let _ = child.wait();
    panic!("service did not exit after signal {signal}");
}

fn assert_success(output: &Output, command: &str) {
    assert!(
        output.status.success(),
        "{command} failed: {}",
        text(output)
    );
}

fn json(output: &Output) -> Value {
    serde_json::from_slice(&output.stdout)
        .unwrap_or_else(|error| panic!("output is not JSON: {error}; {}", text(output)))
}

fn text(output: &Output) -> String {
    let mut bytes = output.stdout.clone();
    bytes.extend_from_slice(&output.stderr);
    String::from_utf8_lossy(&bytes).into_owned()
}

fn binary() -> &'static str {
    env!("CARGO_BIN_EXE_bwrk")
}

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is after the Unix epoch")
            .as_nanos();
        let path =
            PathBuf::from("/tmp").join(format!("bw-{prefix}-{}-{nonce}", std::process::id()));
        fs::create_dir_all(&path).expect("temporary directory creates");
        Self { path }
    }

    fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}
