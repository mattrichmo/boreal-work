# PF-S03-T05 independent review attempt 2 — evidence

## Bounded decision

**Decision: REJECT for PF-S03-T05.** The result is limited to this dependency-
policy leaf. It does not accept or reject PF-S03 as a sprint and makes no
service, native, publication, or release claim.

The exact tree is `HEAD:784a41b3802c29a76721c55eef2e9493283396c2` on branch
`codex/apply-responsive-terminal-overlay`. The reviewed public registration is
`crates/domain/src/lib.rs:9`; the implementation and focused test hashes are
recorded in `COMMANDS.md`. The accepted prerequisite handoff hashes are:

- PF-S03-T01 attempt 2: `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6`.
- PF-S03-T04 attempt 4: `9f2fbe7a8535e10934d70ab7b119e2e0657a83214047be500ebac2ab9aed427d`.

The contract identities read for this review are:

- `project/spec/production/contract-manifest.json`:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
- `project/spec/production/dependencies-overrides-reopen.md`:
  `3543fb5f1c3af51304826c66e02a3eb10dd0c1972cc35e77585c1b43a5a0a151`.
- `project/spec/WORK_MODEL_V2.md`:
  `f9c080e78599cec4304c5e3d8b0b4f7aa5a71900c7dbc9fcb643eadf13d1280b`.
- `project/spec/WORK_MODEL_SCENARIOS.md`:
  `82a4125d34a25563f098626b62482c370cf917f38a0fffd588b455c3856ebebd`.
- `project/spec/transition-table.md`:
  `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38`.

## What passed

Fresh exact-tree validation passed as recorded in `COMMANDS.md`: formatting,
the focused dependency target (`11` tests), all domain targets (`96` tests plus
`0` doc tests), test-target compilation, strict clippy, and `git diff --check`.
The focused suite and source review confirm these bounded behaviors:

- graph node/edge project checks, missing/non-direct endpoint rejection,
  duplicate IDs/endpoints, self-edge rejection, and deterministic cycle output;
- default satisfaction only for `Closed(Accepted { ... })` whose identity is
  equal to the observation identity; `complete`, `verified`, `cancelled`,
  failed, unaccepted, revoked, and mismatched identities remain unsatisfied;
- edge revision/successor/project waiver scope, validity/revocation boundaries,
  and retention of the raw outcome/waiver on an `EdgeEvaluation`;
- deterministic structural subgraph output for the covered single-root,
  insertion-order permutations; and
- pending, active, historically closed, and historically cancelled successor
  classification for the covered reopen/revocation chains without mutation.

Those positive cases are not sufficient for acceptance because the following
source-level gaps remain.

## Findings

### F-PF-S03-T05-01 — blocker: unreadable prerequisites have no typed raw fact

`UpstreamOutcome` at `crates/domain/src/dependencies.rs:452-462` has no
unreadable, corrupt, stale, or integrity-degraded state. `UnmetReason` at
`:488-497` likewise has only ordinary missing/not-accepted/waiver reasons.
`evaluate_dependencies` turns an omitted observation into
`ObservationMissing` at `:686-695`, while malformed observations abort the
whole evaluation with an error at `:636-678` rather than returning a
per-edge diagnostic and raw context.

This does not make the covered missing-observation case eligible, but it cannot
reproduce required F06 behavior: an unreadable prerequisite is either dropped
and made indistinguishable from ordinary absence, or coerced into `Failed`,
`Open`, or another known outcome. The existing accepted decision-input model
already distinguishes `Fact::Unreadable`, `Fact::Stale`, and `Fact::Failed`
(`crates/domain/src/decision_inputs.rs:319-335`), but this public dependency
policy boundary does not carry that distinction. A dependent therefore cannot
retain the required hard diagnostic/raw unreadable prerequisite context. The
focused tests cover missing and malformed observations, not unreadable or
corrupt prerequisite facts. This is the task's known critical F06 class and
must be reconciled before the leaf can be accepted.

### F-PF-S03-T05-02 — major: waiver revocation does not verify a current waiver

For `DependencyInvalidation::WaiverRevoked`,
`dependency_impact` validates only the supplied edge ID, edge revision,
successor, and project at `crates/domain/src/dependencies.rs:987-1004`.
It then unconditionally inserts that edge into `invalidated_edges` at
`:1030-1032`; it never checks that the current observation carries the same
waiver or that the edge is currently `EdgeSatisfaction::Waived` at the
evaluation revision.

A concrete counterexample is a graph `a -> b -> c` whose current observations
are accepted closes with no waiver. Supplying a waiver-revocation event for
`a -> b` returns `invalidated_edges = [e1, e2]` and propagates to `c`, even
though no waiver existed and both accepted close references remain valid. The
same false invalidation occurs when an accepted close happens to carry a
non-satisfying/stale waiver, because accepted close wins at
`:719-728` but the revocation branch ignores the evaluation. This violates the
edge-scoped waiver contract's requirement to revoke only the current waiver,
preserve the raw prerequisite, and avoid invalidating unrelated accepted
proof references.

### F-PF-S03-T05-03 — major: waiver-revocation affected subgraph is rooted too
broadly

The waiver-revocation branch chooses `edge.predecessor` as the structural root
at `crates/domain/src/dependencies.rs:1001-1005`, then computes the preview from
that root at `:1007`. A waiver is scoped to the one edge and affects the edge's
successor first; the predecessor's other dependents must not be included just
because the predecessor is named in the edge.

For `a -> b` with the waived edge, plus an independent accepted edge `a -> x`
and a downstream `b -> c`, revoking the `a -> b` waiver returns an
`affected_subgraph` containing `x` and its dependents even though their current
accepted close references are unaffected. The later propagation loop correctly
starts from invalidated-edge successors at `:1041-1049`, so the structural
preview and `successors` output disagree about the scope. A broad preview can
expand authorization/reconciliation scope and invalidate a preview digest for
unrelated work, contrary to the contract's bounded impact-preview requirement.

## Review boundary notes

The graph validator does correctly reject non-direct endpoint *kinds* supplied
in its canonical endpoint input (`:287-295`) and enforces project-local nodes
and edges. The public API does not itself bind a `WorkId` to the separate
`work_model_v3::WorkNode`/execution-mode record; application/store integration
must therefore supply canonical endpoint kinds and retain the committing-store
check. That is an integration obligation, not a claimed service pass here.

Likewise, accepted-close currentness is an input-boundary obligation in this
pure API: `evaluate_edge` compares the outcome identity with the supplied
`DependencyObservation.predecessor` (`:719-728`) but has no independent current
predecessor snapshot. The coordinator must bind that field to the current
canonical work identity and preserve reopened/revoked old outcomes as raw
history; this review does not treat an omitted store snapshot as service
evidence.

## Required reconciliation

Reconcile the three findings above with focused negative fixtures for unreadable
and corrupt prerequisite facts, nonexistent/already-noncurrent waiver
revocation, waiver revocation with sibling dependents, and accepted-close
identity after predecessor reopen. Then rerun the exact commands in
`COMMANDS.md` on the resulting combined source identity. Preserve this rejected
review and attempt-1 evidence; do not edit `STATE.json` as part of this review.
