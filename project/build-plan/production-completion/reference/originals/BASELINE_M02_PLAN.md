# M02 — Deterministic Planning, Lifecycle Hardening, and v1 Parity

Status: proposed execution plan for the next complete Boreal v2 release.
Owner: integration coordinator plus named lane owners.
Planning style: file-based, checkbox-driven, parallel-safe.
Repository: the authoritative v2 workspace at `/Users/cybertron/Code/boreal-work`.

This is the completion plan for the current thin v2 slice. It is intentionally
more specific than the original M01 scaffold plan: it closes the known gaps in
milestone/sprint/task planning, deterministic status evaluation, gate
configuration, audited overrides, v1 workflow parity, and release validation.
It does not replace the Rust domain/store/service architecture with a new
scaffold and it does not import the v1 runtime into v2.

## 1. Outcome

At the end of M02, a user can create a project-local milestone containing
multiple sprints, each containing multiple tasks, with typed dependencies,
per-work acceptance gates, review requirements, deterministic status reasons,
and auditable operator decisions. Multiple agents can work in parallel without
editing the same planning surface, bypassing lifecycle rules, or leaking state
between projects.

The complete path must work through the Rust application and service API,
the CLI, and the TypeScript terminal UI:

```text
project
  └── milestone
       ├── sprint A
       │    ├── task A1
       │    └── task A2
       └── sprint B
            ├── task B1 depends on A1
            └── task B2 depends on A2
```

Each task may have its own acceptance profile, gates, receipts, evidence,
review policy, due dates, dispatch policy, and dependency edges. Status is
never directly assigned by a client. It is derived from canonical state and
recomputed inside every state-changing transaction.

## 2. Non-negotiable product rules

- [ ] Keep `crates/domain`, `crates/application`, `crates/store`, the versioned
  protocol, the local service, and project persistence authoritative.
- [ ] Do not import v1 modules at runtime. Use the v1 archive only for parity
  evidence, mapping, fixtures, and behavior comparison.
- [ ] Do not add a writable `status` field for display state.
- [ ] Do not let the CLI, TUI, workflow Markdown, or agent prose perform
  lifecycle transitions outside the Rust application/store boundary.
- [ ] Do not make `queued`, `blocked`, `paused`, `retry_wait`, or
  `expired_review` aliases for one another.
- [ ] Do not make `complete`, `verified`, or `cancelled` satisfy the default
  close-only dependency policy without an explicit versioned waiver.
- [ ] Do not use a boolean `force` flag as an override. Overrides must be
  typed, authorized, reason-coded, revision-checked, idempotent, and audited.
- [ ] Preserve failed receipts, rejected reviews, expired attempts, rejected
  planning attempts, and migration provenance.
- [ ] Keep all work, metadata, database selection, and dashboard reads scoped
  to the current project directory unless the user explicitly supplies a
  project selector.
- [ ] Do not fabricate service data, dashboard counts, receipts, evidence, or
  release success in tests or previews.
- [ ] Do not declare a task, sprint, or milestone complete from a scoped test.
  The named acceptance gate must pass.

## 3. Starting-state facts

These facts are the baseline for every assignment. Agents must not silently
assume that a future contract is already wired.

- [ ] The current v2 domain has persisted lifecycle values `draft`, `open`,
  `closed`, and `cancelled`, plus derived statuses including `queued`,
  `ready`, `claimed`, `in_progress`, `needs_verification`,
  `awaiting_review`, `complete`, `blocked`, `paused`, `retry_wait`,
  `expired_review`, and `cancelled`.
- [ ] The current hierarchy validates `milestone -> sprint -> task` and
  rejects invalid parent kinds. It does not yet provide complete sprint
  lifecycle or rollup behavior.
- [ ] The current dependency store has cycle checks and expected-revision
  checks, with default satisfaction based on persisted `closed` lifecycle.
- [ ] The current status evaluator is pure and revisioned, but its paused versus
  open-prerequisite precedence differs from the written status contract.
- [ ] The current evaluator treats a non-task container without an attempt as
  `blocked/non_executable_container`; this must become a planning rollup state.
- [ ] The current CLI `work create` always selects the focused acceptance
  profile. Per-work profile selection and gate declaration are not exposed.
- [ ] The implementation focused profile uses a `summary` gate while the
  acceptance-profile fixture specifies an `audit` gate. This contract drift
  must be resolved before closeout is considered deterministic.
- [ ] Independent review exists in the domain but public review inspection and
  decision routes are unavailable.
- [ ] Sprint create/activate/board/report routes and the complete v3 cycle
  adapter are unavailable. The additive v3 modules are contracts and low-level
  persistence groundwork, not a finished public planning model.
- [ ] The claim transaction candidate query must be audited and tested against
  active holds and every other status eligibility input. A displayed blocked
  state must never be claimable through a lower-level mutation path.
- [ ] `bwrk workflows show` is not currently available even though workflow
  discovery is part of the intended contract. Workflow discovery must be
  restored or explicitly removed from the accepted surface with a documented
  disposition.

## 4. Target status and transition contract

The following meanings are normative for M02.

| Display status | Meaning | Typical reason code | Unblocks dependents? |
| --- | --- | --- | --- |
| `draft` | Planned but not published for execution | `not_published` | No |
| `queued` | Waiting on one or more normal prerequisites | `prerequisite_open(id)` | No |
| `ready` | Eligible for the current actor and policy | `eligible` or `operator_only` | No |
| `claimed` | Lease exists; runtime has not accepted | `attempt_unaccepted` | No |
| `in_progress` | Current attempt is accepted/running | `attempt_active` | No |
| `needs_verification` | Required technical gates are open or stale | typed gate reason | No |
| `awaiting_review` | Technical proof exists; independent review is open | `review_required` | No |
| `complete` | Proof/review passed; final closeout remains | `closeout_pending` | No |
| `closed` | Accepted terminal result with closeout committed | `terminal_closed` | Yes by default |
| `blocked` | Hard intervention prevents safe progress | hold, integrity, permission, or failed-review reason | No |
| `paused` | Explicit policy pause | `paused` | No |
| `retry_wait` | Recoverable failure before retry time | `retry_not_before` | No |
| `expired_review` | Attempt lease or hard budget expired and needs disposition | `expiry_review_required` | No |
| `cancelled` | Intentionally withdrawn with dependency disposition | `terminal_cancelled` | No by default |

