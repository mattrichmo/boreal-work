# Compatibility, Migration, And Rollback Policy

This is Boreal's support contract while the product is on the `0.x` release line. The machine-readable form is returned by `bwrk version --json` under `data.compatibility` and `data.migrationPolicy`.

## SemVer Contract

| Change | `0.x` policy | Required operator action |
| --- | --- | --- |
| Patch (`0.1.0` → `0.1.1`) | Backward-compatible fixes; no intentional persisted-schema or stable JSON break | Normal update; repo-pinned binary still wins |
| Minor (`0.1.x` → `0.2.0`) | May change pre-1.0 contracts, but must publish migration/rollback notes and retain a guarded compatibility path | Update machine launcher, then repo pin, then run `bwrk update repo` and strict health checks |
| Major (`1.x` and later) | Reserved for breaks to declared stable contracts | Explicit migration plan and recovery baseline required |

Human formatting may improve in patches. Stable JSON fields may only be added compatibly in a patch; removing, renaming, or changing their meaning requires at least a minor release during `0.x` plus migration notes. Persisted schema changes follow schema versions, not package version inference.

## Support Matrix

| Surface | Current | Compatibility mode | Failure behavior |
| --- | --- | --- | --- |
| Machine launcher vs repo pin | Same major/minor; patch skew allowed | A repo-pinned `node_modules/.bin/bwrk` always takes precedence | Major/minor skew is doctor-visible; a missing declared pin fails closed |
| Runtime records | `boreal.runtime.v1` | Read/write | Unknown runtime versions fail validation |
| Default storage | `objects-v1` | Read/write; one canonical file per record plus hash-linked log | Invalid records or log chains fail closed |
| Legacy storage | `boreal.file-store.v2` / `file-v2` | Read/write compatibility and rollback | Newer/unknown adapter schema fails closed |
| Legacy import | `boreal.file-store.v1` | Import-only migration input | Never selected as the active writer |
| Portable snapshot | `boreal.export.v1` | Recovery and content-parity boundary | Invalid records or references reject the import before mutation |
| Installed skills | `boreal.skill.v1` | Reinstalled from the repo-pinned version by `bwrk update repo` | `doctor skills` reports missing, stale, or noncanonical assets |
| Generated search/read data | Versioned SQLite/JSON schemas | Rebuild-only | Missing data is rebuilt when allowed; invalid/stale data fails under no-rebuild checks |

## Upgrade Order

1. Preserve or create a `boreal.export.v1` recovery snapshot for any nontrivial or non-reversible change.
2. Update the machine launcher only far enough to understand the repo pin and current schema.
3. Install the intended repo-pinned package with the frozen lockfile.
4. Run `bwrk version --json` and confirm the compatibility matrix before reading or mutating project state.
5. Run `bwrk update repo --json` for storage/skill migration, followed by `bwrk sync refresh --json`.
6. Run schema, docs, package, and strict doctor checks. Do not remove backups until content parity and rollback rehearsal pass.

## Migration Transaction Contract

Every nontrivial migration must expose the same phases:

1. **Preflight:** resolve the exact workspace, load and validate the source adapter, and report source/target kinds.
2. **Recovery boundary:** retain the source or create a timestamped backup/snapshot before switching the active marker.
3. **Target write:** write through the target adapter without changing domain semantics.
4. **Parity:** compare all record counts and the canonical snapshot content hash; verify the event-log chain where applicable.
5. **Activation:** update `.boreal/project.json` only after parity passes.
6. **Cleanup:** remove the old active file only after activation; retain the declared backup or source adapter for rollback.
7. **Verification:** reopen through the selected adapter and run schema plus strict health checks.

`bwrk storage migrate` returns `preflight`, `parity`, and `rollback` objects. File-to-object migration copies `state.json` to a timestamped backup before activation, then removes the active file after the marker changes. Object-to-file migration keeps the object store and log intact, so `bwrk storage migrate --to objects --json` is the inverse. A failed target write, parity check, event-log verification, or marker update must leave the prior selected source readable.

## Rollback Rules

- Reversible migrations must be idempotent and name the inverse command.
- Non-reversible migrations require a pre-mutation `boreal.export.v1` snapshot and a tested restore command.
- Rollback success means the portable snapshot content hash and record counts match the preflight source, not merely that the command exits zero.
- Generated indexes, projections, ledgers, and caches are rebuilt after rollback; they are never the recovery authority.
- A migration backup is not silently deleted by the migration that created it.

This policy applies alongside the [PolyForm Noncommercial License 1.0.0](../../LICENSE). Compatibility guarantees do not grant commercial-use rights or override the license terms.

## Cross-Platform Validation Baseline

`.github/workflows/technical-portability.yml` runs the supported Node 22 and Node 24 lines on Linux, macOS, and Windows. Every matrix cell installs from the frozen lockfile, type-checks, builds, exercises storage migration and rollback, validates failure diagnostics, packs the CLI, installs the tarball into a temporary prefix, probes the installed binary, and re-runs the secret/dependency/package-boundary audit. The Windows smoke path resolves npm's `bwrk.cmd` shim through `ComSpec`; Unix-like systems execute `<prefix>/bin/bwrk` directly.

This workflow creates and tests a temporary release artifact only. It contains no registry credentials or implicit publication step; publication remains an explicit release action governed by the repository license.
