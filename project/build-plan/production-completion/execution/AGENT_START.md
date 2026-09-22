# Agent startup: mandatory task context

You have one task ID, not an entire sprint. Your task is complete only when its bounded outcome is integrated and accepted with required evidence. This plan is not authority to change production data or publish.

## Load in this order

Read the repository's current `AGENTS.md`, applicable directory instructions, this plan README, your sprint file and your complete task card. Read the actual source/archive identity in the dispatch record. Read every accepted prerequisite handoff and relevant contract named by `project/spec/production/contract-manifest.json` after PF-S01; if absent, stop that implementation scope.

Load each task reference excerpt and then the current full enclosing functions/types/tests. Exact baseline paths, lines and hashes are supplied as navigation, not an instruction to blindly patch old line numbers. Compare current source to upstream handoffs and inherited findings. Read the original M02/report where linked, keeping candidate claims unaccepted until proven.

Before editing, report the interpreted invariant, intended change, actual writer paths, expected shared integration requests and verification strategy. Resolve contradictions through the coordinator. Do not choose whichever fixture makes the implementation easiest. The architecture proposal is not permission to change D22/D27 or cycle policy without the required decision.

## Confirm before work

- [ ] Task prerequisites and sprint-entry gates are accepted, not merely implemented.
- [ ] Input source revision/digest, workspace/project identity and allowed paths are exact.
- [ ] A named reviewer is independent of implementation; required external tools/platforms exist or acceptance is explicitly blocked.
- [ ] Whole-file write leases are disjoint from other workers; shared-file integration owner is known.
- [ ] Existing versus proposed files/tests are understood; new modules will actually be registered and invoked.
- [ ] Public/API/schema/security changes have an accepted contract; publication and live-data operations have separate authority.

## Work rules

Capture the baseline behavior/failed check first where practical. Implement the minimal coherent change satisfying the task; add focused positive, negative, boundary and regression coverage. Run appropriate existing checks, then the actual integration layer required by the task. Never claim a test ran because you wrote it. Keep failing logs and describe unavailable tools precisely.

Successful service proof comes from the built Rust service and genuine attributable execution. Fixtures and mocked controllers may test pure rules/rendering, not full lifecycle/release acceptance. Do not normalize an invalid service payload in the harness to make a client test pass.

Use one evidence attempt directory per run. Record exact argv, cwd, source/binary identity, tool versions, timestamps, exit codes, raw responses and readback. No secrets belong in handoffs or logs. Do not reset/discard another worker's changes, force-break a live lock, edit shared files without ownership, or overwrite failed evidence.

## Finish or stop

Submit the complete [handoff](../templates/TASK_HANDOFF.md), patches/integration requests, acceptance evidence and remaining risks. "Ready for review" is distinct from accepted. On blocked input, unexpected scope or failed safety invariant, preserve the work and file a finding/change request. On uncertain external operation result, read back the original operation; do not invent success or run a new operation ID blindly.

If you are reassigned after interruption, first read the prior attempt's state and confirm its process/worktree ownership is safely resolved. A missing heartbeat does not authorize concurrent writers.
