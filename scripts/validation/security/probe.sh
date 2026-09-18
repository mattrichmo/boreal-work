#!/usr/bin/env bash
set -euo pipefail

# Early P5 boundary probe. The Rust harness is generated only in a fresh
# temporary directory and is removed on exit; no repository source is edited.

ONLINE=false
if [[ "${1:-}" == "--online" ]]; then
  ONLINE=true
elif [[ "${1:-}" != "" ]]; then
  echo "usage: $0 [--online]" >&2
  exit 2
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
V2_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../../.." && pwd)
FIXTURE_ROOT=$(mktemp -d "${TMPDIR:-/tmp}/boreal-v2-security.XXXXXX")
trap 'rm -rf "$FIXTURE_ROOT"' EXIT HUP INT TERM

mkdir -p "$FIXTURE_ROOT/probe/src"

cat > "$FIXTURE_ROOT/probe/Cargo.toml" <<EOF
[package]
name = "boreal-v2-security-probe"
version = "0.0.0"
edition = "2021"

[workspace]

[dependencies]
boreal-application = { package = "boreal-application", path = "$V2_ROOT/crates/application" }
boreal-domain = { package = "boreal-domain", path = "$V2_ROOT/crates/domain" }
boreal-memory = { package = "boreal-memory", path = "$V2_ROOT/crates/memory" }
boreal-service = { package = "boreal-service", path = "$V2_ROOT/crates/service" }
boreal-source = { package = "boreal-source", path = "$V2_ROOT/crates/source" }
EOF

cat > "$FIXTURE_ROOT/probe/src/main.rs" <<'EOF'
use boreal_application::{guide, GuidanceContext};
use boreal_domain::DerivedStatus;
use boreal_memory::{
    rebuild_index, Draft, MemoryRoot, Publisher, RetrievalQuery, Citation as MemoryCitation,
};
use boreal_service::{
    ApplicationCommandHandler, ApplicationRequest, ApplicationResponse, ApplicationRoute,
    ApplicationRouteConfig, JsonRequest, ProtocolErrorCode, TransportConfig,
    TransportError, UnixSocketServer, APPLICATION_API_VERSION, APPLICATION_SCHEMA_VERSION,
};
use boreal_source::{
    ParserLimits, RetrievalRequest, SourceCatalog, SourceError,
};
use std::{
    env, fs,
    io::Write,
    path::{Path, PathBuf},
    process::Command,
};

#[cfg(unix)]
use std::os::unix::net::UnixStream;
#[cfg(unix)]
use std::thread;

struct Tally {
    passed: usize,
    failed: usize,
}

impl Tally {
    fn check(&mut self, name: &str, passed: bool, detail: impl AsRef<str>) {
        if passed {
            self.passed += 1;
            println!("PASS {name}: {}", detail.as_ref());
        } else {
            self.failed += 1;
            println!("FAIL {name}: {}", detail.as_ref());
        }
    }

    fn skip(&self, name: &str, detail: impl AsRef<str>) {
        println!("SKIP {name}: {}", detail.as_ref());
    }
}

struct EchoHandler;

impl ApplicationCommandHandler for EchoHandler {
    fn handle(
        &mut self,
        request: ApplicationRequest,
    ) -> Result<ApplicationResponse, boreal_service::ProtocolError> {
        Ok(ApplicationResponse {
            api_version: APPLICATION_API_VERSION.to_owned(),
            schema_version: APPLICATION_SCHEMA_VERSION.to_owned(),
            operation_id: request.operation_id,
            data: r#"{"command":"probe"}"#.to_owned(),
        })
    }
}

fn main() {
    let root = PathBuf::from(env::var_os("BOREAL_SECURITY_FIXTURE").expect("fixture root"));
    let mut tally = Tally { passed: 0, failed: 0 };

    path_and_project_scope(&root, &mut tally);
    source_and_memory_scope(&root, &mut tally);
    bounded_requests_and_outputs(&mut tally);
    directive_boundary(&mut tally);
    protocol_boundary(&root, &mut tally);

    println!(
        "SUMMARY passed={} failed={} (socket privacy is caller-owned and reported separately)",
        tally.passed, tally.failed
    );
    if tally.failed != 0 {
        std::process::exit(1);
    }
}

