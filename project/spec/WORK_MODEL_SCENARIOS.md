# Boreal work-model scenarios, invariants, and acceptance contract

Status: design-review companion to [WORK_MODEL_V2.md](WORK_MODEL_V2.md),
reviewed against the current source tree on 2026-09-16. This document is a
scenario and acceptance contract. It does not claim that schema 3, cycle,
recurrence, intake, or container closeout are implemented.

## 1. Review outcome

The target direction in `WORK_MODEL_V2.md` is stronger than both the fixed
schema-2 hierarchy and a literal `milestone -> sprint -> task -> evidence`
tree. The user-facing journey should still be easy to understand in that
order, but those four concepts must not share one parent relation:

| User concept | Canonical meaning | Canonical relationship |
| --- | --- | --- |
| Project | Authority, namespace, revision stream, and workspace binding | Owns all project-local records |
| Milestone | Strategic outcome and non-executable work container | Decomposes into milestone/container-task/direct-task descendants |
| Sprint | Dated delivery cycle | Assigns direct tasks and references milestone goals |
| Task | Work unit or explicit task group | Direct tasks execute; container tasks only roll up children |
| Evidence | Immutable proof from one attempt or one container-closeout context | Attaches to proof context; never becomes a work child |

The dashboard may render a composed view such as “Milestone / Sprint / Task /
Evidence,” but it must label each edge. Reparenting a task, scheduling it in a
cycle, adding a dependency, and recording proof are four different mutations.

The present implementation is a useful schema-2 kernel, not this target model.
In particular, the pure status evaluator and claim transaction are work-kind
agnostic, and an application test currently demonstrates a successful claim
against a milestone. Schema 3 must make direct execution mode authoritative at
both the domain and committing-store boundaries before flexible hierarchy is
enabled.

## 2. Current implementation versus target behavior

This table records source-observed behavior, not intended future behavior.

| Concern | Current executable behavior | Target / required disposition |
| --- | --- | --- |
| Project | `project` stores ID, schema/status versions, revision, and timestamps. Multiple IDs can be listed for dashboard discovery. | Add name, description, active/archived lifecycle, timezone, capability versions, primary cycle, and machine-local workspace bindings. |
| Work kinds | `Milestone`, `Sprint`, and `Task` are one enum. | New writes use milestone/task plus `container | direct`; sprint rows remain compatibility-readable only. |
| Parent shape | Root milestone, sprint under milestone, task under sprint. Domain, application, migration, and SQL triggers enforce it. | A project-local acyclic decomposition forest permits root tasks, nested milestones, and task groups. Cycles are not parents. |
| Claimability | Status evaluation and SQL claim selection do not restrict by kind. Any open automatic row without blockers/current attempt can be ready and claimed. | Only an open `direct` task can be ready or own an attempt. Containers, cycles, intake, source, and memory are never claimable. |
| Dependencies | DAG and close-only readiness exist, but endpoints may be any work kind. | Both endpoints must be direct tasks, checked in the application and commit transaction. |
| Sprints | A sprint is a work row and strategic parent. No cycle dates, focus, assignment history, or carry-over exist. | Sprint is a cycle instance. Milestone links and task assignments are separate, temporal records. |
| Recurrence | Not present. | Stable series + immutable weekly template versions + stable slot ordinals/keys + explicit materialization/reconciliation. |
| Work time | SQLite has `due_at` and `retry_not_before`; only retry is read into status. `due_at` is absent from `WorkItem`, ordinary create paths, and status. | Add typed schedule input. Distinguish availability, plan estimates, due badge, retry backoff, cycle time, attempt clocks, and revisit time. |
| Status | Derived status correctly separates lifecycle, dependency wait, holds, attempt, gates, dispatch, and retry. No `scheduled` state or overdue badge exists. | Add direct/container evaluators, schedule/cycle inputs, overdue badge, and all next time boundaries. |
| Holds | Persisted append-style records with explicit resolution fields; active holds feed status. | Retain, add stable typed kinds and structured references, and never delete to “resolve.” |
| Intake | No bucket or note/discovery/question/revisit entity. | Add intake lifecycle, date-based revisit, and typed promotion provenance. |
| Evidence | Receipts, reviews, summaries, gates, attempts, and fences exist. They are task/work subject records, not children. | Bind proof to exactly one current attempt or container closeout context; historical proof cannot float to a new context. |
| Create API | CLI, service, and TUI can now send kind/parent/priority under schema-2 semantics. TUI rejects non-empty hard holds because the current route does not support them. | Capability-gated schema-3 DTOs must replace—not silently extend—the old meaning. |
| Migration | Current migration document understands fixed milestone/sprint/task containment. | Keep schema-2-to-3 upgrade separate from later v1 import; preserve compatibility sprint subjects and ambiguous proof. |

