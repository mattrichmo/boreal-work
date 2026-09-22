# PF-S03-T04 attempt 4 — independent re-review start

## Review identity and scope

- Task: `PF-S03-T04` — requirement, evidence and review interpretation.
- Attempt: `attempt-4`.
- Reviewer: Codex independent validation reviewer.
- Review date: `2026-09-22`.
- Decision scope: PF-S03-T04 only.
- Decision: `accepted` for this leaf, subject to coordinator recording the
  decision through the normal review/reconciliation/revalidation workflow.

This re-review checks the two P1 findings from rejected attempt-2 against the
corrective attempt-3 source and evidence, the public registration, the accepted
production acceptance/proof contract, and fresh exact-tree validation. It makes
no sprint, service, native, publication, or release claim.

## Input identity

- Workspace: `/Users/cybertron/Code/boreal-work`.
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty combined tree with unrelated pre-existing changes; no
  unrelated path was edited by this review.
- Rust/Cargo: `1.85.0`.
- PF-S03-T04 card SHA-256:
  `cda28b913779aaf8e8e36159548e46872cdc832c32c5122c37bc11d3acee5a12`.
- Production acceptance contract SHA-256:
  `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245`.
- Contract manifest SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.

## Prior findings under re-review

1. `F-PF-S03-T04-01`: a newer exact-subject superseded, late, or revoked
   observation could shadow an older valid observation during recency
   selection.
2. `F-PF-S03-T04-02`: review selection was not bound to the exact sealed
   submission currently being evaluated.

Attempt-2 evidence and handoff, and corrective attempt-3 evidence and handoff,
were read and left untouched.

## Review method

The review inspected the complete current `acceptance.rs`, the focused
`production_acceptance_policy.rs`, and `crates/domain/src/lib.rs`. It verified
that invalidated exact evidence is retained only as diagnostics/history before
authoritative recency, that current failed/stale/altered results remain in the
authoritative candidate set, and that review selection requires exact subject
and `AcceptanceInput.current_submission_id` equality before recency,
self-review, authorization, or outcome evaluation.

The configured workflow and candidate readback probes returned typed
`busy/service_busy` because another process held the Boreal database owner.
No lock was broken and no lifecycle mutation was attempted; this unavailable
probe is retained in `COMMANDS.md` and does not substitute for source or test
evidence.
