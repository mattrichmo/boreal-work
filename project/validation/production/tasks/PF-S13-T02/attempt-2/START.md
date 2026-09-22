# PF-S13-T02 bounded dashboard identity hardening — attempt 2

- Worker: coordinator
- Started: 2026-09-22
- Scope: only `crates/cli/src/dashboard.rs` and `crates/cli/tests/dashboard_launcher.rs`, plus this evidence directory.
- Task card: `project/build-plan/production-completion/sprints/PF-S13/tasks/PF-S13-T02.md`
- Requested outcome: make dashboard project selection validate the stored database/workspace identity through `IdentityStore`, while preserving explicit `--db/--project` selection and actionable initialization errors.
- Explicit exclusions: `main.rs`, store/application/domain, `STATE.json`, `PLAN_PACKAGE_MANIFEST.json`, and unrelated files.
- This is a bounded contribution only; it does not claim PF-S13-T02 completion.

The prior independent review identified that dashboard selection trusted metadata and path strings without checking the stored project identity. This attempt addresses that specific limitation and adds a copied-database/rewritten-metadata regression fixture.