## 3. Canonical authority and relationship invariants

The model is accepted only if all clients and transactions preserve these
invariants.

### 3.1 Universal invariants

1. Every operational reference is project-scoped and validated in the
   committing transaction.
2. Persisted lifecycle is small. `ready`, `queued`, `scheduled`, `blocked`,
   `overdue`, and `revisit_due` are derived results, never writable labels.
3. Decomposition, dependency, cycle assignment, and provenance are distinct
   edge types and cannot be inferred from one another.
4. Only open direct tasks can own attempts. A store-level claim predicate must
   reject every other entity even if an adapter or projection is defective.
5. One current fenced attempt exists per direct task and one current execution
   exists per durable session.
6. Historical attempts, assignment outcomes, evidence, failed evaluations,
   dispositions, and promotion links are retained.
7. Every successful mutation atomically commits canonical rows, operation
   result, audit event, and one project revision. Unknown client outcomes are
   resolved by operation readback.
8. Time-driven read changes use an authoritative `as_of` and
   `next_status_change_at`; passage of time does not fabricate a lifecycle
   mutation.
9. Text from work, intake, source, or memory is data. It cannot grant authority,
   become an executable condition, or satisfy evidence by prose.
10. A client advertises or enables only capabilities and routes actually
    implemented by the server version it is using.

### 3.2 Decomposition invariants

- `milestone` is always `container`.
- `task` is either `direct` or `container`.
- A direct task has no children; a container never has an attempt.
- Root milestones and root tasks are valid.
- Parent links are project-local and acyclic.
- Recommended clarification before contract freeze: a milestone container may
  parent milestones or tasks; a container task should parent tasks only. This
  avoids burying a strategic milestone beneath an implementation task while
  retaining explicit task groups.
- Kind is immutable. Execution mode is mutable only before children,
  assignments, dependencies, dispositions, or any attempt/proof history exist.
- Dependency endpoints are direct tasks only. Container progress is a rollup,
  not a dependency node.

### 3.3 Scheduling invariants

- A cycle assignment never changes `parent_work_id`.
- A milestone may span many cycles; a cycle may advance many milestones.
- A direct task has at most one live `planned | committed` assignment in
  `boreal.cycle/1`.
- A planned cycle may include draft tasks. Starting the cycle commits their
  assignments but does not publish the tasks; they remain `draft` and make the
  cycle derive `incomplete_scope` until explicitly published or removed.
- An active cycle is not required for unscheduled work. Unscheduled open direct
  tasks remain eligible through executable backlog if every other condition
  permits.
- Cycle completion/cancellation is rejected while a live assignment remains.
- Carry-over is one transaction: source becomes `carried_over`, successor is
  inserted, links are mutual, and every committed revision has at most one live
  assignment.
- Completing or cancelling a cycle never closes, cancels, or reopens a task.

### 3.4 Proof invariants

- Direct-task proof has an exact `(work, attempt, fence, input, source,
  configuration, profile, policy, command/tool/environment/observable)`
  context.
- Container proof has an exact `(container, closeout evaluation, descendant
  set, dispositions, descendant outcomes/summaries, profile, policy)` context.
- Those contexts are XOR: both or neither is invalid.
- Witnessed command, checkpoint, and executor receipt proof is attempt-only.
- A container that needs executable verification gets an explicit direct
  closeout task.
- Evidence is never a task child. The UI may nest it below a task attempt as a
  proof view, but the stored relation is proof provenance.
- Attempt rollover, source/config/profile/policy drift, descendant reopening,
  or disposition supersession makes old proof ineligible without deleting it.

## 4. Scenario catalog

The “current” column distinguishes what can be exercised now from what remains
proposal-only.

