# PF-S02-T01 — Attempt 8 independent re-review start

## Scope and attribution

- Task / attempt: `PF-S02-T01` / `attempt-8`.
- Reviewer: Codex, independent re-reviewer; did not implement the PF-S02-T01
  correction and did not edit product source, tests, `STATE.json`, prior
  evidence, or unrelated paths.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started and completed: 2026-09-22 (America/Regina).
- Review boundary: PF-S02-T01 only. No sprint, service, native, publication,
  successor, or release decision is made here.

## Source identity

- Branch: `codex/apply-responsive-terminal-overlay`.
- `HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Worktree: dirty before review; unrelated existing changes were preserved.
- Reviewed hashes:
  - `crates/store/src/lib.rs` — `403f81b0b3b8a255b3fe13a410ae1f5e4412338cc5831e2fd3b9ce93167151c9`
  - `crates/store/src/migrations.rs` — `0fd57ed2c6b55484fda4dfe5fb5ac8dc46274dd968a7acfbeb52c9a5f32eb356`
  - `crates/store/tests/production_migrations.rs` — `3f748f475f5deaa96cbab3510529922777d9672bf83fab6d97f992103cf81ed5`
  - `crates/store/tests/schema_v3.rs` — `33f5af81f88c0b8adc7ca45af8bab18465b4d84a6a16d64cbf419e96dc4dc83c`
  - `crates/store/tests/storage_remediation.rs` — `8248710cced546476cbab3510529922777d9672bf83fab6d97f992103cf81ed5`
  - `crates/store/tests/store_contracts.rs` — `9c28197b7fe4dd928dff78c68f83fa38dbef8e7faa8da2429a8b3086fd1385e2`
  - `project/spec/schema-production.sql` — `3fd0d323955cf4d52ec06cf366fdf7abe47ac0a27b4ac2768492b5835095e1cf`

## Required prior evidence read

- Rejected attempt-6 findings, evidence, commands, and handoff.
- Corrective attempt-7 start, evidence, commands, and handoff.
- PF-S02 sprint/task card, production dispatch/evidence rules, current
  `crates/store/src/lib.rs` migration paths, `crates/store/src/migrations.rs`,
  `project/spec/schema-production.sql`, and all integrated production
  migration tests.

## Review questions

1. Does the public v2 path acquire the writer exclusion and run live-attempt
   preflight before any `repair_schema_v2` write?
2. Do real `SqliteStore` tests, rather than generic fake-backend tests alone,
   cover identity/checksum/ledger, newer-version rejection, live attempts,
   rollback/failure, legacy-v3 metadata repair, and partial metadata rejection?
3. Do the requested fresh checks and focused production targets pass on this
   exact combined source identity?

No lifecycle mutation or acceptance-state edit is part of this review.
