# Boreal release process

Releases are built from a clean tag such as `v0.2.0`. The release builder
compiles the Rust `bwrk` binary, compiles the TypeScript TUI, embeds the
versioned contract identity, creates a platform archive, and writes a checksum
file.

## Local rehearsal

From the repository root, with Rust, Node.js, npm, and `tsc` available:

```sh
python3 scripts/release/build_release.py \
  --version 0.2.0 \
  --target aarch64-apple-darwin \
  --output-dir /tmp/boreal-release
```

Use `--skip-build` only when the matching release binary and `apps/tui/dist`
already exist. Inspect the archive and verify the staged install with:

```sh
sh install.sh \
  --archive /tmp/boreal-release/bwrk-v0.2.0-aarch64-apple-darwin.tar.gz \
  --prefix /tmp/boreal-prefix
/tmp/boreal-prefix/bin/bwrk --version
```

The complete local build/install smoke test is:

```sh
scripts/release/package-smoke.sh
```

The installer replaces only the executable, packaged TUI, and release metadata
under the selected prefix. It keeps the previous files until the replacement
has completed and restores them if the replacement fails.

## Release checklist

1. Confirm the working tree is clean and the product P4/P5 release gates have
   accepted evidence.
2. Set the workspace version and create an annotated `vX.Y.Z` tag.
3. Let GitHub Actions build the supported macOS/Linux target matrix.
4. Publish the archives, per-archive release manifests, `SHA256SUMS`, and
   release notes to GitHub Releases.
5. Confirm `mattrichmo/homebrew-tap` exists and this repository has the
   `HOMEBREW_TAP_TOKEN` Actions secret; the release workflow renders and
   publishes `Formula/boreal.rb` automatically.
6. Run the clean-prefix install smoke test and verify `bwrk dashboard` on each
   supported platform with Node.js installed.

The release manifest records both the semantic package version and the API,
schema, workflow, directive, memory, binary, TUI, and toolchain identities.
