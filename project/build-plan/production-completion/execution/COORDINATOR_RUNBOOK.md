# Coordinator execution runbook

## Before first dispatch

Fingerprint the actual baseline and preserve the archive. Read all scope/decision/external-input registers. Create an integration branch/worktree without discarding existing changes. Inventory compiler/runtime/native target availability, actual independent reviewers, original legacy records and supported agent harnesses. Fill only known fields in STATE.json; unknowns remain explicit.

Run `python3 tools/plan.py validate` from the plan folder. Review `graph-ready`; initially assign PF-S00-T01 and PF-S00-T02 independently where write boundaries permit. No production migration, release publish or service operation is authorized by this planning artifact.

## Per-task dispatch loop

Read the card and all prerequisite handoffs; confirm accepted source identity and current contract version. Establish the write set, shared integration token plan, reviewer and required evidence layer. Fill a dispatch record, mark the task assigned and hand it to one worker. Keep an actual lease record and active paths in state; do not imply every graph-ready task is running.

Inspect incoming handoffs against source diff and raw evidence. Integrate through shared stewards, run affected combined-tree checks, and record acceptance or rejection with reasons. Only accepted prerequisites unlock successors. Avoid demanding unrelated whole-project end-to-end tests for a pure contract task, but do not allow a pure unit test to replace a lifecycle/release gate.

## Per-sprint gate loop

Wait for all leaves (and added remediation dependencies). Assign T90 to an independent reviewer. T91 may begin when the review is accepted as a complete review artifact, even if it reports defects; sprint advancement remains blocked. Record every finding's severity and resolution. Accept T91 only after required corrections are integrated. Run T92 independently on the exact combined tree. Update downstream allowed entry only after the accepted gate exists.

## Change control

Add a plan version and bounded task IDs for unexpected work; preserve original IDs and attempts. Revalidate the DAG and source/context links. Update acceptance/finding/M02 mappings and affected task packets. Any recommendation rejected during PF-S01 must update later task requirements—not leave contradictory cards for workers to guess between. A contract amendment that invalidates already accepted work triggers impact review and explicit revalidation tasks; it does not silently erase historical acceptance records.

## Evidence triage

Missing tool/platform/input: block the required acceptance and assign acquisition/remediation if in scope. Baseline failure: retain it and determine whether the task changes/depends on it; do not bury a required failure as unrelated. Flaky result: preserve each run and diagnose; repeated retries without cause are not reliable qualification. Unknown mutation: read back original operation and authoritative state. Secret exposure: quarantine/redact exported evidence and use the security incident procedure, without deleting underlying required audit history.

## Final release control

Freeze source/contract and build identities, qualify the actual package on native targets, complete the independent audit and cutover decision. Obtain actual publication authority separately. Publish only qualified immutable bytes, read back published hashes, run clean installation/update smoke from the real channels, and hand over support/rollback ownership. A change after qualification requires impact-based reruns; never change bytes behind an already-qualified version.