| ID | Scenario | Canonical records and edges | Expected outcome | Current state |
| --- | --- | --- | --- | --- |
| S01 | Simple project backlog | Project + root direct task, no cycle assignment | Open task is in planning backlog and, if otherwise eligible, executable backlog/`ready` | Impossible under current parent rule; target |
| S02 | Familiar milestone/sprint/task/evidence journey | Milestone container; cycle goal link; task child of milestone; cycle assignment; task attempt and receipts | UI can present the familiar journey without pretending sprint/evidence are decomposition parents/children | Current uses one tree; target relation split |
| S03 | Milestone spans releases | One milestone with tasks assigned historically to cycles A, B, and C | Parent remains stable; milestone rollup spans all descendants and cycle reports retain assignment history | Target |
| S04 | Sprint advances multiple milestones | Cycle goal links to M1/M2; assignments for direct tasks under both | One cycle scope shows both goals; tasks retain original milestone parents | Target |
| S05 | Explicit task group | Milestone -> container task -> direct subtasks | Group is never claimable; subtasks can have dependencies and attempts | Target; parent-kind clarification required |
| S06 | Unscheduled execution | Open direct task with no live assignment | Appears in planning backlog and may be claimed from executable backlog | Target |
| S07 | Future work availability | Direct task with `not_before_at = T` | `scheduled` before T, eligible at equality if no other blocker; next change is T | Target |
| S08 | Due but executable | Open direct task with `due_at = T` and no blocker | Remains ready/claimable at and after T; receives `overdue` badge at equality | Schema column exists but is unused; target |
| S09 | Cycle activation delay | Active cycle + committed assignment with future explicit activation | Task derives `scheduled`; becomes eligible at activation equality | Target |
| S10 | Carry unfinished task | Committed assignment in A carried to planned/active B | Task lifecycle/parent/proof unchanged; linked assignment history; one live slot | Target |
| S11 | Two active cycles | Delivery and maintenance cycles active; one is project primary | Dashboard defaults to primary, filters can show both; a task still has only one live assignment | Target |
| S12 | Weekly recurring sprint | Active series + immutable template v1 + materialized slots | Duplicate materialization/restart creates one cycle per ordinal/key | Target |
| S13 | Recurrence template change | Template v2 starts at ordinal N | Existing slot identity is stable; started/history-bearing cycles are unchanged; eligible future planned cycles require digest-bound reconciliation | Target |
| S14 | Recurring standard tasks | Recurring cycle series plus desire for the same checklist each sprint | `recurrence/1` creates cycle shells only; it does not clone tasks. A later scope-template capability is required for automatic recurring tasks | Explicitly not covered by current target |
| S15 | DST transition | Local recurring start falls in a gap or fold | Persist nominal time, policy, chosen offset, UTC instant, and tzdb identity; never silently recompute old cycles | Target |
| S16 | Notes bucket | Active “Field notes” bucket + captured note | Note is inbox data, not work, dependency, proof, or memory | Target |
| S17 | Discovery creates work and knowledge | Discovery revision R/digest D promoted to draft task and cited memory draft | Typed promotion rows preserve one origin; memory cites immutable source; intake remains | Target |
| S18 | Date-based revisit | Deferred revisit item with `revisit_at = T` | `waiting` before T, `revisit_due` at equality, no lifecycle write | Target |
| S19 | Event-based revisit | “Revisit when task X closes” | Not supported by `intake/1`; requires a future typed trigger capability, not a prose/JSON condition | Deliberate deferral |
| S20 | Question becomes decision | Triaged question resolved by a decision record | No canonical decision entity exists; retain as intake/resolution or defer typed decision promotion | Deliberate deferral |
| S21 | Project archive | Active project archived | Normal work/cycle/intake/execution writes reject; reads/export/repair and audited restore remain | Target |
| S22 | Proof rollover | Attempt A passes, is released, attempt B becomes current | A remains visible but cannot satisfy B; status/close agree | Partially implemented; target binding must remain authoritative |
| S23 | Container closeout across cancelled work | Milestone descendants include closed, cancelled, and replaced tasks | Explicit current dispositions plus summary/allowed closeout gates required; no automatic “all terminal means accepted” | Target |
| S24 | Compatibility sprint with old proof | Schema-2 sprint row owns attempt/receipt during upgrade | Row and proof remain historical/readable; cycle conversion does not transfer proof identity | Target migration |

## 5. Detailed behavioral scenarios

### 5.1 The familiar delivery journey

