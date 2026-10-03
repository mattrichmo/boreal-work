# P5 early concurrency validation probe

This probe is a reproducible, dependency-light baseline for the current
SQLite/application lifecycle slice. It seeds a new temporary v2 SQLite
database, starts 1, 3, 10, 30, or 50 synthetic logical workers, and has each
worker run `claim -> accept -> start -> release` through
`WorkApplication`/`SqliteAttemptAdapter`. Each run uses unique work items and
deletes its database after completion.

The `--tui on` parameter adds one status-reader thread that repeatedly calls
the application-backed project status projection while lifecycle mutations
run. It is an application status sampler, not the TypeScript TUI and not a
second OS process.

Run the full matrix from this directory with:

```sh
python3 run_matrix.py
```

Use `--iterations N` to change the number of workflows per logical worker.
The default is five. The checked-in result is written to
`results/latest.json`; the result includes the exact source, binary, schema,
compiler, fixture, and host identity needed to decide whether two runs are
comparable.

## Metric definitions

- `p50/p95/max_queue_ms`: time from the common release barrier until each
  mutation call is entered. This is a harness arrival/scheduling measure, not
  SQLite's internal lock queue.
- `max_in_flight_logical_workers`: largest number of lifecycle calls observed
  concurrently by the harness.
- `p50/p95/max_hold_ms`: wall time of each application mutation call. It is a
  transaction/lock-duration proxy and includes SQLite lock wait.
- `throughput_*`: successful mutation or complete-workflow count divided by
  the measured matrix-run wall time.

The current store does not expose SQLite lock-wait and lock-hold timestamps,
so this probe deliberately does not label the call proxy as an exact lock
measurement. Workers are Rust threads sharing one process and one fresh DB;
the result records `os_processes: 1`. It is not evidence for multi-process
fairness, crash recovery, TUI rendering, source/memory throughput, or release
capacity.

## Bounded read-only dispatch-admission smoke

Run the dispatch-admission smoke against a built CLI with:

```sh
python3 production_host.py --bin ../../../../target/debug/bwrk
```

This compatibility mode runs only the bounded 1-worker/2-capacity dispatch
smoke. It writes `results/dispatch-admission-smoke.latest.json` and keeps
`dispatch_smoke_status` separate from the overall V10 status.

The script starts the real `bwrk service run` process and uses separate CLI
client processes over its Unix socket. The normal request batch consists of
read-only `work show` calls. Its fixed dispatch configuration is **1 worker
and queue capacity 2**; the service defaults are 4 workers and capacity 32.
This deliberately small setup is only for a bounded admission smoke and does
not represent production load or capacity.

Before sending the control `status` request, the harness waits briefly for an
externally visible dispatch-full response while normal client processes are
active. It records the response's actual CLI error code and message. Current
CLI behavior can be `protocol_mismatch` with an `application dispatch queue
is full ...` message; the smoke does not describe that as a typed
`service_busy` CLI response. It also records when the control request starts
and finishes, its latency, the number of normal clients active at each point,
and how many normal client intervals overlapped it. No latency target is
asserted, and the service does not expose queue-depth counters to this
harness.

The smoke passes only when a dispatch-full message was observed before the
control request, normal clients were active when it started, the control
response succeeded, and normal clients remained active when the control
response arrived. These are admission and overlap assertions only; the result
makes no throughput, fairness, scale, soak, or broad performance claim. The
JSON report is written to `results/dispatch-admission-smoke.latest.json`.

`fake_clock.status` is explicitly `pass`, `fail`, or `unavailable`. On a
non-Darwin host it is `unavailable`, and that does not fail the narrow smoke.
When available, the optional probe checks only expiry display projection in
the temporary project after creating and claiming a disposable task. This
write is outside the normal read-only saturation batch. `service_stop_observation` records SIGTERM
exit/socket removal as a supplemental observation; neither optional result
determines smoke status.

## Bounded stop and durable-readback probe

Run the full-mode evidence set with:

```sh
python3 production_host.py --full-v10 --bin ../../../../target/debug/bwrk
```

This mode runs the dispatch smoke and adds `stop_recovery`, a separate bounded
process-level probe. It starts the service with its normal 4-worker/32-capacity
defaults, then drives 32 independent `bwrk` client processes through repeated
status and work-show requests. While those requests are active, it submits one
uniquely identified work-create mutation, sends SIGTERM, waits for the service
to exit, and starts the service again against the same temporary SQLite
database. It then reads the exact operation result and exact created work ID
through public service routes. The report preserves client progress before
SIGTERM, queue-full errors, active-client count, service exit/socket cleanup,
mutation envelope, exact operation result subject, and post-restart readback.

The full-mode report is written to `results/forensic-v10.latest.json`. The
current probe does not create or enroll an Agent credential. The environment
owner has not supplied an authorized Agent credential, so the attempt
stop/recovery subprobe reports `unavailable`; it does not invent an Agent or
run an ordinary task as Operator. The service-drain and completed work-create
readback remain supplemental observations and cannot make the V10
`stop_recovery` component pass. A future authorized attempt probe must read
back the same attempt ID and fence in `expiry_pending`, its unresolved
recovery obligation, active resource reservation, and a rejection for an old
fence after restart. It must also record clean SIGTERM and post-restart
service-stop results. The report treats an unavailable Agent fixture as
`unavailable`; an exercised Agent path that contradicts an assertion is a
`fail`.

Typed `service_busy` behavior is reported independently under
`v10_acceptance.components.typed_control`; a `protocol_mismatch` response
with a queue-full message remains distinct. The harness never retries an
ambiguous write until operation readback after restart; it reuses the same
operation ID only when that readback says the operation is not found. Any such
retry is excluded from the original post-restart acceptance proof.

The bounded status/work-show mix and one mutation are not a capacity benchmark
or soak. They do not prove an Agent attempt stop/recovery, durable deadline
reconciliation, or an approved control-latency result. This evidence does not
change `v10_acceptance.status`, which stays `not_established` until every V10
requirement has separate evidence.

If the environment denies Unix socket/process startup, the script emits a
`BOREAL_VALIDATION_SKIP` marker and a machine-readable `smoke_status` of
`unavailable`; the fake-clock status is also reported as `unavailable` because
the service-side probe could not run.

The full-mode top-level `smoke_status` stays `partial` unless every V10
component is actually complete; the narrow admission assertions are reported
separately as `dispatch_smoke_status`. `v10_acceptance` is a machine-readable
object with component status/completeness, the exact latency-budget source and
status, and run/source/binary identity. The full-mode stdout summary includes
`mode`, `run_id`, and SHA256 of the exact report bytes. The report identity
repeats that `run_id`; consumers must compare both values and verify the hash
against the report file. `full_load.approved_profile` remains explicitly
`not_approved`; observed worker count, dispatch capacity, completion progress,
measured workload duration, per-worker success gaps, and zero-progress workers
are evidence only, with no inferred threshold.
`typed_control` records measured latency and whether it is within any supplied
candidate target, while `control_latency_budget.status` remains
`not_approved`. A queue-full response with `protocol_mismatch` is
reported as a typed-control `fail`; an exact `service_busy` response remains
incomplete until an independently approved latency budget exists. Missing
durable reconciliation evidence is `unavailable` while there is no authorized
Agent attempt fixture, and becomes `fail` only after that attempt path runs
and contradicts an assertion. The absent approved full-load profile is
`not_approved`. Only the full-mode object can establish V10, and it exits
nonzero while any required component is incomplete. The compatibility smoke
retains its narrow pass/fail exit behavior and never declares V10 complete.
