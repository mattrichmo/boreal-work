# BWRK implementation handoff — lean product-completion plan

This is the implementation plan for the next engineering pass over the supplied
Boreal v2 source tree. It intentionally replaces the previous 22-sprint
validation-heavy execution ceremony with a smaller set of implementation
sprints. The original production-completion plan remains in this directory as
historical/reference context; this file is the active work list for this pass.

## Objective

Deliver a usable project-scoped Boreal Work product in the existing Rust
architecture:

- one project is selected from the current working directory and cannot leak
  data from another project;
- milestones contain tasks, tasks can be assigned to multiple cycles/sprints,
  and dependencies remain history-preserving;
- status, reasons, allowed actions, proof, review, recovery, and rollups come
  from canonical Rust/domain/store facts;
- overrides preserve the failed fact and record an explicit authorized reason;
- the CLI, service, TUI, and agent workflows use the same contracts;
- backup, restore, upgrade, and installation remain usable and recoverable.

Do not replace the Rust backend, port v1 wholesale, add a browser UI, fabricate
receipts, or declare completion because a typecheck passes. Keep the current
working tree as the base and make the smallest coherent changes that finish the
product.

## Working rules

- Work directly from the supplied source tree and preserve unrelated changes.
- Keep domain code free of storage, JSON, terminal, and process concerns.
- Keep the store responsible for transactions, revisions, identity boundaries,
  durable history, and project scope.
- Keep lifecycle policy in `crates/domain/` and `crates/application/`, never in
  TUI handlers or ad-hoc CLI predicates.
- Keep the TUI on the versioned Rust service API; it must not read SQLite.
- Preserve failed evidence, rejected reviews, expired attempts, and old
  approvals as history.
- Do not add a separate “dependency-blocked” lifecycle state. Use `queued`
  with explicit dependency reasons, and reserve `blocked` for intervention.
- Do not hand-edit generated installer output. Regenerate it from the existing
  installer build path.
- Mark an item done when its implementation is present in the source and
  handoff. Tests never block task completion; record sprint-close checks once
  at the end instead of repeating them after each task.

## Sprint 1 — Canonical requirements, outcomes, recovery, and integrity

**Goal:** make the database retain the facts needed to decide status and
authorization even when an observation, gate row, or attempt is damaged.

- [x] S1-T01 — Immutable acceptance profiles and pinned requirements.
  Update `crates/store/src/profiles.rs`, `crates/store/src/acceptance.rs`,
  `crates/store/src/migrations.rs`, and the corresponding schema/tests so a
  task pins a profile version and resolved required-gate definitions. A gate
  observation may be deleted without deleting the requirement.
- [x] S1-T02 — Submissions, review outcomes, accepted outcomes, and
  exceptions. Use `crates/store/src/acceptance.rs`, `crates/store/src/lib.rs`,
  `crates/protocol/src/models.rs`, and `crates/application/src/evidence.rs`.
  Preserve rejected review as a distinct intervention fact; do not reduce it
  to “proof missing.” Store typed, revision-bound exceptions and dependency
  waivers without fabricating receipts.
- [x] S1-T03 — Durable recovery obligations and external jobs. Extend
  `crates/store/src/recovery.rs`, `crates/store/src/jobs.rs`,
  `crates/store/src/maintenance.rs`, and `crates/store/src/operations.rs` so
  expiry, failed release, restore, and interrupted external work remain
  actionable after restart and have definitive readback.
- [x] S1-T04 — Atomic command registration, outcomes, and audit. Consolidate
  transaction boundaries in `crates/store/src/transactions.rs`,
  `crates/store/src/operations.rs`, `crates/store/src/audit.rs`, and
  `crates/application/src/operation_identity.rs`. Reusing an operation ID with
  a different payload must be rejected.
- [x] S1-T05 — Corruption-tolerant decoding. Update `crates/store/src/lib.rs`,
  `crates/store/src/status_evaluation.rs`, and the store read paths so an
  unreadable parent, profile, dependency, clock, or artifact quarantines only
  the affected scope. Valid sibling work must still load with a diagnostic.
