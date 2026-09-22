# PF-S02-T04 — Attempt 3 repair start

## Identity and bounded scope

- Task / attempt: `PF-S02-T04` / `attempt-3`.
- Worker: bounded production-plan store worker.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input revision: `HEAD b543d41008301f7745c899e95f5cb7203ca64917`, branch
  `codex/apply-responsive-terminal-overlay`, dirty only by pre-existing
  `memory/` content outside this task's write set.
- Exclusive production paths: `crates/store/src/profiles.rs` and
  `crates/store/tests/production_profile_requirements.rs`.
- Evidence path: this attempt directory only.
- Protected paths: `crates/store/src/lib.rs`, schema manifests, SQL migration
  ordering, Cargo manifests, protocol registries, execution state and prior
  evidence. No protected path will be edited by this worker.

## Interpreted invariant

An acceptance profile version is an immutable, content-addressed definition,
and a work item retains a digest-bound task/container requirement snapshot
independent of gate observations. Profile rows, the snapshot header, and its
normalized declaration children must agree on identity/content; missing or
drifted facts fail closed as corruption. Restart must recover the same pinned
requirements, and legacy `{}` definitions remain quarantined without
authoritative reconstruction.

## Baseline and repair plan

The current source includes the coordinator's shared-root/schema integration:
work creation persists `boreal_pinned_requirement` and child declaration rows,
and status reads those declarations before observed gate state. The focused
target passes 9/9, but `ProfileStore::register` validates only shape, and
`read_pinned_requirements` does not verify the referenced profile row or the
normalized child rows. The prior attempt-2 rejection is retained unchanged;
this attempt adds the missing fail-closed checks and real SQLite coverage.

Planned changes are limited to the two granted Rust files. The tests will
cover profile registration/digest rejection, persisted deletion/drift,
sibling profile versions, close/reopen readback, legacy quarantine, and
malformed persisted JSON. No root or schema integration request is expected
because the current combined source already contains the required tables,
triggers, registration, and status query.

## Verification strategy

1. Run the current focused target before edits as the retained baseline.
2. Run scoped rustfmt, the focused target, store check/clippy, the full store
   package, contract validation, and `git diff --check` after edits.
3. Record exact commands, exits, source hashes, and limitations in the other
   attempt-3 evidence files. Do not claim task acceptance or independent
   review.

## Authority limits

This worker cannot accept PF-S02-T04, change execution state, edit shared
registration/schema files, or claim service/lifecycle/release evidence.
Failed and unsupported checks will be retained verbatim in the handoff.