Required precedence when multiple conditions apply:

1. `closed` or `cancelled`
2. `expired_review` or hard `blocked`
3. `draft`
4. active attempt phase and gate/review state
5. `paused` or `retry_wait`
6. `queued`
7. `ready`

All applicable reason codes must still be returned. For example, a paused
task with an open prerequisite displays `paused` and includes both
`paused` and `prerequisite_open(id)`. A task with a security hold and an open
prerequisite displays `blocked` and includes both reasons.

## 5. Parallel-agent operating model

### 5.1 Coordinator rules

- [ ] The coordinator owns this plan, the dispatch ledger, shared manifests,
  final integration, and release decisions.
- [ ] One agent receives one task ID at a time, with one exclusive write set,
  one input revision, and one acceptance gate.
- [ ] A task may be assigned only after all listed prerequisites have accepted
  evidence or an explicitly approved disposition.
- [ ] A task is not complete when code compiles. It is complete only when its
  acceptance checks and handoff are attached.
- [ ] The coordinator must stop overlapping edits to shared files. If two
  lanes need one shared file, one lane owns the edit and the other submits a
  patch request or fixture change.
- [ ] Finding-producing work always goes through independent review,
  reconciliation, and revalidation before successors start.
- [ ] Agents must not use `git reset --hard`, discard another lane's changes,
  force-break a live lock, or rewrite historical receipts/attempts to make a
  test pass.

### 5.2 Parallel lanes and exclusive ownership

| Lane | Primary owner | Exclusive write boundary | Must not edit |
| --- | --- | --- | --- |
| L0 contract | contract steward | `project/spec/`, M02 contract sections | Rust implementation |
| L1 domain | domain steward | `crates/domain/` | store migrations, CLI parsing |
| L2 store | persistence steward | `crates/store/`, schema migrations | domain policy definitions |
| L3 application | lifecycle steward | `crates/application/` | CLI/TUI rendering |
| L4 protocol/CLI | interface steward | `crates/protocol/`, `crates/cli/` | domain/store internals |
| L5 workflow/guidance | workflow steward | `project/spec/workflows/`, workflow assets, guidance adapters | lifecycle transitions |
| L6 TUI | terminal steward | `apps/tui/`, TUI fixtures | Rust service/domain |
| L7 validation | independent validator | test harnesses, validation reports, temporary fixtures | production implementation |
| L8 release | release steward | packaging, installer, release reports | product semantics |

Shared files such as `Cargo.lock`, protocol manifests, schema manifests,
command registries, and release manifests are coordinator-owned. Agents submit
the exact proposed change and its compatibility impact; the coordinator
integrates it after the lane gate.

### 5.3 Required agent handoff

Every completed task must report:

- [ ] Task ID and source revision.
- [ ] Exact changed files and exclusive write boundary.
- [ ] Invariants implemented or audited.
- [ ] Commands/tests run, including failures and whether they are unrelated.
- [ ] Fixture or migration impact.
- [ ] API/protocol/status/reason-code changes.
- [ ] Evidence of acceptance criteria.
- [ ] Remaining risks, deferrals, and the next safe task.
- [ ] Whether the task is ready for review, reconciliation, or revalidation.

## 6. Milestone and sprint dependency graph

```text
S00 Contracts and parity freeze
  ├── S01 Status evaluator and projections
  ├── S02 Transactional enforcement and overrides
  └── S03 Planning model, gates, and rollups
        └── S04 CLI/service/workflow/TUI parity
              └── S05 Isolation, migration, and end-to-end validation
                    └── S06 Release and cutover
```

S01 and the contract portion of S03 may begin after S00-T07. S02 may begin
after S00-T07 and can work in parallel with S01, but its final integration
waits for S01-T07. S04 begins only after the S01, S02, and S03 revalidation
gates. S05 and S06 are sequential release gates.

## 7. Sprint S00 — Contracts, v1 parity, and status policy freeze

Sprint goal: convert the audit into executable, versioned contracts before
implementation lanes make incompatible local decisions.

### S00-T01 — Build the v1-to-v2 parity matrix

- [ ] **Owner/lane:** L0 contract; may run in parallel with S00-T02–T05.
- [ ] **Dependencies:** none.
- [ ] **Context:** Compare v1 work records, readiness derivation, dependency
  behavior, sprint reports, review/audit gates, force reasons, summaries,
  handoff, and command routes against current v2 code and public routes.
- [ ] **Requirements:** Mark every item `preserve`, `rework`, `replace`,
  `defer`, or `historical-only`. For each retained item name the v2 authority,
  migration impact, and observable acceptance evidence.
- [ ] **Write boundary:** `project/WORKFLOW_PARITY.md`,
  `project/legacy-map/`, and M02 parity notes only.
- [ ] **Acceptance:** No v1 command or behavior is silently omitted; every
  known gap has an owner and a sprint task.

### S00-T02 — Freeze status taxonomy and reason codes

- [ ] **Owner/lane:** L0 contract with L1 domain review; parallel with S00-T01.
- [ ] **Dependencies:** none.
- [ ] **Context:** The written status model already distinguishes normal
  waiting, intervention, policy pause, retry, gate, review, and expiry, but
  implementation precedence and reason coverage are incomplete.
- [ ] **Requirements:** Define stable reason-code identifiers, primary-status
  precedence, all-reasons ordering, actor-specific claimability, next action,
  next status-change time, and dependency unblocking semantics.
- [ ] **Write boundary:** `project/STATUS_MODEL.md`,
  `project/spec/transition-table.md`, protocol fixtures.
- [ ] **Acceptance:** Every status has a canonical input predicate, an
  invalid-state example, a next action, and a fixture for combined reasons.

### S00-T03 — Define legal transitions and audited override policy

