# Handoff

The dashboard resolver now fails closed for uninitialized directories, copied metadata bound to another root, and metadata database paths that escape through symlinks after canonicalization. Explicit `--db` selection must be paired with explicit `--project` when ambient metadata exists.

Changed files:

- `crates/cli/src/dashboard.rs`
- `crates/cli/tests/dashboard_launcher.rs`

Validation is complete for this narrow slice: formatting, the five-test dashboard integration target, and diff checks passed. No plan state or manifest was changed. The next broader work remains canonical identity binding through the application/store initialization path and independent review under the correctly assigned CLI task.

