# PF-S02-T11 attempt 16 — integration requests

These are follow-ups for the coordinator/reviewer and are not acceptance
claims.

1. Re-export the recovery request/result types and route the new
   `WorkApplication` identity-bound entry points through the versioned service
   API when the protected service steward owns that surface. Do not reintroduce
   project-id-only mutation routes.
2. Keep `released` recovery resolution coupled to canonical reservation
   acknowledgement and the exact attempt/fence evidence. A public façade must
   preserve the current operation/readback identity and replay behavior.
3. Independently review the exact combined source revision before accepting
   PF-S02-T11. The full store suite still needs the separate
   `store_contracts::expiry_and_cancel_are_fenced_and_release_the_reservation`
   fixture remediation identified by PF-S02-T10 `attempt-21R`.
4. Continue the protected-root integration requests for real verifier/evidence
   callers, memory publication, CLI update, and backup. This attempt does not
   claim those production routes are wired.

