# PF-S02-T11 — attempt 35 evidence

## Disposition

The verifier-admission orphan-job remediation is implemented in the current
working tree and is ready for independent review. It is not accepted here and
was not committed or pushed.

## Implemented invariant

`admit_witnessed_execution` now builds the immutable evidence identity and the
external verifier-job identity, then delegates to a store seam that runs one
`BEGIN`/`COMMIT` boundary for:

1. validating the current attempt, fence, owner, deadline, source/config and
   gate profile;
2. inserting or replaying the evidence execution row;
3. inserting or replaying the external job row; and
4. promoting a newly registered job to `admitted`.

Therefore the evidence execution and external job are committed together or
rolled back together. A replay with the same digest reuses the existing job
and execution identity; a different immutable request is rejected by the
existing identity checks. No process launch permission is granted by replay.

The operation/audit journal remains the recovery authority required before the
identity-bound job admission. If a crash occurs after the journal commit but
before the paired transaction, the journal is a durable pending recovery
record; replay repairs the missing pair. This is intentionally not presented
as a single transaction with the journal itself.

## Changed scope observed

- `crates/application/src/evidence_store.rs`
  - passes the evidence and external-job identities to the atomic seam;
  - retains operation/audit journaling and idempotent replay;
  - adds focused rejection, half-write repair, and unknown-readback tests.
- `crates/store/src/jobs.rs`
  - adds `admit_evidence_execution_with_external_job`, the narrow atomic
    evidence/job transaction with project, subject, authority and identity
    checks.
- `crates/store/src/lib.rs`
  - exposes the narrow transaction-internal evidence admission helper used by
    that seam. The file also contains unrelated working-tree changes from
    other lanes; they are not attributed to this attempt.

## Focused behavior covered

- A deadline rejection leaves no evidence execution or external job.
- Replaying an admitted verifier preserves one execution identity and one
  admitted external job.
- A missing external job is recreated from the durable execution/journal
  identity without a second execution identity.
- A missing evidence row is recreated while reusing the existing external
  job.
- A started execution marked unknown remains `readback_required`; no unknown
  result is converted into proof or success.

## Exact source fingerprints at handoff

- `crates/application/src/evidence_store.rs`:
  `9fdcc27f06fd320425f931c5aa11d2ad8f709d23`
- `crates/store/src/jobs.rs`:
  `3ac2057dbe281296c94dd019218d3abd2ce139b2`
- `crates/store/src/lib.rs`:
  `1a96d9aa920535fd1a070585ba0bb2849ee7723e`

These are working-tree object hashes, not a commit identity. The tree also
contains other uncommitted lane changes.

## Test evidence

The focused application tests and the full application package passed on the
same current working tree. Store unit tests also passed. The full workspace
format check remains red only because of unrelated formatting in the shared
store backup/restore helpers; focused rustfmt and scoped diff checks passed.

## Residual limitations

- No OS/process crash injection was run; the crash-order property is shown by
  the transaction boundary and half-write recovery fixtures, not by killing a
  live process at each SQLite commit point.
- The operation/audit journal and the evidence/job pair still have separate
  transaction boundaries. The journal-first ordering is intentional because
  identity-bound external-job admission validates the operation/audit record;
  a journal-only intermediate state is replayable but is not claimed to be
  atomic with the evidence/job pair.
- This attempt does not implement backup/restore, bootstrap atomicity, or any
  CLI/TUI changes.
