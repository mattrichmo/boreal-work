# R-GATES — project/build-plan/REVIEW_GATES.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/build-plan/REVIEW_GATES.md:L1–L73`  
**File SHA-256:** `273eb835390114032b79ebbe296767d16ad8a68ce4db40991ff2083e8679a3a3`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Separate independent review, findings reconciliation and exact-tree revalidation.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,73p' 'project/build-plan/REVIEW_GATES.md'
```

## Exact baseline excerpt

````text
    1 | # Reviews, findings, reconciliation, and advancement gates
    2 | 
    3 | This plan uses the granular planning mode. Each phase review or validation can
    4 | produce findings. A finding-producing step is never the final prerequisite
    5 | for the next phase: review/check -> reconcile findings and update artifacts ->
    6 | revalidate -> advance. A pass with no findings still has an explicit
    7 | `no_findings` disposition. A revalidation failure returns to reconciliation
    8 | and reruns affected checks; it does not advance the phase.
    9 | 
   10 | ## Finding record
   11 | 
   12 | Every review, critique, fault test, migration probe, benchmark, or security
   13 | check records:
   14 | 
   15 | ```text
   16 | finding_id
   17 | source_task_id and inspected artifact/source revision
   18 | severity: blocker | major | minor | observation
   19 | behavior and reproduction
   20 | affected invariant / user outcome
   21 | disposition: fixed | no_change | deferred
   22 | owner and follow-up task for deferrals
   23 | changed code/schema/protocol/docs/work records
   24 | checks to rerun
   25 | ```
   26 | 
   27 | Do not narrow acceptance criteria, erase failed evidence, or call a scoped
   28 | check a full release pass to make a gate green. If a finding lies outside the
   29 | current leaf, create explicit follow-up work and a dependency if it blocks
   30 | safe advancement.
   31 | 
   32 | ## Phase gates
   33 | 
   34 | | Phase | Finding producer | Reconciliation | Revalidation | Advances to |
   35 | | --- | --- | --- | --- | --- |
   36 | | P0 contracts | P0-05 | P0-06 | P0-07 | P1 implementation |
   37 | | P1 domain/store | P1-07 | P1-08 | P1-09 | P2 runtime |
   38 | | P2 runtime/protocol | P2-07 | P2-08 | P2-09 | P3 memory and P4 API client |
   39 | | P3 source/memory | P3-07 | P3-08 | P3-09 | P4 migration and release integration |
   40 | | P4 UI/migration | P4-07 | P4-08 | P4-09 | P5 load/release checks |
   41 | | P5 release | P5-05 | P5-06 | P5-07 | P5-08 cutover decision |
   42 | 
   43 | The integration owner verifies that all leaf acceptance evidence is linked,
   44 | the phase reviewer is independent of the implementation where practical,
   45 | and the revalidation uses the updated artifact/source snapshot. Before
   46 | advancement the owner records `pass`, `blocked`, or `approved_deferral` with
   47 | the exact reasons and owners. Integrity/security blockers cannot be approved
   48 | away by changing a UI label or test fixture.
   49 | 
   50 | ## Required phase evidence
   51 | 
   52 | - **P0:** frozen decisions, conditional state transition table, schema/JSON/
   53 |   guidance fixtures, v1 failure/baseline and workflow-parity matrix,
   54 |   migration inventory, review disposition.
   55 | - **P1:** domain/property tests, schema constraints, transaction/crash tests,
   56 |   read snapshot and count checks, review disposition.
   57 | - **P2:** competing claimers, duplicate operations, stale attempt fencing,
   58 |   service restart, compact status, manual adoption, trusted directive/next
   59 |   action fixtures, no-goal multi-harness claim/evidence/finish transcripts,
   60 |   and review disposition.
   61 | - **P3:** source/version citations, parser failure retention, Git publication
   62 |   recovery, fresh-clone import, stable doctor/repair, review disposition.
   63 | - **P4:** mounted TUI action checks, core canonical workflow and v1 parity
   64 |   matrix, actual no-goal create/finish/handoff walkthrough, dry-run import,
   65 |   clean install/update/rollback, docs commands, review disposition.
   66 | - **P5:** measured concurrency and calls-per-useful-transition, fault matrix,
   67 |   security boundaries, full suite, no-goal workflow parity, supported-platform
   68 |   and standalone-checkout proof, final disposition.
   69 | 
   70 | The legacy `bwrk doctor --strict` is not a v2 release gate. V2 needs its own
   71 | doctor once implemented. The unhealthy legacy workspace is used only through
   72 | read-only fixtures until its toolchain is reconciled by an explicitly scoped
   73 | legacy maintenance task.
````
