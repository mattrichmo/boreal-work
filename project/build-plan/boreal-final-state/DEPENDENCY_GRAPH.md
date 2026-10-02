# Dependency graph — revision 4

Native task-level edges in BOREAL_TEMPLATE_V4.json and PLAN_CONTEXT.json are authoritative. The milestone and sprint items have empty dependency arrays, because only direct tasks are dependency endpoints. See TASK_INDEX.md for every exact edge.

- S00 qualifies source, recovery and ownership.
- After S00-T90, parallel lanes cover Global recovery (S01), packaging (S02), bounded reads (S04), project contracts (S12-T01), and independent S08 groundwork.
- S12-T01 freezes requirements/acceptance/artifact contracts. S12-T02/T03/T04 run on disjoint modules, T05 joins their public operations, and T06 consumes qualified packaging. S12-T90 integrates the core.
- S05 civil-time work follows Global reads. S13-T01 consumes S05-T01 and S12-T01 for general project dates/waits; it does not wait for the entire Global TUI.
- S13-T02 consumes S12-T05 plus S13-T01 for project TUI/visual work. S13-T03 consumes S12-T90 plus S13-T01 for reusable mixed-work fixtures. They can proceed independently; S13-T90 joins both and T01.
- Existing S03/S06/S07/S08/S09/S10 edges remain. S09 still joins Global and Intake delivery.
- Every S11 release leaf now also requires S13-T90, alongside its previous S09/S10/S12 and within-sprint prerequisites. Final S11-T90 remains reviewed.

Readiness alone is insufficient for dispatch: current file ownership, roles, pinned source and required inputs must also permit execution. Cross-project handoffs use receipts/intake, not illegal cross-project dependency edges. Nested workers inherit their parent task's scope and do not skip graph acceptance.
