# Boreal v2 work, cycle, schedule, and intake model

Status: proposed implementation contract for the next versioned work-model
boundary. This document audits the current v2 model and defines the target
model. It does not claim that the target schema, commands, or UI exist yet.

Normative words `MUST`, `MUST NOT`, `SHOULD`, and `MAY` describe product
requirements. The implementation must version any change to these semantics
and update the executable fixtures before accepting writes under the new
version.

## 1. Decision summary

The current v2 foundation is sound in the places where it separates persisted
work lifecycle from derived status, containment from dependencies, attempts
from work, and operational state from source, memory, and evidence. Those
separations remain authoritative.

The current fixed `milestone -> sprint -> task` containment tree is not the
right long-term model. It conflates two different facts:

1. **Decomposition:** why a unit of work exists and which larger outcome it
   contributes to.
2. **Scheduling:** when a unit of work is planned for delivery.

The target model therefore makes the following decisions:

- A **project** is an authority and namespace, not a work item.
- A **milestone** and a **task** remain work-item kinds. Work containment is a
  project-local decomposition tree.
- A **sprint becomes a separate cycle entity**. `WorkKind::Sprint` is not
  accepted for new writes after schema version 3 is active. The enum variant,
  row decoder, exact reads, and historical rendering remain supported
  indefinitely for compatibility; conversion never requires deleting the
  legacy subject.
- **Planning backlog** and **executable backlog** are derived views, not
  container work items. Planning backlog means unscheduled direct work;
  executable backlog is the ready/claimable subset. Cycle scope is a third,
  separate view.
- A task's milestone parent does not change when the task is assigned to,
  removed from, completed in, or carried between cycles.
- **Dependencies, hard holds, dispatch policy, time windows, current attempts,
  and acceptance gates remain separate canonical axes.** There is no generic
  executable condition language.
- **Recurring sprints are a stable recurrence series with immutable template
  versions and stable slot keys that materialize cycle instances.** Editing a
  template never renumbers a slot or rewrites a started/completed occurrence.
- Notes, discoveries, questions, and revisit reminders are **intake items**,
  not fake tasks. They may be triaged or promoted into work, immutable source
  versions, or source-cited memory drafts through typed promotion tables.
- Raw source, curated memory, and immutable evidence keep their existing trust
  boundaries. Intake prose cannot satisfy a work gate, source text cannot
  become an instruction, and a note is not witnessed execution.

The model uses independently negotiable capability identities. A client MUST
not infer support for one capability from another:

| Capability | Initial identity | Meaning |
| --- | --- | --- |
| Work/decomposition | `boreal.work-model/3` | Direct/container work, flexible hierarchy, typed scheduling. |
| Derived status | `boreal.work-status/3` | Status/reason precedence for the new inputs. |
| Cycle | `boreal.cycle/1` | Cycle instances, goals, assignments, carry-over. |
| Recurrence | `boreal.recurrence/1` | Series, template versions, stable slots, reconciliation. |
| Intake | `boreal.intake/1` | Intake lifecycle and typed promotions. |

SQLite `user_version = 3` is the additive current-v2 storage migration. It is
not the legacy-v1 import format. Protocol discovery advertises each capability
and its route set independently; absence means unsupported, never best-effort
fallback. Final identifiers are frozen with shared contract fixtures before
writes are enabled.

## 2. Current-state audit

The audit is based on the current [schema fixture](schema-v2.sql), the
[domain model](../../crates/domain/src/lib.rs), the
[migration model](../../crates/migration/src/lib.rs), and the product contracts
in [PRODUCT.md](../PRODUCT.md), [STATUS_MODEL.md](../STATUS_MODEL.md),
[STATE_AND_CONCURRENCY.md](../STATE_AND_CONCURRENCY.md),
[SOURCE_ENGINE.md](../SOURCE_ENGINE.md), and [MEMORY_BANK.md](../MEMORY_BANK.md).

### 2.1 What is already correct and must be retained

- `project_id` scopes work, source versions, operations, revisions, and audit
  state.
- Work persists only `draft`, `open`, `closed`, or `cancelled`; visible
  `queued`, `ready`, `blocked`, attempt, proof, and expiry statuses are derived.
- Parent containment and blocking dependencies are distinct relationships.
- Dependencies default to close-only satisfaction and are cycle-checked.
- Priority, dispatch policy, retry delay, hard holds, acceptance profiles,
  attempts, leases, hard deadlines, gates, receipts, reviews, summaries, and
  close intent are separate records or fields.
- One current attempt per work item and one current execution per session are
  protected with fences and uniqueness constraints.
- Receipt and audit rows are append-only historical facts.
- Source versions identify immutable bytes, memory publication has a separate
  reviewed Git lifecycle, and neither is treated as live work state.
- Status snapshots have a revision, `as_of`, and a future clock transition;
  clients are not allowed to invent eligibility.

### 2.2 Current limitations

| Area | Current behavior | Consequence |
| --- | --- | --- |
| Project | `project` contains identity, contract versions, revision, and timestamps only. | No canonical name, description, lifecycle, timezone, workspace binding, or cycle focus exists. |
| Hierarchy | `work_item.kind` is `milestone`, `sprint`, or `task`; triggers require root milestone, sprint under milestone, and task under sprint. | A task cannot exist in an unscheduled backlog, a milestone cannot contain work spanning multiple cycles cleanly, and moving a task between sprints changes its strategic parent. |
| Execution | The status evaluator is work-kind agnostic. | A milestone or sprint can appear leaf-claimable unless every caller adds extra policy. Containers and directly executable work are not explicit. |
| Scheduling | Work has `due_at` and `retry_not_before`; there is no cycle instance, cycle membership, active-cycle state, `not_before`, planned window, or schedule history. | Due dates cannot express availability, cycle dates, carry-over, or historical planning. |
| Recurrence | No recurrence template or occurrence identity exists. | Recurring sprints would require copying work containers and risk duplicate or rewritten occurrences. |
| Intake | There is no operational note/discovery/question/revisit entity. | Users must misuse tasks, raw sources, or published memory for untriaged material. |
| Conditions | Dependencies and holds exist, but there is no complete typed account of schedule activation and other reasons. | Adapters are tempted to add ad hoc booleans or JSON conditions and derive different statuses. |
| Migration | The migration format preserves the fixed milestone/sprint/task tree. It maps several legacy terminal-looking statuses directly to `closed`. | It cannot represent cycle membership, recurrence, intake, or ambiguous historical closeout without a new format and explicit review. |
| API/TUI | The Rust service now routes `create_project`/`create_work`, and the TUI maps its create methods to those routes. The current create-work DTO still models `milestone | sprint | task` and the present hierarchy. | Route existence is no longer the gap; schema-3 DTOs, capability negotiation, new invariants, and real-client fixtures must replace the old semantics atomically. |
| Dashboard | `bwrk dashboard` now resolves the project, starts a private service, launches the TUI, supervises children, and cleans up. | The launcher gap is closed in source; packaging, platform coverage, richer routes, and end-to-end release fixtures remain acceptance work. |

The audit also finds a representation mismatch: `due_at` exists in SQLite but
is not part of the current domain `WorkItem`, and the approved status contract
describes an overdue badge that the pure evaluator cannot currently derive.
The target model resolves this through typed schedule input to the evaluator.

## 3. Target authority map

```text
Project namespace
├── Work decomposition tree
│   ├── milestone/container work
│   └── task/container or task/direct work
├── Delivery cycles
│   ├── optional recurrence series and immutable template versions
│   ├── materialized cycle instances
│   └── temporal task assignments
├── Intake
│   ├── buckets
│   ├── notes/discoveries/questions/revisit items
│   └── promotion links
├── Sources and curated memory
└── Attempts, immutable evidence, summaries, audit, and operations
```

Four relationship types MUST remain visibly different:

