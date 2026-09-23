# PF-S02-T06 — attempt 5 evidence

## Disposition

**Bounded implementation pass; PF-S02-T06 remains unaccepted.**

This attempt concretely remediates the production backup/restore rejection for
databases whose state is fully contained in the SQLite file. It does not claim
that external blobs or Git-published memory are packaged, nor that every
PF-S02-T06 external adapter has a durable job/readback integration.

## Exact source identity

- Current HEAD at evidence capture:
  `d760806fed4fecdfdfc016649bdec0a4b0a63630` (`fix: close production identity recovery and backup seams`)
- Worktree is dirty because unrelated/concurrent work remains present.
- SHA-256 of the scoped implementation/test files at capture:

```text
264e2ff4d360d91180b0b024d57faa8692bd58dfcdaea6761c210c0e287f02ba  crates/store/src/lib.rs
4f3fca5310b6127afa19b7ba3fff66583ce379d4191e921173f7576a8ce9cf6f  crates/store/tests/runtime_backup.rs
983f912a894ebeb916c3e04d6f241764926ac95345d37ebc1d0a3eeb7b47e73d  crates/store/tests/production_backup_restore.rs
5c78e8e0d6a7bb328d13f2ea6b422ff43229eeff550bb9fa894c6dafe6ecc4e9  crates/cli/src/main.rs
53bc2b831f0e4e0a5cff3924f36724a199e66c8b1c57cf8af381f2554be61994  crates/cli/src/command_registry.rs
dd9d33b90f85da20b826c01467969a62b8d8a10df3a6ccb3ed1eb21a8ab62365  crates/cli/tests/production_backup_restore.rs
```

## Implementation

- `SqliteStore::backup_package_to` creates a new package directory containing
  `database.sqlite` and `manifest.json`.
- The database is copied with SQLite’s online backup API and normalized to a
  standalone rollback-journal snapshot before read-only validation.
- The manifest records the production schema ID/version/checksum, SQLite
  runtime identity, database instance/restore epoch, every project workspace
  binding, referenced blob rows, and published memory publication/Git revision
  references.
- `SqliteStore::restore_package_to` validates the package and copied snapshot,
  rejects incompatible schema/identity/project bindings, stages a new copy,
  advances the database instance and restore epoch, invalidates old operation
  identity and fences through `IdentityStore::restore`, and atomically swaps
  the destination.
- An existing destination is retained as
  `<database>.pre-restore-<epoch>`; it is never silently deleted.
- CLI `bwrk backup PACKAGE_DIR --db PATH` and
  `bwrk restore PACKAGE_DIR --db PATH` acquire the database maintenance
  election, return structured JSON, and are discoverable through `bwrk
  commands`.

## Acceptance observations

| Requirement | Result |
| --- | --- |
| Consistent SQLite snapshot | pass for production package route; online backup plus standalone journal normalization |
| Project/database identity binding | pass; manifest and copied snapshot are cross-checked |
| Restore epoch/fence invalidation | pass; restore uses the existing identity restore primitive and assigns a new lineage ID/epoch |
| Atomic destination replacement | pass in focused round-trip; staged file is renamed only after validation, old destination retained |
| Schema/runtime compatibility | pass; manifest schema checksum/version/contract and runtime floor are checked |
| Incompatible or corrupted manifest | pass; rejected before destination creation |
| Blob and Git-memory references | intentionally fail closed; recorded in manifest and restore is blocked without an artifact bundle |
| CLI route and maintenance exclusivity | pass in the public CLI test; direct maintenance election prevents racing the service |
| Durable asynchronous backup/restore operation readback | not implemented in this slice; the supported route is synchronous under the maintenance election |

## Focused test evidence

- Store production package tests: 3/3 passed.
- Existing raw/runtime backup tests: 4/4 passed.
- CLI package backup/restore test: 1/1 passed.
- Full `boreal-store`: passed.
- Full `boreal-cli`: passed.

The scoped implementation is present in the concurrent integration commit
`d760806f`. This attempt did not create or push a commit.
- Targeted store and CLI Clippy with `-D warnings`: passed.
- Changed-file rustfmt and diff checks: passed.

No receipt, operation, memory publication, or external blob was fabricated.
