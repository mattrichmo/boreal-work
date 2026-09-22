# PF-S02-T01 — Attempt 8 independent re-review handoff

## Identity and decision

- Task / attempt: `PF-S02-T01` / `attempt-8`.
- Reviewer: Codex, independent of the attempt-7 corrective implementer.
- Decision: **accepted for PF-S02-T01 only**.
- Source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined
  worktree; reviewed source hashes are in `START.md` and `COMMANDS.md`.
- Files written by this review: only `attempt-8/{START,COMMANDS,EVIDENCE,HANDOFF}.md`.

## Finding disposition

Attempt-6 findings F-PF-S02-T01-06-001, -002, and -003 are corrected and
independently reverified. The public v2 path now acquires the writer boundary
and performs live/legacy preflight before `repair_schema_v2`; real adapter
tests cover identity/checksum/ledger, newer-version rejection, live-attempt
rejection, failure rollback/retained failure, legacy-v3 repair, and partial
metadata rejection. Generic fake-backend tests were not counted alone.

Attempt-6 observation F-PF-S02-T01-06-004 remains precisely as stated:
`verify_production_schema_current` accepts either a valid bootstrap route or a
valid v2-to-v3 route, while the integrated fixtures assert the expected route
shape without making route provenance a separate verifier invariant.

The other preserved attempt-7 limits also remain: no two-process concurrent
writer race harness was run; migration helper dead-code warnings remain; and
one release benchmark is intentionally ignored. These are residual observations,
not new T01 rejection findings.

## Verification receipt

- `cargo fmt --all -- --check`: pass.
- `cargo check --locked -p boreal-store`: pass, with the existing two helper
  dead-code warnings.
- `cargo test --locked -p boreal-store`: pass; 87 passed, 1 ignored, 0 failed.
- `production_migrations`: 16/16 pass, including the seven real adapter cases.
- `schema_v3`: 11/11 pass.
- `storage_remediation`: 15/15 pass.
- `store_contracts`: 24/24 pass.
- `git diff --check`: pass.

## Authority limits and next safe action

This handoff is attributable review evidence for T01 only. It does not edit
plan state or `STATE.json`, close PF-S02, authorize PF-S02-T02 or any other
successor, or claim service/native/publication/release readiness. The
coordinator may use this evidence in the separate PF-S02 review/reconciliation/
revalidation chain.
