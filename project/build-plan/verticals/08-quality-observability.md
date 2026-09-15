# Vertical 08 — instrumentation, tests, and measured throughput

Task IDs: P0-02, P1-07–P1-09, P2-07–P2-09, P3-07–P3-09, P5-01, P5-02,
P5-04–P5-07. Read the [delivery plan](../../DELIVERY_PLAN.md),
[audit baseline](../../AUDIT_BASELINE.md), and
[review gates](../REVIEW_GATES.md).

## Outcome and ownership

The team can demonstrate whether v2 improves useful work throughput without
skipping required checks or hiding failures. Observability explains each slow
operation and each attempt's delay. This vertical owns benchmark and fault
injection harnesses, test fixtures, metric definitions, CI test orchestration,
and reports. It does not alter domain transitions merely to improve a chart.

## Prerequisites

P0-02 begins immediately against a pinned legacy fixture. Phase reviews begin
after their implementation leaves. Full load testing requires P4-09. A legacy
toolchain mismatch is reported as a baseline limitation, not repaired by an
ad hoc package upgrade mid-run.

## Metric contract

For every command/operation capture: operation ID, start/end, client startup,
compatibility check, service queue wait, database hold, read snapshot time,
projection/index time, serialization time, output bytes, retry count, affected
subjects, changed-state flag, and error class.

For every attempt capture: eligible-at, claimed-at, accepted-at, first
checkpoint, implementation-complete-at, verification-complete-at,
closed-at, reservation-released-at, plus time classified as human pause,
runtime/provider pause, tool execution, model execution, or lock blockage.

Measure calls per useful transition, unchanged status/guidance reads, time
from no-goal entry to accepted work, verification to
closure delay, available capacity to acceptance delay, orphan attempts,
duplicate summaries, blocked redispatch, WAL size/checkpoint age, and
TUI-on/TUI-off throughput. Do not infer lock hold from process age.

## Build steps

1. Implement a fixed synthetic/fixture workload and a manifest recording
   source snapshot, commands, expected validation, environment, and seed.
2. Establish v1 baseline at 1/3/10/30/50 agents where safe. Record failures
   and missing data rather than replacing them with estimates.
3. Add v2 metrics at the service, store, CLI, source job, and Git publisher
   boundaries with bounded cardinality and no secret/raw-output leakage.
4. Add fault injection at every transactional boundary: before/after attempt
   creation, acceptance, receipt, finish, lease replacement, blob publication,
   memory commit, and DB acknowledgement. Reorder/duplicate notifications.
5. Run the same workload with v2 and compare latency distributions and useful
   verified transitions. Keep validation profile and source identity equal.
6. Add a mounted-action test for each TUI feature and a clean-install command
   smoke. Unit tests alone do not prove the feature is reachable.
7. Run the same no-goal conditional workflow through two harness entry points
   and the packaged CLI/API: route/context, claim/resume, evidence and all
   required gate kinds, finish/release, handoff, and recovery. Count useful
   transitions and model-mediated coordination calls; do not call a shorter
   path faster if it skipped a required obligation.

## Acceptance and failures

- Benchmark reports p50/p95/max queue wait and transaction hold separately;
  throughput claims use identical workload and validation coverage.
- Routine status bytes stay bounded as history reaches 10,000 attempts; a
  truncated payload is explicit, never parsed as an empty success.
- A healthy unchanged runtime does not generate repeated model-mediated
  status bursts before its next event/timer.
- Guidance has the same effective status and gate obligations across CLI,
  API, and TUI. It stays bounded at 10,000 historical attempts, and an
  unfamiliar agent can make progress without a bespoke parent prompt.
- All crash/reorder tests preserve one current attempt, one current session
  execution, and no live reservation on a closed task.
- The test suite names sandbox/network limitations separately from product
  regressions. An ignored failure has owner, reason, and expiry.

Each finding-producing review or validation records findings; P3-08 is the
memory finding-reconciliation leaf, alongside the corresponding P0/P1/P2/P4
reconciliation leaves. P5-06 reconciles release findings; each phase's
revalidation leaf reruns affected checks. The handoff
includes raw metric files, analysis script, source manifest, commands,
fixtures, and an explicit limitations section.
