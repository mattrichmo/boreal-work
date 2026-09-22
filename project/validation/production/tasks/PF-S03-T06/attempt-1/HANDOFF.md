# PF-S03-T06 attempt 1 — implementation handoff

## Identity and disposition

- Task / plan / attempt: `PF-S03-T06` / production-completion plan / `attempt-1`.
- Worker: Codex implementation worker.
- State requested: `awaiting_integration` / ready for independent review after
  the shared public registration is applied.
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined
  worktree.
- Prerequisite context: coordinator-recorded accepted PF-S03-T01/T02/T03/T04/
  T05 leaf scopes and accepted PF-S01-T92 AC-01 contract scope, as described in
  their preserved handoffs. PF-S03 sprint acceptance remains open.
- This is a worker handoff, not coordinator acceptance and not a claim of
  PF-S03-T06 acceptance.

## Exact changed paths and invariant

Worker-owned production source/test:

- `crates/domain/src/actions.rs`
- `crates/domain/tests/production_action_policy.rs`

Attempt evidence:

- `project/validation/production/tasks/PF-S03-T06/attempt-1/START.md`
- `project/validation/production/tasks/PF-S03-T06/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T06/attempt-1/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T06/attempt-1/INTEGRATION-REQUEST.md`
- `project/validation/production/tasks/PF-S03-T06/attempt-1/HANDOFF.md`

The module is a pure policy boundary. It consumes authenticated authority,
typed role/delegation, project/entity/proof revisions, current attempt/fence,
hold scope, availability/integrity, typed status/reasons, and explicit
permitted-action ceilings. It emits deterministic action descriptors and
allowed/denied decisions with stable causes and safe recovery routes. Blocked
work denies claim/close but permits safe stop/history/recovery where canonical
facts establish an attempt or recovery obligation. Ready work remains ready
when a particular actor lacks role/policy authority. No status string is used.

## Shared integration request

The coordinator/domain steward must add `pub mod actions;` to
`crates/domain/src/lib.rs` and replace the focused test's source-path shim with
`use boreal_domain::actions::{...}`. The exact patch and required reruns are in
`INTEGRATION-REQUEST.md`. The worker confirms the read-only `lib.rs` hash stayed
`460b6e4dcd8e365b1318a32d9d11f80238418259550717e90d497ce25ced1bed` during this
attempt.

## Validation

| Check | Result |
| --- | --- |
| `rustfmt --edition 2021 --check` on both owned Rust files | Passed, exit 0. |
| `cargo test --locked -p boreal-domain --test production_action_policy -- --test-threads=1` | Passed, 7 tests, exit 0. |
| `cargo check --locked -p boreal-domain --tests` | Passed, exit 0. |
| `cargo test --locked -p boreal-domain` | Passed, 116 tests, 0 doc tests, exit 0. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | Passed, exit 0. |
| `cargo fmt --all -- --check` | Passed on the final exact-tree rerun, exit 0. An earlier pre-final probe observed unrelated drift at `crates/store/tests/production_identity_revisions.rs:284`; this worker did not edit that path. |
| `git diff --check` | Passed, exit 0. |

The focused test uses the temporary source-path shim until the shared
registration is integrated. No service, store, verifier, native, publication,
or release evidence was run or inferred. Boreal workflow probes were
read-only and returned typed `missing project identifier` / `service_busy`; no
lock was broken and no lifecycle state was changed.

## Impact and residual work

- Schema/migration: none.
- Protocol/transport: no DTO or manifest change; public domain module
  registration is pending coordinator integration.
- Authority/isolation/security: typed project scope, role/delegation, proof and
  fence checks are fail-closed in the pure policy; committing transactions must
  reread canonical facts and call the same policy.
- History/recovery: safe routes preserve inspect/history/readback and typed
  recovery/repair paths; no evidence or attempt records are mutated here.
- Client impact: the existing TUI helper remains presentation-only until a
  later service/protocol integration replaces its mutation affordance source.
- Known limitation: public `lib.rs` registration and combined public-boundary
  reruns remain outstanding. The unrelated store test path remains outside this
  worker's ownership even though the final workspace formatting check passed.
- Next safe action: coordinator applies `INTEGRATION-REQUEST.md`, records the
  combined source identity, assigns independent review, and runs the required
  exact-tree revalidation. Do not mark this handoff or PF-S03 accepted from
  this worker evidence alone.

- [x] No test/service/native/release success was inferred or fabricated.
- [x] Failed/blocked formatting and workflow observations are retained.
- [x] All production edits fit the granted boundary; `lib.rs` was not edited.
- [x] Shared public registration is explicitly requested but not claimed as
      integrated.
- [x] Coordinator acceptance and PF-S03 review/reconciliation/revalidation
      remain separate required actions.
