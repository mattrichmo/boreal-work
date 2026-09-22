# Evidence

## Changes

- `crates/cli/src/dashboard.rs`
  - Canonicalizes the resolved database before use.
  - Confines metadata-selected databases after canonical resolution to the canonical project root.
  - Requires an explicit `--project` when an explicit `--db` is used alongside ambient metadata, preventing stale metadata from selecting the project silently.
  - Preserves explicit project/database selection and existing aliases.
- `crates/cli/tests/dashboard_launcher.rs`
  - Added uninitialized-directory guidance coverage.
  - Added copied/stale metadata rejection coverage.
  - Added canonical symlink database escape rejection coverage.
  - Added two separate project-root coverage cases with the same project identifier.

## Final validation

`cargo test --locked -p boreal-cli --test dashboard_launcher`: **5 passed, 0 failed**.

The passing tests were:

- `dashboard_requires_initialization_in_an_uninitialized_directory`
- `dashboard_rejects_metadata_copied_from_another_project_root`
- `dashboard_rejects_a_database_symlink_escape_after_resolution`
- `dashboard_keeps_two_project_roots_with_overlapping_ids_local`
- `one_command_dashboard_supervises_private_service_and_tui`

Formatting and `git diff --check` also passed.

## Limitations

- This is a bounded CLI resolver hardening slice, not full project identity/authentication binding.
- It does not modify or claim the broader store/application identity APIs, corruption quarantine, service-backed lifecycle, release packaging, or full PF-S02-T08 acceptance.
- Full workspace tests and real installed-product validation were not part of this bounded request.

