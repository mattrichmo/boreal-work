# PF-S01-T91 — attempt 2 start

## Boundary

- **Task:** `PF-S01-T91`, coordinator-owned bounded provenance remediation.
- **Started:** `2026-09-22T06:39:52Z`.
- **Input review:** PF-S01-T90 attempt 7, rejected pending reconciliation, at
  `HEAD 784a41b3802c29a76721c55eef2e9493283396c2` on
  `codex/apply-responsive-terminal-overlay`; worktree dirty.
- **Prior attempt:** PF-S01-T91 attempt 1 is preserved as historical evidence.
  Its `no_change` disposition predates T90 attempt-7 findings and is superseded
  for this attempt only; its files will not be edited.
- **Decision boundary:** provenance and acceptance-state reconciliation only.
  No product, Rust, TypeScript, plan, contract, runtime, service, native,
  publication, or release acceptance is in scope.

## T90 findings to reconcile

1. `PF-S01-T90-7-001`: exact T11 contract-manifest digest correction. This is
   coordinator execution-state-only; the manifest bytes must not be edited by
   T91.
2. `PF-S01-T90-7-002`: repair all 21 accepted task/attempt handoff pointers
   from `START.md` to the corresponding complete `HANDOFF.md`, preserving every
   start marker and prior attempt.
3. `PF-S01-T90-7-003`: preserve the stale T01 attempt-2 text and use the
   coordinator superseding attempt-3 handoff. The existing attempt-3 record is
   read-only for this attempt; no historical handoff is rewritten.

The disposition for each finding is recorded as coordinator correction required
and pending valid state readback. This attempt must not claim acceptance until
the coordinator applies the state corrections and the required reruns pass on
that corrected tree.

## Authorized writes

Only these six attempt-2/sprint artifacts may be written:

- `project/validation/production/sprints/PF-S01/reconciliation-attempt-2.md`
- `project/validation/production/sprints/PF-S01/remediation-map-attempt-2.json`
- `project/validation/production/tasks/PF-S01-T91/attempt-2/START.md`
- `project/validation/production/tasks/PF-S01-T91/attempt-2/COMMANDS.md`
- `project/validation/production/tasks/PF-S01-T91/attempt-2/EVIDENCE.md`
- `project/validation/production/tasks/PF-S01-T91/attempt-2/HANDOFF.md`

`project/build-plan/production-completion/execution/STATE.json` is read-only in
this attempt. `plan.json`, all contract artifacts, Rust/TypeScript, and prior
review/reconciliation evidence are also read-only.

## Verification plan

Run the contract validator, plan validator, graph-readiness query, package
validator, manifest/conformance readback, and the 21-pointer/T01 consistency
checks before and after producing the bounded artifacts where possible. Record
any invalid-ledger or unavailable-tool condition exactly. The post-correction
rerun matrix is not evidence of acceptance until the coordinator state update
is applied and read back.
