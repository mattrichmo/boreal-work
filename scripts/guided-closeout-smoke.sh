#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TARGET_DIR=${CARGO_TARGET_DIR:-"$ROOT/target"}
BIN=${BWRK_BIN:-"$TARGET_DIR/debug/bwrk"}
TMP=$(mktemp -d "${TMPDIR:-/tmp}/boreal-guided-closeout.XXXXXX")
PROJECT=guided-project
OPERATOR=guided-operator
HARNESS=guided-closeout
OPERATOR_SESSION=guided-operator-session
CONFIG_ID=guided-closeout-config-v1
PROJECT_ROOT="$TMP/$PROJECT"
DB="$PROJECT_ROOT/.boreal/boreal.sqlite"
SOCKET="$PROJECT_ROOT/.boreal/runtime/guided-closeout.sock"
GATES="$PROJECT_ROOT/.boreal/gates"
VERIFIERS="$PROJECT_ROOT/verifiers"
LOG="$TMP/service.log"
SERVICE_PID=

cleanup() {
  local status=$?
  trap - EXIT
  if [[ -n "$SERVICE_PID" ]]; then
    if kill -0 "$SERVICE_PID" 2>/dev/null; then
      kill "$SERVICE_PID" 2>/dev/null || true
    fi
    wait "$SERVICE_PID" 2>/dev/null || true
  fi
  rm -rf "$TMP"
  exit "$status"
}
trap cleanup EXIT

mkdir -p "$PROJECT_ROOT"
cd "$ROOT"
cargo build -p boreal-cli --locked --offline >/dev/null

cd "$PROJECT_ROOT"
direct() {
  "$BIN" "$@" --db "$DB" --json
}

service() {
  "$BIN" "$@" --db "$DB" --socket "$SOCKET" --json
}

require_direct() {
  local action=$1
  shift
  local result
  if result=$(direct "$@"); then
    printf '%s\n' "$result"
  else
    local status=$?
    printf 'guided closeout smoke: %s failed (exit %s)\n%s\n' "$action" "$status" "$result" >&2
    return "$status"
  fi
}

works=(guided-work-a guided-work-b guided-work-c)
agents=(guided-agent-a guided-agent-b guided-agent-c)
sessions=(guided-session-a guided-session-b guided-session-c)
gates=(checkpoint verification summary)
declare -A policy_versions=()

initialized=$(require_direct 'project initialization' init --project "$PROJECT" --actor "$OPERATOR" --yes)
revision=$(jq -er '.revision' <<<"$initialized")
mkdir -p "$GATES" "$VERIFIERS"

registered=$(require_direct 'Operator session registration' session start \
  --project "$PROJECT" --actor "$OPERATOR" --harness "$HARNESS" \
  --session "$OPERATOR_SESSION" --expected-revision "$revision" \
  --operation-id guided-closeout-operator-session)
revision=$(jq -er '.revision' <<<"$registered")
jq -e --arg actor "$OPERATOR" --arg session "$OPERATOR_SESSION" \
  '.data.actor_id == $actor and .data.session_id == $session and .data.state == "active"' \
  <<<"$registered" >/dev/null

for i in "${!works[@]}"; do
  work=${works[$i]}
  created=$(require_direct "Operator work creation ($work)" work create "$PROJECT" "$work" \
    "Guided closeout $work" --kind task --actor "$OPERATOR" --harness "$HARNESS" \
    --session "$OPERATOR_SESSION" --expected-revision "$revision" \
    --operation-id "guided-closeout-create-$work")
  revision=$(jq -er '.revision' <<<"$created")
  jq -e --arg work "$work" '.data.work_id == $work' <<<"$created" >/dev/null
done

for i in "${!agents[@]}"; do
  agent=${agents[$i]}
  session=${sessions[$i]}

  key=$(require_direct "Agent key creation ($agent)" auth key --actor "$agent" --actor-role agent)
  enrollment=$(jq -er '.data.enrollment_path' <<<"$key")
  granted=$(require_direct "Operator Agent enrollment ($agent)" auth grant \
    --actor "$OPERATOR" --input "$enrollment" --expected-revision "$revision" \
    --reason "Authorize isolated guided-closeout fixture Agent $agent" --yes \
    --operation-id "guided-closeout-grant-$agent")
  revision=$(jq -er '.revision' <<<"$granted")
  jq -e '.data.command == "auth.grant"' <<<"$granted" >/dev/null
  authority=$(require_direct "enrolled Agent authority readback ($agent)" auth show --actor "$agent")
  jq -e --arg agent "$agent" '.data.actor_id == $agent and .data.role == "agent"' \
    <<<"$authority" >/dev/null

  started=$(require_direct "Agent session registration ($agent)" session start \
    --project "$PROJECT" --actor "$agent" --harness "$HARNESS" --session "$session" \
    --expected-revision "$revision" --operation-id "guided-closeout-session-$agent")
  revision=$(jq -er '.revision' <<<"$started")
  jq -e --arg agent "$agent" --arg session "$session" \
    '.data.actor_id == $agent and .data.session_id == $session and .data.state == "active"' \
    <<<"$started" >/dev/null
