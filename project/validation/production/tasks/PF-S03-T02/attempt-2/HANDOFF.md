# Task handoff — PF-S03-T02 independent validation attempt 2

## Identity and disposition

- Task / plan / attempt: `PF-S03-T02` / production-completion plan / `attempt-2`.
- Reviewer: Codex independent validation reviewer; did not implement the
  PF-S03-T02 product source or tests.
- Independent decision: **rejected for PF-S03-T02 acceptance**.
- Decision scope: PF-S03-T02 only; no sprint, service, native, publication,
  or release decision is made.
- Input/final combined source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`,
  branch `codex/apply-responsive-terminal-overlay`, dirty worktree.
- Accepted prerequisite: PF-S03-T01 attempt 2 handoff, bounded to its typed
  decision-input artifact and public domain boundary; SHA-256 is recorded in
  `EVIDENCE.md`.
- Coordinator state: `STATE.json` was read-only and not edited. This handoff
  is not a coordinator acceptance receipt.

## Review-written paths

Only these files were written:

- `project/validation/production/tasks/PF-S03-T02/attempt-2/START.md`
- `project/validation/production/tasks/PF-S03-T02/attempt-2/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T02/attempt-2/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T02/attempt-2/HANDOFF.md`

No product code, product test, contract, plan JSON, `STATE.json`, prior
evidence, or unrelated file was edited.

## Audited outcome

The integrated source passes the worker's six focused vectors, all fresh domain
package tests, formatting, compilation, and strict all-targets clippy. It does
not yet satisfy the complete bounded invariant:

1. `PF-S03-T02-R1`: an already-terminal `AttemptPhase::Expired` still selects
   `ExpiredReview`, but elapsed-clock secondary reasons are lost because the
   source emits them only from `live_attempt`.
2. `PF-S03-T02-R2`: failed technical proof or rejected review can become
   `Ready`/`Claim` when no current attempt is present, because proof facts are
   interpreted only in `Verifying`/`Completed` and the input boundary has no
   retained submission/review fact.

Both findings are preserved precisely in `EVIDENCE.md`, with source ranges,
expected contract behavior, impact, and bounded corrective ownership. No
finding file was created because the user-authorized write set is limited to
the four attempt-2 evidence files.

## Validation receipt summary

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | Passed, exit `0`. |
| `cargo check --locked -p boreal-domain --tests` | Passed, exit `0`. |
| `cargo test --locked -p boreal-domain --test production_status_precedence` | `6 passed, 0 failed`, exit `0`. |
| `cargo test --locked -p boreal-domain` | `68 passed, 0 failed`, `0` doc tests, exit `0`. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | Passed, exit `0`. |
| `git diff --check -- crates/domain/src/status_evaluator.rs crates/domain/tests/production_status_precedence.rs` | Passed, exit `0`. |

Exact source and contract hashes are in `EVIDENCE.md`; exact command argv and
the typed workflow `service_busy` result are in `COMMANDS.md`.

## Impact and next safe action

- Schema/migration: no change by this review.
- Protocol/service/native/publication/release: not run and not claimed.
- Authority/history: prior worker failures and evidence remain preserved; no
  live lock was broken.
- Next safe action: reconcile PF-S03-T02 with a bounded corrective attempt for
  R1 and R2, then rerun the listed focused/full/format/check/strict-clippy
  commands on the corrected combined source. Only after that evidence is
  independently reviewed should the coordinator proceed through the named
  PF-S03 review/reconciliation/revalidation chain.

- [x] No test/run/service/native/release success was inferred or fabricated.
- [x] Failed and unsupported observations are preserved.
- [x] All review writes fit the authorized attempt-2 evidence directory.
- [x] The decision is attributable, bounded to PF-S03-T02, and separate from
      coordinator acceptance.

