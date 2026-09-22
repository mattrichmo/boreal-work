# Evidence

## Production integration result

- Canonical production open/upgrade/reopen continues through the ordered
  migration boundary, installs persistent database identity when absent, and
  verifies schema/migration identity before consequential writes.
- The v2→v3 migration, fresh production schema, and legacy-v3 metadata repair
  all provide the external-job append-only identity guard.
- Root terminal attempt/close paths retain unresolved recovery obligations and
  durable release requests until an authenticated acknowledgement/resolution.
- Profile pinning, observation deletion, profile drift, malformed pinned
  content, and legacy empty definitions remain fail-closed through the
  existing profile seam; the full profile suite passed.
- Root operation replay uses immutable identity and the operation/audit bundle
  in the caller-owned transaction; operation/audit failure rolls back semantic
  state.

## Source fingerprints

```text
2fe705b937eaa42dc616d40c32dfb9cc5aef2bea2f90cf100a4abb3ec65307f1  crates/store/src/lib.rs
48cced783711e34139ebceaf1e2c2182cb13e22c458ede14b6f528c5298c218c  project/spec/schema-production.sql
c709d56e7f4cbe02eb84a7a2e6a5911ed71c6b3c3d2c4684ba8888bab9f59e2b  crates/store/src/profiles.rs
a30b0c8cac868e2376aee0f186bfffd69d37f696f175ecfb21421d59058f76f8  crates/store/src/recovery.rs
eb6b10356e8adf5c87dd9ed6ef0bbb6750fc4c83b7e537174c34d469bd16aa49  crates/store/src/jobs.rs
```

## Bounded blockers

The full PF-S02 integration remains bounded by out-of-scope application/service
and CLI paths: external verifier/Git/backup/update/stop/publication adapters
still need canonical job admission/readback wiring, and combined real restart,
deletion, migration, replay, rollback, and concurrency coverage must be run
after those paths are integrated. No source outside the protected write set
was changed to fabricate that completion.

