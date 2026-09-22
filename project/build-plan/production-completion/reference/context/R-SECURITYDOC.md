# R-SECURITYDOC — docs/SECURITY.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/SECURITY.md:L1–L75`  
**File SHA-256:** `1f90e145037b826db0e87c9491a29ade50ebfd8e6737a985269fb591ab13c39f`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing bounded security probes and what their historical passes do not establish.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,75p' 'docs/SECURITY.md'
```

## Exact baseline excerpt

````text
    1 | # Security and resource-boundary probe
    2 | 
    3 | `scripts/validation/security/probe.sh` is an early P5 probe for the v2 local
    4 | boundaries. It creates a fresh temporary fixture, compiles a short harness
    5 | against the checked-in v2 crates, runs it, and removes the fixture on exit.
    6 | The probe does not modify Rust, CLI/TUI, workflow assets, or Boreal sprint
    7 | records.
    8 | 
    9 | Run it from the v2 package root:
   10 | 
   11 | ```sh
   12 | scripts/validation/security/probe.sh
   13 | ```
   14 | 
   15 | The checks cover:
   16 | 
   17 | - project IDs, source origins, memory entry IDs, and forged cross-project
   18 |   records;
   19 | - source and memory retrieval scope, including bounded excerpts;
   20 | - zero and over-limit application/transport request sizes;
   21 | - guidance argv safety and workflow command-data shell metacharacters;
   22 | - malformed application envelopes and malformed/oversized framed transport
   23 |   requests;
   24 | - Unix socket binding and the caller-owned private-runtime-directory
   25 |   assumption.
   26 | 
   27 | ## Interpretation
   28 | 
   29 | `PASS` is an observed invariant. `FAIL` is a boundary violation and causes
   30 | the probe to exit non-zero. `SKIP` means the runner could not exercise an
   31 | environment-dependent check; it is recorded as a limitation and does not
   32 | pretend to be proof.
   33 | 
   34 | The transport requires an absolute Unix socket path before binding or
   35 | connecting. The CLI/service composition still owns selection of a private
   36 | runtime directory; the transport check does not claim OS-level isolation.
   37 | 
   38 | The probe is intentionally not a complete P5 security review. It does not
   39 | establish multi-process isolation, OS MAC/sandbox policy, database file
   40 | permissions, denial-of-service behavior over repeated connections, durable
   41 | outbox/recovery safety, or production deployment hardening. Unix socket checks
   42 | may be `SKIP` in restricted runners that deny Unix-domain socket creation.
   43 | 
   44 | ## Observed run
   45 | 
   46 | Run from the v2 package root on 2026-09-14:
   47 | 
   48 | ```text
   49 | PASS workflow-shell-boundary
   50 | 14 PASS compiled boundary checks
   51 | 0 FAIL
   52 | 1 SKIP: runner denied Unix socket creation (`Operation not permitted`)
   53 | ```
   54 | 
   55 | Because this runner denied the socket bind, the malformed-frame,
   56 | oversized-frame, and relative-path subchecks were not exercised in that run.
   57 | The non-socket application envelope rejection did run and passed. Re-run the
   58 | probe on a Unix environment that permits temporary Unix-domain sockets to
   59 | close those skips; on such an environment, relative socket paths are rejected
   60 | before bind.
   61 | 
   62 | ## Latest observed run
   63 | 
   64 | Run from the v2 package root on 2026-09-15 with elevated temporary-socket
   65 | permissions:
   66 | 
   67 | ```text
   68 | PASS workflow-shell-boundary
   69 | 17 PASS compiled boundary checks
   70 | 0 FAIL
   71 | 0 SKIP
   72 | ```
   73 | 
   74 | The new `unix-socket-path-assumption` check passes because both server bind
   75 | and client connect reject relative paths with typed invalid-input I/O.
````
