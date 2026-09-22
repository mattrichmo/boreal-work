# PF-S03-T05 corrective implementation attempt 3 — start

## Identity and bounded authority

- Task: `PF-S03-T05` — dependency satisfaction, graph, and reopen impact rules.
- Attempt: `3`; worker: bounded corrective implementation worker.
- Start: `2026-09-22T09:48:46Z` identity capture; implementation began after
  reading the task card and rejected attempt-2 review.
- Input tree: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty combined tree; `74` porcelain entries at final identity
  capture before this evidence directory was added. Existing unrelated changes
  remain read-only.
- Review boundary: this record requests independent re-review of PF-S03-T05
  only. It makes no task, sprint, service, native, publication, release, or
  acceptance claim.

## Required context read

- `AGENTS.md`, `project/README.md`, `project/build-plan/README.md`, the
  production-completion master plan, PF-S03 sprint, the complete PF-S03-T05
  card, and execution startup/write-boundary guidance.
- Rejected PF-S03-T05 attempt-2 `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and
  `HANDOFF.md`; attempt-1 evidence was retained for accepted-close/reopen
  behavior and source history.
- Current `crates/domain/src/dependencies.rs`,
  `crates/domain/tests/production_dependency_policy.rs`,
  `crates/domain/src/decision_inputs.rs`, and public registration in
  `crates/domain/src/lib.rs`.
- `project/spec/production/contract-manifest.json` and the dependency/override/
  reopen contract, plus the work-model v2 and scenario contracts.

## Review findings addressed

- `F-PF-S03-T05-01` / R1: add typed unreadable, corrupt, and stale prerequisite
  facts with raw context; retain malformed observations as per-edge typed
  diagnostics instead of aborting the whole evaluation; aggregate diagnostics
  fail closed.
- `F-PF-S03-T05-02` / R2: a waiver-revocation impact is valid only when the
  current observation for the exact edge is currently `EdgeSatisfaction::Waived`
  and the waiver applies at the evaluation revision.
- `F-PF-S03-T05-03` / R3: waiver-revocation structural impact is rooted at the
  revoked edge successor, so predecessor siblings are outside the preview.

## Write boundary and verification plan

Only these paths are changed by this attempt:

- `crates/domain/src/dependencies.rs`
- `crates/domain/tests/production_dependency_policy.rs`
- `project/validation/production/tasks/PF-S03-T05/attempt-3/`

`crates/domain/src/lib.rs` was read for public registration but not edited. The
focused test continues to use the public `boreal_domain::dependencies` module.
Verification is pure-domain focused/full tests, format, check, strict clippy,
and whitespace/diff checks. Boreal workflow probes are read-only only; the
local database owner was already held, so no state-changing command or lock
break is authorized.