- [x] S1-T06 — Integrate the new schema and update focused store fixtures. Keep
  migrations ordered and backward-readable. Run only focused migration,
  profile, operation, recovery, and corruption checks while implementing.

## Sprint 2 — Deterministic status, reasons, and server-owned actions

**Goal:** produce one decision result that every client can display and obey.

- [x] S2-T01 — Complete typed decision inputs in
  `crates/domain/src/decision_inputs.rs` and `crates/domain/src/status_evaluator.rs`.
  Include project identity, entity/proof revisions, requirements, evidence,
  review, attempt, expiry, dependency, integrity, caller, and source facts.
- [x] S2-T02 — Complete status precedence and structured reasons in
  `crates/domain/src/status_evaluator.rs`, `crates/domain/src/time_policy.rs`,
  `crates/domain/src/dependencies.rs`, and `crates/domain/src/acceptance.rs`.
  Keep `expired_review`, `blocked`, `queued`, `needs_verification`,
  `awaiting_review`, `complete`, and accepted `closed` distinct.
- [x] S2-T03 — Implement action authorization in
  `crates/domain/src/actions.rs` and `crates/application/src/status.rs`.
  Return allowed and denied actions with target, required revisions, caller
  context, confirmation requirements, and a human-readable denial reason.
- [x] S2-T04 — Complete dependency, reopen, override, and container rollup
  predicates in `crates/domain/src/dependencies.rs` and
  `crates/domain/src/rollups.rs`. A waiver preserves the original unmet edge;
  reopen creates a new proof generation and impact record.
- [x] S2-T05 — Make `crates/store/src/status_evaluation.rs` assemble the full
  canonical facts envelope rather than omitting actions when facts are
  available. Fail closed only when facts are genuinely unavailable.
- [x] S2-T06 — Make `crates/service/src/application_route.rs`,
  `crates/protocol/src/models.rs`, and CLI JSON responses expose the same
  decision, reasons, integrity, and action descriptors.

## Sprint 3 — Project identity, caller authority, and service boundaries

**Goal:** eliminate cross-project leakage and bind mutations to an actual
project-local caller context.

- [x] S3-T01 — Explicit initialization and workspace binding in
  `crates/cli/src/setup.rs`, `crates/cli/src/main.rs`, and
  `crates/cli/src/service.rs`. An uninitialized directory must explain how to
  run initialization; it must never select a project from global metadata.
- [x] S3-T02 — Resolve and validate database/workspace paths in
  `crates/cli/src/dashboard.rs` and service startup. Re-check confinement after
  canonicalization, reject symlink/`..` escapes, and bind caches, sockets,
  operations, source, and memory to the selected project.
- [x] S3-T03 — Replace caller-supplied actor identity with credential-backed
  principals and safe bootstrap in `crates/cli/src/service.rs`,
  `crates/store/src/identity.rs`, and session routes. Add revocation,
  delegation, role lookup, and review-independence checks.
- [x] S3-T04 — Bind service sockets, maintenance routes, and direct CLI routes
  to the same authenticated project context. Update
  `crates/service/src/application_route.rs`, `crates/cli/src/main.rs`, and
  `crates/cli/src/command_registry.rs`.
- [x] S3-T05 — Ensure late responses, pending operations, and cached rows from
  Project A cannot repaint Project B. Add project identity to readback and
  connection state.
- [x] S3-T06 — Add focused two-directory isolation and restart checks. These are
  implementation guardrails, not a separate long-running validation sprint.

## Sprint 4 — Execution, proof, review, closeout, and recovery

**Goal:** make the complete lifecycle truthful and transactional.

- [x] S4-T01 — Finish claim, accept, start, heartbeat, checkpoint, stop, and
  release enforcement in `crates/store/src/execution.rs`,
  `crates/store/src/recovery.rs`, and `crates/application/src/runtime.rs`.
  Re-read canonical facts inside each committing transaction.
- [x] S4-T02 — Separate execution lease, attempt fence, submitted result,
  review, accepted outcome, and recovery obligation. Do not let review consume
  an execution lease or let clearing `current_attempt` erase expiry recovery.
