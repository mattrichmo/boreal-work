# PF-S02-T07 attempt-7 integration requests

These requests are source-bound follow-ups, not acceptance claims.

1. **CLI finish/close owner — `crates/cli/src/main.rs:5897`.** Replace the
   direct operation-only append with the authenticated project/epoch-bound
   root journal transaction. Preserve the parent close subject, request
   digest, rejected outcome, and unknown/readback behavior; do not acknowledge
   a close parent operation without its audit record.
2. **CLI service owner — `crates/cli/src/service.rs:2566`.** Route
   `agent_start` through the same identity-bound admission and terminal
   operation/audit boundary. Preserve pending/unknown restart recovery and
   exact replay without launching a second start effect.
3. **Application knowledge owner.** Exercise the application source-capture
   adapter against a bound production store and verify it reports canonical
   store registration as committed/replayed, while an unbound canonical
   project remains fail-closed. Keep source-catalog capture and SQLite
   registration distinct so `StoreRegistrationPending` is not relabeled as a
   committed canonical write.
4. **Schema/protocol owner.** Register a versioned source-specific audit event
   if source events need first-class vocabulary. Until that contract is
   accepted, retain the bounded `repair.correction` attribution used here;
   do not silently invent an unsupported event type.
5. **Coordinator/reviewer.** Re-run combined service/application evidence for
   unknown delivery, restart readback, rejected registration, wrong project,
   changed actor, changed digest, and audit-failure rollback on the exact
   integrated tree. Keep this attempt's application compile blocker visible.
