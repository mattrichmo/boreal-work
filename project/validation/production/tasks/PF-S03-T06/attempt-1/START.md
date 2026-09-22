# PF-S03-T06 attempt 1 — implementation start

## Scope and input identity

- Task: `PF-S03-T06`, production-completion plan, implementation attempt 1.
- Worker: Codex implementation worker.
- Started: `2026-09-22T10:30:23Z` UTC.
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined
  worktree; unrelated worker changes are preserved.
- Granted production paths: `crates/domain/src/actions.rs` and
  `crates/domain/tests/production_action_policy.rs`.
- Granted evidence path: this directory only.
- Explicitly protected: `crates/domain/src/lib.rs`, all other production
  paths, plan/state ledgers, prior evidence, live databases, and legacy paths.

## Context loaded

Read before implementation:

- `AGENT_START.md`, `PARALLEL_DISPATCH.md`, `SHARED_FILES.md`, the PF-S03
  sprint card, PF-S03-T06 task card, and the validation playbook.
- Accepted/reviewed PF-S03-T01/T02/T03/T04/T05 handoffs and their bounded
  evidence; the prerequisite leaf states are coordinator-recorded as accepted
  for their stated scopes, while PF-S03 sprint acceptance remains open.
- `project/spec/production/contract-manifest.json` and the accepted status,
  identity/revision, execution/submission, acceptance/proof, dependency,
  service, and reason contracts.
- `project/spec/transition-table.md`, `project/DECISIONS.md`, and current TUI
  action helpers in `apps/tui/src/client.ts`.

Relevant source identities at start:

| Source | SHA-256 |
| --- | --- |
| `crates/domain/src/decision_inputs.rs` | `24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d` |
| `crates/domain/src/status_evaluator.rs` | `a2bbe9d64569f1be5f34cc2ab1c51d62b1ad45e9a2141dca3727c23efc2afcac` |
| `crates/domain/src/time_policy.rs` | `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58` |
| `crates/domain/src/acceptance.rs` | `6680f089ef262923359ea90c4c99a99b7db7147465d14160d154fe37a4ece4c4` |
| `crates/domain/src/dependencies.rs` | `43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112` |
| `crates/domain/src/lib.rs` (read-only context) | `460b6e4dcd8e365b1318a32d9d11f80238418259550717e90d497ce25ced1bed` |
| `apps/tui/src/client.ts` | `68c626c72f938f38623578c3e2e3d5b1c2a2f410890da64ef7ff53e38ece27ed` |

## Interpreted invariant and implementation boundary

The domain must produce one deterministic action vocabulary, descriptor, and
allowed/denied result from typed canonical facts. Decisions must bind the
authenticated principal and resolved role/delegation, project/entity/proof
revisions, attempt/fence, active hold scope, availability/integrity, typed
status/reasons, and safe recovery routes. A ready work item may deny one actor
without changing status. A blocked item must deny forward claim/close while
retaining safe stop/history/recovery paths when a current attempt or recovery
obligation exists. No adapter or client status string is an authority input.

The module will be pure and transport-free. The focused test will initially
use a local source-path shim because the requested shared `lib.rs` registration
is coordinator-owned and cannot be edited by this worker. The shim is only a
compile/test aid and is paired with an exact integration request in the final
handoff.

## Baseline and verification strategy

- Baseline source has no `actions.rs` or `production_action_policy.rs`; the
  current TUI helper still derives affordances from display status and is
  read-only presentation code, not an authority boundary.
- Add focused pure-domain positive, negative, revision/fence, scope, role,
  delegation, hold, blocked-recovery, ready-actor, and determinism cases.
- Run focused test/checks, full `boreal-domain` test/check/clippy, workspace
  formatting, and `git diff --check`; preserve any unavailable or unrelated
  failures as evidence.
- No service, store, native, publication, or acceptance claim is in scope.

## Expected shared integration request

The coordinator/domain steward must add `pub mod actions;` to
`crates/domain/src/lib.rs` and change the focused test to import
`boreal_domain::actions::*` after removing its source-path shim. The
registration is additive and public; no other root export or protocol/schema
change is requested. The steward must rerun the focused test and combined
domain checks on the integrated source identity.

