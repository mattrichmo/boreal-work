# R-SCENARIOS — project/spec/WORK_MODEL_SCENARIOS.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/spec/WORK_MODEL_SCENARIOS.md:L1–L580`  
**File SHA-256:** `82a4125d34a25563f098626b62482c370cf917f38a0fffd588b455c3856ebebd`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Planning, dependency, scope, schedule and carry-over scenarios that must survive public adapters.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,580p' 'project/spec/WORK_MODEL_SCENARIOS.md'
```

## Exact baseline excerpt

````text
    1 | # Boreal work-model scenarios, invariants, and acceptance contract
    2 | 
    3 | Status: design-review companion to [WORK_MODEL_V2.md](WORK_MODEL_V2.md),
    4 | reviewed against the current source tree on 2026-09-16. This document is a
    5 | scenario and acceptance contract. It does not claim that schema 3, cycle,
    6 | recurrence, intake, or container closeout are implemented.
    7 | 
    8 | ## 1. Review outcome
    9 | 
   10 | The target direction in `WORK_MODEL_V2.md` is stronger than both the fixed
   11 | schema-2 hierarchy and a literal `milestone -> sprint -> task -> evidence`
   12 | tree. The user-facing journey should still be easy to understand in that
   13 | order, but those four concepts must not share one parent relation:
   14 | 
   15 | | User concept | Canonical meaning | Canonical relationship |
   16 | | --- | --- | --- |
   17 | | Project | Authority, namespace, revision stream, and workspace binding | Owns all project-local records |
   18 | | Milestone | Strategic outcome and non-executable work container | Decomposes into milestone/container-task/direct-task descendants |
   19 | | Sprint | Dated delivery cycle | Assigns direct tasks and references milestone goals |
   20 | | Task | Work unit or explicit task group | Direct tasks execute; container tasks only roll up children |
   21 | | Evidence | Immutable proof from one attempt or one container-closeout context | Attaches to proof context; never becomes a work child |
   22 | 
   23 | The dashboard may render a composed view such as “Milestone / Sprint / Task /
   24 | Evidence,” but it must label each edge. Reparenting a task, scheduling it in a
   25 | cycle, adding a dependency, and recording proof are four different mutations.
   26 | 
   27 | The present implementation is a useful schema-2 kernel, not this target model.
   28 | In particular, the pure status evaluator and claim transaction are work-kind
   29 | agnostic, and an application test currently demonstrates a successful claim
   30 | against a milestone. Schema 3 must make direct execution mode authoritative at
   31 | both the domain and committing-store boundaries before flexible hierarchy is
   32 | enabled.
   33 | 
   34 | ## 2. Current implementation versus target behavior
   35 | 
   36 | This table records source-observed behavior, not intended future behavior.
   37 | 
   38 | | Concern | Current executable behavior | Target / required disposition |
   39 | | --- | --- | --- |
   40 | | Project | `project` stores ID, schema/status versions, revision, and timestamps. Multiple IDs can be listed for dashboard discovery. | Add name, description, active/archived lifecycle, timezone, capability versions, primary cycle, and machine-local workspace bindings. |
   41 | | Work kinds | `Milestone`, `Sprint`, and `Task` are one enum. | New writes use milestone/task plus `container | direct`; sprint rows remain compatibility-readable only. |
   42 | | Parent shape | Root milestone, sprint under milestone, task under sprint. Domain, application, migration, and SQL triggers enforce it. | A project-local acyclic decomposition forest permits root tasks, nested milestones, and task groups. Cycles are not parents. |
   43 | | Claimability | Status evaluation and SQL claim selection do not restrict by kind. Any open automatic row without blockers/current attempt can be ready and claimed. | Only an open `direct` task can be ready or own an attempt. Containers, cycles, intake, source, and memory are never claimable. |
   44 | | Dependencies | DAG and close-only readiness exist, but endpoints may be any work kind. | Both endpoints must be direct tasks, checked in the application and commit transaction. |
   45 | | Sprints | A sprint is a work row and strategic parent. No cycle dates, focus, assignment history, or carry-over exist. | Sprint is a cycle instance. Milestone links and task assignments are separate, temporal records. |
   46 | | Recurrence | Not present. | Stable series + immutable weekly template versions + stable slot ordinals/keys + explicit materialization/reconciliation. |
   47 | | Work time | SQLite has `due_at` and `retry_not_before`; only retry is read into status. `due_at` is absent from `WorkItem`, ordinary create paths, and status. | Add typed schedule input. Distinguish availability, plan estimates, due badge, retry backoff, cycle time, attempt clocks, and revisit time. |
   48 | | Status | Derived status correctly separates lifecycle, dependency wait, holds, attempt, gates, dispatch, and retry. No `scheduled` state or overdue badge exists. | Add direct/container evaluators, schedule/cycle inputs, overdue badge, and all next time boundaries. |
   49 | | Holds | Persisted append-style records with explicit resolution fields; active holds feed status. | Retain, add stable typed kinds and structured references, and never delete to “resolve.” |
   50 | | Intake | No bucket or note/discovery/question/revisit entity. | Add intake lifecycle, date-based revisit, and typed promotion provenance. |
   51 | | Evidence | Receipts, reviews, summaries, gates, attempts, and fences exist. They are task/work subject records, not children. | Bind proof to exactly one current attempt or container closeout context; historical proof cannot float to a new context. |
   52 | | Create API | CLI, service, and TUI can now send kind/parent/priority under schema-2 semantics. TUI rejects non-empty hard holds because the current route does not support them. | Capability-gated schema-3 DTOs must replace—not silently extend—the old meaning. |
   53 | | Migration | Current migration document understands fixed milestone/sprint/task containment. | Keep schema-2-to-3 upgrade separate from later v1 import; preserve compatibility sprint subjects and ambiguous proof. |
   54 | 
   55 | ## 3. Canonical authority and relationship invariants
   56 | 
   57 | The model is accepted only if all clients and transactions preserve these
   58 | invariants.
   59 | 
   60 | ### 3.1 Universal invariants
   61 | 
   62 | 1. Every operational reference is project-scoped and validated in the
   63 |    committing transaction.
   64 | 2. Persisted lifecycle is small. `ready`, `queued`, `scheduled`, `blocked`,
   65 |    `overdue`, and `revisit_due` are derived results, never writable labels.
   66 | 3. Decomposition, dependency, cycle assignment, and provenance are distinct
   67 |    edge types and cannot be inferred from one another.
   68 | 4. Only open direct tasks can own attempts. A store-level claim predicate must
   69 |    reject every other entity even if an adapter or projection is defective.
   70 | 5. One current fenced attempt exists per direct task and one current execution
   71 |    exists per durable session.
   72 | 6. Historical attempts, assignment outcomes, evidence, failed evaluations,
   73 |    dispositions, and promotion links are retained.
   74 | 7. Every successful mutation atomically commits canonical rows, operation
   75 |    result, audit event, and one project revision. Unknown client outcomes are
   76 |    resolved by operation readback.
   77 | 8. Time-driven read changes use an authoritative `as_of` and
   78 |    `next_status_change_at`; passage of time does not fabricate a lifecycle
   79 |    mutation.
   80 | 9. Text from work, intake, source, or memory is data. It cannot grant authority,
   81 |    become an executable condition, or satisfy evidence by prose.
   82 | 10. A client advertises or enables only capabilities and routes actually
   83 |     implemented by the server version it is using.
   84 | 
   85 | ### 3.2 Decomposition invariants
   86 | 
   87 | - `milestone` is always `container`.
   88 | - `task` is either `direct` or `container`.
   89 | - A direct task has no children; a container never has an attempt.
   90 | - Root milestones and root tasks are valid.
   91 | - Parent links are project-local and acyclic.
   92 | - Recommended clarification before contract freeze: a milestone container may
   93 |   parent milestones or tasks; a container task should parent tasks only. This
   94 |   avoids burying a strategic milestone beneath an implementation task while
   95 |   retaining explicit task groups.
   96 | - Kind is immutable. Execution mode is mutable only before children,
   97 |   assignments, dependencies, dispositions, or any attempt/proof history exist.
   98 | - Dependency endpoints are direct tasks only. Container progress is a rollup,
   99 |   not a dependency node.
  100 | 
  101 | ### 3.3 Scheduling invariants
  102 | 
  103 | - A cycle assignment never changes `parent_work_id`.
  104 | - A milestone may span many cycles; a cycle may advance many milestones.
  105 | - A direct task has at most one live `planned | committed` assignment in
  106 |   `boreal.cycle/1`.
  107 | - A planned cycle may include draft tasks. Starting the cycle commits their
  108 |   assignments but does not publish the tasks; they remain `draft` and make the
  109 |   cycle derive `incomplete_scope` until explicitly published or removed.
  110 | - An active cycle is not required for unscheduled work. Unscheduled open direct
  111 |   tasks remain eligible through executable backlog if every other condition
  112 |   permits.
  113 | - Cycle completion/cancellation is rejected while a live assignment remains.
  114 | - Carry-over is one transaction: source becomes `carried_over`, successor is
  115 |   inserted, links are mutual, and every committed revision has at most one live
  116 |   assignment.
  117 | - Completing or cancelling a cycle never closes, cancels, or reopens a task.
  118 | 
  119 | ### 3.4 Proof invariants
  120 | 
  121 | - Direct-task proof has an exact `(work, attempt, fence, input, source,
  122 |   configuration, profile, policy, command/tool/environment/observable)`
  123 |   context.
  124 | - Container proof has an exact `(container, closeout evaluation, descendant
  125 |   set, dispositions, descendant outcomes/summaries, profile, policy)` context.
  126 | - Those contexts are XOR: both or neither is invalid.
  127 | - Witnessed command, checkpoint, and executor receipt proof is attempt-only.
  128 | - A container that needs executable verification gets an explicit direct
  129 |   closeout task.
  130 | - Evidence is never a task child. The UI may nest it below a task attempt as a
  131 |   proof view, but the stored relation is proof provenance.
  132 | - Attempt rollover, source/config/profile/policy drift, descendant reopening,
  133 |   or disposition supersession makes old proof ineligible without deleting it.
  134 | 
  135 | ## 4. Scenario catalog
  136 | 
  137 | The “current” column distinguishes what can be exercised now from what remains
  138 | proposal-only.
  139 | 
  140 | | ID | Scenario | Canonical records and edges | Expected outcome | Current state |
  141 | | --- | --- | --- | --- | --- |
  142 | | S01 | Simple project backlog | Project + root direct task, no cycle assignment | Open task is in planning backlog and, if otherwise eligible, executable backlog/`ready` | Impossible under current parent rule; target |
  143 | | S02 | Familiar milestone/sprint/task/evidence journey | Milestone container; cycle goal link; task child of milestone; cycle assignment; task attempt and receipts | UI can present the familiar journey without pretending sprint/evidence are decomposition parents/children | Current uses one tree; target relation split |
  144 | | S03 | Milestone spans releases | One milestone with tasks assigned historically to cycles A, B, and C | Parent remains stable; milestone rollup spans all descendants and cycle reports retain assignment history | Target |
  145 | | S04 | Sprint advances multiple milestones | Cycle goal links to M1/M2; assignments for direct tasks under both | One cycle scope shows both goals; tasks retain original milestone parents | Target |
  146 | | S05 | Explicit task group | Milestone -> container task -> direct subtasks | Group is never claimable; subtasks can have dependencies and attempts | Target; parent-kind clarification required |
  147 | | S06 | Unscheduled execution | Open direct task with no live assignment | Appears in planning backlog and may be claimed from executable backlog | Target |
  148 | | S07 | Future work availability | Direct task with `not_before_at = T` | `scheduled` before T, eligible at equality if no other blocker; next change is T | Target |
  149 | | S08 | Due but executable | Open direct task with `due_at = T` and no blocker | Remains ready/claimable at and after T; receives `overdue` badge at equality | Schema column exists but is unused; target |
  150 | | S09 | Cycle activation delay | Active cycle + committed assignment with future explicit activation | Task derives `scheduled`; becomes eligible at activation equality | Target |
  151 | | S10 | Carry unfinished task | Committed assignment in A carried to planned/active B | Task lifecycle/parent/proof unchanged; linked assignment history; one live slot | Target |
  152 | | S11 | Two active cycles | Delivery and maintenance cycles active; one is project primary | Dashboard defaults to primary, filters can show both; a task still has only one live assignment | Target |
  153 | | S12 | Weekly recurring sprint | Active series + immutable template v1 + materialized slots | Duplicate materialization/restart creates one cycle per ordinal/key | Target |
  154 | | S13 | Recurrence template change | Template v2 starts at ordinal N | Existing slot identity is stable; started/history-bearing cycles are unchanged; eligible future planned cycles require digest-bound reconciliation | Target |
  155 | | S14 | Recurring standard tasks | Recurring cycle series plus desire for the same checklist each sprint | `recurrence/1` creates cycle shells only; it does not clone tasks. A later scope-template capability is required for automatic recurring tasks | Explicitly not covered by current target |
  156 | | S15 | DST transition | Local recurring start falls in a gap or fold | Persist nominal time, policy, chosen offset, UTC instant, and tzdb identity; never silently recompute old cycles | Target |
  157 | | S16 | Notes bucket | Active “Field notes” bucket + captured note | Note is inbox data, not work, dependency, proof, or memory | Target |
  158 | | S17 | Discovery creates work and knowledge | Discovery revision R/digest D promoted to draft task and cited memory draft | Typed promotion rows preserve one origin; memory cites immutable source; intake remains | Target |
  159 | | S18 | Date-based revisit | Deferred revisit item with `revisit_at = T` | `waiting` before T, `revisit_due` at equality, no lifecycle write | Target |
  160 | | S19 | Event-based revisit | “Revisit when task X closes” | Not supported by `intake/1`; requires a future typed trigger capability, not a prose/JSON condition | Deliberate deferral |
  161 | | S20 | Question becomes decision | Triaged question resolved by a decision record | No canonical decision entity exists; retain as intake/resolution or defer typed decision promotion | Deliberate deferral |
  162 | | S21 | Project archive | Active project archived | Normal work/cycle/intake/execution writes reject; reads/export/repair and audited restore remain | Target |
  163 | | S22 | Proof rollover | Attempt A passes, is released, attempt B becomes current | A remains visible but cannot satisfy B; status/close agree | Partially implemented; target binding must remain authoritative |
  164 | | S23 | Container closeout across cancelled work | Milestone descendants include closed, cancelled, and replaced tasks | Explicit current dispositions plus summary/allowed closeout gates required; no automatic “all terminal means accepted” | Target |
  165 | | S24 | Compatibility sprint with old proof | Schema-2 sprint row owns attempt/receipt during upgrade | Row and proof remain historical/readable; cycle conversion does not transfer proof identity | Target migration |
  166 | 
  167 | ## 5. Detailed behavioral scenarios
  168 | 
  169 | ### 5.1 The familiar delivery journey
  170 | 
  171 | | Step | Mutation | Canonical effect | Must not happen |
  172 | | --- | --- | --- | --- |
  173 | | 1 | Initialize project | Create active project, timezone, capability identities, revision, and workspace binding | Treat project as root work |
  174 | | 2 | Create milestone | Create container work | Make it claimable |
  175 | | 3 | Create sprint | Create planned cycle and link milestone as a cycle goal | Create a sprint work child |
  176 | | 4 | Create task | Create direct task under milestone, initially draft or open | Infer cycle assignment from parent |
  177 | | 5 | Assign task | Create planned assignment to cycle | Reparent task beneath cycle |
  178 | | 6 | Start cycle | Explicitly activate cycle and commit planned assignments | Auto-open draft tasks or claim work |
  179 | | 7 | Claim task | Atomically create fenced attempt for eligible direct task | Claim milestone/cycle/container |
  180 | | 8 | Run verification | Admit execution, record immutable artifacts/receipt against attempt/fence | Insert evidence as child work or trust self-labels |
  181 | | 9 | Finish task | Validate current proof/summary/review and close task; complete live assignment in same revision | Close because cycle ended or a cached gate says passed |
  182 | | 10 | Complete cycle | Require no live assignments, then complete explicitly | Close milestone/tasks by cascade |
  183 | | 11 | Close milestone | Validate descendant dispositions and container closeout context | Reuse task-attempt proof as milestone proof |
  184 | 
  185 | Recommended dashboard composition:
  186 | 
  187 | ```text
  188 | Project
  189 | ├── Roadmap
  190 | │   └── Milestone
  191 | │       └── Task (decomposition)
  192 | ├── Cycles
  193 | │   └── Sprint / Cycle
  194 | │       └── Task (assignment, with milestone badge)
  195 | └── Proof
  196 |     └── Task
  197 |         └── Attempt
  198 |             ├── Checkpoints
  199 |             ├── Evidence receipts
  200 |             ├── Review
  201 |             └── Summary
  202 | ```
  203 | 
  204 | The repeated task is one identity rendered through different relationships.
  205 | 
  206 | ### 5.2 Backlog, cycle scope, and carry-over
  207 | 
  208 | Given direct tasks `A`, `B`, `C`, and `D`:
  209 | 
  210 | | Task | Parent | Assignment | Other state | Expected planning view | Expected execution view |
  211 | | --- | --- | --- | --- | --- | --- |
  212 | | A | Milestone M1 | None | Open, no blockers | Planning backlog | Executable backlog / ready |
  213 | | B | Milestone M1 | Planned in future cycle | Open | Cycle scope, not planning backlog | Not executable until cycle is active/committed |
  214 | | C | Milestone M2 | Committed in active cycle | Open, dependency open | Active cycle scope | `queued` |
  215 | | D | Root task | None | Draft | Planning backlog | `draft`, not executable |
  216 | 
  217 | Carrying C from cycle 1 to cycle 2 must not change C's parent, work lifecycle,
  218 | attempt history, or accepted proof. It changes only assignment history. If C
  219 | has a current attempt, carry-over requires an explicit policy: the first
  220 | release should reject it until that attempt is safely released/reconciled.
  221 | 
  222 | ### 5.3 Recurring cycles
  223 | 
  224 | The initial recurrence capability solves repeated dated cycle creation, not
  225 | automatic work cloning.
  226 | 
  227 | | Concern | Rule |
  228 | | --- | --- |
  229 | | Identity | `(series_id, slot_ordinal)` and version-independent slot key identify the occurrence |
  230 | | Definition | Immutable template version selected by ordinal boundary |
  231 | | Cadence | Weekly only, including biweekly via `interval_weeks` |
  232 | | Time | Local-wall recurrence resolved once to stored UTC facts |
  233 | | Retry | Same operation + semantic payload replays; changed payload conflicts |
  234 | | Template edit | New immutable version; never mutate a prior version |
  235 | | Existing cycles | Started, completed, cancelled, assigned, attempted, or proof-bearing cycles stay unchanged |
  236 | | Future cycles | Only eligible planned cycles may be rescheduled under an expected revision and plan digest |
  237 | | Scope | Assignments remain explicit; no hidden task cloning or auto-carry-over |
  238 | 
  239 | If recurring task checklists are required, add a separately versioned
  240 | `cycle-scope-template` capability with immutable task-blueprint versions,
  241 | stable instantiation keys, explicit copy/link semantics, source/profile
  242 | identity, and idempotent reconciliation. Do not overload recurrence templates
  243 | or clone arbitrary prior-cycle task state.
  244 | 
  245 | ### 5.4 Intake and promotion
  246 | 
  247 | | Intake kind | Default meaning | Typical transitions | Allowed promotions | Never implies |
  248 | | --- | --- | --- | --- | --- |
  249 | | Note | Observation worth retaining | captured -> triaged/resolved/archived | Source, cited memory draft, supporting link to work | Task, gate, or instruction |
  250 | | Discovery | Finding with potential action/knowledge value | captured -> triaged -> resolved | Draft work, source, cited memory draft | Verified fact or ready task |
  251 | | Question | Unresolved research/decision prompt | captured -> triaged/deferred/resolved | Draft research task or source; decision promotion deferred | Canonical decision |
  252 | | Revisit | Deferred attention item | captured/triaged -> deferred -> triaged/resolved | Draft work/source/memory when revisited | Time-triggered lifecycle mutation |
  253 | 
  254 | A promotion binds the exact intake revision and content digest. Editing the
  255 | intake after a promotion does not rewrite its targets. A new promotion can
  256 | support another target or correction, while the old provenance remains.
  257 | 
  258 | ### 5.5 Container closeout
  259 | 
  260 | Example milestone descendants:
  261 | 
  262 | | Descendant | Work outcome | Required container fact |
  263 | | --- | --- | --- |
  264 | | T1 | Closed with current summary/proof | `accepted_closed` bound to exact revision/outcome |
  265 | | T2 | Cancelled as no longer needed | `accepted_cancelled` with authorized actor and reason |
  266 | | T3 | Open but moved outside milestone scope | `deferred` with reason, or an audited reparent mutation and recomputed descendant set |
  267 | | T4 | Replaced by T5 | `replaced` identifying T5 |
  268 | 
  269 | The milestone derives `closing` only when descendant coverage is complete but
  270 | its own summary/review/operator approval remains. It becomes `attention` for
  271 | an invalidated disposition, reopened descendant, hard hold, expiry review, or
  272 | failed closeout gate. It never becomes `ready` or owns a claim.
  273 | 
  274 | ## 6. Lifecycle semantics by entity
  275 | 
  276 | ### 6.1 Project
  277 | 
  278 | | From | Operation | To | Preconditions/effects |
  279 | | --- | --- | --- | --- |
  280 | | active | archive | archived | No unsafe in-flight project mutation; normal new operational writes stop |
  281 | | archived | restore | active | Authorized, audited, expected revision |
  282 | 
  283 | Archive is not delete. It retains work, cycles, intake, proof, source, memory,
  284 | audit, export, and repair access.
  285 | 
  286 | ### 6.2 Direct work
  287 | 
  288 | | From | Operation | To | Notes |
  289 | | --- | --- | --- | --- |
  290 | | draft | publish | open | Valid hierarchy/profile/schedule; publication does not claim |
  291 | | open | close | closed | Current proof, summary/review, ownership, and assignment completion commit atomically |
  292 | | draft/open | cancel | cancelled | Reason required; live assignment removed and current attempt safely resolved |
  293 | | closed/cancelled | reopen | open | New proof context; old proof remains historical; affected rollups/dependents recompute |
  294 | 
  295 | ### 6.3 Container work
  296 | 
  297 | Persisted transitions use the same four lifecycle values, but close uses the
  298 | container context. Container derived states are `draft | open | attention |
  299 | closing | closed | cancelled`; they never share the direct-work
  300 | `ready/claimed/in_progress` vocabulary.
  301 | 
  302 | ### 6.4 Cycle
  303 | 
  304 | | From | Operation | To | Exact rule |
  305 | | --- | --- | --- | --- |
  306 | | planned | start | active | Commit all planned assignments after one transaction revalidation |
  307 | | planned | cancel | cancelled | Reject while any live assignment remains |
  308 | | active | complete | completed | Reject while any live assignment remains |
  309 | | active | cancel | cancelled | Reject while any live assignment remains |
  310 | 
  311 | Scheduled dates derive `upcoming`, `start_due`, and `end_due`; they do not
  312 | perform these transitions.
  313 | 
  314 | ### 6.5 Cycle assignment
  315 | 
  316 | | From | Event | To |
  317 | | --- | --- | --- |
  318 | | create in planned cycle | insert | planned |
  319 | | create in active cycle | insert | committed |
  320 | | planned | cycle start / explicit commit | committed |
  321 | | planned/committed | task closes | completed |
  322 | | planned/committed | remove with reason | removed |
  323 | | planned/committed | atomic carry-over | carried_over + successor planned/committed |
  324 | 
  325 | Terminal assignment states are immutable historical facts.
  326 | 
  327 | ### 6.6 Recurrence series and template
  328 | 
  329 | Series transitions are `active <-> paused` and `active|paused -> retired`.
  330 | Retired is terminal. Template versions never transition or update; a change
  331 | creates a new version with an ordinal boundary.
  332 | 
  333 | ### 6.7 Intake
  334 | 
  335 | | From | Allowed destinations | Time behavior |
  336 | | --- | --- | --- |
  337 | | captured | triaged, deferred, archived | Derives `inbox` |
  338 | | triaged | deferred, resolved, archived | Derives `attention` until resolved |
  339 | | deferred | triaged, resolved, archived | `waiting`, then `revisit_due` at equality if dated |
  340 | | resolved | triaged, archived | Reopen is explicit |
  341 | | archived | triaged | Restore is explicit |
  342 | 
  343 | ## 7. Conditional status and time semantics
  344 | 
  345 | ### 7.1 Direct-work precedence
  346 | 
  347 | The target evaluator should return one primary status plus every applicable
  348 | reason/badge. The precedence is normative:
  349 | 
  350 | 1. `closed | cancelled` terminal lifecycle;
  351 | 2. `expired_review | blocked` hard intervention;
  352 | 3. `draft`;
  353 | 4. current attempt/proof (`claimed`, `in_progress`, `needs_verification`,
  354 |    `awaiting_review`, `complete`);
  355 | 5. `paused | retry_wait`;
  356 | 6. `scheduled` for future effective availability;
  357 | 7. `queued` for ordinary open prerequisites;
  358 | 8. `ready` under actor/dispatch policy.
  359 | 
  360 | This differs from current code, which checks open dependencies before retry
  361 | and paused policy, has no scheduled branch, and applies the same evaluator to
  362 | all work kinds. Schema-3 fixtures must freeze the target ordering.
  363 | 
  364 | ### 7.2 Time field matrix
  365 | 
  366 | | Field | Domain meaning | Blocks execution? | Derived effect at equality | Mutates lifecycle automatically? |
  367 | | --- | --- | --- | --- | --- |
  368 | | `not_before_at` | Earliest work availability | Yes | Scheduling block clears | No |
  369 | | assignment `activation_at` | Earliest cycle-scope availability | Yes | Scheduling block clears | No |
  370 | | `target_start_at` | Planning estimate | No | Optional planning badge | No |
  371 | | `target_end_at` | Planning estimate | No | Optional planning variance badge | No |
  372 | | `due_at` | Product target deadline | No | `overdue` badge begins for nonterminal work | No |
  373 | | `retry_not_before` | Execution backoff | Yes | `retry_wait` clears | No |
  374 | | lease deadline | Renewable liveness boundary | Stops current attempt progression | Expiry review behavior applies | Timer/recovery operation persists outcome |
  375 | | hard attempt deadline | Immutable execution budget | Stops current attempt progression | Hard expiry wins | Timer/recovery operation persists outcome |
  376 | | cycle start/end | Delivery plan | Only through typed assignment activation | `start_due` / `end_due` | No |
  377 | | `revisit_at` | Intake attention time | Not work execution | `revisit_due` | No |
  378 | 
  379 | Effective availability for a committed direct task is the latest applicable
  380 | blocking instant from `work_schedule.not_before_at` and assignment activation.
  381 | `next_status_change_at` is the earliest future instant that can change the
  382 | current result, also considering retry and attempt deadlines. `due_at` and
  383 | `revisit_at` must be included when they can change badges/display even though
  384 | they do not block work.
  385 | 
  386 | ### 7.3 Combined-condition examples
  387 | 
  388 | | Inputs | Primary status | Additional reasons/badges |
  389 | | --- | --- | --- |
  390 | | Closed + past due | closed | No active overdue badge |
  391 | | Open + hard hold + open dependency + past due | blocked | Hold, prerequisite, overdue |
  392 | | Draft + committed cycle assignment | draft | Cycle membership; possibly incomplete-scope |
  393 | | Open + paused + future not-before + open dependency | paused | Future activation and prerequisite reasons |
  394 | | Open + retry future + open dependency | retry_wait | Retry instant and prerequisite reason |
  395 | | Open + future not-before + open dependency | scheduled | Activation instant and prerequisite reason |
  396 | | Open + operator-only + all conditions met, agent actor | ready but not claimable | `operator_only`, request operator action |
  397 | | Open + current attempt beyond hard deadline | expired_review | Hard-budget reason; never ready |
  398 | 
  399 | ## 8. Schema and API implications
  400 | 
  401 | ### 8.1 Required schema-3 additions or changes
  402 | 
  403 | | Area | Required persistence | Key constraints/indexes |
  404 | | --- | --- | --- |
  405 | | Project | metadata, lifecycle, timezone, capability versions, primary cycle | lifecycle check; project revision; primary cycle FK |
  406 | | Workspace | `workspace_binding` | One active binding per project/local-service identity; root independent of DB path |
  407 | | Work | `execution_mode`, flexible parent, source reference strategy | Direct has no children; sprint rejected for new writes; recursive parent cycle guard |
  408 | | Schedule | `work_schedule` | One row/work; target end after target start; indexes on not-before/due |
  409 | | Container closeout | closeout evaluation + append-only descendant disposition | One current unsuperseded disposition per pair; proof-context digest |
  410 | | Dependency | direct-task endpoints only | Project-local FKs; DAG check in commit transaction |
  411 | | Cycle | cycle, goal links, assignment history, focus | One live assignment/task; no live assignment on terminal cycle |
  412 | | Recurrence | series, immutable template versions, materialized slot facts | Unique version, ordinal, slot key; expected revision/digest |
  413 | | Intake | bucket, item, three typed promotion tables | Project-local FKs; revision/content digest; append-only promotion |
  414 | | Proof | attempt/container context discriminator | XOR shape check and authoritative eligibility validation |
  415 | | Operations | typed command/result identity | Operation ID + canonical payload digest; readback route |
  416 | 
  417 | Project namespace semantics also require a decision on identifiers. The current
  418 | schema uses globally primary `work_id`, `source_version_id`, and similar IDs
  419 | despite also declaring project-composite uniqueness. If schema 3 intends IDs to
  420 | be project-local, primary keys and all FKs/routes must consistently carry
  421 | `project_id`. If IDs remain globally unique, the contract should say so while
  422 | still validating project ownership on every reference. Do not leave this
  423 | implicit.
  424 | 
  425 | ### 8.2 API implications
  426 | 
  427 | - Work creation takes `kind`, `execution_mode`, optional parent, lifecycle or
  428 |   explicit publish operation, priority, dispatch policy, profile, source, and
  429 |   schedule under a negotiated work-model version.
  430 | - Cycle creation/assignment and decomposition edits use different routes and
  431 |   result types.
  432 | - `sprint` is an alias for cycle routes only after cycle capability exists; it
  433 |   must not ambiguously address compatibility sprint work rows.
  434 | - Exact reads use indexed identity queries; list/backlog/cycle/inbox views are
  435 |   bounded and cursor-based.
  436 | - Status responses include entity-specific status vocabularies, reason codes,
  437 |   badges, `as_of`, revision, and next clock change.
  438 | - Every mutation carries project, actor/session, operation ID, canonical
  439 |   request digest, expected revision where applicable, and typed outcome.
  440 | - TUI controls are route/capability gated. Unsupported functionality is visibly
  441 |   disabled and never falls back to direct SQLite or a different command.
  442 | 
  443 | ## 9. Clarifications required before freezing schema 3
  444 | 
  445 | | Decision | Recommended resolution | Why it matters |
  446 | | --- | --- | --- |
  447 | | Can a container task parent a milestone? | No; task containers parent tasks only | Preserves strategic hierarchy and clearer rollups |
  448 | | What happens to draft tasks when their cycle starts? | Commit assignment, retain draft lifecycle, mark cycle incomplete scope | Avoids implicit publication while preserving planning intent |
  449 | | Can work with a current attempt be carried over? | Reject until release/reconciliation | Avoids changing delivery ownership beneath an executor |
  450 | | Does recurrence clone sprint tasks? | No in recurrence/1 | Cloning needs its own identity, proof, source, and reconciliation rules |
  451 | | Can revisit depend on an event? | Not in intake/1; add typed future triggers | Prevents generic condition DSL and hidden polling semantics |
  452 | | Are work IDs project-local or globally unique? | Choose and encode consistently before migration | Current PKs and target namespace language disagree |
  453 | | Does due date ever block? | No; badge only | Keeps deadlines distinct from availability |
  454 | | May a task be assigned to two active cycles? | No in cycle/1 | Prevents ambiguous scope/capacity; later roles may version this |
  455 | | How is evidence shown below a task? | Through attempt/proof view, never parent ID | Preserves trust and fencing |
  456 | | How are source links beyond one primary source represented? | Typed many-to-many work-source links | A convenience primary FK cannot express all provenance |
  457 | 
  458 | ## 10. Phased acceptance tests
  459 | 
  460 | ### Phase 0 — freeze scenarios and shared fixtures
  461 | 
  462 | | Test | Acceptance |
  463 | | --- | --- |
  464 | | Entity vocabulary | Rust/domain, SQL checks, protocol DTOs, CLI, and TUI decoders agree on each entity lifecycle/status vocabulary |
  465 | | Relationship vocabulary | Fixtures distinguish parent, dependency, assignment, goal, source citation, promotion, and proof links |
  466 | | Claim matrix | Every entity/kind/mode combination proves that only open direct task is potentially claimable |
  467 | | Capability independence | Work/status, cycle, recurrence, and intake versions enable routes independently |
  468 | | Current-gap regression | A fixture reproduces current milestone claimability, then schema-3 tests require rejection at projection and commit |
  469 | 
  470 | ### Phase 1 — project and decomposition kernel
  471 | 
  472 | | Test | Acceptance |
  473 | | --- | --- |
  474 | | Flexible hierarchy | Create root task, nested milestones, milestone task, and task group through public routes |
  475 | | Invalid hierarchy | Reject cross-project parent, direct parent, task-container -> milestone if recommendation accepted, and every parent cycle |
  476 | | Direct-only execution | Status never reports a container ready; direct SQL/application claim of container rejects with zero writes |
  477 | | Direct-only DAG | Reject dependency edges involving milestone/container/compatibility sprint and reject concurrent cycle creation |
  478 | | Work schedule | `not_before` equality, due badge equality, target-window validation, and restart round-trip pass |
  479 | | Project lifecycle | Archive blocks normal mutations and execution while reads/export/restore remain |
  480 | | Workspace binding | Moving DB does not change witnessed executor root; unavailable binding fails safely |
  481 | | Container proof | Attempt/container XOR, disposition drift, descendant reopen, summary/review closeout cases pass |
  482 | | Migration preflight | Any live schema-2 attempt causes zero-write typed refusal; resolved rerun succeeds and retains compatibility sprint |
  483 | 
  484 | ### Phase 2 — cycle and backlog kernel
  485 | 
  486 | | Test | Acceptance |
  487 | | --- | --- |
  488 | | Cross-cutting scope | One milestone spans three cycles and one cycle schedules tasks from two milestones without reparenting |
  489 | | Backlog sets | Planning backlog, executable backlog, and active-cycle execution queue return distinct exact sets |
  490 | | Draft scope | Starting cycle with draft task commits assignment but task remains draft and cycle derives incomplete scope |
  491 | | Assignment uniqueness | Two concurrent assignments for one task yield one live winner and one typed conflict |
  492 | | Carry-over | Crash/retry/race matrix preserves linked history and exactly one live slot |
  493 | | Terminal cycle | Complete/cancel rejects with live scope and succeeds only after completed/removed/carried-over dispositions |
  494 | | Multiple active cycles | Explicit primary focus controls default dashboard; list order never does |
  495 | 
  496 | ### Phase 3 — recurrence and time
  497 | 
  498 | | Test | Acceptance |
  499 | | --- | --- |
  500 | | Weekly/biweekly slots | Expected local candidates map to stable ordinals/keys and materialize once across 100 duplicate calls |
  501 | | Restart and timer duplication | Restart/duplicate delivery never duplicates a cycle or advances ordinal incorrectly |
  502 | | DST matrix | Gap/fold policies, elapsed/local-wall end semantics, nominal values, offsets, UTC, and tzdb identity persist exactly |
  503 | | Template version | New ordinal boundary keeps old slots stable; only eligible planned cycles change under exact plan digest |
  504 | | Clock-only status | Schedule, due, cycle, retry, attempt, and revisit boundaries refresh at equality without unrelated writes |
  505 | | Unsupported recurrence | Daily/monthly/business-calendar or task-cloning fields reject under recurrence/1 |
  506 | 
  507 | ### Phase 4 — intake and promotion
  508 | 
  509 | | Test | Acceptance |
  510 | | --- | --- |
  511 | | Four kinds | Capture, triage, defer, resolve, archive, restore, and bounded list/detail for each kind |
  512 | | Bucket neutrality | Moving/archiving a bucket never changes task status or proof |
  513 | | Revisit equality | Deferred item becomes `revisit_due` at exact boundary without lifecycle mutation |
  514 | | Typed promotion | One discovery promotes to draft work, immutable source, and cited memory draft with exact origin digest |
  515 | | Replay/conflict | Same operation/payload replays; changed or stale revision/digest conflicts before target creation |
  516 | | Trust boundary | Intake cannot directly publish memory, mint evidence, execute text, or satisfy a gate |
  517 | | Unsupported event trigger | “When task closes” revisit request gets typed unsupported-capability response |
  518 | 
  519 | ### Phase 5 — real service, CLI, and dashboard
  520 | 
  521 | | Test | Acceptance |
  522 | | --- | --- |
  523 | | One-terminal journey | `bwrk dashboard` initializes/discovers project, manages private service/TUI, and cleans up on normal exit and signals |
  524 | | Familiar composed view | Roadmap/cycle/task/proof views show relation labels and one task identity without false tree edges |
  525 | | Actual transport | Built TypeScript client drives built Rust service; no mocks, direct SQL, per-refresh CLI, or manual server |
  526 | | Mutation safety | Confirmation, expected revision/fence, operation readback, stale/conflict/busy/unknown handling pass |
  527 | | Capability-disabled UI | Cycle without recurrence and work without intake show precise disabled reasons and make no fallback call |
  528 | | Concurrent refresh | Another client mutates assignments/status while dashboard maintains one revision/`as_of` snapshot |
  529 | 
  530 | ### Phase 6 — migration, fault, scale, and release
  531 | 
  532 | | Test | Acceptance |
  533 | | --- | --- |
  534 | | Schema-2 sprint conversion | Preserve sprint row; create cycle/goal/assignments deterministically; keep sprint proof on old subject |
  535 | | Ambiguous references | Container/sprint dependency endpoints and uncertain proof become blocking findings, never guessed valid state |
  536 | | Legacy import | Every source record has mapping/disposition and stable digest; no historical evidence is relabeled witnessed |
  537 | | Scale | 10,000 work records plus cycle/assignment/intake/proof histories keep exact reads indexed and routine pages bounded |
  538 | | Concurrency | Materialization, assignment, carry-over, claim, promotion, and status races preserve all uniqueness invariants |
  539 | | Backup/restore | SQLite, blobs, memory manifests, slot identities, workspace metadata, and migration provenance verify after restore |
  540 | | Standalone release | Packaged CLI/TUI reports schema/capability/SQLite identity and passes the entire public journey after restart |
  541 | 
  542 | ## 11. Release-blocking scenario gates
  543 | 
  544 | Schema 3 is not ready for writes until all of these are true:
  545 | 
  546 | 1. Milestones, containers, cycles, and intake fail closed at the claim
  547 |    transaction, not only in UI/status code.
  548 | 2. Fixed sprint parenting is replaced atomically with cycle assignment and
  549 |    permanent compatibility reads.
  550 | 3. `due_at`, availability, cycle activation, retry, attempt clocks, and revisit
  551 |    time have distinct persisted meanings and shared equality fixtures.
  552 | 4. Container closeout cannot reuse attempt proof and task proof cannot survive
  553 |    attempt/context rollover.
  554 | 5. Recurrence slot identity and DST resolution are deterministic across retry
  555 |    and restart.
  556 | 6. Intake promotion is typed, digest-bound, source-aware, and unable to mint
  557 |    authority.
  558 | 7. Actual CLI/service/TUI clients pass the same scenarios and advertise only
  559 |    implemented capabilities.
  560 | 
  561 | ## 12. Key conclusions
  562 | 
  563 | - Preserve the familiar project/milestone/sprint/task/evidence experience as a
  564 |   composed navigation view, not one overloaded hierarchy.
  565 | - Keep strategic decomposition stable while cycle assignments record delivery
  566 |   history. This is what makes backlog, carry-over, multi-milestone sprints, and
  567 |   recurring sprint instances coherent.
  568 | - Make direct/container mode the immediate safety boundary. The current
  569 |   kind-agnostic claim path is incompatible with the target hierarchy.
  570 | - Treat recurrence as cycle occurrence generation only. Recurring task packs
  571 |   need a later explicit template/instantiation capability.
  572 | - Use intake for notes, discoveries, questions, and date-based revisit items;
  573 |   promote through typed provenance instead of converting prose into status or
  574 |   proof.
  575 | - Keep every time field semantically narrow. Availability blocks, due dates
  576 |   warn, retries back off, leases/hard limits govern attempts, cycle dates plan,
  577 |   and revisit dates request attention.
  578 | - Reject a generic conditional DSL. New behavior must arrive as a typed,
  579 |   versioned condition source with storage, authorization, status, migration,
  580 |   protocol, and negative tests.
````