- [ ] **Owner/lane:** L0 contract; parallel with S00-T01–T02.
- [ ] **Dependencies:** none.
- [ ] **Context:** v1 allowed reason-coded gate force; v2 currently has holds
  but no complete public override operation.
- [ ] **Requirements:** Define legal/illegal transitions for publish, claim,
  accept, start, evidence, verify, review, close, release, pause, resume,
  cancel, reopen, expiry disposition, gate force, and dependency waiver.
  Define actor role, reason code, comment, scope, target revision, expiry,
  evidence, and audit requirements for every override.
- [ ] **Write boundary:** transition table, policy fixture, error registry.
- [ ] **Acceptance:** No transition can be expressed as direct display-status
  assignment; overrides modify canonical inputs and trigger recomputation.

### S00-T04 — Reconcile acceptance profiles and gate vocabulary

- [ ] **Owner/lane:** L0 contract with L3 application and L1 domain review.
- [ ] **Dependencies:** none.
- [ ] **Context:** Rust focused profile uses `summary`; the acceptance fixture
  uses `audit`. Reviewed and operator profiles also need explicit behavior.
- [ ] **Requirements:** Choose the canonical gate names, profile IDs and
  versions, required/optional semantics, review requirements, receipt kinds,
  close-intent rules, failed-evidence retention, and invalidation rules.
- [ ] **Write boundary:** `project/spec/acceptance-profiles.json`, gate
  fixtures, relevant domain contract sections.
- [ ] **Acceptance:** Domain code, store schema, protocol DTOs, CLI, TUI, and
  fixtures agree on the same profile and gate definitions.

### S00-T05 — Decide and document the sprint/cycle target

- [ ] **Owner/lane:** coordinator with L0 contract and L3 application.
- [ ] **Dependencies:** none.
- [ ] **Context:** Current v2 has a fixed milestone/sprint/task facade. The
  additive work-model/3 contracts separate decomposition from cycles, but the
  public adapter is not complete.
- [ ] **Requirements:** Choose the target compatibility strategy: either a
  cycle-backed sprint implementation with `work create --kind sprint` as a
  compatibility route, or a deliberately bounded fixed hierarchy with a
  dated v3 follow-up. For the full M02 target, preserve the old command path
  while making cycle identity, assignment, activation, completion, and carry
  over explicit.
- [ ] **Write boundary:** M02 decision record and v3 migration notes.
- [ ] **Acceptance:** The decision names persistence tables, public routes,
  compatibility behavior, migration behavior, and rollback behavior.

### S00-T06 — Create the conformance fixture matrix

- [ ] **Owner/lane:** L7 validation with L0 contract; can run after S00-T02–T04.
- [ ] **Dependencies:** S00-T02, S00-T03, S00-T04.
- [ ] **Context:** Existing tests cover slices but not the full milestone with
  independent sprint/task gates and overlapping dependency conditions.
- [ ] **Requirements:** Create fixtures for hierarchy, dependency chains,
  cycles, paused plus open dependency, hard hold plus open dependency,
  failed receipt, stale receipt, independent review, forced gate, dependency
  waiver, expiry, retry, cancellation, reopen, and corrupt/orphan diagnostics.
- [ ] **Write boundary:** test fixtures and validation reports only.
- [ ] **Acceptance:** Every normative status and transition has at least one
  positive and one negative fixture.

### S00-T07 — Independent contract review and revalidation

- [ ] **Owner/lane:** L7 validator; no implementation edits.
- [ ] **Dependencies:** S00-T01 through S00-T06.
- [ ] **Context:** This is the gate before concurrent implementation changes.
- [ ] **Requirements:** Review parity, status precedence, gate vocabulary,
  override authority, cycle strategy, and project isolation. Record findings
  with severity and disposition.
- [ ] **Write boundary:** review and revalidation reports.
- [ ] **Acceptance:** All critical findings are fixed in S00 artifacts or have
  an explicit owner and a gate that blocks release. S01–S03 may start only
  after this task passes.

## 8. Sprint S01 — One deterministic status evaluator and projection

Sprint goal: make every read path and every mutation decision use the same
status contract, with no hidden precedence or actor-role divergence.

### S01-T01 — Complete the pure evaluator

- [ ] **Owner/lane:** L1 domain; parallel with S01-T03–T04 after S00-T07.
- [ ] **Dependencies:** S00-T02, S00-T03.
- [ ] **Context:** `evaluate_status` exists, but the contract requires one
  authoritative result containing status, all reasons, claimability, next
  action, timing, gates, attempt, and affected dependents.
- [ ] **Requirements:** Implement the complete `StatusDecision` predicate over
  lifecycle, dependencies, holds, dispatch policy, attempt, gates, actor, and
  `as_of`. Stable-sort reasons and preserve primary reason separately.
- [ ] **Write boundary:** `crates/domain/src/` status and reason types/tests.
- [ ] **Acceptance:** Domain tests prove the exact precedence table and no
  client can write display status.

### S01-T02 — Correct paused, queued, blocked, and retry precedence

- [ ] **Owner/lane:** L1 domain; may proceed after S01-T01 contract shape.
- [ ] **Dependencies:** S01-T01.
- [ ] **Context:** Current code checks open dependencies before paused policy,
  contrary to the written contract.
- [ ] **Requirements:** A paused item displays `paused` with prerequisite
  reasons retained. Hard holds display `blocked` with dependency reasons
  retained. Retry time applies only when no higher-priority intervention or
  active-attempt state exists.
- [ ] **Write boundary:** domain evaluator and focused tests.
- [ ] **Acceptance:** Combined-condition tests pass and the same result is
  returned through direct, service, CLI, and TUI status reads.

### S01-T03 — Thread actor role and policy into status

- [ ] **Owner/lane:** L3 application plus L4 protocol; parallel with S01-T01.
- [ ] **Dependencies:** S00-T02.
- [ ] **Context:** Actor-specific claimability exists in the domain, but status
  service paths currently default to an agent actor in important cases.
- [ ] **Requirements:** Carry actor identity, role, session, project scope,
  and dispatch authority through status reads and claim checks. `operator_only`
  must be a policy reason, not a synonym for blocked.
