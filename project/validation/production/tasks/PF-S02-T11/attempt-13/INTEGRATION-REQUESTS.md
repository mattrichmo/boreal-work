# PF-S02-T11 — attempt 13 integration requests

These are required protected-root follow-ups, not acceptance claims.

1. **Recovery identity/readback and resource acknowledgement**

   Add identity-bound store APIs for `recovery_obligation`,
   `request_resource_release`, `acknowledge_resource_release`, and the
   corresponding live-resource reads, or have the protected steward expose an
   equivalent operation/audit-bound adapter. Then wire
   `crates/application/src/lib.rs` and its `sqlite_adapter.rs`/service callers
   to construct `AttemptRecoveryAdapter::new_with_identity`, use operation and
   request-digest identity, and read back expiry/stop/fail/cancel recovery
   before reporting release or expiry as resolved. The current
   `runtime.rs:363–439` adapter cannot safely claim this integration from the
   project-id-only store methods.

2. **Canonical lifecycle reservation failure**

   Investigate the protected claim/release path exercised by
   `crates/application/tests/p2_guided_flow.rs:106`; the full application suite
   fails on `boreal_resource_reservation(project_id, resource_key)` uniqueness
   while claiming a distinct work item. Reconcile resource-key derivation and
   release acknowledgement in the store/application steward. Do not weaken
   the unique constraint or hide the failure in this task.

3. **Verifier and evidence admission**

   Wrap the actual verifier/evidence execution routes in the identity-bound
   `ExternalEffectAdapter` before the process starts. The protected routes are
   the CLI evidence handlers and service evidence path identified by the prior
   T11 handoff. Persist the operation, subject, source/configuration identity,
   and request digest; map interrupted effects to readback-required; admit a
   receipt only after genuine attributable readback.

4. **Memory publication**

   The current memory crate is a monolithic `crates/memory/src/lib.rs`; there
   is no valid `crates/memory/src/publisher.rs`. Connect the existing
   `Publisher::publish`/`publish_with_expected_base` and
   `publication_readback` paths from the protected application knowledge route
   to `kind = memory_publication` only after the durable job is registered.
   Preserve the Git journal and require operation/content/manifest readback;
   do not create a disconnected module.

5. **CLI update**

   In the protected CLI command root, resolve project/database/actor identity
   and operation digest before invoking `update::run`. Supply a real
   `UpdateJobPort` backed by the canonical durable job store, then invoke the
   installer only after registration/start and resolve interrupted installs by
   readback. The worker adapter in `crates/cli/src/update.rs` remains
   intentionally unregistered until that caller integration exists.

6. **Backup**

   No backup adapter call site is currently present in the granted tree. When
   the protected maintenance route is introduced, use the same admission,
   pending/readback, attributable artifact digest, and operation replay
   contract with `kind = backup`.
