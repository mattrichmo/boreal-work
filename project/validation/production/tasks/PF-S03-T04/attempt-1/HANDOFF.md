# PF-S03-T04 attempt 1 — handoff

## Identity and disposition

- Task / plan / attempt: `PF-S03-T04` / production-completion plan / `attempt-1`.
- Worker: Codex implementation worker.
- Requested state: **awaiting_integration / ready_for_review**.
- Input/final worker source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, branch
  `codex/apply-responsive-terminal-overlay`, dirty combined tree.
- Prerequisite: accepted PF-S03-T01 attempt-2 handoff, bounded to its typed
  decision-input artifact and public boundary.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.

This is a worker handoff, not coordinator acceptance, sprint acceptance, or a
service/runtime/release claim.

## Changed files

Worker-owned product files:

- `crates/domain/src/acceptance.rs`
- `crates/domain/tests/production_acceptance_policy.rs`

Attempt evidence files:

- `project/validation/production/tasks/PF-S03-T04/attempt-1/START.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-1/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-1/HANDOFF.md`

No other path was edited by this task. In particular, `crates/domain/src/lib.rs`,
`STATE.json`, prior evidence, manifests, plans, service code, and unrelated
dirty paths remain outside this task's write set.

## Implemented invariant

The acceptance interpreter treats declaration identity and complete proof
subject as mandatory selection keys before recency. It preserves distinct raw
missing/failed/stale/altered/irrelevant/declaration/review facts; accepts only
valid typed operator exceptions as effective exceptions; keeps failed proof
visible with the exception ID; rejects self-review and unauthorized review
roles; and separates task-attempt proof from container scope and summary
closeout without fabricating a container attempt.

## Validation summary

- `cargo fmt --all -- --check`: passed.
- `cargo check --locked -p boreal-domain --tests`: passed.
- `cargo test --locked -p boreal-domain --test production_acceptance_policy`:
  `9 passed, 0 failed`.
- `cargo test --locked -p boreal-domain`: `68 passed, 0 failed`, zero doc tests.
- `cargo clippy --locked -p boreal-domain --test production_acceptance_policy -- -D warnings`: passed.
- `cargo clippy --locked -p boreal-domain --lib -- -D warnings`: passed.
- Baseline missing-test-target failure, typed workflow `service_busy`, exact
  argv, CWD, source/tool identity, and SHA-256 values are in `COMMANDS.md`.

## Coordinator integration request

Apply the following precise shared-root patch under the coordinator/steward
write lease, then replace the focused test shim with the public import:

```diff
diff --git a/crates/domain/src/lib.rs b/crates/domain/src/lib.rs
@@
 pub mod decision_inputs;
+pub mod acceptance;
```

Required combined-tree checks after integration:

1. `cargo fmt --all -- --check`
2. `cargo check --locked -p boreal-domain --tests`
3. `cargo test --locked -p boreal-domain --test production_acceptance_policy`
4. `cargo test --locked -p boreal-domain`
5. independent PF-S03-T90 review, PF-S03-T91 reconciliation, and PF-S03-T92
   exact-tree revalidation.

## Impact and limitations

- Schema, migration, protocol, transport, store, application, CLI, TUI,
  service, native, installer, publication, signing, and release impact: none
  introduced or claimed by this pure-domain slice.
- The public module is intentionally not registered by the worker because
  `crates/domain/src/lib.rs` is a protected shared file; until the coordinator
  applies the request, this leaf remains awaiting integration.
- Boreal workflow resolution was attempted but returned `service_busy`; no
  live lock was broken and no lifecycle state was mutated.
- Failed/unsupported baseline evidence and all prior attempts remain intact.

## Next safe action

Coordinator integrates `pub mod acceptance;`, switches the focused test to the
public boundary, reruns the listed checks on the combined source identity, and
assigns the independent review chain. Do not claim task acceptance, service
runtime, or release readiness from this worker handoff.
