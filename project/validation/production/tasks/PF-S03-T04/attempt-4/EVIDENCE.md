# PF-S03-T04 attempt 4 — independent re-review evidence

## Attributable decision

**Reviewer:** Codex independent validation reviewer  
**Task:** `PF-S03-T04` only  
**Decision:** **ACCEPTED** for this leaf  

The corrective source satisfies the two rejected attempt-2 findings, and all
requested focused/full domain validation and strict clippy checks passed on the
current combined tree. This is not acceptance of PF-S03 as a sprint and makes
no service, native, publication, or release claim.

## Findings re-reviewed

### F-PF-S03-T04-01 — invalidated exact proof can shadow valid proof

**Disposition: fixed and accepted.** In `crates/domain/src/acceptance.rs`,
`interpret_evidence` first requires the complete requirement identity and exact
proof subject. Exact observations with `EvidenceDisposition::Current` enter
the authoritative `exact` list. Exact `Superseded`, `Late`, and `Revoked`
observations enter a separate sorted `invalidated` history list before any
recency selection. Their diagnostics are retained as stale (`Superseded` or
`Late`) or altered (`Revoked`). Therefore an invalidated newer observation
cannot replace an older current observation.

The authoritative `exact` list does not filter by `EvidenceResult`: a current
`Failed`, `Stale`, or `Altered` result remains the selected raw result and is
not converted to missing. The focused
`failed_stale_altered_and_missing_proof_are_distinct` vector passed, and
`newer_invalidated_exact_observations_do_not_shadow_older_valid_pass` passed
for all three invalidating dispositions while asserting retained diagnostics.

### F-PF-S03-T04-02 — review selection lacked sealed-submission binding

**Disposition: fixed and accepted.** `AcceptanceInput` now requires the typed
`current_submission_id`. `interpret_review` admits a review to the exact
candidate list only when both `review.subject == input.subject` and
`review.submission_id == input.current_submission_id`; only that list is
recency ordered and passed through self-review, role authorization, and
outcome interpretation. A newer approval for another submission remains an
irrelevant historical fact and cannot satisfy the current review gate.

The focused `newer_approval_for_another_submission_cannot_satisfy_current_review`
vector passed with `ReviewState::Irrelevant` and an unsatisfied requirement.
The existing `self_review_is_rejected_and_not_reported_as_missing_review`
vector passed. The existing domain self-review vector and the unauthorized
force-exception vector also passed.

## Public registration and contract

`crates/domain/src/lib.rs` still publicly registers `pub mod acceptance;`, and
the focused test imports the module through `boreal_domain::acceptance`.
Current hashes for the public registration, decision-input types, accepted
production contract, and contract manifest match the corrective attempt-3
identities recorded in its evidence.

## Validation result

- Formatting: passed.
- Domain test-target check: passed.
- Focused acceptance policy: 12 passed, 0 failed.
- Full `boreal-domain`: 73 passed, 0 failed, 0 doc-test failures.
- Strict focused-target clippy: passed with `-D warnings`.
- Strict domain-library clippy: passed with `-D warnings`.
- Diff whitespace check: passed.

The workflow/candidate application probes returned typed `busy/service_busy`
because the database owner was held by another process. No live lock was
broken, no ledger or lifecycle state was mutated, and the probe was not used
as acceptance evidence.

## Scope and history

Only this attempt-4 evidence directory is new from this review:

- `START.md`
- `COMMANDS.md`
- `EVIDENCE.md`
- `HANDOFF.md`

Attempt-2 rejected evidence, attempt-3 corrective evidence, product source,
`STATE.json`, public registration, and unrelated dirty paths were preserved.
