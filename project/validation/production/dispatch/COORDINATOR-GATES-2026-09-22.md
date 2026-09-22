# Coordinator gate run — 2026-09-22

This record covers the combined dirty working tree after integrating the
PF-S02-T03 identity registration and the PF-S03-T06/T07 public domain modules.
It is validation evidence, not release acceptance.

## Passing gates

- `cargo fmt --all -- --check`
- `cargo test --workspace --locked`
- `cargo build --locked -p boreal-cli --bin bwrk`
- `cargo test --locked -p boreal-protocol`
- `cargo test --locked -p boreal-store`
- `cargo test --locked -p boreal-store --test production_identity_revisions`
- `cargo clippy --locked -p boreal-store --all-targets -- -D warnings`
- `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings`
- `cargo test --locked -p boreal-domain` (104 tests)
- `python3 project/spec/validate_contracts.py`
- `git diff --check`
- production plan JSON validation, graph validation, and package verification

Workspace test coverage includes 39 application unit tests, application
integration suites, 68 CLI unit tests, CLI integration suites, 104 domain
tests, 92 store tests plus one intentional ignore, 69 typed protocol registry
entries, service tests, source/memory tests, migration tests, and doc tests.

## Corrective compatibility fixes made during this gate

1. The application work-model migration test now uses an explicit schema-2
   fixture instead of an exact production schema request, because the
   canonical production opener upgrades exact production schema input before
   returning. The test still exercises the additive v3 migration path.
2. The CLI unavailable-v3 service test uses the same explicit schema-2 fixture
   only for that route-availability assertion; production service fixtures
   retain the canonical opener.
3. The protocol `ErrorCode` enum now includes all six typed entries already
   present in the registry: `integrity_quarantined`, `source_size_limit`,
   `receipt_size_limit`, `cleanup_pending`, `credential_revoked`, and
   `unsupported_target`.

These changes make the tests agree with the existing production/opening and
protocol contracts; they do not claim the remaining production-completion
plan tasks are complete.

## Open acceptance limits

- PF-S02-T03, PF-S03-T06, and PF-S03-T07 remain `ready_for_review`; independent
  reviewer evidence was not produced after three bounded reviewer attempts.
- PF-S02-T03's broader wiring of identity mutation calls into every canonical
  application/store transaction remains open.
- Genuine service lifecycle, native platform, installed-prefix, release, and
  production acceptance gates remain unrun or unaccepted.
