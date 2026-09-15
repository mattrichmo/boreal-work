# Canonical state, concurrency, and recovery

## Canonical local store

Use one SQLite database in WAL mode for work items, dependencies, attempts,
reservations, operational memory, source-intake versions, memory publication
jobs/indexes, operation identities, and audit events. Published curated memory
is versioned in Git, as described in [MEMORY_BANK.md](MEMORY_BANK.md). Put
large immutable source content and command output in a
content-addressed blob directory. The database records their digest, size,
media type, provenance, and availability. A referenced blob is not published
until it has been safely written and verified; unreferenced blobs can be
garbage-collected after a grace period.

The database is authoritative for live operations and pending memory work.
Git is authoritative for published curated memory at a named Git revision.
An optional work-state export is a portable checkpoint at a named database
revision. Neither Git role coordinates concurrent claims.

## Writer path

1. Parse and validate a command before entering the writer queue.
2. Perform slow source parsing, test execution, or external calls before
   requesting a write. Capture their immutable inputs and results.
3. Enqueue a bounded command with operation ID, actor, expected revision when
   applicable, and attempt fence when applicable.
4. In one short transaction: read current rows, recheck invariants, apply the
   change, append its audit event, advance project revision, and persist the
   idempotent result.
5. Commit, release the connection, publish the new revision, and schedule
   derived-index/export work outside the critical section.

The service orders writers fairly within one workspace and returns a typed
busy/backpressure response with retry guidance when the queue is full. A
timeout never implies that an unknown mutation failed: clients resolve the
operation ID by readback before retrying. SQLite's own busy handling remains a
last defense, not the primary scheduler. Track queue wait and database hold
separately.

## Reader path

Status, task detail, dashboard, and TUI refresh use read-only connections and
short read transactions. A response materializes the needed rows at one
project revision, closes the transaction, then serializes. No UI, subprocess,
network, or model wait occurs while a read transaction remains open.

Some statuses change because time passes, without a new database write.
Every read model therefore includes `as_of` and `next_status_change_at` as
well as project revision. At or after a lease/hard-budget deadline, reads and
claims treat the old attempt as expiry-pending even if the timer worker has
not committed its audit event. The service schedules that short
reconciliation write separately; a UI refresh does not become its owner.
See [STATUS_MODEL.md](STATUS_MODEL.md).

Use indexed, bounded queries. Calculate full totals separately from the row
limit. The `Now` view must not load all work to display ten rows. Expensive
rollups may be versioned projections; their source revision and lag must be
returned, and a request for current state must either compute it from the
canonical store or report it unavailable, not silently serve an old rollup.

## Integrity and recovery

- Database constraints enforce one current attempt per task, unique current
  session execution, valid references, and idempotent operation IDs.
- Domain rules enforce legal transitions, parent hierarchy, graph acyclicity,
  dispatch eligibility, and closeout policy. They are rechecked in the write
  transaction.
- Lease expiry or cancellation increments a fencing generation. Old attempts
  may remain in history but cannot mutate current work.
- Audit history is append-only. Repairs write explicit correction/supersession
  events and keep failed evidence.
- Background projection, search, and Git export jobs read a committed revision,
  calculate outside the write transaction, and publish only if their input
  revision still matches. Retries are idempotent.
- Health checks distinguish current corruption, recoverable index lag,
  retention warnings, and historical migration findings. Running a supported
  repair twice should be a no-op on the second run.
- Backups use a consistent SQLite snapshot and include referenced blobs and
  the export revision. Never copy a live database file alone while omitting
  its WAL state.

## Risks to measure

SQLite permits one writer at a time. A service queue improves fairness but
does not make writes parallel; a slow transaction still stalls all writers.
Large read transactions can prevent WAL checkpoint completion. Monitor WAL
size, checkpoint progress, read transaction age, writer queue depth, lock wait,
and transaction hold time. Tune checkpoint mode only against observed loads.
SQLite documents these constraints in its
[WAL guide](https://www.sqlite.org/wal.html) and
[PRAGMA guide](https://www.sqlite.org/pragma.html).
