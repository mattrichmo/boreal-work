# PF-S02-T11 attempt 20 — memory publication integration handoff

## Identity and disposition

- Task: `PF-S02-T11`
- Attempt: `attempt-20`
- Input source snapshot: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
- Branch: `codex/apply-responsive-terminal-overlay`
- Working tree: dirty before this attempt; unrelated concurrent changes were preserved
- Disposition: **bounded memory-root integration complete; task not accepted**
- Plan/state/ledger edits: none
- Commit/push: not performed

## Changed files in this attempt

- `crates/memory/src/lib.rs`
- `crates/memory/tests/publisher.rs`
- `project/validation/production/tasks/PF-S02-T11/attempt-20/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-20/EVIDENCE.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-20/HANDOFF.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-20/INTEGRATION-REQUEST.md`

`crates/memory/src/publisher.rs` was pre-existing from attempt 18 and was not
modified here; this attempt registers and consumes it from the canonical
memory crate root.

## Implemented boundary

- Registered `pub mod publisher` and re-exported its durable job contract from
  `crates/memory/src/lib.rs:8-16`.
- Added `Publisher::publish_with_durable_job` at
  `crates/memory/src/lib.rs:565-679`.
- The root method binds project, operation, entry, content, and final manifest
  identity to the accepted draft before durable admission.
- Git publication is invoked only from the `Won` callback granted by
  `PublicationJobPort`; replay, pending, terminal, and losing acquisition
  paths do not invoke Git.
- Successful and interrupted callbacks use `Publisher::publication_readback`;
  `Reconciled` requires matching manifest identity and Git revision. Missing or
  uncertain readback remains pending/readback-required through the job port.
- The public integration test at
  `crates/memory/tests/publisher.rs:1270-1325` proves admission, verified
  publication readback, and exact replay without a second Git effect.

## Contract and policy impact

- D24 is preserved: SQLite/application durable jobs remain the operational
  admission/recovery authority while Git remains authoritative only for
  published curated memory.
- D27 is not changed: the supplied durable request carries `created_at` and
  `deadline`; the application/store job port remains responsible for the
  authoritative hard budget and lease clocks.
- No schema, protocol, CLI, store, application, service, plan/state, or policy
  files were edited.

## Remaining blocker and next owner

The canonical application path is not yet migrated. `crates/application/src/knowledge.rs:645-661`
still calls `Publisher::publish_with_expected_base` directly and has no
`PublicationJobPort` or store-backed `ExternalJobKind::MemoryPublication`
context. The exact request is in `INTEGRATION-REQUEST.md`. Until that owner
wires the application/store job port and service route, this handoff does not
claim full PF-S02-T11 coverage, end-to-end recovery, or production Git
publication acceptance.

## Source hashes

- `crates/memory/src/lib.rs` — `402fd795d744438a44ce6171cc2a1cbd7004d4f826231e94aac83d05f64c2f5a`
- `crates/memory/src/publisher.rs` — `51defd6f9c5583fcb3b181da2445de76966fc1de34933b9baa9a3dea9014dcd7`
- `crates/memory/tests/publisher.rs` — `f190f45bfb9e52ec88abd61e1a5d1079ba035d0c1a74edaa05bc5ab59f87e66c`