| Relationship | Meaning | Shape |
| --- | --- | --- |
| Decomposition parent | Work contributes to a larger work outcome. | Acyclic tree/forest within one project. |
| Dependency edge | A direct task cannot advance until another direct task satisfies policy. | Acyclic directed graph of direct tasks within one project. |
| Cycle assignment | Work is scheduled into a delivery period. | Temporal many-to-many history with one live planned/committed assignment per direct task in the first release. |
| Provenance/reference | Intake, source, memory, evidence, and work explain or cite one another. | Typed links; never eligibility by implication. |

No adapter may infer one relationship from another. A cycle assignment does
not create a dependency. A milestone parent does not assign a cycle. A cited
note does not satisfy a gate.

## 4. Project namespace

### 4.1 Canonical project record

The project remains the revision and authorization namespace. Under
`boreal.work-model/3` it stores:

```text
project_id                  stable typed identity
name                        non-empty display name
description                 optional project description
lifecycle                   active | archived
default_timezone            canonical IANA zone, for example America/Regina
work_model_version          boreal.work-model/3
status_contract_version     boreal.work-status/3
cycle_model_version         boreal.cycle/1 or absent
recurrence_model_version    boreal.recurrence/1 or absent
intake_model_version        boreal.intake/1 or absent
project_revision            monotonic mutation revision
created_at / updated_at     authoritative UTC instants
```

Machine-local filesystem data MUST be separate from portable project
identity:

```text
workspace_binding
  workspace_id
  project_id
  canonical_root
  state: active | unavailable | retired
  observed_at
```

Moving the SQLite file MUST NOT change the workspace root used by a witnessed
executor. A project MAY have multiple historical bindings but only one active
binding per local service identity.

### 4.2 Project lifecycle and derived health

Persisted project lifecycle is only `active` or `archived`. Archive prevents
new normal work, cycle, intake, and execution mutations but retains reads,
export, repair, and explicit audited reactivation.

Project health is derived and is not lifecycle. Its vocabulary remains owned
by the operator-health contract and is outside this model; this document does
not introduce new health labels. Health MUST NOT substitute for per-work
eligibility.

## 5. Work decomposition

### 5.1 Work kinds and execution mode

New writes support these work kinds:

- `milestone`: a strategic or delivery outcome and always a container.
- `task`: a unit that may be directly executable or may group smaller tasks.

Work gains an explicit execution mode:

- `container`: has rollup/closeout semantics and cannot own a current execution
  attempt.
- `direct`: is a leaf that may be claimed and must not have child work.

Required combinations:

| Kind | Allowed mode | Notes |
| --- | --- | --- |
| milestone | container only | Can contain milestones or tasks. |
| task | direct or container | Defaults to direct; container tasks support explicit task groups/subtasks. |
| sprint | no new writes | Compatibility-only legacy row; decoded and rendered indefinitely. |

This keeps familiar milestone/task language while avoiding an ever-growing
`WorkKind` enum for notes, buckets, cycles, or every future planning concept.
`WorkKind` is immutable after creation. `execution_mode` may change only before
proof history exists and only if the target-mode structural rules already
hold. Proof history means any attempt, checkpoint, receipt, review, summary,
close intent/evaluation, or container disposition. Once any such row exists,
`execution_mode` is permanently immutable for that work ID.

### 5.2 Canonical work fields

```text
work_id, project_id
kind: milestone | task
execution_mode: container | direct
parent_work_id: optional work ID
lifecycle: draft | open | closed | cancelled
dispatch_policy: automatic | operator_only | paused
priority: 0..255
acceptance_profile_id/version
title, description
primary_source_version_id: optional convenience reference
created_at, updated_at
```

Scheduling fields are a separate one-to-one input, not lifecycle:

```text
work_schedule
  work_id
  not_before_at: optional UTC instant
  due_at: optional UTC instant
  target_start_at: optional UTC instant
  target_end_at: optional UTC instant
  schedule_revision
  updated_by / updated_at
```

`retry_not_before` remains execution-retry policy and MUST NOT be overloaded
as project planning time. `target_start_at` and `target_end_at` are planning
estimates only: they do not gate claims, create cycle membership, or derive
overdue. If both exist, `target_end_at` MUST be greater than
`target_start_at`.

### 5.3 Parent rules

- Parent and child MUST be in the same project.
- Parent links MUST be acyclic.
- A `container` may parent milestones or tasks.
- A `direct` work item MUST NOT have children.
- Root milestones and root tasks are valid. A root direct task is ordinary
  backlog work, not malformed work.
- Changing a container to direct is rejected while children, container
  dispositions, or proof history exist.
- Changing a direct task to container is rejected while a cycle assignment,
  dependency edge, child, or proof history exists. A completed attempt is as
  binding as a current attempt.
- Moving a work item revalidates hierarchy, permissions, status, affected
  rollups, guidance, and any current execution reconciliation requirement.
- A cycle, intake bucket, source, or memory entry can never be `parent_work_id`.

In `boreal.work-model/3`, dependency endpoints MUST both be direct tasks.
Milestones, container tasks, cycles, and compatibility sprint rows cannot be
new prerequisites or dependents. Container readiness is a rollup over
descendants, never a node in the dependency DAG. This first-release restriction
prevents cross-graph deadlocks in which a container waits on a descendant while
that descendant waits on the container (directly or through another rollup).
Broader dependency roles require a separately versioned semantic model, not a
relaxed foreign key.

### 5.4 Container closeout

Containers are not claimable. Their derived state comes from descendant
dispositions plus their own closeout requirements. Container disposition facts
are append-only:

```text
container_descendant_disposition
  disposition_id
  container_work_id
  descendant_work_id
  kind: accepted_closed | accepted_cancelled | deferred | replaced
  descendant_revision / descendant_outcome_digest
  replacement_work_id: required only for replaced
  reason / authorized_by / policy_digest / created_at
  supersedes_disposition_id: optional
```

A correction inserts a new row referencing the row it supersedes; it never
updates or deletes the original. At most one unsuperseded disposition is
current for `(container_work_id, descendant_work_id)`. `accepted_closed` binds
the exact terminal descendant revision and current summary/proof identity.
Reopening or materially revising that descendant makes the disposition
ineligible but leaves it visible. `deferred`, `replaced`, and
`accepted_cancelled` require an authorized actor and a non-empty reason.

Container acceptance profiles MAY require summary, review, audit, or operator
approval. A container MUST NOT require a witnessed command/checkpoint gate
directly; if executable verification is required, model an explicit direct
closeout task beneath the container. This preserves the invariant that
witnessed execution belongs to a fenced attempt.

A container closes only when:

1. every required descendant is closed or has an explicit accepted
   cancel/deferral/replacement disposition;
2. no unresolved hard hold remains;
3. its allowed container closeout gates are satisfied for the current
   descendant/schedule/policy revision; and
4. one current final summary is committed atomically with close.

### 5.5 Proof contexts and invalidation

Proof eligibility has exactly one of two contexts. It is invalid for a proof
row, gate evaluation, or close evaluation to carry both contexts or neither:

```text
AttemptProofContext XOR ContainerCloseoutContext

AttemptProofContext
  work_id, attempt_id, fence
  input/source/configuration identities
  acceptance_profile_id/version
  gate policy, command, tool, environment and observable-scope digests

ContainerCloseoutContext
  container_work_id, container_closeout_id
  descendant_set_digest
  current_disposition_set_digest
  descendant_outcome_and_summary_digest
  acceptance_profile_id/version
  source/configuration/policy digests
```

The schema-level shape check is equivalent to:

```text
(attempt_id IS NOT NULL AND fence IS NOT NULL
 AND container_closeout_id IS NULL)
XOR
(attempt_id IS NULL AND fence IS NULL
 AND container_closeout_id IS NOT NULL)
```

