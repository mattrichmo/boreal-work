# PF-S02-T11 — attempt 33 start

## Scope

Bounded remediation of the `finish_close` replay-identity finding. The owned
source path is `crates/cli/src/main.rs`; no store core, plan/state/ledger, or
runtime-memory files are in scope.

## Required outcomes

- Bind every proof-relevant field in the typed close receipt to the immutable
  `finish_close` request digest.
- Validate the terminal result operation against its parent project, operation
  identity, actor/session, attempt/fence, expected revision, and parent digest
  before returning a replayed result.
- Preserve deterministic replay and unknown-outcome behavior.
- Add focused regression coverage and leave prior outcomes unchanged.
