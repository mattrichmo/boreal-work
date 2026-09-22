# PF-S02-T07 attempt-7 evidence

## Implemented boundary

`crates/store/src/knowledge.rs:67-102` now invokes the existing root
`preflight_operation_replay` before reading or writing the source row. The
preflight binds operation ID to project, command, actor, subject, and request
digest; on canonical bound projects it also validates database/project
identity through the identity-aware journal readback.

`crates/store/src/knowledge.rs:147-186` now builds one terminal operation and
an attributable audit event and sends both through
`append_operation_audit_in_transaction`. Canonical bound projects therefore
use `OperationJournal::append_in_transaction_with_identity` in the caller's
`BEGIN IMMEDIATE` transaction. Source-row insertion, project revision,
operation identity, operation outcome, and audit event commit or roll back
together. Exact retry returns the original source row without a second source,
operation, or audit write.

The existing schema vocabulary has no source-specific audit event. The change
uses the registered `repair.correction` event with `subject_type=project` and
includes the source-version and content digests in its bounded payload. The
event is explicitly attributed to the input project, operation, and actor; a
future schema/protocol owner must add and version a source-specific event before
changing that vocabulary.

## Regression coverage

The owned unit regression at
`crates/store/src/knowledge.rs:408-449` proves, against the production schema
and a bound project:

- one source registration creates one attributed audit event;
- exact replay returns the original revision and leaves one source row;
- a changed request digest is rejected as immutable-identity reuse before a
  second source mutation.

The existing operation/audit suite separately proves atomic rollback,
project/actor/subject/digest isolation, redaction, and distinct pending,
unknown, rejected, and terminal outcomes.

## Remaining boundary findings

The source-registration writer is no longer a direct operation-only writer.
The read-only source scan still finds two direct CLI operation writers:

- `crates/cli/src/main.rs:5897` (`finish_close` parent operation);
- `crates/cli/src/service.rs:2566` (`agent_start` operation).

They remain outside this attempt's exclusive write set and require an
application/CLI integration pass. The generic journal implementation's own
calls to the low-level append primitives are not additional call-site bypasses.

This is a bounded implementation handoff, not PF-S02-T07 or sprint acceptance.