Witnessed commands, checkpoints, and executor receipts are valid only in an
attempt context. Container context may contain summaries, reviews, audit facts,
operator approvals, and descendant dispositions, but never pretends a
container owned an execution attempt.

Attempt proof becomes ineligible when the current attempt/fence changes or any
bound input, source, configuration, profile, gate policy, command, tool,
environment, or observable scope identity changes. Reopening direct work also
requires a new proof context even before another attempt is claimed. Container
proof becomes ineligible when children/required descendants change; a descendant reopens or
its bound outcome/summary changes; a disposition is superseded; or the
container profile, policy, source, configuration, or closeout evaluation
changes. Cycle assignment and display-order changes do not invalidate task
proof unless the acceptance profile explicitly binds them into the input
identity. Historical proof is never deleted. Gate satisfaction is always
derived from proof eligible for the one current context; a cached projection
cannot survive context invalidation.

## 6. Delivery cycles and backlog

### 6.1 Why sprint is a cycle, not work

A sprint answers **when and with what delivery scope**. A milestone/task
answers **what outcome or action exists**. Keeping sprint as a work parent
breaks common scenarios:

- a task exists in the backlog before a sprint is selected;
- one milestone spans multiple sprints;
- one sprint includes tasks from several milestones;
- unfinished work is carried to a later sprint without changing why it exists;
- a recurring sprint creates new dated instances without cloning strategic
  hierarchy;
- cycle completion records planning history without claiming every task closed.

Therefore sprint becomes the user-facing name for a `cycle` entity. CLI/TUI
MAY continue to display “Sprint” and retain `sprint` aliases, but canonical API
and storage use cycle identities.

### 6.2 Cycle instance

```text
cycle_id, project_id
series_id / template_version_id / slot_key / slot_ordinal: optional as a group
name, goal
lifecycle: planned | active | completed | cancelled
scheduled_start_at / scheduled_end_at: UTC instants
nominal_local_start / nominal_local_end: local wall-clock values
timezone: IANA zone captured for the occurrence
start/end UTC offsets and tzdb_identity: materialization facts
actual_started_at / actual_ended_at: optional UTC instants
created_at, updated_at
```

Cycle lifecycle transitions are explicit and audited:

```text
planned -> active -> completed
planned -> cancelled
active  -> cancelled
```

Completed and cancelled cycles are terminal in `boreal.cycle/1`; reopening is
deferred until a later capability defines its effects. Passing scheduled
start/end does not silently mutate lifecycle. The clock only derives
`start_due`/`end_due`; an explicit idempotent operation commits lifecycle.

The project MAY have multiple active cycles, for example delivery and
maintenance, but one optional `primary_cycle_id` controls the default dashboard
focus. Primary focus is explicit and never inferred from first-list order.

### 6.3 Cycle goals and task assignment

Milestones relate to cycles through a many-to-many `cycle_goal` link. They do
not become cycle parents.

Direct tasks relate to cycles through temporal assignment records:

```text
cycle_assignment
  assignment_id
  cycle_id
  work_id
  state: planned | committed | removed | completed | carried_over
  activation_policy: at_cycle_start | immediate | explicit_not_before
  activation_at: optional UTC instant
  ordinal: optional display ordering
  assigned_by / assigned_at
  ended_by / ended_at / reason
  predecessor_assignment_id: optional
  successor_assignment_id: optional
```

Assignment states and transitions are exact:

```text
create in planned cycle                       -> planned
create in active cycle                        -> committed
planned --cycle start/explicit commit-------> committed
planned|committed --task closes-------------> completed
planned|committed --remove with reason------> removed
planned|committed --atomic carry-over-------> carried_over
```

`completed`, `removed`, and `carried_over` are terminal. Carry-over is one
transaction that terminalizes the source assignment and creates its successor
for the same work. The source stores `successor_assignment_id`; the successor
stores `predecessor_assignment_id`; each link is unique, project-local, and
acyclic. Source and target cycles must differ. The target cycle must be
`planned` or `active`; its assignment is respectively `planned` or
`committed`. A retry with the same operation and payload returns the same pair.
A changed target/payload under the operation ID conflicts.

A **live assignment slot** is an assignment in `planned` or `committed` state.
The store enforces at most one live slot per direct task with a partial unique
index. Carry-over orders its source terminalization and successor insertion in
one transaction, so every committed revision has exactly zero or one live
slot. There is no interval in which a second client can claim the freed slot
between those writes.

Additional rules:

- Only open/draft direct tasks may receive a new live assignment.
- Starting a cycle transitions all of its `planned` assignments to
  `committed` in the same cycle-start transaction after revalidation. Any
  invalid assignment rejects the whole start; partial activation is forbidden.
- `activation_policy` controls the effective availability of a committed
  assignment, not whether its assignment state is committed. A future
  activation therefore derives `scheduled` without creating another state.
- A direct task has at most one live assignment (`planned` or `committed`) in
  the first release. Historical assignments are retained. Supporting multiple
  simultaneous delivery commitments later requires an explicit assignment
  role/capacity contract; it is not inferred from duplicate rows.
- Assignment does not change `parent_work_id`.
- Removing or carrying over an assignment does not cancel, close, or reopen
  the task.
- Completing a task marks its live assignment `completed` in the same
  authoritative revision. Cancelling a task requires the assignment to become
  `removed` in that transaction, with the cancellation operation as reason.
- Completing or cancelling a cycle is rejected while any live assignment
  remains. Each unfinished assignment must first be carried over or removed;
  completed tasks must have `completed` assignments. There is no live slot
  attached to a terminal cycle and no “keep committed” exception.
- Cycle scope changes are auditable and visible in cycle reports.

### 6.4 Backlog definition

Backlog has two explicitly named read models:

```text
planning_backlog = draft/open direct task
                   AND no live assignment
                   AND matches requested project/milestone/filter scope

executable_backlog = planning_backlog
                     AND lifecycle = open
                     AND canonical status/actor policy says claimable now
```

The cycle execution queue is a separate set: committed tasks in active cycles
that are claimable now. `work backlog` means planning backlog; `work ready` and
`next` combine executable backlog with the cycle execution queue under the
same deterministic ranking and transactional claim recheck. A claimed task is
not in executable backlog even if it remains unscheduled.

Backlog is not a lifecycle, status, parent, bucket, or dispatch policy. “In
planning backlog” is a planning badge; “executable backlog” is a transient
eligibility result at a revision and `as_of`.

## 7. Recurring cycle series and templates

### 7.1 Series and immutable template versions

A recurrence series is the stable user-visible identity. Template versions are
immutable definitions used to calculate slots; a cycle is a materialized slot:

```text
cycle_series
  series_id, project_id
  lifecycle: active | paused | retired
  name / series_revision
  next_slot_ordinal
  created_at / updated_at

cycle_template_version
  template_version_id, series_id, version
  effective_from_slot_ordinal
  name_pattern / goal_template
  timezone: canonical IANA zone
  anchor_local_start
  frequency: weekly
  interval_weeks: positive integer
  weekdays: non-empty validated set
  end_mode: never | count | until_local_date
  end_count / end_local_date as required
  end_semantics: elapsed_duration | local_wall_time
  duration_seconds: required for elapsed_duration
  local_end_time / end_day_offset: required for local_wall_time
  gap_policy: next_valid
  fold_policy: earlier_offset | later_offset
  materialize_ahead_count
  definition_digest / created_at / superseded_at
```

`boreal.recurrence/1` supports weekly recurrence only. Daily, monthly, holiday,
and business-calendar rules are deferred to later recurrence capability
versions. Unsupported frequency fields are rejected rather than retained as
inactive promises. No expression, script, SQL predicate, or executable
condition language is accepted.

