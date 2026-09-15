# S00 — Freeze contracts and legacy baseline

Parent: [M01](../../README.md). State: **P0-07 measured pass with approved
deferrals on the current working tree; immutable checkpoint pending**.
Entry: v2 architecture packet exists; no `bwrk` work-record mutation.
Exit: P0-07 passes on the reconciled source snapshot with measured evidence;
portable release/closeout evidence still requires an immutable checkpoint.
Read [STATUS_MODEL.md](../../../../project/STATUS_MODEL.md),
[CLI_COMMANDS.md](../../../../project/CLI_COMMANDS.md), and
[P0 vertical handoff](../../../../project/build-plan/verticals/00-contracts-baseline.md).

## Parallel tasks and ownership

| Task | Prerequisite | Exclusive owner/path | Deliverable and acceptance gate |
| --- | --- | --- | --- |
| P0-01 — policy decisions | None | Architecture steward: `project/DECISIONS.md`, decision fixtures | Resolve host, memory authority, service startup, roles, evidence policy, close-only dependency rule, `queued`/`blocked`, hard 2h budget vs renewable TTL, and close-intent auto-finalization. Name alternatives and request product-owner approval for contested choices. |
| P0-02 — measured legacy baseline | None | Baseline analyst: `project/build-plan/baseline/**` | Reproduce or mark unproven lock, response, expiry, lifecycle, evidence, repair, guide/finish churn; record startup, wait/hold, bytes, timings, validation profile. Preserve live locks and v1 state. |
| P0-04 — migration/parity inventory | None | Legacy mapper: `project/legacy-map/**` | Map statuses, dependency edges, expired reservations, verification/gates, claims, summaries, CLI commands, memory, and Git refs. Every behavior is keep/rework/defer/historical-only with user impact. |
| P0-03 — versioned contracts | P0-01 | Architecture steward: `project/spec/**`; only steward edits shared contract files | Transition table, virtual-clock expiry matrix, schema/protocol/CLI/guide fixtures, gate policy, operation/attempt identity, source/memory manifest, and exact error codes. `queued`, hard block, complete/closed, cancellation, stale receipt, and no-goal cases are executable examples. |

P0-01/02/04 can run simultaneously; P0-03 is now ready after approved
P0-01 policy choices. All task acceptance also follows the exact
[task index](../../../../project/build-plan/TASK_INDEX.md). The integration
owner alone merges fixture/schema versions and records the combined source
snapshot before review.

## Gate chain

| Gate task | Owner and proof | Must happen before |
| --- | --- | --- |
| P0-05 — independent contract review | Reviewer outside author lanes; findings cover status derivation, fenced expiry, proof-gated close, dependency release, memory authority, protocol/CLI, migration. Record `no_findings` if clean. | P0-06 |
| P0-06 — reconcile findings | Steward/integration owner fixes or records approved deferral with owner, changed artifacts, and rerun list. | P0-07 |
| P0-07 — revalidate contracts | Independent validator parses schema/JSON/guidance/CLI fixtures, transition/clock cases, and migration matrix on the reconciled snapshot. | S01/P1-01 and P1-03 |

Do not make P0-05 a direct predecessor of P1. A failing P0-07 returns to
P0-06. No baseline number may be claimed when the corresponding v1 failure
could not be safely reproduced.

## Historical dispatch ledger — coordinator only

The ledger below is preserved from the prior `p0-03.v2` dispatch record. The
current gate-owner disposition that supersedes its status wording follows it.

| Task | State | Agent | Input snapshot | Deadline UTC | Evidence/finding link |
| --- | --- | --- | --- | --- | --- |
| P0-01 | owner choices approved; ready for P0-05 review, not closed | Coordinator | v2 working tree; master `565f6672` | 2026-09-15 00:30 | [decisions](../../../../project/DECISIONS.md) D13–D29 and [policy record](../../../../project/spec/POLICY_DRAFT.md) |
| P0-02 | reported, unmeasured; approved deferral | Luna baseline analyst | v2 working tree; master `565f6672` | follow-up P5 baseline gate | [reproduction matrix](../../../../project/build-plan/baseline/REPRO_MATRIX.md); no invented measurements |
| P0-04 | reported, ambiguities retained; approved deferral | Luna legacy mapper | v2 working tree; master `565f6672` | follow-up migration gate | [record mapping](../../../../project/legacy-map/RECORD_MAPPING.md); explicit dispositions |
| P0-03 | closed after reconciled revalidation | Coordinator with Luna contract lanes | `p0-03.v2`; dirty-path manifest is `project/spec/**` | 2026-09-15 | [fixture entry](../../../../project/spec/README.md), [P0-07](../../../../project/build-plan/P0-07-REVALIDATION.md) |
| P0-05 | findings reviewed and reconciled | Luna Zeno / coordinator integration | `p0-03.v2` | 2026-09-15 | [review](../../../../project/build-plan/P0-05-REVIEW.md) |
| P0-06 | complete; fixed findings and approved deferral R-006 | Coordinator | `p0-03.v2` | 2026-09-15 | [reconciliation](../../../../project/build-plan/P0-06-RECONCILIATION.md) |
| P0-07 | pass with approved deferrals | Coordinator validator | `p0-03.v2` | 2026-09-15 | [revalidation](../../../../project/build-plan/P0-07-REVALIDATION.md) |

The three disjoint first-wave packets were dispatched on 2026-09-14 22:32
UTC using [AGENT_HANDOFF.md](../../../../AGENT_HANDOFF.md). Their reports
do not close the tasks; review and accepted evidence still gate P0-05.

P0-03's first implementation packet was integrated on 2026-09-15 after the
approved P0-01 choices. P0-05 findings were reconciled and P0-07 passed with
the baseline/migration limitations explicitly deferred. P1-01 and P1-03 are
now eligible for disjoint implementation dispatch.

## Current gate-owner disposition (2026-09-15)

Measured checks on the current v2 working tree passed: contract fixture
validation, workflow validator tests, `cargo test --workspace`, and the
temporary-copy `scripts/standalone-check.sh` (including Rust formatting,
locked offline tests, clippy, TUI typecheck, and mounted TUI tests). This is
not a v1 performance or migration-parity result. The current source set is
content-identified but untracked in the containing repository, so the result
is not an immutable checkpoint.

| Gate | Current state | Exact blocker / next action |
| --- | --- | --- |
| P0-02 | `unmeasured`; approved deferral retained | Obtain a pinned disposable v1 executable/configuration/fixture, capture timing/bytes/lock/retry receipts, and classify each matrix row. |
| P0-03 | fixture set validated on current working tree | Checkpoint the v2 package and bind the fixture/source digests to that revision. |
| P0-05 | current checks found no new automated contract failure; independent historical review retained | Rerun/record independent review against the immutable checkpoint if the checkpoint changes the reviewed source set. |
| P0-06 | reconciled with R-006 and R-007 explicitly deferred | Preserve unmeasured/operator-review labels; rerun P0-07 after checkpoint. |
| P0-07 | `PASS WITH APPROVED DEFERRALS` for current working tree | Does not authorize release or complete parity claims until the checkpoint/rerun and pinned-v1 follow-up are complete. |

P1 implementation may be inspected against the measured current tests, but no
implementation or release closeout should cite this working-tree evidence as
immutable until the repo integrator completes the checkpoint and reruns the
affected validation set.
