# PF-S02-T03 — Attempt 4 independent review evidence

## Decision

**ACCEPTED for the bounded PF-S02-T03 leaf, with a documented integration
limitation.** This is not PF-S02 sprint acceptance, PF-S02-T90/T91/T92
acceptance, or production/release acceptance.

## Source identity

- Repository: `/Users/cybertron/Code/boreal-work`
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Worktree: dirty; unrelated existing changes were preserved.
- `crates/store/src/lib.rs`: `e353bd204b59f90aca94a5040b8561d958c5824aed4bea80231457ce4dcc3817`
- `crates/store/src/identity.rs`: `6eace3d9af29f3df635db000758e0ec486f166e529cd94d8b098a42e03b8d5ed`
- `crates/store/tests/production_identity_revisions.rs`: `16a4b192aa0489ddef01c63b0a0a925ef8b69ef756686e0c4cea662c1ea289a1`
- Coordinator gate record: `project/validation/production/dispatch/COORDINATOR-GATES-2026-09-22.md`, SHA-256 `e97b1a38d63a1ee09fe29e6962799a36de31eb84ef21896730ca9305998dc2a7`.

## Review matrix

| Area | Evidence inspected | Result |
| --- | --- | --- |
| Checked integer conversions | `RestoreEpoch`, entity/proof/fence/snapshot conversion helpers, checked increments, checked SQLite change counts, and focused negative/zero/overflow cases. | PASS |
| Database and restore scope | Positive database identity and restore epoch are persisted separately; context verification rejects mismatched database instance or restore epoch. Restore advances lineage and epoch. | PASS |
| Workspace/project scope | `WorkspaceBinding` requires canonical absolute paths, worktree containment under root, and a non-empty `sha256:` digest. Project binding is checked against the stored database/epoch/binding. | PASS |
| Separate revisions | Project snapshot is read separately from per-work entity/proof cursors. Entity and proof stale errors are distinct; heartbeat does not advance either cursor. | PASS |
| Attempt fence | Fence identity is separately scoped and checked for current attempt, database instance, restore epoch, and revocation. Stale and revoked fences are typed. | PASS |
| Foreign composite pairing | DDL uses `(project_id, work_id)` foreign keys and `(work_id, fence)` pairing; runtime scope checks reject foreign work before mutation without exposing foreign state. Focused test covers the pairing rejection. | PASS |
| Restore invalidation | Restore retains history while invalidating operation identities and revoking fences. Focused test proves old epoch rejection, revoked fence rejection, operation invalidation, and no resurrection. | PASS |
| Non-owning transaction boundary | Identity production code has no `BEGIN`, `COMMIT`, or `ROLLBACK`; callers own the enclosing transaction. Focused test supplies the caller-owned transaction helper. | PASS |
| Public registration | `pub mod identity;` appears once in `crates/store/src/lib.rs`; focused test imports `boreal_store::identity` through that public registration. | PASS |

## Executed/inspected results

`cargo test --locked -p boreal-store --test production_identity_revisions`
returned exit `0`: 6 passed, 0 failed, 0 ignored. The coordinator evidence
also records the full locked store package, workspace, clippy, formatting,
contract, and plan/package gates as passing on the same combined source
identity.

## Limitation — broader production mutation wiring

The repository search finds no production call sites yet constructing an
`IdentityStore`, invoking `install` from canonical production open, or invoking
the identity mutation methods from every root/application mutation path. The
attempt-1 handoff and coordinator integration evidence explicitly leave that
broader wiring open.

For this review it is classified as a **limitation, not an acceptance failure**:
the PF-S02-T03 card requires the bounded identity persistence behavior,
migration, scope/conflict protections, focused checks, and actual combined
registration; it does not state every application mutation call site as a
separate leaf acceptance row. The limitation remains material to broader
production completeness and must not be represented as sprint acceptance.

## Preservation

Only `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md` under
`attempt-4` are review outputs. No source, `STATE.json`, manifest, or prior
attempt evidence was edited.