Series transitions are `active -> paused`, `paused -> active`, and
`active|paused -> retired`; `retired` is terminal. Only an active series may
allocate/materialize new slots. Pausing or retiring does not alter materialized
cycles. A template version cannot be updated or deleted after insertion.
Version 1 starts at slot ordinal zero. Each later version has a unique,
strictly increasing `effective_from_slot_ordinal`; the applicable version is
the greatest boundary not exceeding the requested ordinal. Its
`anchor_local_start` is the nominal start of that boundary slot, not a mutable
series-wide anchor.

### 7.2 Slot identity, materialization, and reconciliation

Each logical occurrence has a monotonically allocated `slot_ordinal` within
its series and a version-independent key:

```text
slot_key = sha256("boreal.cycle-slot/1\n" + series_id + "\n" + slot_ordinal)
```

The cycle stores `series_id`, `slot_ordinal`, `slot_key`, and the immutable
`template_version_id` that resolved its nominal and UTC times. The database
enforces unique `(series_id, slot_ordinal)` and `(series_id, slot_key)`. A
template edit cannot generate a second identity for an existing slot.

Within a template version, weekly candidates are enumerated in increasing
local date/time order. Week blocks begin on ISO Monday in the template
timezone; block zero contains `anchor_local_start`, and included blocks are
`0, interval_weeks, 2*interval_weeks, ...`. Each included block emits the
configured weekdays at the anchor's local time, excluding candidates before
the boundary anchor. The anchor weekday MUST be in `weekdays`, so the boundary
slot is deterministic. `end_count` is a positive exclusive upper bound on
series ordinal (`slot_ordinal < end_count`) and cannot be revised below an
allocated ordinal; `until_local_date` is inclusive as defined below.

- Same operation, slot key, and canonical payload replays the existing cycle.
- Same operation or slot key with different semantic payload conflicts unless
  it is an approved reconciliation operation described below.
- Slot allocation and cycle insertion commit atomically against the expected
  series revision and template digest. Calculation may happen outside the
  transaction.
- A rolling horizon does not imply the recurrence ended, and duplicate timer
  delivery or restart cannot duplicate a slot.

A template change creates a new immutable version with an explicit
`effective_from_slot_ordinal`. Reconciliation compares already materialized
future cycles against that boundary and emits a digest-bound plan containing
one action per affected slot: `keep_existing` or `reschedule_planned`. A cycle
may be rescheduled in place only while it is planned, has no committed
assignment, no attempt/proof history, and no prior start. The event preserves
the old resolved values and template version in audit. Active, completed,
cancelled, or otherwise history-bearing cycles are always `keep_existing`;
the new version begins at the next eligible ordinal. Applying reconciliation
requires the expected series revision, old/new definition digests, and exact
plan digest. Reapplication replays; drift conflicts.

### 7.3 Timezone, end semantics, DST, and exact boundaries

- Recurrence is calculated as local wall time in the stored IANA timezone,
  never by repeatedly adding UTC seconds.
- `elapsed_duration` resolves the start once and sets
  `scheduled_end_at = scheduled_start_at + duration_seconds`; wall-clock end
  may shift across DST.
- `local_wall_time` resolves start and end independently from
  `local_end_time` and non-negative `end_day_offset`; both use the stored
  gap/fold policies. The resolved end MUST be after the resolved start.
- For a spring-forward gap, `next_valid` chooses the earliest valid local
  instant after the gap. For a fall-back fold, `earlier_offset` selects the
  earlier UTC instant and `later_offset` the later UTC instant. Nominal local
  value, selected offset, resolved instant, policy, and tzdb identity are all
  persisted.
- Cycle intervals are half-open: `[scheduled_start_at, scheduled_end_at)`.
  `start_due` is true at `as_of >= scheduled_start_at`; `end_due` is true at
  `as_of >= scheduled_end_at`. An occurrence with `until_local_date` includes
  slots whose nominal local start date is equal to that date. `count` counts
  allocated slots beginning at ordinal zero.
- A later tzdb update never rewrites an existing cycle. It may produce a
  reconciliation finding for unmaterialized slots only.

## 8. Conditions, holds, and time

There is deliberately no generic `condition_json`, expression evaluator, or
arbitrary executable DSL. Eligibility is the conjunction of typed canonical
inputs owned by their domain modules:

| Input | Canonical representation | Effect |
| --- | --- | --- |
| Publication | Work lifecycle | Draft is not dispatchable. |
| Prerequisite | Direct-task dependency edge | Unsatisfied prerequisite yields `queued`. |
| Intervention | `work_hold` with reason, owner, lifecycle | Active hard hold yields `blocked`. |
| Dispatch | `automatic`, `operator_only`, `paused` | Controls who may claim or whether dispatch is paused. |
| Planning availability | `work_schedule.not_before_at` | Future availability yields `scheduled`. |
| Cycle availability | Assignment activation policy and resolved activation instant | Future cycle activation yields `scheduled`. |
| Retry | `retry_not_before` | Recoverable execution yields `retry_wait`. |
| Ownership | Current fenced attempt and clocks | Produces claimed/in-progress/expiry states. |
| Acceptance | Versioned gates and current proof | Produces verification/review/complete states. |
| Product deadline | `due_at` | Adds `overdue`; does not block or terminate by itself. |

New condition types require a versioned Rust domain type, persisted contract,
reason code, evaluator branch, authorization rule, protocol fixture, migration
disposition, and negative tests. A JSON blob alone is not a condition.

Hard holds SHOULD include stable kinds such as `operator_decision_required`,
`reconciliation_required`, `integrity_failure`, `permission_required`, and
`unsafe_environment`, plus structured references and human detail. Resolving a
hold is reason-coded and audited; deletion is not resolution.

All operational instants are canonical UTC timestamps from the authoritative
service/store clock. Local date/time is persisted only where recurrence intent
requires it. Time meanings remain distinct:

- `not_before_at`: work availability gate;
- cycle scheduled start/end: delivery plan;
- `due_at`: target deadline and overdue badge;
- `retry_not_before`: execution backoff;
- lease deadline: renewable ownership;
- max attempt deadline: immutable execution budget;
- `revisit_at`: intake attention time.

Boundary comparisons are exact and shared by domain, store, service, and
clients:

| Field | Becomes effective when | Equality behavior |
| --- | --- | --- |
| `not_before_at` | `as_of >= not_before_at` | Claim may become eligible at equality. |
| assignment `activation_at` | `as_of >= activation_at` | Scheduling block clears at equality. |
| `retry_not_before` | `as_of >= retry_not_before` | Retry wait clears at equality. |
| `due_at` | `as_of >= due_at` and work is nonterminal | `overdue` begins at equality. |
| lease/hard deadline | `as_of >= deadline` | Existing expiry policy applies at equality. |
| `revisit_at` | `as_of >= revisit_at` | `revisit_due` begins at equality. |
| cycle start/end | half-open interval rules in 7.3 | End is excluded. |

Null means “no boundary.” Timestamps are normalized to one canonical UTC
precision before comparison. Every status snapshot reports the earliest future
boundary that can change its result as `next_status_change_at`; no write is
required for a time-only derived transition.

## 9. Intake, notes, discoveries, questions, and revisit items

### 9.1 Intake is operational triage, not work or published memory

An intake item captures something worth retaining before its final meaning is
known. Supported initial kinds are:

- `note`: observation or notation;
- `discovery`: a finding that may create work or knowledge;
- `question`: an unresolved question that may need a decision or research;
- `revisit`: an item intentionally deferred until a date or event.

Intake buckets are lightweight project organization:

```text
intake_bucket
  bucket_id, project_id, name
  lifecycle: active | archived
  created_at, updated_at
```

An item belongs to zero or one bucket. Tags and saved-filter persistence are
deferred beyond `boreal.intake/1`; clients may filter existing typed fields
without storing another taxonomy. A bucket never affects task eligibility and
is not a work parent.

