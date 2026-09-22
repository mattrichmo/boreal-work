# R-TUI-SMOKE — scripts/validation/tui/README.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/validation/tui/README.md:L1–L32`  
**File SHA-256:** `eb32c6b6fda13bb35e74297250734497995e4965a814bcaf175f13229d2be719`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Mounted PTY service evidence and known gaps; fixture rendering is supplementary only.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,32p' 'scripts/validation/tui/README.md'
```

## Exact baseline excerpt

````text
    1 | # TUI PTY smoke
    2 | 
    3 | `pty_smoke.py` starts the current v2 service, launches the compiled TUI entrypoint
    4 | inside a POSIX pseudo-terminal, verifies the dashboard renders, sends `q`, and
    5 | checks that the interactive process exits cleanly. It uses the real Unix-socket
    6 | service boundary and is included in the full aggregate suite.
    7 | 
    8 | Restricted runners that deny Unix-domain sockets emit an explicit validation
    9 | skip; strict aggregate validation rejects that skip.
   10 | 
   11 | ## Forensic V04/V06/V07 fixture
   12 | 
   13 | `forensic_closeout.mjs` is the production-composition fixture for the TUI-owned
   14 | forensic gates. It creates an isolated SQLite fixture, starts the real
   15 | `target/debug/bwrk service run` host, validates live status DTOs through the
   16 | compiled TypeScript client, injects the three debug evidence failpoints,
   17 | restarts and reads back each operation, and drives the compiled full-screen
   18 | controller through a typed closeout followed by a deliberate refresh failure.
   19 | 
   20 | Run it from the repository root with Unix-socket/process permission:
   21 | 
   22 | ```sh
   23 | node scripts/validation/tui/forensic_closeout.mjs
   24 | ```
   25 | 
   26 | The fixture writes `results/forensic-closeout.latest.json` and
   27 | `results/forensic-closeout.latest.md`. The closeout readback currently needs a
   28 | validation-side DTO normalization because `operation_show` exposes the stored
   29 | `Verification` enum and canonical `WORK:verification` gate spelling, while the
   30 | `ReceiptDto` ingress accepts lowercase `verification` and the short gate name.
   31 | The raw spelling is retained in the report; this is evidence of a remaining
   32 | service/protocol compatibility gap, not a skipped environment check.
````
