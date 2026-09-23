# Task handoff — PF-S03-T09 / attempt 2

## Identity and disposition

- Task: `PF-S03-T09`
- Attempt: `2`
- Input commit: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`
- Final combined source: dirty working tree, file-bound by `EVIDENCE.md`
- State: `bounded_bridge_ready_for_independent_review`
- Commit/push: none

## Changed files

- `crates/application/src/status.rs`
- `crates/cli/src/main.rs`
- `crates/cli/src/service.rs`
- `apps/tui/src/client.ts`
- `apps/tui/src/test.ts`
- this attempt's evidence files

No domain policy source, store core, plan, ledger, state, or `memory/` file was
changed by this bounded bridge. Existing worker changes outside this list were
not used as acceptance evidence.

## Before/after

Before, application status exposed the domain status hint while the TUI
reconstructed supported action availability from status, gates, and attempt
labels. The domain action evaluator existed only in pure-domain tests.

After, application rows carry the domain action decision and the service DTO
exposes structured descriptors and denials. The TUI uses those descriptors when
present and preserves a clearly bounded compatibility fallback for older
responses. Public claimability is read from the same action decision, closing
the status/action disagreement at this boundary.

Because the legacy store row lacks v3 entity/proof/authentication facts, the
bridge marks action context unavailable, redacts unknown identity revisions,
and denies mutating actions. This is deliberate fail-closed behavior, not a
fabricated proof implementation.

## Validation summary

- Application status tests: **8 passed**.
- Application strict Clippy: **passed**.
- CLI status DTO test: **1 passed**.
- TUI typecheck: **passed**.
- TUI suite: **98 Node tests passed** plus mounted workflow assertions.
- `git diff --check`: **passed**.
- Full `cargo fmt --all -- --check`: **not clean** because unrelated dirty
  store files require formatting; changed Rust files were formatted directly.
- Full workspace Rust, service-backed lifecycle, release, and native terminal
  validation: **not run** by this bounded attempt.

## Review boundaries and next safe action

Independent review must verify that no redacted/unknown revision is treated as
authorization, that current service responses always include the unavailable
context until the store facts exist, and that the TUI never falls back when a
current response includes an action set. The next implementation owner is the
store/application identity seam owner for the six residual requests in
`EVIDENCE.md`; PF-S03-T90/T91/T92 remain required.

This handoff does not claim PF-S03 acceptance, service authentication,
rejected-review projection, expiry recovery projection, corruption isolation,
or production mutation authorization.
