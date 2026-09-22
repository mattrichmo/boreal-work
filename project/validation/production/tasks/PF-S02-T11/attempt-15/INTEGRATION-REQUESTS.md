# PF-S02-T11 — attempt 15 integration requests

These are protected follow-ups, not acceptance claims and not changes made by
this attempt.

1. **Status adapter compile blocker**

   Reconcile `crates/application/src/status.rs:291` with the current
   `StatusContext` contract by supplying `activation_at` and `schedule` from
   the canonical store/application projection. Keep status/2 mapping and
   schedule semantics authoritative in the shared decision contract. Do not
   weaken the domain fields or fill them from fabricated dashboard data.

2. **Replay-race caller adoption**

   Every canonical verifier/evidence caller must use
   `ExternalEffectAcquisition::Won` as the only callback authorization. It
   must not infer ownership from a `running` label, replay flag, or stale read.
   Add service-level operation/readback coverage after the caller is wired.

3. **Identity-bound recovery and resource acknowledgement**

   Wire the application/service recovery paths to identity-bound durable
   recovery obligations, resource release requests, acknowledgements, and
   live-resource readback. Terminal expiry/stop/fail/cancel paths must retain
   unresolved recovery until explicit acknowledgement; do not weaken resource
   uniqueness.

4. **Canonical verifier and evidence admission**

   Register the actual verifier/evidence execution route through the durable
   external-job seam before the process starts. Persist operation, subject,
   source/configuration identity, and request digest. Interrupted work remains
   pending/readback-required and receipts are admitted only after attributable
   readback.

5. **Memory publication, update, and backup**

   Connect the existing monolithic memory publication route, CLI update route,
   and future backup route to registered durable jobs with operation replay,
   attributable artifact/content identity, and readback. Do not create a
   disconnected memory module or report success after an interrupted external
   effect.

6. **Required combined validation**

   After the protected integration is complete, rerun the focused external-job
   tests, full application and CLI suites, store boundary/integration suites,
   formatting, contract validation, and the genuine service-level operation
   readback/isolation cases. Preserve any failed or unavailable result as
   evidence rather than converting this bounded handoff into acceptance.