### 9.2 Intake record and lifecycle

```text
intake_item
  intake_id, project_id
  bucket_id: optional
  kind: note | discovery | question | revisit
  lifecycle: captured | triaged | deferred | resolved | archived
  title, body or immutable body_ref
  source_version_id: optional citation/origin
  captured_by / captured_at
  triaged_by / triaged_at
  revisit_at: optional UTC instant
  resolution_summary: optional
  intake_revision / content_digest
  created_at / updated_at
```

Legal transitions:

```text
captured -> triaged | deferred | archived
triaged  -> deferred | resolved | archived
deferred -> triaged | resolved | archived
resolved -> triaged (explicit reopen) | archived
archived -> triaged (explicit restore)
```

`revisit_at` does not mutate lifecycle. A deferred item whose revisit time has
arrived derives `revisit_due` and a next triage action. A captured item derives
`inbox`; a triaged unresolved item derives `attention`; resolved and archived
are terminal-looking display states but retain provenance.

### 9.3 Promotion provenance

Promotion creates a target through that target's authoritative application
operation. It uses a typed table with a real foreign key, never a polymorphic
`target_type/target_id` pair:

```text
intake_work_promotion
  promotion_id, intake_id, work_id
  intake_revision, intake_content_digest
  relation: created | supports
  operation_id, request_digest, actor_id, created_at

intake_source_promotion
  promotion_id, intake_id, source_version_id
  intake_revision, intake_content_digest
  captured_bytes_digest
  relation: captured_from | supports
  operation_id, request_digest, actor_id, created_at

intake_memory_draft_promotion
  promotion_id, intake_id, entry_id, draft_content_digest
  source_version_id, citation_locator
  intake_revision, intake_content_digest
  relation: created | supports
  operation_id, request_digest, actor_id, created_at
```

- Promotion does not rewrite or delete the intake item.
- One intake item may support multiple targets.
- Every promotion binds the exact intake revision and content digest read by
  the target operation. A stale revision/digest rejects before target creation.
  Same operation plus the same canonical payload replays; changed target,
  revision, digest, relation, citation, or content conflicts.
- Promoting to work creates a normal work item and retains the intake link.
  Target lifecycle defaults to `draft`; an explicit `open` request runs the
  ordinary publish validation. Promotion never makes work ready by assertion.
- Promoting to memory creates a cited memory draft, never accepted/published
  memory directly. The memory crate requires citations, so a memory promotion
  MUST reference a validated immutable source version and locator. If intake
  has no source, the operation first captures an immutable source version,
  then creates the memory draft citing it, with both typed promotion rows
  committed or reconciled under one durable outer operation.
- Promoting bytes/text to source captures a normal immutable source version;
  digest, availability, and parser/index outcome remain source-engine facts.
- Intake text remains untrusted data and cannot mint commands, witnessed
  attestation, gate satisfaction, or actor authority.

Promotion rows are append-only. Retraction or correction is a new audited
provenance fact and target-domain operation; it does not delete the old link.
Decision promotion is deferred because the current v2 domain has no canonical
decision entity or lifecycle. It MUST NOT be represented as an unchecked ID
until a separately versioned decision capability exists.

## 10. Persisted lifecycle versus derived status

Each entity has its own lifecycle and status vocabulary. Clients MUST NOT put
all rows into one universal status enum.

### 10.1 Direct work

Persisted lifecycle remains `draft | open | closed | cancelled`.

Derived primary status becomes:

```text
draft | queued | scheduled | ready | claimed | in_progress |
needs_verification | awaiting_review | complete | blocked | paused |
retry_wait | expired_review | closed | cancelled
```

`overdue`, `operator_only`, `backlog`, and cycle membership are badges/reasons,
not primary status.

Precedence is:

1. terminal `closed` or `cancelled`;
2. expiry review or hard intervention `expired_review` / `blocked`;
3. `draft`;
4. current attempt and proof state;
5. `paused` or `retry_wait`;
6. `scheduled` for a future effective activation instant;
7. `queued` for normal prerequisites;
8. `ready` when actor/policy eligibility allows claim.

All applicable reason codes are returned even when one primary status wins.
A scheduled task may also name open prerequisites; a blocked task may also be
overdue.

### 10.2 Container work

Persisted lifecycle is the same, but derived status is:

```text
draft | open | attention | closing | closed | cancelled
```

- `open`: descendants remain and no attention condition dominates.
- `attention`: blocked, expired-review, failed review, unresolved disposition,
  or integrity conditions need intervention.
- `closing`: descendant dispositions are complete but container summary or
  allowed closeout gates remain.

Container read models include exact descendant counts by direct-work status.
They never report claimable.

### 10.3 Cycle series, template version, and cycle instance

Series lifecycle is `active | paused | retired`. Template versions are
immutable and have no independent lifecycle. Derived series labels may include
`materialization_due` or `exhausted`; they are scheduler guidance, not writes.

Cycle lifecycle is `planned | active | completed | cancelled`. Derived badges
include `upcoming`, `start_due`, `end_due`, `scope_changed`, and
`incomplete_scope`. Date passage alone does not claim lifecycle changed.

### 10.4 Intake

Persisted lifecycle is `captured | triaged | deferred | resolved | archived`.
Derived display is `inbox | attention | waiting | revisit_due | resolved |
archived` based on lifecycle and `revisit_at`.

### 10.5 Source, memory, and evidence

- The current source crate represents a captured immutable `SourceVersion`
  with `Availability = available | missing | corrupt`. Parse/index results use
  `ParseState = indexed | failed`. It does not currently persist separate
  `registered`, `captured`, or `extracted` lifecycle states, so this contract
  does not invent them. A future ingestion-job lifecycle requires its own
  capability and migration.
- The current memory crate uses draft state
  `draft | in_review | accepted | rejected | published` and publication state
  `publishing | published | failed | conflict`. Publication requires an
  accepted, cited draft and records the Git-backed publication result. Intake
  integration calls those existing boundaries; it does not relabel them.
- Evidence receipts are immutable facts with an immutable result. Every proof
  fact and evaluation obeys the attempt/container XOR in 5.5. Historical
  passed evidence stays visible but cannot silently satisfy a new context.

## 11. Relationship and cardinality contract

| From | Relationship | To | Cardinality / constraint |
| --- | --- | --- | --- |
| project | contains | work | 1:N; same namespace |
| work container | decomposes into | work | 1:N children; each child 0..1 parent; acyclic |
| direct task | depends on | direct task | M:N DAG; same project; typed satisfaction policy |
| project | owns | cycle series | 1:N |
| cycle series | versions | cycle template version | 1:N immutable versions |
| cycle series slot | materializes | cycle | 1:0..1; stable key and ordinal |
| cycle | advances | milestone | M:N `cycle_goal` links |
| cycle | schedules | direct task | M:N historical assignment; at most one live planned/committed assignment per task initially |
| project | owns | intake bucket | 1:N |
| intake bucket | groups | intake item | 1:N; item 0..1 bucket |
| intake item | promotes/supports | work/source/memory draft | 1:N target-specific typed tables |
| direct task | has | attempt | 1:N history; at most one current |
| attempt or container closeout | produces | eligible proof | XOR context; 1:N immutable or superseding history as defined by proof contract |
| source version | cited by | work/intake/memory/evidence | M:N typed references; immutable target version |
| memory entry | relates to | work/intake | M:N, informational unless an explicit gate references it |

Cross-project links are rejected in the first release. Future cross-project
sharing requires explicit import/grant semantics and preserved provenance.

### 11.1 Minimum store constraints and indexes

The schema implementation must enforce, rather than merely document:

- unique `(project_id, work_id)`, `(project_id, cycle_id)`, and
  `(project_id, intake_id)` identities;
- project-local composite foreign keys for every parent, dependency,
  assignment, bucket, and promotion reference;
