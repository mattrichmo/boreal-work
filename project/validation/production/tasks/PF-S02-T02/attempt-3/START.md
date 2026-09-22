# PF-S02-T02 — Attempt 3 corrective implementation start

## Identity and scope

- Task / attempt: `PF-S02-T02` / `attempt-3`.
- Worker: bounded corrective implementation worker; independent re-review and
  coordinator acceptance are not claimed.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: `2026-09-22` (America/Regina); final checks recorded through
  `2026-09-22T09:37:18Z`.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined
  worktree.
- Exclusive write set: `crates/store/src/transactions.rs`,
  `crates/store/tests/production_store_seams.rs`, and this attempt-3 evidence
  directory only.
- Protected: `crates/store/src/lib.rs`, all other production paths, prior
  attempt evidence, and the live Boreal state database.

## Rejection context loaded

Attempt-2 rejected this leaf for:

- `F-PF-S02-T02-02-001`: `transactions.rs` owned a second
  `BEGIN`/commit/rollback and revision-check path beside root `SqliteStore`
  methods, and `ProjectWrite::store()` exposed a raw root capable of nested
  transaction ownership.
- `F-PF-S02-T02-02-002`: the focused target mounted seam files with
  `#[path]` instead of exercising the public qualified crate modules.

The accepted `PF-S02-T01/attempt-8` handoff remains limited to T01. Attempt-1
source/evidence and the complete attempt-2 rejection artifacts remain
untouched and are the historical basis for this correction.

## Baseline source identity

Before the corrective edit, the relevant bytes matched attempt-2:

| Path | SHA-256 |
| --- | --- |
| `crates/store/src/transactions.rs` | `4830cdf1fc791cccc69442166595290647ecaf0bb898714137a193ba9ce8bc0e` |
| `crates/store/tests/production_store_seams.rs` | `68011ada586474b39e5fb08022cfaa650880f7654a9b98bbf0289631db598126` |
| `crates/store/src/lib.rs` | `f3efd3db72cae5250c1b5a7b6a9d2f8c03abbc28e0c01a63b5821977cfb0ffb6` |

The contract manifest was unchanged at SHA-256
`131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.

The project-context probe identified `boreal-work`; `bwrk prime --project
boreal-work --json` returned `service_busy` because process `68913` owns the
database. No live lock was broken and no Boreal workflow/state mutation was
attempted.

## Invariant and intended correction

`SqliteStore` remains the sole transaction/revision owner. The replacement
`transactions` module is an explicit, scoped root-mutation adapter:

1. It has no `BEGIN`, `COMMIT`, `ROLLBACK`, revision comparison, or `Drop`
   transaction cleanup.
2. It has no public raw-store accessor; callers receive only typed root
   mutation delegates.
3. Each delegate invokes an existing root mutation, so that root method keeps
   its authoritative expected-revision check, revision bump, commit, and
   rollback behavior.
4. The focused test imports `boreal_store::{transactions, profiles,
   execution, operations, acceptance}` and uses a real root gate mutation to
   prove one committed revision and a stale mutation that leaves state intact.

## Verification strategy

Run the task checks on the final dirty source: repository and exclusive-file
format checks, store compile, qualified focused seam tests, the full
`boreal-store` package, contract validation, whitespace validation, a source
scan for removed owner/raw-store symbols and test-local mounts, then record
final source hashes. The coordinator must perform the independent re-review
on the integrated combined tree; this attempt does not claim acceptance.