| Step | Mutation | Canonical effect | Must not happen |
| --- | --- | --- | --- |
| 1 | Initialize project | Create active project, timezone, capability identities, revision, and workspace binding | Treat project as root work |
| 2 | Create milestone | Create container work | Make it claimable |
| 3 | Create sprint | Create planned cycle and link milestone as a cycle goal | Create a sprint work child |
| 4 | Create task | Create direct task under milestone, initially draft or open | Infer cycle assignment from parent |
| 5 | Assign task | Create planned assignment to cycle | Reparent task beneath cycle |
| 6 | Start cycle | Explicitly activate cycle and commit planned assignments | Auto-open draft tasks or claim work |
| 7 | Claim task | Atomically create fenced attempt for eligible direct task | Claim milestone/cycle/container |
| 8 | Run verification | Admit execution, record immutable artifacts/receipt against attempt/fence | Insert evidence as child work or trust self-labels |
| 9 | Finish task | Validate current proof/summary/review and close task; complete live assignment in same revision | Close because cycle ended or a cached gate says passed |
| 10 | Complete cycle | Require no live assignments, then complete explicitly | Close milestone/tasks by cascade |
| 11 | Close milestone | Validate descendant dispositions and container closeout context | Reuse task-attempt proof as milestone proof |

Recommended dashboard composition:

```text
Project
├── Roadmap
│   └── Milestone
│       └── Task (decomposition)
├── Cycles
│   └── Sprint / Cycle
│       └── Task (assignment, with milestone badge)
└── Proof
    └── Task
        └── Attempt
            ├── Checkpoints
            ├── Evidence receipts
            ├── Review
            └── Summary
```

The repeated task is one identity rendered through different relationships.

### 5.2 Backlog, cycle scope, and carry-over

Given direct tasks `A`, `B`, `C`, and `D`:

| Task | Parent | Assignment | Other state | Expected planning view | Expected execution view |
| --- | --- | --- | --- | --- | --- |
| A | Milestone M1 | None | Open, no blockers | Planning backlog | Executable backlog / ready |
| B | Milestone M1 | Planned in future cycle | Open | Cycle scope, not planning backlog | Not executable until cycle is active/committed |
| C | Milestone M2 | Committed in active cycle | Open, dependency open | Active cycle scope | `queued` |
| D | Root task | None | Draft | Planning backlog | `draft`, not executable |

Carrying C from cycle 1 to cycle 2 must not change C's parent, work lifecycle,
attempt history, or accepted proof. It changes only assignment history. If C
has a current attempt, carry-over requires an explicit policy: the first
release should reject it until that attempt is safely released/reconciled.

### 5.3 Recurring cycles

The initial recurrence capability solves repeated dated cycle creation, not
automatic work cloning.

| Concern | Rule |
| --- | --- |
| Identity | `(series_id, slot_ordinal)` and version-independent slot key identify the occurrence |
| Definition | Immutable template version selected by ordinal boundary |
| Cadence | Weekly only, including biweekly via `interval_weeks` |
| Time | Local-wall recurrence resolved once to stored UTC facts |
| Retry | Same operation + semantic payload replays; changed payload conflicts |
| Template edit | New immutable version; never mutate a prior version |
| Existing cycles | Started, completed, cancelled, assigned, attempted, or proof-bearing cycles stay unchanged |
| Future cycles | Only eligible planned cycles may be rescheduled under an expected revision and plan digest |
| Scope | Assignments remain explicit; no hidden task cloning or auto-carry-over |

If recurring task checklists are required, add a separately versioned
`cycle-scope-template` capability with immutable task-blueprint versions,
stable instantiation keys, explicit copy/link semantics, source/profile
identity, and idempotent reconciliation. Do not overload recurrence templates
or clone arbitrary prior-cycle task state.

### 5.4 Intake and promotion

| Intake kind | Default meaning | Typical transitions | Allowed promotions | Never implies |
| --- | --- | --- | --- | --- |
| Note | Observation worth retaining | captured -> triaged/resolved/archived | Source, cited memory draft, supporting link to work | Task, gate, or instruction |
| Discovery | Finding with potential action/knowledge value | captured -> triaged -> resolved | Draft work, source, cited memory draft | Verified fact or ready task |
| Question | Unresolved research/decision prompt | captured -> triaged/deferred/resolved | Draft research task or source; decision promotion deferred | Canonical decision |
| Revisit | Deferred attention item | captured/triaged -> deferred -> triaged/resolved | Draft work/source/memory when revisited | Time-triggered lifecycle mutation |

A promotion binds the exact intake revision and content digest. Editing the
intake after a promotion does not rewrite its targets. A new promotion can
support another target or correction, while the old provenance remains.

### 5.5 Container closeout

Example milestone descendants:

