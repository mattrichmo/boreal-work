# PF-S02-T11 attempt 18 — evidence

## Disposition

**Bounded adapter remediation complete; not accepted as canonical production
integration.** The permitted adapters now fail closed around durable admission,
single-winner callback authorization, identity-bound readback and unresolved
recovery outcomes. The protected CLI/service and memory-root wiring remains an
explicit integration request.

## Implemented

- `crates/cli/src/update.rs`
  - Added a bounded, identity-rich update request and readback contract.
  - Requires durable registration and a typed winning acquisition before the
    installer callback can run.
  - Routes exact replay, non-winning acquisition, restart and callback errors
    to the original operation readback; no second installer invocation is
    authorized.
  - Treats installer completion as readback-required rather than success until
    the canonical caller verifies the installed artifact and returns an
    attributable `Reconciled` observation.
  - Binds side-effect/result/version/timestamp identities and caps identity and
    conflict-error payloads; installer output is not buffered into a durable
    payload.
  - Leaves `run` fail-closed because the allowed file cannot obtain the
    project/store/actor/session/request-digest context required for admission.

- `crates/memory/src/publisher.rs`
  - Added a storage-neutral durable publication adapter contract for the Git
    publisher boundary.
  - Only `Won` may call the publication callback; exact replay and uncertain
    callback outcomes read back the original operation.
  - Requires entry/content/manifest/root/project/operation identity and
    attributable Git revision/readback timestamp before `Reconciled`.
  - Preserves pending/readback-required/rejected/failed states and bounds all
    request, readback and error identities.

- `crates/memory/tests/publisher.rs`
  - Existing publisher tests now exercise exact replay without a second Git
    callback, running replay, interrupted callback preservation, wrong-manifest
    rejection and pre-admission identity bounds.

## What is proven

- Focused update adapter: 9/9.
- Focused memory publisher target: 27/27.
- Full `boreal-cli` package: pass.
- Full `boreal-memory` package: pass.
- Scoped and workspace formatting, contract validation and diff checks: pass.
- No installer or Git publication is reported successful by the new adapters
  without attributable reconciliation.

## What is not proven

- The canonical `bwrk update` production route is not wired to the adapter;
  its current direct route is intentionally rejected before any installer run.
- `publisher.rs` is not registered from `crates/memory/src/lib.rs`, and no
  application/store implementation of `PublicationJobPort` was added because
  those files are outside the exclusive write set.
- No end-to-end service/store transaction, real installer artifact readback,
  or live Git publication was claimed by this attempt.
- Existing unrelated dirty paths, including concurrent application/store/
  domain/evidence and prior validation artifacts, were not changed or used as
  acceptance evidence.