- [x] S4-T03 — Implement source/configuration identity and genuine verifier
  boundaries in `crates/application/src/evidence.rs`,
  `crates/application/src/evidence_store.rs`, and CLI evidence routes.
  Operator-authorized directory capture stores a bounded immutable workspace
  source. `gate policy publish` admits sequential project-authorized policy
  revisions with distinct configuration identities and a pinned verifier
  digest using atomic expected-revision registration. Evidence selects the
  policy matching the current attempt, verifies catalog metadata, unpacks the
  registered snapshot into private staging, rechecks the verifier, and records
  policy revision/version and verifier identity in readback. Tests remain
  sprint-close work and do not block this implementation item.
- [x] S4-T04 — Implement immutable submissions and finish/close intent. A
  finish with incomplete proof becomes closeout-pending, not success.
- [x] S4-T05 — Implement independent review, rejection, return, approval,
  revocation, typed exceptions, and edge-specific waivers in the application,
  store, protocol, and CLI layers.
- [x] S4-T06 — Implement release, reopen, cancellation, retry, expiry, and
  unknown-outcome readback with durable operation records.
- [x] S4-T07 — Add one lifecycle transition path and remove duplicate policy
  from direct CLI and TUI handlers.

## Sprint 5 — Milestones, cycles, dependencies, projections, and corruption UI

**Goal:** support the intended real workflow: one milestone, multiple parallel
cycles, tasks, gates, dependencies, carry-over, and truthful rollups.

- [x] S5-T01 — Implement project-scoped milestone/task operations in
  `crates/application/src/planning_v3.rs`, `crates/application/src/hierarchy.rs`,
  `crates/store/src/work_model_v3.rs`, and `crates/domain/src/work_model_v3.rs`.
- [x] S5-T02 — Implement cycle identity, lifecycle, assignments, commitment
  history, carry-over, and legacy sprint mapping without creating a second
  writable hierarchy.
- [x] S5-T03 — Implement typed dependency edits and transactional cycle
  detection. Default prerequisite satisfaction must require accepted `closed`,
  not merely `complete`.
- [x] S5-T04 — Implement planning profiles, readiness, scope changes, cycle
  closeout, cancellation, and replacement/waiver dispositions.
- [x] S5-T05 — Build revision-consistent projections, bounded queries, exact
  totals, and milestone/cycle rollups. Update store/application read models,
  not just TUI calculations.
- [x] S5-T06 — Make damaged rows render as degraded/quarantined with a red
  diagnostic and disabled mutation actions, while valid sibling rows remain
  selectable. Update `apps/tui/src/ui/dashboard.ts`, `apps/tui/src/ui/model.ts`,
  `apps/tui/src/ui/screen.ts`, and the service projection contract.
- [x] S5-T07 — Add attention queues for review, expiry, failed execution,
  operator holds, and corruption diagnostics.

## Sprint 6 — CLI, trusted workflows, and terminal product surface

**Goal:** make the supported workflow discoverable and usable without database
  edits or hidden parent prompts.

- [x] S6-T01 — Reconcile the public command registry and aliases in
  `crates/cli/src/command_registry.rs` and `crates/cli/src/main.rs`.
  Include project identity, planning, cycles, queues, status, history,
  evidence, review, recovery, memory, maintenance, and readback commands.
  Source search, review list/show, backup, maintenance-job show, and migration
  dry-run/verify/apply now have direct/service routes. Migration apply is
  Operator-authorized, confirmation- and revision-bound, and durably readable
  by operation ID. Legacy-only route gaps remain explicit in discovery.
- [x] S6-T02 — Route every mutating CLI command through the service/application
  action descriptors. Remove status-based client authorization shortcuts.
- [x] S6-T03 — Update workflow discovery and guidance in
  `crates/application/src/guidance.rs`, `crates/application/src/workflow_assets.rs`,
  and `project/spec/workflows/`. Guidance may explain an action but cannot
  authorize one.
