# PF-S02-T10 attempt 2 start

- Scope: implement the bounded persistent pinned-requirement storage seam.
- Write boundary: `crates/store/src/profiles.rs`,
  `project/spec/schema-production.sql`, and focused tests in
  `crates/store/tests/production_profile_requirements.rs`.
- Explicit exclusions: no root `SqliteStore` wiring, no plan state or manifest
  edits, and no unrelated source changes.
- Acceptance target: immutable project/work/proof-revision declarations with
  profile identity/digest, gate identity, subject kind, provenance, and
  idempotent persistence; conflicting re-pins must be rejected; deletion of
  observed gate rows must not erase declarations.
- Validation target: focused store tests and formatting, with exact remaining
  root-wiring limitations recorded in the handoff.