fn path_and_project_scope(root: &Path, tally: &mut Tally) {
    let catalog = SourceCatalog::default();
    let path_project = catalog.capture("../escape", "note.txt", b"x", "text/plain");
    tally.check(
        "source-project-traversal",
        matches!(path_project, Err(SourceError::ScopeViolation)),
        "parent-component project identity is rejected",
    );
    let path_origin = catalog.capture("alpha", "../escape", b"x", "text/plain");
    tally.check(
        "source-origin-traversal",
        matches!(path_origin, Err(SourceError::ScopeViolation)),
        "parent-component origin is rejected",
    );

    let version = catalog
        .capture("alpha", "note.txt", b"alpha-only", "text/plain")
        .expect("valid source fixture");
    let mut forged = version.clone();
    forged.project_id = "beta".to_owned();
    tally.check(
        "source-forged-scope",
        matches!(catalog.verify(&forged), Err(SourceError::ScopeViolation)),
        "a version forged into another project cannot be verified",
    );

    let memory = root.join("memory");
    let memory_root = MemoryRoot::new(&memory).expect("memory root fixture");
    tally.check(
        "memory-entry-traversal",
        memory_root.entry_path("../escape").is_err(),
        "entry IDs cannot escape the managed notes directory",
    );
    tally.check(
        "memory-project-traversal",
        MemoryRoot::for_project(root.join(".." )).is_err(),
        "project roots containing parent components are rejected",
    );
}

fn source_and_memory_scope(root: &Path, tally: &mut Tally) {
    let catalog = SourceCatalog::default();
    let version = catalog
        .capture("alpha", "note.txt", b"alpha secret boundary", "text/plain")
        .expect("source fixture");
    let indexed = catalog
        .parse_and_index_with_limits(
            &version,
            "plain-text-lines/v1",
            ParserLimits {
                max_source_bytes: 1024,
                max_chunks: 10,
                max_chunk_bytes: 128,
            },
        )
        .expect("index fixture");
    tally.check(
        "source-retrieval-scope",
        catalog
            .retrieve(&RetrievalRequest::new("beta", "secret"))
            .map(|response| response.hits.is_empty() && response.project_id == "beta")
            .unwrap_or(false),
        "retrieval returns no alpha records for beta",
    );
    tally.check(
        "source-retrieval-output-bound",
        catalog
            .retrieve(&RetrievalRequest {
                project_id: "alpha".to_owned(),
                query: "secret".to_owned(),
                limit: 1,
                max_excerpt_bytes: 5,
            })
            .map(|response| {
                response.hits.len() == 1 && response.hits[0].excerpt.len() <= 5
            })
            .unwrap_or(false),
        format!("indexed revision {} respects a five-byte excerpt limit", indexed.index_revision),
    );

    let memory = root.join("published-memory");
    fs::create_dir_all(&memory).expect("memory fixture directory");
    git(&memory, &["init", "-q"]);
    let memory_root = MemoryRoot::new(&memory).expect("published memory root");
    let publisher = Publisher::new(memory_root).expect("publisher fixture");
    let draft = Draft::new(
        "alpha",
        "entry-one",
        "Alpha entry",
        "alpha-only memory text",
        vec![MemoryCitation {
            source_version_id: version.source_version_id.clone(),
            location: "line 1".to_owned(),
        }],
    )
    .expect("draft fixture")
    .review(true);
    publisher.publish(&draft, "op_security_memory").expect("publish fixture");
    let index = rebuild_index(&memory, "alpha").expect("memory index fixture");
    tally.check(
        "memory-retrieval-scope",
        RetrievalQuery::new("beta")
            .map(|query| index.search(&query).is_err())
            .unwrap_or(false),
        "an index for alpha rejects beta queries",
    );
    tally.check(
        "memory-retrieval-output-bound",
        RetrievalQuery::new("alpha")
            .ok()
            .and_then(|query| index.search(&query.with_limit(1).with_max_excerpt_bytes(6)).ok())
            .map(|response| response.hits.len() == 1 && response.hits[0].excerpt.len() <= 6)
            .unwrap_or(false),
        "memory excerpts remain within the requested six-byte bound",
    );
}

