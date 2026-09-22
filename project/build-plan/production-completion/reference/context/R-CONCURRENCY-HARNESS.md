# R-CONCURRENCY-HARNESS — scripts/validation/concurrency/README.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/validation/concurrency/README.md:L1–L64`  
**File SHA-256:** `0a77eea31b9bd92cdc5676c9e1706161f72842d0e1d4de6a3e3956245a200e3f`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing native concurrency scenarios and limitations; distinguish production host from synthetic generator.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,64p' 'scripts/validation/concurrency/README.md'
```

## Exact baseline excerpt

````text
    1 | # P5 early concurrency validation probe
    2 | 
    3 | This probe is a reproducible, dependency-light baseline for the current
    4 | SQLite/application lifecycle slice. It seeds a new temporary v2 SQLite
    5 | database, starts 1, 3, 10, 30, or 50 synthetic logical workers, and has each
    6 | worker run `claim -> accept -> start -> release` through
    7 | `WorkApplication`/`SqliteAttemptAdapter`. Each run uses unique work items and
    8 | deletes its database after completion.
    9 | 
   10 | The `--tui on` parameter adds one status-reader thread that repeatedly calls
   11 | the application-backed project status projection while lifecycle mutations
   12 | run. It is an application status sampler, not the TypeScript TUI and not a
   13 | second OS process.
   14 | 
   15 | Run the full matrix from this directory with:
   16 | 
   17 | ```sh
   18 | python3 run_matrix.py
   19 | ```
   20 | 
   21 | Use `--iterations N` to change the number of workflows per logical worker.
   22 | The default is five. The checked-in result is written to
   23 | `results/latest.json`; the result includes the exact source, binary, schema,
   24 | compiler, fixture, and host identity needed to decide whether two runs are
   25 | comparable.
   26 | 
   27 | ## Metric definitions
   28 | 
   29 | - `p50/p95/max_queue_ms`: time from the common release barrier until each
   30 |   mutation call is entered. This is a harness arrival/scheduling measure, not
   31 |   SQLite's internal lock queue.
   32 | - `max_in_flight_logical_workers`: largest number of lifecycle calls observed
   33 |   concurrently by the harness.
   34 | - `p50/p95/max_hold_ms`: wall time of each application mutation call. It is a
   35 |   transaction/lock-duration proxy and includes SQLite lock wait.
   36 | - `throughput_*`: successful mutation or complete-workflow count divided by
   37 |   the measured matrix-run wall time.
   38 | 
   39 | The current store does not expose SQLite lock-wait and lock-hold timestamps,
   40 | so this probe deliberately does not label the call proxy as an exact lock
   41 | measurement. Workers are Rust threads sharing one process and one fresh DB;
   42 | the result records `os_processes: 1`. It is not evidence for multi-process
   43 | fairness, crash recovery, TUI rendering, source/memory throughput, or release
   44 | capacity.
   45 | 
   46 | ## C4-B production-host evidence
   47 | 
   48 | Run the V10 production-composition probe with:
   49 | 
   50 | ```sh
   51 | python3 production_host.py --bin ../../../../target/debug/bwrk
   52 | ```
   53 | 
   54 | The probe starts `bwrk service run`, drives separate `bwrk` clients through
   55 | the Unix socket, records typed `service_busy` results while normal work fills
   56 | the bounded dispatch lanes, measures a control `status` response, advances an
   57 | optional macOS realtime-clock interposer for expiry projection, and verifies
   58 | SIGTERM/socket cleanup. The result is written to
   59 | `results/production-host.latest.json`.
   60 | 
   61 | The fake-clock component is intentionally optional: non-macOS hosts retain an
   62 | explicit unavailable result. The production host currently has no durable
   63 | deadline-reconciliation proof exposed through its CLI, so the report does not
   64 | claim that missing gate.
````
