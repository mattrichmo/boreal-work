# PF-S03-T10 attempt 6 — source-bound oracle record

This record binds the pure-domain remediation evidence to the coordinator
checkout at the time of validation. The checkout is intentionally dirty with
other stream work; the base revision is recorded separately and no commit was
created by this attempt.

base_source_revision: `70514f0ed2521df710c3c913f50ff9d759f5e743`
current_source_revision: `70514f0ed2521df710c3c913f50ff9d759f5e743`
worktree_state: `dirty; attempt-6 owned delta is listed below; unrelated stream paths are not part of this attempt`
status_contract: `boreal.work-status/3`
transition_contract: `boreal.work-transition/2`
fixture_revision: `m02-candidate.1`

## Attempt-owned source hashes

These hashes are evidence identities for the exact files tested in the dirty
checkout; they are not Git object IDs.

```text
ada0f43743b0adcb29a4c95557d41d89a6763852483a61f6540e08749dad2e0c  crates/domain/src/lib.rs
3065f7419686b075f2a329ee1ad4dd43d0d542dcd99cf151a247a80ceab92d3f  crates/domain/src/status_evaluator.rs
cf4800f5fc27f3df972b2c65649a4030b3e1f28da9daebcc82fe6bfc7279d2fe  crates/domain/tests/production_properties.rs
```

The normative contract artifact digests remain those recorded by the existing
`PF-S03-T10-ORACLE-SOURCE.md`; no contract source file was edited by attempt 6.
