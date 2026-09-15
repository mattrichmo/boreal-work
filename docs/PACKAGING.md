# P4-05 packaging and release identity

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

## Exact commands

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

This is the bounded P4-05 identity/install rehearsal, not a complete release
pipeline. It does not compile Rust, hash platform binaries, resolve a TUI
package, create archives, sign artifacts, contact a registry, update a live
installation, pause active attempts, or migrate a project database. It does
not prove service restart, upgrade compatibility, migration rollback, or
cross-platform executable behavior. Cargo's workspace package version is read
from `Cargo.toml`, while `Cargo.lock`, source code, generated build output, and
the TUI are outside this asset identity by design and must be covered by the
later combined release gate.

The simulation is deliberately not an installer: its live target and rollback
backup are synthetic directories inside a caller-created temp directory. A
real install/update implementation must add atomic executable replacement,
active-attempt compatibility checks, backups, interruption recovery, signing,
and platform-specific tests before P4-05/P5 cutover can be closed.
