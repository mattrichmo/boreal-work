# PF-S02-T04 — Attempt 3 evidence

## Record identity

- Record: `PF-S02-T04` / attempt `3` / acceptance row `AC-06`.
- Evidence class: store / deterministic SQLite contract and corruption-readback.
- Input source: `HEAD b543d41008301f7745c899e95f5cb7203ca64917`, dirty combined
  tree, branch `codex/apply-responsive-terminal-overlay`.
- Worker paths: `crates/store/src/profiles.rs` and
  `crates/store/tests/production_profile_requirements.rs`.
- Runtime: Darwin ARM64; Rust/Cargo 1.85.0; Python 3.14.3.
- The prior rejected attempt-2 evidence remains untouched.

## Implemented invariant

`ProfileStore::register` now requires a content digest that matches canonical
JSON and rejects an empty legacy `{}` definition without authoritative
provenance. Profile shape validation rejects non-object JSON and malformed
gate required/observable fields.

Pinned requirement readback now validates the referenced acceptance-profile
row, its canonical content digest, the pinned profile identity, and every
normalized declaration child against the immutable header. Missing, malformed,
or drifted profile/child content returns a typed corruption error instead of
silently reducing the requirement set. Existing transaction-owned persistence
remains idempotent for an exact snapshot and conflict-rejecting for a
same-scope repin.

## Focused observations

The final focused target passed 13/13:

- immutable same-version conflict and exact replay;
- required declaration retained after observed-gate deletion;
- distinct task/container subjects and sibling profile versions;
- durable sibling work rows retain different profile versions;
- durable pinned requirements survive a close/reopen of the canonical
  production SQLite schema;
- missing normalized pinned child is detected rather than treated as fewer
  requirements;
- malformed child declaration and malformed profile definition are quarantined
  on readback;
- malformed JSON, non-object definitions, non-boolean required fields, and
  unverified registration digests are rejected;
- legacy empty definitions require authoritative reconstruction or are
  quarantined;
- root work creation persists the independent requirement set and status still
  reports a missing observed gate after observation deletion.

These are genuine store tests against SQLite. The deletion/drift fixtures
temporarily remove immutable triggers only to model owned corruption; normal
database writes remain protected by the production triggers.

## Acceptance mapping

| Task requirement | Evidence |
| --- | --- |
| Deleting a required observed gate never deletes the requirement | `persisted_requirements_survive_observation_deletion`; `root_work_creation_pins_requirements_and_survives_gate_deletion`; focused target exit 0. |
| Profile default/content drift cannot silently reprofile pinned work | `immutable_registry_rejects_conflicting_same_version_content`; `conflicting_repin_is_rejected_and_identical_repin_is_idempotent`; persisted profile digest validation. |
| Sibling profile versions survive reopen/restart | `sibling_work_items_keep_distinct_pinned_versions_durably`; `pinned_requirements_survive_canonical_database_restart`. |
| Legacy empty definitions do not become zero-gate profiles | `empty_legacy_definition_requires_authoritative_reconstruction_or_quarantine`; registration rejects empty authoritative content. |
| Deletion/drift and malformed inputs remain detectable | `missing_pinned_child_is_detected_instead_of_reducing_requirements`; `malformed_pinned_profile_and_child_content_is_quarantined_on_readback`; focused target exit 0. |

## Source and artifact hashes

```text
HEAD: b543d41008301f7745c899e95f5cb7203ca64917
profiles.rs: 2579cf199c7b54bedac1b3d348af6902cb96e6a535010813648a2f71bc68d58d
production_profile_requirements.rs: 45b2bfa13f5964cb941b231cb2e69541e3cc37e965267faabeb9161dfe027059
store/src/lib.rs: dd968734f962ba2e5f8677a5f0b4ac93721a6f1bbad34aa8172bcea9aa28cc65
schema-production.sql: 1f5c73fd84ed5df8618c6181aeaffd135a2c138d518e05f673e7ffe76f035d34
schema-v2.sql: ae5febe8a491404f7cc4103164b82369b24fb19977239a00860978b30ca545e1
```

## Limitations and remaining risks

- The package-wide store test and all-target clippy checks cannot compile the
  current combined tree because unrelated
  `crates/store/tests/production_operation_audit.rs:748` calls missing
  `SqliteStore::audit_event_in_context`. This worker did not edit that file or
  the protected root API.
- Workspace-wide formatting remains red in unrelated application/domain files;
  assigned files pass scoped formatting.
- No service, application lifecycle, real verifier, native, installer,
  publication, or release evidence was attempted. The focused evidence is not
  a task acceptance receipt or independent review.
- The worker did not edit `crates/store/src/lib.rs`, schema/migration files,
  protocol files, `execution/STATE.json`, plan files, or prior evidence.
- The documented `bwrk workflows show` read-only path is unavailable in this
  local CLI (`unknown command path`); no state-changing Boreal command was
  attempted.
