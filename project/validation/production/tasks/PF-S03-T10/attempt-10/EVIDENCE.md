# PF-S03-T10 attempt 10 — evidence

## Exact source identity

- Git HEAD: `5584d461a8192cd06999f14069b3fe590b059406`
- Worktree: dirty with unrelated pre-existing `crates/cli/src/main.rs`,
  `apps/tui/src/client.ts`, and local `memory/` changes; those paths were not
  edited by this attempt.
- Test target:
  `crates/domain/tests/production_t10_oracle.rs`
- Test target SHA-256:
  `36e3072569b6bda8ab0392066ffa29c8341f716314c8975d7af4ed6c2f333863`
- Relevant domain source hashes at validation time:

```text
ada0f43743b0adcb29a4c95557d41d89a6763852483a61f6540e08749dad2e0c  crates/domain/src/lib.rs
3065f7419686b075f2a329ee1ad4dd43d0d542dcd99cf151a247a80ceab92d3f  crates/domain/src/status_evaluator.rs
8ac6bdecee87c1d14c139a8fe9554be2b448a6fa1d00ebcad79bfe9a3d5c23e7  crates/domain/src/actions.rs
24895893d826f6a540975e648392de6e677b03e5b7434175711dc6b64f4ed85d  crates/domain/src/decision_inputs.rs
43001bf2e6009aea63d74662cd47fd1d65183ba76759280c20edeb4076298112  crates/domain/src/dependencies.rs
```

## Passed focused assertions

The new target passed four tests:

1. `precedence_vectors_are_table_driven_and_secondary_reasons_survive`
   covers terminal > expiry > hard block > queued/scheduled/ready precedence,
   primary-first reason ordering, retained secondary facts, and order
   invariance.
2. `exact_deadline_and_expiry_recovery_vectors_are_deterministic` covers
   before/equality/after lease and hard-budget boundaries, heartbeat rejection
   at equality, expiry-review status, and the explicit expiry-pending → expired
   transition without reclaim authority.
3. `scoped_override_satisfies_only_its_edge_and_preserves_raw_truth` covers an
   edge-scoped waiver over an open prerequisite, preserves the raw open
   outcome, and returns `WaiverRevoked` at the exact revocation revision.
4. `action_descriptors_are_deterministic_and_status_specific` covers stable
   descriptor replay, read-only inspection availability, and claim allow/deny
   for ready, queued, blocked, and expired-review statuses.

## Full-suite limitation

`cargo test --locked -p boreal-domain` reached the existing
`crates/domain/tests/production_properties.rs` target and failed only at its
source-bound identity assertion: the committed test still records
`3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9`, while the current integrated
checkout is `5584d461a8192cd06999f14069b3fe590b059406`. The assertion is a
prior oracle/evidence binding, not a failure in this new target. This attempt
does not rewrite that prior binding; the coordinator must rebind/revalidate it
under its owning task before the full domain gate can be called green.

## Scope and limits

This is pure-domain evidence. It does not establish store transaction
boundaries, durable override authentication, operation idempotency, service
transport, CLI/TUI parity, or real execution/receipt validity. In particular,
the waiver test proves decision-layer truth retention; persistence must still
store the waiver, raw observation, actor/reason/scope, and audit record.
