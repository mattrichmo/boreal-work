#!/usr/bin/env bash

set -euo pipefail
export LC_ALL=C

SCRIPT_DIR=$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)
PACKAGE_ROOT=$(CDPATH='' cd -- "$SCRIPT_DIR/.." && pwd -P)
BIN="$PACKAGE_ROOT/target/debug/bwrk"
TEMP_BASE=${TMPDIR:-/tmp}
SMOKE_DIR=$(mktemp -d "${TEMP_BASE%/}/boreal-v2-dashboard-smoke.XXXXXX")
PROJECT_ROOT="$SMOKE_DIR/project"
STATE_ROOT="$PROJECT_ROOT/.boreal"
RUNTIME_ROOT=$(mktemp -d "/tmp/boreal-v2-dashboard-runtime.XXXXXX")
DB="$STATE_ROOT/boreal.sqlite"
JSON_OUTPUT="$SMOKE_DIR/dashboard.json"
TRANSCRIPT="$SMOKE_DIR/dashboard.pty"
SOCKET_LOG="$SMOKE_DIR/private-socket.log"
PID_LOG="$SMOKE_DIR/dashboard-pid.log"
TUI_PID_LOG="$SMOKE_DIR/tui-pid.log"
INVOCATION_LOG="$SMOKE_DIR/tui-argv.log"
TUI_FIXTURE="$SMOKE_DIR/dashboard-tui.js"
BUILD_LOG="$SMOKE_DIR/build.log"

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if ((status != 0)); then
    echo "dashboard smoke: retained diagnostics follow" >&2
    for diagnostic in "$BUILD_LOG" "$JSON_OUTPUT" "$TRANSCRIPT"; do
      if [[ -s "$diagnostic" ]]; then
        echo "--- ${diagnostic#"$SMOKE_DIR"/} ---" >&2
        tail -100 "$diagnostic" >&2 || true
      fi
    done
  fi
  case "$SMOKE_DIR" in
    "${TEMP_BASE%/}"/boreal-v2-dashboard-smoke.*) rm -rf -- "$SMOKE_DIR" ;;
    *) echo "dashboard smoke: refusing to remove unexpected path $SMOKE_DIR" >&2 ;;
  esac
  case "$RUNTIME_ROOT" in
    /tmp/boreal-v2-dashboard-runtime.*) rm -rf -- "$RUNTIME_ROOT" ;;
    *) echo "dashboard smoke: refusing to remove unexpected path $RUNTIME_ROOT" >&2 ;;
  esac
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$STATE_ROOT"

if [[ "${BOREAL_DASHBOARD_SMOKE_SKIP_CLI_BUILD:-0}" != "1" ]]; then
  if ! cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline \
    >"$BUILD_LOG" 2>&1; then
    echo "dashboard smoke: CLI build failed" >&2
    exit 1
  fi
else
  printf '%s\n' "dashboard smoke: reusing existing CLI binary by request" >"$BUILD_LOG"
fi
if [[ ! -x "$BIN" ]]; then
  echo "dashboard smoke: expected CLI binary is missing: $BIN" >&2
  exit 1
fi

"$BIN" init dashboard-smoke \
  --db "$DB" \
  --operation-id op_dashboard_smoke_init \
  --json >"$SMOKE_DIR/init.json"
"$BIN" work create dashboard-smoke dashboard-task "Dashboard smoke task" \
  --db "$DB" \
  --operation-id op_dashboard_smoke_create \
  --json >"$SMOKE_DIR/create.json"

python3 - "$TUI_FIXTURE" <<'PY'
from pathlib import Path
import sys

Path(sys.argv[1]).write_text(r'''const fs = require("node:fs");
const net = require("node:net");

const args = process.argv.slice(2);
const valueAfter = (flag) => args[args.indexOf(flag) + 1];
const socketPath = valueAfter("--socket");
const project = valueAfter("--project");
fs.writeFileSync(process.env.BOREAL_DASHBOARD_INVOCATION_LOG, `${args.join("\n")}\n`);
fs.writeFileSync(process.env.BOREAL_DASHBOARD_TUI_PID_LOG, `${process.pid}\n`);
if (!process.stdin.isTTY || !process.stdout.isTTY) process.exit(96);
if (!socketPath || !fs.statSync(socketPath).isSocket()) process.exit(97);

const operationId = "op_dashboard_smoke_fixture_status";
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
  process.stdout.write("dashboard-smoke-fixture\n");
  client.end();
  process.exit(0);
});
client.on("error", (error) => {
  console.error(error);
  process.exit(99);
});
''', encoding="utf-8")
PY

# JSON mode is a direct, noninteractive status read. A deliberately missing TUI
# override proves this branch does not start the private service or TUI.
(
  cd "$PROJECT_ROOT"
  TMPDIR="$RUNTIME_ROOT" \
  BOREAL_TUI_ENTRYPOINT="$SMOKE_DIR/does-not-exist.js" \
    "$BIN" dashboard \
      --db "$DB" \
      --operation-id op_dashboard_smoke_json \
      --json >"$JSON_OUTPUT"
)

python3 - "$JSON_OUTPUT" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    envelope = json.load(handle)

assert envelope["transport"] == "ok", envelope
assert envelope["outcome"] in {"changed", "unchanged", "empty"}, envelope
data = envelope.get("data")
assert isinstance(data, dict), envelope
items = data.get("items")
assert isinstance(items, list), data
assert any(item.get("work_id") == "dashboard-task" for item in items), items
PY

if find "$RUNTIME_ROOT" -name 'boreal-dashboard-*.sock' -print -quit | grep -q .; then
  echo "dashboard smoke: --json unexpectedly created a private socket" >&2
  exit 1