- [ ] **Write boundary:** `crates/application/`, protocol DTOs, service/CLI
  request mapping owned by L4.
- [ ] **Acceptance:** Agent, reviewer, and operator receive correct
  claimability and next action for the same work item.

### S01-T04 — Integrate schedule and timer reasons

- [ ] **Owner/lane:** L1 domain with L3 application; parallel with S01-T02.
- [ ] **Dependencies:** S00-T02.
- [ ] **Context:** v3 schedule contracts exist but are not wired into the
  current status evaluator; `next_status_change_at` is incomplete.
- [ ] **Requirements:** Add not-before, due, retry, lease, hard-budget, and
  expiry timing without conflating product due dates with attempt expiry.
  Return an `overdue` reason/badge without changing claim or lease semantics.
- [ ] **Write boundary:** domain schedule/status modules and application
  snapshot assembly.
- [ ] **Acceptance:** Virtual-clock tests prove timer-driven status changes and
  that due dates never steal or extend an attempt.

### S01-T05 — Replace container blocked state with rollup projection

- [ ] **Owner/lane:** L1 domain plus L3 application; parallel with S01-T03.
- [ ] **Dependencies:** S00-T05, S01-T01.
- [ ] **Context:** Milestones and sprints are planning containers, not claimable
  tasks; `non_executable_container` currently renders as blocked.
- [ ] **Requirements:** Define container rollup state and counts for child
  tasks, child sprints, blockers, open gates, active attempts, overdue work,
  and closeout readiness. Keep container lifecycle separate from task status.
- [ ] **Write boundary:** domain rollup types, application projection, DTOs.
- [ ] **Acceptance:** A container with queued children is not shown as a hard
  blocked task; rollup totals and blocker summaries are exact.

### S01-T06 — Add evaluator conformance and property tests

- [ ] **Owner/lane:** L7 validation; parallel with S01-T05 once DTO shape is stable.
- [ ] **Dependencies:** S01-T01, S01-T02, S01-T03, S01-T04.
- [ ] **Context:** Status is a high-risk contract and must survive future
  changes in dependency, gate, and attempt code.
- [ ] **Requirements:** Test idempotence, stable reasons, monotonic terminal
  behavior, closed-only dependency satisfaction, no status assignment, and
  invariance under unrelated historical evidence.
- [ ] **Write boundary:** domain/application test harnesses and reports.
- [ ] **Acceptance:** Property and fixture tests pass with the published
  transition table as the oracle.

### S01-T07 — Review, reconcile, and revalidate status

- [ ] **Owner/lane:** L7 validator.
- [ ] **Dependencies:** S01-T01 through S01-T06.
- [ ] **Acceptance:** An independent reviewer confirms one evaluator, one
  precedence contract, all-reason preservation, actor-aware claimability, and
  container rollups. Revalidation passes before S02/S04 integration.

## 9. Sprint S02 — Transactional enforcement, dependencies, and overrides

Sprint goal: prevent lower-level mutations from bypassing the status contract.

### S02-T01 — Enforce claim eligibility inside the write transaction

- [ ] **Owner/lane:** L2 store with L3 application review.
- [ ] **Dependencies:** S00-T07, S01-T01, S01-T03.
- [ ] **Context:** The current claim candidate query checks lifecycle,
  dispatch, retry time, active attempt, and closed prerequisites, but must be
  proven against active holds and every other eligibility input.
- [ ] **Requirements:** Re-read the canonical snapshot under the write
  transaction, evaluate the same eligibility predicate, reject stale revision,
  active hold, paused/operator policy, invalid gate, actor-role mismatch, and
  open dependency. Preserve idempotent operation replay.
- [ ] **Write boundary:** store claim transaction and application claim adapter.
- [ ] **Acceptance:** A task marked blocked by a hold cannot be claimed through
  direct, service, CLI, or TUI paths. Competing claimers still produce one
  winner.

### S02-T02 — Enforce status before finish, close, release, and reopen

- [ ] **Owner/lane:** L3 application with L2 store transaction support.
- [ ] **Dependencies:** S01-T01, S01-T04.
- [ ] **Context:** Read status and mutation authorization must not diverge at
  closeout or attempt release.
- [ ] **Requirements:** Re-evaluate fence, attempt phase, receipts, gate
  state, review state, close intent, dependency disposition, and expected
  revision inside each mutation. Release must not erase holds or operator-only
  policy.
- [ ] **Write boundary:** application lifecycle operations and store write
  helpers; no CLI-specific policy.
- [ ] **Acceptance:** Every illegal transition returns a typed error and leaves
  state unchanged except for the recorded operation outcome.

### S02-T03 — Harden typed dependency mutations

- [ ] **Owner/lane:** L2 store plus L1 domain.
- [ ] **Dependencies:** S00-T02, S00-T05, S01-T01.
- [ ] **Context:** Current edges have cycle protection, but endpoint kind and
  dependency policy need explicit enforcement for the new planning model.
- [ ] **Requirements:** Define which edges are allowed between tasks, sprints,
  milestones, and cycles. Reject self edges, cross-project edges, duplicate
  edges, cycles, terminal mutation, and policy-incompatible satisfaction.
  Preserve expected revision and operation idempotency.
- [ ] **Write boundary:** dependency schema/store/domain validation.
- [ ] **Acceptance:** Direct-task dependency fixtures and invalid container
  dependency fixtures agree with the chosen cycle strategy.

### S02-T04 — Implement audited gate force and dependency waiver

- [ ] **Owner/lane:** L3 application with L1 policy and L2 persistence.
- [ ] **Dependencies:** S00-T03, S00-T04, S01-T01.
- [ ] **Context:** User-approved exceptions are needed, but direct status edits
  would destroy determinism and auditability.
- [ ] **Requirements:** Add explicit operations for forcing a named gate and
  waiving a named dependency edge. Require authorized actor, stable reason,
  comment, target revision, scope, optional expiry, and supporting evidence.
  Forced gates must remain visibly forced; waivers must remain edge-specific.
