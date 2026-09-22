# PF-S02-T02 — Attempt 2 independent review evidence

## Decision

**REJECT for PF-S02-T02 only.** All requested commands pass and the five
modules are publicly registered, but the bounded store-seam contract fails its
single transaction/revision-owner invariant. This review does not assess or
accept PF-S02, service, native, publication, release, or any other leaf.

## Positive evidence observed

- `crates/store/src/lib.rs:25-32` registers `acceptance`, `execution`,
  `operations`, `profiles`, and `transactions` as `pub mod`; qualified paths
  such as `boreal_store::transactions::ProjectWrite` are available and the
  crate check compiles the integrated declarations.
- `profiles.rs` validates profile identity/content before delegating to the
  existing insert-only registration primitive. It does not evaluate gate
  satisfaction. The attempt-1 limitation that full profile conflict/readback
  enforcement belongs to PF-S02-T04 remains bounded and explicit.
- `execution.rs` delegates admission/start/finish/unknown/incomplete reads to
  the existing store methods. The focused test proves admission replay,
  running/exited transitions, unknown retention, and incomplete readback;
  failed/unknown history remains queryable rather than erased.
- `operations.rs` appends the operation/audit bundle without opening a nested
  transaction, and `operation_readback` checks both operation and execution
  project identity. The focused test rejects a foreign-project readback.
- `acceptance.rs` is a typed facade over canonical gate/diagnostic,
  receipt/review/summary, and close-intent methods. It adds no SQL status
  predicate or lifecycle authorization policy. The focused test reads a pinned
  gate and attempt/fence diagnostics.
- The required formatter, compile, focused test, full package test, and
  whitespace checks all passed on the current dirty combined tree. See
  `COMMANDS.md` for exact exits and counts.

## Findings

### F-PF-S02-T02-02-001 — transaction and revision ownership remains duplicated

- Severity: **major**; explicit task invariant and acceptance blocker.
- Exact sources: the new owner path is
  `crates/store/src/transactions.rs:34-140`; the existing root transaction
  finalizer and revision checker remain at
  `crates/store/src/lib.rs:8278-8291` and `:8310-8317`. Existing root writes
  continue to issue their own `BEGIN IMMEDIATE` boundaries, for example
  `insert_review` at `lib.rs:5742` and `insert_summary` at `:5894`.
- Observation: `ProjectWrite::begin`, `commit`, `rollback`,
  `with_project_write`, and `with_write_transaction` implement a second
  transaction owner and a second stale-revision comparison. The new seam is
  not used to consolidate the existing root mutations. `ProjectWrite::store()`
  returns the raw `SqliteStore`, so a caller inside the new transaction can
  invoke existing transaction-owning methods; those paths can attempt a
  nested `BEGIN IMMEDIATE` instead of sharing one owner. The focused test only
  performs raw SQL through the wrapper and does not expose this integration
  conflict.
- Impact: the requested “one named location” for transaction ownership and
  revision boundaries is not present. Later persistence tasks cannot rely on a
  single transaction/revision authority, and the seam is a parallel wrapper
  beside the monolith rather than an integrated store boundary.
- Required correction: consolidate transaction begin/commit/rollback and
  expected-revision checking into one canonical store seam; route existing
  root writes through non-transactional in-transaction primitives or the
  canonical owner; and prevent the public wrapper from calling a second
  transaction-owning path. Add a regression that uses a qualified
  `boreal_store::transactions` path with a real root mutation and verifies one
  commit/rollback/revision boundary.
- Review status: **reproduced by source inspection**; no production source was
  edited in this review.

### F-PF-S02-T02-02-002 — focused test bypasses qualified root exports

- Severity: **observation / evidence limitation**, not the primary rejection
  basis.
- Exact sources: `crates/store/tests/production_store_seams.rs:14-24` mounts
  every seam with `#[path = "../src/..."] mod ...`; local imports are at
  `:26-32`. The root exports are present at `crates/store/src/lib.rs:25-32`.
- Observation: `cargo check --locked -p boreal-store` proves the public root
  declarations compile, but the focused six-test target exercises local test
  modules rather than `boreal_store::acceptance`, `::execution`,
  `::operations`, `::profiles`, and `::transactions`. This leaves the
  qualified export/call-site path untested and produces dead-code warnings for
  facade methods in the local duplicate module.
- Required strengthening: change the focused target to import the public
  qualified modules after the transaction-owner correction, then rerun the
  focused and full store checks on the resulting exact source identity.

## Bounded contract matrix

| Requested property | Review result |
| --- | --- |
| Seams are real and behavior-preserving | Partial: real wrappers exercise the existing adapter, but transaction seam is disconnected from the existing owner. |
| Public/qualified registration | Static pass: all five are `pub mod`; focused test proof is weaker because it uses `#[path]`. |
| Single transaction/revision ownership | **Rejected**; F-PF-S02-T02-02-001. |
| Project-scoped readback | Pass for `operation_readback` and foreign-project test. |
| Failed/unknown execution history | Pass for retained `unknown` and incomplete readback; full store suite also retains failed receipt facts. |
| Policy outside SQL | Pass for the five seam files; they contain no policy SQL and delegate canonical Rust/store methods. |

## Limits and retained observations

- Source hashes match attempt-1 exactly for all five modules and the focused
  test; the current root integration hash is recorded separately. The
  duplicate-writer/hash reconciliation observation is preserved rather than
  treating the current dirty root as attempt-1 worker output.
- The review was performed on a dirty combined worktree with many unrelated
  paths already modified/untracked. No unrelated change was attributed to
  this leaf.
- The installed Boreal workflow/candidate probes returned `service_busy` due
  to an existing owner; no live lock was force-broken and no `STATE.json`
  mutation was attempted.
- No two-process race harness, service/CLI/TUI, native, publication, release,
  sprint, or parent-gate acceptance was run or claimed.

## Required next action

Create a bounded correction for F-PF-S02-T02-02-001 within the store seam/root
integration ownership rules, add qualified-export coverage for F-PF-S02-T02-02-002,
then rerun this leaf's independent review on the new exact combined source.
