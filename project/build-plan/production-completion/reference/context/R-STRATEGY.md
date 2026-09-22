# R-STRATEGY — project/validation/m02/SPRINT_STRATEGY.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/validation/m02/SPRINT_STRATEGY.md:L1–L46`  
**File SHA-256:** `f911117960b0a8074ad58f106a8cb60f83271aed53c5ad008ef963df1ca7379a`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Bounded compatibility strategy and independent-review failure; proposed architecture requires an explicit amendment.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,46p' 'project/validation/m02/SPRINT_STRATEGY.md'
```

## Exact baseline excerpt

````text
    1 | # S00-T05 — fixed-hierarchy compatibility decision candidate
    2 | 
    3 | Date: 2026-09-21. Owner: integration coordinator. Review: pending S00-T07.
    4 | Decision: retain deliberately bounded work-status/2 hierarchy for this source
    5 | candidate. Do not advertise complete work-model/3 or cycle-backed sprints.
    6 | 
    7 | ## Persistence and public compatibility
    8 | 
    9 | `work_item` remains authoritative for milestone -> sprint -> task containment;
   10 | `dependency` retains task-only, close-only sequencing as the target policy.
   11 | `acceptance_profile`, `gate`, `attempt`, `reservation`, `receipt`, `review`,
   12 | `close_intent`, `operation`, `audit_event`, and `work_hold` remain v2 authority.
   13 | No schema version or historical record is rewritten by this candidate.
   14 | The opt-in schema-v3 cycle/assignment groundwork remains present and explicitly
   15 | unfinished: it is not a completed public planning adapter.
   16 | 
   17 | `work create --kind sprint --parent MILESTONE` remains the compatibility path.
   18 | Existing status/work reads remain supported. Sprint create/launch/current/
   19 | status/board/report/close, activation readiness, carry-over, unique live cycle
   20 | assignment and migration are NOT supplied by this decision document.
   21 | 
   22 | ## Target and migration
   23 | 
   24 | A subsequent cycle adapter must persist cycle identity/lifecycle/schedule,
   25 | assignments and one explicit mapping from each legacy sprint work ID. The
   26 | legacy create path must invoke that same Rust application adapter. Dry-run
   27 | export/import must report every unsupported item, including expired attempts,
   28 | failed receipts, rejected review and legacy dependency satisfaction. Never
   29 | convert historical v1 verified/cancelled into closed-only satisfaction.
   30 | 
   31 | Until that adapter is implemented, explicit carry-over is unsupported. Do not
   32 | fake it by assigning duplicate live cycles or silently moving task parents.
   33 | An existing v3 database must not be downgraded or have extension data deleted.
   34 | 
   35 | ## Rollback and follow-up
   36 | 
   37 | This candidate is source-only and makes no database migration; rollback uses
   38 | the prior binary against the unchanged v2 tables, retaining audit history.
   39 | No rollback of an accepted lifecycle operation is implied. A later v3 cutover
   40 | needs backup/export verification, read-only downgrade behavior and a separate
   41 | reversible mapping migration; dropping extension tables is not rollback.
   42 | 
   43 | Proposed follow-up planning checkpoint: 2026-10-05, coordinator plus persistence
   44 | and application stewards. This date is a planning target, not a scheduled task
   45 | or a release promise. S03-T04/S03-T05/S03-T06 and dependent public/release gates
   46 | remain blocking; this bounded decision does not waive the M02 outcome.
````
