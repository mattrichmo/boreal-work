# PF-S02-T10 recovery contract fixture — attempt 22

## Scope

- Task: `PF-S02-T10` recovery/resource contract fixture remediation.
- Attempt: `attempt-22`.
- Input: current combined worktree, including PF-S02-T10 attempt-21R recovery behavior.
- Allowed source path: `crates/store/tests/store_contracts.rs`.
- Allowed evidence paths: this `attempt-22/` directory.

## Contract under test

The plain recovery API must fail closed for `resource_state = released`. A
released resolution must use the authenticated identity-bound API and prove the
exact project, work, attempt, fence, canonical reservation, and durable terminal
release evidence before making the resource reusable.

The existing stale-fence, old-attempt, cancellation, recovery-obligation, and
monotonic replacement-claim assertions remain in the fixture.

## Guardrails

- No production behavior was weakened.
- No plan or state ledger was edited.
- No commit or push was performed.
- No path outside the allowlist was intentionally edited for this attempt.
