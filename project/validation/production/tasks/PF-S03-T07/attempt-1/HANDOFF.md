# PF-S03-T07 attempt 1 — handoff

## Identity and disposition

- Task / plan / attempt: `PF-S03-T07` / production-completion plan /
  `attempt-1`.
- Worker: Codex implementation worker.
- State requested: `awaiting_integration` / `ready_for_review`.
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, dirty branch
  `codex/apply-responsive-terminal-overlay`.
- Prerequisites read: accepted bounded PF-S03-T01 attempt 2, PF-S03-T04
  attempt 4, PF-S03-T05 attempt 4, and the production planning, acceptance,
  dependency, status, work-model, and scenario contracts.
- Coordinator acceptance: not claimed and not recorded by this worker.

## Exact changed paths

Production/test paths written by this attempt:

- `crates/domain/src/rollups.rs`
- `crates/domain/tests/production_rollup_policy.rs`

Evidence paths written by this attempt:

- `project/validation/production/tasks/PF-S03-T07/attempt-1/START.md`
- `project/validation/production/tasks/PF-S03-T07/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T07/attempt-1/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T07/attempt-1/HANDOFF.md`

No other path was edited by this task. In particular, `crates/domain/src/lib.rs`
was not edited.

## Implemented behavior

`rollups.rs` supplies pure revision-bound primitives for task, container, and
cycle scope. It keeps accepted closed outcomes separate from accepted
cancellation, deferred, and replaced reconciliation; aggregates active work,
gate/review gaps, overdue work, blockers, incomplete descendants, and corrupt
descendants; retains exact assignment counts; and reports optional integration
closeout state. Containers and cycles are explicitly non-claimable, and
untrusted percentages fail closed.

## Exact public registration/import integration request

The coordinator/domain integration steward must apply this shared-file patch on
the combined tree:

```diff
diff --git a/crates/domain/src/lib.rs b/crates/domain/src/lib.rs
@@
 pub mod dependencies;
+pub mod rollups;
 pub mod time_policy;
```

Then replace the worker-only test shim at the top of
`crates/domain/tests/production_rollup_policy.rs` with the registered public
boundary:

```diff
diff --git a/crates/domain/tests/production_rollup_policy.rs b/crates/domain/tests/production_rollup_policy.rs
@@
-pub use boreal_domain::*;
-
-#[path = "../src/rollups.rs"]
-#[allow(dead_code)]
-mod rollups;
+use boreal_domain::rollups::*;
+use boreal_domain::{
+    DerivedStatus, GateId, PersistedLifecycle, ProjectId, TimestampMs, WorkId,
+};
@@
-use rollups::*;
```

The existing `boreal_domain::decision_inputs` and
`boreal_domain::work_model_v3` imports remain unchanged. Required steward
verification after this patch:

1. `cargo test --locked -p boreal-domain --test production_rollup_policy`
   exercises `boreal_domain::rollups`, not a duplicate source-path module.
2. `cargo check --locked -p boreal-domain --tests` and
   `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` run on
   the combined tree.
3. `cargo fmt --all -- --check`, full `cargo test --locked -p boreal-domain`,
   and `git diff --check` are rerun after reconciling the unrelated dirty test
   and formatting blockers recorded in `COMMANDS.md`.

## Validation and limits

The focused target passed 5 tests and focused strict clippy passed. Library
check/test/clippy passed. The final broader checks were blocked by unrelated
dirty changes in `crates/domain/tests/production_action_policy.rs` and
`crates/store/tests/production_identity_revisions.rs`; no files outside this
task boundary were changed to clear them. Full command details and hashes are
in `COMMANDS.md` and `EVIDENCE.md`.

No schema, protocol, store, application, service, CLI, TUI, migration,
publication, or release change is claimed. No task acceptance is claimed.

## Next safe action

The integration steward should apply the shared registration/import patch,
rerun the required combined-tree checks, and hand the exact integrated source
to an independent PF-S03-T90/T92 review path. This worker's pure-domain result
does not close or accept PF-S03-T07.

- [x] No test/run/peer/native success was inferred or fabricated.
- [x] Failures and current-tree blockers are preserved.
- [x] All production/test changes fit the granted boundary.
- [x] Shared registration is requested precisely and remains unapplied.
- [x] Coordinator acceptance remains a separate state action.
