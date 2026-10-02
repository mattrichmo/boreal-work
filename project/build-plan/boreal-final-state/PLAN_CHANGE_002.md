# Plan change 002 — Complete workflows without expanding into a platform

**Plan:** BW-final-state-2026-10-01 · **revision:** 3 · **date:** 2026-10-02  
**Reviewed source:** `1a32762ab53385a9ac485f850617d956484019d8`.

## Reason

The user asked to revise the existing GitHub milestone/sprints/tasks for the strongest feature/workflow end state, while questioning unnecessary layering and future environment/plugin friction. This is a plan amendment, not a code implementation, live runtime migration or assertion of a green product.

The current plan is strong on Global semantics and recovery but gives inherited Project workflows mostly regression treatment. `project/INTERFACES.md` already requires one typed API and executable guidance. Historical production-completion F1-F5 require ordinary-agent onboarding, usable planning/Intake/publish, changed-result binding before proof, canonical review readback and durable cited handoffs. `PLAN_CHANGE_001.md` records a real advertised-but-uncallable recovery route. V3 makes those complete user journeys explicit and assigns deltas without reopening old task graphs.

## Changes

- Retain the logical milestone/task keys; rename the milestone to **Boreal local-core completion and agent-ready workflows**.
- Add **BW-S12**, six focused leaves plus its T90: capability contract; planning/Intake/amendment; execution/review/recovery; durable knowledge/handoff; typed client/skill parity; headless/isolated environment qualification. Existing code that meets a requirement is retained.
- Add **WORKFLOW_CONTRACT.md**, J01-J18, with owners and observable final outcomes; extend existing Global/Send/qualification tasks rather than creating a task for every edge case.
- Start S08 receipt/restore groundwork after S00, with S12-T01 supplying its interface contract. S09 still waits for S07 and S08. S05-T05 and S07-T05 consume the new contract/parity handoffs. S11 additionally waits for S12-T90.
- Move S10-T04/T05/T06 outside the required V3 template; preserve cards/IDs as deferred work. Their absence cannot excuse a failing mandatory performance budget.
- Keep V1/V2 templates immutable. Create V3 in the existing supported schema with task-only dependency edges, synchronized context/index/cards, and a plan consistency checker. `PLAN_UPGRADE_V3.json` describes a reviewed change set, not an executable application migration.
- Preserve local-first, Rust authority, Global/Project separation, atomic provenance/Send, recovery, supported-platform limits and one T90 per sprint. Full MCP/remote delivery remains a concrete separate successor, not another hidden release requirement.

**Counts:** V2 had 77 task cards / 12 sprints / 1 milestone. V3 requires 81 tasks / 13 sprints / 1 milestone = 95 imported items, with 3 original deferred cards retained outside the active import. Net required-task change: +7 -3 = +4. No historical task ID is deleted.

## Evidence and limits

Reads covered the committed plan, template/context/task graph, contributor rules, interface/security contracts and historical production workflow requirements. The supplied original pack's template and S01-S11 subtrees were verified against repository Git object hashes; V2 template bytes were also verified against blob `1ad7bfed8d303008f144218371ae4a29f830cf20` before amendment. No product build, runtime migration, native-install test or access to a Dabble/ChatGPT environment is implied by this planning review.

S00 still qualifies the actual dispatched code/dirty tree. The older CURRENT_STATE/SOURCE_BASELINE inventories and earlier tests are dated evidence, not a current pass. Current execution status remains in Boreal. Existing imported work adopts V3 through IMPORT.md; these GitHub commits do not alter local task state, grants or attempts.

Additional consistency correction: the live V2 S00-T90 task card omitted T05 from its prerequisite header even though the V2 template and sprint table included it. V3 aligns the header; it does not alter the already-approved recovery dependency.

## Plan validation performed

The dependency-free plan checker passed the amended local artifacts: 13 sprints, 81 required tasks, 95 imported items, 3 deferred task contexts and 18 journey definitions. Ten injected invalid variants were rejected: duplicate JSON keys, duplicate work keys, container dependencies, a dependency cycle, omitted integration coverage, context count drift, task-card dependency drift, historical template mutation, a missing required journey and an optional task inserted into the required import. These are planning-artifact checks only; no product build/test, live import or runtime mutation was performed.
