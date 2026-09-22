# PF-S02-T10 attempt 12 — identity/audit boundary remediation

## Scope

This bounded attempt addresses the concrete follow-up from PF-S02-T10
attempt 11:

1. Fail closed for consequential operation/audit writes from an unbound
   canonical production project while preserving the legacy schema-v2 test
   path.
2. Tighten `initialize_project` replay identity checks and keep creation on
   one operation/audit boundary. Treat an already-existing project with no
   matching operation as a safe readback rather than fabricating a no-op audit
   event.
3. Add focused SQLite coverage for unbound rejection, bound replay, and
   initialization audit/replay behavior.

## Protected paths

The only source/test paths changed by this attempt are:

- `crates/store/src/lib.rs`
- `crates/store/tests/production_identity_audit_boundary.rs`

Evidence is written only in this attempt directory. `STATE.json`, plan
manifests, other crates, prior evidence, schemas, and application/service
wiring are outside this attempt and were not edited.

## Review basis

The implementation follows the residual P1 findings in
`project/validation/production/tasks/PF-S02-T10/attempt-11/EVIDENCE.md` and
its request to keep external-job/application/service wiring out of this
bounded slice.

