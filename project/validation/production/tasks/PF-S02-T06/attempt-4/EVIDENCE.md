# Evidence

## Integrated store boundary

- Terminal attempt mutation and close finalization retain unresolved recovery
  obligations and request durable canonical resource release in the same
  caller-owned transaction.
- Production v2→v3 migration now installs the external-job identity guard at
  the ordered migration boundary; fresh production schema and legacy-v3
  metadata repair verify the same guard.
- Existing `recovery.rs` and `jobs.rs` APIs remain the authoritative bounded
  resource/job seams; no application or CLI adapter was edited.
- Production open/upgrade/reopen continues to install/verify database and
  migration identity records before canonical consequential writes.

## Source fingerprints

SHA-256 fingerprints at handoff:

```text
2fe705b937eaa42dc616d40c32dfb9cc5aef2bea2f90cf100a4abb3ec65307f1  crates/store/src/lib.rs
48cced783711e34139ebceaf1e2c2182cb13e22c458ede14b6f528c5298c218c  project/spec/schema-production.sql
eb6b10356e8adf5c87dd9ed6ef0bbb6750fc4c83b7e537174c34d469bd16aa49  crates/store/src/jobs.rs
a30b0c8cac868e2376aee0f186bfffd69d37f696f175ecfb21421d59058f76f8  crates/store/src/recovery.rs
```

## Limitations

The protected write set does not include application/service/CLI/external
effect adapters. Their existing integration requests remain open: verifier,
Git, backup, update, stop, and publication callers must register and read back
external jobs through the identity-bound store APIs, and service-level restart
and real adapter tests must be rerun on the combined tree.

