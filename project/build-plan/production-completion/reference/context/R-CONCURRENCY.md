# R-CONCURRENCY — project/STATE_AND_CONCURRENCY.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/STATE_AND_CONCURRENCY.md:L1–L91`  
**File SHA-256:** `e5173bb3dd187d27756ab797a8f5bf9c561e98ff08b5801d956d2924878c1a65`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Snapshot revisions, transactional ownership, bounded writers, readback and retained history.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,91p' 'project/STATE_AND_CONCURRENCY.md'
```

## Exact baseline excerpt

````text
    1 | # Canonical state, concurrency, and recovery
    2 | 
    3 | ## Canonical local store
    4 | 
    5 | Use one SQLite database in WAL mode for work items, dependencies, attempts,
    6 | reservations, operational memory, source-intake versions, memory publication
    7 | jobs/indexes, operation identities, and audit events. Published curated memory
    8 | is versioned in Git, as described in [MEMORY_BANK.md](MEMORY_BANK.md). Put
    9 | large immutable source content and command output in a
   10 | content-addressed blob directory. The database records their digest, size,
   11 | media type, provenance, and availability. A referenced blob is not published
   12 | until it has been safely written and verified; unreferenced blobs can be
   13 | garbage-collected after a grace period.
   14 | 
   15 | The database is authoritative for live operations and pending memory work.
   16 | Git is authoritative for published curated memory at a named Git revision.
   17 | An optional work-state export is a portable checkpoint at a named database
   18 | revision. Neither Git role coordinates concurrent claims.
   19 | 
   20 | ## Writer path
   21 | 
   22 | 1. Parse and validate a command before entering the writer queue.
   23 | 2. Perform slow source parsing, test execution, or external calls before
   24 |    requesting a write. Capture their immutable inputs and results.
   25 | 3. Enqueue a bounded command with operation ID, actor, expected revision when
   26 |    applicable, and attempt fence when applicable.
   27 | 4. In one short transaction: read current rows, recheck invariants, apply the
   28 |    change, append its audit event, advance project revision, and persist the
   29 |    idempotent result.
   30 | 5. Commit, release the connection, publish the new revision, and schedule
   31 |    derived-index/export work outside the critical section.
   32 | 
   33 | The service orders writers fairly within one workspace and returns a typed
   34 | busy/backpressure response with retry guidance when the queue is full. A
   35 | timeout never implies that an unknown mutation failed: clients resolve the
   36 | operation ID by readback before retrying. SQLite's own busy handling remains a
   37 | last defense, not the primary scheduler. Track queue wait and database hold
   38 | separately.
   39 | 
   40 | ## Reader path
   41 | 
   42 | Status, task detail, dashboard, and TUI refresh use read-only connections and
   43 | short read transactions. A response materializes the needed rows at one
   44 | project revision, closes the transaction, then serializes. No UI, subprocess,
   45 | network, or model wait occurs while a read transaction remains open.
   46 | 
   47 | Some statuses change because time passes, without a new database write.
   48 | Every read model therefore includes `as_of` and `next_status_change_at` as
   49 | well as project revision. At or after a lease/hard-budget deadline, reads and
   50 | claims treat the old attempt as expiry-pending even if the timer worker has
   51 | not committed its audit event. The service schedules that short
   52 | reconciliation write separately; a UI refresh does not become its owner.
   53 | See [STATUS_MODEL.md](STATUS_MODEL.md).
   54 | 
   55 | Use indexed, bounded queries. Calculate full totals separately from the row
   56 | limit. The `Now` view must not load all work to display ten rows. Expensive
   57 | rollups may be versioned projections; their source revision and lag must be
   58 | returned, and a request for current state must either compute it from the
   59 | canonical store or report it unavailable, not silently serve an old rollup.
   60 | 
   61 | ## Integrity and recovery
   62 | 
   63 | - Database constraints enforce one current attempt per task, unique current
   64 |   session execution, valid references, and idempotent operation IDs.
   65 | - Domain rules enforce legal transitions, parent hierarchy, graph acyclicity,
   66 |   dispatch eligibility, and closeout policy. They are rechecked in the write
   67 |   transaction.
   68 | - Lease expiry or cancellation increments a fencing generation. Old attempts
   69 |   may remain in history but cannot mutate current work.
   70 | - Audit history is append-only. Repairs write explicit correction/supersession
   71 |   events and keep failed evidence.
   72 | - Background projection, search, and Git export jobs read a committed revision,
   73 |   calculate outside the write transaction, and publish only if their input
   74 |   revision still matches. Retries are idempotent.
   75 | - Health checks distinguish current corruption, recoverable index lag,
   76 |   retention warnings, and historical migration findings. Running a supported
   77 |   repair twice should be a no-op on the second run.
   78 | - Backups use a consistent SQLite snapshot and include referenced blobs and
   79 |   the export revision. Never copy a live database file alone while omitting
   80 |   its WAL state.
   81 | 
   82 | ## Risks to measure
   83 | 
   84 | SQLite permits one writer at a time. A service queue improves fairness but
   85 | does not make writes parallel; a slow transaction still stalls all writers.
   86 | Large read transactions can prevent WAL checkpoint completion. Monitor WAL
   87 | size, checkpoint progress, read transaction age, writer queue depth, lock wait,
   88 | and transaction hold time. Tune checkpoint mode only against observed loads.
   89 | SQLite documents these constraints in its
   90 | [WAL guide](https://www.sqlite.org/wal.html) and
   91 | [PRAGMA guide](https://www.sqlite.org/pragma.html).
````
