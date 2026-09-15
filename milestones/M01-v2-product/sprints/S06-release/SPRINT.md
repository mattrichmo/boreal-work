# S06 — Concurrency, fault, security, standalone cutover

Parent: [M01](../../README.md). State: **queued on P4-09**.
Entry: S05 P4-09 accepted on a packaged combined source snapshot.
Exit: P5-08 records an explicit cutover decision. Read
[quality/observability](../../../../project/build-plan/verticals/08-quality-observability.md),
[security boundaries](../../../../project/build-plan/verticals/10-security-boundaries.md),
[packaging/cutover](../../../../project/build-plan/verticals/09-packaging-cutover.md),
and [audit traceability](../../../../project/build-plan/AUDIT_TRACEABILITY.md).

## Task graph and parallel validation lanes

| Task | Prerequisite | Owner/write set | Observable deliverable and gate |
| --- | --- | --- | --- |
| P5-01 — concurrency benchmark | P4-09 | Performance validator: benchmark fixtures/results only | Same workload and validation at 1/3/10/30/50 agents, TUI on/off; p50/p95/max queue wait and DB hold, throughput, unchanged reads, calls per useful transition, bytes, baseline limitations. |
| P5-02 — crash/clock/reorder matrix | P4-09 | Fault validator: fault fixtures/results only | Crash at each attempt/source/Git stage; duplicate/reordered events, restart, stale fence, exact TTL/hard-budget deadline, renewal/finish/expiry races, live unresponsive worker in shared worktree. |
| P5-03 — security/resource review | P4-09 | Security validator: review fixtures/results only | Socket permissions, project paths, source URLs, memory scope, blobs/result refs, Git worktree, bounded execution/output, no untrusted text as trusted directive. |
| P5-04 — full integration/compatibility | P5-01/02/03 | Integration owner/test runner | CLI/TUI/API/importer/doctor/package and no-goal agent loop pass on supported platforms; every receipt identifies source/config/toolchain/registry identity. |
| P5-05 — independent release critique | P5-04 | Independent reviewer | Correctness, performance, migration, self-guiding parity, status/expiry/accountability, usability findings, including explicit `no_findings` if clean. |
| P5-06 — reconcile release findings | P5-05 | Relevant module owners coordinated by integration owner | Fix, no-change, or approved deferral with owner/follow-up/impact; update implementation, fixtures, and rerun list. |
| P5-07 — release revalidation | P5-06 | Independent validator | Affected plus full checks rerun on reconciled candidate; critical integrity/security/core guidance gaps block cutover. |
| P5-08 — standalone extraction/cutover decision | P5-07 | Release owner | Copy/build v2 outside legacy checkout, rehearse import/rollback, publish supported and approved-deferred behavior, measurements and known limits, then decide ship/conditional/no-ship. |

P5-01/02/03 may run in parallel on the same frozen candidate with disjoint
result paths. They do not silently patch production code to make a test pass;
findings go to the responsible owner and P5-06. If one lane changes the
candidate, rerun all affected measurements against the same final snapshot.

## Hard exit gates

- Three or more concurrent workers finish verified tasks while the TUI
  remains responsive; no UI refresh monopolizes the writer and no live lock
  is force-broken.
- One current fenced attempt per task and one current execution per session;
  an expired/uncertain worker cannot write or be blindly replaced. A two-hour
  limit shows review on time even if the timer loop is late.
- `queued` downstream tasks become ready only when their accepted prerequisite
  policy passes; hard-blocked/operator-only/paused work never becomes
  automatic because an unrelated upstream task closed.
- Equivalent human prose cannot change structured gate outcome; wrong
  subject/snapshot/attestation/command/observable and failed receipts remain
  distinct and inspectable. Closeout is idempotent and one summary is current.
- An unfamiliar agent from any supported harness can begin with no bespoke
  goal, follow `guide`/`next`, claim, prove, finish, and receive successor
  context through version-matched CLI/API/TUI.
- Fresh external checkout builds and passes release checks; migration and
  rollback are rehearsed without overwriting legacy data.

These are release requirements, not goals to optimize away. If validation
quality changes, performance numbers are not comparable. P5-05 findings
must pass P5-06 and P5-07 before P5-08 can decide cutover.

## Dispatch ledger — coordinator only

| Task | State | Agent | Input snapshot | Deadline UTC | Evidence/finding link |
| --- | --- | --- | --- | --- | --- |
| P5-01 | queued on P4-09 | — | — | — | — |
| P5-02 | early matrix passed; P4-09 prerequisite open | Locke (Luna) | Current tested P2 slice; not a release candidate | [fault evidence](../../../../project/build-plan/baseline/P5-02-FAULT-CLOCK-REORDER.md); 12/12 deterministic cells pass, with production fault-injection and full release gaps recorded |
| P5-03 | early boundary probe passed; P4-09 prerequisite open | Coordinator | Current tested P2 slice; not a release candidate | [security probe](../../../../docs/SECURITY.md); 17/17 elevated checks pass, including absolute Unix-socket paths, traversal/scope, framing, argv, and output bounds; formal release review remains open |

P5-08 is a decision, not permission to delete the legacy app or its data.
