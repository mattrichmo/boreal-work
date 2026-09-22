# Agent start checklist

Use this checklist for every implementation or validation assignment. Complete
it in the handoff or dispatch record; do not treat this file as acceptance.

## Scope and authority

- [ ] Read `AGENTS.md`, the production plan README, the relevant sprint card,
      the complete task card, and the assigned stream workflow.
- [ ] Confirm the task ID, task kind, effective dependencies, entry gate, and
      acceptance owner.
- [ ] Read accepted prerequisite handoffs and contract versions.
- [ ] State the invariant the task must preserve and the behavior it is allowed
      to change.

## Source and isolation

- [ ] Record the exact input commit/tree/archive identity.
- [ ] Use an isolated worktree for implementation or review.
- [ ] Confirm the project root, working directory, database target, and service
      identity are the intended ones.
- [ ] Confirm no other active assignment owns the same file or protected root.
- [ ] Create one evidence directory for this attempt.

## Write boundary

- [ ] List worker-owned paths from the task card.
- [ ] List shared integration paths and their steward.
- [ ] Identify generated files, registries, manifests, schema/migration order,
      and protocol consumers affected by the change.
- [ ] Submit a change request before expanding beyond the declared boundary.

## Verification plan

- [ ] Name focused positive, negative, boundary, regression, and concurrency
      checks as applicable.
- [ ] Identify which checks are fixture-only and which require the real built
      service, binary, platform, or release.
- [ ] Record unavailable tools or external inputs as blockers before work.
- [ ] Confirm how evidence will be read back and bound to the source identity.
