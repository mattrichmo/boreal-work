# Boreal production completion — multi-agent stream plan

Status: execution overlay, 2026-09-22. This document is a coordination layer
over the existing production-completion plan. It does not replace
`plan.json`, `STATE.json`, sprint cards, accepted contracts, or review gates.

## Outcome

Move the 22-sprint production plan through parallel implementation streams
without turning shared Rust roots, protocol contracts, schema migrations, or
acceptance state into an uncontrolled merge queue.

The intended operating model is:

```text
one coordinator/integration owner
        |
        +-- up to three implementation streams
        +-- one independent validation/review stream
        +-- one release/platform stream when eligible
```

Each implementation assignment remains one task card, one input source, one
exclusive write allocation, and one handoff. A stream is a dispatch grouping,
not a permission to claim an entire sprint or edit every file in its area.

## Authority and non-negotiable rules

1. `plan.json` owns task IDs, dependencies, task instructions, write paths and
   acceptance ownership.
2. `execution/STATE.json` owns live assignment and acceptance state. Markdown
   checkboxes are progress aids only; they are not receipts.
3. Sprint cards own the sprint goal, entry gate, review gate, reconciliation
   gate, and revalidation gate.
4. [PARALLEL_DISPATCH.md](PARALLEL_DISPATCH.md) and
   [SHARED_FILES.md](SHARED_FILES.md) own the shared-file and integration
   rules.
5. The workflow files in `workflows/` describe stream responsibilities. They
   never override a task card or authorize a product behavior change.
6. The checklists in `checklists/` are required evidence prompts, not a way to
   mark work accepted without a source-bound handoff and independent review.

No agent may:

- edit `STATE.json`, the plan graph, acceptance records, or sprint gates;
- edit another stream's protected file without an integration request;
- declare a task, sprint, release, or finding accepted;
- reuse a failed attempt as a pass or delete failed evidence;
- claim a task whose effective dependencies are not accepted;
- use a fixture, mock, or UI result as genuine Rust-service or release proof;
- broaden a stream into a redesign, legacy import, or backend policy change
  without a bounded change request.

## Current dispatch position

The current ledger has PF-S00 and PF-S01 complete. PF-S02, PF-S03 and PF-S13
contain partial or rejected work; the other later sprints remain unstarted.

The immediate safe launch is:

- **Foundation/store stream:** repair and finish eligible PF-S02 tasks.
- **Decision-engine stream:** repair and finish eligible PF-S03 tasks.
- **Validation stream:** independently review each integrated task and prepare
  the sprint gate evidence; it does not edit the implementation branch.

PF-S13 must not be treated as an active implementation stream yet. Its current
work is retained as evidence, but its plan entry depends on PF-S10 and PF-S12.
It may receive read-only design preparation and test planning, not accepted
production changes ahead of its entry gate.

## Stream roster

| Stream | Workflow | Sprint coverage | Primary concern | First eligible point |
| --- | --- | --- | --- | --- |
| Coordinator | [00-coordinator.md](workflows/00-coordinator.md) | All | Dispatch, integration, ledger, gates | Now |
| Foundation/store | [01-foundation-store.md](workflows/01-foundation-store.md) | PF-S02 | Requirements, revisions, schema, durable jobs | PF-S02 entry |
| Decision engine | [02-decision-engine.md](workflows/02-decision-engine.md) | PF-S03 | Pure status, reasons, action decisions | PF-S03 entry |
| Identity/service | [03-identity-service.md](workflows/03-identity-service.md) | PF-S04–PF-S05 | Project binding, actors, service, operations | After PF-S02/PF-S03 |
| Execution/proof/review | [04-execution-proof-review.md](workflows/04-execution-proof-review.md) | PF-S06–PF-S08 | Leases, evidence, submissions, review, closeout | After PF-S05 |
| Planning/projections | [05-planning-projections.md](workflows/05-planning-projections.md) | PF-S09–PF-S10 | Milestones, cycles, dependencies, queues | PF-S09 after PF-S04; PF-S10 after PF-S08/PF-S09 |
| Memory/maintenance | [06-memory-maintenance.md](workflows/06-memory-maintenance.md) | PF-S11–PF-S12 | Sources, memory, migration, backup/restore | PF-S11 after PF-S05/PF-S07 |
| CLI/workflows/TUI | [07-cli-workflows-tui.md](workflows/07-cli-workflows-tui.md) | PF-S13–PF-S15 | Public parity, trusted guidance, terminal UX | PF-S13 after PF-S10/PF-S12 |
| Validation/release | [08-validation-release.md](workflows/08-validation-release.md) | PF-S16–PF-S21 | Real service, security, packaging, cutover | PF-S16/PF-S18 prerequisites |

