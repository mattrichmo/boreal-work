# PF-S02-T01 — Attempt 1 handoff

## Status

Implementation complete within the exclusive worker write set; focused and
store-package tests pass. Awaiting coordinator integration and review. This
attempt does not self-accept PF-S02-T01 or claim the sprint gate.

Input source was dirty `HEAD
784a41b3802c29a76721c55eef2e9493283396c2`, with the accepted PF-S01-T92
attempt-3 handoff/gate as the prerequisite. No branch, commit, plan item,
execution state, shared schema, or shared store root file was changed.

## Exact changed paths

- `/Users/cybertron/Code/boreal-work/crates/store/src/migrations.rs`
- `/Users/cybertron/Code/boreal-work/crates/store/tests/production_migrations.rs`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-1/START.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-1/COMMANDS.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-1/EVIDENCE.md`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-1/HANDOFF.md`

## Coordinator integration request

Please integrate the worker patch at the same source identity and review it
against the current shared files.

1. In coordinator-owned
   `/Users/cybertron/Code/boreal-work/crates/store/src/lib.rs`, register the
   module and expose the intended public surface. Implement
   `MigrationBackend` for the existing `SqliteStore` using its private raw
   SQLite transaction/statement boundary and service/maintenance lock. Route
   fresh open and explicit upgrade/repair entry points through
   `MigrationRunner` before ordinary mutations. Map SQLite busy/locked errors
   to the typed `Busy` result and preserve the no-force-break rule. Do not
   create a second transaction or lock implementation beside this module.

2. In coordinator-owned
   `/Users/cybertron/Code/boreal-work/project/spec/schema-production.sql`,
   register the exact production schema identity, target contract/checksum,
   ledger and diagnostic tables, and ordered additive migration artifact(s)
   corresponding to the runner plan. The shared schema must preserve v2/v3
   and legacy rows, encode the accepted pre/postconditions, and make the
   target identity/checksum agree with the manifest. Update any coordinator
   manifest/ordering metadata only through the normal shared-file integration
   review; this attempt intentionally did not touch those files.

3. During integration, adapt the focused tests to the real public store
   boundary or add an equivalent integrated test. Confirm fresh, upgrade,
   repeated open, failed transaction rollback, interrupted recovery, legacy
   preservation/diagnostics, unsupported-newer rejection, and concurrent
   migration exclusion against the production schema—not only the isolated
   backend used here.

## Verification handoff

- `cargo test --locked -p boreal-store --test production_migrations`: passed,
  9/9.
- `cargo test --locked -p boreal-store`: passed; existing package suites and
  the focused migration suite passed, with one existing release benchmark
  ignored by annotation.
- Targeted rustfmt check and `git diff --check`: passed.
- Workspace-wide `cargo fmt --all -- --check`: not clean because of an
  unrelated existing diff in `crates/domain/tests/production_decision_inputs.rs`.
- Workflow evidence: `bwrk prime --json` lacked a project identifier; direct
  workflow resolution was busy on the existing local Boreal database owner.

## Residual review risks

The runner's public adapter contract is deliberately unregistered here because
`lib.rs` and `schema-production.sql` are shared coordinator paths. Review must
confirm that the coordinator supplies exact production schema checksums and
that the real adapter returns actionable diagnostics for live attempts and
ambiguous legacy records before any metadata write. Runtime/release evidence,
multi-process lock evidence, and self-acceptance remain outstanding.
