# PF-S02-T01 — Attempt 2 shared integration

- Task: integrate the ordered production migration runner at the `SqliteStore`
  boundary and publish the matching production schema artifact.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: 2026-09-22 (America/Regina).
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree;
  accepted PF-S01-T92 gate at
  `project/validation/production/tasks/PF-S01-T92/attempt-3/HANDOFF.md`;
  worker implementation and focused receipts at
  `project/validation/production/tasks/PF-S02-T01/attempt-1/HANDOFF.md`.
- Coordinator authorization: shared integration worker for
  `crates/store/src/lib.rs` and `project/spec/schema-production.sql`.
- Attempt outputs: this directory only. Prior attempt-1 evidence remains
  preserved and is not overwritten.

## Granted write boundary

- `/Users/cybertron/Code/boreal-work/crates/store/src/lib.rs`
- `/Users/cybertron/Code/boreal-work/project/spec/schema-production.sql`
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T01/attempt-2/{START.md,COMMANDS.md,EVIDENCE.md,HANDOFF.md}`

No other implementation, schema, manifest, plan, state, domain, application,
service, TUI, migration-runner, worker-test, or prior-evidence path may be
edited by this attempt. Existing unrelated dirty changes are preserved.

## Interpreted invariant

Fresh and explicit migration/repair opens must pass through one production
`MigrationRunner` plan whose identity, target checksum, ordered step checksums,
ledger tables, diagnostics, and verification SQL agree with the published
production schema artifact and accepted contract manifest. The adapter must
reuse `SqliteStore`'s existing connection, transaction/statement helpers, and
SQLite busy classification. Service/maintenance ownership remains the
existing outer `ProjectElection` boundary; no lock is force-broken or replaced
by a second store-side lock implementation. Unsupported newer identities,
live attempts, ambiguous legacy facts, failed transactions, and mismatched
ledger/checksum state fail closed while preserving retryable diagnostics.

## Planned verification

- Inspect the integrated public store surface and add only `lib.rs`-local
  regression tests if needed; do not modify the worker test file.
- Run `cargo fmt --all -- --check`, focused migration/store tests, full store
  tests, contract/schema checks, and `git diff --check` where available.
- Record exact commands, exits, source/runtime identity, hashes, observed
  failures, and any unsupported service/native evidence in the remaining
  attempt-2 records. This attempt cannot self-accept the PF-S02-T01 leaf or
  its PF-S02 review/reconciliation/revalidation chain.
