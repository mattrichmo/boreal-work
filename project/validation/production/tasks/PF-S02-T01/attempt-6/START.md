# PF-S02-T01 — Attempt 6 independent validation review

- Task: ordered schema migration and invariant verification.
- Review scope: the integrated production migration contract only.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: 2026-09-22 (America/Regina); review completed 2026-09-22.
- Input source: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree.
- Reviewer: Codex, independent of the attempt-1 through attempt-5 implementation
  workers; no lifecycle/plan state was changed.
- Review subject hashes:
  - `crates/store/src/migrations.rs` —
    `0fd57ed2c6b55484fda4dfe5fb5ac8dc46274dd968a7acfbeb52c9a5f32eb356`
  - `crates/store/src/lib.rs` —
    `d37571e9bd1a4cc5f8b6deb4320a30e4442a8c6fb62a1e903086df7622984f00`
  - `project/spec/schema-production.sql` —
    `3fd0d323955cf4d52ec06cf366fdf7abe47ac0a27b4ac2768492b5835095e1cf`
  - `crates/store/tests/production_migrations.rs` —
    `1ce88e223dd281e2cdba25a85b64db86715a24b4354b8c4e10ddd826f34e6922`
  - `crates/store/tests/schema_v3.rs` —
    `33f5af81f88c0b8adc7ca45af8bab18465b4d84a6a16d64cbf419e96dc4dc83c`
  - `crates/store/tests/storage_remediation.rs` —
    `8248710cced546476cc857fed38c29f429e6550f22a33efd09c9355d67df442c`
  - `crates/store/tests/store_contracts.rs` —
    `9c28197b7fe4dd928dff78c68f83fa38dbef8e7faa8da2429a8b3086fd1385e2`

## Review boundary

Read in full: the PF-S02-T01 card, PF-S02 sprint, production-completion
startup/dispatch/validation guidance, the migration vertical handoff, the
attempt-1 through attempt-5 handoffs and evidence, current migration/store
open paths, `schema-production.sql`, and the relevant store tests. The
reviewed contract covers fresh create, ordered v2-to-v3 upgrade, rollback and
retry, idempotent reopen, identity/checksum/ledger verification, legacy-v2
repair without row loss, newer-version rejection, live-attempt exclusion, and
explicit legacy-v3 compatibility.

## Interpreted invariant

The public production open boundary must perform one ordered, fail-closed,
identity-bound migration protocol. Preflight and migration exclusion must
cover every schema mutation, failed work must leave the prior canonical schema
usable with retained recovery evidence, and every supported legacy fixture
must have explicit integrated compatibility proof. Focused fake-backend tests
are useful unit evidence but cannot substitute for the real `SqliteStore`
boundary.

## Initial disposition

`REJECTED` for this leaf review. The required formatting and store test
commands pass, but the source review found a mandatory live-attempt exclusion
ordering defect and the required integrated legacy-v3/production-negative
fixtures are absent. Findings and exact limitations are recorded in
`EVIDENCE.md`; this is not acceptance of PF-S02-T01's sprint, service, native,
publication, or release scope.
