# PF-S02-T11 — attempt 17 application-integration evidence

## Disposition

**Bounded ready for independent review; not accepted.** This evidence does
not mark PF-S02-T11, PF-S02, or any release gate accepted.

## Source-bound implementation result

Final HEAD is `0d9611a017d5dc167e92fe79e8d65756fbac2d5a` with a dirty tree.
The attempt-17 source hashes are:

```text
604f38c3f53f4ea4176e4aca02d9a44226a0c11114556626ef6e169e4dd66717  crates/application/src/runtime.rs
43aaaac3878c56fc34d47677f60894f9f2e75b41ff0ab75512155bdd01486f5d  crates/application/tests/production_external_jobs.rs
```

The final runtime change:

1. Reads terminal recovery through `AttemptRecoveryAdapter::new_with_identity`
   and validates the obligation’s attempt ID and fence before any release
   request.
2. Routes terminal resource release through the identity-bound adapter, using
   the canonical `operation_id:resource-release` event identity and the exact
   evidence reference `attempt-terminal:{attempt_id}:{fence}`.
3. Keeps physical release unresolved until the identity-bound recovery
   resolution acknowledges the pending release. The typed request and
   acknowledgement façade accepts `ResourceReleaseRequest` rather than a
   scalar argument list, removing the attempt-16 `too_many_arguments` source
   allowances.
4. Makes the unbound constructor test-only; production terminal paths do not
   construct an unbound recovery adapter.

## Before / after behavior

| Boundary | Before attempt-17 | After attempt-17 |
| --- | --- | --- |
| Terminal recovery readback | Project-id-only adapter path. | Current database/project identity is loaded and the readback uses the identity-bound adapter. |
| Terminal release request | Unbound adapter; fallback event/evidence could not satisfy canonical recovery. | Identity-bound adapter; event is `<operation_id>:resource-release`, evidence is exactly `attempt-terminal:<attempt_id>:<fence>`. |
| Fence authority | Terminal fallback did not validate the durable obligation’s attempt/fence before requesting release. | Durable obligation attempt/fence is checked before the release request; store recovery rechecks it during acknowledgement. |
| Recovery completion | Existing store path was authoritative, but fallback coverage was absent. | Production-schema tests prove `release_pending` readback, identity-bound `released` resolution, replay, wrong-project rejection, and final reusable state. |
| Request API shape | Scalar façade parameters required a broad Clippy suppression. | Typed `ResourceReleaseRequest` boundary; no new broad Clippy suppression. |

The pre-change runtime and external-job baselines passed their existing 8,
12, and full-package checks, so the blocker was a missing production-schema
terminal fallback assertion rather than a previously failing baseline test.

## Evidence matrix

- `runtime::tests`: 8/8 passed, including operation replay, unbound released
  rejection, idempotent acknowledgement, and wrong-project rejection.
- `production_external_jobs`: 14/14 passed. The two new terminal tests cover
  actual `SqliteAttemptAdapter` terminal release plus the fallback adapter
  path, canonical evidence, release-pending state, identity-bound recovery,
  replay, and wrong-project rejection.
- `production_recovery_records`: 12/12 passed. The store remains authoritative
  for stale fence rejection, identity-bound recovery resolution, exact bound
  resource acknowledgement, replay, restart persistence, and unresolved
  obligations.
- `production_integration`: 4/4 passed. Canonical release requires durable
  request/acknowledgement and production schema open/reopen remain green.
- Strict all-target application Clippy, workspace formatting, contract
  validation, and `git diff --check` passed on the final source identity.

## Limitations and adapter gaps

- This worker did not edit the protected service/protocol roots. The new
  identity-bound application entry points still need a versioned service route
  and public request/result registration by the service steward.
- Genuine verifier/evidence-process, memory publication, backup, update, and
  real service/restart external-effect executions remain outside this write
  set and are not claimed here. Their protected call sites require separate
  integration and readback evidence.
- The existing store exposes the resource request primitive without a separate
  identity-named method. This attempt calls it only behind
  `AttemptRecoveryAdapter::new_with_identity`, which validates current
  database/project identity before mutation; a future store-steward extraction
  of an intrinsically identity-bound resource request API remains an optional
  hardening seam, not changed here because store roots are off-limits.
- The concurrent coordinator checkpoint changed HEAD during the attempt;
  final checks and hashes above are bound to the post-checkpoint tree. Prior
  attempts and dirty paths were preserved.
