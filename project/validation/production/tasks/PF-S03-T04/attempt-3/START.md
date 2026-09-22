# PF-S03-T04 attempt 3 — corrective implementation start

## Identity and scope

- Task / plan / attempt: `PF-S03-T04` / production-completion plan / `attempt-3`.
- Implementer: Codex corrective implementation agent.
- Review target: the two rejected findings from attempt 2 only.
- Requested disposition after implementation: `ready_for_review`.
- Review date: `2026-09-22`.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Toolchain: Rust/Cargo `1.85.0`.

The prior attempt-2 independent review rejected this leaf for two P1 findings:
invalidated exact observations could shadow valid proof during recency selection,
and review selection was not bound to the sealed/current submission identity.
Attempt-2 evidence and handoff remain untouched.

## Interpreted invariant

Only an exact, currently valid observation may participate in authoritative
recency selection. Superseded, late, and revoked exact observations remain
historical diagnostics but cannot replace an older valid pass. A current
failed, stale, or altered observation remains the authoritative result.

Review approval is a decision over the exact current sealed submission. A
review for another submission is irrelevant and unsatisfied, even when newer;
self-review rejection and reviewer-role authorization remain unchanged.

## Exclusive write set

Only these paths are written by this attempt:

- `crates/domain/src/acceptance.rs`
- `crates/domain/tests/production_acceptance_policy.rs`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/`

The following remain unedited: `crates/domain/src/lib.rs`, `STATE.json`, prior
attempt evidence, service/runtime state, native artifacts, publication data,
release data, and unrelated paths.

## Verification strategy

Add a required `current_submission_id` to `AcceptanceInput`; filter review
candidates by exact subject and that identity before recency and policy
evaluation. Split exact evidence into authoritative `Current` observations and
invalidated historical observations before sorting; emit diagnostics for every
invalidated exact observation. Add focused regressions for all three
invalidating dispositions and for a newer approval belonging to another
submission, then run the requested domain checks and strict clippy profiles.
