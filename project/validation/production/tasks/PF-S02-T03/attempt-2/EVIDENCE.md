# PF-S02-T03 — Attempt 2 independent validation evidence

## Decision

**REJECTED for PF-S02-T03 leaf acceptance.** The requested tests and quality
gates pass on the integrated store tree, but the production root/application
mutation call wiring remains open. The public module registration alone leaves
the identity implementation disconnected from canonical production open and
mutation transactions. Per the assigned acceptance scope, this is a blocking
integration gap.

This is a leaf review only. It is not acceptance of PF-S02, PF-S02-T90/T91/T92,
or production completion.

## Source and prior evidence identity

- Repository: `/Users/cybertron/Code/boreal-work`
- Branch / HEAD: `codex/apply-responsive-terminal-overlay` /
  `784a41b3802c29a76721c55eef2e9493283396c2`
- Worktree: dirty; the review did not modify pre-existing paths.
- Runtime: Darwin ARM64, `xnu-11215.61.5`; `rustc 1.85.0`, `cargo 1.85.0`.
- Integrated leaf inputs:

  ```text
  e353bd204b59f90aca94a5040b8561d958c5824aed4bea80231457ce4dcc3817  crates/store/src/lib.rs
  6eace3d9af29f3df635db000758e0ec486f166e529cd94d8b098a42e03b8d5ed  crates/store/src/identity.rs
  16a4b192aa0489ddef01c63b0a0a925ef8b69ef756686e0c4cea662c1ea289a1  crates/store/tests/production_identity_revisions.rs
  5eb9906957a1831ecdb0f6d7a87391b4f7d4f496108b6c3779a277d4f048c427  project/validation/production/tasks/PF-S02-T03/attempt-2/START.md
  ```

- Attempt-1 coordinator integration reported these integrated source hashes:
  `lib.rs` `e353bd204b59f90aca94a5040b8561d958c5824aed4bea80231457ce4dcc3817`,
  `identity.rs` `6eace3d9af29f3df635db000758e0ec486f166e529cd94d8b098a42e03b8d5ed`,
  and the focused test `16a4b192aa0489ddef01c63b0a0a925ef8b69ef756686e0c4cea662c1ea289a1`.
- Attempt-1 `HANDOFF.md`, `EVIDENCE.md`, and `COORDINATOR-INTEGRATION.md` were
  read before review. They accurately identified public registration and
  clippy cleanup as integrated while leaving broader root/application wiring
  open.

## Required behavior review

| Area | Evidence observed | Result |
| --- | --- | --- |
| Checked conversions | `checked_u64`, checked change counts, checked increment paths, and `TryFrom` implementations reject negative/zero/too-large SQLite values; focused test covers negative revision, zero fence, and `u64::MAX` conversion. | PASS |
| Project/database/restore/workspace scope | Database identity is positive and explicit; `verify_context` checks database instance, restore epoch, project binding digest, canonical root/worktree; workspace construction requires an absolute canonical path and worktree under root. | PASS |
| Separated revisions | `project.project_revision` is read as snapshot context; per-work entity/proof cursors live in `boreal_entity_revision`; entity and proof stale errors are distinct; heartbeat does not advance any cursor. | PASS |
| Foreign composite pairing | Composite `(project_id, work_id)` foreign keys protect entity/fence/migration rows; fence identity also references `(work_id, fence)`; `ensure_work_scope` rejects a foreign work before mutation. Focused test proves rejection and no foreign leakage. | PASS |
| Restore invalidation | Restore advances database instance/epoch, updates project identity context, invalidates current operation identities, revokes fence identities, and retains rows. Focused test proves old context rejection, revoked fence rejection, invalidated operation readback, and no re-registration. | PASS |
| Non-owning transaction seam | Identity mutation methods contain no transaction begin/commit/rollback; callers retain root transaction ownership. The focused test supplies the caller-owned transaction helper. | PASS as a seam |
| Public registration / duplicate module | `pub mod identity;` occurs exactly once in `crates/store/src/lib.rs`; the focused test imports that public module, with no source-path shim. | PASS |
| Integrated clippy cleanups | Integrated `lib.rs` contains the migration diagnostic construction/adapter cleanup and updated FFI declaration; strict `cargo clippy --locked -p boreal-store --all-targets -- -D warnings` passes. No behavior change was inferred from cleanup-only edits. | PASS |

## Executed results

- Focused identity target: **exit 0; 6 passed, 0 failed, 0 ignored**.
- Full locked store package: **exit 0; 98 passed, 0 failed, 1 ignored**;
  doc-tests **0 passed, 0 failed**.
- Locked store check: **exit 0**.
- Strict store clippy: **exit 0**.
- Workspace format check: **exit 0**.
- Repository diff check: **exit 0**.

No focused command was blocked or left running.

## Blocking finding

### PF-S02-T03-RV-001 — Production identity call wiring is absent

- Severity: **high / blocking for this leaf acceptance**.
- Reproduction: the integrated tree has exactly one public module declaration,
  but a repository search finds no production call site constructing an
  `IdentityStore`, invoking `install` at canonical production open, or invoking
  `bind_project`, `advance_entity`, `advance_proof`, `record_attempt_fence`,
  `heartbeat`, `record_operation_context`, or `restore` from root/application
  mutation paths. Matches are confined to `crates/store/src/identity.rs` and
  the focused test.
- Impact: the identity records and separated cursors are not authoritative in
  actual production open/mutation flows, and the required atomic coupling to
  canonical root rows is not established. The public registration is therefore
  connected syntactically but not functionally at the production boundary.
- Required owner/action: coordinator/store/application integration owner must
  invoke `IdentityStore::install` from the canonical production-open/migration
  transaction and call the identity mutation methods within each corresponding
  root transaction, preserving the non-owning seam. Then rerun the focused and
  full locked store checks on the exact combined tree.

The limitation is explicitly retained rather than treated as an outside-scope
deferral because the attempt-1 integration request and the task card require
these production boundaries for acceptance.

## Scope and preservation

This review wrote only the attempt-2 validation records. It did not edit source,
`STATE.json`, or manifest. Existing failed/history evidence remains in attempt-1.
No parent sprint, PF-S02, service, CLI, TUI, native, publication, or production
acceptance claim is made.
