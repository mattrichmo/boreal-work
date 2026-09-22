# R-STATUS-BENCH — scripts/validation/status/README.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/validation/status/README.md:L1–L26`  
**File SHA-256:** `da05d32a3099aa09afd2ec59ea5907c2598f9fb5a9e9bcdc3fda872237642db3`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing service-backed status workload assumptions and benchmark interpretation.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,26p' 'scripts/validation/status/README.md'
```

## Exact baseline excerpt

````text
    1 | # C4-B production-client status evidence
    2 | 
    3 | Run the V11 boundary probe with:
    4 | 
    5 | ```sh
    6 | python3 production_client.py --bin ../../../../target/debug/bwrk
    7 | ```
    8 | 
    9 | The fixture is seeded before service election. The target reads use separate
   10 | `bwrk status` clients over the elected Unix-socket service and reach the 101st
   11 | and 1001st ordered work items with `limit=1`/offset evidence. The service is
   12 | launched with `BOREAL_QUERY_METRICS=1`, so each target response includes
   13 | store-boundary prepared-statement, row, and text-byte counters. This avoids
   14 | dynamic-library interposition and measures the actual elected service without
   15 | altering its SQLite dependency.
   16 | 
   17 | The gate also requires each status request to stay within the declared
   18 | service-boundary query-count budget: at most 16 prepared statements and 4
   19 | batch calls. Row and text-byte counters remain reported because the current
   20 | canonical status projection reads the full work graph; they are not presented
   21 | as bounded database work.
   22 | 
   23 | The public service registry exposes `work show`; the harness verifies that the
   24 | route returns the target item through the elected service and never falls
   25 | back to direct database access. The generated result is written to
   26 | `results/production-client.latest.json`.
````
