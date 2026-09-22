# PF-S03-T01 attempt 1 — handoff

## Identity and disposition

- Task / plan: `PF-S03-T01` / production-completion plan.
- Worker: Codex implementation worker.
- Requested state: `awaiting_integration` / ready for independent review.
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, branch
  `codex/apply-responsive-terminal-overlay`, dirty worktree.
- Prerequisite: PF-S01-T92 attempt 3 accepted for AC-01 / contract layer only.
- Contract manifest SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.

This handoff is not coordinator acceptance. It is the bounded worker result and
must be reviewed and integrated at a new combined-tree source identity.

## Exact changed paths

Worker-owned source/test paths:

- `crates/domain/src/decision_inputs.rs`
- `crates/domain/tests/production_decision_inputs.rs`

Attempt evidence paths:

- `project/validation/production/tasks/PF-S03-T01/attempt-1/START.md`
- `project/validation/production/tasks/PF-S03-T01/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T01/attempt-1/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T01/attempt-1/HANDOFF.md`

No other path was edited by this task. In particular, `crates/domain/src/lib.rs`,
plan JSON, `project/build-plan/production-completion/execution/STATE.json`,
other source, and prior evidence remain outside this attempt’s write set.

## Shared `lib.rs` integration request

The coordinator/domain integration steward must apply this precise shared-file
patch on the combined tree:

```diff
diff --git a/crates/domain/src/lib.rs b/crates/domain/src/lib.rs
@@
 pub mod work_model_v3;
+pub mod decision_inputs;
```

The registration should remain additive and public so application/store lanes
can consume `boreal_domain::decision_inputs` through the domain boundary. After
registration, update the focused test’s local-only shim in the same worker-owned
test path by removing `pub use boreal_domain::*`, the `#[path = ...] mod
decision_inputs` declaration, and switching `use decision_inputs::*` to
`use boreal_domain::decision_inputs::*` while keeping explicit imports of the
existing root domain types. This makes the test exercise the registered public
module rather than a duplicate source-path module.

Required steward checks after applying the shared patch:

1. `cargo fmt --all -- --check`
2. `cargo test --locked -p boreal-domain --test production_decision_inputs`
3. `cargo test --locked -p boreal-domain`
4. `cargo check --locked -p boreal-domain --tests`
5. Rerun the affected clippy check; the current strict workspace result has the
   pre-existing `status_evaluator.rs:75-77` lint blocker recorded in this attempt.

The integration steward must record the resulting combined source identity and
rerun evidence; this worker does not claim that unperformed registration or
downstream service behavior.

## Validation outcome

- Focused production tests: passed, `10/10`.
- Full `boreal-domain` tests: passed, `53/53` plus zero doc tests.
- Domain test-target check: passed.
- Workspace formatting and assigned-file rustfmt checks: passed.
- Assigned module/test clippy with only the named pre-existing lint allowed:
  passed.
- Strict clippy with no exception: blocked by the pre-existing protected
  `status_evaluator.rs` lint; not fixed because it is outside the write set.
- `bwrk prime boreal-work --json`: typed `busy`/`service_busy`; no lock break,
  no runtime pass, and no fabricated service evidence.
- Finish workflow resolution (`bwrk workflows show
  boreal.workflow.finish.v1 --json`): typed `busy`/`service_busy`; no
  application-owned evidence attachment or lifecycle close action was
  attempted.

## Impact and residual work

- Schema/migration: none.
- Protocol/transport: none; the module is domain-only and not serialized.
- Security/authority: typed actor authority, integrity scope, and action inputs
  are represented; authenticated resolution remains an application boundary.
- History/proof: proof identity binds entity revision, proof revision, attempt
  fence, source, configuration, profile, and policy; failed/unreadable/stale
  facts remain diagnostic inputs.
- Residual: coordinator must register `decision_inputs` in `lib.rs`, switch the
  focused test to the public module, rerun combined-tree checks, and obtain the
  independent review/reconciliation/revalidation chain PF-S03-T90 → T91 → T92.

No service, runtime, native, publication, or release claim is made by this
handoff.

## Coordinator integration record

The requested additive registration was integrated on the combined tree:

- `crates/domain/src/lib.rs` now publicly registers `decision_inputs`.
- `crates/domain/tests/production_decision_inputs.rs` now imports the module
  through `boreal_domain::decision_inputs` rather than a source-path shim.

Combined-tree checks passed after integration:

- `cargo fmt --all -- --check`
- focused PF-S03-T01 tests: 10 passed
- full `cargo test --locked -p boreal-domain`: 53 passed, 0 failed
- `cargo check --locked -p boreal-domain --tests`

The protected `status_evaluator.rs` clippy warning remains outside this task's
write set and is not relabeled as fixed. This integration record does not
self-accept the task; independent task review and the PF-S03 sprint gate remain
required.
