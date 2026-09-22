# PF-S03-T07 attempt 1 — start checkpoint

## Task and source identity

- Task: `PF-S03-T07` — implement container scope and cycle rollup primitives.
- Worker: Codex implementation worker.
- Started: `2026-09-22` (America/Regina).
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, dirty shared
  worktree on `codex/apply-responsive-terminal-overlay`.
- Contract manifest: `project/spec/production/contract-manifest.json`, source
  identity `784a41b3802c29a76721c55eef2e9493283396c2` as recorded by the
  production plan.

## Loaded prerequisites and scope

- Read `AGENT_START.md`, `PARALLEL_DISPATCH.md`, `SHARED_FILES.md`, the
  PF-S03 sprint/task cards, the project/build-plan entry points, and the
  current `AGENTS.md`.
- Read accepted bounded prerequisite evidence for PF-S03-T01 attempt 2,
  PF-S03-T04 attempt 4, and PF-S03-T05 attempt 4, plus their preserved failed
  attempts where referenced.
- Read the work-model v3/scenario/status material and the production planning,
  acceptance, dependency, and status/action contracts.
- Allowed production/test paths: `crates/domain/src/rollups.rs` and
  `crates/domain/tests/production_rollup_policy.rs` only.
- Allowed evidence path: this attempt directory only.
- Shared integration path explicitly excluded: `crates/domain/src/lib.rs`.

## Interpreted invariant

Pure rollups must be bound to an exact project/scope revision and count only
the canonical facts supplied for that snapshot. Accepted closed outcomes,
accepted cancellations, deferred scope, replacements, active work, gate or
review gaps, overdue work, blockers, incomplete descendants, and corrupt
descendants remain separate. Containers and cycles are planning/closeout
projections and never become claimable. A corrupt or incomplete descendant
must prevent a trusted 100% accepted result while valid siblings remain
countable.

## Baseline observation

The requested focused test target did not exist before this attempt:
`cargo test --locked -p boreal-domain --test production_rollup_policy` exited
`101` with `error: no test target named production_rollup_policy`.

## Planned verification

Add deterministic pure-domain fixtures for deferred cycle scope, queued
container work, corrupt descendants, exact totals, and optional integration
closeout tasks. Run the focused test, full domain tests, formatting/check,
clippy, and whitespace/diff checks. Record exact command outcomes in the
attempt evidence without changing shared registration or claiming acceptance.
