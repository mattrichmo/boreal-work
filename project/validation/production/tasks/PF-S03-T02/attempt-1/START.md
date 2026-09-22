# PF-S03-T02 attempt 1 — start record

## Task and input identity

- Task: `PF-S03-T02` — implement exhaustive status precedence and reason ordering.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty before this attempt; unrelated changes are preserved.
- Toolchain: `rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)`, `cargo 1.85.0`.
- Host: Darwin arm64.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Accepted PF-S03-T01 handoff: `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md`, SHA-256 `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.

## Prerequisite and bounded invariant

PF-S03-T01 attempt 2 accepts the typed decision-input artifact and its
integrated public domain boundary only. This task consumes that accepted
handoff and the `boreal.work-status/3` / transition contracts without
reopening settled policy. It does not claim sprint, service, runtime, native,
publication, or release acceptance.

The bounded invariant is that one pure evaluator collects all applicable typed
domain facts before selecting the primary status; status precedence is
independent from secondary reason ordering; expiry wins the expiry-versus-hold
tie while retaining both causes; failed technical proof, rejected review, and
missing review remain distinct; unordered facts normalize deterministically;
and each selected branch supplies the corresponding safe next action.

## Exclusive write set

This attempt may edit only:

- `crates/domain/src/status_evaluator.rs`
- `crates/domain/tests/production_status_precedence.rs`
- `project/validation/production/tasks/PF-S03-T02/attempt-1/`

No edit was made to `crates/domain/src/lib.rs`,
`project/build-plan/production-completion/execution/STATE.json`, PF-S03-T01
prior evidence, manifests, store/application/service code, or unrelated paths.
No shared integration request is currently needed: the evaluator is already
publicly re-exported by the existing domain root, and Cargo auto-discovers the
new integration test target. Any later public API change belongs to the
coordinator as a separate integration request.

## Verification strategy

The focused production test covers paused plus prerequisite, expiry plus hold
with both elapsed clocks, hard-reason priority, failed proof versus rejected
review versus missing review, permutation invariance across holds/prerequisites/
gates/dependents, and next-action selection across draft/retry/queue/pause/
operator-only/attempt/proof branches. Existing M02 status tests and the full
domain package are rerun on the final dirty source. Failed intermediate
commands and the busy workflow probe are retained in `COMMANDS.md`.

## Runtime coordination note

Read-only `bwrk prime boreal-work --json` and workflow-resolution probes returned
typed `service_busy` because the local database owner is
`process:68913:sha256:37e8ffb92bd9e159abd0e6909a484f6a9e0c1b0dc3451a9129bb4f74d6f5df8`.
No lock was broken and no lifecycle/evidence mutation was attempted. This
attempt therefore records pure-domain evidence only.
