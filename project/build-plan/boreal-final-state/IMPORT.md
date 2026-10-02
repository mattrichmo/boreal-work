# Adopt plan revision 3 safely

The active source artifact is `project/build-plan/boreal-final-state/BOREAL_TEMPLATE_V3.json`. It uses Boreal's existing **work-template schema 1**, template ID `boreal-final-state-v3`, version 3. It contains one milestone, 13 sprint items and 81 required task items: **95 work items**. Three preserved optional S10 cards are outside the required import.

The original V1/V2 artifacts remain unchanged. Unlike their original container dependencies, V3 represents sequencing only through direct task edges; milestone/sprint dependency arrays are empty. See TEMPLATE_IMPORT_ADJUSTMENTS.md for the historical `dependency_requires_direct_tasks` rejection.

## Fresh project only

First run the plan checker:

```sh
python3 project/build-plan/boreal-final-state/validate_plan.py
```

Then use the installed binary's help and existing template validation/dry-run path; the supported command family recorded in the prior plan is:

```sh
bwrk template validate --project PROJECT   --input project/build-plan/boreal-final-state/BOREAL_TEMPLATE_V3.json --json
bwrk template run --project PROJECT   --input project/build-plan/boreal-final-state/BOREAL_TEMPLATE_V3.json   --dry-run --json
```

Use a fresh prefix/project. Read the current revision through a canonical revision-bearing read before an explicitly authorized apply:

```sh
bwrk template run --project PROJECT   --input project/build-plan/boreal-final-state/BOREAL_TEMPLATE_V3.json   --apply --prefix boreal-final --expected-revision REVISION --yes --json
```

PROJECT and REVISION are placeholders, not executable values. Verify installed help rather than assuming historical syntax. The plan checker is not the application validator. A template import is not proof that work is published, claimed, accepted or ready.

## Existing `boreal-final-*` project

**Do not run the full template with the existing prefix, replace its database, delete/recreate tasks, or mark work done to make the graph match.** `PLAN_UPGRADE_V3.json` is a review manifest, not a new supported `bwrk` command/input format.

1. Read the actual project's logical/physical identity, revision, current work/edges, active attempts, evidence and gate state. Save an application-supported recovery point. Freeze dispatch for affected planning records while their amendment is applied.
2. Compare that state with the V3 manifest. Preserve all existing IDs. Add only `s12` and `s12-t01` through `s12-t06` plus `s12-t90` under the existing milestone; use actual stored IDs derived from the existing prefix.
3. Apply reviewed title/context/dependency changes with supported revision-bound planning APIs. Do not weaken dispatch/acceptance/role policies. Handle active or accepted work through explicit amendment/supersession policy; otherwise stop with the unsupported mutation identified. Never bypass it with SQL.
4. Record S10-T04/T05/T06 as outside this release through the supported audited disposition/scope path, retaining historical IDs, attempts and evidence. They are not accepted outcomes. If the installed container model cannot exclude them safely, keep that as a named planning gap for S12-T02 before claiming the milestone can close.
5. Read back the entire affected graph. Verify task-only edges, no duplicates/cycles/orphans, preserved history and the new S11 prerequisites. Only then resume dispatch. Store actual revision/operation receipts; Git commit IDs are not application receipts.

S00-T05 remains the existing bounded recovery repair. This revision does not recover/resolve its attempts, reassign its active file grants, publish the milestone or modify the user's local TUI state.