- [ ] **Write boundary:** application/store override records, domain policy,
  protocol request/response types.
- [ ] **Acceptance:** Unauthorized actors are rejected; authorized decisions
  recompute status deterministically and are visible in readback and audit.

### S02-T05 — Implement review decisions and failed-history retention

- [ ] **Owner/lane:** L3 application plus L4 public route.
- [ ] **Dependencies:** S00-T03, S00-T04, S02-T02.
- [ ] **Context:** Independent review exists in the domain, but public review
  inspection and decision routes are unavailable.
- [ ] **Requirements:** Expose review open/show/approve/reject/return paths,
  enforce reviewer independence, retain rejected review and failed evidence,
  bind decisions to work, attempt, fence, source snapshot, configuration, and
  policy version.
- [ ] **Write boundary:** application review operations and protocol/CLI route.
- [ ] **Acceptance:** Review decisions cannot be replayed against a different
  attempt or silently turn failed evidence into passing proof.

### S02-T06 — Add mutation race and unknown-outcome tests

- [ ] **Owner/lane:** L7 validation; parallel with S02-T04–T05 after interfaces stabilize.
- [ ] **Dependencies:** S02-T01, S02-T02, S02-T03.
- [ ] **Context:** Concurrent agents and interrupted processes are the main
  source of lifecycle corruption.
- [ ] **Requirements:** Test concurrent claim, hold versus claim, dependency
  close versus claim, review versus close, override versus stale revision,
  crash after commit, duplicate operation, and unknown client outcome/readback.
- [ ] **Write boundary:** temporary test fixtures and validation reports.
- [ ] **Acceptance:** No race permits a bypass, duplicate active attempt,
  duplicate decision, or lost audit event.

### S02-T07 — Review, reconcile, and revalidate enforcement

- [ ] **Owner/lane:** L7 validator.
- [ ] **Dependencies:** S02-T01 through S02-T06 and S01-T07.
- [ ] **Acceptance:** Mutation paths demonstrably use the same canonical
  eligibility rules as status reads. Critical bypass findings block S03/S04.

## 10. Sprint S03 — Planning model, gates, cycles, and rollups

Sprint goal: make the requested milestone/sprint/task planning experience a
real application capability rather than a thin compatibility tree.

### S03-T01 — Complete project-local hierarchy creation and editing

- [ ] **Owner/lane:** L3 application with L2 store and L4 CLI.
- [ ] **Dependencies:** S00-T05, S01-T05, S02-T03.
- [ ] **Context:** Current creation supports milestone/sprint/task but has
  limited edit semantics and no full planning validation surface.
- [ ] **Requirements:** Support project-scoped create/edit/archive/reopen for
  milestones, sprints, and tasks; validate parent, project, execution mode,
  and terminal mutation rules; preserve revisions and audit events.
- [ ] **Write boundary:** application planning use cases, store adapters, CLI
  request mapping owned by L4.
- [ ] **Acceptance:** A fresh project can create the complete sample tree with
  no cross-project parent or dependency leakage.

### S03-T02 — Add per-work acceptance profile and gate selection

- [ ] **Owner/lane:** L3 application plus L1 domain and L4 interface.
- [ ] **Dependencies:** S00-T04, S02-T02.
- [ ] **Context:** Current CLI hardcodes focused profile even though the service
  parser knows more than one profile.
- [ ] **Requirements:** Allow task-level and container-level profile selection,
  version pinning, required gate declaration, review requirement, evidence
  kinds, and closeout policy. Reject unknown profile versions.
- [ ] **Write boundary:** acceptance profile domain/application/store schema,
  protocol and CLI flags.
- [ ] **Acceptance:** Two sibling tasks may have different valid profiles and
  status derives the correct gate requirements for each.

### S03-T03 — Complete receipt, gate, review, and closeout wiring

- [ ] **Owner/lane:** L3 application with L1 domain.
- [ ] **Dependencies:** S00-T04, S02-T02, S02-T05.
- [ ] **Context:** Receipt identity and closeout foundations exist, but the full
  profile-driven path must be exercised for every task.
- [ ] **Requirements:** Bind receipts to work, attempt, fence, gate, source,
  configuration, and policy; classify failed/stale/passed results; require
  close intent and independent review where configured; retain history.
- [ ] **Write boundary:** application evidence/closeout and domain validation.
- [ ] **Acceptance:** A task cannot become closed from prose, an unrelated
  receipt, a stale fence, or a self-review.

### S03-T04 — Integrate cycle-backed sprint persistence

- [ ] **Owner/lane:** L2 store with L3 planning adapter.
- [ ] **Dependencies:** S00-T05, S02-T03.
- [ ] **Context:** Work-model/3 has cycle and assignment contracts but is not
  fully exposed. The target must support multiple sprints without losing the
  familiar command path.
- [ ] **Requirements:** Persist cycle identity, lifecycle, schedule, assignment,
  activation policy, carry-over, completion, and cancellation. Keep a
  compatibility mapping for legacy sprint work IDs and define migration.
- [ ] **Write boundary:** v3 schema/store adapter and planning application;
  no direct CLI SQLite access.
- [ ] **Acceptance:** Multiple sprints can be planned, activated, completed,
  carried over, and queried without creating duplicate live assignments.

### S03-T05 — Implement deterministic milestone and sprint rollups

- [ ] **Owner/lane:** L1 domain plus L3 application.
- [ ] **Dependencies:** S01-T05, S03-T01, S03-T04.
- [ ] **Context:** Containers need useful planning state and exact child totals.
- [ ] **Requirements:** Compute child counts, dependency blockers, active
  attempts, gate gaps, review gaps, overdue work, completion percentage,
  critical blockers, and next candidates from one revisioned snapshot.
  Never fabricate data for empty or corrupt children.
- [ ] **Write boundary:** domain rollup evaluator and application DTOs.
- [ ] **Acceptance:** Rollups remain correct across pagination, retries,
  cancellations, child reassignment, and corrupted/orphaned rows.

### S03-T06 — Add planning validation and launch readiness

