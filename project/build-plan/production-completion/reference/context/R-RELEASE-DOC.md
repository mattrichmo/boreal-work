# R-RELEASE-DOC — docs/RELEASE.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/RELEASE.md:L1–L54`  
**File SHA-256:** `dd0c5e23e611beb70a30015451baff59cf39e06b44c7433225dc6191922965f1`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Clean-source package, installed-binary identity and supported-platform release workflow.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,54p' 'docs/RELEASE.md'
```

## Exact baseline excerpt

````text
    1 | # Boreal release process
    2 | 
    3 | Releases are built from a clean tag such as `v0.2.0`. The release builder
    4 | compiles the Rust `bwrk` binary, compiles the TypeScript TUI, embeds the
    5 | versioned contract identity, creates a platform archive, and writes a checksum
    6 | file.
    7 | 
    8 | ## Local rehearsal
    9 | 
   10 | From the repository root, with Rust, Node.js, npm, and `tsc` available:
   11 | 
   12 | ```sh
   13 | python3 scripts/release/build_release.py \
   14 |   --version 0.2.0 \
   15 |   --target aarch64-apple-darwin \
   16 |   --output-dir /tmp/boreal-release
   17 | ```
   18 | 
   19 | Use `--skip-build` only when the matching release binary and `apps/tui/dist`
   20 | already exist. Inspect the archive and verify the staged install with:
   21 | 
   22 | ```sh
   23 | sh install.sh \
   24 |   --archive /tmp/boreal-release/bwrk-v0.2.0-aarch64-apple-darwin.tar.gz \
   25 |   --prefix /tmp/boreal-prefix
   26 | /tmp/boreal-prefix/bin/bwrk --version
   27 | ```
   28 | 
   29 | The complete local build/install smoke test is:
   30 | 
   31 | ```sh
   32 | scripts/release/package-smoke.sh
   33 | ```
   34 | 
   35 | The installer replaces only the executable, packaged TUI, and release metadata
   36 | under the selected prefix. It keeps the previous files until the replacement
   37 | has completed and restores them if the replacement fails.
   38 | 
   39 | ## Release checklist
   40 | 
   41 | 1. Confirm the working tree is clean and the product P4/P5 release gates have
   42 |    accepted evidence.
   43 | 2. Set the workspace version and create an annotated `vX.Y.Z` tag.
   44 | 3. Let GitHub Actions build the supported macOS/Linux target matrix.
   45 | 4. Publish the archives, per-archive release manifests, `SHA256SUMS`, and
   46 |    release notes to GitHub Releases.
   47 | 5. Confirm `mattrichmo/homebrew-tap` exists and this repository has the
   48 |    `HOMEBREW_TAP_TOKEN` Actions secret; the release workflow renders and
   49 |    publishes `Formula/boreal.rb` automatically.
   50 | 6. Run the clean-prefix install smoke test and verify `bwrk dashboard` on each
   51 |    supported platform with Node.js installed.
   52 | 
   53 | The release manifest records both the semantic package version and the API,
   54 | schema, workflow, directive, memory, binary, TUI, and toolchain identities.
````
