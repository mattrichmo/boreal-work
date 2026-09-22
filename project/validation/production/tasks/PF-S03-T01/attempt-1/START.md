# PF-S03-T01 attempt 1 — start record

## Task and input identity

- Task: `PF-S03-T01` — introduce typed decision inputs and proof-relevant identities.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; `git status --porcelain=v1` reported 54 entries before this attempt.
- Toolchain observed: `rustc 1.85.0 (4d91de4e4 2025-02-17)`, `cargo 1.85.0`.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- PF-S01-T92 gate SHA-256: `f8d9683c95fa1d1b29a3a03aa542a27aadea64dde554322c49a4bfc86067a14d`.
- Accepted PF-S01-T92 handoff SHA-256: `ba94da456f397b9250a9fde5a55ad6c4479834bfd55af6c4fc0dbeb22ef84e2a`.

## Prerequisite and interpreted invariant

PF-S01-T92 attempt 3 is accepted for AC-01 / the contract-layer gate only.
Its handoff does not claim runtime, service, migration, verifier, race/fault,
TUI, native, installer, publication, or release acceptance. The implementation
consumes the accepted production contracts without reopening D01–D29, including
the distinct entity/proof/fence identity layers, proof-bound submissions and
reviews, close-only dependencies, preserved failed facts, and independent
availability/integrity/action dimensions.

The bounded invariant is: a pure domain decision receives canonical, typed
facts and a caller-injected evaluation clock; missing, unreadable, stale, and
failed facts remain distinguishable; malformed or contradictory combinations
produce explicit diagnostics; proof identity cannot be substituted with an
entity revision or attempt fence; and integrity scope/permitted actions do not
depend on service transport availability.

## Exclusive write set

This attempt may edit only:

- `crates/domain/src/decision_inputs.rs`
- `crates/domain/tests/production_decision_inputs.rs`
- `project/validation/production/tasks/PF-S03-T01/attempt-1/`

The existing `crates/domain/src/lib.rs` is a protected shared file and is not
being edited. The coordinator integration request is to add `pub mod
decision_inputs;` to that crate root and, after registration, switch the
focused integration test from its local source-path shim to
`boreal_domain::decision_inputs`. No plan JSON, execution state, other source,
or prior evidence will be changed.

## Verification strategy

Use focused pure-domain tests for identity non-interchangeability, fact-state
diagnostics, injected clock preservation, valid/invalid canonical combinations,
integrity/action independence, and cross-subject/proof mismatch rejection.
Run `cargo fmt --all -- --check`, the focused production test, and the existing
`boreal-domain` test target if the current dirty combined tree permits them.
Record unavailable or blocked commands exactly; do not claim service/runtime or
release evidence for this pure-domain task.

## Runtime coordination note

`bwrk prime boreal-work --json` was attempted before implementation and
returned typed `busy` / `service_busy` because the local database owner is
`process:68913:sha256:37e8ffb92bd9e159abd0e6909a484f6a9e0c1b0dc3451a9129bb4f74d6f5df8`.
No lock was broken and no runtime state was changed. This task can proceed
within its file-based source/evidence boundary; the runtime result is not a
success claim.
