# Boreal planning, cycle, and container acceptance contract

**Contract status:** proposed PF-S01-T03 artifact; subject to PF-S01 review,
reconciliation, and revalidation.

## One model, three relationships

Boreal separates:

1. **Decomposition:** a project-local acyclic containment tree explaining why
   work exists. Milestones and tasks are work kinds; a milestone is always a
   container, while a task may be direct or a container.
2. **Scheduling:** a cycle/sprint entity and temporal assignment history
   explaining when work is planned and committed. A cycle is not a work parent
   and cannot be an executable dependency endpoint.
3. **Dependencies:** close-only directed edges between direct tasks. A cycle
   assignment, milestone parent, cited source, or container rollup never
   becomes a dependency by implication.

The familiar milestone → sprint → task view remains a compatibility/grouped
view. Canonical writes use work decomposition plus cycle/assignment records;
there are not two independently mutable sprint authorities.

## Canonical entities

| Entity | Owns | Does not own |
| --- | --- | --- |
| Project | Namespace, policy, workspace binding, actor authority, revision, and optional primary cycle focus | A task-shaped lifecycle or global cross-project status |
| Milestone | Outcome scope, decomposition, acceptance/rollup requirements | Execution lease, claim, or cycle membership as parent |
| Task | Stable executable/container identity, milestone parent, requirements, dependencies, proof and history | A new identity when carried between cycles |
| Cycle / sprint | Delivery window, goal, planned/active/completed/cancelled lifecycle, scope, and assignment commitments | Task decomposition, execution attempt, or proof-producing dependency |
| Cycle assignment | Historical commitment of one task to one cycle, state, activation, ordinal, and carry-over links | Task lifecycle, milestone parent, or acceptance proof |
| Attempt | Fenced execution ownership for a direct task | Container rollup or cycle completion |
| Container closeout | Revisioned descendant set, dispositions, summary, and allowed review/audit/approval | A witnessed command or fake attempt |

## Work and parent rules

- New work kinds are `milestone` and `task`; legacy `sprint` rows remain
  readable/renderable but new schema-3 writes use cycles.
- Milestones are containers. Tasks are direct by default or containers when
  explicitly created as groups. Direct work cannot have children.
- Parent and child share a project and the decomposition graph is acyclic.
  Root milestones and root direct tasks are valid; an unscheduled root task is
  planning backlog, not malformed work.
- A cycle, source, intake bucket, or memory entry can never be a work parent.
- Changing execution mode is rejected after children, assignments,
  dependencies, proof, or container disposition history exists.
- Assigning, removing, or carrying a task to a cycle never changes its task ID,
  milestone parent, lifecycle, proof context, or dependency meaning.

## Cycle lifecycle and assignments

Cycle lifecycle transitions are explicit and audited:

```text
planned -> active -> completed
planned -> cancelled
active  -> cancelled
```

Clock passage derives due/start/end conditions; it does not silently commit a
cycle transition. A project may have multiple active cycles, such as delivery
and maintenance, with an explicit optional `primary_cycle_id`; dashboard order
never chooses the primary cycle.

Assignments are append-only history with one live slot per direct task in the
first release:

```text
cycle_assignment
  assignment_id, project_id, cycle_id, work_id
  state: planned | committed | removed | completed | carried_over
  activation_policy: at_cycle_start | immediate | explicit_not_before
  activation_at, ordinal, assigned_by, assigned_at
  ended_by, ended_at, reason
  predecessor_assignment_id, successor_assignment_id
```

Creating in a planned cycle creates `planned`; creating in an active cycle
creates `committed`. Explicit cycle start atomically commits all valid planned
assignments after revalidation; one invalid assignment rejects the whole
activation. A future activation derives `scheduled` without inventing another
assignment state. Activation does not publish draft tasks: a committed
assignment whose task is still `draft` remains non-claimable, and the cycle
readiness report includes `draft_scope_incomplete` with the affected task
identities. The planner must explicitly publish or remove/defer those tasks
before the cycle can report executable scope; the assignment history is
retained either way.