| Descendant | Work outcome | Required container fact |
| --- | --- | --- |
| T1 | Closed with current summary/proof | `accepted_closed` bound to exact revision/outcome |
| T2 | Cancelled as no longer needed | `accepted_cancelled` with authorized actor and reason |
| T3 | Open but moved outside milestone scope | `deferred` with reason, or an audited reparent mutation and recomputed descendant set |
| T4 | Replaced by T5 | `replaced` identifying T5 |

The milestone derives `closing` only when descendant coverage is complete but
its own summary/review/operator approval remains. It becomes `attention` for
an invalidated disposition, reopened descendant, hard hold, expiry review, or
failed closeout gate. It never becomes `ready` or owns a claim.

## 6. Lifecycle semantics by entity

### 6.1 Project

| From | Operation | To | Preconditions/effects |
| --- | --- | --- | --- |
| active | archive | archived | No unsafe in-flight project mutation; normal new operational writes stop |
| archived | restore | active | Authorized, audited, expected revision |

Archive is not delete. It retains work, cycles, intake, proof, source, memory,
audit, export, and repair access.

### 6.2 Direct work

| From | Operation | To | Notes |
| --- | --- | --- | --- |
| draft | publish | open | Valid hierarchy/profile/schedule; publication does not claim |
| open | close | closed | Current proof, summary/review, ownership, and assignment completion commit atomically |
| draft/open | cancel | cancelled | Reason required; live assignment removed and current attempt safely resolved |
| closed/cancelled | reopen | open | New proof context; old proof remains historical; affected rollups/dependents recompute |

### 6.3 Container work

Persisted transitions use the same four lifecycle values, but close uses the
container context. Container derived states are `draft | open | attention |
closing | closed | cancelled`; they never share the direct-work
`ready/claimed/in_progress` vocabulary.

### 6.4 Cycle

| From | Operation | To | Exact rule |
| --- | --- | --- | --- |
| planned | start | active | Commit all planned assignments after one transaction revalidation |
| planned | cancel | cancelled | Reject while any live assignment remains |
| active | complete | completed | Reject while any live assignment remains |
| active | cancel | cancelled | Reject while any live assignment remains |

Scheduled dates derive `upcoming`, `start_due`, and `end_due`; they do not
perform these transitions.

### 6.5 Cycle assignment

| From | Event | To |
| --- | --- | --- |
| create in planned cycle | insert | planned |
| create in active cycle | insert | committed |
| planned | cycle start / explicit commit | committed |
| planned/committed | task closes | completed |
| planned/committed | remove with reason | removed |
| planned/committed | atomic carry-over | carried_over + successor planned/committed |

Terminal assignment states are immutable historical facts.

### 6.6 Recurrence series and template

Series transitions are `active <-> paused` and `active|paused -> retired`.
Retired is terminal. Template versions never transition or update; a change
creates a new version with an ordinal boundary.

### 6.7 Intake

| From | Allowed destinations | Time behavior |
| --- | --- | --- |
| captured | triaged, deferred, archived | Derives `inbox` |
| triaged | deferred, resolved, archived | Derives `attention` until resolved |
| deferred | triaged, resolved, archived | `waiting`, then `revisit_due` at equality if dated |
| resolved | triaged, archived | Reopen is explicit |
| archived | triaged | Restore is explicit |

## 7. Conditional status and time semantics

### 7.1 Direct-work precedence

The target evaluator should return one primary status plus every applicable
reason/badge. The precedence is normative:

1. `closed | cancelled` terminal lifecycle;
2. `expired_review | blocked` hard intervention;
3. `draft`;
4. current attempt/proof (`claimed`, `in_progress`, `needs_verification`,
   `awaiting_review`, `complete`);
5. `paused | retry_wait`;
6. `scheduled` for future effective availability;
7. `queued` for ordinary open prerequisites;
8. `ready` under actor/dispatch policy.

This differs from current code, which checks open dependencies before retry
and paused policy, has no scheduled branch, and applies the same evaluator to
all work kinds. Schema-3 fixtures must freeze the target ordering.

### 7.2 Time field matrix

