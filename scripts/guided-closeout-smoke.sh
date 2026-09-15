#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BIN="$ROOT/target/debug/boreal-cli"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/boreal-guided-closeout.XXXXXX")
DB="$TMP/boreal.sqlite"
SOCKET="$TMP/boreal.sock"
LOG="$TMP/service.log"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/gates"
cp "$ROOT/project/spec/gates/checkpoint.json" "$ROOT/project/spec/gates/verification.json" "$ROOT/project/spec/gates/summary.json" "$TMP/gates/"

cargo build -p boreal-cli --locked --offline >/dev/null

direct() {
  "$BIN" "$@" --db "$DB" --json
}

service() {
  "$BIN" "$@" --db "$DB" --socket "$SOCKET" --json
}

direct init guided-project >/dev/null
for work in guided-work-a guided-work-b guided-work-c; do
  direct work create guided-project "$work" "Guided closeout $work" >/dev/null
done
sqlite3 "$DB" "INSERT INTO source_version (source_version_id, project_id, origin, access_scope, content_digest, media_type, byte_count, captured_at, parser_identity, availability, citation_json) VALUES ('sha256:source-fixture-v1', 'guided-project', 'guided-fixture', 'project', 'sha256:source-fixture-v1', 'text/plain', 0, 'unix-ms:1', 'fixture/1', 'available', '[]');"

"$BIN" service run --db "$DB" --socket "$SOCKET" --max-requests 18 --json >"$LOG" 2>&1 &
SERVICE_PID=$!
for _ in $(seq 1 100); do
  [[ -S "$SOCKET" ]] && break
  kill -0 "$SERVICE_PID" 2>/dev/null || { cat "$LOG" >&2; exit 1; }
  sleep 0.01
done
[[ -S "$SOCKET" ]] || { cat "$LOG" >&2; exit 1; }

works=(guided-work-a guided-work-b guided-work-c)
sessions=(guided-session-a guided-session-b guided-session-c)
attempts=()
fences=()
receipts=()

for i in "${!works[@]}"; do
  work="${works[$i]}"
  session="${sessions[$i]}"
  claim=$(service work claim guided-project "$work" --session "$session")
  attempts[$i]=$(jq -er '.data.attempt_id' <<<"$claim")
  fences[$i]=$(jq -er '.data.fence' <<<"$claim")
  service agent start "$work" --project guided-project --session "$session" >/dev/null

  verification=""
  for gate in checkpoint verification summary; do
    result=$(service evidence run --project guided-project --work "$work" --gate "$gate" --attempt "${attempts[$i]}" --fence "${fences[$i]}" --session "$session")
    echo "$result"
    jq -e '.data.result == "passed" and .data.execution_outcome == "passed"' <<<"$result" >/dev/null
    [[ "$gate" == "verification" ]] && verification="$result"
  done
  receipts[$i]=$(jq -er '.data.receipt_path' <<<"$verification")
done

for i in "${!works[@]}"; do
  work="${works[$i]}"
  session="${sessions[$i]}"
  if finish=$(service agent finish "$work" --close --project guided-project --session "$session" --attempt "${attempts[$i]}" --fence "${fences[$i]}" --receipt "${receipts[$i]}"); then
    echo "$finish"
  else
    echo "$finish" >&2
    exit 1
  fi
done
wait "$SERVICE_PID"

"$BIN" service run --db "$DB" --socket "$SOCKET" --max-requests 1 --json >"$LOG" 2>&1 &
SERVICE_PID=$!
for _ in $(seq 1 100); do
  [[ -S "$SOCKET" ]] && break
  kill -0 "$SERVICE_PID" 2>/dev/null || { cat "$LOG" >&2; exit 1; }
  sleep 0.01
done
[[ -S "$SOCKET" ]] || { cat "$LOG" >&2; exit 1; }
status=$(service status guided-project)
jq -e '.data.items | length == 3 and all(.[]; .display_status == "closed")' <<<"$status" >/dev/null
wait "$SERVICE_PID"

echo "guided closeout smoke: PASS (three service-routed harnesses, declared gates, close, restart, and status readback)"
