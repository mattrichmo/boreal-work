# R-EVIDENCE-GAPS — docs/EVIDENCE_EXECUTOR_TEST_GAPS.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/EVIDENCE_EXECUTOR_TEST_GAPS.md:L1–L34`  
**File SHA-256:** `b2718e2e2120c0e60d481ed664b59744c2e64dd7521935982cd4801c6f455761`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Known evidence executor regression coverage and unsupported proof boundaries.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,34p' 'docs/EVIDENCE_EXECUTOR_TEST_GAPS.md'
```

## Exact baseline excerpt

````text
    1 | # Evidence executor regression coverage
    2 | 
    3 | The Unix integration tests in
    4 | `crates/cli/tests/evidence_executor_regressions.rs` exercise the public
    5 | `bwrk evidence run` path for:
    6 | 
    7 | - standard `.boreal/boreal.sqlite` layouts and workspace-root command cwd;
    8 | - the default environment allowlist, omitted `HOME`, measured environment
    9 |   fingerprints, and sensitive-variable rejection before admission;
   10 | - timeout cleanup of a descendant process in the executor's process group;
   11 | - durable admission/replay using a counter-writing command, including replay
   12 |   with a malformed declaration so policy parsing cannot accidentally relaunch;
   13 | - existing stream, combined-artifact, observable, and aggregate output-quota
   14 |   cases in `evidence_runner_hardening.rs`.
   15 | 
   16 | The following boundaries are not claimed as executed regression coverage:
   17 | 
   18 | 1. There is no public synchronization or fault-injection hook between the
   19 |    durable admission transaction and the external `spawn` call. A test can
   20 |    inspect an admitted row, but cannot deterministically terminate the CLI at
   21 |    that exact boundary without adding a production test seam. The safe replay
   22 |    behavior is therefore tested after a completed operation, while admission
   23 |    and unknown-state transitions remain source/store coverage.
   24 | 2. The direct CLI has no public cancellation operation that can be delivered
   25 |    to a running executor from the same test. External SIGTERM/SIGINT handling
   26 |    and cancellation races require a service-level process fixture and are not
   27 |    inferred from the timeout test.
   28 | 3. The descendant test verifies cleanup behaviorally with a delayed marker.
   29 |    It does not claim platform-independent process-tree or resource telemetry;
   30 |    the test is Unix-only because the runner intentionally fails closed where
   31 |    process-group cleanup is unavailable.
   32 | 
   33 | These limitations are documented rather than addressed by weakening executor
   34 | policy or introducing test-only behavior in production code.
````
