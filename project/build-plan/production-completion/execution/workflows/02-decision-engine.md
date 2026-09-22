# Workflow 02 — deterministic decision and action engine

## Scope

Primary sprint: PF-S03 — One deterministic domain decision and action model.

This stream owns pure status, reason, timer, precedence, allowed-action, and
denied-action decisions. It does not authorize the store to skip transaction
checks and does not turn status labels into authentication.

## Entry and exit

- Entry: PF-S01 contracts and PF-S03 effective dependencies are accepted.
- Exit: PF-S03's decision/action tests, independent review, reconciliation, and
  PF-S03-T92 pass against the integrated source.

## Worker boundary

- [ ] Keep domain code free of storage, JSON, terminal, and process concerns.
- [ ] Collect all applicable reasons before selecting the versioned primary
      status/reason.
- [ ] Keep queued, blocked, expired/recovery-required, awaiting-review,
      needs-verification, complete, and closed distinct.
- [ ] Preserve secondary reasons, affected subjects, next reevaluation time,
      and permitted/denied actions.
- [ ] Add property, boundary, contradiction, clock, and malformed-input tests.
- [ ] Treat action policy as a shared decision contract, not a TUI predicate.

## Parallelization

This stream may run concurrently with Workflow 01. Domain exports and status
version changes are integrated before consumers in PF-S05, PF-S07, PF-S10, and
PF-S13 are accepted.

## Handoff checklist

- [ ] Precedence and reason ordering are written down.
- [ ] Status/action outputs are deterministic for the same snapshot and time.
- [ ] Contradictory terminal facts and untrustworthy inputs produce diagnostics.
- [ ] No fabricated proof, dependency completion, or authorization is emitted.
- [ ] Consumer impact and required protocol changes are listed.