## Dependency waves

The following is the maximum safe overlap at sprint level. A stream lead still
dispatches individual task cards only after checking task-level dependencies
and path conflicts.

### Wave 1 — foundation and decision truth

Run concurrently:

- PF-S02 — Canonical persistence, revisions and migration foundations
- PF-S03 — One deterministic domain decision and action model

Checkpoint: both sprints must pass implementation integration, independent
review, reconciliation, and revalidation before PF-S04 can be accepted.

### Wave 2 — identity plus service/planning preparation

First complete PF-S04 — Authenticated actors and project/workspace isolation.
Then run concurrently, in isolated worktrees:

- PF-S05 — Versioned service, durable operations and snapshot plumbing
- PF-S09 — Milestones, cycle-backed sprints and dependency planning

PF-S05 is the owner of shared service/protocol contract changes. PF-S09 may
develop planning/domain work in parallel, but its shared protocol or service
patches are integration requests until the steward applies them.

### Wave 3 — execution and proof

After PF-S05 revalidation, run concurrently:

- PF-S06 — Fenced multi-agent execution, leases and safe recovery
- PF-S07 — Profiles, genuine verification and immutable submissions

After PF-S06 and PF-S07 are accepted, run concurrently:

- PF-S08 — Independent review, closeout, overrides and lifecycle reconciliation
- PF-S11 — Versioned sources, curated memory and recoverable handoff

PF-S11 does not need to wait for PF-S08, but it does need PF-S07's accepted
proof/profile contracts.

### Wave 4 — projections, maintenance, and parity join

Once PF-S08, PF-S09, and PF-S11 are accepted, run concurrently:

- PF-S10 — Exact projections, launch readiness and actionable queues
- PF-S12 — Legacy parity, backup/restore and explicit maintenance recovery

Then integrate PF-S13 — Complete human and machine CLI/service parity. It is a
join sprint and should not start by copying early implementation from its
rejected attempt into the final tree.

### Wave 5 — workflow and product surface

After PF-S13 revalidation, run concurrently:

- PF-S14 — Trusted workflows and no-goal multi-harness agent guidance
- PF-S15 — Production terminal workspace and recovery UX

### Wave 6 — real validation and distribution

After PF-S14/PF-S15, run concurrently:

- PF-S16 — Integrated real-service product conformance
- PF-S18 — Reproducible packaging, installer and recoverable upgrades

Then run concurrently:

- PF-S17 — Adversarial security, fault tolerance, scale and soak
- PF-S19 — User onboarding, operator runbooks and support readiness

PF-S20 — Exact-artifact release qualification and independent cutover — waits
for PF-S17, PF-S18, and PF-S19. PF-S21 — Authorized publication, clean-install
verification and operational handover — remains sequential after PF-S20.

## Checkpoint protocol

Every task moves through these checkpoints. A stream lead may prepare the next
checkpoint while another stream is working, but may not skip one.

### C0 — Dispatch ready

- [ ] Task card and all effective dependencies have been read.
- [ ] Source identity, accepted contracts, external inputs and reviewer are
      recorded.
- [ ] Worker and shared-integration write sets are conflict-checked.
- [ ] Isolated worktree and task attempt directory are assigned.

### C1 — Worker acknowledged

