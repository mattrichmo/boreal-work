# PF-S03-T08 — attempt 1 start

## Identity

- Task: `PF-S03-T08` — property, differential and exhaustive transition tests.
- Plan: `PF-production-completion-2026-09-21`.
- Input revision: `codex/apply-responsive-terminal-overlay` at `784a41b3802c29a76721c55eef2e9493283396c2`.
- Worktree: dirty combined tree; all pre-existing modifications and prior evidence are preserved.
- Worker: bounded validation worker (Codex).
- Start time: `2026-09-22T11:26:17Z`.

## Granted write boundary

- `crates/domain/tests/production_properties.rs`
- `project/validation/production/domain/`
- `project/validation/production/tasks/PF-S03-T08/attempt-1/`

No shared integration path is anticipated. `crates/domain/src/lib.rs`, manifests,
protocol/schema registries, task state, and prior evidence are read-only for this
attempt. Any source/API gap will be recorded as a bounded finding rather than
expanded outside the grant.

## Prerequisites and context

The accepted bounded prerequisite reviews for PF-S03-T02 through PF-S03-T07 and
PF-S01-T92 were read before this attempt. Their accepted leaf decisions do not
constitute sprint or release acceptance. The frozen status, transition, proof,
dependency, timer, action, rollup, identity, and service contracts remain the
oracle for this pure-domain test layer.

## Interpreted invariant

For the same canonical facts, actor, policy version, project/revision identity,
and evaluation time, the pure domain decision is deterministic and independent
of input ordering or unrelated historical facts. Terminal outcomes remain stable
unless an explicit reopen/impact decision is present. Exact deadline equality is
expired; only accepted closed outcomes satisfy default dependencies; invalid,
foreign, stale, rejected, or incomplete facts cannot become trusted success;
actor-specific actions and legal/illegal transition predicates remain bounded by
their declared authority and scope.

## Baseline observation before edits

- `cargo test --locked -p boreal-domain --test production_properties` was not
  runnable because the proposed test target did not yet exist (exit `101`).
- The current domain production tests were present and their source APIs were
  inspected. This attempt does not treat their prior receipts as this attempt's
  validation.
- Source hashes at start are recorded in `COMMANDS.md` and the handoff.

## Planned work and verification

1. Add a deterministic, seed-driven property/differential/exhaustive test target
   using public domain APIs only.
2. Cover status/reason ordering and idempotence; timer boundaries; dependency
   satisfaction, graph cycles and isolation; evidence/review invariance;
   actor-action decisions; legal/illegal transition surfaces; and explicit
   reopen/terminal exceptions.
3. Record deterministic seeds and minimal counterexample data under the owned
   validation directory if a check fails.
4. Run `cargo fmt --all -- --check`, the focused target, full domain tests, and
   strict domain clippy where possible. Results will be recorded without
   converting fixture/pure evidence into service acceptance.

