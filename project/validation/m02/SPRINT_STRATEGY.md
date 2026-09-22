# S00-T05 — fixed-hierarchy compatibility decision candidate

Date: 2026-09-21. Owner: integration coordinator. Review: pending S00-T07.
Decision: retain deliberately bounded work-status/2 hierarchy for this source
candidate. Do not advertise complete work-model/3 or cycle-backed sprints.

## Persistence and public compatibility

`work_item` remains authoritative for milestone -> sprint -> task containment;
`dependency` retains task-only, close-only sequencing as the target policy.
`acceptance_profile`, `gate`, `attempt`, `reservation`, `receipt`, `review`,
`close_intent`, `operation`, `audit_event`, and `work_hold` remain v2 authority.
No schema version or historical record is rewritten by this candidate.
The opt-in schema-v3 cycle/assignment groundwork remains present and explicitly
unfinished: it is not a completed public planning adapter.

`work create --kind sprint --parent MILESTONE` remains the compatibility path.
Existing status/work reads remain supported. Sprint create/launch/current/
status/board/report/close, activation readiness, carry-over, unique live cycle
assignment and migration are NOT supplied by this decision document.

## Target and migration

A subsequent cycle adapter must persist cycle identity/lifecycle/schedule,
assignments and one explicit mapping from each legacy sprint work ID. The
legacy create path must invoke that same Rust application adapter. Dry-run
export/import must report every unsupported item, including expired attempts,
failed receipts, rejected review and legacy dependency satisfaction. Never
convert historical v1 verified/cancelled into closed-only satisfaction.

Until that adapter is implemented, explicit carry-over is unsupported. Do not
fake it by assigning duplicate live cycles or silently moving task parents.
An existing v3 database must not be downgraded or have extension data deleted.

## Rollback and follow-up

This candidate is source-only and makes no database migration; rollback uses
the prior binary against the unchanged v2 tables, retaining audit history.
No rollback of an accepted lifecycle operation is implied. A later v3 cutover
needs backup/export verification, read-only downgrade behavior and a separate
reversible mapping migration; dropping extension tables is not rollback.

Proposed follow-up planning checkpoint: 2026-10-05, coordinator plus persistence
and application stewards. This date is a planning target, not a scheduled task
or a release promise. S03-T04/S03-T05/S03-T06 and dependent public/release gates
remain blocking; this bounded decision does not waive the M02 outcome.
