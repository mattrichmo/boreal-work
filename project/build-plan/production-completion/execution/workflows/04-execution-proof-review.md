# Workflow 04 — execution, proof, review, and closeout

## Scope

- PF-S06 — Fenced multi-agent execution, leases and safe recovery
- PF-S07 — Profiles, genuine verification and immutable submissions
- PF-S08 — Independent review, closeout, overrides and lifecycle reconciliation

## Entry and exit

- PF-S06 and PF-S07 start after PF-S05 revalidation.
- PF-S08 starts only after PF-S06 and PF-S07 are accepted.
- No stream result is accepted from a fixture-only lifecycle test when the task
  requires genuine service or verifier evidence.

## Worker boundary

- [ ] Pair every execution mutation with authenticated principal, session,
      fence, lease, deadline, expected revisions, and a transaction reread.
- [ ] Preserve failed attempts, late evidence, rejected reviews, expiry, and
      recovery obligations.
- [ ] Store immutable profile definitions and task-pinned requirements separate
      from observations and decisions.
- [ ] Bind submissions and review decisions to the exact proof-relevant task,
      source, configuration, attempt, and revision.
- [ ] Keep rejection distinct from missing proof and from awaiting review.
- [ ] Make overrides additive, scoped, reasoned, audited, and revocable; never
      turn a failed receipt into a fabricated pass.
- [ ] End execution ownership on safe submission without erasing the review or
      closeout obligation.

## Parallelization

PF-S06 and PF-S07 may run concurrently in separate worktrees. PF-S08 and
PF-S11 may run concurrently after both prerequisites pass. Store/application
roots remain stewarded and are integrated serially.

## Handoff checklist

- [ ] Competing claims produce one valid owner.
- [ ] Stale fences, expired leases, old sessions, and wrong actors are denied.
- [ ] Wrong-subject, stale, failed, or unrelated receipts never satisfy proof.
- [ ] Independent review identity and delegation rules are demonstrated.
- [ ] Close, release, reopen, cancel, retry, and expiry preserve history and
      recovery obligations.
