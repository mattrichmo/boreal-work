# PF-S02-T03 — Attempt 1 implementation evidence

## Evidence identity

- Record: `PF-S02-T03 / attempt-1`, implementation evidence only.
- Evidence class: store/source with temporary coordinator-registration shadow validation.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree.
- Final assigned source hashes:
  - `crates/store/src/identity.rs`: `495b924aa82154ae1ab93d59653dc9a688f9908c07a2ec024f16f891b899a4f2`.
  - `crates/store/tests/production_identity_revisions.rs`: `16a4b192aa0489ddef01c63b0a0a925ef8b69ef756686e0c4cea662c1ea289a1`.
  - `START.md`: `2be0ada78916cde546b173a8a49b9863c8ace81eb4afef5316f106c6f9b22371`.
- Protected shared root hash: `crates/store/src/lib.rs` remained
  `f3efd3db72cae5250c1b5a7b6a9d2f8c03abbc28e0c01a63b5821977cfb0ffb6`.
- Runtime: Darwin ARM64 (`xnu-11215.61.5`), rustc `1.85.0`, cargo `1.85.0`.
- Capture date: `2026-09-22`, America/Regina.

## Implemented boundary

`identity.rs` now provides additive SQLite persistence for database instance
and restore epoch, canonical workspace-root/worktree/digest binding, separate
project snapshot/entity/proof cursors, project/work/attempt/fence identity,
operation epoch state, and migration provenance. It uses checked signed/unsigned
conversions and typed errors for project, database, epoch, workspace, stale
entity/proof/fence, revoked fence, invalidated operation, and foreign-subject
conflicts.

Legacy `project.project_revision` values are copied into distinct per-work
entity/proof identities with `boreal_revision_migration` provenance. Pending or
unknown legacy operations remain in the canonical operation table but are
marked invalidated in the identity table. Restore advances the database
lineage, updates the current project identity context, invalidates operation
contexts, and revokes fence identities without deleting history.

Identity mutation methods are deliberately non-owning: the root/coordinator
must open the write transaction and retain commit/rollback ownership. The
focused test uses the real `SqliteStore` and an explicit caller-owned SQLite
transaction helper, not a test-local module mount or fake store.

## Focused assertions

`production_identity_revisions.rs` covers:

1. migration persistence, workspace binding readback, and split entity/proof
   cursors with exact migration counts;
2. heartbeat isolation for task A and unrelated task B;
3. wrong project and wrong restore epoch typed rejection without foreign
   state leakage;
4. independent stale entity, proof, and attempt-fence details;
5. restore invalidation of operations and execution authority, including the
   no-resurrection check for an already invalidated operation; and
6. project/work composite protection, foreign pairing rejection, and checked
   integer conversions.

## Observed validation

The actual combined tree passed `cargo check --locked -p boreal-store`, the
store library target (`cargo test --locked -p boreal-store --lib`, 0 tests),
scoped and workspace formatting, `git diff --check`, and contract validation.
The actual focused and full package test commands both exited `101` at the
new test's qualified import because the coordinator-owned `lib.rs` does not
yet register `pub mod identity;`. This is retained as an integration
limitation, not converted into a pass.

The temporary registration copy at
`/private/tmp/pf-s02-t03-compile.0iwlXO` passed:

- focused identity target: `6 passed, 0 failed`;
- full store package: `98 passed, 0 failed, 1 intentionally ignored`,
  doc-tests `0 passed, 0 failed`; and
- `cargo check --offline -p boreal-store`: exit `0`.

No acceptance claim is made. The temporary copy is not the final combined
tree, and no real service/native/package/reviewer receipt was produced.
