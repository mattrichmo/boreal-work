# PF-S03-T04 attempt 3 — corrective implementation handoff

## Identity and requested state

- Task / plan / attempt: `PF-S03-T04` / production-completion plan / `attempt-3`.
- Source: HEAD `784a41b3802c29a76721c55eef2e9493283396c2`, branch `codex/apply-responsive-terminal-overlay`, dirty combined tree.
- Requested state: `ready_for_review`.
- Review scope: reconcile only F-PF-S03-T04-01 and F-PF-S03-T04-02 from rejected attempt 2.
- Independent reviewer: required; this handoff is not the independent review.

## Implemented behavior

1. Exact evidence with `Superseded`, `Late`, or `Revoked` disposition is
   excluded from authoritative recency before the newest current observation
   is selected. Those observations remain historical diagnostics. Current
   failed, stale, and altered results remain authoritative.
2. `AcceptanceInput` carries the explicit typed `current_submission_id`.
   Reviews must match the exact proof subject and this sealed submission
   identity before selection. A newer review for another submission is
   irrelevant/unsatisfied. Self-review rejection and reviewer-role
   authorization remain in force.

## Changed files

- `crates/domain/src/acceptance.rs`
- `crates/domain/tests/production_acceptance_policy.rs`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/START.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/HANDOFF.md`

`crates/domain/src/lib.rs`, `STATE.json`, all prior evidence, and unrelated
paths were not edited by this attempt. The public module registration already
present in `lib.rs` remains the integration boundary.

## Validation

- `cargo fmt --all -- --check` — exit `0`.
- `cargo check --locked -p boreal-domain --tests` — exit `0`.
- `cargo test --locked -p boreal-domain --test production_acceptance_policy` — exit `0`, 12 passed.
- `cargo test --locked -p boreal-domain` — exit `0`, 73 passed, 0 doc tests.
- Strict focused and library clippy with `-D warnings` — exit `0` for both.
- `git diff --check` — exit `0`.

See `COMMANDS.md` and `EVIDENCE.md` for exact identities and regression
coverage.

## Review request and limits

Please perform independent exact-tree review/revalidation of the two repaired
findings. This handoff reports `ready_for_review`; it does not report
acceptance, sprint completion, service behavior, native installation,
publication, or release readiness.