- unique `(series_id, version)`, `(series_id, slot_ordinal)`, and
  `(series_id, slot_key)`;
- one live `planned`/`committed` assignment per direct task through a partial
  unique index;
- one optional primary cycle focus per project;
- one current attempt per direct task and one current execution per session;
- direct-task-only dependency endpoints, enforced in the committing
  transaction as well as application validation;
- proof-context XOR shape checks and authoritative context validation at proof
  acceptance/finalization;
- append-only receipt/audit/promotion/disposition facts and explicit
  supersession rather than destructive update;
- permanent decode/read support for compatibility `WorkKind::Sprint` rows,
  while rejecting new/edited sprint-kind writes;
- indexes for parent children, prerequisite/dependent traversal, cycle scope,
  backlog lookup, active holds, `not_before_at`, `retry_not_before`, cycle
  start/end, template materialization horizon, and `revisit_at`;
- operation identity plus canonical request digest checks before every replay.

Every successful mutation commits its canonical rows, audit event, operation
result, and project revision in one short transaction. Recurrence calculation,
source capture, process execution, Git work, rendering, and large serialization
remain outside that transaction.

## 12. Command, API, and TUI implications

### 12.1 Canonical command families

```text
project init|show|configure|archive|restore

work create --kind milestone|task --mode container|direct [--parent ...]
work edit|show|list|publish|cancel|reopen
work schedule set|clear
work backlog
work ready|next
work hold add|resolve
dep add|remove|tree|cycles

cycle series create|show|list|pause|resume|retire
cycle template create-version|show|list|materialize|reconcile
cycle create|show|list|start|complete|cancel
cycle goal add|remove
cycle assign|remove|carry-over
cycle focus set|clear

intake bucket create|list|archive|restore
intake add|show|list|triage|defer|resolve|archive|restore
intake promote-to-work|promote-to-source|promote-to-memory-draft

source add|show|list|verify
memory draft create|review|publish|show|search
evidence run|add|show|list
```

`sprint ...` MAY remain a documented alias for `cycle ...`. It must use the
same registry entry, request schema, application operation, and response—not a
second implementation.

Every mutation carries a fresh logical operation ID, canonical request digest,
actor/session context, expected revision where applicable, and exact typed
result. Unknown outcomes require operation readback. Lists are bounded with
stable cursors; exact show operations never scan a presentation page.

### 12.2 Service API

The versioned Rust service is the only operational API for CLI/TUI shared use.
It needs typed routes for project/work/cycle/intake mutations and bounded
read models. A route is not advertised as supported until the Rust handler,
application use case, store transaction, protocol fixture, and actual client
integration test all exist.

Capability discovery reports work/status, cycle, recurrence, and intake
versions separately. Clients gate controls by the specific capability and
route. A server with `boreal.cycle/1` but no `boreal.recurrence/1` can manage
manual cycles without showing template controls; intake support is similarly
independent.

The current TUI and Rust service now have `create_project` and `create_work`
routes. They remain work-model/2 behavior until the schema-3 DTO, transaction,
capability advertisement, and cross-language fixtures land together. Clients
MUST NOT send `WorkKind::Sprint` or schema-3 fields merely because the route
name exists, and servers MUST reject a requested capability version they do
not implement.

### 12.3 TUI and dashboard

The TUI should expose separate views rather than flattening everything into
one work list:

- **Now:** current attempts, verification/review gaps, due attention, and safe
  next actions.
- **Roadmap:** milestone/task decomposition and rollups.
- **Cycles:** planned/active/completed sprint instances, recurring templates,
  scope changes, and carry-over.
- **Backlog:** unscheduled direct work, filterable by milestone, priority,
  schedule, hold, and status.
- **Inbox:** intake buckets, triage, questions, discoveries, and revisit-due.
- **Knowledge:** source versions, draft/published memory, citations, and lag.
- **Proof:** attempts, gates, receipts, reviews, summaries, and immutable
  history.
- **Activity/health:** revisioned audit and service/store health.

`bwrk dashboard` is the canonical one-command user experience. The current
launcher already owns project discovery, private service startup, TUI launch,
signal forwarding, exit status, and cleanup. The remaining requirement is to
prove packaged/release lookup, supported-platform behavior, and all mounted
actions through end-to-end fixtures. The TUI still uses the versioned Rust API
internally; normal users do not manually run a server or socket.

UI badges MUST distinguish decomposition parent, cycle assignment, backlog,
work status, due state, and attempt ownership. Dragging/reordering within a
cycle edits assignment/order only; it must not silently reparent work or
change lifecycle.

## 13. Current-v2 schema migration and later legacy import

Two operations are deliberately separate:

1. Phase 1 performs an additive, in-place SQLite schema `2 -> 3` migration for
   an existing v2 database.
2. Phase 6 imports a v1 export through a separately versioned staging format.

Neither operation may masquerade as the other. Both are previewable,
transactional at each canonical commit, idempotent, and reversible through a
verified pre-operation backup. Failed evidence, attempts, audit provenance,
and ambiguous records are preserved.

### 13.1 Additive v2 schema 2 -> 3 migration (Phase 1)

Before any mutation, scan all attempts. If any attempt is live in `claimed`,
`accepted`, `running`, `verifying`, or `expiry_pending`, migration stops with
a typed `live_attempt_blocks_migration` finding that identifies its work
(including compatibility sprint subjects). The operator must
finish/release/reconcile it under schema 2 and rerun. The migrator never moves,
cancels, fences, or relabels a live attempt.

The atomic migration then:

1. adds project metadata, execution mode/schedule, proof-context,
   disposition, cycle, series/template-version, goal, assignment, intake,
   typed promotion, and required index/trigger tables;
2. initializes existing milestones as `container` and existing tasks as
   `direct` only when structural/proof checks permit; ambiguous task groups
   become blocking findings rather than guessed modes;
3. keeps every `WorkKind::Sprint` row, enum decoder, exact read, historical
   relation, and renderer indefinitely as compatibility-only, while triggers
   and application rules reject new sprint rows and semantic edits;
4. creates one deterministic cycle for each compatibility sprint row and
   records `legacy_work_id` provenance without changing the legacy subject;
5. links the cycle to the former milestone through `cycle_goal` and, for each
   child direct task, moves decomposition to the former milestone and creates
   the corresponding cycle assignment in the same migration unit;
6. leaves sprint-attached attempts/proof attached to the compatibility row;
7. converts only direct-task-to-direct-task dependency edges. Any edge with a
   container/sprint endpoint is retained as historical compatibility data and
   emitted as a blocking replacement/disposition finding; and
8. validates every row/index/trigger, recomputes projections, then sets
   `user_version = 3` last.

Compatibility sprint rows are not scheduled for deletion. Backup/restore,
export, operation readback, and historical UI must continue to decode them.

### 13.2 Compatibility lifecycle mapping

| Old sprint work lifecycle | Cycle mapping | Required caution |
| --- | --- | --- |
| draft | planned | No task is activated merely by conversion. |
| open | planned | Schema 2 has no authoritative cycle-start fact; activity is not guessed. |
| closed | completed | This preserves scheduling history only and transfers no gate/proof satisfaction. |
| cancelled | cancelled | Child tasks remain open unless separately cancelled. |

Milestone/task lifecycle remains unchanged in a current-v2 schema upgrade.
Legacy-v1 values such as `complete`, `verified`, or `archived` are handled only
by the later conservative import policy in [STATUS_MODEL.md](../STATUS_MODEL.md)
and are never assumed equivalent to trusted closeout.

Assignment backfill is also deterministic. A task under a draft/open sprint
gets a `planned` assignment. Under a closed sprint, a closed task gets
`completed`; every other task gets `removed` with
`legacy_cycle_ended_unfinished`. Under a cancelled sprint every task gets
`removed` with `legacy_cycle_cancelled`. Thus terminal cycles never gain live
slots, and no task lifecycle or proof eligibility is inferred from the sprint.

