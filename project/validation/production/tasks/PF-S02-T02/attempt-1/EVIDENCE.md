# PF-S02-T02 — Attempt 1 evidence

## Record

- Record: `PF-S02-T02/attempt-1`.
- Evidence class: source + pure seam contract + store integration.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined worktree.
- Prerequisite: accepted `PF-S02-T01/attempt-8` handoff/evidence; that acceptance is limited to T01.
- Host/toolchain: macOS local workspace; `rustc 1.85.0`, `cargo 1.85.0`; SQLite is the real adapter linked by `boreal-store`.
- Setup: disposable in-memory schema-v2 stores created by the focused Rust integration target. No live database, external process, service, receipt, reviewer, or release operation was used.
- Outcome: `awaiting_integration`; no task acceptance is claimed.

## Implemented seam evidence

| Area | Interface exercised | Observed assertion |
| --- | --- | --- |
| Transactions | `RevisionExpectation`, `ProjectWrite`, `with_project_write`, `with_write_transaction` | Revision is checked after `BEGIN IMMEDIATE`; successful writes commit; a body error rolls back; stale revision is typed. |
| Profiles | `ProfileVersion`, `ProfileIdentity`, `ProfileStore` | Non-empty version/digest/timestamp and valid JSON are required before insert; profile registration delegates to the existing insert-only store boundary; identity changes do not match. |
| Operations | `OperationBundle`, `OperationJournal` | Operation + optional audit append in a caller-owned transaction; project-scoped readback returns the operation/audit; a foreign project is rejected. |
| Execution | `ExecutionIdentity`, `ExecutionStore` | Admission is durable and idempotently replayed; start and exit transitions read back as `running`/`exited`; incomplete execution remains discoverable. |
| Acceptance | `AcceptanceBinding`, `AcceptanceStore` | Exact proof binding comparison and real pinned gate/diagnostic reads are exercised; facade methods delegate typed receipt/gate/review/summary/close operations without SQL policy duplication. |

The focused target reported 6 passed, 0 failed. The full `boreal-store`
package reported 93 passed, 1 intentionally ignored release benchmark, 0
failed, and 0/0 doc-tests.

## Acceptance checklist mapping

- Same baseline store behavior: existing package suite remained green; no root
  methods or SQL were changed by this worker.
- Registered code: source files are ready for registration, but `lib.rs` is a
  protected coordinator path and was not edited. The package check therefore
  does not prove root-module registration; the focused target proves the exact
  files compile against equivalent parent exports and real store behavior.
- Disjoint seams: transaction ownership, profile envelope, execution stages,
  operation/audit journal, and acceptance read/write facade are separate files
  with no nested `BEGIN` in their delegated journal/acceptance methods.
- Policy boundary: lifecycle/acceptance decisions remain in existing Rust
  store/application methods; the new modules add typed envelopes/facades only.
- Evidence retention: failed intermediate test output and all pre-existing
  dirty paths remain preserved; no prior evidence or `STATE.json` was edited.

## Required coordinator integration

Apply this exact protected-root patch near the existing store module
declarations in `crates/store/src/lib.rs`:

```diff
 mod knowledge;
 mod migrations;
 mod status_evaluation;
 mod work_model_v3;
+pub mod acceptance;
+pub mod execution;
+pub mod operations;
+pub mod profiles;
+pub mod transactions;
```

The modules should be consumed by qualified paths such as
`boreal_store::transactions::ProjectWrite` and
`boreal_store::acceptance::AcceptanceStore`; do not glob re-export them,
because the seam source intentionally contains local identity/outcome names
that should not collide with the existing root store types. After applying the
patch, rerun `cargo check --locked -p boreal-store`,
`cargo test --locked -p boreal-store --test production_store_seams`, and the
full package test. A stronger registration proof may replace the test-local
`#[path]` mounts with qualified `boreal_store::<module>` imports on the
coordinator branch.

## Limitations

- No shared-root registration was performed in this attempt by instruction.
- No two-process race harness, service/CLI/TUI execution, native artifact,
  publication, or independent review was run; none is required to claim from
  this bounded worker evidence.
- Existing migration dead-code warnings remain.
- The `ProfileStore` delegates to the current `ensure_acceptance_profile`
  insert-only primitive; full profile readback/content-conflict enforcement is
  intentionally left for PF-S02-T04 rather than duplicated here.
