# PF-S02-T03 — Attempt 1 implementation start

## Scope and attribution

- Task / attempt: `PF-S02-T03` / `attempt-1`.
- Worker: Codex implementation worker; no independent acceptance or coordinator
  decision is claimed.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: 2026-09-22 (America/Regina).
- Granted write paths: `crates/store/src/identity.rs`,
  `crates/store/tests/production_identity_revisions.rs`, and this attempt
  directory only.
- Explicitly protected: `crates/store/src/lib.rs`, schema manifests/migrations,
  plan/ledger state, prior evidence, live databases, and all other production
  paths.

## Input/source identity

- `HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Worktree: dirty before this attempt; the existing `crates/store/src/lib.rs`
  modification is pre-existing and was not edited by this worker.
- Current `crates/store/src/lib.rs` SHA-256:
  `f3efd3db72cae5250c1b5a7b6a9d2f8c03abbc28e0c01a63b5821977cfb0ffb6`.
- Accepted prerequisite source/evidence identity:
  - PF-S02-T01 attempt-8 handoff/evidence: source `HEAD` above; handoff
    SHA-256 `d252f2dae4f750dc9918a477f2fe22110aec02dd98f18f67f9595e139d40a318`;
    evidence SHA-256
    `88092358584a4e38d64d9cbb1c68360a453c6745755d889c661965d8fde7c167`.
  - PF-S02-T02 attempt-4 handoff/evidence: source `HEAD` above; handoff
    SHA-256 `53267f3a565b14c4bdfefac4eefbe6fbd7210ce81b188ce420c4221ae3ad520c`;
    evidence SHA-256
    `0feb23d93cfe8cc97f9e8f5ebb359e5d8bf5367dc199681c9842f1167d94ed84`.
- Contract manifest SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Identity contract SHA-256:
  `e18956613421ee98086e0aee9bfa2cf8f3b8768d7d95df4c50502516cf4da52f`.
- Concurrency contract SHA-256:
  `e5173bb3dd187d27756ab797a8f5bf9c561e98ff08b5801d956d2924878c1a65`.
- Interfaces contract SHA-256:
  `db9d5da087cd89e1dcc954810d3eed3f76c52ccd35932355ee8a14baa5a7cbe4`.
- Task card SHA-256:
  `408a653786624df890c155976c16f5e1aee83e769eeb6a7cc93583db9d56a08f`.

## Loaded dispatch context

Read before editing: `AGENTS.md`, `project/README.md`,
`project/build-plan/README.md`, `MASTER_PLAN.md`,
`project/build-plan/production-completion/execution/AGENT_START.md`,
`PARALLEL_DISPATCH.md`, `SHARED_FILES.md`, PF-S02 `SPRINT.md`, the complete
PF-S02-T03 card, the production validation playbook/matrix, the contract
manifest and identity/concurrency/interface contracts, plus accepted PF-S02-T01
attempt-8 and PF-S02-T02 attempt-4 handoffs/evidence. The Boreal runtime
context probe `bwrk prime boreal-work --json` returned typed `service_busy`
because the existing database owner was live; no lock was broken and no
state-changing workflow command was attempted.

## Baseline and interpreted invariant

The current store has one `project.project_revision` cursor and uses it for
project and work expected-revision checks. Attempt `fence` is persisted, but
the current mutation path also checks expected work/project revisions against
that single project cursor. There is no identity module, identity migration,
workspace/database binding record, or focused PF-S02-T03 test in the current
tree.

This attempt will add a store-owned identity boundary that persists:

1. one database instance and strictly positive restore epoch;
2. project-scoped canonical workspace-root/worktree binding metadata;
3. separate project snapshot, per-work entity, and per-work proof revisions;
4. project/work/attempt/fence composite identity rows with foreign-pairing
   protection; and
5. operation-epoch provenance plus explicit invalidation on restore and legacy
   revision migration.

All SQLite integer reads/writes will use checked signed/unsigned conversion.
Heartbeat/liveness updates will verify project, epoch, subject, and current
fence but will not advance the project/entity/proof revisions. Entity and proof
mutations will check and return typed stale details containing only the current
same-project relevant revision. Foreign subject probes will return a scoped
isolation error without exposing the foreign project identifier or rows.

Legacy `project_revision` values will be copied into distinct entity/proof
cursors with a migration provenance record; ambiguous pending operation
contexts will be marked invalidated while historical rows remain retained.
Restore will advance the database lineage, invalidate old operation contexts,
and revoke old fence identities so a late client cannot regain authority.

## Actual writer paths and planned implementation

- `identity.rs` owns additive identity tables, identity migration/repair,
  binding/context reads, revision/fence checks, liveness update, restore
  invalidation, and typed errors. Its mutation methods are non-owning: they
  require the coordinator/root to have opened the write transaction and leave
  commit/rollback and any canonical project-revision policy to that owner.
- `production_identity_revisions.rs` uses the real `SqliteStore` and exercises
  migration, heartbeat isolation, wrong project/epoch, stale entity/proof/fence,
  restore invalidation, and foreign composite pairing.
- Coordinator-only integration request: register `pub mod identity;` in
  `crates/store/src/lib.rs`; invoke `IdentityStore::install` from the
  canonical production-open/migration transaction; and call the non-owning
  `bind_project`, `advance_entity`, `advance_proof`, `record_attempt_fence`,
  `heartbeat`, `record_operation_context`, and `restore` methods inside their
  existing root-owned write transactions. Do not wrap these calls in a second
  `BEGIN`; the identity module deliberately has no commit/rollback owner.
  Reconcile typed `IdentityError` variants into the versioned root/application
  error mapping, and rerun the focused target against the registered public
  module (`boreal_store::identity`) on the combined tree. No schema file is
  changed by this worker; the additive identity DDL is owned by `identity.rs`
  and must be wired by the steward at the same migration boundary as the
  accepted T01/T02 store seams.

## Verification strategy

Before implementation, the baseline is the source inspection above; no
PF-S02-T03 runtime behavior exists to claim. After implementation I will run:

- scoped `rustfmt --edition 2021 --check` for the two assigned Rust files;
- `cargo test --locked -p boreal-store --test production_identity_revisions`
  if the coordinator-owned module registration is present; otherwise preserve
  the exact compile limitation and run the available library/full-store checks
  without claiming the focused target;
- `cargo test --locked -p boreal-store` or the strongest available scoped
  equivalent, `cargo check --locked -p boreal-store`,
  `cargo fmt --all -- --check`, and `git diff --check`;
- exact source/artifact hashes, command argv/cwd, toolchain, timestamps,
  exit codes, and retained limitations in `COMMANDS.md`, `EVIDENCE.md`, and
  `HANDOFF.md`.

This is implementation evidence only. Acceptance remains with independent
review/reconciliation/revalidation and the coordinator.
