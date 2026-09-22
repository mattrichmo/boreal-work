# PF-S02-T04 — Attempt 4 evidence

## Disposition

**Bounded remediation complete; ready for independent review; not accepted.**

This attempt fixes the two failing T04 assertions without weakening the strict
profile/schema implementation. It does not certify PF-S02-T04 or any parent
sprint gate.

## Change and diagnosis

The combined PF-S02-T10 tree made `ProfileStore::read_pinned_requirements`
verify the complete production schema, including immutable triggers, without
running DDL. The two T04 corruption fixtures intentionally dropped a trigger to
perform an owned test-only mutation, but left it absent for readback. Therefore
the read correctly returned the earlier schema-integrity quarantine instead of
the more specific data-corruption diagnostic asserted by the tests.

The remediation is confined to
`crates/store/tests/production_profile_requirements.rs`:

- the missing-child fixture drops the delete trigger, deletes one normalized
  declaration, recreates the same trigger, then reads back;
- the malformed-child fixture drops the update trigger, writes malformed JSON,
  recreates the same trigger, then reads back;
- comments document that the trigger bypass models owned corruption and that
  restoring it preserves the schema guard during readback.

`crates/store/src/profiles.rs` was inspected but not weakened or changed by
this attempt. Its strict tables/index/triggers check remains active. The
attempt added `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md` only
under the new attempt directory.

## Proven invariants

- Deleting a required normalized child is not treated as fewer requirements;
  readback returns `StoreError::Corrupt` containing `missing from the immutable
  declaration set`.
- A malformed normalized child declaration is quarantined with a diagnostic
  containing `declaration is malformed`.
- The existing subsequent malformed acceptance-profile readback remains
  covered and returns the profile-malformed diagnostic.
- Immutable triggers remain present at each readback boundary; no production
  DDL or runtime validation was relaxed.
- The focused target still covers profile digest binding, legacy quarantine,
  sibling versions, restart, observation deletion, and profile/child drift.

## Acceptance mapping

| T04 requirement | Evidence |
| --- | --- |
| Missing observed data cannot reduce required declarations | `missing_pinned_child_is_detected_instead_of_reducing_requirements`; focused target 13/13. |
| Malformed profile/child data fails closed with useful diagnostics | `malformed_pinned_profile_and_child_content_is_quarantined_on_readback`; focused target 13/13. |
| Production schema is read-only and trigger-protected | `production_integration` 4/4 plus strict store Clippy and format checks. |
| Combined contract remains valid | Contract validator passed. |

## Limits and retained blockers

- The full `boreal-store` suite is not green because
  `storage_remediation::status_gate_queries_are_batched_for_large_projects`
  reports 762 prepared statements versus the fixed-size expectation. This is a
  combined status/store integration failure outside the T04 test-fix scope.
- The combined worktree contains unaccepted PF-S02-T10, PF-S02-T11, and
  PF-S03-T10 changes, plus nested `memory/` runtime data. These are not
  acceptance evidence for this attempt.
- Application, service, real verifier, native, installer, publication, and
  release gates were not claimed or rerun here.
- Plan/state was not edited. Independent review, coordinator reconciliation,
  exact-tree revalidation, and the PF-S02 sprint gates remain required.
