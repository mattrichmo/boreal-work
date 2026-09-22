# PF-S03-T06 — Attempt 4 Evidence

## Decision

**ACCEPTED** for the bounded PF-S03-T06 leaf review. This is not sprint acceptance.

## Prior context read

Read:

- `project/validation/production/tasks/PF-S03-T06/attempt-1/HANDOFF.md`
- `project/validation/production/tasks/PF-S03-T06/attempt-1/COORDINATOR-INTEGRATION.md`

The handoff explicitly left public registration and independent review open. The coordinator integration records `pub mod actions;`, conversion to public-crate imports, and the exact integrated hashes. The current tree matches those hashes.

## Review findings

- Public registration: `crates/domain/src/lib.rs:9-14` exports `actions`; the focused test imports `boreal_domain::actions` at `crates/domain/tests/production_action_policy.rs:3-6`.
- Actor role/delegation: `actions.rs:449-466` enforces required roles and rejects empty delegated actor/delegation/delegator identities. `actions.rs:791-821` assigns role ceilings, including operator-only actions and independent review roles.
- Project/entity/proof/fence scope: `actions.rs:390-424` checks action/target project and work identity, entity revision, project snapshot revision, proof revision when required, and attempt/fence identity. `actions.rs:495-507` rejects missing/unreadable authority and cross-project authority. `actions.rs:567-594` rejects cross-scope or stale holds.
- Status-independent action descriptors: `actions.rs:301-377` emits the full stable action vocabulary with deterministic descriptor fields and does not derive descriptor shape from a status string. Typed `DerivedStatus` is passed as policy input and used only by authorization in `actions.rs:626-781`.
- Safe stop/history/recovery for blocked work: `actions.rs:604-623` leaves inspect/history/operation/export, stop, release, recover, reconciliation, hold resolution, review, waiver, force-gate, and repair routes available as policy permits; `actions.rs:721-724` requires an attempt or unresolved recovery for stop/release. `actions.rs:965-1030` supplies typed inspect/history/recovery routes for blocked, stale, hold, integrity, and role failures. Focused test coverage at `production_action_policy.rs:211-299` proves blocked claim/close denial and owner safe-stop availability.
- No fabricated override: action permission is bounded by `facts.permitted_actions` at `actions.rs:480-489`; actions without a mapped permission are not silently granted, and operator actions still require operator role. Force-gate and waiver are explicit typed actions with confirmation and reason inputs (`actions.rs:944-960`), not implicit bypasses.

## Test result

`cargo test --locked -p boreal-domain --test production_action_policy`

```text
running 7 tests
7 passed; 0 failed
```

Passed cases: complete/stable descriptors; actor-specific ready denial; blocked safe stop; mutation-boundary revision/fence checks; foreign scope and invalid delegation; operator-only ready work; quarantined repair versus forward progress.

## Limits preserved

This review covers the pure domain policy and its public registration only. It does not infer service/store transaction integration, native verifier execution, release evidence, or PF-S03 sprint acceptance.