- [ ] **Owner/lane:** L3 application with L0 policy and L4 CLI.
- [ ] **Dependencies:** S03-T01 through S03-T05.
- [ ] **Context:** v1 exposed launch/current/status/report concepts; v2 needs
  explicit readiness rather than starting a sprint by convention.
- [ ] **Requirements:** Validate title/description, parent, gate profile,
  dependencies, cycle assignment, dates, dispatch policy, missing owners,
  invalid gates, and unresolved hard holds. Return typed readiness gaps and a
  trusted launch action.
- [ ] **Write boundary:** application planning/readiness; protocol/CLI mapping.
- [ ] **Acceptance:** A sprint cannot activate with invalid children or
  unresolved required planning gaps; readiness never mutates status directly.

### S03-T07 — Review, reconcile, and revalidate planning

- [ ] **Owner/lane:** L7 validator.
- [ ] **Dependencies:** S03-T01 through S03-T06 and S02-T07.
- [ ] **Acceptance:** Hierarchy, cycle persistence, profiles, gates, rollups,
  and launch readiness pass fresh-DB, upgrade, and cross-project fixtures.

## 11. Sprint S04 — Public workflow, CLI, service, and TUI parity

Sprint goal: expose the completed behavior through the supported human and
agent surfaces without creating a second state machine.

### S04-T01 — Restore versioned workflow discovery

- [ ] **Owner/lane:** L5 workflow/guidance with L4 CLI.
- [ ] **Dependencies:** S00-T01, S03-T06.
- [ ] **Context:** `bwrk workflows show` is currently unavailable even though
  workflow assets and the plan contract expect trusted discovery.
- [ ] **Requirements:** Add versioned workflow registry/show/list behavior,
  resolve references through the Rust application, validate command paths and
  versions, and return typed unknown/incompatible errors.
- [ ] **Write boundary:** workflow assets, workflow application adapter,
  protocol and CLI route owned by L4.
- [ ] **Acceptance:** An agent can discover the plan, claim, finish, review,
  audit, handoff, health, and memory workflows without reading stale files.

### S04-T02 — Implement sprint create, launch, current, status, board, report, close

- [ ] **Owner/lane:** L4 CLI/service with L3 application.
- [ ] **Dependencies:** S03-T04, S03-T05, S03-T06.
- [ ] **Context:** These are key v1 routes currently marked unavailable.
- [ ] **Requirements:** Add JSON and human output, project-local selection,
  expected revisions, typed readiness gaps, rollup totals, blockers,
  reservations/attempts, gate summaries, and closeout evidence.
- [ ] **Write boundary:** CLI/service route modules; lifecycle authority remains
  in application/store.
- [ ] **Acceptance:** Sprint commands operate on the selected project only and
  return one revision-consistent response.

### S04-T03 — Implement work list/show/next/ready/parallel/review-candidates

- [ ] **Owner/lane:** L4 CLI/service with L3 projection support.
- [ ] **Dependencies:** S01-T05, S02-T01, S03-T05.
- [ ] **Context:** v1 had richer work queues and reports than the current v2
  surface.
- [ ] **Requirements:** Add bounded pagination, exact totals, dependency and
  gate reasons, actor-aware claimability, review candidates, and safe next
  actions. Do not infer status in CLI code.
- [ ] **Write boundary:** application read DTOs and CLI/service adapters.
- [ ] **Acceptance:** List/show/next/ready agree on status and reasons for the
  same revision and never show stale project data.

### S04-T04 — Expose review, force, waiver, pause, resume, and hold operations

- [ ] **Owner/lane:** L4 CLI/service; application operations owned by L3.
- [ ] **Dependencies:** S02-T04, S02-T05, S03-T03.
- [ ] **Context:** Operator decisions must be possible without direct database
  edits or ambiguous `--force` flags.
- [ ] **Requirements:** Add explicit commands with actor role, reason,
  comment, target ID, expected revision, and JSON readback. Make denied
  authority and stale revision visible.
- [ ] **Write boundary:** command parser/service adapter; no semantic logic in
  CLI handlers.
- [ ] **Acceptance:** Every override has an audit event and deterministic
  status readback; plain agents cannot perform operator-only actions.

### S04-T05 — Restore guided agent plan/claim/finish parity

- [ ] **Owner/lane:** L5 workflow/guidance with L4 CLI.
- [ ] **Dependencies:** S04-T01, S04-T03, S04-T04.
- [ ] **Context:** The agent must receive trusted context and one safe next
  action instead of guessing from raw statuses.
- [ ] **Requirements:** Connect route/context/plan/claim/checkpoint/evidence/
  review/finish/release/handoff/health workflows to current status, gates,
  attempts, and project scope. Preserve conditional directives and no-goal
  behavior.
- [ ] **Write boundary:** workflow/guidance assets and application adapter;
  no duplicate lifecycle evaluator.
- [ ] **Acceptance:** An unfamiliar agent can follow the loop without a custom
  parent prompt and cannot skip a required gate through guidance.

### S04-T06 — Update the terminal UI to the same contract

- [ ] **Owner/lane:** L6 TUI; may start UI scaffolding after S04-T02 DTOs stabilize.
- [ ] **Dependencies:** S04-T02, S04-T03, S04-T04.
- [ ] **Context:** The redesigned terminal surface must display the new states
  and planning hierarchy without direct database access or fabricated rows.
- [ ] **Requirements:** Render milestone/sprint/task rollups, distinct status
  badges, all reasons, gate/review diagnostics, holds, project scope, cycle
  actions, and corruption diagnostics. Use the existing Rust service API.
- [ ] **Write boundary:** `apps/tui/` and TUI fixtures only.
- [ ] **Acceptance:** 80x24, 100x32, and 144x40 terminals remain usable;
  resize, UTF-8 paste, multiline JSON, dialog cancellation, and request exit
  preserve state and never issue an unintended mutation.

### S04-T07 — Review, reconcile, and revalidate public parity

- [ ] **Owner/lane:** L7 validator.
- [ ] **Dependencies:** S04-T01 through S04-T06 and S03-T07.
- [ ] **Acceptance:** CLI, service, TUI, and agent guidance agree on one
  status projection, command registry, project identity, and audit behavior.

