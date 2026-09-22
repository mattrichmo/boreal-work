# premium

Command: `python3 scripts/validation/premium/validate_premium.py -v`

Scope: real PTYs and local fake release/controller fixtures, NOT Rust E2E

Result: **passed**; exit 0.

```text
test_cli_only_removes_only_the_previously_installed_dashboard (__main__.InstallerTests.test_cli_only_removes_only_the_previously_installed_dashboard) ... ok
test_failure_during_second_backup_restores_first_and_preserves_unmoved_files (__main__.InstallerTests.test_failure_during_second_backup_restores_first_and_preserves_unmoved_files) ... ok
test_install_and_reinstall_without_prompts (__main__.InstallerTests.test_install_and_reinstall_without_prompts) ... ok
test_interactive_machine_flow_installs_selected_components (__main__.InstallerTests.test_interactive_machine_flow_installs_selected_components) ... /usr/lib/python3.13/pty.py:95: DeprecationWarning: This process (pid=3004) is multi-threaded, use of forkpty() may lead to deadlocks in the child.
  pid, fd = os.forkpty()
ok
test_invalid_prefix_fails_before_installation (__main__.InstallerTests.test_invalid_prefix_fails_before_installation) ... ok
test_legacy_binary_is_preserved_without_explicit_permission (__main__.InstallerTests.test_legacy_binary_is_preserved_without_explicit_permission) ... ok
test_lock_blocks_concurrent_publish_without_touching_current_install (__main__.InstallerTests.test_lock_blocks_concurrent_publish_without_touching_current_install) ... ok
test_parent_traversal_member_is_rejected (__main__.InstallerTests.test_parent_traversal_member_is_rejected) ... ok
test_signal_after_backup_rename_restores_original_without_a_marker_gap (__main__.InstallerTests.test_signal_after_backup_rename_restores_original_without_a_marker_gap) ... ok
test_symlink_archive_is_rejected_before_extraction (__main__.InstallerTests.test_symlink_archive_is_rejected_before_extraction) ... ok
test_dashboard_narrow_resize_search_palette_and_quit (__main__.TerminalTests.test_dashboard_narrow_resize_search_palette_and_quit) ... /usr/lib/python3.13/pty.py:95: DeprecationWarning: This process (pid=3004) is multi-threaded, use of forkpty() may lead to deadlocks in the child.
  pid, fd = os.forkpty()
ok
test_dashboard_signal_restores_terminal (__main__.TerminalTests.test_dashboard_signal_restores_terminal) ... ok
test_embedded_rust_invocation_shape_executes_same_project_wizard (__main__.TerminalTests.test_embedded_rust_invocation_shape_executes_same_project_wizard) ... ok
test_project_wizard_cancel_restores_terminal_and_emits_no_selection (__main__.TerminalTests.test_project_wizard_cancel_restores_terminal_and_emits_no_selection) ... ok
test_project_wizard_returns_multiselect_json_without_creating_project (__main__.TerminalTests.test_project_wizard_returns_multiselect_json_without_creating_project) ... ok

----------------------------------------------------------------------
Ran 15 tests in 2.290s

OK

```
