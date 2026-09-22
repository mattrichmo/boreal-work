# PF-S13-T02 bounded contribution review — commands

Working directory: `/Users/cybertron/Code/boreal-work`

Toolchain observed:

```text
rustc 1.85.0 (4d91de4e4 2025-02-17) (Homebrew)
cargo 1.85.0
```

Commands run:

1. Inspected the task card and sprint context:

   ```sh
   sed -n '1,260p' project/build-plan/production-completion/sprints/PF-S13/tasks/PF-S13-T02.md
   sed -n '1,220p' project/build-plan/production-completion/sprints/PF-S13/SPRINT.md
   ```

   Outcome: passed. The card confirms this is a full public project,
   identity, and actor/session command task; the reviewed files are only a
   bounded portion of its listed outcome.

2. Inspected the bounded implementation and tests:

   ```sh
   rg -n -C 8 'bind_project_workspace|WorkspaceBinding|setup::apply|resolve_workspace_root' crates/cli/src/main.rs
   rg -n -C 6 'canonical|symlink|metadata|project|database|workspace|starts_with|confine|isolation' crates/cli/src/dashboard.rs
   rg -n -C 4 'binding|project|metadata|symlink|workspace|database|init|dashboard|isolation' crates/cli/tests/project_setup.rs crates/cli/tests/dashboard_launcher.rs
   ```

   Outcome: passed. The source inspection found canonical-root binding during
   init, current-directory metadata confinement, canonical database
   resolution, explicit-selector handling, and focused isolation fixtures.

3. Ran the focused CLI integration tests:

   ```sh
   cargo test --locked -p boreal-cli --test project_setup --test dashboard_launcher
   ```

   Outcome: exit code 0. Results:

   ```text
   dashboard_launcher.rs: 5 passed, 0 failed
   project_setup.rs:     2 passed, 0 failed
   total:                 7 passed, 0 failed
   ```

The review did not run the full workspace suite, real-service lifecycle
matrix, release/install checks, or the proposed `production_project_cli`
target. Those checks are outside this bounded review and are not claimed.