fi

# Run a service-probing TUI fixture under a pseudo-terminal. It verifies the
# launcher's interactive arguments and real private service transport, then
# exits immediately. A hard deadline prevents a launcher regression from
# hanging CI.
python3 - \
  "$BIN" \
  "$DB" \
  "$TUI_FIXTURE" \
  "$PROJECT_ROOT" \
  "$RUNTIME_ROOT" \
  "$TRANSCRIPT" \
  "$PID_LOG" \
  "$SOCKET_LOG" \
  "$TUI_PID_LOG" \
  "$INVOCATION_LOG" <<'PY'
import errno
import os
import pty
import select
import signal
import sys
import time

binary, database, tui, project_root, runtime_root, transcript_path, pid_log, socket_log, tui_pid_log, invocation_log = sys.argv[1:]
argv = [
    binary,
    "dashboard",
    "--db", database,
    "--actor", "dashboard-smoke-actor",
    "--harness", "dashboard-smoke-harness",
    "--session", "dashboard-smoke-session",
    "--operation-id", "op_dashboard_smoke_interactive",
]
environment = os.environ.copy()
environment["TMPDIR"] = runtime_root
environment["BOREAL_TUI_ENTRYPOINT"] = tui
environment["BOREAL_DASHBOARD_SOCKET_LOG"] = socket_log
environment["BOREAL_DASHBOARD_TUI_PID_LOG"] = tui_pid_log
environment["BOREAL_DASHBOARD_INVOCATION_LOG"] = invocation_log

pid, master = pty.fork()
if pid == 0:
    os.chdir(project_root)
    os.execve(binary, argv, environment)

with open(pid_log, "w", encoding="utf-8") as handle:
    handle.write(f"{pid}\n")

captured = bytearray()
status = None
deadline = time.monotonic() + 15.0

def read_available(timeout):
    ready, _, _ = select.select([master], [], [], timeout)
    if not ready:
        return
    try:
        chunk = os.read(master, 65536)
    except OSError as error:
        if error.errno == errno.EIO:
            return
        raise
    if chunk:
        captured.extend(chunk)

while time.monotonic() < deadline:
    read_available(0.05)
    waited, raw_status = os.waitpid(pid, os.WNOHANG)
    if waited == pid:
        status = raw_status
        break

if status is None:
    os.kill(pid, signal.SIGTERM)
    grace = time.monotonic() + 4.0
    while time.monotonic() < grace:
        read_available(0.05)
        waited, raw_status = os.waitpid(pid, os.WNOHANG)
        if waited == pid:
            status = raw_status
            break
    if status is None:
        os.kill(pid, signal.SIGKILL)
        _, status = os.waitpid(pid, 0)
    with open(transcript_path, "wb") as handle:
        handle.write(captured)
    raise SystemExit("dashboard PTY launch exceeded its 15-second deadline")

for _ in range(10):
    read_available(0.01)
os.close(master)
with open(transcript_path, "wb") as handle:
    handle.write(captured)

exit_code = os.waitstatus_to_exitcode(status)
if exit_code != 0:
    raise SystemExit(f"dashboard PTY launch exited with {exit_code}")
if b"dashboard-smoke-fixture" not in captured:
    raise SystemExit("dashboard PTY fixture did not complete its service request")
PY

PRIVATE_SOCKET=$(tr -d '\r\n' <"$SOCKET_LOG")
DASHBOARD_PID=$(tr -d '\r\n' <"$PID_LOG")
TUI_PID=$(tr -d '\r\n' <"$TUI_PID_LOG")
if [[ -z "$PRIVATE_SOCKET" || "$PRIVATE_SOCKET" != "$RUNTIME_ROOT"/* ]]; then
  echo "dashboard smoke: invalid private socket record: $PRIVATE_SOCKET" >&2
  exit 1
fi
if [[ -e "$PRIVATE_SOCKET" ]]; then
  echo "dashboard smoke: launcher left its private socket behind: $PRIVATE_SOCKET" >&2
  exit 1
fi
if kill -0 "$DASHBOARD_PID" 2>/dev/null; then
  echo "dashboard smoke: launcher process $DASHBOARD_PID is still alive" >&2
  exit 1
fi
if kill -0 "$TUI_PID" 2>/dev/null; then
  echo "dashboard smoke: TUI child process $TUI_PID is still alive" >&2
  exit 1
fi

python3 - "$INVOCATION_LOG" <<'PY'
import sys

with open(sys.argv[1], encoding="utf-8") as handle:
    arguments = handle.read().splitlines()

def value_after(flag):
    index = arguments.index(flag)
    return arguments[index + 1]

assert "--interactive" in arguments, arguments
assert value_after("--project") == "dashboard-smoke", arguments
assert value_after("--actor") == "dashboard-smoke-actor", arguments
assert value_after("--harness") == "dashboard-smoke-harness", arguments
assert value_after("--session") == "dashboard-smoke-session", arguments
PY

LEFTOVER_SOCKET=$(find "$RUNTIME_ROOT" -name 'boreal-dashboard-*.sock' -print -quit)
if [[ -n "$LEFTOVER_SOCKET" ]]; then
  echo "dashboard smoke: private endpoint was not cleaned up: $LEFTOVER_SOCKET" >&2
  exit 1
fi

PROCESS_LIST=$(ps -ax -o command=)
if [[ "$PROCESS_LIST" == *"$PRIVATE_SOCKET"* ]]; then
  echo "dashboard smoke: a child process still references $PRIVATE_SOCKET" >&2
  exit 1
fi

echo "dashboard smoke: PASS (--json discovery, PTY launcher/service probe, and private child/socket cleanup)"