## 12. Sprint S05 — Project isolation, corruption tolerance, migration, and E2E

Sprint goal: make the completed planning model safe on real project folders,
with damaged historical data and concurrent agents.

### S05-T01 — Harden project-local identity and database selection

- [ ] **Owner/lane:** L3 application with L4 CLI/service.
- [ ] **Dependencies:** S04-T02, S04-T06.
- [ ] **Context:** A stale local metadata file previously selected a database
  from another project, causing a historical sprint name to leak into the
  current dashboard.
- [ ] **Requirements:** Resolve project from the working directory by default;
  require explicit initialization; fail with a precise “run `bwrk init`”
  message when metadata is absent; validate project identity against the
  database; reject stale or foreign metadata; never silently fall back to a
  global project.
- [ ] **Write boundary:** project discovery, CLI bootstrap, service selection,
  and isolation tests.
- [ ] **Acceptance:** Two disposable folders cannot see, mutate, or report
  each other’s milestones, sprints, tasks, attempts, or memory.

### S05-T02 — Make dashboards corruption-tolerant and diagnostic

- [ ] **Owner/lane:** L3 application plus L6 TUI.
- [ ] **Dependencies:** S01-T05, S04-T06.
- [ ] **Context:** A malformed or orphaned sprint/milestone should not prevent
  the dashboard from opening.
- [ ] **Requirements:** Preserve valid rows, surface corrupt/orphaned records
  as red diagnostic entries with stable reason codes, expose repair guidance,
  and keep mutations disabled only for the affected record or unsafe scope.
  Never invent replacement work.
- [ ] **Write boundary:** application status diagnostics and TUI presentation;
  repair mutations remain explicit doctor/store operations.
- [ ] **Acceptance:** Dashboard opens with malformed parent, dependency,
  profile, and status rows; valid siblings remain actionable; JSON exposes the
  same diagnostics.

### S05-T03 — Implement v1 import and parity preservation

- [ ] **Owner/lane:** migration steward; parallel with S05-T04 after schema stable.
- [ ] **Dependencies:** S00-T01, S03-T04, S03-T03.
- [ ] **Context:** v1 contains work, dependencies, reservations, evidence,
  reviews, force records, summaries, and memory references that need explicit
  mapping.
- [ ] **Requirements:** Add dry-run/export/import with unsupported-record
  reporting, preserve failed evidence and attempts, map force records into
  audited decisions where valid, and never overwrite existing project data
  without an explicit operation.
- [ ] **Write boundary:** migration modules, fixtures, and reports.
- [ ] **Acceptance:** Representative v1 fixtures import into a fresh v2
  project with no silent loss and a machine-readable disposition report.

### S05-T04 — Run the real service-backed lifecycle fixture

- [ ] **Owner/lane:** L7 validation with a separate service operator.
- [ ] **Dependencies:** S04-T07, S05-T01, S05-T02.
- [ ] **Context:** Unit tests cannot prove the full Rust-service-to-TUI path.
- [ ] **Requirements:** In a disposable project, create milestone/sprints/
  tasks; add dependencies; claim, accept, start, evidence, verify, review,
  finish, close; exercise release, expiry, blocked actions, revision changes,
  unknown operations, and readback. Use genuine service-valid receipts.
- [ ] **Write boundary:** disposable test project and validation report only.
- [ ] **Acceptance:** No fabricated receipt or dashboard fixture is used; all
  actions are observed through the supported binary and service API.

### S05-T05 — Run concurrency and failure-boundary validation

- [ ] **Owner/lane:** L7 validation; parallel with S05-T03–T04 where fixtures allow.
- [ ] **Dependencies:** S02-T06, S04-T07.
- [ ] **Requirements:** Test multiple parallel agents, stale revisions,
  claim races, hold races, dependency races, service restart, interrupted
  request, expired lease, failed review, malformed rows, and reader behavior
  during writes. Measure queue wait and transaction hold separately.
- [ ] **Write boundary:** temporary load/fault harnesses and reports.
- [ ] **Acceptance:** No duplicate current attempt, cross-project read,
  status bypass, lost audit event, or fabricated recovery occurs.

### S05-T06 — Update parity, operator, and user documentation

- [ ] **Owner/lane:** L0 contract plus L5 workflow.
- [ ] **Dependencies:** S04-T07, S05-T01, S05-T03.
- [ ] **Requirements:** Document final command paths, status meanings,
  overrides, profile selection, sprint lifecycle, project initialization,
  corruption diagnostics, migration limitations, and release behavior.
  Replace “future” wording for features actually completed and keep approved
  deferrals explicit.
- [ ] **Write boundary:** `project/`, user-facing docs, and release notes.
- [ ] **Acceptance:** A new user can follow the documented flow from an empty
  project to a closed task without relying on internal terminology.

### S05-T07 — Review, reconcile, and revalidate real-project behavior

- [ ] **Owner/lane:** L7 validator.
- [ ] **Dependencies:** S05-T01 through S05-T06.
- [ ] **Acceptance:** Project isolation, corruption tolerance, migration,
  service-backed lifecycle, and concurrent validation pass on fresh temporary
  projects. Any failed gate blocks S06.

## 13. Sprint S06 — Release, installer, and cutover

Sprint goal: publish the completed behavior so future installers contain the
same planning/status implementation that passed validation.

### S06-T01 — Run full Rust and TypeScript gates

- [ ] **Owner/lane:** L7 validation.
- [ ] **Dependencies:** S05-T07.
- [ ] **Requirements:** Run formatting, locked workspace tests, CLI build,
  TUI typecheck/tests, installer generation/checks, shell/node syntax checks,
  premium/responsive validators, and all M02 conformance tests.
- [ ] **Acceptance:** No changed-file formatting or test failures remain; any
  unrelated baseline failure is recorded separately and does not mask M02.

### S06-T02 — Rebuild release artifacts and installer payloads

