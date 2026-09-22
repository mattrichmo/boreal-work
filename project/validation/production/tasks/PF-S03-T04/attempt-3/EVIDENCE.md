# PF-S03-T04 attempt 3 — corrective implementation evidence

## Attributable disposition

**Task:** `PF-S03-T04`
**Attempt:** `attempt-3`
**Disposition:** `READY_FOR_REVIEW`
**Scope:** bounded reconciliation of findings F-PF-S03-T04-01 and
F-PF-S03-T04-02 from rejected attempt 2.

This is an implementation handoff for independent exact-tree review. It is not
task acceptance and makes no sprint, service, native, publication, or release
claim.

## Finding reconciliation

### F-PF-S03-T04-01 — invalidated exact proof shadowed valid proof

Fixed in `crates/domain/src/acceptance.rs`: exact observations are split before
recency ordering. Only `EvidenceDisposition::Current` observations enter the
authoritative candidate list. Exact `Superseded`, `Late`, and `Revoked`
observations remain in a sorted historical list and produce `StaleEvidence`
(`Superseded`/`Late`) or `AlteredEvidence` (`Revoked`) diagnostics. If a valid
current observation exists, an invalidated newer observation cannot replace it.

The focused regression
`newer_invalidated_exact_observations_do_not_shadow_older_valid_pass` covers
all three invalidating dispositions and asserts both the older `Passed` result
and the retained diagnostic. The existing
`failed_stale_altered_and_missing_proof_are_distinct` regression now uses a
`Current` observation with `EvidenceResult::Stale`, alongside current failed
and altered observations, proving these current non-passing results remain
authoritative.

### F-PF-S03-T04-02 — review selection lacked sealed-submission binding

Fixed in `crates/domain/src/acceptance.rs`: `AcceptanceInput` now requires the
typed `current_submission_id`. Review selection requires both exact subject
equality and `review.submission_id == current_submission_id` before recency,
self-review, authorization, or outcome evaluation. A review for another
submission is retained as irrelevant and cannot satisfy the requirement.

The focused regression
`newer_approval_for_another_submission_cannot_satisfy_current_review` asserts
that an approved review for `newer-submission` produces
`ReviewState::Irrelevant` and leaves the required review unsatisfied. The
existing self-review regression still passes with the current submission
identity, preserving the self-review rule and reviewer authorization path.

## Changed paths

- `crates/domain/src/acceptance.rs`
- `crates/domain/tests/production_acceptance_policy.rs`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/START.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T04/attempt-3/HANDOFF.md`

No shared root registration was changed; `crates/domain/src/lib.rs` was
verified unchanged from the reviewed integrated boundary. No schema, protocol,
migration, store, application, service, native, publication, or release change
was made.

## Verification summary

The exact command outcomes and source identities are recorded in
`COMMANDS.md`. Formatting, locked domain test-target compilation, focused
acceptance tests, full `boreal-domain` tests, strict focused/library clippy,
and `git diff --check` all passed. The focused suite ran 12 tests with 0
failures; the full domain package ran 73 tests with 0 failures and 0 doc-test
failures.

## Preserved history and remaining gate

Rejected attempt-2 `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md`
were not edited. This attempt is ready for an independent reviewer to inspect
the combined source and rerun the affected checks. Coordinator acceptance and
all broader sprint or production gates remain outside this handoff.
