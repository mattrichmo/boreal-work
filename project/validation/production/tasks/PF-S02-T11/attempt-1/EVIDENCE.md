# PF-S02-T11 — attempt 1 evidence

## Disposition

**BLOCKED / awaiting coordinator integration.** This attempt did not add
production code. It confirms that the requested adapter wiring cannot be
implemented safely within the granted paths and records the exact remaining
integration work.

## Findings

### T11-001 — Memory publisher path does not exist in the granted revision

The task grants `crates/memory/src/publisher.rs`, but that file is absent.
`Publisher`, `PublicationRecovery`, Git publication, and recovery-journal
logic are embedded in protected `crates/memory/src/lib.rs`. Creating a second
publisher module would create a disconnected implementation and require a
protected crate-root change. The correct fix is a path-change request to split
the existing implementation or to grant the existing file to the memory
integration steward, preserving its public API and current tests.

### T11-002 — Durable job/recovery APIs have no application adapter call sites

`crates/store/src/jobs.rs` and `crates/store/src/recovery.rs` expose durable
records, but source inspection found no calls from `crates/application`,
`crates/cli`, `crates/memory`, or `crates/service` to register/read back an
external job or create/resolve a recovery obligation. The rejected PF-S02-T06
review already identifies this as a mandatory integration finding. Adding a
new local adapter trait in `runtime.rs` or `evidence.rs` would not make the
canonical product use the store job records.

### T11-003 — Evidence execution has two independent durable state machines

The existing `WorkApplication::admit_witnessed_execution` path persists an
`evidence_execution` admission, while the new `boreal_external_job` API is a
separate transaction. The owned application files do not have a transaction
bundle that can commit the evidence execution row, external-job stage,
operation identity, audit event, and project revision together. Wiring only a
subset would permit states such as an admitted evidence execution with no
external job, or a running job whose evidence admission was rejected. This
would repeat PF-S02-T07's rejected finding instead of fixing it.

### T11-004 — Update and stop/release lack the required context in this leaf

`crates/cli/src/update.rs::run` receives only parsed CLI options, locates the
packaged installer, invokes it, and returns `ApplicationOutcome::Changed` on
process exit success. It has no project/store identity, authenticated actor,
operation digest, job ID, or readback route. Stop/release/expiry coordination
is implemented through protected service/store call sites, not
`application/src/runtime.rs` alone. Changing the success message or adding an
in-memory flag would not provide durable recovery semantics.

## What was verified

- Application tests passed on the exact dirty tree.
- CLI tests passed on the exact dirty tree.
- Contract validation passed.
- Memory publisher tests failed in two existing concurrency cases even when
  rerun alone; the failures were retained and not treated as adapter proof.
- No real service mutation, verifier receipt, Git publication, backup, update,
  or release artifact was claimed.

The complete command record is in `COMMANDS.md`. The implementation sources
were not modified in this attempt; the only new file before this record was
the required `START.md`.
