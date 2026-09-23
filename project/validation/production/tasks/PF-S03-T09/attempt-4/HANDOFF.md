# PF-S03-T09 — attempt 4 handoff

## Disposition

Bounded action/status compatibility remediation complete for independent
review. This is not task or sprint acceptance.

## Exact changed files

- crates/application/src/status.rs
- crates/cli/src/main.rs
- apps/tui/src/client.ts
- apps/tui/src/test.ts
- project/validation/production/tasks/PF-S03-T09/attempt-4/START.md
- project/validation/production/tasks/PF-S03-T09/attempt-4/COMMANDS.md
- project/validation/production/tasks/PF-S03-T09/attempt-4/EVIDENCE.md
- this handoff

crates/cli/src/service.rs did not require a direct edit: its status route
already calls the shared CLI status_snapshot_json serializer.

## Contract result

Legacy rows remain discoverable when v3 action facts are absent without
claiming that the readiness hint is mutation authorization. A real action set,
when present, remains authoritative and fail-closed. Status/2 expiry remains
blocked on the wire while structured reasons and TUI normalization preserve
expired_review and its recovery guidance.

## Evidence

See COMMANDS.md and EVIDENCE.md for exact commands, outcomes, source hashes,
the real binary-to-TUI decode check, and the retained full-suite failure. No
commit or push was performed by this attempt.

## Next safe action

Have an independent reviewer inspect this exact dirty-tree file-bound attempt,
then rerun source-bound validation after the surrounding concurrent worktree
lanes are reconciled. Do not update STATE.json, the plan graph, or the
acceptance ledger from this handoff alone.