| Field | Domain meaning | Blocks execution? | Derived effect at equality | Mutates lifecycle automatically? |
| --- | --- | --- | --- | --- |
| `not_before_at` | Earliest work availability | Yes | Scheduling block clears | No |
| assignment `activation_at` | Earliest cycle-scope availability | Yes | Scheduling block clears | No |
| `target_start_at` | Planning estimate | No | Optional planning badge | No |
| `target_end_at` | Planning estimate | No | Optional planning variance badge | No |
| `due_at` | Product target deadline | No | `overdue` badge begins for nonterminal work | No |
| `retry_not_before` | Execution backoff | Yes | `retry_wait` clears | No |
| lease deadline | Renewable liveness boundary | Stops current attempt progression | Expiry review behavior applies | Timer/recovery operation persists outcome |
| hard attempt deadline | Immutable execution budget | Stops current attempt progression | Hard expiry wins | Timer/recovery operation persists outcome |
| cycle start/end | Delivery plan | Only through typed assignment activation | `start_due` / `end_due` | No |
| `revisit_at` | Intake attention time | Not work execution | `revisit_due` | No |

Effective availability for a committed direct task is the latest applicable
blocking instant from `work_schedule.not_before_at` and assignment activation.
`next_status_change_at` is the earliest future instant that can change the
current result, also considering retry and attempt deadlines. `due_at` and
`revisit_at` must be included when they can change badges/display even though
they do not block work.

### 7.3 Combined-condition examples

| Inputs | Primary status | Additional reasons/badges |
| --- | --- | --- |
| Closed + past due | closed | No active overdue badge |
| Open + hard hold + open dependency + past due | blocked | Hold, prerequisite, overdue |
| Draft + committed cycle assignment | draft | Cycle membership; possibly incomplete-scope |
| Open + paused + future not-before + open dependency | paused | Future activation and prerequisite reasons |
| Open + retry future + open dependency | retry_wait | Retry instant and prerequisite reason |
| Open + future not-before + open dependency | scheduled | Activation instant and prerequisite reason |
| Open + operator-only + all conditions met, agent actor | ready but not claimable | `operator_only`, request operator action |
| Open + current attempt beyond hard deadline | expired_review | Hard-budget reason; never ready |

## 8. Schema and API implications

### 8.1 Required schema-3 additions or changes

| Area | Required persistence | Key constraints/indexes |
| --- | --- | --- |
| Project | metadata, lifecycle, timezone, capability versions, primary cycle | lifecycle check; project revision; primary cycle FK |
| Workspace | `workspace_binding` | One active binding per project/local-service identity; root independent of DB path |
| Work | `execution_mode`, flexible parent, source reference strategy | Direct has no children; sprint rejected for new writes; recursive parent cycle guard |
| Schedule | `work_schedule` | One row/work; target end after target start; indexes on not-before/due |
| Container closeout | closeout evaluation + append-only descendant disposition | One current unsuperseded disposition per pair; proof-context digest |
| Dependency | direct-task endpoints only | Project-local FKs; DAG check in commit transaction |
| Cycle | cycle, goal links, assignment history, focus | One live assignment/task; no live assignment on terminal cycle |
| Recurrence | series, immutable template versions, materialized slot facts | Unique version, ordinal, slot key; expected revision/digest |
| Intake | bucket, item, three typed promotion tables | Project-local FKs; revision/content digest; append-only promotion |
| Proof | attempt/container context discriminator | XOR shape check and authoritative eligibility validation |
| Operations | typed command/result identity | Operation ID + canonical payload digest; readback route |

Project namespace semantics also require a decision on identifiers. The current
schema uses globally primary `work_id`, `source_version_id`, and similar IDs
despite also declaring project-composite uniqueness. If schema 3 intends IDs to
be project-local, primary keys and all FKs/routes must consistently carry
`project_id`. If IDs remain globally unique, the contract should say so while
still validating project ownership on every reference. Do not leave this
implicit.

### 8.2 API implications

- Work creation takes `kind`, `execution_mode`, optional parent, lifecycle or
  explicit publish operation, priority, dispatch policy, profile, source, and
  schedule under a negotiated work-model version.
- Cycle creation/assignment and decomposition edits use different routes and
  result types.
- `sprint` is an alias for cycle routes only after cycle capability exists; it
  must not ambiguously address compatibility sprint work rows.
- Exact reads use indexed identity queries; list/backlog/cycle/inbox views are
  bounded and cursor-based.
- Status responses include entity-specific status vocabularies, reason codes,
  badges, `as_of`, revision, and next clock change.
- Every mutation carries project, actor/session, operation ID, canonical
  request digest, expected revision where applicable, and typed outcome.
- TUI controls are route/capability gated. Unsupported functionality is visibly
  disabled and never falls back to direct SQLite or a different command.

## 9. Clarifications required before freezing schema 3

