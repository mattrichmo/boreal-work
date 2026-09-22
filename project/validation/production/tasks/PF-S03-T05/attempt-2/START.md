# PF-S03-T05 independent review attempt 2 — start

## Review identity and boundary

- Task: `PF-S03-T05` — dependency satisfaction, graph, and reopen impact rules.
- Reviewer: independent reviewer; no production implementation changes.
- Review started: `2026-09-22T09:26:58Z`.
- Exact input tree: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; 74 porcelain entries before this evidence directory was
  created. The existing dirty tree is in scope for exact-tree verification;
  unrelated paths remain read-only.
- Review decision scope: PF-S03-T05 only. This record makes no sprint,
  service, native, publication, or release acceptance claim.

## Accepted prerequisites and evidence loaded

- Accepted PF-S03-T01 bounded handoff:
  `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md`.
- Accepted PF-S03-T04 bounded handoff:
  `project/validation/production/tasks/PF-S03-T04/attempt-4/HANDOFF.md`.
- Prior PF-S03-T05 worker evidence loaded in full from
  `project/validation/production/tasks/PF-S03-T05/attempt-1/`:
  `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md`.
- Governing task card, sprint/master-plan context, production contract
  manifest, dependency/override/reopen contract, work-model v3 contract,
  work-model scenarios, and transition table were read before review.

## Current implementation under review

- `crates/domain/src/dependencies.rs`
- `crates/domain/src/lib.rs` public `dependencies` registration
- `crates/domain/tests/production_dependency_policy.rs`
- Related work-model implementation/contracts and transition fixtures are
  read-only review context.

The review will specifically verify project scope, direct-task endpoint
restriction, deterministic duplicate/self/cycle rejection, accepted-closed-only
prerequisite satisfaction, edge-scoped waiver validity/revocation with raw
unmet context, pending/active/historical successor impact after reopen or
revocation, and canonical affected-subgraph output. It will also inspect the
separation from planning ordering and cycle-assignment relations.

## Validation plan

Run on the exact current combined tree, recording argv, cwd, exit status,
toolchain, source identity, and relevant output:

- `cargo fmt --all -- --check`
- `cargo test --locked -p boreal-domain --test production_dependency_policy`
- `cargo test --locked -p boreal-domain`
- `cargo check --locked -p boreal-domain --tests`
- strict domain clippy with `-D warnings`
- `git diff --check`

The Boreal review workflow and PF-S03-T05 candidate read probes were attempted
read-only; each returned typed `service_busy` because the local database owner
was already held. No lock was broken and no lifecycle/ledger mutation was
attempted.

## Write boundary

This review may write only the four files in this attempt directory:
`START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md`. Production source,
`project/build-plan/production-completion/execution/STATE.json`, prior evidence,
and unrelated dirty paths are read-only.
