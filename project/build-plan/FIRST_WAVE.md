# First-wave agent dispatch

Use this as the detailed first-wave sheet under the
[master dispatch plan](../../MASTER_PLAN.md) and
[S00 sprint](../../milestones/M01-v2-product/sprints/S00-contracts/SPRINT.md).
Read [the build plan](README.md),
[task index](TASK_INDEX.md), [P0 handoff](verticals/00-contracts-baseline.md),
and [agent handoff template](AGENT_HANDOFF_TEMPLATE.md). These are file-plan
assignments, not live `bwrk` claims. The legacy workspace currently forbids
canonical writes because its installed build/digest differs; do not work
around that with a package upgrade or forced lock operation.

## Parallel discovery and contract work

| Agent | Claim | Exclusive write scope | Deliverable |
| --- | --- | --- | --- |
| Architecture steward | P0-01, then P0-03 | `project/DECISIONS.md`, `project/spec/**` | Owner-reviewed policy choices; conditional status, directive/next-action, transition/schema/protocol/receipt/source-memory fixtures, each versioned and linked to decisions. |
| Legacy mapper | P0-04 | `project/legacy-map/**`, migration-only fixtures | Representative record and workflow parity mapping: keep/rework/defer dispositions for guidance, claim/finish, evidence, handoff, and context; import order, provenance, loss risks. No v1 mutation. |
| Baseline analyst | P0-02 | `project/build-plan/baseline/**` | Repro matrix separating observations from hypotheses; command/process timing and bytes on a pinned fixture when safe; missing measurements explicitly marked. |

Run these in parallel only if paths stay disjoint. The steward must first
resolve decisions that change persisted schema, protocol, completion evidence,
and Git memory authority. A question requiring product-owner approval is
reported as a decision blocker; the agent must not silently pick a default.
The baseline analyst must preserve live locks and the user's current v1 state.
If the legacy toolchain cannot be pinned safely, record the gap and its effect
on later speedup claims rather than altering v1 to obtain a number.

## Integration and independent gate

1. Integration owner merges the three outputs, checks fixture versions and
   cross-references, and records the exact source snapshot. Shared files are
   edited only by the named owner.
2. Independent reviewer claims P0-05 and writes a finding ledger covering
   lifecycle atomicity/fencing, conditional status, trusted agent guidance,
   read/write isolation, receipt semantics, memory publication authority,
   migration, and protocol shape. A clean
   review still records `no_findings`.
3. Architecture steward/integration owner claims P0-06, reconciles every
   finding or records an owner and explicit deferral gate. No finding is
   erased or disguised by narrowing acceptance.
4. A different validator claims P0-07 and reruns schema/protocol/guidance
   fixtures, conditional state-transition examples, migration/parity mapping,
   and affected baseline checks
   on the reconciled source snapshot. A new failure returns to P0-06.

Only after P0-07 passes should the domain/store agents claim P1-01 and P1-03
in parallel. Subsequent dispatch follows the [task graph](TASK_INDEX.md) and
[lane ownership map](README.md#agent-lanes-and-integration-sequence), not a
phase-wide instruction to "build v2".
