# PF-S02-T02 — Attempt 1 implementation start

## Identity and scope

- Task / attempt: `PF-S02-T02` / `attempt-1`.
- Worker: Codex implementation worker; independent review and coordinator
  acceptance are not claimed here.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: 2026-09-22 (America/Regina); source checks recorded through
  `2026-09-22T09:14:46Z`.
- State requested: `awaiting_integration`.
- Exclusive write set:
  - `crates/store/src/transactions.rs`
  - `crates/store/src/profiles.rs`
  - `crates/store/src/execution.rs`
  - `crates/store/src/operations.rs`
  - `crates/store/src/acceptance.rs`
  - `crates/store/tests/production_store_seams.rs`
  - `project/validation/production/tasks/PF-S02-T02/attempt-1/`
- Protected and unchanged by this worker: `crates/store/src/lib.rs` and all
  other production paths.

## Source and prerequisites

- Branch: `codex/apply-responsive-terminal-overlay`.
- Input `HEAD`: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Worktree: dirty before this attempt; unrelated changes were preserved.
- PF-S02-T01 prerequisite: accepted for T01 only by
  `project/validation/production/tasks/PF-S02-T01/attempt-8/HANDOFF.md` and
  `EVIDENCE.md` at the same dirty source identity.
- Sprint entry PF-S01-T92: accepted for its AC-01 contract/provenance gate
  only; it does not authorize runtime, service, or release claims.
- Contract manifest: `project/spec/production/contract-manifest.json`,
  SHA-256
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
- The accepted inputs bind identity/revision/authority, execution and safe
  release, status/action separation, acceptance/profile pinning,
  dependency/reopen truth preservation, and service/readback semantics.

The Boreal project-context probe identified project `boreal-work`, but
`bwrk prime --project boreal-work --json` returned `service_busy` because the
coordinator process already owned the project database. No live lock was
broken and no runtime state was changed.

## Invariant interpreted before editing

The store needs named, disjoint seams that preserve existing behavior while
making later persistence work independently writable:

1. One transaction owner opens/commits/rolls back a bounded operation; nested
   `BEGIN` ownership is not introduced, and a commit error remains available
   for operation readback.
2. Profile versions retain immutable identity, digest, and JSON definition;
   the seam does not evaluate gate satisfaction.
3. Evidence execution retains project/work/attempt/fence/gate identity and
   admitted/running/exited/unknown lifecycle through existing store methods;
   it does not spawn processes or authorize status.
4. Operation plus audit facts append within a caller-owned transaction, and
   project-scoped readback cannot cross project identity.
5. Acceptance reads bind the exact profile/attempt context and expose canonical
   gate diagnostics; requirements, observations, and lifecycle policy remain
   outside SQL.

## Baseline captured

Before implementation on this combined dirty tree:

- `cargo fmt --all -- --check`: exit 0 at `2026-09-22T08:59:20Z`.
- `cargo test --locked -p boreal-store --test production_store_seams`:
  exit 101 because the target did not yet exist.
- `cargo test --locked -p boreal-store`: exit 0; 87 passed, 1 intentional
  release benchmark ignored, 0 failed.
- `git diff --check`: exit 0.

## Expected integration and verification

The coordinator must register the five modules in `crates/store/src/lib.rs`
under its shared-file lease, then run the combined-tree seam target and full
store package. The current focused test mounts the protected source files
directly so the worker can compile and exercise them without editing `lib.rs`;
after root registration, the coordinator should switch that test to the root
module exports and rerun it against the integrated source.

Verification covers direct formatting of the exclusive files, the focused
real-`SqliteStore` seam target, migration/remediation/contract/claim/status/
session regressions, the full store package, and diff whitespace. Repository-
wide formatting is recorded separately when unrelated dirty paths fail it.
