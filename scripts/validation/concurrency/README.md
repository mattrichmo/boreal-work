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