| Decision | Recommended resolution | Why it matters |
| --- | --- | --- |
| Can a container task parent a milestone? | No; task containers parent tasks only | Preserves strategic hierarchy and clearer rollups |
| What happens to draft tasks when their cycle starts? | Commit assignment, retain draft lifecycle, mark cycle incomplete scope | Avoids implicit publication while preserving planning intent |
| Can work with a current attempt be carried over? | Reject until release/reconciliation | Avoids changing delivery ownership beneath an executor |
| Does recurrence clone sprint tasks? | No in recurrence/1 | Cloning needs its own identity, proof, source, and reconciliation rules |
| Can revisit depend on an event? | Not in intake/1; add typed future triggers | Prevents generic condition DSL and hidden polling semantics |
| Are work IDs project-local or globally unique? | Choose and encode consistently before migration | Current PKs and target namespace language disagree |
| Does due date ever block? | No; badge only | Keeps deadlines distinct from availability |
| May a task be assigned to two active cycles? | No in cycle/1 | Prevents ambiguous scope/capacity; later roles may version this |
| How is evidence shown below a task? | Through attempt/proof view, never parent ID | Preserves trust and fencing |
| How are source links beyond one primary source represented? | Typed many-to-many work-source links | A convenience primary FK cannot express all provenance |

## 10. Phased acceptance tests

### Phase 0 — freeze scenarios and shared fixtures

| Test | Acceptance |
| --- | --- |
| Entity vocabulary | Rust/domain, SQL checks, protocol DTOs, CLI, and TUI decoders agree on each entity lifecycle/status vocabulary |
| Relationship vocabulary | Fixtures distinguish parent, dependency, assignment, goal, source citation, promotion, and proof links |
| Claim matrix | Every entity/kind/mode combination proves that only open direct task is potentially claimable |
| Capability independence | Work/status, cycle, recurrence, and intake versions enable routes independently |
| Current-gap regression | A fixture reproduces current milestone claimability, then schema-3 tests require rejection at projection and commit |

### Phase 1 — project and decomposition kernel

| Test | Acceptance |
| --- | --- |
| Flexible hierarchy | Create root task, nested milestones, milestone task, and task group through public routes |
| Invalid hierarchy | Reject cross-project parent, direct parent, task-container -> milestone if recommendation accepted, and every parent cycle |
| Direct-only execution | Status never reports a container ready; direct SQL/application claim of container rejects with zero writes |
| Direct-only DAG | Reject dependency edges involving milestone/container/compatibility sprint and reject concurrent cycle creation |
| Work schedule | `not_before` equality, due badge equality, target-window validation, and restart round-trip pass |
| Project lifecycle | Archive blocks normal mutations and execution while reads/export/restore remain |
| Workspace binding | Moving DB does not change witnessed executor root; unavailable binding fails safely |
| Container proof | Attempt/container XOR, disposition drift, descendant reopen, summary/review closeout cases pass |
| Migration preflight | Any live schema-2 attempt causes zero-write typed refusal; resolved rerun succeeds and retains compatibility sprint |

### Phase 2 — cycle and backlog kernel

| Test | Acceptance |
| --- | --- |
| Cross-cutting scope | One milestone spans three cycles and one cycle schedules tasks from two milestones without reparenting |
| Backlog sets | Planning backlog, executable backlog, and active-cycle execution queue return distinct exact sets |
| Draft scope | Starting cycle with draft task commits assignment but task remains draft and cycle derives incomplete scope |
| Assignment uniqueness | Two concurrent assignments for one task yield one live winner and one typed conflict |
| Carry-over | Crash/retry/race matrix preserves linked history and exactly one live slot |
| Terminal cycle | Complete/cancel rejects with live scope and succeeds only after completed/removed/carried-over dispositions |
| Multiple active cycles | Explicit primary focus controls default dashboard; list order never does |

### Phase 3 — recurrence and time

| Test | Acceptance |
| --- | --- |
| Weekly/biweekly slots | Expected local candidates map to stable ordinals/keys and materialize once across 100 duplicate calls |
| Restart and timer duplication | Restart/duplicate delivery never duplicates a cycle or advances ordinal incorrectly |
| DST matrix | Gap/fold policies, elapsed/local-wall end semantics, nominal values, offsets, UTC, and tzdb identity persist exactly |
| Template version | New ordinal boundary keeps old slots stable; only eligible planned cycles change under exact plan digest |
| Clock-only status | Schedule, due, cycle, retry, attempt, and revisit boundaries refresh at equality without unrelated writes |
| Unsupported recurrence | Daily/monthly/business-calendar or task-cloning fields reject under recurrence/1 |

