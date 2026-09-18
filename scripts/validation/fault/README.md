# P5-02 fault/clock/reorder early matrix

This is a deterministic, early validation harness. It runs named Rust tests
against the checked-out v2 workspace with `--locked --offline`; it does not
change production crates, the database, or shared sprint ledgers.

Run from the v2 root:

```text
python3 scripts/validation/fault/run_matrix.py
```

Use `--online` on a fresh CI runner when the Cargo registry is not already
cached:

```text
python3 scripts/validation/fault/run_matrix.py --online
```

Outputs are written beside the harness:

- `results/latest.json`: machine-readable run metadata, every cell, command,
  exit status, and explicit coverage gaps.
- `project/build-plan/baseline/P5-02-FAULT-CLOCK-REORDER.md`: concise evidence
  report generated from the same result object.

The matrix is intentionally bounded. It reuses existing application/store/
service tests and fixtures, and includes a direct public-API fixture for
duplicate and out-of-order notification publication plus a real SIGKILL
stale-socket restart case. The CLI evidence regression also uses a bounded
debug-only failpoint immediately after durable admission and verifies that
service restart marks the operation unknown before serving requests. Passing a
cell proves only the named deterministic behavior; it is not a full
multi-process, clock-skew, or release gate.
