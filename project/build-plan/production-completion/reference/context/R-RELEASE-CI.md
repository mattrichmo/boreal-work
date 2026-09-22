# R-RELEASE-CI — .github/workflows/release.yml

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `.github/workflows/release.yml:L1–L121`  
**File SHA-256:** `e282d98e9a20c7c3a96d1d755f002bbb1c5427c39d589a67f3fffd2e0a889651`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Current macOS/Linux target matrix, preflight/build/publish ordering and Homebrew publication; publishing needs explicit authority and exact artifact identity.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,121p' '.github/workflows/release.yml'
```

## Exact baseline excerpt

````text
    1 | name: Release
    2 | 
    3 | on:
    4 |   push:
    5 |     tags:
    6 |       - "v*"
    7 | 
    8 | permissions:
    9 |   contents: write
   10 | 
   11 | jobs:
   12 |   preflight:
   13 |     name: Release preflight
   14 |     runs-on: ubuntu-latest
   15 |     steps:
   16 |       - uses: actions/checkout@v4
   17 |       - uses: dtolnay/rust-toolchain@stable
   18 |       - uses: actions/setup-node@v4
   19 |         with:
   20 |           node-version: 22
   21 |       - name: Install pinned TUI compiler
   22 |         run: npm install --global typescript@5.4.5
   23 |       - name: Install system smoke dependencies
   24 |         run: sudo apt-get update && sudo apt-get install --yes jq sqlite3
   25 |       - name: Test validation runner
   26 |         run: python3 -m unittest scripts/validation/test_run_full_suite.py
   27 |       - name: Run strict release validation
   28 |         run: >-
   29 |           python3 scripts/validation/run_full_suite.py
   30 |           --profile full
   31 |           --strict
   32 |           --online
   33 | 
   34 |   build:
   35 |     name: Build ${{ matrix.target }}
   36 |     needs: preflight
   37 |     strategy:
   38 |       fail-fast: false
   39 |       matrix:
   40 |         include:
   41 |           - os: macos-14
   42 |             target: aarch64-apple-darwin
   43 |           - os: macos-13
   44 |             target: x86_64-apple-darwin
   45 |           - os: ubuntu-22.04
   46 |             target: x86_64-unknown-linux-gnu
   47 | 
   48 |     runs-on: ${{ matrix.os }}
   49 |     steps:
   50 |       - uses: actions/checkout@v4
   51 |       - uses: dtolnay/rust-toolchain@stable
   52 |         with:
   53 |           targets: ${{ matrix.target }}
   54 |       - uses: actions/setup-node@v4
   55 |         with:
   56 |           node-version: 22
   57 |       - name: Install pinned TUI compiler
   58 |         run: npm install --global typescript@5.4.5
   59 |       - name: Build release archive
   60 |         env:
   61 |           RELEASE_VERSION: ${{ github.ref_name }}
   62 |         run: |
   63 |           python3 scripts/release/build_release.py \
   64 |             --version "${RELEASE_VERSION#v}" \
   65 |             --target "${{ matrix.target }}" \
   66 |             --output-dir release-artifacts
   67 |       - uses: actions/upload-artifact@v4
   68 |         with:
   69 |           name: release-${{ matrix.target }}
   70 |           path: release-artifacts
   71 |           if-no-files-found: error
   72 | 
   73 |   publish:
   74 |     name: Publish GitHub Release
   75 |     needs: build
   76 |     runs-on: ubuntu-latest
   77 |     steps:
   78 |       - uses: actions/checkout@v4
   79 |       - uses: actions/download-artifact@v4
   80 |         with:
   81 |           path: downloaded-releases
   82 |       - name: Assemble release assets
   83 |         run: |
   84 |           mkdir -p upload
   85 |           find downloaded-releases -type f \( -name '*.tar.gz' -o -name '*.release.json' \) -exec cp {} upload/ \;
   86 |           find upload -type f -name '*.tar.gz' -print0 | sort -z | xargs -0 sha256sum > upload/SHA256SUMS
   87 |           test -s upload/SHA256SUMS
   88 |           ls -lh upload
   89 |       - name: Render Homebrew formula
   90 |         env:
   91 |           RELEASE_VERSION: ${{ github.ref_name }}
   92 |         run: |
   93 |           python3 scripts/release/render_homebrew_formula.py \
   94 |             --version "${RELEASE_VERSION#v}" \
   95 |             --archive "aarch64-apple-darwin=$(find upload -name '*aarch64-apple-darwin.tar.gz' -print -quit)" \
   96 |             --archive "x86_64-apple-darwin=$(find upload -name '*x86_64-apple-darwin.tar.gz' -print -quit)" \
   97 |             --archive "x86_64-unknown-linux-gnu=$(find upload -name '*x86_64-unknown-linux-gnu.tar.gz' -print -quit)" \
   98 |             --output upload/boreal.rb
   99 |       - name: Create GitHub Release
  100 |         env:
  101 |           GH_TOKEN: ${{ github.token }}
  102 |         run: gh release create "$GITHUB_REF_NAME" upload/* --title "Boreal $GITHUB_REF_NAME" --generate-notes
  103 |       - name: Publish Homebrew formula
  104 |         if: ${{ env.HOMEBREW_TAP_TOKEN != '' }}
  105 |         env:
  106 |           HOMEBREW_TAP_TOKEN: ${{ secrets.HOMEBREW_TAP_TOKEN }}
  107 |         run: |
  108 |           tap_dir="$(mktemp -d)"
  109 |           trap 'rm -rf "$tap_dir"' EXIT
  110 |           git clone "https://x-access-token:${HOMEBREW_TAP_TOKEN}@github.com/mattrichmo/homebrew-tap.git" "$tap_dir"
  111 |           mkdir -p "$tap_dir/Formula"
  112 |           cp upload/boreal.rb "$tap_dir/Formula/boreal.rb"
  113 |           git -C "$tap_dir" config user.name "github-actions[bot]"
  114 |           git -C "$tap_dir" config user.email "41898282+github-actions[bot]@users.noreply.github.com"
  115 |           if git -C "$tap_dir" diff --quiet -- Formula/boreal.rb; then
  116 |             echo "Homebrew formula is already current."
  117 |           else
  118 |             git -C "$tap_dir" add Formula/boreal.rb
  119 |             git -C "$tap_dir" commit -m "boreal $GITHUB_REF_NAME"
  120 |             git -C "$tap_dir" push origin HEAD
  121 |           fi
````