### 13.3 Difficult references

- Direct-task-to-direct-task dependencies migrate unchanged after project,
  kind, mode, and DAG validation.
- Dependencies whose endpoint is a milestone, container task, or sprint row
  are never activated in the new dependency graph. They become explicit
  findings requiring an operator-selected direct-task replacement or
  historical-only retention.
- Attempts, receipts, reviews, summaries, or close intents attached directly
  to a sprint row must remain inspectable. During compatibility they continue
  to reference the read-only legacy subject. They are not reassigned to a
  cycle or child task because that would falsify subject identity.
- An existing direct-task receipt receives an attempt context only when its
  exact attempt/fence and every required identity can be reconstructed. All
  other existing receipt/container/sprint proof remains historical and
  non-satisfying until a new valid context is evaluated. Cached gate state is
  discarded and rebuilt; migration never synthesizes container closeout proof.
- Missing timezone defaults to `UTC` only in a preview. Apply requires explicit
  confirmation or a recorded migration policy; recurrence is never inferred
  from similarly named sprint rows.
- No old sprint sequence is assumed recurring. A recurring template is created
  only from an explicit legacy recurrence record or operator-approved plan.

### 13.4 Later v1 import (Phase 6)

Legacy v1 import uses an immutable export, a versioned staging document, and a
loss/disposition ledger. It may target an empty schema-3 database only after
the native schema migration and public workflow are stable. It never runs as
part of database open. The report includes before/after counts, every mapped
ID, parent/cycle/assignment mapping, unsupported dependency endpoint,
historical proof subject, timezone choice, source/memory reference, and
canonical document digest. Same import operation plus same document replays;
changed content conflicts. Rollback restores the verified pre-import backup
and does not mutate the v1 source.

## 14. Invariants and negative cases

### 14.1 Core invariants

- A project ID scopes every live operational reference.
- Persisted lifecycle is small; displayed status is derived at one revision
  and `as_of`.
- Direct work is the only claimable work. Containers, cycles, intake, source,
  and memory cannot acquire an execution attempt.
- Decomposition tree, dependency DAG, cycle assignment, and provenance links
  are never inferred from one another.
- Dependency edges connect direct tasks only; containers can never wait in or
  satisfy that graph.
- A direct task may exist without a parent and without a cycle.
- Moving work between cycles does not change decomposition or acceptance.
- Closing/cancelling a cycle does not close/cancel its tasks.
- Due dates do not block claims; `not_before` and typed activation policy do.
- Time passage is effective in reads but canonical lifecycle mutations remain
  explicit audited operations.
- Historical assignments, attempts, receipts, and failed outcomes are retained.
- Compatibility sprint rows and decoders are retained indefinitely; they are
  historical subjects, not new-write cycle substitutes.
- Gate satisfaction is derived from eligible current proof, never from a
  durable boolean detached from proof context.
- Attempt proof and container closeout proof are mutually exclusive contexts;
  proof can never float between them.
- Intake/source/memory text is data, never command authority.
- Recurrence materialization is deterministic and duplicate-safe across
  retries, restart, DST, and timer duplication.

### 14.2 Required rejected cases

The implementation MUST reject or return a typed finding for:

- cross-project parent, dependency, cycle assignment, source, promotion, or
  proof reference;
- a parent cycle, bucket, intake item, source, or memory entry;
- hierarchy or dependency cycles;
- any new dependency whose prerequisite or dependent is not a direct task;
- a direct work item with children;
- changing `execution_mode` after any proof history or while incompatible
  structure/assignment/dependencies exist;
- an attempt against a container, cycle, intake item, or closed/cancelled task;
- a second live planned/committed cycle assignment for one task;
- assignment of closed/cancelled work without an explicit historical import
  mode;
- cycle completion/cancellation with any live assignment;
- carry-over with a different task, terminal target cycle, duplicate successor,
  or second live slot;
- reuse of a series slot key/ordinal with different materialized fields outside
  an exact approved reconciliation;
- recurrence interval zero, invalid timezone, unsupported frequency, invalid
  weekday set, invalid end semantics, or missing end-mode fields;
- silently normalizing a DST gap/fold without persisting the selected policy
  and resolved instant;
- template edits that rewrite active/completed cycles;
- intake promotion with changed payload under the same operation ID;
- intake promotion against a stale revision/content digest or a polymorphic
  unchecked target ID;
- memory-draft promotion without a validated source-version citation;
- promotion directly to published memory or witnessed evidence;
- a note/discovery/question satisfying a work gate by label or prose;
- an arbitrary JSON/script/SQL condition presented as eligibility policy;
- stale cycle, work, intake, proof, or project revisions used as mutation
  authorization;
- a TUI action whose service route is absent;
- schema 2 -> 3 migration while any work has a live attempt;
- migration that drops sprint-attached attempts/evidence or treats ambiguous
  completion as trusted closeout.

## 15. Implementation phases and acceptance tests

### Phase 0 — contract and decision freeze

Deliver:

- freeze this contract's sprint-to-cycle decision and later mirror it into the
  project decision ledger during implementation;
- version work/status, cycle, recurrence, intake, protocol, and legacy-import
  contracts independently;
- add golden entity, relationship, status, recurrence, and migration fixtures;
- define exact DTOs, errors, reason codes, event types, and command registry.

Acceptance:

- fixtures reject every negative case above;
- the same entity/revision/clock produces identical Rust, protocol, CLI, and
  TUI-decoder results;
- no current adapter advertises a missing route.

### Phase 1 — additive schema 2 -> 3, project, and decomposition kernel

Deliver:

- transactional additive schema `2 -> 3`, migration preflight/rollback,
  permanent sprint compatibility reads, project metadata/workspace binding,
  work execution mode, flexible parent rules, work schedule, proof-context XOR,
  append-only container dispositions, and pure direct/container evaluators;
- exact indexed reads and revisioned rollups.

Acceptance:

- create root backlog task, milestone, nested milestone, direct task, and
  container task through public application routes;
- reject direct-with-child, parent cycle, cross-project parent, retype with
  children/proof history, container dependency endpoints, and all hierarchy or
  direct-task dependency cycles;
- migration with any live attempt performs zero writes; after explicit
  attempt resolution, rerun reaches schema 3 and retains the sprint subject;
- old attempt proof cannot satisfy a new attempt; attempt proof cannot satisfy
  a container; descendant/disposition drift invalidates container closeout;
- priority, holds, schedules, timezone, and project metadata survive restart;
- container never appears claimable.

### Phase 2 — cycle and backlog kernel

Deliver:

- cycle, cycle-goal, assignment, explicit focus, lifecycle operations, backlog
  query, carry-over/disposition transaction, and status integration.

Acceptance:

- one milestone spans three cycles without task reparenting;
- one cycle schedules tasks from two milestones;
- unscheduled task appears in backlog and remains fully status-evaluable;
- completing/cancelling a cycle leaves tasks unchanged;
- completing/cancelling a cycle with live scope is rejected;
- remove returns a task to planning backlog; carry-over links predecessor and
  successor, retains both histories, and has exactly one live slot;
- planning backlog, executable backlog, and active-cycle execution queue return
  distinct expected sets from the same snapshot;
- two concurrent assignments for one task produce one winner.

### Phase 3 — time and recurrence

Deliver:

- recurrence series, immutable weekly template versions, stable slot allocator,
  deterministic materializer, timezone/DST/end-semantics handling, schedule
  timers/notifications, and digest-bound reconciliation plans.

Acceptance:

- weekly and biweekly fixtures materialize exactly once across 100 duplicate
  calls and service restart;
- spring gap, fall fold, elapsed-duration versus local-wall-time, exact
  half-open boundary, tzdb-change, and template-version cases preserve nominal
  and resolved time;
