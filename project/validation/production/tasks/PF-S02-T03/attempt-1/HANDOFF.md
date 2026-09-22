# PF-S02-T03 — Attempt 1 implementation handoff

## Identity and disposition

- Task / plan / attempt: `PF-S02-T03` / PF production-completion plan v1 /
  `attempt-1`.
- Worker: Codex implementation worker.
- State requested: `awaiting_integration`.
- Acceptance: not claimed; coordinator/reviewer/revalidation decisions remain
  outstanding.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree.
- Final assigned source hashes:
  - `crates/store/src/identity.rs` —
    `495b924aa82154ae1ab93d59653dc9a688f9908c07a2ec024f16f891b899a4f2`.
  - `crates/store/tests/production_identity_revisions.rs` —
    `16a4b192aa0489ddef01c63b0a0a925ef8b69ef756686e0c4cea662c1ea289a1`.
  - `START.md` —
    `2be0ada78916cde546b173a8a49b9863c8ace81eb4afef5316f106c6f9b22371`.
- Accepted prerequisite handoffs/evidence were loaded from PF-S02-T01
  attempt-8 and PF-S02-T02 attempt-4; their exact hashes are retained in
  `COMMANDS.md`.

## Changes and invariant

Exact changed paths within the granted boundary:

- `crates/store/src/identity.rs`
- `crates/store/tests/production_identity_revisions.rs`
- `project/validation/production/tasks/PF-S02-T03/attempt-1/START.md`
- `project/validation/production/tasks/PF-S02-T03/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T03/attempt-1/EVIDENCE.md`
- `project/validation/production/tasks/PF-S02-T03/attempt-1/HANDOFF.md`

The implementation persists project/database/restore/workspace identity and
distinct snapshot/entity/proof/attempt-fence/operation identities. It
performs checked SQLite integer conversions, project/work composite foreign
protection, additive migration/provenance, typed stale/foreign/epoch/fence
details, heartbeat isolation, and restore invalidation without deleting
history. The test exercises the requested real-store positive and rejection
cases.

## Precise coordinator integration request

1. In the coordinator-owned `crates/store/src/lib.rs`, register
   `pub mod identity;`. Do not duplicate or test-mount the module.
2. At the canonical production-open/migration transaction, construct
   `IdentityStore` and call `install(&DatabaseIdentity, now)`. The database
   instance ID must be the durable database-lineage identity and the epoch
   must be the persisted positive restore epoch; do not derive either from
   `project_revision`.
3. Call the non-owning identity mutation methods inside the existing root
   transaction that owns the corresponding canonical row mutation:
   `bind_project`, `advance_entity`, `advance_proof`,
   `record_attempt_fence`, `heartbeat`, `record_operation_context`, and
   `restore`. Do not add a second `BEGIN`, `COMMIT`, or `ROLLBACK` around these
   methods; the identity module intentionally leaves transaction ownership to
   the root/coordinator. Keep operation registration and canonical operation
   row creation in the same transaction, and keep claim/fence registration,
   heartbeat, semantic mutation, and restore invalidation atomic with their
   root rows.
4. Map `IdentityError` into the versioned root/application error registry,
   preserving project isolation (foreign IDs must not be reflected), current
   same-project stale revision details, database instance/restore epoch,
   workspace conflict, revoked fence, and invalidated operation semantics.
5. Re-run the focused target and full locked store package on the actual
   combined tree. The current worker test is already authored against
   `boreal_store::identity`; its present compile failure is solely the missing
   registration.

No schema file or `lib.rs` integration was edited by this worker. The additive
DDL is intentionally owned by `identity.rs` and must be invoked by the
coordinator at the accepted migration boundary. The coordinator should also
review whether each root mutation's existing project snapshot bump should be
returned alongside the identity result, since this leaf does not rewrite the
shared root mutation APIs.

## Validation and limitations

| Check | Result |
| --- | --- |
| Actual focused `cargo test --locked -p boreal-store --test production_identity_revisions` | Exit `101`; expected unresolved `boreal_store::identity` until step 1 above. |
| Actual full `cargo test --locked -p boreal-store` | Exit `101`; same registration limitation. |
| Actual `cargo check --locked -p boreal-store` | Exit `0`; existing migration dead-code warning only. |
| Actual store lib test target | Exit `0`; `0` unit tests. |
| Shadow focused target with temporary `pub mod identity` | Exit `0`; `6 passed, 0 failed`. |
| Shadow full store package with temporary registration | Exit `0`; `98 passed, 0 failed, 1 ignored`; doc-tests `0/0`. |
| Scoped rustfmt, `cargo fmt --all -- --check`, `git diff --check`, contract validator | All exit `0`. |

The shadow workspace was `/private/tmp/pf-s02-t03-compile.0iwlXO`, used only
for compilation/testing and not as combined-tree evidence. The pre-existing
`crates/store/src/lib.rs` modification was preserved byte-for-byte. No service,
native, publication, reviewer, or coordinator acceptance receipt was created.

## Next safe action

The coordinator should apply the five integration steps above in the shared
root, rerun the actual locked focused/full store checks, then send the
combined-tree artifacts through PF-S02-T90 independent review, PF-S02-T91
reconciliation, and PF-S02-T92 revalidation. This handoff is not a task,
sprint, or parent-gate acceptance.

- [x] No test/run/peer/native success was inferred or fabricated.
- [x] Failures and limitations are retained; no secrets were exported.
- [x] All worker-edited paths fit the granted boundary.
- [ ] Shared registration is not yet integrated; coordinator action is required.
- [ ] Coordinator acceptance is not recorded.
