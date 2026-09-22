# PF-S03-T05 attempt 1 — implementation start

## Scope and source identity

- Task: `PF-S03-T05` — dependency satisfaction, graph, and reopen impact rules.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: `2026-09-22T09:05:08Z`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; `git status --porcelain=v1` reported 70 entries at start.
- Rust: `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`; Cargo `1.85.0`.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
- Dependency contract SHA-256: `3543fb5f1c3af51304826c66e02a3eb10dd0c1972cc35e77585c1b43a5a0a151`.

## Accepted prerequisites read

- PF-S01-T92 attempt 3 handoff: `ba94da456f397b9250a9fde5a55ad6c4479834bfd55af6c4fc0dbeb22ef84e2a`.
- PF-S03-T01 attempt 2 handoff: `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
- PF-S03-T04 attempt 4 handoff: `9f2fbe7a8535e10934d70ab7b119e2e0657a83214047be500ebac2ab9aed427d`.
- These records accept only their bounded prerequisite artifacts; they do not accept this task or the PF-S03 sprint.

## Exclusive write set

This worker may write only:

- `crates/domain/src/dependencies.rs`
- `crates/domain/tests/production_dependency_policy.rs`
- `project/validation/production/tasks/PF-S03-T05/attempt-1/`

`crates/domain/src/lib.rs` is shared and remains coordinator-owned. No other production path, plan/ledger file, live database, prior attempt, or unrelated dirty path will be edited.

## Interpreted invariant and intended change

The pure dependency boundary must validate one project-local DAG whose edges connect only direct tasks; reject missing/foreign/non-direct endpoints, duplicate IDs or endpoint pairs, self-edges, and cycles deterministically independent of insertion order. A default edge is satisfied only by an exact, current, non-revoked accepted closed outcome identity; `complete`, `verified`, `cancelled`, stale/unaccepted, and revoked outcomes remain unsatisfied. A waiver is a durable exception for exactly one edge revision and successor scope, with validity/revocation checked at evaluation revision while the raw unmet prerequisite remains visible. Reopen/revocation impact is a pure preview: it identifies deterministic direct/transitive affected subgraphs, classifies pending/active/historically closed successors, and never rewrites historical facts.

## Baseline observation

`cargo test --locked -p boreal-domain --test production_dependency_policy` exited `101` because the requested test target did not exist. Existing `work_model_v3` and legacy `lib.rs` dependency helpers are not treated as acceptance of this bounded production policy; the new module and focused test will exercise the stronger contract and request public registration from the coordinator.

## Planned verification

Run the focused dependency target, all domain tests, formatting, domain checks, strict domain clippy where applicable, and `git diff --check`. Record exact argv, cwd, exit code, source hashes, toolchain, limitations, and the coordinator `lib.rs` integration request in the final evidence files. No task acceptance will be claimed.
