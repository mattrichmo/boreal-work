# PF-S03-T10 — attempt 9 handoff

## Identity and disposition

- Task: `PF-S03-T10` — complete deterministic oracle coverage for status and transitions.
- Attempt: `9` — PF-S03 CLI compatibility remediation.
- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743` (`70514f0e`).
- Final owned source: `crates/cli/src/main.rs`.
- Final owned source SHA-256: `76e3d10f1a706cf4133ebf05a8c0bb18f924d0f977ea695d210a6a3a78084a2a`.
- State: **ready for independent review**.
- Decision: **not accepted**. No plan/state/acceptance update, commit, or push.

## Result

The CLI compatibility match now handles `DerivedStatus::Scheduled` and emits
`queued`, as required for status/2 consumers. A focused regression proves the
mapping and preserves `ready` for actual ready status. The application layer's
existing compatibility accessor continues to retain the typed
`scheduled_start(...)` reason, canonical timer, non-claimability, and
`wait_until` action; this attempt did not duplicate those decisions.

## Exact validation status

- CLI compile: **PASS** — `cargo check --locked --offline -p boreal-cli --bin bwrk`.
- Focused CLI regression: **PASS** — 1 passed.
- Full CLI package: **PASS** — 116 tests passed, 0 failed.
- Application compile: **PASS** — `cargo check --locked --offline -p boreal-application`.
- Application status tests: **PASS** — 7 passed, 0 failed.
- Rust formatting: **PASS**.
- Contract validator: **PASS**.
- Diff check: **PASS**.

The baseline non-exhaustive `DerivedStatus::Scheduled` compile error is
resolved. Existing non-fatal dead-code warnings remain in the combined tree.

## Bounded source blockers

1. The full application suite's previously reported resource-reservation
   uniqueness failure remains owned by PF-S02 recovery/resource integration;
   this attempt intentionally did not touch that protected path.
2. A public status/3 CLI serializer is not part of this narrow status/2
   compatibility fix. If required by the coordinator, it must be added by the
   protocol/CLI integration owner with direct canonical-decision coverage.
3. Independent review and exact-tree revalidation remain required before any
   task or sprint acceptance.

## Next safe action

Have the independent reviewer inspect this one-file CLI change and its focused
regression. Then rerun the combined application/store/CLI checks after the
PF-S02 resource integration is reconciled. Keep this handoff as evidence and
do not update `STATE.json` from this bounded contribution alone.
