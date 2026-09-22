# PF-S03-T05 independent re-review attempt 4 — start

## Review identity and boundary

- Task: `PF-S03-T05` — dependency satisfaction, graph, and reopen impact rules.
- Reviewer: independent re-reviewer; no production implementation changes.
- Review started: `2026-09-22T09:55:31Z`.
- Exact input tree: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; `74` porcelain entries before this attempt-4 directory was
  created. Existing unrelated changes remain read-only.
- Decision scope: PF-S03-T05 only. This record makes no sprint, service,
  native, publication, or release acceptance claim.

## Prior evidence and context loaded

- The complete rejected attempt-2 records were preserved and read:
  `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md`.
- The complete corrective attempt-3 records were preserved and read:
  `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md`.
- The PF-S03-T05 task card, PF-S03 sprint, project/build-plan guidance,
  `project/spec/production/dependencies-overrides-reopen.md`,
  `project/spec/WORK_MODEL_V2.md`, `project/spec/WORK_MODEL_SCENARIOS.md`,
  `project/spec/production/contract-manifest.json`,
  `crates/domain/src/decision_inputs.rs`, and the public registration in
  `crates/domain/src/lib.rs` were read.
- Attempt-2 findings F-PF-S03-T05-01, F-PF-S03-T05-02, and
  F-PF-S03-T05-03 are the only corrective findings in scope.

## Current implementation reviewed

- `crates/domain/src/dependencies.rs`
- `crates/domain/tests/production_dependency_policy.rs`
- `crates/domain/src/lib.rs` public `dependencies` registration
- `crates/domain/src/decision_inputs.rs`

The current source and focused-test SHA-256 identities exactly match the
attempt-3 identities recorded in `COMMANDS.md`; the contract identities also
remain unchanged. The review therefore reruns the gates on the same exact
combined source identity and independently rechecks the three corrections.

## Correction checks

1. Unreadable, corrupt, and stale prerequisites must retain typed raw
   diagnostics; malformed observations must remain per-edge diagnostics and
   must fail closed for progress eligibility.
2. Waiver revocation must require the current matching edge-scoped waiver and
   `EdgeSatisfaction::Waived` at the evaluation revision.
3. Waiver-revocation affected subgraphs must root at the revoked edge
   successor, exclude predecessor siblings, and preserve accepted-close
   identity/reopen impact behavior.

## Validation plan

Run on the exact current combined tree and record argv, exit status, source
identity, and relevant output:

- `cargo fmt --all -- --check`
- `cargo test --locked -p boreal-domain --test production_dependency_policy`
- `cargo test --locked -p boreal-domain`
- `cargo check --locked -p boreal-domain --tests`
- strict domain clippy with `-D warnings`
- `git diff --check`

Read-only Boreal workflow and candidate probes are permitted for review
context. No lock will be broken and no lifecycle, ledger, or `STATE.json`
mutation is authorized.

## Write boundary

This review may write only:

- `project/validation/production/tasks/PF-S03-T05/attempt-4/START.md`
- `project/validation/production/tasks/PF-S03-T05/attempt-4/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T05/attempt-4/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T05/attempt-4/HANDOFF.md`

Production source, `project/build-plan/production-completion/execution/STATE.json`,
attempt-1/attempt-2/attempt-3 evidence, and all unrelated dirty paths are
read-only.