- [ ] Worker stated the invariant, intended change, and expected proof.
- [ ] Worker identified all shared-file integration requests before editing.
- [ ] Coordinator confirmed the task is not broader than its card.

### C2 — Patch ready

- [ ] Worker handoff names every changed path and source identity.
- [ ] Focused positive, negative, boundary, and regression checks are recorded.
- [ ] Failures, unavailable tools, and limitations are preserved.
- [ ] Shared-root changes are submitted as integration requests, not silently
      merged by the worker.

### C3 — Independent review

- [ ] Reviewer is independent of the implementation worker.
- [ ] Reviewer inspected the diff, tests, contract impact, and evidence.
- [ ] Findings have severity, owner, disposition, and follow-up task IDs.
- [ ] No finding was hidden by changing the task state.

### C4 — Integrated tree

- [ ] Coordinator applied the patch to the combined worktree.
- [ ] Shared roots, registries, schemas, protocol models, and generated files
      were reconciled by their steward.
- [ ] The integrated source identity was recorded.
- [ ] Affected combined-tree checks passed or are explicitly blocked.

### C5 — Revalidation

- [ ] Revalidation ran against the integrated source, not the worker branch.
- [ ] Required task/sprint evidence is attributable to the actual binary or
      service where required.
- [ ] Existing failures and new findings remain linked to the attempt.
- [ ] Only the coordinator updates the live ledger.

### C6 — Unlock

- [ ] Task acceptance has all required handoff/evidence/reviewer fields.
- [ ] Sprint review, reconciliation, and revalidation gates are accepted where
      applicable.
- [ ] Successor readiness was recomputed from `plan.json` and `STATE.json`.
- [ ] The next stream received the accepted source identity and handoff.

## Merge and concurrency policy

Parallel implementation is allowed; parallel mutation of protected files is
not. The following files remain serialized through their steward:

- `crates/store/src/lib.rs`
- `crates/application/src/lib.rs`
- `crates/protocol/src/models.rs`
- `crates/cli/src/service.rs`
- `crates/cli/src/main.rs`
- `crates/cli/src/command_registry.rs`
- schema manifests and migration ordering
- workflow/skill manifests
- plan graph, `STATE.json`, and acceptance records

When two stream tasks require one of these files, the streams still work in
parallel on non-shared modules and tests. The coordinator serializes the
shared integration patch, reruns the affected checks, and asks the original
worker to review any semantic reconciliation.

Use separate worktrees for all concurrent implementation streams. Never use a
shared checkout as a coordination mechanism. Never solve a merge collision by
resetting or discarding another stream's work.

## Coordinator operating cadence

At each coordination pass:

1. Read `STATE.json` and list accepted, ready, in-progress, rejected, and
   blocked tasks by stream.
2. Dispatch only tasks whose graph prerequisites and path allocations are
   satisfied.
3. Check in with workers at C1, C2, and C4 rather than waiting for a whole
   sprint to finish.
4. Send completed patches to independent validation immediately; do not batch
   unrelated streams into one review.
5. Integrate one shared-file steward patch at a time.
6. Update the ledger only after evidence is source-bound and the relevant gate
   is accepted.
7. Announce the next unlocked tasks and the exact reason for every blocked or
   rejected task.

## Definition of concurrent progress

The project is making healthy parallel progress when at least two eligible
streams have active, disjoint implementation work and one independent review
or integration checkpoint is moving. It is not healthy to have many agents
editing shared roots, repeating the same rejected attempt, or producing tests
that cannot be accepted because their prerequisite contract is missing.

## Linked operating files

- [Coordinator workflow](workflows/00-coordinator.md)
- [Reusable agent-start checklist](checklists/AGENT_START_CHECKLIST.md)
- [Checkpoint checklist](checklists/CHECKPOINT_CHECKLIST.md)
- [Integration checklist](checklists/INTEGRATION_CHECKLIST.md)
- [Independent review checklist](checklists/INDEPENDENT_REVIEW_CHECKLIST.md)
- [Release checklist](checklists/RELEASE_CHECKLIST.md)
