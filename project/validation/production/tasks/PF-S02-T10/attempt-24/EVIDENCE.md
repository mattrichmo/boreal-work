# PF-S02-T10 attempt-24 evidence

## Canonical knowledge-path result

The source-version registration adapter now calls the root immutable replay
preflight at `crates/store/src/knowledge.rs:67-102` before source-row access
or insertion. It then submits the operation and attributed audit event through
the root transaction helper at `crates/store/src/knowledge.rs:147-186`.

On a bound production project this reaches the identity-bound journal, records
database/project operation identity, and keeps source metadata, project
revision, operation outcome, and audit event under one rollback boundary.
Changed request digest, actor, command, project, or subject cannot reuse an
operation ID. Exact retry returns the original row and revision.

The schema currently has no source-specific audit event, so the bounded event
is the registered `repair.correction` type with a project subject and payload
containing source-version and content digests. This preserves audit
attribution without editing the protected schema/protocol surface.

## Residual T10 integration requests

The source scan still finds direct low-level operation writers at:

- `crates/cli/src/main.rs:5897` (`finish_close`);
- `crates/cli/src/service.rs:2566` (`agent_start`).

Those paths must be integrated by their application/CLI owner through the same
identity-bound journal and must retain pending/unknown/readback, rejected, and
audit attribution. External side-effect adapters and the combined restart,
migration, rollback, and service matrix remain the T10 coordinator's stated
follow-up scope. This attempt does not claim those paths.

## Disposition

Bounded ready-for-review; not PF-S02-T10 acceptance. The owned source change
and store validation pass, while application knowledge validation is blocked by
unrelated missing memory publication helper definitions.
