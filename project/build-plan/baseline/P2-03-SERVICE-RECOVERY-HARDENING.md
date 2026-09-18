# P2-03 service/recovery hardening evidence

Input source: `be173b2e` plus the service-only changes in this working tree.
This is scoped service evidence, not a release gate or a claim that the full
workspace is currently green.

## Implemented service boundary

- `TimerRegistry` replaces blind maintenance sleeping with keyed deadlines,
  replacement/cancellation, exact-once due delivery, and wake-on-shutdown.
  `ServiceHostHooks::on_deadlines` is only a wake-up notification; the
  application hook remains responsible for the durable reaper transaction.
- `OperationControl` records cancel/stop intent separately from confirmed
  termination. Repeated identical requests are stable, conflicting requests
  are rejected, and an uncertain stop remains unknown until explicitly
  confirmed.
- Durable recovery entries can carry an opaque run/process-start/artifact
  reference. `RecoveryBackend::reconcile` defaults to unknown and may return a
  known terminal result only when the application adapter has durably observed
  it. In-flight work is never blindly replayed or reassigned.
- Concurrent dispatch uses a bounded control lane for status, heartbeat,
  renewal, release, cancel, stop, and operation readback. A bounded control
  burst prevents normal work starvation; queue saturation remains typed busy.
- Project election continues to bind ownership to canonical project identity,
  not socket spelling, and retains advisory lock files rather than deleting a
  live lock path.

## Focused validation

Command:

```text
cargo test -p boreal-service --offline
```

Result: **41 tests passed**, including:

- queued/in-flight recovery, durable execution-reference reconciliation, and
  unknown preservation;
- timer replacement, cancellation, deadline callback delivery, and prompt
  shutdown wake-up;
- explicit stop request versus confirmation and uncertain-stop handling;
- bounded control/normal priority dispatch with one worker, queue saturation,
  and normal-work eventual progress;
- two service endpoints against one canonical project election;
- duplicate/reordered notification fixtures already owned by the service
  notification module;
- concurrent slow-handler responsiveness and typed busy responses.

Command:

```text
cargo clippy -p boreal-service --all-targets --offline -- -D warnings
```

Result: passed.

`rustfmt --edition 2021` was run on the changed service files and
`git diff --check -- crates/service` passed. A repository-wide `cargo test
--workspace --offline` was attempted but remains blocked by unrelated
pre-existing application changes outside this write boundary (`hierarchy.rs`,
`planning_v3.rs`, and related modules); those errors are recorded in the
orchestrator handoff and were not weakened here.

## Fault and platform limits

The service tests cover admission, queued, in-flight, known terminal,
unknown-after-restart, duplicate request, control cancellation, deadline and
election states. They do not claim a power-loss result for a real SQLite
transaction because the service crate intentionally does not own storage.

Descendant process cleanup is likewise not asserted here: the production
executor/process-group adapter lives outside `crates/service`, and this host
does not provide a cross-platform Windows process-tree runtime. The service
now exposes explicit stop intent/confirmation hooks so that executor owners
can report `confirmed` or `unknown`; it never converts a request into a false
cleanup success. A follow-up executor test must spawn a process group,
interrupt/cancel it, verify descendants are reaped on each supported OS, and
only then call `confirm_stopped`.

Independent child-agent reviews for restart/election and queue/stop were
requested but could not be launched because the current tool session does not
expose the multi-agent dispatcher. The host-level tests above are therefore
coordinator-run, not independent review evidence.
