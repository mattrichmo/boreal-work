# responsive

Command: `python3 scripts/validation/premium/validate_responsive.py -v`

Scope: real PTYs and fake service fixtures, NOT Rust E2E

Result: **passed**; exit 0.

```text
test_custom_tty_wizard_reflows_even_when_stdout_is_a_file (__main__.ResponsivePtyTests.test_custom_tty_wizard_reflows_even_when_stdout_is_a_file) ... /usr/lib/python3.13/pty.py:95: DeprecationWarning: This process (pid=3821) is multi-threaded, use of forkpty() may lead to deadlocks in the child.
  pid, fd = os.forkpty()
ok
test_dashboard_is_operable_in_editor_panels_and_narrow_splits (__main__.ResponsivePtyTests.test_dashboard_is_operable_in_editor_panels_and_narrow_splits) ... ok
test_dashboard_resizes_while_inspector_is_focused (__main__.ResponsivePtyTests.test_dashboard_resizes_while_inspector_is_focused) ... ok
test_embedded_rust_invocation_at_190_by_12_is_interactive (__main__.ResponsivePtyTests.test_embedded_rust_invocation_at_190_by_12_is_interactive) ... ok
test_long_review_pages_without_premature_submission (__main__.ResponsivePtyTests.test_long_review_pages_without_premature_submission) ... ok
test_machine_installer_at_40_by_8_honours_components (__main__.ResponsivePtyTests.test_machine_installer_at_40_by_8_honours_components) ... ok
test_poll_recovers_with_sigwinch_delivery_intentionally_disabled (__main__.ResponsivePtyTests.test_poll_recovers_with_sigwinch_delivery_intentionally_disabled) ... ok
test_project_wizard_completes_at_24_by_6 (__main__.ResponsivePtyTests.test_project_wizard_completes_at_24_by_6) ... ok
test_public_terminal_probes_release_owned_file_descriptors (__main__.ResponsivePtyTests.test_public_terminal_probes_release_owned_file_descriptors) ... ok
test_resize_burst_and_cancel_restore_input_mode (__main__.ResponsivePtyTests.test_resize_burst_and_cancel_restore_input_mode) ... ok
test_resize_does_not_discard_prefix_caret_or_help (__main__.ResponsivePtyTests.test_resize_does_not_discard_prefix_caret_or_help) ... ok
test_startup_zero_dimensions_recover_when_pty_becomes_available (__main__.ResponsivePtyTests.test_startup_zero_dimensions_recover_when_pty_becomes_available) ... ok
test_transient_zero_resize_does_not_erase_last_valid_layout (__main__.ResponsivePtyTests.test_transient_zero_resize_does_not_erase_last_valid_layout) ... ok

----------------------------------------------------------------------
Ran 13 tests in 9.025s

OK

```
