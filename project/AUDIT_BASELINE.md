# Long-running orchestration audit: portable baseline

This file preserves the useful evidence when v2 leaves the old checkout. The
source-only audit was generated from `Pasted text(20260914-190106).txt`
(19,636 physical lines, 552,950 bytes, SHA-256
`5c0a72f955e8f6542a90a77f278ca2f19c079f4fa3e27c608af2ab8d1d176609`).
The original report and inventory were provided at
`/Users/cybertron/Downloads/bwrk-audit/` in the development environment.
Those paths are historical provenance, not v2 build inputs.

Visible transcript counts, not a complete process trace:

| Measure | Count |
| --- | ---: |
| Shell command blocks | 1,108 |
| Directly visible CLI command sites | 677 |
| `work show` | 199 |
| `reservation list` | 107 |
| `orchestrate tick` | 82 |
| `orchestrate show` | 78 |
| `lock inspect` | 38 |
| `work list` | 36 |
| Agent-wait entries | 239 |
| Empty wait messages | 238 |
| Context compactions | 6 |

The five status/read families account for 458 visible sites (67.7%). Adding
ticks gives 540 (79.8%). These shares are not time, token, or avoidable-cost
percentages. A closeout episode for LA-05.13 used 94 shell blocks and 42
visible CLI calls, including repeated evidence and verification attempts.
Some response payloads were roughly 190–306 KB. A routine three-agent status
should aim for roughly 2–8 KiB; that is a proposed target to measure, not a
current guarantee.

Observed failure patterns to reproduce before patching:

- Work, reservation, assignment, and agent-session state disagreed.
- Blocked/released work was selected again; operator repair tasks entered the
  product dispatch queue.
- Closeout required repeated syntax discovery, stale evidence repair, and
  wording-dependent observable matching was suspected. The exact predicate
  was not proven by the transcript alone.
- TUI ownership appeared in lock inspection during contention. Process age
  was not proof of one continuous lock hold.
- Health prune/repair exposed historical causal/summary problems without a
  clean supported terminal outcome.
- Frequent status polling and nudges substituted for runtime liveness and
  event notification.
- Pinned CLI/runtime libraries and compatibility digests drifted mid-run.
- Shared dirty worktrees invalidated previously passing test evidence.
- High unit-test counts did not prove a feature was mounted and usable.

Preserve the positive behaviors: live locks were not force-broken, failed
evidence was retained, orphaned work was not falsely closed, and real
dependency edges were corrected after inspecting the critical path.

The audit could not establish exact avoidable token spend, complete worker
activity, per-command wall time, total TUI lock hold, or the root cause of
every silent period. The v2 benchmark must collect those directly.
