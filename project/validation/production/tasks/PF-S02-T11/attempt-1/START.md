# PF-S02-T11 — attempt 1 start

## Scope and invariant

This attempt addresses the corrective leaf `PF-S02-T11`: application-side
external adapters must preserve the original operation identity, project
scope, request digest, and unknown/readback-required outcome across verifier,
publication, backup/update, stop/release, and expiry coordination. Adapters
must not manufacture receipts, accepted proof, or successful external effects;
uncertain effects remain pending until attributable readback reconciles them.

The current source is the dirty combined tree on branch
`codex/apply-responsive-terminal-overlay`, HEAD
`784a41b3802c29a76721c55eef2e9493283396c2`. The worktree is intentionally
preserved and is not a release identity.

## Granted write boundary

Production/test edits are limited to:

- `crates/application/src/runtime.rs`
- `crates/application/src/evidence.rs`
- `crates/memory/src/publisher.rs`
- `crates/cli/src/update.rs`
- `crates/application/tests/production_external_jobs.rs`
- this attempt directory only

No plan/state/manifest/task-card file, store root/schema/migration, protocol,
crate root, prior evidence, or unrelated source path may be edited. Shared
registration or migration needs will be submitted as an integration request.

## Preconditions and inherited findings

The accepted bounded PF-S02-T03 identity seam is present, but its handoff
explicitly leaves canonical application/store identity call-site wiring open.
PF-S02-T06 and PF-S02-T07 each supplied useful store primitives and were
rejected by independent review because canonical lifecycle/adapters still do
not register/read back durable recovery/jobs and existing mutations can bypass
the identity-bound root journal. This attempt consumes those findings; it does
not reinterpret them as accepted product behavior.

During source inspection before editing, the task card's declared
`crates/memory/src/publisher.rs` path was not present in this revision. The
`Publisher` implementation is embedded in the protected
`crates/memory/src/lib.rs`, which this leaf cannot edit or register from its
granted boundary. That is a path/ownership blocker for the memory/Git portion;
this attempt must not create a parallel publisher module.

## Verification strategy

First reproduce the current application/adapter behavior and inspect the
available durable-job/recovery APIs. Implement only changes that use existing
safe seams inside the granted files. Add focused real-SQLite/application tests
for pending, readback-required, reconciled, rejected, timeout/restart, and
project-isolation outcomes where the current public API can exercise them.
Run formatting, focused application/memory/CLI tests, strict lints where
applicable, contract validation, and the required integration checks. Record
exact commands, exits, source hashes, and any blocked checks in the evidence
files. This is a worker attempt and will not claim acceptance.
