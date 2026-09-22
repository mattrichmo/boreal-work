# PF-S02-T07 — Attempt 4 independent review evidence

## Disposition

**Bounded contribution accepted for review purposes; full PF-S02-T07 remains
unaccepted/rejected.**

The three task-owned files provide a real SQLite, caller-owned transaction
seam and the focused tests pass. This is sufficient to accept the bounded
operation/audit contribution, not the task's complete production outcome.

## Verified bounded behavior

- `OperationBundle` validates required identity fields, optional session and
  attempt values, non-zero fences, terminal versus pending completion times,
  matching project/actor/revision/session/fence audit identities, and requires
  audit for terminal identity-bound outcomes.
- `register_or_replay_in_transaction_with_identity` validates the current
  database/project identity, registers operation and audit in the caller's
  transaction, and returns the stored readback for an exact operation replay.
- Reuse with a changed actor, request digest, project/epoch context, or audit
  subject is rejected; an existing operation cannot silently produce a second
  outcome.
- `Busy` and `Unknown` are retained as distinct non-terminal outcomes and are
  available through bounded context readback.
- Operation result and audit JSON are parsed, redacted, bounded to the stated
  payload size, depth, string, and array limits, and invalid JSON fails before
  durable write. Sensitive-key separator variants are covered by tests.
- Audit failure, invalid identity, missing identity context, malformed payload,
  and terminal-without-audit cases leave no operation/identity row behind in
  the tested transaction boundary.
- Focused coverage includes 15 passing tests, including commit-before-response
  replay, digest conflict, idempotent replay, actor/payload/subject mismatch,
  database identity mismatch, pending outcome distinction, payload redaction,
  and rejected no-mutation behavior.

## Production integration finding

The bounded seam is not yet the single authoritative production path. Current
source inspection found direct legacy `append_operation` writers in at least:

- `crates/cli/src/main.rs` (project initialization/replay path),
- `crates/cli/src/service.rs` (agent-start operation),
- `crates/store/src/lib.rs` (root initialization and compatibility append),
- `crates/store/src/knowledge.rs` (source registration operation).

`crates/store/src/lib.rs` contains a root helper that can use the identity-bound
bundle, but the inspected production writers are not all routed through
`register_or_replay_in_transaction_with_identity` or an equivalent canonical
root-owned adapter. The current legacy append compatibility path also does not
by itself prove that semantic mutation, exact operation registration, audit,
and replay share one canonical boundary for every consequential command.

Therefore the following PF-S02-T07 requirements remain unproven:

- every consequential store/application/CLI mutation uses one identity-bound
  operation/audit transaction;
- exact replay occurs before rerunning semantic mutation or external effects
  at every production adapter;
- finish/close, claim, start, initialization, planning, rejected, and unknown
  outcomes all use the same canonical path;
- genuine service/lifecycle/native unknown-outcome evidence establishes AC-12
  on the final integrated artifact.

## Review limits

The passing tests are store-level tests, not genuine service-backed lifecycle,
crash/restart, release, or native platform evidence. The full store package
passed, but strict `-D warnings` Clippy remains blocked by the pre-existing
out-of-scope `crates/store/src/profiles.rs:505` lint. No claim is made that
PF-S02-T07, PF-S02, or the production release is complete.

