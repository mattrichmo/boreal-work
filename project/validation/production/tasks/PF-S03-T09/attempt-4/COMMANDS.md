# PF-S03-T09 — attempt 4 commands

Working directory: /Users/cybertron/Code/boreal-work

## Focused implementation checks

    rustfmt --edition 2021 --check crates/application/src/status.rs crates/cli/src/main.rs
    git diff --check
    npm --prefix apps/tui run typecheck
    cargo test --locked -p boreal-application status --lib
    cargo test --locked -p boreal-cli direct_status_uses_derived_hierarchy_and_readiness
    cargo test --locked -p boreal-cli no_goal_next_emits_one_required_contract_valid_action
    cargo test --locked -p boreal-cli no_goal_start_selects_and_starts_a_claimable_task
    cargo test --locked -p boreal-cli service_start_without_work_selects_and_starts_a_claimable_task
    cargo test --locked -p boreal-cli release_acceptance
    cargo test --locked -p boreal-cli service_status_uses_complete_canonical_status_dto
    cargo test --locked -p boreal-application legacy_claimability_remains_discovery_hint_when_action_context_is_unavailable

All focused Rust checks passed. The application status target reported 10
passing tests; the focused CLI targets passed, including direct and service
status/start/discovery and release acceptance. Formatting and diff checks
passed.

## TUI and cross-boundary checks

    npm --prefix apps/tui run typecheck
    npm --prefix apps/tui test

Typecheck passed. The default TUI suite could not open its Unix socket under
the restricted runner (EPERM before assertions). The same suite was rerun
with the required local socket permission and passed all 98 tests.

The real built binary was then used to create a disposable project, emit
status --json, and feed that exact JSON envelope to the compiled TUI decoder.
It passed and preserved ready, claimable: true, actions: null, and
action_context.state: unavailable.

The full cargo test --locked -p boreal-cli run reached 82 passing unit tests
and the integration suite, then stopped at an unrelated existing
project_setup::init_scaffolds_skills_and_is_safe_to_repeat failure. That
failure is retained as a suite-level result and is not attributed to this
compatibility remediation; the same changed-path focused tests passed.
