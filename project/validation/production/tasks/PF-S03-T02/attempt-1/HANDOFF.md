# PF-S03-T02 attempt 1 — handoff

## Identity and disposition

- Task / plan / attempt: `PF-S03-T02` / production-completion plan / `attempt-1`.
- Worker: Codex implementation worker.
- State requested: `ready_for_review`.
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, branch
  `codex/apply-responsive-terminal-overlay`, dirty worktree.
- Accepted prerequisite: PF-S03-T01 attempt 2 handoff, bounded to typed
  decision inputs and its integrated public domain boundary.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Final owned source identities:
  - `crates/domain/src/status_evaluator.rs` SHA-256
    `1eba7eb050489a5a433e11f62486854d8400db3932c5eac7640068129f0474f9`.
  - `crates/domain/tests/production_status_precedence.rs` SHA-256
    `48e31ece43e9e73ca9b73b370fc8eab2c30af7eed4f1dd7e6e51c97b58c7a0e6`.

This is a bounded worker handoff, not PF-S03-T02 coordinator acceptance and not
PF-S03 sprint acceptance.

## Exact changed files and invariant

Product source/test:

- `crates/domain/src/status_evaluator.rs`
- `crates/domain/tests/production_status_precedence.rs`

Attempt evidence:

- `project/validation/production/tasks/PF-S03-T02/attempt-1/START.md`
- `project/validation/production/tasks/PF-S03-T02/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T02/attempt-1/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T02/attempt-1/HANDOFF.md`

The evaluator now separates status precedence from stable secondary reason
ordering, retains combined facts, applies the expiry-over-hold tie, chooses
hard primaries by explicit intervention/configuration priority, distinguishes
failed proof/rejected review/missing review, normalizes unordered facts, and
returns the matching safe next action. The test target verifies these cases
and the full existing domain suite remains green.

No shared integration patch is requested. `crates/domain/src/lib.rs` already
re-exports `evaluate_status`; the new integration target is auto-discovered by
Cargo. Any later change to the public typed-input API should be recorded as a
separate coordinator integration request rather than added here.

## Validation summary

| Command | Result |
| --- | --- |
| `cargo fmt --all -- --check` | Passed, exit `0`. |
| `cargo check --locked -p boreal-domain --tests` | Passed, exit `0`. |
| `cargo test --locked -p boreal-domain --test production_status_precedence` | 6 passed, 0 failed, exit `0`. |
| `cargo test --locked -p boreal-domain` | 68 passed, 0 failed, 0 doc tests, exit `0`. |
| `cargo clippy --locked -p boreal-domain --test production_status_precedence -- -D warnings` | Passed, exit `0`. |
| `cargo clippy --locked -p boreal-domain -- -D warnings` | Passed, exit `0`. |
| `git diff --check -- crates/domain/src/status_evaluator.rs crates/domain/tests/production_status_precedence.rs` | Passed, exit `0`. |

The first focused assertion mismatch and first owned-file clippy failure are
retained in `COMMANDS.md` and were resolved before final evidence. No service,
runtime, genuine verifier, migration, race/fault, native, publication, or
release command was run or claimed.

## Impact and residual work

- Schema/migration: none.
- Protocol/transport: none; this is a pure domain evaluator/test change.
- Authority/isolation/history: no persistence or authority boundary changed;
  the evaluator preserves current attempt/fence visibility and failed/rejected
  proof distinctions for later application/store integration.
- Known limitation: `StatusContext` remains the existing domain boundary; the
  accepted T01 typed-input module is not newly wired into a different public
  evaluator API in this bounded task. A public API integration need must be a
  reviewed shared-file request.
- Runtime limitation: the local Boreal workflow adapter was busy; no live lock
  was broken and no state/evidence mutation was attempted.
- Required next work: independent PF-S03-T90 review, PF-S03-T91 reconciliation,
  and PF-S03-T92 exact-tree revalidation. Later PF-S03-T03/T04/T05/T06 tasks
  must extend clocks, requirements/evidence/review interpretation, dependency
  rules, and action authority; this handoff does not claim those areas.

- [x] No test/run/service/native/release success was inferred or fabricated.
- [x] Failed intermediate results and history are retained.
- [x] All changed paths fit the granted boundary; `lib.rs`, `STATE.json`, and
      PF-S03-T01 prior evidence were not edited.
- [x] Acceptance criteria are linked to focused/full checks; coordinator and
      independent review acceptance remain separate.
