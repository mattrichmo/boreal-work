# P5-02 fault/clock/reorder evidence

Status: **early matrix passed** (12/12 cells); this is not a release gate.

Run identity: `p5-02-early-965c3759c`
Workspace: `sha256:4fc7a987f25005072fc78d6eddc8ba5a49704160dcdd2fd02e78b886743ca267`
Tool command profile: `cargo test --locked --offline`, named tests, sequential execution.

## Cells

| Cell | Family | Result | Harness | Evidence |
| --- | --- | --- | --- | --- |
| `lease.default_two_hour_budget` | lease_hard_deadline | pass | `rust_test` | AttemptPolicy default hard deadline is immutable and separate from the lease. |
| `lease.hard_deadline_blocks_heartbeat` | lease_hard_deadline | pass | `rust_test` | Controlled clock proves hard deadline wins and heartbeat is rejected. |
| `lease.expiry_requires_fenced_stop` | lease_hard_deadline | pass | `rust_test` | Expired attempts require explicit confirmation and retain fenced recovery. |
| `fence.stale_revision_fence_owner` | stale_fence | pass | `rust_test` | Stale revision/fence and wrong-owner mutations fail without writes. |
| `fence.stale_receipt_retained` | stale_fence | pass | `rust_test` | Receipt subject/fence failure is retained as an immutable historical fact. |
| `replay.operation_and_lifecycle` | duplicate_replay | pass | `rust_test` | Duplicate operation identity replays the committed lifecycle result. |
| `notifications.duplicate_revision_coalesced` | duplicate_reorder_notifications | pass | `rust_test` | Duplicate revision publication is coalesced and subjects are unioned. |
| `notifications.old_cursor_resnapshot` | duplicate_reorder_notifications | pass | `rust_test` | A cursor that fell behind the bounded log requests one resnapshot. |
| `notifications.out_of_order_rejected` | duplicate_reorder_notifications | pass | `rust_fixture` | Out-of-order revision publication is rejected by the public service API. |
| `restart.operation_recovery` | restart_recovery | pass | `rust_test` | Restart marks in-flight operations unknown and preserves queued work. |
| `restart.host_rebind_recovery` | restart_recovery | pass | `rust_test` | Service host rebinds its endpoint and reports in-flight recovery. |
| `bounded.guided_flow_recovery` | bounded_fault_outcomes | pass | `rust_test` | Bounded three-harness flow records expiry, fenced replacement, and service recovery. |

## Explicit gaps

- No production fault injector or virtual-clock runner exists; exact expiry is covered only through controlled-clock Rust tests.
- The reorder cell validates the public NotificationHub contract in a local fixture, not a real delayed/reordered socket notification stream.
- No OS/process crash is injected during a committed write; host/recovery behavior is exercised by deterministic service tests only.
- No multi-process clock-skew, network/socket drop, queue saturation, or randomized/property-based fault matrix is covered.
- Full P5 independent review, release/cutover evidence, and broader P3/P4 acceptance remain outside this early harness.

The matrix is deterministic in fixture inputs and test selection. Wall-clock
timestamps in the JSON are provenance only. A pass demonstrates the named
contract under the current source/dependency identity; it does not establish
fault injection, OS/process crash recovery, clock skew, notification transport
reordering, concurrency budgets, or complete P5 acceptance.