Closing a task marks its live assignment `completed` in the same authoritative
revision. Cancelling a task removes its live assignment with the cancellation
reason. A cycle cannot complete/cancel while a live assignment remains; every
unfinished assignment must first be removed or carried over.

## Carry-over

Carry-over is one idempotent transaction. It terminalizes the source
`planned|committed` assignment as `carried_over`, creates a successor in a
different planned/active target cycle, and links both rows with unique,
project-local predecessor/successor IDs. The target cycle must be planned or
active; the successor state is respectively planned or committed.

The task identity, milestone parent, dependencies, proof history, and prior
assignment remain unchanged. Repeating the same operation ID and payload
returns the same pair. Changing the target or payload under that operation ID
is a conflict. A carry-over does not close, cancel, reopen, or reassign the
task's decomposition parent.

## Dependencies and two parallel cycles

Dependency endpoints are direct tasks in the same project. The graph is
cycle-checked inside the serialized dependency mutation. Cross-cycle task
dependencies are valid: a task in Cycle B may wait for an accepted `closed`
outcome from a task in Cycle A. A normal unmet prerequisite derives `queued`
with an explicit upstream reason. An upstream hard hold/rejected review may
explain the wait but does not automatically turn every descendant into a new
hard-blocked status.

Launch/readiness does not require every task to be ready. A cycle can activate
with queued children when it has a valid revisioned scope, assignments, entry
points, dependencies, profiles, and policy. Activation does not claim or
start every task. A cycle may therefore contain committed assignments for
draft tasks, but its readiness/rollup must report that scope as incomplete
rather than treating draft work as queued, ready, or accepted.

## Container acceptance

Containers are not claimable. Their closeout uses append-only descendant
dispositions:

```text
accepted_closed | accepted_cancelled | deferred | replaced
```

Each disposition binds the descendant revision/outcome digest, reason,
authorized actor, policy digest, and optional replacement. A correction adds a
superseding row; it never deletes or rewrites the old fact. Required
descendants must be closed or have an authorized accepted cancellation,
deferral, or replacement; no hard hold may remain; allowed container gates and
one final summary must satisfy the current descendant-set/policy revision.

A container may require summary, review, audit, or operator approval. It may
not require a witnessed command/checkpoint directly. If integration testing
is required, create an executable direct closeout task beneath the container.
This preserves the invariant that witnessed execution belongs to a fenced
attempt.

Container acceptance percentage and reconciled commitment percentage are
separate:

- **Accepted work:** descendants with current accepted closed outcomes.
- **Reconciled scope:** every committed descendant is accepted, cancelled,
  deferred, or replaced with an authorized disposition.
- A cycle can have fully reconciled scope without claiming every original task
  succeeded. Deferred/replaced/cancelled work remains visible in reports.

## Compatibility and migration

The current fixed milestone/sprint/task tree is a compatibility facade. A
legacy sprint row maps to a cycle identity/history only through the explicit
DEC-04 migration disposition below; no historical subject is deleted, and
legacy terminal words do not become accepted `closed` without proof/review
analysis. During a mixed-version rollout, capability negotiation identifies
whether a client understands cycle/assignment records. A client that cannot
preserve assignment history must fail closed rather than silently flattening a
cycle into a parent work item.

The deterministic legacy mapping is:

- The source project and legacy sprint/work IDs remain the primary provenance
  keys. A legacy sprint maps to exactly one content-addressed cycle ID within
  that project; repeated import of the same source digest is idempotent.
- The sprint's stated goal and milestone links become the cycle goal and
  planning references. A legacy sprint work row becomes a
  `cycle_assignment` for the existing task; it never becomes the task's
  decomposition parent. Historical planned/active/finished state maps to
  planned/committed/completed assignment disposition only when unambiguous.
- Legacy proof subjects, receipt IDs, and digests are retained verbatim as
  provenance. `done`, `complete`, or `archived` alone never becomes accepted
  `closed`; ambiguous or unsupported rows become migration dispositions that
  require review.
