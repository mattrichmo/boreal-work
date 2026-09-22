# PF-S02-T02 — Attempt 4 independent re-review evidence

## Decision

**ACCEPT for PF-S02-T02 only.** This is an independent re-review of the
attempt-3 correction against the attempt-2 rejection. It accepts the bounded
store-seam leaf evidence only; it does not accept PF-S02, any sprint gate,
service/native/publication/release scope, or any parent gate.

## Prior finding disposition

### F-PF-S02-T02-02-001 — corrected and independently verified

`crates/store/src/transactions.rs:21-136` defines a scoped
`RootMutationAdapter` with a private `&SqliteStore` reference and private
project scope. It has no `BEGIN`, `COMMIT`, `ROLLBACK`, expected-revision
comparison, `Drop` cleanup, or raw-store accessor. Its typed methods validate
project scope and delegate to existing root mutations.

The root remains the single transaction/revision authority. The real root gate
mutation at `crates/store/src/lib.rs:5588-5668` begins its own
`BEGIN IMMEDIATE`, calls the canonical `check_expected_revision`, bumps the
project revision, and finishes through the canonical `finish_transaction`.
The shared helpers remain in the root at `lib.rs:8278-8315`; the adapter does
not define a competing owner.

The focused test uses the public qualified
`transactions::with_root_mutation` path against a real SQLite store. The first
gate update commits exactly one revision bump and reads back the satisfied gate.
The second update uses the stale original revision and observes the typed
`StoreError::StaleRevision`; the revision and satisfied gate remain unchanged.
That proves the actual root commit path and stale rollback/no-write behavior,
and a wrapper transaction would have failed the first call with a nested
`BEGIN IMMEDIATE` error.

**Result: fixed; no residual finding.**

### F-PF-S02-T02-02-002 — corrected and independently verified

`crates/store/src/lib.rs:25-32` publicly registers all five seam modules. The
focused target imports them from `boreal_store` at
`crates/store/tests/production_store_seams.rs:9-12` and uses qualified
`transactions`, `profiles`, `execution`, `operations`, and `acceptance` paths
throughout. There are no `#[path]` mounts or test-local duplicate seam
modules.

**Result: fixed; no residual finding.**

## Companion seam review

- `profiles.rs` validates profile identity/JSON and delegates registration to
  the existing store primitive; it does not evaluate lifecycle policy.
- `execution.rs` delegates admission/start/finish/unknown transitions and
  incomplete readback; the focused test retains and reads an unknown execution.
- `operations.rs` validates the operation/audit bundle, appends through the
  non-transactional root primitives intended for an owned boundary, and keeps
  operation readback project-scoped. The focused test rejects a foreign-project
  readback.
- `acceptance.rs` exposes typed gate/diagnostic, receipt/review/summary, and
  close-intent facades without adding a SQL lifecycle predicate or raw-store
  escape. The focused test reads the pinned gate and exact acceptance binding.

The four companion modules have private root fields and no public raw-store
accessors. The store root remains the persistence authority, while policy stays
outside these storage facades.

## Validation outcome

The focused qualified seam target passed `5/5`; the full `boreal-store` package
passed `92` tests with one intentional release benchmark ignored and no
failures. Compile, contract validation, scoped formatting, and whitespace
checks passed. The required workspace-wide format check failed only because of
the unrelated `crates/domain/src/dependencies.rs:805` diff; it is recorded in
full in `COMMANDS.md` and was not changed because it is outside this leaf's
review boundary. This is a retained workspace observation, not a PF-S02-T02
seam failure.

The read-only Boreal workflow/candidate/work-show probes were typed
`service_busy` under the existing database owner. No typed workflow receipt was
fabricated, no live lock was broken, and no `STATE.json` or lifecycle state was
changed.

## Scope guard

Attempt-2 rejection evidence and attempt-3 correction evidence remain
preserved. This decision is bounded to PF-S02-T02 only. It makes no sprint,
service, native, publication, release, or parent-gate acceptance claim.

