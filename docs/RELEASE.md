# Boreal release process

Releases are built from a clean tag such as `v0.2.1`. The release builder
compiles the Rust `bwrk` binary, compiles the TypeScript TUI, embeds the
versioned contract identity, creates a platform archive, and writes a checksum
file.

## Local rehearsal

From the repository root, with Rust, Node.js, npm, and `tsc` available:

```sh
python3 scripts/release/build_release.py \
  --version 0.2.1 \
  --target aarch64-apple-darwin \
  --output-dir /tmp/boreal-release
```

Use `--skip-build` only when the matching release binary and `apps/tui/dist`
already exist. Inspect the archive and verify the staged install with:

```sh
sh install.sh \
  --archive /tmp/boreal-release/bwrk-v0.2.1-aarch64-apple-darwin.tar.gz \
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

For the single offline pre-push path and its exact-commit receipt, see
[Local pre-push validation](LOCAL_PRE_PUSH.md). That receipt covers local
checks only; it keeps the Mac release matrix and approval-gated production
oracles marked `not_run`.

## Manual release checklist

1. Confirm the working tree is clean, the exact-commit local validation
   receipt passes, and product release gates have accepted evidence.
2. Verify the required macOS arm64, macOS x86_64, and Linux host checks on the
   supported platforms. A local-only receipt does not fill the Mac rows.
3. Set the workspace version and explicitly invoke the local release builder
   for each qualified target. Keep the archive, manifest, and checksum outputs
   for review.
4. Run `verify_release_package.py`, the clean-prefix installer rehearsal, and
   the per-platform `bwrk dashboard` smoke test.
5. Render and review a Homebrew formula locally if distribution needs it.
6. Request separate publication authorization before creating a release,
   publishing a formula, or uploading any artifact.

The repository CI and release workflow files have been removed from this
candidate. This does not independently verify repository or organization
Actions settings; confirm both automatic-execution settings through a
supported administrator readback before publication. No workflow performs
builds or publication automatically in this candidate.

The release manifest records both the semantic package version and the API,
schema, workflow, directive, memory, binary, TUI, and toolchain identities.
