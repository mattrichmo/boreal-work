# PF-S02-T11 attempt 20 — evidence

## Disposition

**Memory-root integration is complete and verified; PF-S02-T11 remains
unaccepted.** The durable publisher seam is now registered at the canonical
memory crate root and the root-level publication entry point fail-closes
around durable admission, Git callback ownership, identity-bound readback,
idempotency, and unresolved outcomes.

## Evidence produced

1. `pub mod publisher` and root re-exports make the existing adapter an actual
   crate API instead of a test-only `#[path]` module.
2. `Publisher::publish_with_durable_job` computes the requested draft/manifest
   identity before registration, invokes `publish_with_expected_base` only in
   the durable `Won` callback, and verifies the publisher journal/Git revision
   before returning a reconciled observation.
3. The public-root test proves the first publication reaches
   `register -> acquire -> reconcile`; the exact replay reaches
   `register -> readback`, preserves the same revision, and leaves one
   published entry.
4. Existing adapter tests continue to cover wrong-manifest rejection,
   oversized identity rejection before admission, interrupted callback
   preservation, running replay, and no-second-Git-effect replay.

## Not proven and explicit limitation

`crates/application/src/knowledge.rs:645-661` still invokes the old direct
publisher method. The application/store durable job implementation and the
versioned service route are outside this attempt's exclusive write set. No
service, live SQLite job, installer, restart, or production Git publication
claim is made. The required owner action is recorded in
`INTEGRATION-REQUEST.md`.

No D24 or D27 policy change was made. Historical attempt evidence and all
unrelated dirty paths were preserved.

