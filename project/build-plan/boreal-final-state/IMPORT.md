# Adopt plan revision 4 safely

The active file is `BOREAL_TEMPLATE_V4.json`, template ID `boreal-final-state-v4`, version 4, **work-template schema 1**. It contains one milestone, 14 sprints and 85 required tasks, exactly **100 work items**, within the current 1–100 atomic batch limit. Three historical S10 optional tasks remain deferred outside the import. V1–V3 artifacts are immutable history.

## Fresh project

Run `python3 project/build-plan/boreal-final-state/validate_plan.py`, then inspect the installed `bwrk template` help and use supported validate/dry-run/apply operations with the active file, an explicit authorized project/prefix, actor/session and freshly read expected revision. Never use invented syntax or runtime IDs. Do not split a too-large template silently; this one fits the current bound. Verify application-level validation independently from the plan checker.

A fresh import creates draft planning records. It does not restore another project's history or publish/claim/accept work. A cloud container is an execution host, not automatic authority to another project's database.

## Existing V3 project, including the current isolated cloud project

Do not replay the full template with the existing prefix, replace a database, delete/recreate tasks or manufacture completion. `PLAN_UPGRADE_V4.json` is a review manifest, not a supported CLI input.

1. Safely pause new affected dispatch. Read logical/physical project identity, project revision, existing work/edges, attempts, publications, acceptance pins and active file grants. Preserve setup work and an application-supported recovery point.
2. Compare exact V3 state with the delta. Add only the new `s13`, `s13-t01`, `s13-t02`, `s13-t03`, `s13-t90` records under the actual existing milestone, preserving its prefix and IDs. These are plan keys, not guessed runtime IDs.
3. Apply title/context and dependency changes using supported revision-bound planning APIs, with one operation identity per intentional action and read-back after uncertainty. S12 requirement amendments and all S11 added prerequisites must be explicit; old proof cannot silently satisfy changed acceptance.
4. If any affected work is active, published or accepted, use the existing supported amendment/supersession/reopen policy. If the required operation is unavailable, report that exact planning gap to the coordinator; repair it within the existing authorized bootstrap/planning scope before applying. No direct SQL fallback or wholesale reimport.
5. Preserve deferred S10-T04/T05/T06 and any existing attempts/evidence; scope exclusion is not acceptance. S00-T05's role and write grant remain unchanged.
6. Read back every affected task, dependency, requirement revision and count. Verify no orphans/cycles/duplicates, preserved history and S11 joins. Verify the active runtime graph is V4 before resuming claims; a Git commit or successful plan validator is not a runtime adoption receipt.

The orchestrator must report actual operation/revision evidence and any unsupported amendment. Resume only after adoption and ownership reconciliation are confirmed. Repository publication/merge permissions remain those separately granted by the user; this planning file cannot expand them.
