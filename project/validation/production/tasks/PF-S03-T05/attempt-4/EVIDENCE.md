# PF-S03-T05 independent re-review attempt 4 — evidence

## Bounded decision

**Decision: ACCEPT for PF-S03-T05 only.** The three attempt-2 findings are
cleared by the current corrective source and focused fixtures. This record
does not accept PF-S03 as a sprint and makes no service, native, publication,
or release claim. Attempt-2 rejection and attempt-3 evidence remain
preserved; this is an independent re-review, not a replacement of either
record.

## Evidence checked

The current exact source identity is `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`
on `codex/apply-responsive-terminal-overlay`, with source and contract hashes
in `COMMANDS.md`. The public module remains registered at
`crates/domain/src/lib.rs:9-12`. The accepted decision-input boundary retains
typed `Fact::Unreadable`, `Fact::Stale`, and `Fact::Failed` diagnostics in
`crates/domain/src/decision_inputs.rs:270-335`.

## F-PF-S03-T05-01 — typed integrity facts and per-edge fail-closed behavior

Cleared.

- `UpstreamOutcome` has explicit `Unreadable`, `Corrupt`, and `Stale` variants,
  and each carries a `RawPrerequisiteContext` with edge, edge revision,
  predecessor identity, and raw payload (`dependencies.rs:454-513`).
- `UnmetReason` preserves those typed diagnostics, while `EdgeEvaluation`
  retains the original outcome, waiver, all raw observations, and the selected
  per-edge diagnostic (`dependencies.rs:539-593`).
- `evaluate_dependencies` retains unknown and malformed observations as raw
  aggregate diagnostics, attaches known-edge diagnostics to that edge, and
  emits `UnmetReason::MalformedObservation` rather than aborting the entire
  evaluation (`dependencies.rs:703-808`). `DependencyEvaluation::satisfied()`
  requires no aggregate diagnostics and all edge satisfactions to be satisfied
  (`dependencies.rs:601-608`), so malformed/integrity-degraded prerequisites
  cannot make progress eligible.
- `evaluate_edge` handles unreadable, corrupt, and stale outcomes before any
  accepted-close or waiver branch, making them explicitly unmet and preventing
  a waiver from overriding an integrity diagnostic (`dependencies.rs:859-916`).
- The focused tests prove typed raw payload retention and unmet status for all
  three integrity forms even with a supplied waiver, and prove that a
  malformed edge is retained per-edge while the aggregate evaluation remains
  ineligible (`production_dependency_policy.rs:600-715`).

This satisfies the dependency contract's requirements to keep failed/missing
observations visible, reject unreadable/corrupt facts as trustworthy proof, and
preserve raw data for repair/reporting. It also remains separate from the
work-model relation contract: a dependency is a direct-task execution edge,
not a planning parent, cycle assignment, or ordering label.

## F-PF-S03-T05-02 — current edge-scoped waiver revocation

Cleared.

- `dependency_impact` first refuses aggregate evaluation diagnostics, then
  validates the invalidation project, edge revision, and successor. It accepts
  a waiver revocation only when the evaluated edge is exactly
  `EdgeSatisfaction::Waived` and `waiver.applies_to(edge, at_revision)` is true
  (`dependencies.rs:1163-1224`). This checks edge ID, edge revision, project,
  successor, validity start, and revocation boundary.
- A missing waiver and an accepted-close observation carrying a non-current
  waiver both return typed `WaiverNotCurrent`; neither invalidates or
  propagates an edge. A current matching waiver is the only successful path.
- The focused fixture explicitly covers no waiver, accepted close with a
  non-current waiver, and a current waived observation
  (`production_dependency_policy.rs:718-786`).

This matches the dependency/override/reopen contract's one-edge, one-revision,
bounded waiver scope and its rule that revocation affects future use only when
the current edge satisfaction actually depends on that waiver.

## F-PF-S03-T05-03 — successor-rooted bounded impact

Cleared.

- The waiver-revocation root is now `edge.successor`, not
  `edge.predecessor` (`dependencies.rs:1187-1224`). `affected_subgraph` returns
  the deterministic dependent closure from that root and omits the root from
  its descendant node list (`dependencies.rs:975-1027`).
- Propagation after the initially revoked edge follows only current
  `AcceptedClosed` edges (`dependencies.rs:1252-1280`), so open/waived edges do
  not create false proof invalidation.
- The focused sibling fixture models `a -> b`, `a -> x`, and `b -> c`. It
  requires root `b`, includes only `c`/`e3`, invalidates `e1` and `e3`, and
  proves sibling `x` is absent (`production_dependency_policy.rs:788-872`).

The accepted-close identity/reopen path remains intact: invalidation matches
the exact `EntityIdentity` and `ProofRevision`, propagates through the current
accepted-close chain, classifies pending/active/historically closed
successors, and marks historical closes as preserved without rewriting them.
The existing focused fixture covers those cases and compares reopened and
revoked outcome impact (`production_dependency_policy.rs:436-528`).

## Contract and public-boundary review

The reviewed behavior is consistent with the unchanged dependency contract
(`boreal.work-dependency/2`) and work-model contracts:

- only accepted closed proof for the exact upstream identity satisfies a
  default edge;
- waivers remain edge-scoped and do not rewrite upstream lifecycle or proof;
- reopening/revocation preserves historical close identity and requires
  bounded dependent reconciliation; and
- dependency DAG edges remain distinct from decomposition, cycle assignment,
  and planning-order relations.

The public `boreal_domain::dependencies` registration is present and the
focused test uses that public module. No storage/service integration claim is
made here.

## Findings and limitations

- No new leaf-scoped finding was found in this independent re-review.
- The attempt-2 rejection is retained as historical evidence; it is not
  overwritten or reclassified retroactively.
- Read-only Boreal workflow/candidate resolution was blocked by the typed
  `service_busy` condition recorded in `COMMANDS.md`. No lock was broken and
  no `STATE.json` or lifecycle record was changed.
- The combined worktree remains dirty and includes unrelated user/coordinator
  changes. Only the four attempt-4 evidence files were written in this turn.

## Leaf decision

**ACCEPT — PF-S03-T05 only.** Coordinator/reconciliation records may consume
this bounded review result. No sprint, service, native, publication, or
release acceptance is implied.