- Same-project identity collisions are reported and fail the import rather
  than being merged. Mapping is digest-checked and collision-free; no source
  row is silently reassigned to a different target.
- Import writes a mapping manifest and reversible schema step. Rollback
  restores the prior database lineage/epoch through the supported migration
  mechanism and removes only rows created by that import, never by deleting
  canonical history or overwriting a newer revision.

Rollback is schema/protocol-aware: an old binary cannot open an incompatible
database merely because its process starts, and a cycle migration is not
reversed by deleting rows. Materialized projections and dashboard views are
rebuildable from canonical work/cycle/assignment/disposition history.

## DEC-04 amendment and implementation gate

This contract records the approved planning amendment as `boreal.work-model/3`
with cycle capability `boreal.cycle/1`. The bounded fixed-tree strategy remains
read-compatible only for legacy rows and compatibility reads;
`WorkKind::Sprint` is not a new mutable decomposition parent. The product
owner/coordinator is the authorizer recorded by PF-S01-T03, PF-S01-T11 owns the
implementation stewardship, and PF-S01-T90/PF-S01-T92 provide independent gate
review.

The amendment has these concrete impacts:

- **Schema:** add versioned cycle, cycle-goal, assignment, disposition, and
  migration-map records with project-scoped references, one live assignment
  constraint, predecessor/successor uniqueness, and restore-epoch checks.
- **Protocol:** advertise the `boreal.cycle/1` capability; expose cycle and
  assignment identities, assignment history, draft-scope diagnostics, and
  migration dispositions additively. A client without the capability can read
  the compatibility facade but cannot perform a write that would flatten or
  discard assignment history.
- **Migration/rollback:** use the deterministic mapping above, persist the
  source digest and mapping manifest, preserve proof subjects, and gate public
  writes until import, rollback, and collision fixtures pass.
- **Compatibility:** old sprint reads remain available during the migration
  window. Public cycle writes are explicitly blocked until schema,
  protocol, CLI/TUI, and service capability checks are present; the fallback
  of keeping sprint as a mutable parent is rejected.

The decision is approved as a planning direction but not as a shippable
implementation. The implementation gate is PF-S01-T11 plus its independent
review and PF-S02 migration acceptance. Baseline discrepancies (partial cycle
scaffolding, fixed-tree routes, absent atomic carry-over, and missing two-cycle
service/TUI parity) are owned by PF-S01-T11/PF-S02 and must be covered by the
migration, capability, collision, rollback, and draft-scope fixtures before
successor tasks can claim public parity.

## Open decisions and baseline discrepancy

This contract chooses the cycle-backed model described in WORK_MODEL_V2, while
making the legacy fixed-tree facade read-compatible. Public command vocabulary,
capability negotiation, and migration are bounded by the DEC-04 amendment
above; implementation remains blocked until the named gates pass. The current
v2 source has partial cycle/assignment scaffolding and fixed-tree routes; it
does not yet prove the complete model, atomic carry-over, container closeout,
or two-cycle service/TUI parity. Those are acceptance requirements, not claims
of existing support.

## Decision traceability

This artifact consumes D01, D04, D07, D09–D12, D17–D19, D22–D25, and D29, and
explicitly amends DEC-04 through the `boreal.work-model/3` /
`boreal.cycle/1` decision above. It explicitly adopts the
decomposition/scheduling separation recommended in WORK_MODEL_V2 while
preserving v2 Rust authority, failed-history retention, close-only dependency
satisfaction, proof-gated closeout, project-scoped memory, and local launch
limits. Any change to cycle identity, assignment cardinality, container
acceptance, migration behavior, capability negotiation, or draft-scope
semantics requires a reviewed versioned decision and updated conformance
fixtures. Owners, baseline discrepancies, and acceptance gates are recorded
in the DEC-04 section rather than deferred to an unbounded future
implementation.
