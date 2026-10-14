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

Use `--skip-build` only when the matching release binary already exists at
`target/<target>/release/bwrk` (or `target/release/bwrk` for the host target).
The builder compiles both TUI applications into a clean temporary directory;
it does not consume checked-in or stale `dist/` output. Inspect the archive and
verify the staged install with:

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
   the per-platform packaged CLI/TUI smoke test.
5. Render and review a Homebrew formula locally if distribution needs it.
6. Request separate publication authorization before creating a release,
   publishing a formula, or uploading any artifact.

The repository has a CI workflow and two release preparation workflows. They
build and smoke native archives on macOS ARM64, macOS Intel, and Linux x86_64,
then retain their manifests and checksum metadata. They do not publish a
GitHub Release or activate an installation.

The release manifest records both the semantic package version and the API,
schema, workflow, directive, memory, binary, TUI, and toolchain identities.
The builder rejects a requested package version that differs from the version
embedded in the CLI. A tag or `--version` override cannot relabel old binary
bytes.

## Rollback

Keep the last known-good archive, its release manifest, and `SHA256SUMS`
outside the installation prefix. `bwrk update recover --yes` only reconciles an
interrupted update journal; it does not select an older release. To reinstall
the retained package for a prefix-managed installation, run the installer's
trusted copy from that prefix against the saved archive:

```sh
sh /absolute/path/to/current-prefix/share/boreal/install.sh \
  --archive /path/to/previous/bwrk-vX.Y.Z-TARGET.tar.gz \
  --prefix /absolute/path/to/current-prefix \
  --yes
```

The installer verifies and stages the archived package before replacing files;
an installation failure restores the immediately previous installed files and
retains backups if manual recovery is needed. A successful package rollback
preserves Global and project data. Validate the restored CLI/package identity
and project readbacks afterward. Restore a project database separately from a
verified backup to a known schema-compatible version; binary rollback does not
rewind project data.

## Final acceptance binary

Final installed-product qualification must name the absolute executable from
the candidate prefix. After the source has been frozen and the archive
installed in a disposable qualification prefix, invoke:

```sh
python3 scripts/validation/run_full_suite.py \
  --profile full \
  --strict \
  --bin /absolute/path/to/qualification-prefix/bin/bwrk \
  --output /absolute/path/to/validation/full-suite.json
```

The runner checks the executable's embedded source fingerprint against the
current CLI inputs and records its SHA-256. It does not rebuild or substitute
`target/debug/bwrk` when an explicit executable is supplied. This command is
the comprehensive F7 qualification step; it is not an installation or release
claim by itself.
