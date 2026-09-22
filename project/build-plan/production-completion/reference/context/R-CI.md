# R-CI — .github/workflows/ci.yml

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `.github/workflows/ci.yml:L1–L83`  
**File SHA-256:** `1144eba8d1a75e700c891a5b469b9a51112bf1509d56ebcc833449443c1b0182`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Current CI commands, compiler pin and strict aggregate behavior; verify runner availability at execution rather than assuming the historical labels remain supported.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,83p' '.github/workflows/ci.yml'
```

## Exact baseline excerpt

````text
    1 | name: CI
    2 | 
    3 | on:
    4 |   push:
    5 |     branches: [main]
    6 |   pull_request:
    7 | 
    8 | jobs:
    9 |   rust:
   10 |     name: Rust checks
   11 |     runs-on: ubuntu-latest
   12 |     steps:
   13 |       - uses: actions/checkout@v4
   14 |       - uses: dtolnay/rust-toolchain@stable
   15 |         with:
   16 |           components: rustfmt, clippy
   17 |       - name: Check formatting
   18 |         run: cargo fmt --all -- --check
   19 |       - name: Check contracts
   20 |         run: python3 project/spec/validate_contracts.py
   21 |       - name: Test workspace
   22 |         run: cargo test --workspace --locked
   23 |       - name: Clippy
   24 |         run: cargo clippy --workspace --all-targets --locked -- -D warnings
   25 | 
   26 |   tui:
   27 |     name: TypeScript TUI checks
   28 |     runs-on: ubuntu-latest
   29 |     steps:
   30 |       - uses: actions/checkout@v4
   31 |       - uses: actions/setup-node@v4
   32 |         with:
   33 |           node-version: 22
   34 |       - name: Install pinned compiler
   35 |         run: npm install --global typescript@5.4.5
   36 |       - name: Typecheck
   37 |         run: npm run typecheck --prefix apps/tui
   38 |       - name: Test and build
   39 |         run: npm test --prefix apps/tui
   40 | 
   41 |   release-identity:
   42 |     name: Release identity checks
   43 |     runs-on: ubuntu-latest
   44 |     steps:
   45 |       - uses: actions/checkout@v4
   46 |       - name: Validate release identity
   47 |         run: python3 scripts/release/test_release_identity.py
   48 | 
   49 |   package-smoke:
   50 |     name: Package and install smoke test
   51 |     runs-on: ubuntu-latest
   52 |     steps:
   53 |       - uses: actions/checkout@v4
   54 |       - uses: dtolnay/rust-toolchain@stable
   55 |       - uses: actions/setup-node@v4
   56 |         with:
   57 |           node-version: 22
   58 |       - name: Install pinned TUI compiler
   59 |         run: npm install --global typescript@5.4.5
   60 |       - name: Build and install a clean prefix
   61 |         run: scripts/release/package-smoke.sh
   62 | 
   63 |   system-validation:
   64 |     name: Full system validation
   65 |     runs-on: ubuntu-latest
   66 |     steps:
   67 |       - uses: actions/checkout@v4
   68 |       - uses: dtolnay/rust-toolchain@stable
   69 |       - uses: actions/setup-node@v4
   70 |         with:
   71 |           node-version: 22
   72 |       - name: Install pinned TUI compiler
   73 |         run: npm install --global typescript@5.4.5
   74 |       - name: Install system smoke dependencies
   75 |         run: sudo apt-get update && sudo apt-get install --yes jq sqlite3
   76 |       - name: Test validation runner
   77 |         run: python3 -m unittest scripts/validation/test_run_full_suite.py
   78 |       - name: Run strict full validation
   79 |         run: >-
   80 |           python3 scripts/validation/run_full_suite.py
   81 |           --profile full
   82 |           --strict
   83 |           --online
````
