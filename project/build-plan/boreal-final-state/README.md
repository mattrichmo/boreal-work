# Boreal final-state plan pack

This pack turns the multi-round Global Manager audit/design discussion into a **current-state → finished-product execution plan** aligned with Boreal's own planning model.

## Contents

- `MASTER_PLAN.md` — destination architecture and dependency waves.
- `TASK_INDEX.md` — every task and prerequisite.
- `sprints/BW-Sxx/SPRINT.md` — sprint goal, parallel lanes and sprint-level validation.
- `sprints/BW-Sxx/tasks/*.md` — bounded agent assignments with context and write boundaries.
- `execution/` — multi-agent dispatch/write ownership.
- `.boreal/templates/boreal-final-state-v1.json` — **supported Boreal work-template v1 import**.
- `IMPORT.md` — exact dry-run/apply instructions.
- `DECISIONS.md` / `DEFERRED.md` — settled architecture and intentionally excluded scope.

## Shape

- 1 milestone
- 12 sprints
- 76 tasks including one integration/test close task per sprint

The plan is deliberately lighter on per-task gates than Boreal's historical production-completion packet. Most automated/manual validation is concentrated in each sprint's `T90`; tasks carry a local check only when a downstream task consumes that interface before sprint close.

## Baseline

Generated from source analysis at `main@6ab1c078150993936d5d381822e7774d9e5cfade`. Re-read current source when dispatching; this plan is a delta from that baseline, not a replacement application design.

Start with [IMPORT.md](IMPORT.md) if loading the work graph into Boreal, or [MASTER_PLAN.md](MASTER_PLAN.md) for the product/build sequence.
