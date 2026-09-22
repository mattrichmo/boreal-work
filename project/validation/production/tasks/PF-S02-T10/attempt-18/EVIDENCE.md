# PF-S02-T10 attempt 18 — evidence

## Disposition

**Bounded ready-for-review handoff; not accepted.** The store adapter now
compiles against the concurrent `StatusContext` shape and the focused store
targets pass. The full store suite still has two profile-requirement assertion
failures, and the application integration remains outside this attempt's write
set.

## Implemented within the authorized boundary

- `crates/store/src/profiles.rs`
  - Production/read verification of pinned-requirement tables, index and
    immutable triggers is now read-only and fail-closed.
  - Noncanonical schema-v2 compatibility fixtures may install the additive
    tables only on their first write; subsequent reads verify rather than run
    DDL.
  - Canonical production paths reject a missing pinned-requirement schema
    instead of repairing it from a profile read/write helper.
- `crates/store/tests/production_store_seams.rs`
  - Reconciled the strict profile fixture to the computed content digest
    `sha256:04937b08e17caa0326307286452067bee4354acde865e7890753f8ad4a`.
- `crates/store/src/lib.rs`
  - Terminal attempt mutation paths request canonical resource release through
    the durable release-event protocol while retaining the legacy reservation
    as a compatibility projection.
  - Close finalization performs the same canonical release request and creates
    an unresolved recovery obligation until the physical release is
    acknowledged.
  - Missing canonical reservation data fails closed for canonical production;
    noncanonical historical fixtures retain compatibility behavior.
- `crates/store/src/status_evaluation.rs`
  - Passes `schedule` and `activation_at` into the domain evaluator.
  - Reads the earliest activation instant from canonical live v3 cycle
    assignments and does not infer a work schedule from retry timing.
- `crates/store/tests/production_integration.rs`
  - Added combined production target covering fresh/upgrade/reopen schema
    verification, immutable requirement retention and profile drift quarantine,
    identity-bound replay/rollback/project boundary, and canonical release
    request/acknowledgement.

## What is proven

- Authorized-file formatting and `git diff --check` pass.
- Contract validation passes.
- The strict profile fixture is reconciled to the implementation's digest.
- The focused store seam target passes 5/5 and the combined production target
  passes 4/4.
- The store library passes strict Clippy, formatting, contract validation and
  diff checks.
- The production opener already contains the pinned-requirement DDL in the
  ordered schema; this attempt removes the profile helper's production DDL
  authority and adds tests for fresh/upgrade/reopen behavior.

## What is not proven

- The complete `boreal-store` command is not green: two profile-requirement
  assertions fail at `production_profile_requirements.rs:576` and `:614`.
- The application check is not green: `status.rs:291` needs the new status
  fields, and `evidence.rs:687` has an independent borrow/move error. Those
  files are protected and were not edited.
- Canonical terminal/close release wiring has not received executable runtime
  confirmation on this combined tree.
- No service, application, verifier, release, platform, plan-ledger or
  production acceptance claim is made.
