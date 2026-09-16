#!/usr/bin/env bash

set -euo pipefail
export LC_ALL=C

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
BIN="$PACKAGE_ROOT/target/debug/bwrk"
TEMP_BASE=${TMPDIR:-/tmp}
SMOKE_DIR=$(mktemp -d "${TEMP_BASE%/}/boreal-v2-service-smoke.XXXXXX")
DB="$SMOKE_DIR/work.sqlite"
SOCKET="$SMOKE_DIR/service.sock"

cleanup() {
  if [[ -n "${SERVICE_PID:-}" ]] && kill -0 "$SERVICE_PID" 2>/dev/null; then
    kill "$SERVICE_PID" 2>/dev/null || true
    wait "$SERVICE_PID" 2>/dev/null || true
  fi
  rm -rf -- "$SMOKE_DIR"
}
trap cleanup EXIT HUP INT TERM

wait_for_socket() {
  local attempts=0
  while [[ ! -S "$SOCKET" ]]; do
    attempts=$((attempts + 1))
    if ((attempts > 500)); then
      echo "service smoke: socket did not appear" >&2
      return 1
    fi
    sleep 0.01
  done
}

wait_for_exit() {
  wait "$SERVICE_PID"
  unset SERVICE_PID
  if [[ -e "$SOCKET" ]]; then
    echo "service smoke: bounded host left its socket behind" >&2
    return 1
  fi
}

if [[ ! -x "$BIN" ]]; then
  cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline
fi

"$BIN" init smoke-three --db "$DB" --operation-id op_smoke_init --json >"$SMOKE_DIR/init.json"
for task in task-a task-b task-c; do
  "$BIN" work create smoke-three "$task" "Smoke $task" --db "$DB" --operation-id "op_smoke_create_$task" --json >"$SMOKE_DIR/create-$task.json"
done

"$BIN" service run --db "$DB" --socket "$SOCKET" --max-requests 4 --operation-id op_smoke_service_one --json >"$SMOKE_DIR/service-one.json" 2>&1 &
SERVICE_PID=$!
wait_for_socket
"$BIN" status smoke-three --db "$DB" --socket "$SOCKET" --operation-id op_smoke_status_before --actor agent-1 --harness reader --session reader-session --json >"$SMOKE_DIR/status-before.json"
for pair in "task-a harness-a session-a" "task-b harness-b session-b" "task-c harness-c session-c"; do
  read -r task harness session <<<"$pair"
  "$BIN" work claim smoke-three "$task" --db "$DB" --socket "$SOCKET" --actor agent-1 --harness "$harness" --session "$session" --operation-id "op_smoke_claim_${task}" --json >"$SMOKE_DIR/claim-$task.json"
done
wait_for_exit

"$BIN" service run --db "$DB" --socket "$SOCKET" --max-requests 4 --operation-id op_smoke_service_two --json >"$SMOKE_DIR/service-two.json" 2>&1 &
SERVICE_PID=$!
wait_for_socket
for pair in "task-a harness-a session-a" "task-b harness-b session-b" "task-c harness-c session-c"; do
  read -r task harness session <<<"$pair"
  attempt=$(jq -er '.data.attempt_id' "$SMOKE_DIR/claim-$task.json")
  fence=$(jq -er '.data.fence' "$SMOKE_DIR/claim-$task.json")
  if [[ "$task" == task-c ]]; then
    "$BIN" agent finish "$task" --release --project smoke-three --db "$DB" --socket "$SOCKET" --actor agent-1 --harness "$harness" --session "$session" --attempt "$attempt" --fence "$fence" --operation-id "op_smoke_release_${task}" --json >"$SMOKE_DIR/release-$task.json"
  else
    "$BIN" agent release "$task" --project smoke-three --db "$DB" --socket "$SOCKET" --actor agent-1 --harness "$harness" --session "$session" --attempt "$attempt" --fence "$fence" --operation-id "op_smoke_release_${task}" --json >"$SMOKE_DIR/release-$task.json"
  fi
done
"$BIN" status smoke-three --db "$DB" --socket "$SOCKET" --operation-id op_smoke_status_after --actor agent-1 --harness reader --session reader-session --json >"$SMOKE_DIR/status-after.json"
wait_for_exit

rg -q '"served_requests":4' "$SMOKE_DIR/service-one.json"
rg -q '"served_requests":4' "$SMOKE_DIR/service-two.json"
rg -q '"outcome":"changed"' "$SMOKE_DIR/claim-task-a.json"
rg -q '"outcome":"changed"' "$SMOKE_DIR/release-task-a.json"
rg -q '"ready":3' "$SMOKE_DIR/status-after.json"
echo "service smoke: PASS (three session-bound claims, restart, fenced releases, bounded status reads)"
