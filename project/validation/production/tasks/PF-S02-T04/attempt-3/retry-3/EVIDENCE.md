# PF-S02-T04 — retry 3 evidence

## Source and contract identity

- Input HEAD: `abf87bb528b55632499bb246c10aeb902680a582`.
- Worktree is dirty; source-file digests identify the edited paths, not a
  release or clean-tree identity.
- Contract manifest digest:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
- All 14 artifacts named by that manifest matched their SHA-256 values.
- `crates/store/src/profiles.rs` SHA-256:
  `f79b0aa150c65b3048541da626e65ce8d3103101d97f6415bbd6f32ca28dcc22`.
- `crates/store/tests/production_profile_requirements.rs` SHA-256:
  `0880a3792ba6b6de84640bd78709923f21269a4900ab66bae297218e65f3f51e`.

## Implementation evidence

- Profile gate derivation is factored into one helper so resolution, pin-write
  validation and readback use the same parsing, stable identity and duplicate
  declaration rules.
- Pin persistence loads the registered profile row, verifies its canonical
  digest and identity, then rejects a declaration vector that differs from
  that profile before inserting the immutable header or children.
- Pin readback repeats that comparison. A coordinated corruption that removes
  the declaration from both the header and normalized child table and
  recomputes the pin digest is returned as `StoreError::Corrupt`, rather than
  appearing as an intentional zero-gate profile.
- `PinnedRequirements::computed_digest` exposes the snapshot digest operation
  so callers/tests can independently verify or construct canonical snapshots.
- Existing observed-gate deletion coverage continues to pass: required pinned
  declarations remain readable and the missing observation is reported.
- Registration compatibility remains intact; strict gate declaration parsing
  is applied when a profile is resolved into persisted requirements, not when
  a legacy/noncanonical caller merely registers a digest-bound profile.

## Acceptance mapping

| Contract case | Evidence |
| --- | --- |
| A caller cannot persist a weaker self-consistent pin | `persistence_rejects_a_digest_valid_pin_that_disagrees_with_its_profile`; profile target 21/21. |
| Recomputed coordinated pin corruption cannot erase profile requirements | `readback_quarantines_a_recomputed_pin_that_omits_profile_requirements`; profile target 21/21. |
| Observation deletion does not delete declarations | Existing unit/store regressions, including `root_work_creation_pins_requirements_and_survives_gate_deletion`; profile target 21/21 and production integration 4/4. |
| Adjacent profile and root seams remain compatible | `production_store_seams`; 5/5. |

## Boundaries and remaining limitations

- No schema, migration, root, or module-registration change was needed for
  this delta. `profiles` is already publicly registered; root work creation,
  status, receipt, and closeout paths already consume the pinned store APIs.
- The acceptance contract also describes author/publisher and supersession
  metadata. The current profile table/API stores `created_at` but has no
  dedicated publisher or supersession fields. Adding those requires a
  separately authorized schema/migration and root-writer task; this retry did
  not alter those protected paths.
- The evidence directory numbering is inconsistent with the live ledger:
  T04 `STATE.json` records attempts 1–2, while directories for attempts 3–8
  exist. This retry preserved the prior `attempt-3/` files by using the nested
  `retry-3/` path. The coordinator must reconcile numbering before recording
  this result in `STATE.json`.
- This is implementation evidence only. It does not accept AC-06,
  PF-S02-T04, PF-S02, or any later sprint.
