# R-PACKAGING — docs/PACKAGING.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `docs/PACKAGING.md:L1–L125`  
**File SHA-256:** `e4254a6f994f31cb0ec79192f5a29c9553c1801c23cf80fe567e5b73ec738075`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Expected binary/TUI/share layout, package manifest and installer behavior.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,125p' 'docs/PACKAGING.md'
```

## Exact baseline excerpt

````text
    1 | # P4-05 packaging and release identity
    2 | 
    3 | The public package is a platform-specific `bwrk` archive containing the Rust
    4 | CLI/service host and the compiled TypeScript TUI. Homebrew and the direct
    5 | installer consume the same GitHub Release archive.
    6 | 
    7 | ## Build a release archive
    8 | 
    9 | From the repository root, with Rust, Node.js, npm, and `tsc` available:
   10 | 
   11 | ```sh
   12 | python3 scripts/release/build_release.py \
   13 |   --version 0.2.0 \
   14 |   --target aarch64-apple-darwin \
   15 |   --output-dir /tmp/boreal-release
   16 | ```
   17 | 
   18 | The builder runs the locked Rust release build and `npm run build` for the TUI,
   19 | then stages this install layout:
   20 | 
   21 | ```text
   22 | bin/bwrk
   23 | lib/boreal/tui/*.js
   24 | share/boreal/release.json
   25 | share/boreal/LICENSE
   26 | ```
   27 | 
   28 | It creates a normalized `bwrk-vX.Y.Z-TARGET.tar.gz`, a per-target release
   29 | manifest, and `SHA256SUMS`. The archive metadata is normalized so two builds
   30 | of the same staged payload produce the same archive bytes.
   31 | 
   32 | The complete local build/install check is:
   33 | 
   34 | ```sh
   35 | scripts/release/package-smoke.sh
   36 | ```
   37 | 
   38 | The release helper in `scripts/release/release_identity.py` is a dependency-
   39 | light, standard-library-only boundary for the checked-in v2 contract assets.
   40 | It produces a deterministic JSON identity with no clock, host, or build-path
   41 | fields. Every asset record contains its POSIX-relative path, byte count, and
   42 | SHA-256 digest. Component identities are hashes of sorted asset records, and
   43 | the snapshot identity covers the package metadata, contract versions, and all
   44 | component identities.
   45 | 
   46 | The manifest records these versioned components:
   47 | 
   48 | | Component | Version source | Asset scope |
   49 | | --- | --- | --- |
   50 | | `protocol` | `project/spec/protocol/protocol-manifest.json` | protocol fixtures and compatibility notes |
   51 | | `schema` | `project/spec/manifest.json` | the spec manifest and `schema-v2.sql` |
   52 | | `memory` | `project/spec/memory-manifest.json` | memory manifest |
   53 | | `directive` | `project/spec/guidance/directive-registry.json` | checked-in guidance assets |
   54 | | `workflow` | `project/spec/workflows/package.json` | checked-in workflow assets |
   55 | | `skill` | `skills/manifest.json` | harness-neutral Codex/Claude skill adapters |
   56 | 
   57 | ## Contract identity commands
   58 | 
   59 | Run these commands from the v2 package root (the repository root). Keep the
   60 | generated release manifest outside the checkout when checking a working tree;
   61 | the output has no generated timestamp and is safe to compare byte-for-byte.
   62 | 
   63 | ```sh
   64 | python3 scripts/release/release_identity.py manifest \
   65 |   --root . \
   66 |   --output /tmp/boreal-work-v2.release.json
   67 | 
   68 | python3 scripts/release/release_identity.py check \
   69 |   --root . \
   70 |   --manifest /tmp/boreal-work-v2.release.json
   71 | ```
   72 | 
   73 | The checker exits `0` and prints JSON on success. It exits `1` with `FAIL:`
   74 | and a corrective diagnostic for missing files, invalid JSON, symlinks, path
   75 | escapes, version drift, byte drift, or an identity mismatch.
   76 | 
   77 | Run the executable checker tests with:
   78 | 
   79 | ```sh
   80 | python3 scripts/release/test_release_identity.py
   81 | ```
   82 | 
   83 | To rehearse an install and rollback without touching a project or the source
   84 | checkout, create an existing directory under the system temporary directory:
   85 | 
   86 | ```sh
   87 | staging_dir="$(mktemp -d)"
   88 | python3 scripts/release/release_identity.py simulate \
   89 |   --root . \
   90 |   --manifest /tmp/boreal-work-v2.release.json \
   91 |   --staging-dir "$staging_dir"
   92 | ```
   93 | 
   94 | The simulation copies the declared assets into a staged payload, validates the
   95 | payload, replaces a synthetic `simulated-live` directory, and restores a
   96 | synthetic previous-install marker from a backup. It leaves all transaction
   97 | files under `$staging_dir/boreal-release-simulation-v1` for inspection. The
   98 | helper refuses a missing/non-directory staging path, a path outside Python's
   99 | system temporary directory, a path overlapping the package root, or a reused
  100 | simulation directory. The caller may remove the temporary directory after
  101 | inspection:
  102 | 
  103 | ```sh
  104 | rm -rf "$staging_dir"
  105 | ```
  106 | 
  107 | ## Scope and limitations
  108 | 
  109 | `release_identity.py` remains the dependency-light contract-asset identity
  110 | boundary; it intentionally does not hash generated binaries or TUI output.
  111 | `build_release.py` adds those generated assets, records Rust/Node/TypeScript
  112 | toolchain versions, and creates the archive. The current process still does
  113 | not sign artifacts, contact a registry, pause active attempts during an
  114 | upgrade, or migrate a project database. When the public tap and
  115 | `HOMEBREW_TAP_TOKEN` are configured, the release workflow publishes the
  116 | rendered Homebrew formula automatically; otherwise the formula remains a
  117 | checked-in packaging template. The remaining behaviors are part of the P4/P5
  118 | compatibility and cutover gates.
  119 | 
  120 | The identity simulation is deliberately not a live installer: its target and
  121 | rollback backup are synthetic directories inside a caller-created temp
  122 | directory. `install.sh` is the real archive installer and performs a bounded,
  123 | backup-preserving replacement under the selected prefix. Active-attempt
  124 | compatibility checks, signing, and full platform-specific upgrade/recovery
  125 | tests remain release-gate work.
````
