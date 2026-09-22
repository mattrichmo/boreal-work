# Evidence

## Integrated operation/audit boundary

Root operation paths now preflight immutable identity before semantic writes
inside their caller-owned `BEGIN IMMEDIATE` transaction. The preflight covers
project, command, actor, session, expected revision, attempt, fence, request
digest, and audit subject, and uses the identity-bound operation journal when a
canonical project binding exists. Operation outcome and audit remain committed
through the existing atomic bundle seam.

Covered root commands include project/session registration and end, work
create/edit, dependency add/remove, hold add/resolve, claim, attempt
mutation, receipt, gate, review, summary, and close create/finalize/reject.

## Source fingerprints

```text
2fe705b937eaa42dc616d40c32dfb9cc5aef2bea2f90cf100a4abb3ec65307f1  crates/store/src/lib.rs
48cced783711e34139ebceaf1e2c2182cb13e22c458ede14b6f528c5298c218c  project/spec/schema-production.sql
4d9ff12b60c2a7e52cc2e81d09cce8d66ca6b87f1bd0b4f82ea1398b07f6ca11  crates/store/src/operations.rs
cd385824c2b4d7484333d8394a060cb07d9482fb3f55682dbe226ecf10d43623  crates/store/src/audit.rs
```

## Limitations

Direct operation writers in application knowledge/CLI paths and their
transport-level adapter tests are outside the protected write set. They must
be routed through the identity-bound journal on the next authorized
application integration pass; this attempt does not fabricate that coverage.

