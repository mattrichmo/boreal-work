# Boreal local-core completion — active plan revision 3

**Plan:** `BW-final-state-2026-10-01` · **existing milestone key:** `milestone` / example runtime ID `boreal-final-milestone`.

The V3 scope is **13 sprints, 81 required tasks and one milestone**. Three original conditional S10 task IDs remain preserved outside the required release. This updates the existing plan; it does not reset work or create a competing execution graph.

Start with [MASTER_PLAN.md](MASTER_PLAN.md) and [WORKFLOW_CONTRACT.md](WORKFLOW_CONTRACT.md). Use [TASK_INDEX.md](TASK_INDEX.md), [PLAN_CONTEXT.json](PLAN_CONTEXT.json) and the individual task cards for dispatch. [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) explains the changed sequence.

The active fresh-import artifact is [BOREAL_TEMPLATE_V3.json](BOREAL_TEMPLATE_V3.json), still using the supported **work-template schema 1**. [IMPORT.md](IMPORT.md) distinguishes fresh import from safe amendment of an already-imported project. Do not replay a template over live attempts.

[PLAN_CHANGE_002.md](PLAN_CHANGE_002.md) records the scope and evidence; [PLAN_UPGRADE_V3.json](PLAN_UPGRADE_V3.json) is a review delta, not executable `bwrk` input. `BOREAL_TEMPLATE.json`, `BOREAL_TEMPLATE_V2.json` and `PLAN_CHANGE_001.md` remain historical sources. The older `CURRENT_STATE.md` / `SOURCE_BASELINE.md` inventories remain dated evidence; S00 must qualify the actual dispatched head and local changes.

[DEFERRED.md](DEFERRED.md) owns exclusions. [INTERFACE_ROADMAP.md](INTERFACE_ROADMAP.md) defines the bounded MCP/remote successor without making it a local release blocker. [V1_PARITY.md](V1_PARITY.md) keeps useful v1 and historical production requirements visible.

Run `python3 project/build-plan/boreal-final-state/validate_plan.py` to check plan consistency. This validates planning artifacts, **not** product behavior or a live Boreal database.

Current cross-sprint sequencing and ownership amendment: [execution/REVISION_V3.md](execution/REVISION_V3.md). Existing ownership records remain binding; the current task graph supersedes historical wave prose.
