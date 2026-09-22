# PF-S02-T11 — attempt 12 bounded evidence

## Disposition

**Ready for independent review; not task acceptance.** The application and
adapter seams are tested and bounded, but protected integration remains open.

## Implemented within the worker set

- `crates/application/src/evidence.rs`
  - Adds shared external-job categories for verifier, evidence, backup, memory
    publication, and update work.
  - Validates bounded project/operation/request identity fields.
  - Adds an admit/start/execute seam that invokes external work only after the
    durable job is registered and running.
  - Preserves pending and readback-required states; reconciles only with the
    matching project, operation, request digest, side-effect reference, and
    result digest; persists rejected/failed reasons without synthesizing a
    receipt or acceptance result.

- `crates/application/src/runtime.rs`
  - Adds readback, resolution, resource-release-request, and resource-release-
    acknowledgement adapters for durable expiry/stop/fail/cancel obligations.
  - Maps unresolved/unknown/release-pending records to readback-required and
    resolved records to reconciled; superseded records remain rejected.
  - After a terminal lifecycle mutation, records a deterministic durable
    resource-release request for matching live reservations. This is a request
    for physical cleanup, not an acknowledgement that cleanup completed.

- `crates/cli/src/update.rs`
  - Adds a durable update-job port and execution seam. The installer callback
    runs only after registration/start; pending, readback-required, rejected,
    failed, and reconciled outcomes are retained distinctly.
  - Adds five adapter tests, including restart readback without re-invoking the
    installer.

- `crates/application/tests/production_external_jobs.rs`
  - Adds four production-schema adapter tests, including identity-preserving
    file-backed restart readback. The suite now has 10 passing tests.

## Explicit non-change: memory publisher

The current repository has a monolithic `crates/memory/src/lib.rs` containing
`publication_identity` (line 395), `Publisher::publish` (line 572), and
`Publisher::publication_readback` (line 547). There is no
`crates/memory/src/publisher.rs`. Because `crates/memory/src/lib.rs` is outside
the worker write set, no disconnected module was created. Existing memory
publication/recovery behavior remains covered by the package suite; canonical
external-job registration at the protected application call site
`crates/application/src/knowledge.rs:645–680` and memory root is an
integration request below.

## Safety and remaining risk

The new seams do not invoke a verifier, backup process, Git publisher, or
installer themselves, and they do not claim receipt, acceptance, release, or
publication completion from a timeout or process return alone. Production
behavior still depends on the protected application/CLI/memory call sites
passing the current identity context and supplying genuine external readback.