### Phase 4 — intake and promotion

| Test | Acceptance |
| --- | --- |
| Four kinds | Capture, triage, defer, resolve, archive, restore, and bounded list/detail for each kind |
| Bucket neutrality | Moving/archiving a bucket never changes task status or proof |
| Revisit equality | Deferred item becomes `revisit_due` at exact boundary without lifecycle mutation |
| Typed promotion | One discovery promotes to draft work, immutable source, and cited memory draft with exact origin digest |
| Replay/conflict | Same operation/payload replays; changed or stale revision/digest conflicts before target creation |
| Trust boundary | Intake cannot directly publish memory, mint evidence, execute text, or satisfy a gate |
| Unsupported event trigger | “When task closes” revisit request gets typed unsupported-capability response |

### Phase 5 — real service, CLI, and dashboard

| Test | Acceptance |
| --- | --- |
| One-terminal journey | `bwrk dashboard` initializes/discovers project, manages private service/TUI, and cleans up on normal exit and signals |
| Familiar composed view | Roadmap/cycle/task/proof views show relation labels and one task identity without false tree edges |
| Actual transport | Built TypeScript client drives built Rust service; no mocks, direct SQL, per-refresh CLI, or manual server |
| Mutation safety | Confirmation, expected revision/fence, operation readback, stale/conflict/busy/unknown handling pass |
| Capability-disabled UI | Cycle without recurrence and work without intake show precise disabled reasons and make no fallback call |
| Concurrent refresh | Another client mutates assignments/status while dashboard maintains one revision/`as_of` snapshot |

### Phase 6 — migration, fault, scale, and release

| Test | Acceptance |
| --- | --- |
| Schema-2 sprint conversion | Preserve sprint row; create cycle/goal/assignments deterministically; keep sprint proof on old subject |
| Ambiguous references | Container/sprint dependency endpoints and uncertain proof become blocking findings, never guessed valid state |
| Legacy import | Every source record has mapping/disposition and stable digest; no historical evidence is relabeled witnessed |
| Scale | 10,000 work records plus cycle/assignment/intake/proof histories keep exact reads indexed and routine pages bounded |
| Concurrency | Materialization, assignment, carry-over, claim, promotion, and status races preserve all uniqueness invariants |
| Backup/restore | SQLite, blobs, memory manifests, slot identities, workspace metadata, and migration provenance verify after restore |
| Standalone release | Packaged CLI/TUI reports schema/capability/SQLite identity and passes the entire public journey after restart |

## 11. Release-blocking scenario gates

Schema 3 is not ready for writes until all of these are true:

1. Milestones, containers, cycles, and intake fail closed at the claim
   transaction, not only in UI/status code.
2. Fixed sprint parenting is replaced atomically with cycle assignment and
   permanent compatibility reads.
3. `due_at`, availability, cycle activation, retry, attempt clocks, and revisit
   time have distinct persisted meanings and shared equality fixtures.
4. Container closeout cannot reuse attempt proof and task proof cannot survive
   attempt/context rollover.
5. Recurrence slot identity and DST resolution are deterministic across retry
   and restart.
6. Intake promotion is typed, digest-bound, source-aware, and unable to mint
   authority.
7. Actual CLI/service/TUI clients pass the same scenarios and advertise only
   implemented capabilities.

## 12. Key conclusions

- Preserve the familiar project/milestone/sprint/task/evidence experience as a
  composed navigation view, not one overloaded hierarchy.
- Keep strategic decomposition stable while cycle assignments record delivery
  history. This is what makes backlog, carry-over, multi-milestone sprints, and
  recurring sprint instances coherent.
- Make direct/container mode the immediate safety boundary. The current
  kind-agnostic claim path is incompatible with the target hierarchy.
- Treat recurrence as cycle occurrence generation only. Recurring task packs
  need a later explicit template/instantiation capability.
- Use intake for notes, discoveries, questions, and date-based revisit items;
  promote through typed provenance instead of converting prose into status or
  proof.
- Keep every time field semantically narrow. Availability blocks, due dates
  warn, retries back off, leases/hard limits govern attempts, cycle dates plan,
  and revisit dates request attention.
- Reject a generic conditional DSL. New behavior must arrive as a typed,
  versioned condition source with storage, authorization, status, migration,
  protocol, and negative tests.
