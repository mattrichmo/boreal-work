#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
BIN="$ROOT/target/debug/bwrk"
TMP=$(mktemp -d "${TMPDIR:-/tmp}/boreal-guided-closeout.XXXXXX")
DB="$TMP/guided-project/boreal.sqlite"
SOCKET="$TMP/guided-project/boreal.sock"
LOG="$TMP/service.log"
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/guided-project/gates"
cp "$ROOT/project/spec/gates/checkpoint.json" "$ROOT/project/spec/gates/verification.json" "$ROOT/project/spec/gates/summary.json" "$TMP/guided-project/gates/"

cargo build -p boreal-cli --locked --offline >/dev/null

cd "$TMP"

direct() {
  "$BIN" "$@" --db "$DB" --json
}

service() {
  "$BIN" "$@" --db "$DB" --socket "$SOCKET" --json
}

works=(guided-work-a guided-work-b guided-work-c)
agents=(guided-agent-a guided-agent-b guided-agent-c)
sessions=(guided-session-a guided-session-b guided-session-c)
initialized=$(direct init guided-project)
revision=$(jq -er '.revision' <<<"$initialized")
cd "$TMP/guided-project"
operator_session=guided-operator-session
registered=$(direct session start --project guided-project --actor operator --harness guided-closeout --session "$operator_session" --expected-revision "$revision")
revision=$(jq -er '.revision' <<<"$registered")
for i in "${!works[@]}"; do
  work="${works[$i]}"
  created=$(direct work create guided-project "$work" "Guided closeout $work" --actor operator --session "$operator_session" --expected-revision "$revision")
  revision=$(jq -er '.revision' <<<"$created")
done
source_input="$TMP/guided-project/guided-source.txt"
printf 'Guided closeout source fixture.\n' >"$source_input"
source_result=$(direct source add guided-project --input "$source_input" --origin guided-fixture --actor operator --harness guided-closeout --session "$operator_session" --expected-revision "$revision")
source_version=$(jq -er '.data.source.source_version_id' <<<"$source_result")
revision=$(jq -er '.revision' <<<"$source_result")

for i in "${!agents[@]}"; do
  agent="${agents[$i]}"
  session="${sessions[$i]}"
  key=$(direct auth key --actor "$agent" --actor-role agent)
  enrollment=$(jq -er '.data.enrollment_path' <<<"$key")
  granted=$(direct auth grant --actor operator --input "$enrollment" --expected-revision "$revision" --reason "Authorize isolated guided-closeout fixture Agent $agent" --yes)
  revision=$(jq -er '.revision' <<<"$granted")
  started=$(direct session start --project guided-project --actor "$agent" --harness guided-closeout --session "$session" --expected-revision "$revision")
  revision=$(jq -er '.revision' <<<"$started")
done

"$BIN" service run --db "$DB" --socket "$SOCKET" --max-requests 18 --json >"$LOG" 2>&1 &
SERVICE_PID=$!
for _ in $(seq 1 100); do
  [[ -S "$SOCKET" ]] && break
  kill -0 "$SERVICE_PID" 2>/dev/null || { cat "$LOG" >&2; exit 1; }
  sleep 0.01
done
[[ -S "$SOCKET" ]] || { cat "$LOG" >&2; exit 1; }

attempts=()
fences=()
receipts=()
summaries=()

for i in "${!works[@]}"; do
  work="${works[$i]}"
  agent="${agents[$i]}"
  session="${sessions[$i]}"
  claim=$(service work claim guided-project "$work" --actor "$agent" --harness guided-closeout --session "$session" \
    --source-version "$source_version" \
    --config-identity sha256:config-fixture-v1)
  attempts[$i]=$(jq -er '.data.attempt_id' <<<"$claim")
  fences[$i]=$(jq -er '.data.fence' <<<"$claim")
  service agent start "$work" --project guided-project --actor "$agent" --harness guided-closeout --session "$session" \
    --source-version "$source_version" --config-identity sha256:config-fixture-v1 >/dev/null

  verification=""
  for gate in checkpoint verification summary; do
    result=$(service evidence run --project guided-project --actor "$agent" --harness guided-closeout --session "$session" --work "$work" --gate "$gate" --attempt "${attempts[$i]}" --fence "${fences[$i]}")
    echo "$result"
    jq -e '.data.result == "passed" and .data.execution_outcome == "passed"' <<<"$result" >/dev/null
    [[ "$gate" == "verification" ]] && verification="$result"
  done
  receipts[$i]=$(jq -er '.data.receipt_path' <<<"$verification")
  summaries[$i]="$TMP/$work-summary.md"
  printf 'Completed %s with current checkpoint and verification evidence.\n' "$work" >"${summaries[$i]}"
done

for i in "${!works[@]}"; do
  work="${works[$i]}"
  agent="${agents[$i]}"
  session="${sessions[$i]}"
  if finish=$(service agent finish "$work" --close --project guided-project --actor "$agent" --harness guided-closeout --session "$session" --attempt "${attempts[$i]}" --fence "${fences[$i]}" --receipt "${receipts[$i]}" --summary "${summaries[$i]}"); then
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
status=$(service status guided-project --actor operator --harness guided-closeout --session "$operator_session")
jq -e '.data.items | length == 3 and all(.[]; .display_status == "closed")' <<<"$status" >/dev/null
wait "$SERVICE_PID"

echo "guided closeout smoke: PASS (three service-routed harnesses, declared gates, close, restart, and status readback)"
