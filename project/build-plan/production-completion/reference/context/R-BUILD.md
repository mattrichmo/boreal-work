# R-BUILD — docs/BUILD.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/BUILD.md:L1–L35`  
**File SHA-256:** `55aee4cd853b14b2c94ae3807d21e0e773efc4fa36f58b2e68ce20bf35603277`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Repository-supported build prerequisites and commands; verify availability on actual executor.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,35p' 'docs/BUILD.md'
```

## Exact baseline excerpt

````text
    1 | # Standalone build check
    2 | 
    3 | The v2 package is intended to move out of the legacy checkout without reading
    4 | legacy code, caches, or `.boreal` state. From the v2 package root, run:
    5 | 
    6 | ```sh
    7 | scripts/standalone-check.sh
    8 | ```
    9 | 
   10 | The script creates a fresh checkout under `mktemp`, copies the package while
   11 | excluding only `target`, `node_modules`, and macOS metadata, then runs:
   12 | 
   13 | ```text
   14 | python3 project/spec/validate_contracts.py
   15 | cargo fmt --all -- --check
   16 | cargo test --workspace --locked --offline
   17 | cargo clippy --workspace --all-targets --locked --offline -- -D warnings
   18 | npm run typecheck --prefix apps/tui
   19 | npm test --prefix apps/tui
   20 | ```
   21 | 
   22 | No dependencies are installed and no legacy workspace state is consulted.
   23 | Cargo is explicitly offline; TUI checks use the package's existing TypeScript
   24 | toolchain. The temporary directory is removed on exit, including failures.
   25 | The script runs every check even if an earlier check fails and exits non-zero
   26 | with a summary of failed checks.
   27 | 
   28 | The application embeds and validates the checked-in core workflow package at
   29 | compile time; `boreal.application.v2` remains the state authority. Strict
   30 | clippy is part of the standalone gate and must pass on the copied snapshot.
   31 | 
   32 | This proves the copied source package is self-contained for the listed static,
   33 | contract, Rust, and TUI checks. It does not prove the still-gated P2 service
   34 | client, multi-process restart, migration rollback, load/fault/security, or
   35 | P5-08 cutover requirements.
````