fn bounded_requests_and_outputs(tally: &mut Tally) {
    tally.check(
        "transport-zero-bound",
        TransportConfig::new(0).is_err(),
        "zero frame limits are rejected",
    );
    tally.check(
        "application-zero-bound",
        ApplicationRouteConfig::new(0).is_err(),
        "zero application payload limits are rejected",
    );
    let payload = format!(
        "{{\"api_version\":\"{APPLICATION_API_VERSION}\",\"schema_version\":\"{APPLICATION_SCHEMA_VERSION}\",\"operation_id\":\"op_bound\",\"data\":{{\"command\":\"probe\"}}}}"
    );
    let request = JsonRequest::new("bound-request", payload).expect("valid bound request");
    let mut route = ApplicationRoute::with_config(
        EchoHandler,
        ApplicationRouteConfig::new(16).expect("positive route bound"),
    );
    tally.check(
        "application-request-bound",
        route.dispatch(request).is_err(),
        "application payloads above the configured bound are rejected before dispatch",
    );
}

fn directive_boundary(tally: &mut Tally) {
    let statuses = [
        DerivedStatus::Queued,
        DerivedStatus::Blocked,
        DerivedStatus::Paused,
        DerivedStatus::ExpiredReview,
        DerivedStatus::Ready,
        DerivedStatus::Closed,
        DerivedStatus::Cancelled,
    ];
    let reasons = vec!["$(touch should-not-run); rm -rf should-not-run".to_owned()];
    let hostile_work_id = "work;echo hostile $(touch should-not-run)";
    let safe = statuses.iter().all(|status| {
        let directive = guide(GuidanceContext {
            work_id: hostile_work_id,
            status: *status,
            reason_codes: &reasons,
            has_goal: true,
        });
        !directive.safe_argv.is_empty()
            && directive.safe_argv.iter().all(|arg| {
                !arg.chars().any(|character| ";&|$()`\n\r".contains(character))
                    && *arg != "sh"
                    && *arg != "bash"
                    && *arg != "eval"
                    && !arg.contains("hostile")
            })
    });
    tally.check(
        "guidance-argv-only",
        safe,
        "hostile authored work/reason text never enters executable argv",
    );
}

fn protocol_boundary(root: &Path, tally: &mut Tally) {
    let mut route = ApplicationRoute::new(EchoHandler);
    let malformed_application = JsonRequest::new("malformed-app", "{}").expect("JSON object");
    let rejected = route.dispatch(malformed_application).unwrap_err();
    tally.check(
        "application-malformed-envelope",
        rejected.code() == ProtocolErrorCode::MissingField,
        format!("malformed application envelope maps to {}", rejected.code()),
    );

    #[cfg(unix)]
    unix_transport_checks(root, tally);
    #[cfg(not(unix))]
    tally.skip(
        "unix-transport",
        "Unix-domain sockets are unavailable on this platform",
    );
}

