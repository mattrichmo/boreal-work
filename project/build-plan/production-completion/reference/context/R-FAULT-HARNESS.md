# R-FAULT-HARNESS — scripts/validation/fault/README.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/validation/fault/README.md:L1–L34`  
**File SHA-256:** `aae506f8001c4175d5fa9ba91cfa0e60632a138707a3634fdc4b25c0f7f99bf2`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing clock/reorder/fault harness and genuine-service boundary requirements.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,34p' 'scripts/validation/fault/README.md'
```

## Exact baseline excerpt

````text
    1 | # P5-02 fault/clock/reorder early matrix
    2 | 
    3 | This is a deterministic, early validation harness. It runs named Rust tests
    4 | against the checked-out v2 workspace with `--locked --offline`; it does not
    5 | change production crates, the database, or shared sprint ledgers.
    6 | 
    7 | Run from the v2 root:
    8 | 
    9 | ```text
   10 | python3 scripts/validation/fault/run_matrix.py
   11 | ```
   12 | 
   13 | Use `--online` on a fresh CI runner when the Cargo registry is not already
   14 | cached:
   15 | 
   16 | ```text
   17 | python3 scripts/validation/fault/run_matrix.py --online
   18 | ```
   19 | 
   20 | Outputs are written beside the harness:
   21 | 
   22 | - `results/latest.json`: machine-readable run metadata, every cell, command,
   23 |   exit status, and explicit coverage gaps.
   24 | - `project/build-plan/baseline/P5-02-FAULT-CLOCK-REORDER.md`: concise evidence
   25 |   report generated from the same result object.
   26 | 
   27 | The matrix is intentionally bounded. It reuses existing application/store/
   28 | service tests and fixtures, and includes a direct public-API fixture for
   29 | duplicate and out-of-order notification publication plus a real SIGKILL
   30 | stale-socket restart case. The CLI evidence regression also uses a bounded
   31 | debug-only failpoint immediately after durable admission and verifies that
   32 | service restart marks the operation unknown before serving requests. Passing a
   33 | cell proves only the named deterministic behavior; it is not a full
   34 | multi-process, clock-skew, or release gate.
````
