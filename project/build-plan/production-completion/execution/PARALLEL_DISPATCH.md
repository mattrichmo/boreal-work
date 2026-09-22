# Parallel subagent dispatch and integration

For the current wave schedule and stream-specific checklists, start with
[MULTI_AGENT_STREAM_PLAN.md](MULTI_AGENT_STREAM_PLAN.md). This file remains the
normative shared-file and review protocol; the stream plan is its operational
dispatch overlay.

## Eligibility predicate

A task is dispatchable only when its effective dependencies (explicit task prerequisites plus every sprint-entry T92) are accepted, required decisions are approved, external capability and authority are available, its input source is fixed, and its worker/shared-integration write resources are assigned without conflict. `graph-ready` checks only the dependency part. It is deliberately not an authorization system.

One agent receives one task. Named subagents may work in parallel where both dependency and write boundaries allow. Assign a separate independent reviewer; an implementation worker's self-check does not satisfy T90/T92. A review operation executed through Boreal also needs the actual product principal independence specified by the accepted profile.

## Dispatch protocol

The coordinator fills [AGENT_DISPATCH.md](../templates/AGENT_DISPATCH.md), records the lease/attempt in STATE.json, establishes an isolated worktree at the input revision, and supplies the full task/context packet. The agent acknowledges the precise boundary before edits. An unassigned shared integration path is a blocker to final task acceptance, not permission for the worker to edit it.

The worker records tests and submits an exact patch/diff plus handoff. The integration steward applies shared root/schema/registry/manifest changes under its whole-file token, merges the task, runs the combined-tree checks and provides the accepted source identity. Only then can the coordinator accept the leaf. Review may produce new bounded corrective tasks; do not recycle the same task ID as fictional independent work or silently broaden a gate's permissions.

## File conflict rules

Exact same file conflicts. A directory scope conflicts with any file/subdirectory underneath it unless the dispatch explicitly narrows and excludes that path. Two new modules are parallel only if their required `lib.rs`/registry/schema integration is serialized. Two function ranges in one existing file are not separate locks. Read-only shared source access is allowed.

Use `python3 tools/plan.py conflicts PF-Sxx-Tyy PF-Saa-Tbb` to flag conservative overlaps. The helper detects path intersections, not every semantic/schema conflict. Different migrations can still conflict in schema order and different API modules can still violate one contract; the steward must review these.

## Proposed ownership lanes

Contract owns normative rules; domain owns pure predicates; store owns persistence/transaction mechanics; application owns use cases; service owns local runtime/transport; protocol/CLI own versioned thin interfaces; source/memory own citation and publication; workflow owns trusted guidance; TUI owns service presentation; migration owns source-backed transformations; validation owns harnesses/evidence; release owns packaging and authorized distribution. Shared roots/manifests and final merge remain coordinator-managed. Task cards refine the boundary and supersede generic lane breadth.

## Stale bases and failed workers

Rebase/merge onto changed shared contracts only with a new input identity and targeted reruns. A completed test on a preintegration branch does not validate the combined tree. After worker interruption, preserve patches/evidence and verify the process has stopped before handing out the same write resources. Never force-reset a worktree or destroy another agent's changes to recover the schedule.

For product execution tests, resolve task attempt ownership through the supported service and valid recovery operations. Filesystem edit coordination for implementation agents and Boreal runtime leases are distinct mechanisms; neither silently substitutes for the other.

## Review finding loop

T90 records findings. T91 creates bounded remediation children with explicit owners/write sets/dependencies and depends on their accepted completion. Give a new corrective child an unused task ID below T90 and `kind: remediation`. It depends on the accepted T90 review and/or relevant accepted implementation tasks, **not on T91 or T92**. T91 gains the corrective child as a prerequisite. Do not retroactively make the already-produced T90 review depend on that new child: T90 covers its original implementation scope, and T92 verifies the corrections. Otherwise the graph cycles. A failed T92 attempt is context/evidence, not an accepted task prerequisite; use its finding record while preserving the acyclic task graph. T92 runs after the reconciled combined tree is ready. If T92 discovers new defects, preserve its failed attempt, return to reconciliation with new corrective attempts, update the graph and rerun. No hidden pass is manufactured to avoid another cycle.

The coordinator cannot accept all cards merely by changing state strings. Evidence, source identity, prerequisite acceptance and review independence are mandatory. Helper scripts check structure but cannot attest that human observations or claimed runtime receipts are genuine.
