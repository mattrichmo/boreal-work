# PF-S02-T02 — Attempt 3 corrective evidence

## Record

- Record: `PF-S02-T02/attempt-3`.
- Evidence class: source + public qualified seam contract + store integration.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined
  worktree.
- Prerequisite: `PF-S02-T01/attempt-8`, accepted for T01 only.
- Runtime: macOS local workspace; `rustc 1.85.0`, `cargo 1.85.0`; real
  in-memory SQLite through `boreal-store`.
- Setup: disposable schema-v2 fixtures in the focused Rust integration target;
  no live database, external process, service, receipt, reviewer, or release
  operation was used.
- Outcome: `awaiting_integration`; no task acceptance is claimed.

## Corrected findings

### F-PF-S02-T02-02-001 — corrected in the bounded seam

`crates/store/src/transactions.rs` no longer defines a transaction or
revision owner. `RootMutationAdapter` has a private root reference and project
scope, but no raw-store accessor. Its typed methods delegate to existing root
mutations such as `SqliteStore::update_gate_state`; those root methods retain
the authoritative `BEGIN IMMEDIATE`, expected-revision check, revision bump,
and `finish_transaction` commit/rollback path. The wrapper cannot open a
nested transaction or perform a second revision check.

The focused regression calls the public qualified
`boreal_store::transactions::with_root_mutation` path with a real gate update.
It observes one revision bump and a committed gate, then sends a stale root
mutation and verifies the typed stale-revision error, unchanged revision, and
unchanged gate state. A wrapper that still opened a transaction would fail the
first root mutation with SQLite's nested-transaction error.

### F-PF-S02-T02-02-002 — corrected in focused evidence

`crates/store/tests/production_store_seams.rs` contains no `#[path]` mounts or
local duplicate seam modules. It imports the public modules as
`boreal_store::{acceptance, execution, operations, profiles, transactions}`
and uses qualified paths throughout the five-test target.

## Evidence matrix

| Property | Evidence | Result |
| --- | --- | --- |
| One transaction/revision owner | `transactions.rs` source scan plus `qualified_root_adapter_delegates_to_one_root_mutation_boundary` | Pass for the corrected seam: no wrapper lifecycle methods; root mutation owns commit/rollback/revision. |
| No raw root escape | Private adapter field; no `store()` method; negative symbol scan | Pass. |
| Qualified public registration/call sites | Focused test imports all five `boreal_store` modules; focused target passes | Pass. |
| Project-scoped operation readback | `operation_journal_appends_and_scopes_readback_to_the_project` | Pass; foreign project returns `WrongSubject`. |
| Failed/unknown execution history | `execution_seam_preserves_admission_replay_and_lifecycle_states` | Pass; unknown execution remains in incomplete readback. |
| Profile and acceptance boundaries | Profile identity/JSON validation and pinned gate/diagnostic reads | Pass; no lifecycle policy SQL was added. |
| Existing store behavior | Full `boreal-store` package | Pass: 92 passed, 1 intentional ignore. |

## Coordinator-owned `lib.rs` integration patch

The current combined root already has the required public module declarations
at `crates/store/src/lib.rs:25-32`, and its SHA-256 is unchanged. No root file
was edited in this attempt. If the coordinator wants construction centralized
at the canonical root, the precise minimal optional patch is:

```diff
diff --git a/crates/store/src/lib.rs b/crates/store/src/lib.rs
@@ impl SqliteStore {
+    pub(crate) fn root_mutation_adapter(
+        &self,
+        project_id: &str,
+    ) -> transactions::RootMutationAdapter<'_> {
+        transactions::RootMutationAdapter::new(self, project_id)
+    }
```

Coordinator integration must keep `SqliteStore` root methods as the only
transaction/revision owner and must not add `BEGIN`, `COMMIT`, `ROLLBACK`, or
revision checking to `transactions.rs`. The five existing declarations remain
qualified; no glob re-export is needed. This patch is an integration request,
not a claim that it was applied here.

## Limits

- The root remains a dirty combined source and was read-only for this attempt;
  independent re-review must inspect the integrated tree.
- Existing root methods retain their established transaction boundaries; this
  correction prevents the new seam from advertising a competing owner. A
  broader root-method consolidation, if desired, is outside this worker's
  granted files and requires coordinator ownership.
- No two-process race harness, service/CLI/TUI execution, native artifact,
  publication, release, or independent review was run or claimed.
- The Boreal workflow database was busy under process `68913`; no live lock
  was force-broken and no plan state was changed.
