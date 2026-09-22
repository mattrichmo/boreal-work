# PF-S02-T11 — attempt 14 protected integration requests

These requests remain outside the attempt-14 write lease. They are not
acceptance claims and must be applied by the relevant protected-root steward
on the combined tree.

1. **Replay-race API adoption**

   Keep `ExternalEffectAcquisition::Won` as the sole callback authorization.
   Any canonical caller that invokes `ExternalEffectAdapter::execute` must use
   the new acquisition semantics and must not independently infer ownership
   from a `running` label, a replay flag, or a stale read. Add service-level
   operation/readback coverage after the caller is wired.

2. **Recovery identity/readback and resource acknowledgement**

   Add identity-bound store seams for recovery obligations,
   `request_resource_release`, `acknowledge_resource_release`, and live-resource
   reads, or expose an equivalent operation/audit-bound adapter. Wire the
   application and service callers to construct `AttemptRecoveryAdapter` with
   identity, preserve operation/request-digest identity, and read back
   expiry/stop/fail/cancel recovery before reporting release or expiry as
   resolved. Do not downgrade a canonical project to project-id-only methods.

3. **Canonical lifecycle reservation failure**

   Investigate the protected claim/release path exercised by
   `crates/application/tests/p2_guided_flow.rs:106`. The full application suite
   previously failed on the
   `boreal_resource_reservation(project_id, resource_key)` uniqueness
   constraint while claiming a distinct work item. Reconcile resource-key
   derivation and release acknowledgement; do not weaken the constraint or
   hide the failure.

4. **Verifier and evidence admission**

   Wrap actual verifier/evidence execution routes in the identity-bound
   `ExternalEffectAdapter` before the process starts. Persist operation,
   subject, source/configuration identity, and request digest. Interrupted
   effects remain readback-required; receipts are admitted only after genuine,
   attributable readback. The adapter must not synthesize a receipt.

5. **Memory publication**

   The memory crate is currently a monolithic `crates/memory/src/lib.rs`; no
   disconnected `publisher.rs` module should be added. Connect existing
   publication and readback paths from the protected application knowledge
   route to a registered `memory_publication` durable job, preserving the Git
   journal and requiring operation/content/manifest readback.

6. **CLI update**

   In the protected CLI command root, resolve project/database/actor identity
   and request digest before invoking `update::run`. Supply a real durable-job
   port, register/start before invoking the installer, and resolve interrupted
   installs by original operation readback.

7. **Backup**

   When the protected maintenance route is introduced, use the same admission,
   pending/readback, attributable artifact digest, and operation replay
   contract with `kind = backup`.

8. **Combined-tree compile blocker**

   Reconcile `crates/store/src/status_evaluation.rs:146` with the current
   `StatusContext` fields `activation_at` and `schedule`. The coordinator or
   protected store/decision-engine steward owns this path. Once fixed, rerun
   the blocked application, CLI, store, and full-format checks from
   `COMMANDS.md` without changing this attempt's recorded failure.