- [x] S6-T04 — Update `apps/tui/src/client.ts`, `apps/tui/src/full-screen.ts`,
  `apps/tui/src/line-shell.ts`, and `apps/tui/src/ui/*` to consume server-owned
  actions, preserve project identity, show reasons, and handle unavailable
  service/pending operations without fabricated data. Project-scoped read-only
  cycle, review, memory-search, and recovery views now use versioned service
  responses; project, pending-operation, and unavailable-route views use the
  mounted snapshot without fabricating data.
- [x] S6-T05 — Complete small-terminal, resize, UTF-8 paste, multiline JSON,
  cancellation, and confirmation presentation behavior with focused checks.
- [x] S6-T06 — Remove internal implementation language from ordinary screens;
  keep raw enums, fences, SQL, protocol paths, and receipt JSON under advanced
  diagnostics.

## Sprint 7 — Memory, migration, backup, restore, and maintenance

**Goal:** preserve project history and make upgrades/recovery practical.

- [x] S7-T01 — Complete source intake, citations, project search, memory drafts,
  publication authority, and handoff in `crates/store/src/knowledge.rs`,
  `crates/application/src/knowledge.rs`, `crates/application/src/intake.rs`,
  and `crates/application/src/runtime.rs`.
- [x] S7-T02 — Make Git publication recoverable with commit readback and clear
  database/Git reconciliation states.
- [x] S7-T03 — Complete v1 import disposition in `crates/migration/src/lib.rs`.
  Preserve historical status/proof/review provenance; never convert prose into
  accepted v2 closeout.
- [x] S7-T04 — Complete online backup manifests, restore epochs, service
  reconciliation, read-only doctor, and revision-bound repair in the store,
  CLI, and maintenance routes. Restore uses operation-specific deterministic
  staging, stores a durable receipt before publication, and can finish a
  verified staged rename or reconcile the package journal from a published
  receipt after interruption. The shared database election keeps restore out
  while the service owns the project, and the old database is retained.
- [x] S7-T05 — Add commands and machine envelopes for migration, backup,
  restore, doctor, memory, and handoff with durable readback.
  `maintenance show` now reads project-scoped durable backup-job records via
  direct CLI and service, and reads restore job journals from a confined
  package path. Migration apply archives the source document, atomically
  applies the safe work graph through the store, and exposes durable
  operation readback through direct CLI and service.

## Sprint 8 — Packaging, installer, upgrade, and release handoff

**Goal:** ensure future installers actually contain and activate the completed
product.

- [x] S8-T01 — Rebuild the installer from the existing TypeScript source and
  preserve byte identity between `apps/tui/installer/wizard.cjs` and the
  embedded `install.sh` payload.
- [x] S8-T02 — Ensure the release builder copies the full `apps/tui/` tree,
  including `dist/ui/`, and keeps `bin/bwrk`, `lib/boreal/tui`, and
  `share/boreal` in the existing layout.
- [x] S8-T03 — Complete update/upgrade command behavior and durable readback;
  do not claim an upgrade path unless the installed binary and assets are the
  ones just built.
- [x] S8-T04 — Build a fresh disposable prefix, invoke its absolute `bwrk`,
  initialize two isolated projects, exercise the dashboard and lifecycle, and
  verify no global project leakage.
- [x] S8-T05 — Refreshed the implementation report, exact working-tree
  inventory, concise source-history note, archive manifest, and merge
  instructions for this implementation pass. All 48 task implementation and
  handoff items are checked, and all eight sprint areas are integrated in the
  combined source tree. Final sprint-close checks are summarized in the
  delivery report and do not block task completion. The archive is a text-only
  review snapshot; no release was published.

## Completion contract for the implementing model

The work is complete only when every checkbox above is either implemented or
explicitly marked blocked with a concrete reason. Do not turn blocked work into
green status. Do not let tests block source task completion or repeat full-
environment checks after each task. Run combined closeout checks once at
sprint end and report their outcomes. At the end, return:

1. a ZIP containing the changed source tree;
2. `IMPLEMENTATION_REPORT.md` describing what actually changed and any known
   blockers;
3. a file-by-file change list with paths and summaries;
4. a mini git log with commit IDs and messages;
5. the exact commands run and their outcomes;
6. a clear statement of what remains, if anything.
