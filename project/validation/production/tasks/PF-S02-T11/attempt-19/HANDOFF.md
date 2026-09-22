# PF-S02-T11 attempt-19 — bounded CLI/service handoff

## Disposition

**Bounded implementation; not complete/accepted.** No commit or push was
performed. The input tree was dirty and unrelated changes were preserved.

Input commit: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`

Owned source hashes at handoff:

| File | SHA-256 |
|---|---|
| `crates/cli/src/main.rs` | `84141f70531ff9c765a84a1570b46ad775337056b0a6b34fb025dd80d4ca9144` |
| `crates/cli/src/service.rs` | `1e96889db113687e445a215034082eb24c1341e970106bedf91976a84e8e84f7` |

## Implemented boundary

- `update`/`upgrade` now route through the canonical direct or Unix-socket
  service path instead of the fail-closed placeholder.
- The service adapter registers and acquires an identity-bound external job,
  invokes the existing installer only after winning acquisition, and validates
  binary/manifest readback before returning `changed`.
- Pending, readback-required, conflict, rejected, failed, and unknown states
  remain non-success outcomes; no installer result is guessed as success.
- The service DTO and dispatch table advertise and carry the update route.
- Existing recovery behavior remains delegated to the application lifecycle
  path; this attempt did not edit `runtime.rs`.

## Explicitly bounded items

- The two existing parent-operation writers remain at
  `crates/cli/src/main.rs:5908` (`append_finish_parent_operation`) and
  `crates/cli/src/service.rs:3141` (`ServiceCommandHandler::start`). An
  identity-audit conversion was tested and rejected because the close/start
  parent operation shares a project revision whose audit slot is already
  occupied (`UNIQUE audit_event.project_id, audit_event.revision`). They remain
  legacy operation-only writes until the store exposes a multi-operation or
  parent-operation audit contract.
- `evidence_run_result` at `crates/cli/src/main.rs:4355` and
  `execute_gate_command` at `crates/cli/src/main.rs:5103` still use the existing
  durable evidence-execution admission/start/finish/unknown protocol around a
  direct verifier spawn. A second identity-bound external job cannot be added
  safely here without an application/store verifier-job contract for the same
  `receipt.insert` operation and audit/revision identity.
- There is no standalone service recovery/readback command. Release/expiry
  calls continue through `WorkApplication`'s existing terminal resource
  readback hook; exposing a separate recovery route requires an application
  recovery DTO/port not present in the assigned CLI/service boundary.

These limitations mean this handoff is bounded, not a production-completion
claim.
