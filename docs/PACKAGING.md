# P4-05 packaging and release identity

The public package is a platform-specific `bwrk` archive containing the Rust
CLI/service host and the compiled TypeScript TUI. Homebrew and the direct
installer consume the same GitHub Release archive.

## Build a release archive

From the repository root, with Rust, Node.js, npm, and `tsc` available:

```sh
python3 scripts/release/build_release.py \
  --version 0.2.0 \
  --target aarch64-apple-darwin \
  --output-dir /tmp/boreal-release
```

The builder runs the locked Rust release build and `npm run build` for the TUI,
then stages this install layout:

```text
bin/bwrk
lib/boreal/tui/*.js
share/boreal/release.json
share/boreal/LICENSE
```

It creates a normalized `bwrk-vX.Y.Z-TARGET.tar.gz`, a per-target release
manifest, and `SHA256SUMS`. The archive metadata is normalized so two builds
of the same staged payload produce the same archive bytes.

The complete local build/install check is:

```sh
scripts/release/package-smoke.sh
```

The release helper in `scripts/release/release_identity.py` is a dependency-
light, standard-library-only boundary for the checked-in v2 contract assets.
It produces a deterministic JSON identity with no clock, host, or build-path
fields. Every asset record contains its POSIX-relative path, byte count, and
SHA-256 digest. Component identities are hashes of sorted asset records, and
the snapshot identity covers the package metadata, contract versions, and all
component identities.

The manifest records these versioned components:

| Component | Version source | Asset scope |
| --- | --- | --- |
| `protocol` | `project/spec/protocol/protocol-manifest.json` | protocol fixtures and compatibility notes |
| `schema` | `project/spec/manifest.json` | the spec manifest and `schema-v2.sql` |
| `memory` | `project/spec/memory-manifest.json` | memory manifest |
| `directive` | `project/spec/guidance/directive-registry.json` | checked-in guidance assets |
| `workflow` | `project/spec/workflows/package.json` | checked-in workflow assets |

## Contract identity commands

Run these commands from the v2 package root (the repository root). Keep the
generated release manifest outside the checkout when checking a working tree;
the output has no generated timestamp and is safe to compare byte-for-byte.

```sh
python3 scripts/release/release_identity.py manifest \
  --root . \
  --output /tmp/boreal-work-v2.release.json

python3 scripts/release/release_identity.py check \
  --root . \
  --manifest /tmp/boreal-work-v2.release.json
```

The checker exits `0` and prints JSON on success. It exits `1` with `FAIL:`
and a corrective diagnostic for missing files, invalid JSON, symlinks, path
escapes, version drift, byte drift, or an identity mismatch.

Run the executable checker tests with:

```sh
python3 scripts/release/test_release_identity.py
```

To rehearse an install and rollback without touching a project or the source
checkout, create an existing directory under the system temporary directory:

```sh
staging_dir="$(mktemp -d)"
python3 scripts/release/release_identity.py simulate \
  --root . \
  --manifest /tmp/boreal-work-v2.release.json \
  --staging-dir "$staging_dir"
```

The simulation copies the declared assets into a staged payload, validates the
payload, replaces a synthetic `simulated-live` directory, and restores a
synthetic previous-install marker from a backup. It leaves all transaction
files under `$staging_dir/boreal-release-simulation-v1` for inspection. The
helper refuses a missing/non-directory staging path, a path outside Python's
system temporary directory, a path overlapping the package root, or a reused
simulation directory. The caller may remove the temporary directory after
inspection:

```sh
rm -rf "$staging_dir"
```

## Scope and limitations

`release_identity.py` remains the dependency-light contract-asset identity
boundary; it intentionally does not hash generated binaries or TUI output.
`build_release.py` adds those generated assets, records Rust/Node/TypeScript
toolchain versions, and creates the archive. The current process still does
not sign artifacts, contact a registry, publish a Homebrew tap automatically,
pause active attempts during an upgrade, or migrate a project database.
Those behaviors remain part of the P4/P5 compatibility and cutover gates.

The identity simulation is deliberately not a live installer: its target and
rollback backup are synthetic directories inside a caller-created temp
directory. `install.sh` is the real archive installer and performs a bounded,
backup-preserving replacement under the selected prefix. Active-attempt
compatibility checks, signing, and full platform-specific upgrade/recovery
tests remain release-gate work.