#[cfg(unix)]
fn unix_transport_checks(root: &Path, tally: &mut Tally) {
    let config = TransportConfig::new(256).expect("socket config");
    let malformed_path = root.join("malformed.sock");
    let server = match UnixSocketServer::bind(&malformed_path, config.clone()) {
        Ok(server) => server,
        Err(error)
            if error.to_string().contains("Permission denied")
                || error.to_string().contains("Operation not permitted") =>
        {
            tally.skip("unix-transport", "runner denied Unix socket creation");
            return;
        }
        Err(error) => {
            tally.check("unix-socket-bind", false, error.to_string());
            return;
        }
    };
    let join = thread::spawn(move || server.serve_once(|_| unreachable!("malformed request dispatched")));
    let mut stream = UnixStream::connect(&malformed_path).expect("malformed socket client");
    write_frame(&mut stream, b"{");
    let result = join.join().expect("malformed server thread");
    tally.check(
        "transport-malformed-frame",
        matches!(result, Err(TransportError::Protocol(error)) if error.code() == ProtocolErrorCode::InvalidJson),
        "malformed JSON is rejected before handler invocation",
    );

    let oversized_path = root.join("oversized.sock");
    let server = UnixSocketServer::bind(&oversized_path, TransportConfig::new(8).expect("small config"))
        .expect("oversized socket bind");
    let join = thread::spawn(move || server.serve_once(|_| unreachable!("oversized request dispatched")));
    let mut stream = UnixStream::connect(&oversized_path).expect("oversized socket client");
    write_frame(&mut stream, b"123456789");
    let result = join.join().expect("oversized server thread");
    tally.check(
        "transport-frame-bound",
        matches!(result, Err(TransportError::FrameTooLarge { size: 9, maximum: 8 })),
        "encoded frames above the configured transport bound are rejected",
    );

    let relative_name = format!("boreal-security-relative-{}.sock", std::process::id());
    match UnixSocketServer::bind(&relative_name, config) {
        Ok(server) => {
            drop(server);
            tally.check(
                "unix-socket-path-assumption",
                false,
                "transport accepts a relative socket path; caller must enforce a private absolute runtime directory",
            );
        }
        Err(error) => tally.check(
            "unix-socket-path-assumption",
            true,
            format!("relative socket path rejected: {error}"),
        ),
    }
}

#[cfg(unix)]
fn write_frame(stream: &mut UnixStream, body: &[u8]) {
    stream
        .write_all(&(body.len() as u32).to_be_bytes())
        .expect("frame length");
    stream.write_all(body).expect("frame body");
}

fn git(root: &Path, args: &[&str]) {
    let status = Command::new("git")
        .args(args)
        .current_dir(root)
        .status()
        .expect("git command");
    assert!(status.success(), "git command failed: {args:?}");
}
EOF

printf '%s\n' 'Security probe: workflow asset shell checks'
python3 - "$V2_ROOT/project/spec/workflows" <<'PY'
import json
import pathlib
import sys

root = pathlib.Path(sys.argv[1])
bad = []
shell_chars = set(";&|$()`\n\r")

def visit(value, path=""):
    if isinstance(value, dict):
        if value.get("shell") is True:
            bad.append(f"{path}: shell=true")
        for key, child in value.items():
            visit(child, f"{path}.{key}" if path else key)
    elif isinstance(value, list):
        for index, child in enumerate(value):
            visit(child, f"{path}[{index}]")

manifest = json.loads((root / "manifest.json").read_text())
policy = manifest.get("asset_policy", {})
if policy.get("allowed_commands_only") is not True:
    bad.append("manifest.asset_policy.allowed_commands_only is not true")
if policy.get("free_form_commands_are_data") is not True:
    bad.append("manifest.asset_policy.free_form_commands_are_data is not true")

for path in sorted(root.glob("*.json")):
    value = json.loads(path.read_text())
    visit(value, path.name)
    for command in value.get("allowed_commands", []):
        if not isinstance(command, str) or not command.startswith("bwrk "):
            bad.append(f"{path.name}: non-bwrk command {command!r}")
        if any(character in command for character in shell_chars):
            bad.append(f"{path.name}: shell metacharacter in {command!r}")
        if "sh -c" in command or "bash -c" in command or "eval " in command:
            bad.append(f"{path.name}: shell wrapper in {command!r}")

if bad:
    for item in bad:
        print(f"FAIL workflow-shell-boundary: {item}")
    raise SystemExit(1)
print("PASS workflow-shell-boundary: allowlisted bwrk command data contains no executable shell form")
PY

printf '%s\n' 'Security probe: compiled boundary checks'
if [[ "$ONLINE" == true ]]; then
  (cd "$FIXTURE_ROOT" && BOREAL_SECURITY_FIXTURE="$FIXTURE_ROOT" cargo run --quiet --manifest-path "$FIXTURE_ROOT/probe/Cargo.toml")
else
  (cd "$FIXTURE_ROOT" && BOREAL_SECURITY_FIXTURE="$FIXTURE_ROOT" cargo run --quiet --manifest-path "$FIXTURE_ROOT/probe/Cargo.toml" --offline)
fi

printf '%s\n' 'Security probe: production V12 envelope and committed-sidecar checks'
python3 "$SCRIPT_DIR/v12_envelope.py"
