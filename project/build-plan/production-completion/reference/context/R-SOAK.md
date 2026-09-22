# R-SOAK — scripts/validation/soak/README.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/validation/soak/README.md:L1–L10`  
**File SHA-256:** `868d85c81bdc119eabe8a80e12dc2a8df92a19c1cdcd4bf813fbc3bba2607f91`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Long-run mixed workload design, retained observations and resource limits.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,10p' 'scripts/validation/soak/README.md'
```

## Exact baseline excerpt

````text
    1 | # Process soak
    2 | 
    3 | `run.py` repeats the real child-process claim/dependency/idempotency race in
    4 | isolated temporary projects and records every round. The aggregate full suite
    5 | runs a bounded ten-round soak; operators can increase `--rounds` for a longer
    6 | endurance check.
    7 | 
    8 | This is intentionally separate from the deterministic fault matrix: a soak
    9 | pass demonstrates repeatability under load, not power-loss durability or
   10 | indefinite service endurance.
````
