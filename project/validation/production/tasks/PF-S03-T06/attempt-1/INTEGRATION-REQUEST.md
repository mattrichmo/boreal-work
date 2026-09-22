# PF-S03-T06 — coordinator integration request

Apply this additive shared-file patch on the combined tree. The worker did not
edit `crates/domain/src/lib.rs`.

```diff
diff --git a/crates/domain/src/lib.rs b/crates/domain/src/lib.rs
@@
 pub mod acceptance;
+pub mod actions;
 pub mod decision_inputs;
```

Then update the worker-owned focused test to use the public boundary:

```diff
diff --git a/crates/domain/tests/production_action_policy.rs b/crates/domain/tests/production_action_policy.rs
@@
-pub use boreal_domain::{
-    decision_inputs, ActorId, ActorRole, AttemptPhase, DerivedStatus, ReasonCode, Revision,
-};
-
-#[path = "../src/actions.rs"]
-mod actions;
+use boreal_domain::actions::{
+    evaluate_action, evaluate_actions, ActionAuthorization, ActionDecision, ActionDenialReason,
+    ActionEvaluationInput, ActionInputKind, ActionKind,
+};
@@
-use actions::{
-    evaluate_action, evaluate_actions, ActionAuthorization, ActionDecision, ActionDenialReason,
-    ActionEvaluationInput, ActionInputKind, ActionKind,
-};
+use boreal_domain::{ActorId, ActorRole, AttemptPhase, DerivedStatus, ReasonCode, Revision};
```

Retain `use boreal_domain::decision_inputs::*;` and the remaining explicit root
type imports. The public module should remain namespaced as
`boreal_domain::actions`; no additional root re-exports, protocol/schema,
manifest, migration, or client changes are requested by this leaf.

Required steward reruns after registration and test import conversion:

1. `cargo fmt --all -- --check` (the current unrelated store formatting drift
   must remain separately attributable or be reconciled by its owner).
2. `cargo test --locked -p boreal-domain --test production_action_policy`.
3. `cargo test --locked -p boreal-domain`.
4. `cargo check --locked -p boreal-domain --tests`.
5. `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings`.
6. `git diff --check`.

The steward must record the combined source hash and public-module evidence.
Application/store/service lanes should call `evaluate_action` for the final
transactional reread and `evaluate_actions` for read projections; they must not
duplicate role/status-string or TUI action policy. This request does not grant
the worker permission to edit `lib.rs` and does not claim task acceptance.

