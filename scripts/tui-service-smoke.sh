#!/usr/bin/env bash

set -euo pipefail
export LC_ALL=C

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
PACKAGE_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd -P)
BIN="$PACKAGE_ROOT/target/debug/bwrk"
TUI_FIXTURE="$PACKAGE_ROOT/apps/tui/smoke/service-smoke.mjs"
TEMP_BASE=${TMPDIR:-/tmp}
SMOKE_DIR=$(mktemp -d "${TEMP_BASE%/}/boreal-v2-tui-service-smoke.XXXXXX")
DB="$SMOKE_DIR/work.sqlite"
SOCKET="$SMOKE_DIR/service.sock"
SERVICE_LOG="$SMOKE_DIR/service.log"

cleanup() {
  local status=$?
  trap - EXIT HUP INT TERM
  if [[ -n "${SERVICE_PID:-}" ]] && kill -0 "$SERVICE_PID" 2>/dev/null; then
    kill "$SERVICE_PID" 2>/dev/null || true
    wait "$SERVICE_PID" 2>/dev/null || true
  fi
  if ((status != 0)) && [[ -s "$SERVICE_LOG" ]]; then
    echo "tui service smoke: Rust service log follows" >&2
    tail -100 "$SERVICE_LOG" >&2 || true
  fi
  rm -rf -- "$SMOKE_DIR"
  exit "$status"
}
trap cleanup EXIT HUP INT TERM

wait_for_socket() {
  local attempts=0
  while [[ ! -S "$SOCKET" ]]; do
    attempts=$((attempts + 1))
    if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
      echo "tui service smoke: Rust service exited before publishing its socket" >&2
      return 1
    fi
    if ((attempts > 500)); then
      echo "tui service smoke: socket did not appear" >&2
      return 1
    fi
    sleep 0.01
  done
}

cargo build --manifest-path "$PACKAGE_ROOT/Cargo.toml" -p boreal-cli --locked --offline
npm --prefix "$PACKAGE_ROOT/apps/tui" test

"$BIN" service run \
  --db "$DB" \
  --socket "$SOCKET" \
  --max-requests 10 \
  --operation-id op_tui_service_smoke_host \
  --json >"$SERVICE_LOG" 2>&1 &
SERVICE_PID=$!
wait_for_socket

node "$TUI_FIXTURE" "$SOCKET"

wait "$SERVICE_PID"
unset SERVICE_PID
if [[ -e "$SOCKET" ]]; then
  echo "tui service smoke: bounded service left its socket behind" >&2
  exit 1
fi

echo "tui service smoke: cleanup PASS"
