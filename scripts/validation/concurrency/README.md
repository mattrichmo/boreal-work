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

If the environment denies Unix socket/process startup, the script emits a
`BOREAL_VALIDATION_SKIP` marker and a machine-readable `smoke_status` of
`unavailable`; the fake-clock status is also reported as `unavailable` because
the service-side probe could not run.

This is partial dispatch-admission evidence, **not V10 acceptance**. It does
not establish durable deadline reconciliation or restart recovery, full
normal-load worker/queue behavior, typed `service_busy` CLI behavior, a
preapproved control-latency budget, or stop/recovery behavior during a full
workload. The forensic audit records the smoke as a separate subresult and
keeps full V10 acceptance blocked; acceptance requires separate supporting
evidence beyond this smoke.