- changing a template preserves slot identity and reconciles only eligible
  planned cycles under the expected series/plan digests;
- editing a template never rewrites started/completed cycles;
- time-only status changes refresh without a project write and report
  `next_status_change_at`.

### Phase 4 — intake and promotion

Deliver:

- bucket/item lifecycle, revisit scheduler, three typed promotion tables,
  source and cited-memory-draft adapters, bounded list/detail/search, and
  revision/digest provenance readback.

Acceptance:

- capture and triage all four item kinds;
- revisit becomes due at equality without mutating lifecycle;
- promote one discovery to both a task and cited memory draft while preserving
  one immutable origin;
- duplicate promotion replays; changed/stale revision or digest conflicts;
- intake without a source first captures a source version and the resulting
  memory draft cites that exact version; no direct memory publication occurs;
- raw intake cannot publish memory, satisfy evidence, or execute text.

### Phase 5 — service, CLI, TUI, and dashboard

Deliver:

- registry-driven routes and clients for every mounted action;
- release-package and end-to-end hardening of the existing one-command managed
  `bwrk dashboard` launcher;
- Now/Roadmap/Cycles/Backlog/Inbox/Knowledge/Proof/Activity views;
- operation readback, event/deadline refresh, bounded detail/history.

Acceptance:

- from an empty project, one terminal can initialize, open dashboard, create a
  milestone and backlog task, create/assign/start a cycle, capture/promote a
  discovery, claim/verify/close the task, and inspect proof after restart;
- actual Rust service and actual built TypeScript client are used; no direct
  SQL, mocked route, per-refresh CLI, manually managed server, or second
  terminal;
- Ctrl-C/SIGTERM restores the terminal and leaves no socket, timer, service,
  or child process;
- unsupported capabilities are disabled with typed reasons.

### Phase 6 — legacy v1 import, load, and release proof

Deliver:

- separately versioned v1 staging/import format, loss ledger,
  preview/apply/verify/rollback, release identity, backup/restore, and
  scale/fault matrix. This phase does not own schema 2 -> 3.

Acceptance:

- representative v1 exports imported into a schema-3 database preserve every
  work, parent meaning, cycle scope, dependency, attempt, receipt, summary,
  source, memory link, and unsupported finding;
- ambiguous sprint activation/closeout and sprint-attached proof require
  explicit disposition;
- 10,000 work items, many cycle histories, recurring templates, and intake
  histories keep routine pages bounded and exact;
- concurrent materialization, assignment, claim, promotion, and status reads
  preserve uniqueness and revision consistency;
- backup/restore retains SQLite, referenced blobs, published memory manifests,
  recurrence identities, and migration provenance.

### Required cross-layer fixture catalog

These fixture names and outcomes are normative; store/application/protocol and
real-client suites consume the same semantic cases:

| Fixture | Setup | Required result |
| --- | --- | --- |
| `proof_attempt_xor_container` | Submit attempt fields plus container closeout ID, then submit neither. | Both requests rejected; no proof/gate projection changes. |
| `proof_context_rollover` | Pass on attempt A, release, claim B; separately supersede one container disposition. | A proof is historical only for B; old container closeout becomes ineligible. |
| `container_disposition_append_only` | Close one descendant, defer another, then correct defer to replacement. | Original rows remain; one superseding row becomes current; disposition/context digests change; old close evaluation cannot finalize. |
| `schema3_live_attempt` | Schema-2 direct task and compatibility sprint each have a running attempt in separate cases. | Migration performs zero writes and reports the exact attempt; rerun after resolution succeeds and the legacy sprint row remains readable. |
| `direct_dependency_only` | Try task->milestone, container->task, sprint->task, and direct-task cycle. | All invalid endpoints/cycles reject; no rollup-dependent deadlock can be stored. |
| `assignment_carry_over_atomic` | Carry one committed task from active cycle A to planned cycle B; retry and race another assignment. | Linked terminal source + one planned successor; retry replays; racer loses; one live slot. |
| `cycle_terminal_requires_empty_live_scope` | Complete/cancel a cycle with planned/committed assignments. | Reject until every assignment is completed, removed, or atomically carried over. |
| `recurrence_slot_reconcile` | Materialize slots 0..3, start slot 1, then change timezone/cadence effective at slot 2. | Keys/ordinals remain stable; started/history-bearing slots stay unchanged; eligible planned slots change only under the exact reconciliation digest. |
| `dst_and_boundary_matrix` | Gap/fold starts, both end semantics, and equality at all fields in section 8. | Stored nominal/offset/resolution matches policy; all equality outcomes are identical across adapters. |
| `intake_typed_promotion` | Promote revision R/digest D to work/source/memory; retry, then edit intake and reuse operation. | Typed FK rows created once; retry replays; stale or changed digest conflicts; memory cites immutable source version. |
| `execution_mode_after_history` | Add historical failed receipt/attempt, then change direct to container. | Reject even with no current attempt; history and mode remain unchanged. |
| `capability_independence` | Server advertises cycle/1 but not recurrence/1 or intake/1. | Manual cycle controls work; recurrence/intake controls are disabled and no fallback route is attempted. |
| `dashboard_actual_transport` | Packaged CLI launches dashboard and actual client against the private service. | One terminal, capability-correct actions, clean signal shutdown, no leftover child/socket. |

## 16. Parallel implementation ownership

After Phase 0 freezes the shared contract, work may proceed in parallel with
exclusive ownership:

| Lane | Exclusive focus | Join dependency |
| --- | --- | --- |
| A | Domain types/evaluators for work, containers, time | Shared contract frozen |
| B | Cycle/recurrence pure engine and clock fixtures | Shared recurrence DTO frozen |
| C | Intake/promotion pure engine and source/memory seams | Shared intake/provenance DTO frozen |
| D | Protocol/client fixture generation and command registry | Domain DTOs agreed; no lifecycle invention |
| E | TUI view models and route-disabled states | Generated protocol fixtures available |
| F | Migration analysis/fixtures, read-only until target schema freezes | Current and target mappings frozen |

One integration owner controls `schema-v2.sql` successor migrations, shared
store/application top-level files, protocol version, and workspace manifests.
Independent reviewers may inspect all lanes concurrently. No two writers
should independently redefine work status, cycle identity, recurrence keys,
or promotion provenance.

## 17. Final conclusions

1. Keep v2's separation of lifecycle, derived status, dependencies, holds,
   attempts, proof, source, memory, and audit.
2. Remove sprint from the new-write work-kind model and represent it as a
   dated cycle instance, optionally materialized from a recurrence series;
   retain compatibility sprint rows and decoders indefinitely.
3. Keep planning backlog, executable backlog, and active-cycle execution queue
   as distinct derived views, never parent nodes or lifecycles.
4. Make decomposition flexible enough for root tasks, nested milestones, and
   explicit task groups while keeping only direct leaves claimable.
5. Add typed schedule inputs and a derived `scheduled` work status; keep due,
   retry, lease, hard budget, cycle time, and revisit time semantically
   distinct.
6. Add a first-class intake lifecycle for notes, discoveries, questions, and
   revisit items, with optional buckets and typed, digest-bound, source-aware
   promotion provenance.
7. Do not create an arbitrary condition DSL. Extend eligibility only through
   versioned typed condition sources and tested reason/action contracts.
8. Perform the additive v2 schema 2 -> 3 migration in Phase 1, blocked by any
   live attempt. Keep later v1 import separate. Never relabel old evidence or
   guess activation/closeout/recurrence.
9. Expose the model through one registry-driven Rust API, thin CLI/TUI clients,
   and the one-command `bwrk dashboard` experience.
10. Negotiate work/status, cycle, recurrence, and intake capabilities
    independently so partial implementations cannot advertise false support.
