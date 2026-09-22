# R-WORKMODEL — project/spec/WORK_MODEL_V2.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/WORK_MODEL_V2.md:L1–L1444`  
**File SHA-256:** `f9c080e78599cec4304c5e3d8b0b4f7aa5a71900c7dbc9fcb643eadf13d1280b`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Proposed work-model/3 separation of decomposition, scheduling, assignments, proof context and container acceptance.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,1444p' 'project/spec/WORK_MODEL_V2.md'
```

## Exact baseline excerpt

````text
    1 | # Boreal v2 work, cycle, schedule, and intake model
    2 | 
    3 | Status: proposed implementation contract for the next versioned work-model
    4 | boundary. This document audits the current v2 model and defines the target
    5 | model. It does not claim that the target schema, commands, or UI exist yet.
    6 | 
    7 | Normative words `MUST`, `MUST NOT`, `SHOULD`, and `MAY` describe product
    8 | requirements. The implementation must version any change to these semantics
    9 | and update the executable fixtures before accepting writes under the new
   10 | version.
   11 | 
   12 | ## 1. Decision summary
   13 | 
   14 | The current v2 foundation is sound in the places where it separates persisted
   15 | work lifecycle from derived status, containment from dependencies, attempts
   16 | from work, and operational state from source, memory, and evidence. Those
   17 | separations remain authoritative.
   18 | 
   19 | The current fixed `milestone -> sprint -> task` containment tree is not the
   20 | right long-term model. It conflates two different facts:
   21 | 
   22 | 1. **Decomposition:** why a unit of work exists and which larger outcome it
   23 |    contributes to.
   24 | 2. **Scheduling:** when a unit of work is planned for delivery.
   25 | 
   26 | The target model therefore makes the following decisions:
   27 | 
   28 | - A **project** is an authority and namespace, not a work item.
   29 | - A **milestone** and a **task** remain work-item kinds. Work containment is a
   30 |   project-local decomposition tree.
   31 | - A **sprint becomes a separate cycle entity**. `WorkKind::Sprint` is not
   32 |   accepted for new writes after schema version 3 is active. The enum variant,
   33 |   row decoder, exact reads, and historical rendering remain supported
   34 |   indefinitely for compatibility; conversion never requires deleting the
   35 |   legacy subject.
   36 | - **Planning backlog** and **executable backlog** are derived views, not
   37 |   container work items. Planning backlog means unscheduled direct work;
   38 |   executable backlog is the ready/claimable subset. Cycle scope is a third,
   39 |   separate view.
   40 | - A task's milestone parent does not change when the task is assigned to,
   41 |   removed from, completed in, or carried between cycles.
   42 | - **Dependencies, hard holds, dispatch policy, time windows, current attempts,
   43 |   and acceptance gates remain separate canonical axes.** There is no generic
   44 |   executable condition language.
   45 | - **Recurring sprints are a stable recurrence series with immutable template
   46 |   versions and stable slot keys that materialize cycle instances.** Editing a
   47 |   template never renumbers a slot or rewrites a started/completed occurrence.
   48 | - Notes, discoveries, questions, and revisit reminders are **intake items**,
   49 |   not fake tasks. They may be triaged or promoted into work, immutable source
   50 |   versions, or source-cited memory drafts through typed promotion tables.
   51 | - Raw source, curated memory, and immutable evidence keep their existing trust
   52 |   boundaries. Intake prose cannot satisfy a work gate, source text cannot
   53 |   become an instruction, and a note is not witnessed execution.
   54 | 
   55 | The model uses independently negotiable capability identities. A client MUST
   56 | not infer support for one capability from another:
   57 | 
   58 | | Capability | Initial identity | Meaning |
   59 | | --- | --- | --- |
   60 | | Work/decomposition | `boreal.work-model/3` | Direct/container work, flexible hierarchy, typed scheduling. |
   61 | | Derived status | `boreal.work-status/3` | Status/reason precedence for the new inputs. |
   62 | | Cycle | `boreal.cycle/1` | Cycle instances, goals, assignments, carry-over. |
   63 | | Recurrence | `boreal.recurrence/1` | Series, template versions, stable slots, reconciliation. |
   64 | | Intake | `boreal.intake/1` | Intake lifecycle and typed promotions. |
   65 | 
   66 | SQLite `user_version = 3` is the additive current-v2 storage migration. It is
   67 | not the legacy-v1 import format. Protocol discovery advertises each capability
   68 | and its route set independently; absence means unsupported, never best-effort
   69 | fallback. Final identifiers are frozen with shared contract fixtures before
   70 | writes are enabled.
   71 | 
   72 | ## 2. Current-state audit
   73 | 
   74 | The audit is based on the current [schema fixture](schema-v2.sql), the
   75 | [domain model](../../crates/domain/src/lib.rs), the
   76 | [migration model](../../crates/migration/src/lib.rs), and the product contracts
   77 | in [PRODUCT.md](../PRODUCT.md), [STATUS_MODEL.md](../STATUS_MODEL.md),
   78 | [STATE_AND_CONCURRENCY.md](../STATE_AND_CONCURRENCY.md),
   79 | [SOURCE_ENGINE.md](../SOURCE_ENGINE.md), and [MEMORY_BANK.md](../MEMORY_BANK.md).
   80 | 
   81 | ### 2.1 What is already correct and must be retained
   82 | 
   83 | - `project_id` scopes work, source versions, operations, revisions, and audit
   84 |   state.
   85 | - Work persists only `draft`, `open`, `closed`, or `cancelled`; visible
   86 |   `queued`, `ready`, `blocked`, attempt, proof, and expiry statuses are derived.
   87 | - Parent containment and blocking dependencies are distinct relationships.
   88 | - Dependencies default to close-only satisfaction and are cycle-checked.
   89 | - Priority, dispatch policy, retry delay, hard holds, acceptance profiles,
   90 |   attempts, leases, hard deadlines, gates, receipts, reviews, summaries, and
   91 |   close intent are separate records or fields.
   92 | - One current attempt per work item and one current execution per session are
   93 |   protected with fences and uniqueness constraints.
   94 | - Receipt and audit rows are append-only historical facts.
   95 | - Source versions identify immutable bytes, memory publication has a separate
   96 |   reviewed Git lifecycle, and neither is treated as live work state.
   97 | - Status snapshots have a revision, `as_of`, and a future clock transition;
   98 |   clients are not allowed to invent eligibility.
   99 | 
  100 | ### 2.2 Current limitations
  101 | 
  102 | | Area | Current behavior | Consequence |
  103 | | --- | --- | --- |
  104 | | Project | `project` contains identity, contract versions, revision, and timestamps only. | No canonical name, description, lifecycle, timezone, workspace binding, or cycle focus exists. |
  105 | | Hierarchy | `work_item.kind` is `milestone`, `sprint`, or `task`; triggers require root milestone, sprint under milestone, and task under sprint. | A task cannot exist in an unscheduled backlog, a milestone cannot contain work spanning multiple cycles cleanly, and moving a task between sprints changes its strategic parent. |
  106 | | Execution | The status evaluator is work-kind agnostic. | A milestone or sprint can appear leaf-claimable unless every caller adds extra policy. Containers and directly executable work are not explicit. |
  107 | | Scheduling | Work has `due_at` and `retry_not_before`; there is no cycle instance, cycle membership, active-cycle state, `not_before`, planned window, or schedule history. | Due dates cannot express availability, cycle dates, carry-over, or historical planning. |
  108 | | Recurrence | No recurrence template or occurrence identity exists. | Recurring sprints would require copying work containers and risk duplicate or rewritten occurrences. |
  109 | | Intake | There is no operational note/discovery/question/revisit entity. | Users must misuse tasks, raw sources, or published memory for untriaged material. |
  110 | | Conditions | Dependencies and holds exist, but there is no complete typed account of schedule activation and other reasons. | Adapters are tempted to add ad hoc booleans or JSON conditions and derive different statuses. |
  111 | | Migration | The migration format preserves the fixed milestone/sprint/task tree. It maps several legacy terminal-looking statuses directly to `closed`. | It cannot represent cycle membership, recurrence, intake, or ambiguous historical closeout without a new format and explicit review. |
  112 | | API/TUI | The Rust service now routes `create_project`/`create_work`, and the TUI maps its create methods to those routes. The current create-work DTO still models `milestone | sprint | task` and the present hierarchy. | Route existence is no longer the gap; schema-3 DTOs, capability negotiation, new invariants, and real-client fixtures must replace the old semantics atomically. |
  113 | | Dashboard | `bwrk dashboard` now resolves the project, starts a private service, launches the TUI, supervises children, and cleans up. | The launcher gap is closed in source; packaging, platform coverage, richer routes, and end-to-end release fixtures remain acceptance work. |
  114 | 
  115 | The audit also finds a representation mismatch: `due_at` exists in SQLite but
  116 | is not part of the current domain `WorkItem`, and the approved status contract
  117 | describes an overdue badge that the pure evaluator cannot currently derive.
  118 | The target model resolves this through typed schedule input to the evaluator.
  119 | 
  120 | ## 3. Target authority map
  121 | 
  122 | ```text
  123 | Project namespace
  124 | ├── Work decomposition tree
  125 | │   ├── milestone/container work
  126 | │   └── task/container or task/direct work
  127 | ├── Delivery cycles
  128 | │   ├── optional recurrence series and immutable template versions
  129 | │   ├── materialized cycle instances
  130 | │   └── temporal task assignments
  131 | ├── Intake
  132 | │   ├── buckets
  133 | │   ├── notes/discoveries/questions/revisit items
  134 | │   └── promotion links
  135 | ├── Sources and curated memory
  136 | └── Attempts, immutable evidence, summaries, audit, and operations
  137 | ```
  138 | 
  139 | Four relationship types MUST remain visibly different:
  140 | 
  141 | | Relationship | Meaning | Shape |
  142 | | --- | --- | --- |
  143 | | Decomposition parent | Work contributes to a larger work outcome. | Acyclic tree/forest within one project. |
  144 | | Dependency edge | A direct task cannot advance until another direct task satisfies policy. | Acyclic directed graph of direct tasks within one project. |
  145 | | Cycle assignment | Work is scheduled into a delivery period. | Temporal many-to-many history with one live planned/committed assignment per direct task in the first release. |
  146 | | Provenance/reference | Intake, source, memory, evidence, and work explain or cite one another. | Typed links; never eligibility by implication. |
  147 | 
  148 | No adapter may infer one relationship from another. A cycle assignment does
  149 | not create a dependency. A milestone parent does not assign a cycle. A cited
  150 | note does not satisfy a gate.
  151 | 
  152 | ## 4. Project namespace
  153 | 
  154 | ### 4.1 Canonical project record
  155 | 
  156 | The project remains the revision and authorization namespace. Under
  157 | `boreal.work-model/3` it stores:
  158 | 
  159 | ```text
  160 | project_id                  stable typed identity
  161 | name                        non-empty display name
  162 | description                 optional project description
  163 | lifecycle                   active | archived
  164 | default_timezone            canonical IANA zone, for example America/Regina
  165 | work_model_version          boreal.work-model/3
  166 | status_contract_version     boreal.work-status/3
  167 | cycle_model_version         boreal.cycle/1 or absent
  168 | recurrence_model_version    boreal.recurrence/1 or absent
  169 | intake_model_version        boreal.intake/1 or absent
  170 | project_revision            monotonic mutation revision
  171 | created_at / updated_at     authoritative UTC instants
  172 | ```
  173 | 
  174 | Machine-local filesystem data MUST be separate from portable project
  175 | identity:
  176 | 
  177 | ```text
  178 | workspace_binding
  179 |   workspace_id
  180 |   project_id
  181 |   canonical_root
  182 |   state: active | unavailable | retired
  183 |   observed_at
  184 | ```
  185 | 
  186 | Moving the SQLite file MUST NOT change the workspace root used by a witnessed
  187 | executor. A project MAY have multiple historical bindings but only one active
  188 | binding per local service identity.
  189 | 
  190 | ### 4.2 Project lifecycle and derived health
  191 | 
  192 | Persisted project lifecycle is only `active` or `archived`. Archive prevents
  193 | new normal work, cycle, intake, and execution mutations but retains reads,
  194 | export, repair, and explicit audited reactivation.
  195 | 
  196 | Project health is derived and is not lifecycle. Its vocabulary remains owned
  197 | by the operator-health contract and is outside this model; this document does
  198 | not introduce new health labels. Health MUST NOT substitute for per-work
  199 | eligibility.
  200 | 
  201 | ## 5. Work decomposition
  202 | 
  203 | ### 5.1 Work kinds and execution mode
  204 | 
  205 | New writes support these work kinds:
  206 | 
  207 | - `milestone`: a strategic or delivery outcome and always a container.
  208 | - `task`: a unit that may be directly executable or may group smaller tasks.
  209 | 
  210 | Work gains an explicit execution mode:
  211 | 
  212 | - `container`: has rollup/closeout semantics and cannot own a current execution
  213 |   attempt.
  214 | - `direct`: is a leaf that may be claimed and must not have child work.
  215 | 
  216 | Required combinations:
  217 | 
  218 | | Kind | Allowed mode | Notes |
  219 | | --- | --- | --- |
  220 | | milestone | container only | Can contain milestones or tasks. |
  221 | | task | direct or container | Defaults to direct; container tasks support explicit task groups/subtasks. |
  222 | | sprint | no new writes | Compatibility-only legacy row; decoded and rendered indefinitely. |
  223 | 
  224 | This keeps familiar milestone/task language while avoiding an ever-growing
  225 | `WorkKind` enum for notes, buckets, cycles, or every future planning concept.
  226 | `WorkKind` is immutable after creation. `execution_mode` may change only before
  227 | proof history exists and only if the target-mode structural rules already
  228 | hold. Proof history means any attempt, checkpoint, receipt, review, summary,
  229 | close intent/evaluation, or container disposition. Once any such row exists,
  230 | `execution_mode` is permanently immutable for that work ID.
  231 | 
  232 | ### 5.2 Canonical work fields
  233 | 
  234 | ```text
  235 | work_id, project_id
  236 | kind: milestone | task
  237 | execution_mode: container | direct
  238 | parent_work_id: optional work ID
  239 | lifecycle: draft | open | closed | cancelled
  240 | dispatch_policy: automatic | operator_only | paused
  241 | priority: 0..255
  242 | acceptance_profile_id/version
  243 | title, description
  244 | primary_source_version_id: optional convenience reference
  245 | created_at, updated_at
  246 | ```
  247 | 
  248 | Scheduling fields are a separate one-to-one input, not lifecycle:
  249 | 
  250 | ```text
  251 | work_schedule
  252 |   work_id
  253 |   not_before_at: optional UTC instant
  254 |   due_at: optional UTC instant
  255 |   target_start_at: optional UTC instant
  256 |   target_end_at: optional UTC instant
  257 |   schedule_revision
  258 |   updated_by / updated_at
  259 | ```
  260 | 
  261 | `retry_not_before` remains execution-retry policy and MUST NOT be overloaded
  262 | as project planning time. `target_start_at` and `target_end_at` are planning
  263 | estimates only: they do not gate claims, create cycle membership, or derive
  264 | overdue. If both exist, `target_end_at` MUST be greater than
  265 | `target_start_at`.
  266 | 
  267 | ### 5.3 Parent rules
  268 | 
  269 | - Parent and child MUST be in the same project.
  270 | - Parent links MUST be acyclic.
  271 | - A `container` may parent milestones or tasks.
  272 | - A `direct` work item MUST NOT have children.
  273 | - Root milestones and root tasks are valid. A root direct task is ordinary
  274 |   backlog work, not malformed work.
  275 | - Changing a container to direct is rejected while children, container
  276 |   dispositions, or proof history exist.
  277 | - Changing a direct task to container is rejected while a cycle assignment,
  278 |   dependency edge, child, or proof history exists. A completed attempt is as
  279 |   binding as a current attempt.
  280 | - Moving a work item revalidates hierarchy, permissions, status, affected
  281 |   rollups, guidance, and any current execution reconciliation requirement.
  282 | - A cycle, intake bucket, source, or memory entry can never be `parent_work_id`.
  283 | 
  284 | In `boreal.work-model/3`, dependency endpoints MUST both be direct tasks.
  285 | Milestones, container tasks, cycles, and compatibility sprint rows cannot be
  286 | new prerequisites or dependents. Container readiness is a rollup over
  287 | descendants, never a node in the dependency DAG. This first-release restriction
  288 | prevents cross-graph deadlocks in which a container waits on a descendant while
  289 | that descendant waits on the container (directly or through another rollup).
  290 | Broader dependency roles require a separately versioned semantic model, not a
  291 | relaxed foreign key.
  292 | 
  293 | ### 5.4 Container closeout
  294 | 
  295 | Containers are not claimable. Their derived state comes from descendant
  296 | dispositions plus their own closeout requirements. Container disposition facts
  297 | are append-only:
  298 | 
  299 | ```text
  300 | container_descendant_disposition
  301 |   disposition_id
  302 |   container_work_id
  303 |   descendant_work_id
  304 |   kind: accepted_closed | accepted_cancelled | deferred | replaced
  305 |   descendant_revision / descendant_outcome_digest
  306 |   replacement_work_id: required only for replaced
  307 |   reason / authorized_by / policy_digest / created_at
  308 |   supersedes_disposition_id: optional
  309 | ```
  310 | 
  311 | A correction inserts a new row referencing the row it supersedes; it never
  312 | updates or deletes the original. At most one unsuperseded disposition is
  313 | current for `(container_work_id, descendant_work_id)`. `accepted_closed` binds
  314 | the exact terminal descendant revision and current summary/proof identity.
  315 | Reopening or materially revising that descendant makes the disposition
  316 | ineligible but leaves it visible. `deferred`, `replaced`, and
  317 | `accepted_cancelled` require an authorized actor and a non-empty reason.
  318 | 
  319 | Container acceptance profiles MAY require summary, review, audit, or operator
  320 | approval. A container MUST NOT require a witnessed command/checkpoint gate
  321 | directly; if executable verification is required, model an explicit direct
  322 | closeout task beneath the container. This preserves the invariant that
  323 | witnessed execution belongs to a fenced attempt.
  324 | 
  325 | A container closes only when:
  326 | 
  327 | 1. every required descendant is closed or has an explicit accepted
  328 |    cancel/deferral/replacement disposition;
  329 | 2. no unresolved hard hold remains;
  330 | 3. its allowed container closeout gates are satisfied for the current
  331 |    descendant/schedule/policy revision; and
  332 | 4. one current final summary is committed atomically with close.
  333 | 
  334 | ### 5.5 Proof contexts and invalidation
  335 | 
  336 | Proof eligibility has exactly one of two contexts. It is invalid for a proof
  337 | row, gate evaluation, or close evaluation to carry both contexts or neither:
  338 | 
  339 | ```text
  340 | AttemptProofContext XOR ContainerCloseoutContext
  341 | 
  342 | AttemptProofContext
  343 |   work_id, attempt_id, fence
  344 |   input/source/configuration identities
  345 |   acceptance_profile_id/version
  346 |   gate policy, command, tool, environment and observable-scope digests
  347 | 
  348 | ContainerCloseoutContext
  349 |   container_work_id, container_closeout_id
  350 |   descendant_set_digest
  351 |   current_disposition_set_digest
  352 |   descendant_outcome_and_summary_digest
  353 |   acceptance_profile_id/version
  354 |   source/configuration/policy digests
  355 | ```
  356 | 
  357 | The schema-level shape check is equivalent to:
  358 | 
  359 | ```text
  360 | (attempt_id IS NOT NULL AND fence IS NOT NULL
  361 |  AND container_closeout_id IS NULL)
  362 | XOR
  363 | (attempt_id IS NULL AND fence IS NULL
  364 |  AND container_closeout_id IS NOT NULL)
  365 | ```
  366 | 
  367 | Witnessed commands, checkpoints, and executor receipts are valid only in an
  368 | attempt context. Container context may contain summaries, reviews, audit facts,
  369 | operator approvals, and descendant dispositions, but never pretends a
  370 | container owned an execution attempt.
  371 | 
  372 | Attempt proof becomes ineligible when the current attempt/fence changes or any
  373 | bound input, source, configuration, profile, gate policy, command, tool,
  374 | environment, or observable scope identity changes. Reopening direct work also
  375 | requires a new proof context even before another attempt is claimed. Container
  376 | proof becomes ineligible when children/required descendants change; a descendant reopens or
  377 | its bound outcome/summary changes; a disposition is superseded; or the
  378 | container profile, policy, source, configuration, or closeout evaluation
  379 | changes. Cycle assignment and display-order changes do not invalidate task
  380 | proof unless the acceptance profile explicitly binds them into the input
  381 | identity. Historical proof is never deleted. Gate satisfaction is always
  382 | derived from proof eligible for the one current context; a cached projection
  383 | cannot survive context invalidation.
  384 | 
  385 | ## 6. Delivery cycles and backlog
  386 | 
  387 | ### 6.1 Why sprint is a cycle, not work
  388 | 
  389 | A sprint answers **when and with what delivery scope**. A milestone/task
  390 | answers **what outcome or action exists**. Keeping sprint as a work parent
  391 | breaks common scenarios:
  392 | 
  393 | - a task exists in the backlog before a sprint is selected;
  394 | - one milestone spans multiple sprints;
  395 | - one sprint includes tasks from several milestones;
  396 | - unfinished work is carried to a later sprint without changing why it exists;
  397 | - a recurring sprint creates new dated instances without cloning strategic
  398 |   hierarchy;
  399 | - cycle completion records planning history without claiming every task closed.
  400 | 
  401 | Therefore sprint becomes the user-facing name for a `cycle` entity. CLI/TUI
  402 | MAY continue to display “Sprint” and retain `sprint` aliases, but canonical API
  403 | and storage use cycle identities.
  404 | 
  405 | ### 6.2 Cycle instance
  406 | 
  407 | ```text
  408 | cycle_id, project_id
  409 | series_id / template_version_id / slot_key / slot_ordinal: optional as a group
  410 | name, goal
  411 | lifecycle: planned | active | completed | cancelled
  412 | scheduled_start_at / scheduled_end_at: UTC instants
  413 | nominal_local_start / nominal_local_end: local wall-clock values
  414 | timezone: IANA zone captured for the occurrence
  415 | start/end UTC offsets and tzdb_identity: materialization facts
  416 | actual_started_at / actual_ended_at: optional UTC instants
  417 | created_at, updated_at
  418 | ```
  419 | 
  420 | Cycle lifecycle transitions are explicit and audited:
  421 | 
  422 | ```text
  423 | planned -> active -> completed
  424 | planned -> cancelled
  425 | active  -> cancelled
  426 | ```
  427 | 
  428 | Completed and cancelled cycles are terminal in `boreal.cycle/1`; reopening is
  429 | deferred until a later capability defines its effects. Passing scheduled
  430 | start/end does not silently mutate lifecycle. The clock only derives
  431 | `start_due`/`end_due`; an explicit idempotent operation commits lifecycle.
  432 | 
  433 | The project MAY have multiple active cycles, for example delivery and
  434 | maintenance, but one optional `primary_cycle_id` controls the default dashboard
  435 | focus. Primary focus is explicit and never inferred from first-list order.
  436 | 
  437 | ### 6.3 Cycle goals and task assignment
  438 | 
  439 | Milestones relate to cycles through a many-to-many `cycle_goal` link. They do
  440 | not become cycle parents.
  441 | 
  442 | Direct tasks relate to cycles through temporal assignment records:
  443 | 
  444 | ```text
  445 | cycle_assignment
  446 |   assignment_id
  447 |   cycle_id
  448 |   work_id
  449 |   state: planned | committed | removed | completed | carried_over
  450 |   activation_policy: at_cycle_start | immediate | explicit_not_before
  451 |   activation_at: optional UTC instant
  452 |   ordinal: optional display ordering
  453 |   assigned_by / assigned_at
  454 |   ended_by / ended_at / reason
  455 |   predecessor_assignment_id: optional
  456 |   successor_assignment_id: optional
  457 | ```
  458 | 
  459 | Assignment states and transitions are exact:
  460 | 
  461 | ```text
  462 | create in planned cycle                       -> planned
  463 | create in active cycle                        -> committed
  464 | planned --cycle start/explicit commit-------> committed
  465 | planned|committed --task closes-------------> completed
  466 | planned|committed --remove with reason------> removed
  467 | planned|committed --atomic carry-over-------> carried_over
  468 | ```
  469 | 
  470 | `completed`, `removed`, and `carried_over` are terminal. Carry-over is one
  471 | transaction that terminalizes the source assignment and creates its successor
  472 | for the same work. The source stores `successor_assignment_id`; the successor
  473 | stores `predecessor_assignment_id`; each link is unique, project-local, and
  474 | acyclic. Source and target cycles must differ. The target cycle must be
  475 | `planned` or `active`; its assignment is respectively `planned` or
  476 | `committed`. A retry with the same operation and payload returns the same pair.
  477 | A changed target/payload under the operation ID conflicts.
  478 | 
  479 | A **live assignment slot** is an assignment in `planned` or `committed` state.
  480 | The store enforces at most one live slot per direct task with a partial unique
  481 | index. Carry-over orders its source terminalization and successor insertion in
  482 | one transaction, so every committed revision has exactly zero or one live
  483 | slot. There is no interval in which a second client can claim the freed slot
  484 | between those writes.
  485 | 
  486 | Additional rules:
  487 | 
  488 | - Only open/draft direct tasks may receive a new live assignment.
  489 | - Starting a cycle transitions all of its `planned` assignments to
  490 |   `committed` in the same cycle-start transaction after revalidation. Any
  491 |   invalid assignment rejects the whole start; partial activation is forbidden.
  492 | - `activation_policy` controls the effective availability of a committed
  493 |   assignment, not whether its assignment state is committed. A future
  494 |   activation therefore derives `scheduled` without creating another state.
  495 | - A direct task has at most one live assignment (`planned` or `committed`) in
  496 |   the first release. Historical assignments are retained. Supporting multiple
  497 |   simultaneous delivery commitments later requires an explicit assignment
  498 |   role/capacity contract; it is not inferred from duplicate rows.
  499 | - Assignment does not change `parent_work_id`.
  500 | - Removing or carrying over an assignment does not cancel, close, or reopen
  501 |   the task.
  502 | - Completing a task marks its live assignment `completed` in the same
  503 |   authoritative revision. Cancelling a task requires the assignment to become
  504 |   `removed` in that transaction, with the cancellation operation as reason.
  505 | - Completing or cancelling a cycle is rejected while any live assignment
  506 |   remains. Each unfinished assignment must first be carried over or removed;
  507 |   completed tasks must have `completed` assignments. There is no live slot
  508 |   attached to a terminal cycle and no “keep committed” exception.
  509 | - Cycle scope changes are auditable and visible in cycle reports.
  510 | 
  511 | ### 6.4 Backlog definition
  512 | 
  513 | Backlog has two explicitly named read models:
  514 | 
  515 | ```text
  516 | planning_backlog = draft/open direct task
  517 |                    AND no live assignment
  518 |                    AND matches requested project/milestone/filter scope
  519 | 
  520 | executable_backlog = planning_backlog
  521 |                      AND lifecycle = open
  522 |                      AND canonical status/actor policy says claimable now
  523 | ```
  524 | 
  525 | The cycle execution queue is a separate set: committed tasks in active cycles
  526 | that are claimable now. `work backlog` means planning backlog; `work ready` and
  527 | `next` combine executable backlog with the cycle execution queue under the
  528 | same deterministic ranking and transactional claim recheck. A claimed task is
  529 | not in executable backlog even if it remains unscheduled.
  530 | 
  531 | Backlog is not a lifecycle, status, parent, bucket, or dispatch policy. “In
  532 | planning backlog” is a planning badge; “executable backlog” is a transient
  533 | eligibility result at a revision and `as_of`.
  534 | 
  535 | ## 7. Recurring cycle series and templates
  536 | 
  537 | ### 7.1 Series and immutable template versions
  538 | 
  539 | A recurrence series is the stable user-visible identity. Template versions are
  540 | immutable definitions used to calculate slots; a cycle is a materialized slot:
  541 | 
  542 | ```text
  543 | cycle_series
  544 |   series_id, project_id
  545 |   lifecycle: active | paused | retired
  546 |   name / series_revision
  547 |   next_slot_ordinal
  548 |   created_at / updated_at
  549 | 
  550 | cycle_template_version
  551 |   template_version_id, series_id, version
  552 |   effective_from_slot_ordinal
  553 |   name_pattern / goal_template
  554 |   timezone: canonical IANA zone
  555 |   anchor_local_start
  556 |   frequency: weekly
  557 |   interval_weeks: positive integer
  558 |   weekdays: non-empty validated set
  559 |   end_mode: never | count | until_local_date
  560 |   end_count / end_local_date as required
  561 |   end_semantics: elapsed_duration | local_wall_time
  562 |   duration_seconds: required for elapsed_duration
  563 |   local_end_time / end_day_offset: required for local_wall_time
  564 |   gap_policy: next_valid
  565 |   fold_policy: earlier_offset | later_offset
  566 |   materialize_ahead_count
  567 |   definition_digest / created_at / superseded_at
  568 | ```
  569 | 
  570 | `boreal.recurrence/1` supports weekly recurrence only. Daily, monthly, holiday,
  571 | and business-calendar rules are deferred to later recurrence capability
  572 | versions. Unsupported frequency fields are rejected rather than retained as
  573 | inactive promises. No expression, script, SQL predicate, or executable
  574 | condition language is accepted.
  575 | 
  576 | Series transitions are `active -> paused`, `paused -> active`, and
  577 | `active|paused -> retired`; `retired` is terminal. Only an active series may
  578 | allocate/materialize new slots. Pausing or retiring does not alter materialized
  579 | cycles. A template version cannot be updated or deleted after insertion.
  580 | Version 1 starts at slot ordinal zero. Each later version has a unique,
  581 | strictly increasing `effective_from_slot_ordinal`; the applicable version is
  582 | the greatest boundary not exceeding the requested ordinal. Its
  583 | `anchor_local_start` is the nominal start of that boundary slot, not a mutable
  584 | series-wide anchor.
  585 | 
  586 | ### 7.2 Slot identity, materialization, and reconciliation
  587 | 
  588 | Each logical occurrence has a monotonically allocated `slot_ordinal` within
  589 | its series and a version-independent key:
  590 | 
  591 | ```text
  592 | slot_key = sha256("boreal.cycle-slot/1\n" + series_id + "\n" + slot_ordinal)
  593 | ```
  594 | 
  595 | The cycle stores `series_id`, `slot_ordinal`, `slot_key`, and the immutable
  596 | `template_version_id` that resolved its nominal and UTC times. The database
  597 | enforces unique `(series_id, slot_ordinal)` and `(series_id, slot_key)`. A
  598 | template edit cannot generate a second identity for an existing slot.
  599 | 
  600 | Within a template version, weekly candidates are enumerated in increasing
  601 | local date/time order. Week blocks begin on ISO Monday in the template
  602 | timezone; block zero contains `anchor_local_start`, and included blocks are
  603 | `0, interval_weeks, 2*interval_weeks, ...`. Each included block emits the
  604 | configured weekdays at the anchor's local time, excluding candidates before
  605 | the boundary anchor. The anchor weekday MUST be in `weekdays`, so the boundary
  606 | slot is deterministic. `end_count` is a positive exclusive upper bound on
  607 | series ordinal (`slot_ordinal < end_count`) and cannot be revised below an
  608 | allocated ordinal; `until_local_date` is inclusive as defined below.
  609 | 
  610 | - Same operation, slot key, and canonical payload replays the existing cycle.
  611 | - Same operation or slot key with different semantic payload conflicts unless
  612 |   it is an approved reconciliation operation described below.
  613 | - Slot allocation and cycle insertion commit atomically against the expected
  614 |   series revision and template digest. Calculation may happen outside the
  615 |   transaction.
  616 | - A rolling horizon does not imply the recurrence ended, and duplicate timer
  617 |   delivery or restart cannot duplicate a slot.
  618 | 
  619 | A template change creates a new immutable version with an explicit
  620 | `effective_from_slot_ordinal`. Reconciliation compares already materialized
  621 | future cycles against that boundary and emits a digest-bound plan containing
  622 | one action per affected slot: `keep_existing` or `reschedule_planned`. A cycle
  623 | may be rescheduled in place only while it is planned, has no committed
  624 | assignment, no attempt/proof history, and no prior start. The event preserves
  625 | the old resolved values and template version in audit. Active, completed,
  626 | cancelled, or otherwise history-bearing cycles are always `keep_existing`;
  627 | the new version begins at the next eligible ordinal. Applying reconciliation
  628 | requires the expected series revision, old/new definition digests, and exact
  629 | plan digest. Reapplication replays; drift conflicts.
  630 | 
  631 | ### 7.3 Timezone, end semantics, DST, and exact boundaries
  632 | 
  633 | - Recurrence is calculated as local wall time in the stored IANA timezone,
  634 |   never by repeatedly adding UTC seconds.
  635 | - `elapsed_duration` resolves the start once and sets
  636 |   `scheduled_end_at = scheduled_start_at + duration_seconds`; wall-clock end
  637 |   may shift across DST.
  638 | - `local_wall_time` resolves start and end independently from
  639 |   `local_end_time` and non-negative `end_day_offset`; both use the stored
  640 |   gap/fold policies. The resolved end MUST be after the resolved start.
  641 | - For a spring-forward gap, `next_valid` chooses the earliest valid local
  642 |   instant after the gap. For a fall-back fold, `earlier_offset` selects the
  643 |   earlier UTC instant and `later_offset` the later UTC instant. Nominal local
  644 |   value, selected offset, resolved instant, policy, and tzdb identity are all
  645 |   persisted.
  646 | - Cycle intervals are half-open: `[scheduled_start_at, scheduled_end_at)`.
  647 |   `start_due` is true at `as_of >= scheduled_start_at`; `end_due` is true at
  648 |   `as_of >= scheduled_end_at`. An occurrence with `until_local_date` includes
  649 |   slots whose nominal local start date is equal to that date. `count` counts
  650 |   allocated slots beginning at ordinal zero.
  651 | - A later tzdb update never rewrites an existing cycle. It may produce a
  652 |   reconciliation finding for unmaterialized slots only.
  653 | 
  654 | ## 8. Conditions, holds, and time
  655 | 
  656 | There is deliberately no generic `condition_json`, expression evaluator, or
  657 | arbitrary executable DSL. Eligibility is the conjunction of typed canonical
  658 | inputs owned by their domain modules:
  659 | 
  660 | | Input | Canonical representation | Effect |
  661 | | --- | --- | --- |
  662 | | Publication | Work lifecycle | Draft is not dispatchable. |
  663 | | Prerequisite | Direct-task dependency edge | Unsatisfied prerequisite yields `queued`. |
  664 | | Intervention | `work_hold` with reason, owner, lifecycle | Active hard hold yields `blocked`. |
  665 | | Dispatch | `automatic`, `operator_only`, `paused` | Controls who may claim or whether dispatch is paused. |
  666 | | Planning availability | `work_schedule.not_before_at` | Future availability yields `scheduled`. |
  667 | | Cycle availability | Assignment activation policy and resolved activation instant | Future cycle activation yields `scheduled`. |
  668 | | Retry | `retry_not_before` | Recoverable execution yields `retry_wait`. |
  669 | | Ownership | Current fenced attempt and clocks | Produces claimed/in-progress/expiry states. |
  670 | | Acceptance | Versioned gates and current proof | Produces verification/review/complete states. |
  671 | | Product deadline | `due_at` | Adds `overdue`; does not block or terminate by itself. |
  672 | 
  673 | New condition types require a versioned Rust domain type, persisted contract,
  674 | reason code, evaluator branch, authorization rule, protocol fixture, migration
  675 | disposition, and negative tests. A JSON blob alone is not a condition.
  676 | 
  677 | Hard holds SHOULD include stable kinds such as `operator_decision_required`,
  678 | `reconciliation_required`, `integrity_failure`, `permission_required`, and
  679 | `unsafe_environment`, plus structured references and human detail. Resolving a
  680 | hold is reason-coded and audited; deletion is not resolution.
  681 | 
  682 | All operational instants are canonical UTC timestamps from the authoritative
  683 | service/store clock. Local date/time is persisted only where recurrence intent
  684 | requires it. Time meanings remain distinct:
  685 | 
  686 | - `not_before_at`: work availability gate;
  687 | - cycle scheduled start/end: delivery plan;
  688 | - `due_at`: target deadline and overdue badge;
  689 | - `retry_not_before`: execution backoff;
  690 | - lease deadline: renewable ownership;
  691 | - max attempt deadline: immutable execution budget;
  692 | - `revisit_at`: intake attention time.
  693 | 
  694 | Boundary comparisons are exact and shared by domain, store, service, and
  695 | clients:
  696 | 
  697 | | Field | Becomes effective when | Equality behavior |
  698 | | --- | --- | --- |
  699 | | `not_before_at` | `as_of >= not_before_at` | Claim may become eligible at equality. |
  700 | | assignment `activation_at` | `as_of >= activation_at` | Scheduling block clears at equality. |
  701 | | `retry_not_before` | `as_of >= retry_not_before` | Retry wait clears at equality. |
  702 | | `due_at` | `as_of >= due_at` and work is nonterminal | `overdue` begins at equality. |
  703 | | lease/hard deadline | `as_of >= deadline` | Existing expiry policy applies at equality. |
  704 | | `revisit_at` | `as_of >= revisit_at` | `revisit_due` begins at equality. |
  705 | | cycle start/end | half-open interval rules in 7.3 | End is excluded. |
  706 | 
  707 | Null means “no boundary.” Timestamps are normalized to one canonical UTC
  708 | precision before comparison. Every status snapshot reports the earliest future
  709 | boundary that can change its result as `next_status_change_at`; no write is
  710 | required for a time-only derived transition.
  711 | 
  712 | ## 9. Intake, notes, discoveries, questions, and revisit items
  713 | 
  714 | ### 9.1 Intake is operational triage, not work or published memory
  715 | 
  716 | An intake item captures something worth retaining before its final meaning is
  717 | known. Supported initial kinds are:
  718 | 
  719 | - `note`: observation or notation;
  720 | - `discovery`: a finding that may create work or knowledge;
  721 | - `question`: an unresolved question that may need a decision or research;
  722 | - `revisit`: an item intentionally deferred until a date or event.
  723 | 
  724 | Intake buckets are lightweight project organization:
  725 | 
  726 | ```text
  727 | intake_bucket
  728 |   bucket_id, project_id, name
  729 |   lifecycle: active | archived
  730 |   created_at, updated_at
  731 | ```
  732 | 
  733 | An item belongs to zero or one bucket. Tags and saved-filter persistence are
  734 | deferred beyond `boreal.intake/1`; clients may filter existing typed fields
  735 | without storing another taxonomy. A bucket never affects task eligibility and
  736 | is not a work parent.
  737 | 
  738 | ### 9.2 Intake record and lifecycle
  739 | 
  740 | ```text
  741 | intake_item
  742 |   intake_id, project_id
  743 |   bucket_id: optional
  744 |   kind: note | discovery | question | revisit
  745 |   lifecycle: captured | triaged | deferred | resolved | archived
  746 |   title, body or immutable body_ref
  747 |   source_version_id: optional citation/origin
  748 |   captured_by / captured_at
  749 |   triaged_by / triaged_at
  750 |   revisit_at: optional UTC instant
  751 |   resolution_summary: optional
  752 |   intake_revision / content_digest
  753 |   created_at / updated_at
  754 | ```
  755 | 
  756 | Legal transitions:
  757 | 
  758 | ```text
  759 | captured -> triaged | deferred | archived
  760 | triaged  -> deferred | resolved | archived
  761 | deferred -> triaged | resolved | archived
  762 | resolved -> triaged (explicit reopen) | archived
  763 | archived -> triaged (explicit restore)
  764 | ```
  765 | 
  766 | `revisit_at` does not mutate lifecycle. A deferred item whose revisit time has
  767 | arrived derives `revisit_due` and a next triage action. A captured item derives
  768 | `inbox`; a triaged unresolved item derives `attention`; resolved and archived
  769 | are terminal-looking display states but retain provenance.
  770 | 
  771 | ### 9.3 Promotion provenance
  772 | 
  773 | Promotion creates a target through that target's authoritative application
  774 | operation. It uses a typed table with a real foreign key, never a polymorphic
  775 | `target_type/target_id` pair:
  776 | 
  777 | ```text
  778 | intake_work_promotion
  779 |   promotion_id, intake_id, work_id
  780 |   intake_revision, intake_content_digest
  781 |   relation: created | supports
  782 |   operation_id, request_digest, actor_id, created_at
  783 | 
  784 | intake_source_promotion
  785 |   promotion_id, intake_id, source_version_id
  786 |   intake_revision, intake_content_digest
  787 |   captured_bytes_digest
  788 |   relation: captured_from | supports
  789 |   operation_id, request_digest, actor_id, created_at
  790 | 
  791 | intake_memory_draft_promotion
  792 |   promotion_id, intake_id, entry_id, draft_content_digest
  793 |   source_version_id, citation_locator
  794 |   intake_revision, intake_content_digest
  795 |   relation: created | supports
  796 |   operation_id, request_digest, actor_id, created_at
  797 | ```
  798 | 
  799 | - Promotion does not rewrite or delete the intake item.
  800 | - One intake item may support multiple targets.
  801 | - Every promotion binds the exact intake revision and content digest read by
  802 |   the target operation. A stale revision/digest rejects before target creation.
  803 |   Same operation plus the same canonical payload replays; changed target,
  804 |   revision, digest, relation, citation, or content conflicts.
  805 | - Promoting to work creates a normal work item and retains the intake link.
  806 |   Target lifecycle defaults to `draft`; an explicit `open` request runs the
  807 |   ordinary publish validation. Promotion never makes work ready by assertion.
  808 | - Promoting to memory creates a cited memory draft, never accepted/published
  809 |   memory directly. The memory crate requires citations, so a memory promotion
  810 |   MUST reference a validated immutable source version and locator. If intake
  811 |   has no source, the operation first captures an immutable source version,
  812 |   then creates the memory draft citing it, with both typed promotion rows
  813 |   committed or reconciled under one durable outer operation.
  814 | - Promoting bytes/text to source captures a normal immutable source version;
  815 |   digest, availability, and parser/index outcome remain source-engine facts.
  816 | - Intake text remains untrusted data and cannot mint commands, witnessed
  817 |   attestation, gate satisfaction, or actor authority.
  818 | 
  819 | Promotion rows are append-only. Retraction or correction is a new audited
  820 | provenance fact and target-domain operation; it does not delete the old link.
  821 | Decision promotion is deferred because the current v2 domain has no canonical
  822 | decision entity or lifecycle. It MUST NOT be represented as an unchecked ID
  823 | until a separately versioned decision capability exists.
  824 | 
  825 | ## 10. Persisted lifecycle versus derived status
  826 | 
  827 | Each entity has its own lifecycle and status vocabulary. Clients MUST NOT put
  828 | all rows into one universal status enum.
  829 | 
  830 | ### 10.1 Direct work
  831 | 
  832 | Persisted lifecycle remains `draft | open | closed | cancelled`.
  833 | 
  834 | Derived primary status becomes:
  835 | 
  836 | ```text
  837 | draft | queued | scheduled | ready | claimed | in_progress |
  838 | needs_verification | awaiting_review | complete | blocked | paused |
  839 | retry_wait | expired_review | closed | cancelled
  840 | ```
  841 | 
  842 | `overdue`, `operator_only`, `backlog`, and cycle membership are badges/reasons,
  843 | not primary status.
  844 | 
  845 | Precedence is:
  846 | 
  847 | 1. terminal `closed` or `cancelled`;
  848 | 2. expiry review or hard intervention `expired_review` / `blocked`;
  849 | 3. `draft`;
  850 | 4. current attempt and proof state;
  851 | 5. `paused` or `retry_wait`;
  852 | 6. `scheduled` for a future effective activation instant;
  853 | 7. `queued` for normal prerequisites;
  854 | 8. `ready` when actor/policy eligibility allows claim.
  855 | 
  856 | All applicable reason codes are returned even when one primary status wins.
  857 | A scheduled task may also name open prerequisites; a blocked task may also be
  858 | overdue.
  859 | 
  860 | ### 10.2 Container work
  861 | 
  862 | Persisted lifecycle is the same, but derived status is:
  863 | 
  864 | ```text
  865 | draft | open | attention | closing | closed | cancelled
  866 | ```
  867 | 
  868 | - `open`: descendants remain and no attention condition dominates.
  869 | - `attention`: blocked, expired-review, failed review, unresolved disposition,
  870 |   or integrity conditions need intervention.
  871 | - `closing`: descendant dispositions are complete but container summary or
  872 |   allowed closeout gates remain.
  873 | 
  874 | Container read models include exact descendant counts by direct-work status.
  875 | They never report claimable.
  876 | 
  877 | ### 10.3 Cycle series, template version, and cycle instance
  878 | 
  879 | Series lifecycle is `active | paused | retired`. Template versions are
  880 | immutable and have no independent lifecycle. Derived series labels may include
  881 | `materialization_due` or `exhausted`; they are scheduler guidance, not writes.
  882 | 
  883 | Cycle lifecycle is `planned | active | completed | cancelled`. Derived badges
  884 | include `upcoming`, `start_due`, `end_due`, `scope_changed`, and
  885 | `incomplete_scope`. Date passage alone does not claim lifecycle changed.
  886 | 
  887 | ### 10.4 Intake
  888 | 
  889 | Persisted lifecycle is `captured | triaged | deferred | resolved | archived`.
  890 | Derived display is `inbox | attention | waiting | revisit_due | resolved |
  891 | archived` based on lifecycle and `revisit_at`.
  892 | 
  893 | ### 10.5 Source, memory, and evidence
  894 | 
  895 | - The current source crate represents a captured immutable `SourceVersion`
  896 |   with `Availability = available | missing | corrupt`. Parse/index results use
  897 |   `ParseState = indexed | failed`. It does not currently persist separate
  898 |   `registered`, `captured`, or `extracted` lifecycle states, so this contract
  899 |   does not invent them. A future ingestion-job lifecycle requires its own
  900 |   capability and migration.
  901 | - The current memory crate uses draft state
  902 |   `draft | in_review | accepted | rejected | published` and publication state
  903 |   `publishing | published | failed | conflict`. Publication requires an
  904 |   accepted, cited draft and records the Git-backed publication result. Intake
  905 |   integration calls those existing boundaries; it does not relabel them.
  906 | - Evidence receipts are immutable facts with an immutable result. Every proof
  907 |   fact and evaluation obeys the attempt/container XOR in 5.5. Historical
  908 |   passed evidence stays visible but cannot silently satisfy a new context.
  909 | 
  910 | ## 11. Relationship and cardinality contract
  911 | 
  912 | | From | Relationship | To | Cardinality / constraint |
  913 | | --- | --- | --- | --- |
  914 | | project | contains | work | 1:N; same namespace |
  915 | | work container | decomposes into | work | 1:N children; each child 0..1 parent; acyclic |
  916 | | direct task | depends on | direct task | M:N DAG; same project; typed satisfaction policy |
  917 | | project | owns | cycle series | 1:N |
  918 | | cycle series | versions | cycle template version | 1:N immutable versions |
  919 | | cycle series slot | materializes | cycle | 1:0..1; stable key and ordinal |
  920 | | cycle | advances | milestone | M:N `cycle_goal` links |
  921 | | cycle | schedules | direct task | M:N historical assignment; at most one live planned/committed assignment per task initially |
  922 | | project | owns | intake bucket | 1:N |
  923 | | intake bucket | groups | intake item | 1:N; item 0..1 bucket |
  924 | | intake item | promotes/supports | work/source/memory draft | 1:N target-specific typed tables |
  925 | | direct task | has | attempt | 1:N history; at most one current |
  926 | | attempt or container closeout | produces | eligible proof | XOR context; 1:N immutable or superseding history as defined by proof contract |
  927 | | source version | cited by | work/intake/memory/evidence | M:N typed references; immutable target version |
  928 | | memory entry | relates to | work/intake | M:N, informational unless an explicit gate references it |
  929 | 
  930 | Cross-project links are rejected in the first release. Future cross-project
  931 | sharing requires explicit import/grant semantics and preserved provenance.
  932 | 
  933 | ### 11.1 Minimum store constraints and indexes
  934 | 
  935 | The schema implementation must enforce, rather than merely document:
  936 | 
  937 | - unique `(project_id, work_id)`, `(project_id, cycle_id)`, and
  938 |   `(project_id, intake_id)` identities;
  939 | - project-local composite foreign keys for every parent, dependency,
  940 |   assignment, bucket, and promotion reference;
  941 | - unique `(series_id, version)`, `(series_id, slot_ordinal)`, and
  942 |   `(series_id, slot_key)`;
  943 | - one live `planned`/`committed` assignment per direct task through a partial
  944 |   unique index;
  945 | - one optional primary cycle focus per project;
  946 | - one current attempt per direct task and one current execution per session;
  947 | - direct-task-only dependency endpoints, enforced in the committing
  948 |   transaction as well as application validation;
  949 | - proof-context XOR shape checks and authoritative context validation at proof
  950 |   acceptance/finalization;
  951 | - append-only receipt/audit/promotion/disposition facts and explicit
  952 |   supersession rather than destructive update;
  953 | - permanent decode/read support for compatibility `WorkKind::Sprint` rows,
  954 |   while rejecting new/edited sprint-kind writes;
  955 | - indexes for parent children, prerequisite/dependent traversal, cycle scope,
  956 |   backlog lookup, active holds, `not_before_at`, `retry_not_before`, cycle
  957 |   start/end, template materialization horizon, and `revisit_at`;
  958 | - operation identity plus canonical request digest checks before every replay.
  959 | 
  960 | Every successful mutation commits its canonical rows, audit event, operation
  961 | result, and project revision in one short transaction. Recurrence calculation,
  962 | source capture, process execution, Git work, rendering, and large serialization
  963 | remain outside that transaction.
  964 | 
  965 | ## 12. Command, API, and TUI implications
  966 | 
  967 | ### 12.1 Canonical command families
  968 | 
  969 | ```text
  970 | project init|show|configure|archive|restore
  971 | 
  972 | work create --kind milestone|task --mode container|direct [--parent ...]
  973 | work edit|show|list|publish|cancel|reopen
  974 | work schedule set|clear
  975 | work backlog
  976 | work ready|next
  977 | work hold add|resolve
  978 | dep add|remove|tree|cycles
  979 | 
  980 | cycle series create|show|list|pause|resume|retire
  981 | cycle template create-version|show|list|materialize|reconcile
  982 | cycle create|show|list|start|complete|cancel
  983 | cycle goal add|remove
  984 | cycle assign|remove|carry-over
  985 | cycle focus set|clear
  986 | 
  987 | intake bucket create|list|archive|restore
  988 | intake add|show|list|triage|defer|resolve|archive|restore
  989 | intake promote-to-work|promote-to-source|promote-to-memory-draft
  990 | 
  991 | source add|show|list|verify
  992 | memory draft create|review|publish|show|search
  993 | evidence run|add|show|list
  994 | ```
  995 | 
  996 | `sprint ...` MAY remain a documented alias for `cycle ...`. It must use the
  997 | same registry entry, request schema, application operation, and response—not a
  998 | second implementation.
  999 | 
 1000 | Every mutation carries a fresh logical operation ID, canonical request digest,
 1001 | actor/session context, expected revision where applicable, and exact typed
 1002 | result. Unknown outcomes require operation readback. Lists are bounded with
 1003 | stable cursors; exact show operations never scan a presentation page.
 1004 | 
 1005 | ### 12.2 Service API
 1006 | 
 1007 | The versioned Rust service is the only operational API for CLI/TUI shared use.
 1008 | It needs typed routes for project/work/cycle/intake mutations and bounded
 1009 | read models. A route is not advertised as supported until the Rust handler,
 1010 | application use case, store transaction, protocol fixture, and actual client
 1011 | integration test all exist.
 1012 | 
 1013 | Capability discovery reports work/status, cycle, recurrence, and intake
 1014 | versions separately. Clients gate controls by the specific capability and
 1015 | route. A server with `boreal.cycle/1` but no `boreal.recurrence/1` can manage
 1016 | manual cycles without showing template controls; intake support is similarly
 1017 | independent.
 1018 | 
 1019 | The current TUI and Rust service now have `create_project` and `create_work`
 1020 | routes. They remain work-model/2 behavior until the schema-3 DTO, transaction,
 1021 | capability advertisement, and cross-language fixtures land together. Clients
 1022 | MUST NOT send `WorkKind::Sprint` or schema-3 fields merely because the route
 1023 | name exists, and servers MUST reject a requested capability version they do
 1024 | not implement.
 1025 | 
 1026 | ### 12.3 TUI and dashboard
 1027 | 
 1028 | The TUI should expose separate views rather than flattening everything into
 1029 | one work list:
 1030 | 
 1031 | - **Now:** current attempts, verification/review gaps, due attention, and safe
 1032 |   next actions.
 1033 | - **Roadmap:** milestone/task decomposition and rollups.
 1034 | - **Cycles:** planned/active/completed sprint instances, recurring templates,
 1035 |   scope changes, and carry-over.
 1036 | - **Backlog:** unscheduled direct work, filterable by milestone, priority,
 1037 |   schedule, hold, and status.
 1038 | - **Inbox:** intake buckets, triage, questions, discoveries, and revisit-due.
 1039 | - **Knowledge:** source versions, draft/published memory, citations, and lag.
 1040 | - **Proof:** attempts, gates, receipts, reviews, summaries, and immutable
 1041 |   history.
 1042 | - **Activity/health:** revisioned audit and service/store health.
 1043 | 
 1044 | `bwrk dashboard` is the canonical one-command user experience. The current
 1045 | launcher already owns project discovery, private service startup, TUI launch,
 1046 | signal forwarding, exit status, and cleanup. The remaining requirement is to
 1047 | prove packaged/release lookup, supported-platform behavior, and all mounted
 1048 | actions through end-to-end fixtures. The TUI still uses the versioned Rust API
 1049 | internally; normal users do not manually run a server or socket.
 1050 | 
 1051 | UI badges MUST distinguish decomposition parent, cycle assignment, backlog,
 1052 | work status, due state, and attempt ownership. Dragging/reordering within a
 1053 | cycle edits assignment/order only; it must not silently reparent work or
 1054 | change lifecycle.
 1055 | 
 1056 | ## 13. Current-v2 schema migration and later legacy import
 1057 | 
 1058 | Two operations are deliberately separate:
 1059 | 
 1060 | 1. Phase 1 performs an additive, in-place SQLite schema `2 -> 3` migration for
 1061 |    an existing v2 database.
 1062 | 2. Phase 6 imports a v1 export through a separately versioned staging format.
 1063 | 
 1064 | Neither operation may masquerade as the other. Both are previewable,
 1065 | transactional at each canonical commit, idempotent, and reversible through a
 1066 | verified pre-operation backup. Failed evidence, attempts, audit provenance,
 1067 | and ambiguous records are preserved.
 1068 | 
 1069 | ### 13.1 Additive v2 schema 2 -> 3 migration (Phase 1)
 1070 | 
 1071 | Before any mutation, scan all attempts. If any attempt is live in `claimed`,
 1072 | `accepted`, `running`, `verifying`, or `expiry_pending`, migration stops with
 1073 | a typed `live_attempt_blocks_migration` finding that identifies its work
 1074 | (including compatibility sprint subjects). The operator must
 1075 | finish/release/reconcile it under schema 2 and rerun. The migrator never moves,
 1076 | cancels, fences, or relabels a live attempt.
 1077 | 
 1078 | The atomic migration then:
 1079 | 
 1080 | 1. adds project metadata, execution mode/schedule, proof-context,
 1081 |    disposition, cycle, series/template-version, goal, assignment, intake,
 1082 |    typed promotion, and required index/trigger tables;
 1083 | 2. initializes existing milestones as `container` and existing tasks as
 1084 |    `direct` only when structural/proof checks permit; ambiguous task groups
 1085 |    become blocking findings rather than guessed modes;
 1086 | 3. keeps every `WorkKind::Sprint` row, enum decoder, exact read, historical
 1087 |    relation, and renderer indefinitely as compatibility-only, while triggers
 1088 |    and application rules reject new sprint rows and semantic edits;
 1089 | 4. creates one deterministic cycle for each compatibility sprint row and
 1090 |    records `legacy_work_id` provenance without changing the legacy subject;
 1091 | 5. links the cycle to the former milestone through `cycle_goal` and, for each
 1092 |    child direct task, moves decomposition to the former milestone and creates
 1093 |    the corresponding cycle assignment in the same migration unit;
 1094 | 6. leaves sprint-attached attempts/proof attached to the compatibility row;
 1095 | 7. converts only direct-task-to-direct-task dependency edges. Any edge with a
 1096 |    container/sprint endpoint is retained as historical compatibility data and
 1097 |    emitted as a blocking replacement/disposition finding; and
 1098 | 8. validates every row/index/trigger, recomputes projections, then sets
 1099 |    `user_version = 3` last.
 1100 | 
 1101 | Compatibility sprint rows are not scheduled for deletion. Backup/restore,
 1102 | export, operation readback, and historical UI must continue to decode them.
 1103 | 
 1104 | ### 13.2 Compatibility lifecycle mapping
 1105 | 
 1106 | | Old sprint work lifecycle | Cycle mapping | Required caution |
 1107 | | --- | --- | --- |
 1108 | | draft | planned | No task is activated merely by conversion. |
 1109 | | open | planned | Schema 2 has no authoritative cycle-start fact; activity is not guessed. |
 1110 | | closed | completed | This preserves scheduling history only and transfers no gate/proof satisfaction. |
 1111 | | cancelled | cancelled | Child tasks remain open unless separately cancelled. |
 1112 | 
 1113 | Milestone/task lifecycle remains unchanged in a current-v2 schema upgrade.
 1114 | Legacy-v1 values such as `complete`, `verified`, or `archived` are handled only
 1115 | by the later conservative import policy in [STATUS_MODEL.md](../STATUS_MODEL.md)
 1116 | and are never assumed equivalent to trusted closeout.
 1117 | 
 1118 | Assignment backfill is also deterministic. A task under a draft/open sprint
 1119 | gets a `planned` assignment. Under a closed sprint, a closed task gets
 1120 | `completed`; every other task gets `removed` with
 1121 | `legacy_cycle_ended_unfinished`. Under a cancelled sprint every task gets
 1122 | `removed` with `legacy_cycle_cancelled`. Thus terminal cycles never gain live
 1123 | slots, and no task lifecycle or proof eligibility is inferred from the sprint.
 1124 | 
 1125 | ### 13.3 Difficult references
 1126 | 
 1127 | - Direct-task-to-direct-task dependencies migrate unchanged after project,
 1128 |   kind, mode, and DAG validation.
 1129 | - Dependencies whose endpoint is a milestone, container task, or sprint row
 1130 |   are never activated in the new dependency graph. They become explicit
 1131 |   findings requiring an operator-selected direct-task replacement or
 1132 |   historical-only retention.
 1133 | - Attempts, receipts, reviews, summaries, or close intents attached directly
 1134 |   to a sprint row must remain inspectable. During compatibility they continue
 1135 |   to reference the read-only legacy subject. They are not reassigned to a
 1136 |   cycle or child task because that would falsify subject identity.
 1137 | - An existing direct-task receipt receives an attempt context only when its
 1138 |   exact attempt/fence and every required identity can be reconstructed. All
 1139 |   other existing receipt/container/sprint proof remains historical and
 1140 |   non-satisfying until a new valid context is evaluated. Cached gate state is
 1141 |   discarded and rebuilt; migration never synthesizes container closeout proof.
 1142 | - Missing timezone defaults to `UTC` only in a preview. Apply requires explicit
 1143 |   confirmation or a recorded migration policy; recurrence is never inferred
 1144 |   from similarly named sprint rows.
 1145 | - No old sprint sequence is assumed recurring. A recurring template is created
 1146 |   only from an explicit legacy recurrence record or operator-approved plan.
 1147 | 
 1148 | ### 13.4 Later v1 import (Phase 6)
 1149 | 
 1150 | Legacy v1 import uses an immutable export, a versioned staging document, and a
 1151 | loss/disposition ledger. It may target an empty schema-3 database only after
 1152 | the native schema migration and public workflow are stable. It never runs as
 1153 | part of database open. The report includes before/after counts, every mapped
 1154 | ID, parent/cycle/assignment mapping, unsupported dependency endpoint,
 1155 | historical proof subject, timezone choice, source/memory reference, and
 1156 | canonical document digest. Same import operation plus same document replays;
 1157 | changed content conflicts. Rollback restores the verified pre-import backup
 1158 | and does not mutate the v1 source.
 1159 | 
 1160 | ## 14. Invariants and negative cases
 1161 | 
 1162 | ### 14.1 Core invariants
 1163 | 
 1164 | - A project ID scopes every live operational reference.
 1165 | - Persisted lifecycle is small; displayed status is derived at one revision
 1166 |   and `as_of`.
 1167 | - Direct work is the only claimable work. Containers, cycles, intake, source,
 1168 |   and memory cannot acquire an execution attempt.
 1169 | - Decomposition tree, dependency DAG, cycle assignment, and provenance links
 1170 |   are never inferred from one another.
 1171 | - Dependency edges connect direct tasks only; containers can never wait in or
 1172 |   satisfy that graph.
 1173 | - A direct task may exist without a parent and without a cycle.
 1174 | - Moving work between cycles does not change decomposition or acceptance.
 1175 | - Closing/cancelling a cycle does not close/cancel its tasks.
 1176 | - Due dates do not block claims; `not_before` and typed activation policy do.
 1177 | - Time passage is effective in reads but canonical lifecycle mutations remain
 1178 |   explicit audited operations.
 1179 | - Historical assignments, attempts, receipts, and failed outcomes are retained.
 1180 | - Compatibility sprint rows and decoders are retained indefinitely; they are
 1181 |   historical subjects, not new-write cycle substitutes.
 1182 | - Gate satisfaction is derived from eligible current proof, never from a
 1183 |   durable boolean detached from proof context.
 1184 | - Attempt proof and container closeout proof are mutually exclusive contexts;
 1185 |   proof can never float between them.
 1186 | - Intake/source/memory text is data, never command authority.
 1187 | - Recurrence materialization is deterministic and duplicate-safe across
 1188 |   retries, restart, DST, and timer duplication.
 1189 | 
 1190 | ### 14.2 Required rejected cases
 1191 | 
 1192 | The implementation MUST reject or return a typed finding for:
 1193 | 
 1194 | - cross-project parent, dependency, cycle assignment, source, promotion, or
 1195 |   proof reference;
 1196 | - a parent cycle, bucket, intake item, source, or memory entry;
 1197 | - hierarchy or dependency cycles;
 1198 | - any new dependency whose prerequisite or dependent is not a direct task;
 1199 | - a direct work item with children;
 1200 | - changing `execution_mode` after any proof history or while incompatible
 1201 |   structure/assignment/dependencies exist;
 1202 | - an attempt against a container, cycle, intake item, or closed/cancelled task;
 1203 | - a second live planned/committed cycle assignment for one task;
 1204 | - assignment of closed/cancelled work without an explicit historical import
 1205 |   mode;
 1206 | - cycle completion/cancellation with any live assignment;
 1207 | - carry-over with a different task, terminal target cycle, duplicate successor,
 1208 |   or second live slot;
 1209 | - reuse of a series slot key/ordinal with different materialized fields outside
 1210 |   an exact approved reconciliation;
 1211 | - recurrence interval zero, invalid timezone, unsupported frequency, invalid
 1212 |   weekday set, invalid end semantics, or missing end-mode fields;
 1213 | - silently normalizing a DST gap/fold without persisting the selected policy
 1214 |   and resolved instant;
 1215 | - template edits that rewrite active/completed cycles;
 1216 | - intake promotion with changed payload under the same operation ID;
 1217 | - intake promotion against a stale revision/content digest or a polymorphic
 1218 |   unchecked target ID;
 1219 | - memory-draft promotion without a validated source-version citation;
 1220 | - promotion directly to published memory or witnessed evidence;
 1221 | - a note/discovery/question satisfying a work gate by label or prose;
 1222 | - an arbitrary JSON/script/SQL condition presented as eligibility policy;
 1223 | - stale cycle, work, intake, proof, or project revisions used as mutation
 1224 |   authorization;
 1225 | - a TUI action whose service route is absent;
 1226 | - schema 2 -> 3 migration while any work has a live attempt;
 1227 | - migration that drops sprint-attached attempts/evidence or treats ambiguous
 1228 |   completion as trusted closeout.
 1229 | 
 1230 | ## 15. Implementation phases and acceptance tests
 1231 | 
 1232 | ### Phase 0 — contract and decision freeze
 1233 | 
 1234 | Deliver:
 1235 | 
 1236 | - freeze this contract's sprint-to-cycle decision and later mirror it into the
 1237 |   project decision ledger during implementation;
 1238 | - version work/status, cycle, recurrence, intake, protocol, and legacy-import
 1239 |   contracts independently;
 1240 | - add golden entity, relationship, status, recurrence, and migration fixtures;
 1241 | - define exact DTOs, errors, reason codes, event types, and command registry.
 1242 | 
 1243 | Acceptance:
 1244 | 
 1245 | - fixtures reject every negative case above;
 1246 | - the same entity/revision/clock produces identical Rust, protocol, CLI, and
 1247 |   TUI-decoder results;
 1248 | - no current adapter advertises a missing route.
 1249 | 
 1250 | ### Phase 1 — additive schema 2 -> 3, project, and decomposition kernel
 1251 | 
 1252 | Deliver:
 1253 | 
 1254 | - transactional additive schema `2 -> 3`, migration preflight/rollback,
 1255 |   permanent sprint compatibility reads, project metadata/workspace binding,
 1256 |   work execution mode, flexible parent rules, work schedule, proof-context XOR,
 1257 |   append-only container dispositions, and pure direct/container evaluators;
 1258 | - exact indexed reads and revisioned rollups.
 1259 | 
 1260 | Acceptance:
 1261 | 
 1262 | - create root backlog task, milestone, nested milestone, direct task, and
 1263 |   container task through public application routes;
 1264 | - reject direct-with-child, parent cycle, cross-project parent, retype with
 1265 |   children/proof history, container dependency endpoints, and all hierarchy or
 1266 |   direct-task dependency cycles;
 1267 | - migration with any live attempt performs zero writes; after explicit
 1268 |   attempt resolution, rerun reaches schema 3 and retains the sprint subject;
 1269 | - old attempt proof cannot satisfy a new attempt; attempt proof cannot satisfy
 1270 |   a container; descendant/disposition drift invalidates container closeout;
 1271 | - priority, holds, schedules, timezone, and project metadata survive restart;
 1272 | - container never appears claimable.
 1273 | 
 1274 | ### Phase 2 — cycle and backlog kernel
 1275 | 
 1276 | Deliver:
 1277 | 
 1278 | - cycle, cycle-goal, assignment, explicit focus, lifecycle operations, backlog
 1279 |   query, carry-over/disposition transaction, and status integration.
 1280 | 
 1281 | Acceptance:
 1282 | 
 1283 | - one milestone spans three cycles without task reparenting;
 1284 | - one cycle schedules tasks from two milestones;
 1285 | - unscheduled task appears in backlog and remains fully status-evaluable;
 1286 | - completing/cancelling a cycle leaves tasks unchanged;
 1287 | - completing/cancelling a cycle with live scope is rejected;
 1288 | - remove returns a task to planning backlog; carry-over links predecessor and
 1289 |   successor, retains both histories, and has exactly one live slot;
 1290 | - planning backlog, executable backlog, and active-cycle execution queue return
 1291 |   distinct expected sets from the same snapshot;
 1292 | - two concurrent assignments for one task produce one winner.
 1293 | 
 1294 | ### Phase 3 — time and recurrence
 1295 | 
 1296 | Deliver:
 1297 | 
 1298 | - recurrence series, immutable weekly template versions, stable slot allocator,
 1299 |   deterministic materializer, timezone/DST/end-semantics handling, schedule
 1300 |   timers/notifications, and digest-bound reconciliation plans.
 1301 | 
 1302 | Acceptance:
 1303 | 
 1304 | - weekly and biweekly fixtures materialize exactly once across 100 duplicate
 1305 |   calls and service restart;
 1306 | - spring gap, fall fold, elapsed-duration versus local-wall-time, exact
 1307 |   half-open boundary, tzdb-change, and template-version cases preserve nominal
 1308 |   and resolved time;
 1309 | - changing a template preserves slot identity and reconciles only eligible
 1310 |   planned cycles under the expected series/plan digests;
 1311 | - editing a template never rewrites started/completed cycles;
 1312 | - time-only status changes refresh without a project write and report
 1313 |   `next_status_change_at`.
 1314 | 
 1315 | ### Phase 4 — intake and promotion
 1316 | 
 1317 | Deliver:
 1318 | 
 1319 | - bucket/item lifecycle, revisit scheduler, three typed promotion tables,
 1320 |   source and cited-memory-draft adapters, bounded list/detail/search, and
 1321 |   revision/digest provenance readback.
 1322 | 
 1323 | Acceptance:
 1324 | 
 1325 | - capture and triage all four item kinds;
 1326 | - revisit becomes due at equality without mutating lifecycle;
 1327 | - promote one discovery to both a task and cited memory draft while preserving
 1328 |   one immutable origin;
 1329 | - duplicate promotion replays; changed/stale revision or digest conflicts;
 1330 | - intake without a source first captures a source version and the resulting
 1331 |   memory draft cites that exact version; no direct memory publication occurs;
 1332 | - raw intake cannot publish memory, satisfy evidence, or execute text.
 1333 | 
 1334 | ### Phase 5 — service, CLI, TUI, and dashboard
 1335 | 
 1336 | Deliver:
 1337 | 
 1338 | - registry-driven routes and clients for every mounted action;
 1339 | - release-package and end-to-end hardening of the existing one-command managed
 1340 |   `bwrk dashboard` launcher;
 1341 | - Now/Roadmap/Cycles/Backlog/Inbox/Knowledge/Proof/Activity views;
 1342 | - operation readback, event/deadline refresh, bounded detail/history.
 1343 | 
 1344 | Acceptance:
 1345 | 
 1346 | - from an empty project, one terminal can initialize, open dashboard, create a
 1347 |   milestone and backlog task, create/assign/start a cycle, capture/promote a
 1348 |   discovery, claim/verify/close the task, and inspect proof after restart;
 1349 | - actual Rust service and actual built TypeScript client are used; no direct
 1350 |   SQL, mocked route, per-refresh CLI, manually managed server, or second
 1351 |   terminal;
 1352 | - Ctrl-C/SIGTERM restores the terminal and leaves no socket, timer, service,
 1353 |   or child process;
 1354 | - unsupported capabilities are disabled with typed reasons.
 1355 | 
 1356 | ### Phase 6 — legacy v1 import, load, and release proof
 1357 | 
 1358 | Deliver:
 1359 | 
 1360 | - separately versioned v1 staging/import format, loss ledger,
 1361 |   preview/apply/verify/rollback, release identity, backup/restore, and
 1362 |   scale/fault matrix. This phase does not own schema 2 -> 3.
 1363 | 
 1364 | Acceptance:
 1365 | 
 1366 | - representative v1 exports imported into a schema-3 database preserve every
 1367 |   work, parent meaning, cycle scope, dependency, attempt, receipt, summary,
 1368 |   source, memory link, and unsupported finding;
 1369 | - ambiguous sprint activation/closeout and sprint-attached proof require
 1370 |   explicit disposition;
 1371 | - 10,000 work items, many cycle histories, recurring templates, and intake
 1372 |   histories keep routine pages bounded and exact;
 1373 | - concurrent materialization, assignment, claim, promotion, and status reads
 1374 |   preserve uniqueness and revision consistency;
 1375 | - backup/restore retains SQLite, referenced blobs, published memory manifests,
 1376 |   recurrence identities, and migration provenance.
 1377 | 
 1378 | ### Required cross-layer fixture catalog
 1379 | 
 1380 | These fixture names and outcomes are normative; store/application/protocol and
 1381 | real-client suites consume the same semantic cases:
 1382 | 
 1383 | | Fixture | Setup | Required result |
 1384 | | --- | --- | --- |
 1385 | | `proof_attempt_xor_container` | Submit attempt fields plus container closeout ID, then submit neither. | Both requests rejected; no proof/gate projection changes. |
 1386 | | `proof_context_rollover` | Pass on attempt A, release, claim B; separately supersede one container disposition. | A proof is historical only for B; old container closeout becomes ineligible. |
 1387 | | `container_disposition_append_only` | Close one descendant, defer another, then correct defer to replacement. | Original rows remain; one superseding row becomes current; disposition/context digests change; old close evaluation cannot finalize. |
 1388 | | `schema3_live_attempt` | Schema-2 direct task and compatibility sprint each have a running attempt in separate cases. | Migration performs zero writes and reports the exact attempt; rerun after resolution succeeds and the legacy sprint row remains readable. |
 1389 | | `direct_dependency_only` | Try task->milestone, container->task, sprint->task, and direct-task cycle. | All invalid endpoints/cycles reject; no rollup-dependent deadlock can be stored. |
 1390 | | `assignment_carry_over_atomic` | Carry one committed task from active cycle A to planned cycle B; retry and race another assignment. | Linked terminal source + one planned successor; retry replays; racer loses; one live slot. |
 1391 | | `cycle_terminal_requires_empty_live_scope` | Complete/cancel a cycle with planned/committed assignments. | Reject until every assignment is completed, removed, or atomically carried over. |
 1392 | | `recurrence_slot_reconcile` | Materialize slots 0..3, start slot 1, then change timezone/cadence effective at slot 2. | Keys/ordinals remain stable; started/history-bearing slots stay unchanged; eligible planned slots change only under the exact reconciliation digest. |
 1393 | | `dst_and_boundary_matrix` | Gap/fold starts, both end semantics, and equality at all fields in section 8. | Stored nominal/offset/resolution matches policy; all equality outcomes are identical across adapters. |
 1394 | | `intake_typed_promotion` | Promote revision R/digest D to work/source/memory; retry, then edit intake and reuse operation. | Typed FK rows created once; retry replays; stale or changed digest conflicts; memory cites immutable source version. |
 1395 | | `execution_mode_after_history` | Add historical failed receipt/attempt, then change direct to container. | Reject even with no current attempt; history and mode remain unchanged. |
 1396 | | `capability_independence` | Server advertises cycle/1 but not recurrence/1 or intake/1. | Manual cycle controls work; recurrence/intake controls are disabled and no fallback route is attempted. |
 1397 | | `dashboard_actual_transport` | Packaged CLI launches dashboard and actual client against the private service. | One terminal, capability-correct actions, clean signal shutdown, no leftover child/socket. |
 1398 | 
 1399 | ## 16. Parallel implementation ownership
 1400 | 
 1401 | After Phase 0 freezes the shared contract, work may proceed in parallel with
 1402 | exclusive ownership:
 1403 | 
 1404 | | Lane | Exclusive focus | Join dependency |
 1405 | | --- | --- | --- |
 1406 | | A | Domain types/evaluators for work, containers, time | Shared contract frozen |
 1407 | | B | Cycle/recurrence pure engine and clock fixtures | Shared recurrence DTO frozen |
 1408 | | C | Intake/promotion pure engine and source/memory seams | Shared intake/provenance DTO frozen |
 1409 | | D | Protocol/client fixture generation and command registry | Domain DTOs agreed; no lifecycle invention |
 1410 | | E | TUI view models and route-disabled states | Generated protocol fixtures available |
 1411 | | F | Migration analysis/fixtures, read-only until target schema freezes | Current and target mappings frozen |
 1412 | 
 1413 | One integration owner controls `schema-v2.sql` successor migrations, shared
 1414 | store/application top-level files, protocol version, and workspace manifests.
 1415 | Independent reviewers may inspect all lanes concurrently. No two writers
 1416 | should independently redefine work status, cycle identity, recurrence keys,
 1417 | or promotion provenance.
 1418 | 
 1419 | ## 17. Final conclusions
 1420 | 
 1421 | 1. Keep v2's separation of lifecycle, derived status, dependencies, holds,
 1422 |    attempts, proof, source, memory, and audit.
 1423 | 2. Remove sprint from the new-write work-kind model and represent it as a
 1424 |    dated cycle instance, optionally materialized from a recurrence series;
 1425 |    retain compatibility sprint rows and decoders indefinitely.
 1426 | 3. Keep planning backlog, executable backlog, and active-cycle execution queue
 1427 |    as distinct derived views, never parent nodes or lifecycles.
 1428 | 4. Make decomposition flexible enough for root tasks, nested milestones, and
 1429 |    explicit task groups while keeping only direct leaves claimable.
 1430 | 5. Add typed schedule inputs and a derived `scheduled` work status; keep due,
 1431 |    retry, lease, hard budget, cycle time, and revisit time semantically
 1432 |    distinct.
 1433 | 6. Add a first-class intake lifecycle for notes, discoveries, questions, and
 1434 |    revisit items, with optional buckets and typed, digest-bound, source-aware
 1435 |    promotion provenance.
 1436 | 7. Do not create an arbitrary condition DSL. Extend eligibility only through
 1437 |    versioned typed condition sources and tested reason/action contracts.
 1438 | 8. Perform the additive v2 schema 2 -> 3 migration in Phase 1, blocked by any
 1439 |    live attempt. Keep later v1 import separate. Never relabel old evidence or
 1440 |    guess activation/closeout/recurrence.
 1441 | 9. Expose the model through one registry-driven Rust API, thin CLI/TUI clients,
 1442 |    and the one-command `bwrk dashboard` experience.
 1443 | 10. Negotiate work/status, cycle, recurrence, and intake capabilities
 1444 |     independently so partial implementations cannot advertise false support.
````
