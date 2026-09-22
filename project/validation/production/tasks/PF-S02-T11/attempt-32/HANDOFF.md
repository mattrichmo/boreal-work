# PF-S02-T11 — attempt 32 verifier bridge handoff

## Identity and disposition

Task / plan / attempt: `PF-S02-T11 / production-completion v1 / attempt-32`  
Worker: current Codex task  
Disposition: **bounded verifier operation-identity and closeout validation repair accepted**

## Changed paths

- `/Users/cybertron/Code/boreal-work/crates/application/src/evidence_store.rs`
  - Added deterministic `verifier_operation_id`.
  - Separated verifier admission/audit/external-job operation identity from
    the user receipt operation.
  - Routed verifier readback and reconciliation through the verifier operation
    identity while preserving `verifier:<user-operation-id>` job IDs.
- `/Users/cybertron/Code/boreal-work/crates/cli/src/service.rs`
  - Test helper skips identity setup for schema-v2 fixtures without identity
    tables; canonical setup remains unchanged.
- `/Users/cybertron/Code/boreal-work/project/validation/production/tasks/PF-S02-T11/attempt-32/`
  - This handoff and evidence record.

## Verification result

All five requested CLI tests pass, including failure replay and the forged
project/mismatched durable-receipt matrix. `finish_close` parses and validates
witnessed durable receipt facts before project identity lookup, then validates
the project identity before submit, summary, or close mutation. Receipt
operation semantics remain unchanged.

`cargo check -p boreal-application -p boreal-store -p boreal-cli --bin bwrk`
passes. `git diff --check` passes for the owned source paths. No commit or push
was performed.

## Source hashes

- `evidence_store.rs`: `6aac778c525d860bef9f37abd43efe50caaec25c`
- `service.rs`: `b2d957904aa71a0ea572e90cbe9b2d9f230beeaf`
- Input snapshot: `HEAD 0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
