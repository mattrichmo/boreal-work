# PF-S02-T07 — Attempt 5 coordinator integration request

This request is for the protected `crates/store/src/lib.rs` token and the owning application/CLI stewards. The worker did not edit protected roots.

## Root registration and replay order

1. Keep `pub mod operations` as the single store module registration. Do not add a second operation or audit authority. The worker seam is `OperationJournal::replay_in_context`, `register_or_replay_in_transaction_with_identity`, `append_in_transaction_with_identity`, and `audit_event_in_context`.
2. At the start of each canonical root mutation transaction, construct the immutable `OperationIdentity` from the authenticated project/actor/session, command, target subject, expected revision, attempt/fence, and request digest. Call `replay_in_context` before policy-side effects, semantic mutation, external-effect admission, or process launch. An exact identity returns the stored bounded outcome; changed command, actor/session, target, revision/fence, digest, project, database instance, or restore epoch fails closed as a typed conflict/isolation error.
3. If no prior operation exists, recheck domain policy and perform the semantic mutation in the same caller-owned write transaction. Append the final `OperationBundle` through `append_in_transaction_with_identity`; the operation row, identity context, audit row, project/entity/proof revision, and semantic target change must commit or roll back together. Do not call the legacy append pair after the strict path.
4. For a policy or authority denial, do not modify the target. Append a terminal `Rejected` bundle with the typed reason and redacted bounded details in that same transaction, so the denial is durable and exactly replayable.
5. For an external process, network, Git, or termination effect, persist a bounded `Busy`/pending or `Unknown` operation and its audit/recovery fact before the effect or on interrupted readback. Never launch a second effect for the same operation ID until original readback resolves; terminal reconciliation must retain the original identity and audit chain.
6. If operation, identity, outcome, or audit persistence fails, return the error and roll back the caller transaction. Do not acknowledge a successful semantic mutation without its operation and audit records.

## Current call-site coverage to reconcile

The current source has the private root helper at `crates/store/src/lib.rs:5370–5385`, with strict identity append only when a project context is available and a legacy compatibility fallback otherwise. Its callers include initialization/session/planning/hold/claim and lifecycle/close paths at approximately lines `1962, 2093, 2279, 2978, 3119, 3203, 3297, 3403, 3502, 3928, 4520, 5935, 6092, 6276, 6404, 6557, 6671, 6712, 6799`; `work_model_v3.rs:927`; and recovery's already strict path around `recovery.rs:500–594`. Review each caller for replay-before-mutation rather than only replacing the final append.

Direct legacy writers still require owner integration review:

- `crates/store/src/knowledge.rs:140`;
- `crates/cli/src/main.rs:5894` (`finish_close` parent operation helper);
- `crates/cli/src/service.rs:2566` (agent-start operation).

These callers must use the same project/epoch-bound root adapter, including audit completeness for the finish/close parent operation. Do not silently make the worker modify these protected/out-of-scope files.

## Required combined-tree checks

After applying the protected integration, rerun against the exact integrated source:

```sh
cargo fmt --all -- --check
cargo test --locked -p boreal-store --test production_operation_audit
cargo test --locked -p boreal-store
cargo clippy --locked -p boreal-store --all-targets --all-features -- -D warnings
python3 project/spec/validate_contracts.py
```

Then add/execute genuine service/application/native tests for crash-after-commit-before-response, rejected claim/action persistence, duplicate and changed payloads, actor/project isolation, and audit-write failure. Keep the existing rejected attempts and this bounded handoff; do not mark PF-S02-T07 accepted until independent review plus root integration and revalidation are complete.
