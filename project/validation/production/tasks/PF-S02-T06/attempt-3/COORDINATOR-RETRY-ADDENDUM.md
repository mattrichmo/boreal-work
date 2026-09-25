# PF-S02-T06 attempt 3 — current-checkout retry addendum

## Disposition

Bounded store implementation and focused checks are complete for this retry.
This is a worker handoff only: it does not accept PF-S02-T06, PF-S02, or any
end-to-end lifecycle. The pre-existing attempt-3 `START.md`, `COMMANDS.md`,
`EVIDENCE.md`, and `HANDOFF.md` are preserved unchanged. They identify a
different input revision and must remain historical evidence, not evidence for
this checkout.

## Source identity

- Repository: `/Users/cybertron/Code/boreal-work`
- Branch: `codex/apply-responsive-terminal-overlay`
- HEAD: `abf87bb528b55632499bb246c10aeb902680a582`
- Checkout state: extensively dirty before this retry. Existing work was
  preserved. `crates/store/src/jobs.rs` already had coordinator changes before
  this retry; only the transition rule described below is attributable here.
- SHA-256 after this retry:
  - `crates/store/src/recovery.rs` —
    `53b6cd34dfd9c950b4de4d6a844294f0cd5b3dba4d2426ad5927f01294f1edc6`
  - `crates/store/src/jobs.rs` —
    `488f3cad1f510b3769f76c1afd2c37f861be1920b4442fc880fa35701e699148`
  - `crates/store/tests/production_recovery_records.rs` —
    `d1b6b6de24c34e608b72bc945356cad822655db83d7a633db6170aac0415ef3b`

## Changes attributable to this retry

- `crates/store/src/recovery.rs`: the unbound public create, resolve,
  reserve-resource, request-release, and acknowledge-release methods now fail
  closed for canonical production stores and identity-bound projects. The
  transaction-scoped helpers remain available to authenticated canonical
  lifecycle writers; identity-bound recovery resolution remains the supported
  disposition path.
- `crates/store/src/jobs.rs`: `readback_required -> failed` is no longer a
  legal external-job transition. An unknown external outcome remains pending
  until attributable readback reaches `reconciled` with its required result
  digest. Earlier known execution-failure transitions are unchanged.
- `crates/store/tests/production_recovery_records.rs`: added coverage for
  canonical and identity-bound legacy-write rejection, no side effects on
  rejected calls, and rejection of guessed failure after readback becomes
  required. The production-restart test now seeds its persisted row as fixture
  data instead of using an unbound production mutation API.

## Writer-path distinction

The current dirty candidate contains canonical writers that create durable
obligations; those writers are separate from the guards added above:

- Claim inserts the durable resource reservation inside the claim transaction.
- `apply_attempt_mutation` handles release, failure, expiry, and cancellation:
  in one transaction it clears current attempt ownership, requests canonical
  resource release, then inserts the unresolved recovery obligation before
  operation/audit/revision commit.
- Submission handoff in `crates/store/src/acceptance.rs` and close finalization
  in `crates/store/src/lib.rs` request canonical resource release and create a
  durable resource-recovery obligation when execution ownership ends.
- Claim eligibility checks unresolved obligations, and canonical recovery
  resolution acknowledges the exact pending resource release in the same
  transaction as the audited resolution.

These are source-inspection findings plus store-level tests, not real-service
proof for every terminal path. No process-stop adapter is wired here: expiry
and cancellation still receive a `stop_confirmed` input, and
`crates/service/src/recovery.rs` keeps its operation-recovery journal in
process memory. A caller-supplied confirmation is not independent evidence
that a process stopped.

External-job call sites currently include verifier execution, Git-backed
memory publication, and update handling. Backup/restore use the separate
`boreal_maintenance_job` path in the CLI/store rather than the project- and
operation-bound external-job record. That path and process termination still
need identity-bound external-effect registration/readback integration.

## Protected integration review

No root module-registration or schema/migration patch is requested by this
retry. `crates/store/src/lib.rs` already declares the `recovery` and `jobs`
modules and validates their production tables/indexes/triggers. The current
`project/spec/schema-v3.sql` contains the recovery/resource/external-job DDL,
and `production_migration_plan()` applies that schema in the ordered
`work-model-2-to-3` step. The production migration target passed below.
`crates/store/src/lib.rs`, schema manifests, and migration ordering were not
edited.

One known out-of-scope test caller must be reconciled before broad application
tests: `crates/application/tests/production_external_jobs.rs` creates a
recovery obligation directly after binding the project. This retry correctly
rejects that unbound call. The test should seed fixture state through test SQL
or use an authenticated canonical writer; do not weaken the production guard
to accommodate fixture setup.

## Commands and outcomes

- Before edits, `cargo test --locked -p boreal-store --test
  production_recovery_records` — passed, 12/12.
- After edits, `rustfmt --edition 2021 --check crates/store/src/recovery.rs
  crates/store/src/jobs.rs
  crates/store/tests/production_recovery_records.rs` — passed.
- `cargo test --locked -p boreal-store --test production_recovery_records` —
  passed, 13/13.
- `cargo test --locked -p boreal-store --test
  production_external_job_boundary` — passed, 4/4.
- `cargo test --locked -p boreal-store --test production_migrations` —
  passed, 18/18.
- `git diff --check -- crates/store/src/recovery.rs crates/store/src/jobs.rs
  crates/store/tests/production_recovery_records.rs` — passed.

All three Cargo invocations emitted the same pre-existing warning from the
protected root: unused import `std::fmt::Write` in `crates/store/src/lib.rs`.
The store crate compiled for these focused targets. No full workspace, real
process-stop, backup/restore, service, CLI, or release acceptance run is
claimed.

## Next integration actions

See `COORDINATOR-INTEGRATION-REQUEST.md`. Preserve this addendum and all prior
attempt evidence. Independent review is still required.
