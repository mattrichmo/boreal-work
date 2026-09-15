# P5 early concurrency probe result

Run date: 2026-09-14 (UTC result file may record the exact wall clock).

The harness at
`scripts/validation/concurrency/README.md` ran the 10-cell matrix at logical
worker counts 1, 3, 10, 30, and 50, with the application status sampler off
and on. The default was five complete lifecycle workflows per logical worker.
Each cell used a fresh temporary SQLite database and removed it after the
cell. The checked-in machine-readable output is
`scripts/validation/concurrency/results/latest.json`.

This is an early P5 validation probe, not a release gate. A logical worker is
a Rust thread with its own `SqliteStore` connection; every cell used one OS
process. The TUI-on parameter is one extra status-reader thread, not the
TypeScript TUI and not a separate process.

The reported queue measure is release-barrier arrival delay, and the reported
hold measure is application mutation-call wall time. The current adapter does
not expose exact SQLite lock-wait versus lock-hold timestamps, so those two
values must not be interpreted as engine-level lock timings. The probe also
uses unique synthetic work items, does not exercise source/memory indexing,
does not inject process crashes, and does not establish multi-process
fairness, restart recovery, or a release performance budget.

To reproduce or compare a future result, require the same `validation_identity`
(`input_sha256`, binary/compiler identity, schema/status contract, fixture
identity, and host metadata) and the same iteration count. The Python runner
refuses no comparison automatically; reviewers must reject comparisons when
identity differs.