done

for gate in "${gates[@]}"; do
  verifier="$VERIFIERS/$gate.sh"
  printf '#!/bin/sh\nprintf "%%s\\n" "%s"\n' "$gate" >"$verifier"
  chmod 755 "$verifier"
done

# Directory input is required here: it records the verifier executables and
# their executable modes in the immutable workspace snapshot used by gates.
source_result=$(require_direct 'Operator workspace snapshot capture' source add "$PROJECT" \
  --input . --origin guided-closeout/workspace --actor "$OPERATOR" --harness "$HARNESS" \
  --session "$OPERATOR_SESSION" --expected-revision "$revision" \
  --operation-id guided-closeout-workspace-source)
source_version=$(jq -er '.data.source.source_version_id' <<<"$source_result")
revision=$(jq -er '.revision' <<<"$source_result")
jq -e --arg id "$source_version" \
  '.data.source.source_version_id == $id and .data.source.media_type == "application/vnd.boreal.workspace-snapshot.v1"' \
  <<<"$source_result" >/dev/null

source_readback=$(require_direct 'workspace snapshot readback' source show "$PROJECT" "$source_version")
jq -e --arg id "$source_version" \
  '.data.source.source_version_id == $id and .data.sqlite_registration.source_version_id == $id and .data.source.availability == "available"' \
  <<<"$source_readback" >/dev/null

# Build declarations only after capture, so their snapshot ID and verifier
# digests are tied to the bytes that the evidence executor will unpack.
for gate in "${gates[@]}"; do
  verifier="./verifiers/$gate.sh"
  verifier_digest="sha256:$(sha256sum "$PROJECT_ROOT/${verifier#./}" | awk '{print $1}')"
  jq -n \
    --arg gate "$gate" \
    --arg verifier "$verifier" \
    --arg digest "$verifier_digest" \
    --arg source "$source_version" \
    --arg config "$CONFIG_ID" \
    '{
      gate_id: $gate,
      policy_revision: 1,
      kind: $gate,
      executable: $verifier,
      verifier_digest: $digest,
      argv: [$verifier],
      cwd: ".",
      source_snapshot_hash: $source,
      config_identity: $config,
      environment_fingerprint: "guided-closeout-env-v1",
      environment_allowlist: [],
      observables: [$gate],
      max_runtime_ms: 30000
    }' >"$GATES/$gate.json"
done

for gate in "${gates[@]}"; do
  policy="$GATES/$gate.json"
  jq -e --arg gate "$gate" --arg source "$source_version" --arg config "$CONFIG_ID" \
    '.gate_id == $gate and .policy_revision == 1 and .source_snapshot_hash == $source and .config_identity == $config and (.verifier_digest | test("^sha256:[0-9a-f]{64}$"))' \
    "$policy" >/dev/null
  expected_verifier_digest="sha256:$(sha256sum "$PROJECT_ROOT/$(jq -er '.executable | sub("^\\./"; "")' "$policy")" | awk '{print $1}')"
  jq -e --arg digest "$expected_verifier_digest" '.verifier_digest == $digest' "$policy" >/dev/null

  published=$(require_direct "gate policy publication ($gate)" gate policy publish \
    --project "$PROJECT" --gate "$gate" --input ".boreal/gates/$gate.json" \
    --expected-revision "$revision" --yes --actor "$OPERATOR" --harness "$HARNESS" \
    --session "$OPERATOR_SESSION" --operation-id "guided-closeout-policy-$gate")
  revision=$(jq -er '.revision' <<<"$published")
  jq -e --arg gate "$gate" --arg source "$source_version" --arg config "$CONFIG_ID" \
    '.outcome == "changed" and .data.gate_id == $gate and .data.policy_revision == 1 and .data.workspace_snapshot_id == $source and .data.config_identity == $config and (.data.policy_version_id | type == "string" and length > 0)' \
    <<<"$published" >/dev/null
  policy_versions[$gate]=$(jq -er '.data.policy_version_id' <<<"$published")
done

printf 'guided closeout smoke: project setup, enrolled Agent sessions, workspace snapshot, and all three gate policies published\n' >&2

