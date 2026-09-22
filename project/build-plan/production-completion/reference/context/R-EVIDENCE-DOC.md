# R-EVIDENCE-DOC — docs/EVIDENCE_RUNNER.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/EVIDENCE_RUNNER.md:L1–L38`  
**File SHA-256:** `a4f8be20ab43d289f9e812c459403456ed0e6ec7d2c9cf1b749fe3e388bd6eaa`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Current policy-declared evidence runner, source binding and remaining cryptographic/resource hardening.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,38p' 'docs/EVIDENCE_RUNNER.md'
```

## Exact baseline excerpt

````text
    1 | # Bounded evidence runner
    2 | 
    3 | `bwrk evidence run` executes only a project-local, policy-declared gate. The
    4 | declaration lives at `<db-parent>/gates/<gate-id>.json`; for the default
    5 | database this is `.boreal/gates/<gate-id>.json`.
    6 | 
    7 | ```json
    8 | {
    9 |   "gate_id": "verification",
   10 |   "kind": "verification",
   11 |   "executable": "true",
   12 |   "argv": ["true"],
   13 |   "cwd": ".",
   14 |   "source_snapshot_hash": "sha256:source-v1",
   15 |   "config_identity": "sha256:config-v1",
   16 |   "environment_fingerprint": "env-v1",
   17 |   "observables": ["verification"],
   18 |   "max_runtime_ms": 30000
   19 | }
   20 | ```
   21 | 
   22 | The executable and argv are validated by the Rust application boundary. Shell
   23 | executables, shell metacharacters, parent-path arguments, oversized argv, and
   24 | undeclared gates fail closed. The CLI invokes the executable directly with
   25 | `shell=false`, null stdin, a project-scoped working directory, a bounded
   26 | runtime, and bounded combined output. Output is retained under
   27 | `<db-parent>/evidence/` and referenced by the structured receipt.
   28 | 
   29 | The runner records the operation, work/attempt/fence, gate/profile, source and
   30 | config identities, command, cwd, timestamps, attestation, output digest/ref,
   31 | and typed execution result. Timeout and failed execution facts remain failed
   32 | receipts and cannot satisfy a gate. A successful receipt is then persisted by
   33 | the normal application path; when `--socket` is supplied, execution and
   34 | persistence use the versioned local service route.
   35 | 
   36 | This first implementation uses a deterministic `fnv1a64:` output digest as a
   37 | bounded local identity. Cryptographic output hashing and streaming subprocess
   38 | resource enforcement remain release-hardening work for P5.
````
