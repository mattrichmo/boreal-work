# Single-leaf agent handoff template

Copy this for one assignment. Do not hand one agent an entire phase without
the specific task IDs, prerequisites, and write boundaries.

```md
Task ID and title:
Parent phase:
Outcome for user/agent:
Legacy behavior retained/reworked/deferred and parity fixture:
Owned paths:
Excluded paths and behavior:
Prerequisite task IDs and accepted artifact revisions:
Relevant vertical handoff and architecture links:
Inputs/fixtures/source snapshot:
Domain/protocol/schema versions:
Implementation steps or investigation question:
Observable acceptance and required evidence:
Conditional status/eligibility and directive/next-action impact:
Focused tests:
Integration tests and benchmark slice:
Failure injection / negative cases:
Migration and compatibility impact:
Review owner and findings-reconciliation task ID:
Revalidation task ID and phase advancement gate:
```

## Execution rules

- Read the v2 root `AGENTS.md`, the [project packet](../README.md), the
  matching [vertical handoff](verticals/), and [TASK_INDEX.md](TASK_INDEX.md)
  before changing code.
- Respect the assigned write set. Ask the integration owner to coordinate a
  shared schema/protocol file; do not race another vertical to edit it.
- Use operation IDs and source/attempt revisions in tests. Preserve failed
  evidence and historical attempts.
- Do not hold a transaction across a child process, Git call, source parser,
  TUI rendering, network tool, model call, or wait.
- If the same failure repeats twice, change the diagnostic hypothesis or
  report the blocker. Do not produce a burst of identical lock/status probes.
- When a result is uncertain, read it back by operation ID before retrying.
- Distinguish the implementation's test result from its source snapshot and
  validation profile. A passing focused check is not full release evidence.

## Agent completion response

Report the reproduced trigger, changed files, implemented invariant,
schema/protocol/migration changes, focused and integration test results,
measurement before/after if performance related, review findings and their
disposition, remaining limitations, and the next ready dependent task.
For a no-change investigation, provide the evidence that led to that result.