- [ ] **Owner/lane:** L8 release.
- [ ] **Dependencies:** S06-T01.
- [ ] **Context:** The installer embeds the compiled wizard and must include the
  full TUI tree, not just one entrypoint.
- [ ] **Requirements:** Rebuild Rust binary, TUI distribution, standalone
  wizard, installer payload, release metadata, `bin/bwrk`, `lib/boreal/tui`,
  and `share/boreal` layout. Verify byte identity where required.
- [ ] **Write boundary:** release output, installer manifests, release report.
- [ ] **Acceptance:** A new package contains the new init/dashboard/status
  behavior and does not depend on a stale globally installed binary.

### S06-T03 — Install and smoke-test a disposable prefix

- [ ] **Owner/lane:** L8 release plus L7 validator.
- [ ] **Dependencies:** S06-T02.
- [ ] **Requirements:** Install into a new prefix, invoke that absolute binary,
  initialize two projects, create the full sample hierarchy, run dashboard,
  exercise status/claim/finish, and verify project isolation.
- [ ] **Acceptance:** No shell-profile mutation is required; the disposable
  prefix contains the expected release files and the new behavior is present.

### S06-T04 — Run supported-platform release smoke tests

- [ ] **Owner/lane:** L8 release with platform validators.
- [ ] **Dependencies:** S06-T02.
- [ ] **Requirements:** Run the actual macOS release smoke test including BSD
  tar and supported Linux targets. Record ABI, executable, signing, download,
  and terminal-emulator limitations instead of implying fixture coverage.
- [ ] **Acceptance:** Every supported target has an explicit pass, failure,
  or approved limitation with owner and follow-up.

### S06-T05 — Final independent audit and cutover decision

- [ ] **Owner/lane:** L7 independent auditor; no implementation edits.
- [ ] **Dependencies:** S06-T01 through S06-T04.
- [ ] **Requirements:** Reconcile the v1 parity matrix, status contract,
  transition table, migration map, real-project evidence, release manifest,
  and known limitations. Confirm that no critical integrity, project-isolation,
  lifecycle, receipt, or guided-workflow gap is hidden by client behavior.
- [ ] **Write boundary:** audit report and cutover decision.
- [ ] **Acceptance:** Decision is exactly one of `ship`, `ship with approved
  deferrals`, or `do not ship`, with evidence links and named owners.

### S06-T06 — Publish release and update future-install instructions

- [ ] **Owner/lane:** coordinator plus L8 release.
- [ ] **Dependencies:** S06-T05 approves `ship` or `ship with approved deferrals`.
- [ ] **Requirements:** Commit the integrated changes, push the release branch,
  publish the release artifact/tag, update installer source metadata, and
  document the exact local upgrade/install command. Do not claim that `bwrk
  upgrade` exists unless the command is actually implemented and published.
- [ ] **Write boundary:** release metadata, changelog, installer docs, git
  release operations.
- [ ] **Acceptance:** A clean machine or disposable prefix can install the
  published artifact and observe the same M02 behavior.

## 14. Cross-sprint acceptance matrix

The milestone cannot close until every row has evidence.

- [ ] Create one project-local milestone with at least two sprints and four
  tasks, including dependencies crossing sprints.
- [ ] Create a second project with overlapping IDs and prove there is no data
  leakage in CLI, service, dashboard, TUI, memory, or database selection.
- [ ] Show `queued` for an open prerequisite and `blocked` for a hard hold.
- [ ] Show `paused` for a policy pause even when a prerequisite is open, while
  retaining both reasons.
- [ ] Show `retry_wait` until its timer, then re-evaluate claimability.
- [ ] Show `needs_verification`, `awaiting_review`, `complete`, and `closed` as
  distinct states with the correct next actions.
- [ ] Prove `complete` does not unblock a default close-only dependency.
- [ ] Prove `closed` unblocks only valid dependent edges.
- [ ] Prove `cancelled` does not silently satisfy dependencies.
- [ ] Prove a hard hold prevents claim through every mutation surface.
- [ ] Prove an agent cannot perform an operator override.
- [ ] Prove an authorized force/waiver is reason-coded, scoped, revisioned,
  idempotent, visible, and reversible only through an explicit operation.
- [ ] Prove stale receipts, stale fences, failed receipts, rejected reviews,
  and expired attempts remain queryable.
- [ ] Prove malformed/orphaned records appear as diagnostics without blocking
  valid dashboard rows.
- [ ] Prove sprint launch/readiness refuses invalid gates, cycles, missing
  required data, and unresolved hard holds.
- [ ] Prove CLI, JSON, service, TUI, and agent guidance agree at one revision.
- [ ] Prove all release artifacts contain the rebuilt installer and TUI assets.

## 15. Definition of done

M02 is complete only when all of the following are checked:

- [ ] S00–S06 sprint gates pass in order.
- [ ] Every task has a handoff with changed paths, checks, evidence, and risks.
- [ ] Every v1 retained behavior has an observable v2 parity result.
- [ ] Every intentional deferral has an owner, follow-up task, and user-visible
  limitation.
- [ ] Status is derived once, deterministically, and enforced in every
  state-changing transaction.
- [ ] Overrides change canonical, audited inputs rather than display status.
- [ ] Milestones and sprints have useful rollups rather than task-blocked
  placeholder states.
- [ ] Multiple parallel agents can work on disjoint tasks without editing
  overlapping ownership boundaries.
- [ ] A clean disposable project can install, initialize, plan, execute,
  verify, review, close, and reopen work without cross-project leakage.
- [ ] The published release and future installers contain the exact tested
  implementation.

## 16. Coordinator dispatch template

Copy this block into the dispatch ledger for every assignment:

```text
Task ID:
Agent/lane:
Input revision:
Prerequisites and evidence:
Exclusive write boundary:
Files explicitly off-limits:
Context and known findings:
Required implementation or audit:
Required tests/fixtures:
Acceptance evidence expected:
Handoff deadline:
Review owner:
Revalidation task:
Open risks or deferrals:
```

An agent may begin only after the coordinator fills the task ID, input
revision, prerequisites, write boundary, and review owner. The coordinator
must not assign an entire sprint as one undifferentiated task.

