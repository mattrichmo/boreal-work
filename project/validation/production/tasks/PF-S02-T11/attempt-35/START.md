# PF-S02-T11 — attempt 35 start

## Scope

Remediate verifier-admission orphaning across the application/store boundary.
The accepted invariant is that the durable evidence-execution identity and its
external verifier admission/recovery record are committed as one recoverable
unit before any process launch. Replays must validate immutable identity and
must never authorize a second launch. Unknown outcomes remain readback-only.

Allowed production paths for this attempt:

- `crates/application/src/evidence_store.rs`
- the narrowest store seam required to couple evidence execution and external
  job admission
- focused tests and this attempt's evidence under this directory

The CLI, TUI, plan graph, `STATE.json`, acceptance ledger, `memory/`, and
unrelated store/application paths are out of scope.

## Source baseline

- Git base: `5584d461a8192cd06999f14069b3fe590b059406`
- `evidence_store.rs` working-tree hash at start:
  `20a0b3e90876ab769b51ee2620f20a50b12d882b`
- `jobs.rs` working-tree hash at start:
  `3ac2057dbe281296c94dd019218d3abd2ce139b2`
- `store/lib.rs` working-tree hash at start:
  `c84c41146a7be9891ebbccf572cf8116a6dd8122`

The working tree already contained uncommitted changes from other production
lanes. Those changes were preserved and are not treated as evidence for this
attempt unless a command below binds them explicitly.

## Baseline finding

The prior admission path wrote the verifier operation/audit journal, admitted
the external job, and only then inserted `evidence_execution`. A crash between
external-job admission and the final insert could leave a job with no durable
evidence execution identity. The current uncommitted worker attempt adds an
atomic evidence/external-job seam; this attempt verifies and hardens that seam,
including replay after the transaction boundary and readback after an
interrupted/unknown outcome.

## Validation strategy

- Run the focused application evidence-store tests.
- Run the production external-job integration test if the current tree builds.
- Run formatting and diff checks for the allowed paths.
- Record exact source hashes and any residual limitation; do not claim a real
  crash injection or genuine verifier process test unless it actually ran.
