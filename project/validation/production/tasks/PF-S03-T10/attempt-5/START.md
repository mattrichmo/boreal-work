# PF-S03-T10 — attempt 5 start record

## Scope and identity

- Task: `PF-S03-T10` — complete deterministic oracle coverage for status and transitions.
- Attempt: `5` (new; prior attempts remain preserved).
- Input source: `codex/apply-responsive-terminal-overlay@70514f0e`.
- Worktree: current combined checkout, dirty only by the pre-existing nested `memory/` runtime tree at start.
- Worker: PF-S03-T10 deterministic-oracle remediation steward.
- Reviewer: independent reviewer required after this bounded handoff.

## Exclusive write boundary

This attempt may change only:

- `crates/domain/tests/production_properties.rs`
- `project/validation/production/domain/`
- `project/validation/production/tasks/PF-S03-T10/attempt-5/`

It will not edit `STATE.json`, the plan graph, production implementation crates, contracts, manifests, or prior evidence.

## Findings being repaired

The prior PF-S03-T08/T10 attempts were rejected because the oracle used duplicated identity literals, did not make scheduled status executable, did not map each normative legal/illegal vector to semantic assertions, and did not cover the full pure-domain history/recovery/reopen invariance boundary. The previous T08 attempt also overlapped this oracle scope; PF-S03-T10 is the sole owner for the repaired oracle.

## Intended invariant

Pure-domain tests must fail when the accepted policy artifacts or current source identity drift, must exercise the real status/action/transition APIs for every pure-domain vector, and must retain reproducible serialized counterexamples. Service, store, authentication, verifier, release, and persistence claims remain explicitly out of scope.

## Verification plan

1. Bind policy/contract hashes and source identity to actual repository artifacts at test time.
2. Add executable scheduled-start, availability, integrity, action allow/deny, transition, and history/recovery/reopen checks without asserting provisional policy as normative.
3. Run the focused target, full `boreal-domain` tests, strict domain clippy, owned rustfmt, contract validation, and `git diff --check`.
4. Record exact commands/results and hand off for independent review; do not self-accept, update the live ledger, commit, or push.
