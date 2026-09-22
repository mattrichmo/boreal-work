# PF-S02-T01 — Attempt 6 independent review handoff

## Identity and disposition

- Task / attempt: `PF-S02-T01` / `attempt-6`.
- Reviewer: Codex; independent of the preserved attempt-1 through attempt-5
  implementation/integration workers.
- Decision: **rejected** for this leaf only.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined
  worktree.
- Prerequisite context read: PF-S02-T01 card, PF-S02 sprint, startup/dispatch/
  review/validation guidance, migration vertical handoff, attempt-1 through
  attempt-5 handoffs/evidence, current migration/store/schema sources, and
  relevant store tests.

## Audited invariant and findings

The public production open/migration path must preflight live and ambiguous
legacy facts and acquire one exclusion boundary before any schema repair or
migration writes. Fresh, ordered upgrade, rollback/retry, reopen, identity/
checksum/ledger, unsupported-newer, live-attempt, legacy-v2, and explicit
legacy-v3 compatibility cases must be proven at the real store boundary.

- `F-PF-S02-T01-06-001` — major: v2 repair writes occur before runner
  preflight/lock (`crates/store/src/lib.rs:1333-1347`, `:4792-4812`; runner
  order `crates/store/src/migrations.rs:471-488`, `:547-575`).
- `F-PF-S02-T01-06-002` — major: no explicit legacy-v3 metadata-repair
  fixture/test (`crates/store/src/lib.rs:1355-1433`, dispatch `:1435-1459`; no
  `repair_production_schema` test in `crates/store/tests/`).
- `F-PF-S02-T01-06-003` — major: production migration negative/identity/
  ledger tests use an isolated fake backend (`crates/store/tests/
  production_migrations.rs:1-2,62-90,237-372`), not the integrated public
  adapter (`crates/store/src/lib.rs:7232-7483`).
- `F-PF-S02-T01-06-004` — observation: current verification treats either
  bootstrap or step ledger evidence as sufficient (`crates/store/src/lib.rs:
  1465-1510`; generic runner `crates/store/src/migrations.rs:893-922`).

## Verification summary

- `cargo fmt --all -- --check`: exit 0.
- `cargo test --locked -p boreal-store`: exit 0; all package targets passed,
  one annotated release benchmark ignored, existing migration dead-code
  warnings observed.
- Focused targets: `production_migrations` 9/9, `schema_v3` 11/11,
  `storage_remediation` 15/15, `store_contracts` 24/24; all exit 0.
- `sqlite3 :memory: < project/spec/schema-production.sql`: exit 0.
- `git diff --check`: exit 0.
- No public review workflow route was available through the current read-only
  `bwrk` registry; a read-only work-show request returned `service_busy`. No
  plan/state mutation was attempted.

## Required follow-up

The coordinator/integration owner should correct the live-attempt ordering,
add the real-store negative/identity/ledger cases and explicit legacy-v3
compatibility fixture, then rerun the requested full and focused checks on the
new exact source identity. This handoff does not accept PF-S02-T01's parent
sprint or any service/native/publication/release scope, and it does not alter
plan state.

- [x] No success was inferred from the passing fake-backend tests.
- [x] Prior failed/blocked attempts remain preserved.
- [x] No product source, test, STATE.json, prior evidence, or unrelated path
      was edited.
- [ ] Leaf acceptance: not granted; decision is rejected pending correction
      and independent revalidation.
