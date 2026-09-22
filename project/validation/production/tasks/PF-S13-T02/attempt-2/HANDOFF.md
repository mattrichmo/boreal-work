# PF-S13-T02 bounded dashboard identity hardening — handoff

## Decision

**Bounded contribution: implemented and focused validation passed; not accepted as the full task.**

Dashboard selection now uses the existing `IdentityStore` boundary to validate database lineage and the stored workspace binding before returning JSON status or launching the dashboard. A regression fixture covers a copied database with rewritten, plausible metadata whose stored workspace binding still names the original project root.

## Changed paths

- `crates/cli/src/dashboard.rs` — added common project identity/workspace-binding validation and typed actionable failures.
- `crates/cli/tests/dashboard_launcher.rs` — added the mismatched stored-binding regression test.
- `project/validation/production/tasks/PF-S13-T02/attempt-2/START.md`
- `project/validation/production/tasks/PF-S13-T02/attempt-2/COMMANDS.md`
- `project/validation/production/tasks/PF-S13-T02/attempt-2/EVIDENCE.md`
- `project/validation/production/tasks/PF-S13-T02/attempt-2/HANDOFF.md`

## Validation

The permitted files pass standalone rustfmt and `git diff --check`. The
requested `cargo fmt --all -- --check` passed on final rerun. The focused
dashboard test passed with 6/6 tests. An earlier run was blocked by an
unmatched delimiter in `crates/store/src/lib.rs`, and the first regression
fixture run exposed a macOS temporary-path alias issue; both were retained in
the command record and resolved without editing excluded files.

## Next safe action

An independent reviewer should inspect the identity-selection behavior and
this regression fixture. Keep PF-S13-T02 unaccepted until its complete public
project/identity/actor/session command outcome and the required
integration/revalidation chain are complete.

- [ ] No full PF-S13-T02 completion claim made.
- [ ] No production source outside the permitted dashboard/test files changed.
- [x] Failed/blocked intermediate validation retained with its exact cause.
- [ ] No release or real-service claim made.