start_service() {
  local max_requests=$1
  mkdir -p "$(dirname "$SOCKET")"
  rm -f "$SOCKET"
  "$BIN" service run --db "$DB" --socket "$SOCKET" --max-requests "$max_requests" --json >"$LOG" 2>&1 &
  SERVICE_PID=$!
  for _ in $(seq 1 100); do
    [[ -S "$SOCKET" ]] && return 0
    if ! kill -0 "$SERVICE_PID" 2>/dev/null; then
      wait "$SERVICE_PID" || true
      SERVICE_PID=
      cat "$LOG" >&2
      return 1
    fi
    sleep 0.01
  done
  cat "$LOG" >&2
  return 1
}

start_service 18 || {
  printf 'guided closeout smoke: service startup failed before socket readiness; setup and gate-policy publication assertions passed\n' >&2
  exit 1
}

attempts=()
fences=()
receipts=()
summaries=()

for i in "${!works[@]}"; do
  work=${works[$i]}
  agent=${agents[$i]}
  session=${sessions[$i]}
  claim=$(service work claim "$PROJECT" "$work" --actor "$agent" --harness "$HARNESS" --session "$session" \
    --source-version "$source_version" --config-identity "$CONFIG_ID")
  attempts[$i]=$(jq -er '.data.attempt_id' <<<"$claim")
  fences[$i]=$(jq -er '.data.fence' <<<"$claim")
  jq -e '.outcome == "changed" and (.data.attempt_id | type == "string" and length > 0) and .data.fence > 0 and .data.phase == "claimed" and .data.current == true' \
    <<<"$claim" >/dev/null

  started=$(service agent start "$work" --project "$PROJECT" --actor "$agent" --harness "$HARNESS" --session "$session" \
    --source-version "$source_version" --config-identity "$CONFIG_ID")
  jq -e '.outcome == "changed" and .data.phase == "running" and .data.current == true' <<<"$started" >/dev/null

  verification=
  for gate in "${gates[@]}"; do
    result=$(service evidence run --project "$PROJECT" --actor "$agent" --harness "$HARNESS" --session "$session" \
      --work "$work" --gate "$gate" --attempt "${attempts[$i]}" --fence "${fences[$i]}")
    jq -e --arg gate "$gate" '.outcome == "changed" and (.data.gate_id | endswith(":" + $gate)) and .data.result == "passed" and .data.execution_outcome == "passed"' \
      <<<"$result" >/dev/null
    receipt_path=$(jq -er '.data.receipt_path' <<<"$result")
    verifier_digest=$(jq -er '.verifier_digest' "$GATES/$gate.json")
    jq -e --arg work "$work" --arg gate "$gate" --arg source "$source_version" \
      --arg config "$CONFIG_ID" --arg policy "${policy_versions[$gate]}" --arg verifier "$verifier_digest" \
      '.subject.work_id == $work and (.subject.gate_id | endswith(":" + $gate)) and .source_snapshot_hash == $source and .config_identity == $config and .gate_policy_version_id == $policy and .gate_policy_revision == 1 and .verifier_identity == $verifier and .result == "passed"' \
      "$receipt_path" >/dev/null
    [[ "$gate" == verification ]] && verification=$result
  done
  receipts[$i]=$(jq -er '.data.receipt_path' <<<"$verification")
  summaries[$i]="$TMP/$work-summary.md"
  printf 'Completed %s with current checkpoint and verification evidence.\n' "$work" >"${summaries[$i]}"
done

for i in "${!works[@]}"; do
  work=${works[$i]}
  agent=${agents[$i]}
  session=${sessions[$i]}
  finish=$(service agent finish "$work" --close --project "$PROJECT" --actor "$agent" --harness "$HARNESS" \
    --session "$session" --attempt "${attempts[$i]}" --fence "${fences[$i]}" \
    --receipt "${receipts[$i]}" --summary "${summaries[$i]}")
  jq -e '.outcome == "changed" and .data.close_state == "closed" and (.data.receipt_id | type == "string" and length > 0)' \
    <<<"$finish" >/dev/null
done

wait "$SERVICE_PID"
SERVICE_PID=

start_service 1 || {
  printf 'guided closeout smoke: service restart failed before status readback\n' >&2
  exit 1
}
status=$(service status "$PROJECT" --actor "$OPERATOR" --harness "$HARNESS" --session "$OPERATOR_SESSION")
jq -e '.data.items | length == 3 and all(.[]; .display_status == "closed")' <<<"$status" >/dev/null
wait "$SERVICE_PID"
SERVICE_PID=

echo "guided closeout smoke: PASS (three independently enrolled Agents, source-bound gate policies, service claim/start/evidence/finish/close, restart, and status readback)"
