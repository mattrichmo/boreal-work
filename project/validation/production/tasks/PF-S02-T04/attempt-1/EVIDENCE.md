# PF-S02-T04 — Attempt 1 evidence

## Record identity

- Task: `PF-S02-T04`; attempt: `1`.
- Evidence class: store contract / pure deterministic requirement audit.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined tree.
- Granted production paths: `crates/store/src/profiles.rs`.
- Granted test path: `crates/store/tests/production_profile_requirements.rs`.
- Required acceptance row: AC-06 (bounded implementation evidence only).
- Host: Darwin ARM64; Rust/Cargo 1.85.0; Python 3.14.3.
- Shared integration base hashes: `crates/store/src/lib.rs`
  `e353bd204b59f90aca94a5040b8561d958c5824aed4bea80231457ce4dcc3817`;
  `project/spec/schema-production.sql`
  `3fd0d323955cf4d52ec06cf366fdf7abe47ac0a27b4ac2768492b5835095e1cf`.

## Implemented invariant

`ProfileVersion::from_canonical_definition` computes a deterministic SHA-256
digest over canonical JSON and rejects drift. `ProfileRegistry` rejects
conflicting content under an existing profile/version while allowing exact
replay. `PinnedRequirements` resolves a profile into an immutable, digest-bound
task or container declaration set with profile provenance and required/optional
gate flags. `audit_observations` compares observations after the declaration
set is loaded, so deleting an observed gate leaves a missing-required finding.
`classify_legacy_definition` quarantines `{}` without authoritative provenance
and permits reconstruction only from a non-empty authoritative definition.

## Focused observations

The six-test target passed:

- same-version profile conflict and exact replay;
- distinct task/container subjects and sibling profile versions;
- required declaration retained after observation deletion;
- profile digest drift detected before recency can matter;
- empty legacy definition quarantine/reconstruction;
- malformed JSON and unverified digest rejection.

These are deterministic store-contract checks. They do not prove durable
SQLite persistence because the protected root/schema integration is not part of
this worker's granted write set.

## Explicit integration limitation

The current root method `SqliteStore::ensure_acceptance_profile` still uses an
`ON CONFLICT(profile_id, version) DO NOTHING` insert and the current
`create_work_in_transaction` path still creates `{}` plus observed `gate` rows.
The new module therefore provides the production contract and conflict/audit
logic, but cannot claim that the current durable path has adopted it. The
following shared/schema work is required before coordinator acceptance:

1. In `crates/store/src/lib.rs`, replace conflict-blind profile insertion with
   a transaction-local read/compare: identical profile/version/digest/canonical
   definition is idempotent; any differing content returns typed `Conflict`.
2. Add a versioned migration/schema table for pinned requirements keyed by
   `(project_id, work_id, proof_revision, requirement_id)`, carrying subject
   kind, profile ID/version/digest, gate declaration, verifier/subject/
   observable/review/exception policies, provenance and resolved digest. The
   schema steward must add the migration/manifest/checksum; this worker did not
   edit those protected files.
3. In the root create/publish transaction, resolve and insert
   `PinnedRequirements` for both task and container subjects. Changing a
   parent/default profile must not update existing rows.
4. In root status/claim/close reads, load the pinned declarations first and
   compare gate observations against them. Missing/deleted observations produce
   diagnostics; missing/ambiguous profile provenance quarantines the affected
   work and never produces a zero-gate or accepted result.
5. Add root/application readback tests for restart, deleted observations,
   profile-default changes, legacy reconstruction, and same-version conflict.

Until those changes are integrated and independently reviewed, this task is
`awaiting_integration`, not accepted.
