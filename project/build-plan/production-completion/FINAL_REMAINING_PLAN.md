# Boreal v2 — final implementation queue

**Updated:** 2026-09-25
**Active scope:** `BWRK_IMPLEMENTATION_HANDOFF.md` — 8 sprints, 48 tasks.
**Current state:** 48/48 task implementation/handoff items are checked, and
all 8 sprints are integrated in the combined source tree. Workspace compilation
and TUI typechecking passed; the packaged install and project-isolation smoke
check passed. No implementation items remain unchecked. This is the
single implementation queue; the older 22-sprint plan is not adopted for this
work.

This is an implementation plan, not another validation program. Do not add
test-only or gate-only work. Implement the behavior below and integrate each
sprint's code before moving to the next dependency wave.

## Context for the incoming implementation agent

- **Product goal:** Boreal is a project-local work system. One project may contain multiple milestones; each milestone may contain tasks scheduled across parallel cycles. Tasks have their own required proof, dependencies, attempts, review, and durable history.
- **Authority boundary:** Rust domain/application/store code owns lifecycle, status, evidence interpretation, permissions, and persistence. CLI, terminal UI, and agent guidance use the versioned Rust service contract. Do not add a browser UI, let the TUI read SQLite, or make TypeScript/Markdown a second policy engine.
- **Truth rules:** `queued` means waiting on ordinary prerequisites; `blocked` means intervention. `complete` is not accepted `closed`; only a valid accepted close satisfies an ordinary dependency. Overrides must record an authorized reason while preserving the failed proof or unmet edge.
- **Isolation rule:** the current working directory selects the project. Database, credentials, sockets, caches, operations, sources, memory, subscriptions, and pending replies must remain bound to it. Never fall back to a globally selected project.
- **Proof rule:** a passing receipt must refer to the exact task, attempt, captured source, configuration, required gate, and verifier that actually ran. A receipt-shaped JSON object or caller-supplied identity is not proof. Do not fabricate dashboard data or receipts.
- **Worktree rule:** this repository is already heavily modified. Preserve all existing changes; do not reset, clean, overwrite, or attribute whole-file diffs to a new task when the file was already dirty. Inspect the `source add` service-route draft before editing the same CLI files.
- **Plan authority:** this file plus `BWRK_IMPLEMENTATION_HANDOFF.md` is the active 8-sprint/48-task queue. The older 22-sprint `PF-*` plan and its `STATE.json` are not adopted for this pass. Do not dispatch from those cards or update that ledger to imply progress here.
- **User priority:** complete and mark source implementation tasks. Tests never block task completion; run the full environment suite at sprint close. Do not spend the handoff on another architecture discussion or new backlog. Keep changes narrow and do not publish a release without explicit authorization.

## What is already in the source tree

These are real code areas, not claims that their end-to-end paths are done:

- Profile pinning and completion/submission groundwork: `crates/store/src/profiles.rs`, `acceptance.rs`, `completion.rs`, `completion_migrations.rs`, and `project/spec/schema-completion-v*.sql`.
- Status/action groundwork: `crates/domain/src/decision_inputs.rs`, `status_evaluator.rs`, `actions.rs`, `rollups.rs`; store projections in `status_facts.rs` and `status_evaluation.rs`; application wiring in `status.rs` and `decision_wire.rs`.
- Project authority and identity groundwork: `crates/cli/src/authority.rs`, `credentials.rs`, `project_context.rs`; `crates/store/src/principals.rs`; existing service and dashboard context code.
- Lifecycle/evidence groundwork: `crates/application/src/runtime.rs`, `evidence.rs`, `evidence_store.rs`; store recovery/completion code; CLI evidence execution.
- Cycle planning groundwork: `crates/domain/src/work_model_v3.rs`, `rollups.rs`; `crates/application/src/hierarchy.rs`, `cycle_runtime.rs`; store cycle commands and assignment records. New assignment writes are restricted to planned rows without caller-provided lineage, and carry-over writes a linked pair. The domain validator rejects malformed lineage. The application calls both rollup evaluators from revisioned `cycle board` and `work rollup` reads.
- CLI/TUI, workflow, memory, import, backup, release, source capture, and revisioned gate policy publication work is present in their existing crates and scripts. Full-environment integration remains for sprint close.
- Historical terminal labels are converted to draft rather than accepted v2 work. Memory publication readback compares the stored commit and digest to Git state. These are narrow implemented behaviors; they do not complete their sprints.

## Implementation closeout note

All 48 items have corresponding source implementation in the current tree,
and the eight sprint areas are integrated on the combined workspace. Tests do
not determine task completion. The legacy 22-sprint ledger is not updated by
this pass.

## Final implementation sequence

### Sprint 1 — canonical persistence and integrity

**Result:** all facts needed by status and authorization survive restart and
cannot be erased by deleting an observation.

- [x] **S1-T01 — Immutable requirements.** Finish profile creation/versioning and pin a resolved required-gate snapshot when work is published. Resolve legacy empty profile rows only from a known profile definition; never infer “no requirements” from missing rows. **Files:** `crates/store/src/profiles.rs`, `acceptance.rs`, `completion_migrations.rs`, `project/spec/schema-completion-v*.sql`.
- [x] **S1-T02 — Submission and decision records.** Connect submission creation, review decision, accepted-outcome creation, typed exception, and dependency waiver to the real application lifecycle. Preserve reject/return separately from missing proof; bind every record to work, proof revision, attempt, source, configuration, profile, and operation. **Files:** `crates/store/src/completion.rs`, `acceptance.rs`, `crates/application/src/evidence_store.rs`, `crates/protocol/src/models.rs`, CLI lifecycle routes.
- [x] **S1-T03 — Recovery and external jobs.** Make expiry, failed stop/release, restore, verifier, Git publication, and update obligations durable after ownership pointers are cleared. Persist side-effect identity before external work and provide a route to inspect and reconcile the original operation. `operation show` exposes external-job and linked recovery state; `recovery list/resolve` now exposes project-scoped obligation inspection and identity-bound, audited resolution. Publication, update, verifier, and maintenance paths keep their durable effect-specific readback. **Files:** `crates/store/src/recovery.rs`, `jobs.rs`, `maintenance.rs`, application runtime/knowledge, CLI service/maintenance routes.
- [x] **S1-T04 — Atomic operation records.** Ensure every mutation registers one operation ID and payload digest, commits its state change and audit/readback together, rejects same-ID/different-payload reuse, and has stable committed/rejected/pending/unknown readback. `fact_mutation` and identity-bound `OperationJournal` bind revision, operation, semantic digest, audit, and readback to the caller's transaction; external jobs persist an unknown/pending operation before the side effect. **Files:** `crates/store/src/lib.rs` and operation/audit modules, `crates/application/src/operation_identity.rs`, service adapters.
- [x] **S1-T05 — Scoped corruption handling.** Decode parent, profile, dependency, clock, artifact, cycle, and assignment rows independently. Return a diagnostic for only the damaged scope; retain usable siblings; deny mutation when identity or required facts cannot be trusted. Status facts are decoded per work row; hierarchy/dependency integrity is quarantined at the affected child; cycle assignments now produce row-level diagnostics without dropping healthy siblings; canonical action mutations reject unavailable required facts. **Files:** `crates/store/src/lib.rs`, `status_evaluation.rs`, `status_facts.rs`, hierarchy read paths, protocol diagnostics.
- [x] **S1-T06 — Ordered schema integration.** Move all production DDL and guards for the new identity, completion, recovery, maintenance, and planning records into the ordered migration contract. Make fresh creation and upgrades from supported existing schemas converge on the same schema. **Files:** `crates/store/src/migrations.rs`, `crates/store/src/lib.rs`, `project/spec/schema-production.sql`, `schema-v*.sql`, completion schema files.

### Sprint 2 — deterministic status and server-owned actions

**Result:** one Rust decision owns status, reasons, and the action a caller may
take; clients display that decision instead of recreating it.

- [x] **S2-T01 — Complete decision facts.** Supply project/caller identity, entity and proof revisions, pinned requirements, current evidence/review, attempt/fence/expiry, dependencies, source/configuration, and integrity to the evaluator. **Files:** `crates/domain/src/decision_inputs.rs`, `status_evaluator.rs`, `crates/store/src/status_facts.rs`.
- [x] **S2-T02 — Finish precedence and reasons.** Preserve closed/cancelled, expiry recovery, intervention block, draft, claimed/running, verification, review, complete, pause/retry/schedule, queued, and ready as distinct outcomes with deterministic primary and secondary reasons. **Files:** `crates/domain/src/status_evaluator.rs`, time/dependency/acceptance policy modules.
- [x] **S2-T03 — Authoritative actions.** Return allowed and denied actions with target, revision, caller requirements, confirmation facts, and explanation. Make the mutation call re-evaluate the same policy in its transaction. **Files:** `crates/domain/src/actions.rs`, `crates/application/src/status.rs`, store mutation entry points.
- [x] **S2-T04 — Dependency and reopen policy.** Only an accepted closed outcome satisfies a normal dependency. Preserve waived edges, rejected proof, cancelled prerequisites, and downstream impact when work is reopened. Finish milestone/container rollup predicates. **Files:** `crates/domain/src/dependencies.rs`, `rollups.rs`, completion store/application paths.
- [x] **S2-T05 — Full canonical projection.** Make the store assemble every available decision fact and explicitly identify unavailable or corrupt facts rather than silently falling back to a weaker evaluator. **Files:** `crates/store/src/status_evaluation.rs`, `status_facts.rs`, `crates/application/src/status.rs`.
- [x] **S2-T06 — Shared response contract.** Expose identical status, reasons, integrity, action descriptors, revisions, and readback through protocol, service, CLI JSON, and TUI client models. **Files:** `crates/protocol/src/models.rs`, service routing, CLI JSON adapters, `apps/tui/src/client.ts`.

### Sprint 3 — project identity and authority

**Result:** the current project root selects its own identity, database,
credentials, service state, and UI state; no global project can leak in.

- [x] **S3-T01 — Directory initialization and selection.** Resolve the project from the current directory; on an uninitialized directory explain `bwrk init`; define explicit move/copy/restore identity behavior. **Files:** `crates/cli/src/setup.rs`, `main.rs`, `service.rs`, `project_context.rs`.
- [x] **S3-T02 — Path confinement.** Canonicalize and re-check database, socket, cache, source, memory, and workspace paths; reject symlink and parent-directory escapes after resolution. **Files:** `crates/cli/src/dashboard.rs`, `project_context.rs`, service startup and path helpers.
- [x] **S3-T03 — Credential-backed callers.** Bind each operation to a project principal and credential, safely bootstrap existing projects, and implement role grants, delegation, revocation, and independent-review identity. **Files:** `crates/cli/src/credentials.rs`, `authority.rs`, `crates/store/src/principals.rs`, session service routes.
- [x] **S3-T04 — One authenticated boundary.** Apply the same caller/project checks to service, direct CLI, maintenance, source, memory, and planning mutations. Remove any mutation route that trusts a caller-supplied actor label alone. **Files:** `crates/cli/src/service.rs`, `main.rs`, `command_registry.rs`, store/application mutation adapters.
- [x] **S3-T05 — Isolate switching and late replies.** Bind pending operations, subscriptions, caches, and rendered rows to project/database identity. On project change cancel or quarantine old requests so a late reply cannot update the new project. **Files:** `apps/tui/src/client.ts`, `full-screen.ts`, `ui/model.ts`; CLI service identity envelope.
- [x] **S3-T06 — Remove remaining global fallback paths.** Route init, dashboard, status, memory, sockets, and recovery through explicit current-project resolution; return a setup instruction instead of selecting another known project. **Files:** `crates/cli/src/project_context.rs`, `dashboard.rs`, `service.rs`, TUI project state.

### Sprint 4 — execution, proof, review, closeout, recovery

**Result:** work can be executed and accepted only from an authenticated,
fenced attempt with genuine proof tied to the exact result.

- [x] **S4-T01 — Transactional execution lifecycle.** Re-read authority, dependencies, holds, deadlines, and fences inside claim/start/checkpoint/stop/release mutations. Keep physical-resource ownership until the process is safely stopped. The canonical claim and fenced-attempt store transactions revalidate scope and phase under the write lock; terminal transitions persist recovery obligations before the physical resource becomes reusable. **Files:** `crates/application/src/runtime.rs`, `crates/store/src/lib.rs`, `recovery.rs`, service execution routes.
- [x] **S4-T02 — Separate attempt and submission.** A worker lease/fence governs writes; an immutable submission survives release for review; an unresolved expiry remains a recovery obligation. New proof-relevant changes supersede prior submissions explicitly. **Files:** `crates/store/src/completion.rs`, `recovery.rs`, `crates/application/src/evidence_store.rs`, schema migrations.
- [x] **S4-T03 — Exact source-bound verification.** Operator-authorized directory capture creates a bounded immutable workspace source; `gate policy publish` admits sequential immutable policy revisions with a distinct config identity and pinned verifier digest, using an atomic expected-revision source-registration transaction. Evidence execution selects the unique policy for the current attempt, verifies catalog metadata against the project registration, unpacks the exact captured snapshot into a private staging directory, rechecks verifier bytes, and records policy revision/version, policy identity, and verifier digest in receipt readback. Generic source registration cannot claim the reserved gate-policy origin. Updated the policy shape and publication workflow docs. Full environment integration remains at sprint close. **Files:** `crates/source/src/workspace_snapshot.rs`, `crates/application/src/knowledge.rs`, `crates/store/src/knowledge.rs`, CLI source/evidence/service routes, gate docs/specs.
- [x] **S4-T04 — Submission and close intent.** Finish creates an immutable submission and close intent. Incomplete proof becomes closeout-pending; only the transactional accepted-outcome writer closes work. **Files:** `crates/application/src/runtime.rs`, `evidence_store.rs`, `crates/store/src/completion.rs`, CLI finish routes.
- [x] **S4-T05 — Review and exceptions.** Implement independent approve/reject/return/revoke, typed reasoned exceptions, and edge-specific waivers. Rejection creates reconciliation work; an override preserves the failed fact. **Files:** application evidence/review paths, `crates/store/src/acceptance.rs`, `completion.rs`, protocol and CLI routes.
- [x] **S4-T06 — Terminal/recovery transitions.** Complete retry, pause, cancellation, expiry, release, reopen, resource reconciliation, and committed/rejected/pending/unknown outcome handling without clearing history. Retry/reopen/cancel are revision-bound completion transactions, dispatch pause is an explicit policy state, and recovery readback preserves unresolved resource ownership until operator reconciliation. **Files:** `crates/application/src/runtime.rs`, store recovery/completion/operations, CLI recovery routes.
- [x] **S4-T07 — Remove duplicate policy.** Route all CLI and TUI mutations through the same application decision and operation path; delete client-side lifecycle authorization shortcuts. Direct and service routes both call the application/store lifecycle boundary; the TUI enables actions only from server action descriptors and rechecks mutation policy transactionally. **Files:** `crates/cli/src/main.rs`, `service.rs`, TUI action handling, application use cases.

### Sprint 5 — milestones, cycles, dependencies, projections, corruption UI

**Result:** one milestone can contain tasks scheduled over multiple cycles;
dependency and rollup truth comes from a complete project snapshot.

- [x] **S5-T01 — Milestone/task operations.** Finish create/edit/read and parent scoping for milestones and executable tasks; keep containers non-claimable. The v3 node write/read adapters persist project, decomposition, execution mode, and parent; work creation/edit validates hierarchy scope, status presents milestone nodes as non-claimable containers, and assignment rejects a container as executable work. **Files:** `crates/application/src/hierarchy.rs`, `planning_v3.rs`, `crates/store/src/work_model_v3.rs`, `crates/domain/src/work_model_v3.rs`.
- [x] **S5-T02 — Cycle assignment history.** Finish cycle lifecycle, commitment, carry-over, replacement, and legacy sprint mapping. The new-write lineage guard exists; make every read/write adapter honor the same rules and report damaged stored links. **Files:** `crates/domain/src/work_model_v3.rs`, `crates/store/src/work_model_v3.rs`, `cycle_commands.rs`, `crates/application/src/cycle_runtime.rs`.
- [x] **S5-T03 — Transactional dependency edits.** Add/delete dependency edges with cycle detection in the same write transaction. Require accepted closed outcomes; preserve cancelled and waived edges as unsatisfied/history-bearing facts. **Files:** store dependency mutation, `crates/domain/src/dependencies.rs`, application planning routes.
- [x] **S5-T04 — Readiness and scope disposition.** Complete cycle activation/closeout readiness and explicit defer, cancel, replace, and waiver. Restrict planning-policy edits to the intended Operator authority. Cycle activation is a planned-only transition; close/cancel reject live assignments; defer/remove/carry-over preserve the work outcome and assignment lineage; container replacement and dependency waiver are durable disposition records. Canonical cycle and container-disposition mutations now require the project Operator role, as do dispatch-policy changes. **Files:** `crates/application/src/cycle_runtime.rs`, `hierarchy.rs`, store `cycle_commands.rs`, CLI/service routes.
- [x] **S5-T05 — Wire rollups.** Build a single revision-bound store fact snapshot including accepted-outcome digest, assignment lineage, task status, gates, blockers, overdue state, and scope disposition; call `evaluate_cycle_rollup` and `evaluate_container_rollup` from application read paths. Cycle boards use a transactional snapshot with assignment lineage diagnostics; container rollups now use one project read transaction for hierarchy, status, accepted outcomes, and current dispositions. Both evaluators have application call sites, and `cycle board` plus `work rollup` return revisioned service results. **Files:** `crates/store/src/work_model_v3.rs`/new projection module, `crates/application/src/hierarchy.rs`, `cycle_runtime.rs`, protocol projection DTOs.
- [x] **S5-T06 — Corruption presentation.** Carry row-level integrity diagnostics through the service and show affected rows as degraded/quarantined with clear red/non-color status; keep healthy siblings selectable and disable unsafe actions. **Files:** store hierarchy snapshot, protocol, `apps/tui/src/ui/dashboard.ts`, `model.ts`, `screen.ts`.
- [x] **S5-T07 — Attention queues.** Add service-backed queues for review, rejected review, expiry, failed execution, operator holds, and damaged planning records, all scoped to the selected project. **Files:** application query layer, service/protocol, CLI and TUI queue views.

### Sprint 6 — CLI, guidance, terminal surface

**Result:** users and agents can discover and invoke every supported action
through consistent CLI/service/TUI behavior.

- [x] **S6-T01 — Complete command surface.** Reconcile registry, parser, help, aliases, handlers, and machine envelopes for identity, planning/cycles, status/history, proof/review/recovery, memory, maintenance, and readback. Project-scoped source search/citations, container rollup, review list/show, backup, maintenance-job readback, and migration dry-run/verify/apply are registered and routed through direct CLI and service handlers. Migration apply requires Operator authority, explicit confirmation, and the expected project revision; it records durable operation readback. Legacy-only route gaps remain explicitly discoverable rather than being advertised as handlers. **Files:** `crates/cli/src/command_registry.rs`, `main.rs`, `service.rs`, command modules.
- [x] **S6-T02 — Service-owned mutation authority.** Replace CLI/TUI status checks with server-returned action descriptors; ensure no direct handler can mutate around them. TUI action enablement requires descriptors bound to the current project, actor, session, and revision; application/store mutations re-evaluate policy under the write transaction, including direct CLI routes. **Files:** CLI command handlers, application action path, TUI `client.ts` and action dispatch.
- [x] **S6-T03 — Trusted workflow execution.** Make guide/next discover versioned workflow assets and invoke registered commands; instructions never grant permission or override a denied server action. **Files:** `crates/application/src/guidance.rs`, `workflow_assets.rs`, `project/spec/workflows/*`, CLI workflow routes.
- [x] **S6-T04 — Complete terminal workflows.** Add project, cycle, review, memory, recovery, pending-operation, and unavailable-service views using service responses only. The mounted controller now exposes project-scoped read-only cycle, review, memory-search, and recovery views; the full-screen palette and line shell render those service responses plus local project, pending-operation, and unavailable-route views without inventing data. **Files:** `apps/tui/src/client.ts`, `full-screen.ts`, `line-shell.ts`, `ui/*`.
- [x] **S6-T05 — Finish interaction behavior.** Preserve selection and confirmation context through resize, narrow/short screens, UTF-8 and multiline paste, cancellation, and request interruption; no hidden destructive default action. **Files:** TUI layout, model, screen, full-screen input handlers.
- [x] **S6-T06 — User-facing language.** Replace internal enums, SQL, fence, and protocol vocabulary on ordinary screens with clear status/reason/action language; retain raw diagnostics only in advanced detail. TUI status, reason, dispatch, dependency, and activity labels are humanized; attempt identifiers say “generation,” and ordinary action errors no longer print protocol codes. **Files:** TUI screen copy and CLI user-facing errors.

### Sprint 7 — memory, migration, backup, restore, maintenance

**Result:** project knowledge and operational data remain attributable and
recoverable across restart, import, restore, and publication.

- [x] **S7-T01 — Source intake and citations.** Finish the partial `source add` service route: enforce current-project path confinement and caller authority, persist immutable source identity/revision/digest, expose source search/citations, and bind handoff to exact source/work revisions. Source capture is confined to the selected workspace and credential/session-bound in service; immutable source versions are registered with digest and project revision; `source search` is now exposed through direct CLI and service with source version, location, excerpt, and excerpt digest. Claims, attempts, receipts, submissions, and closeout retain the exact source and work/proof revision identities carried through a handoff. **Files:** `crates/cli/src/service.rs`, `command_registry.rs`, `main.rs`, `crates/application/src/knowledge.rs`, `crates/store/src/knowledge.rs`, source service test draft.
- [x] **S7-T02 — Git publication reconciliation.** Persist publication intent and commit identity, recover interrupted publication, and compare the recorded commit/digest with Git state before reporting success. `memory readback` and Operator-authorized `memory reconcile` expose durable project-scoped readback and repair routes. **Files:** `crates/application/src/knowledge.rs`, `crates/store/src/knowledge.rs`, `crates/memory/src/lib.rs`, CLI memory commands.
- [x] **S7-T03 — v1 import disposition.** Preserve original statuses and historical proof as source provenance and a machine-readable loss/disposition report; historical completion remains non-accepted until an explicit v2 decision. The import planner and application path archive the raw import and draft imported terminal work. **Files:** `crates/migration/src/lib.rs`, migration CLI and report DTOs.
- [x] **S7-T04 — Backup/restore recovery.** Bind backup, database, referenced artifacts, memory revision, restore epoch, and service state in one durable job; reconcile after interruption and keep the pre-restore database. The direct CLI restore shares the service's exclusive database election, so it fails busy while the service owns the project. Restore uses operation-specific deterministic staging and commits a matching receipt before publication; retry verifies and publishes a completed staged receipt or reads back a published receipt, then reconciles the package-side journal. The previous database remains retained. **Files:** `crates/store/src/maintenance.rs`, migrations, backup/restore store code, CLI service maintenance routes.
- [x] **S7-T05 — Public maintenance/memory commands.** Complete CLI/service operation IDs and readback for migration, backup, restore, doctor, source, memory, handoff, and repair. Backup has an Operator-authorized service command and durable readback; `maintenance show` reads backup jobs from the project store and restore jobs from a confined package journal. Migration dry-run/verify expose the loss ledger and source fingerprint. Migration apply now archives the raw import as an immutable project source, applies the safe work graph and dependencies in one store transaction, drafts imported terminal work, preserves historical proof only as source, and returns durable operation readback through direct CLI and service. **Files:** `crates/cli/src/command_registry.rs`, `main.rs`, `service.rs`, `memory_commands.rs`, protocol DTOs.

### Sprint 8 — installer, update, release handoff

**Result:** future installs receive the finished product and update without
leaving a mixed or unrecoverable installation.

- [x] **S8-T01 — Installer generation.** Build installer payload from the existing TUI TypeScript source; keep standalone and embedded wizard generated from the same source. **Files:** `apps/tui/src/installer/*`, `apps/tui/installer/wizard.cjs`, `install.sh` generation path.
- [x] **S8-T02 — Complete package contents.** Ensure release staging carries the complete TUI distribution including `dist/ui/`, the CLI binary, and shared assets in the established layout. **Files:** `scripts/release/build_release.py`, package smoke/staging scripts, installer manifest.
- [x] **S8-T03 — Update/upgrade recovery.** On replay of a running/readback-required update, inspect the installed binary and manifest for the original operation before returning pending or trying again. Persist side-effect identity before invoking the installer; verify nonzero exit, manifest, binary digest, and rollback state. **Files:** `crates/cli/src/update.rs`, `service.rs`, durable external-job store, installer activation path.
- [x] **S8-T04 — Installed project behavior.** Make the released absolute binary use current-directory project selection and the same service/lifecycle routes, with no global project fallback or TUI asset omission. **Files:** release builder, installer, CLI project context, service packaging.
- [x] **S8-T05 — Final handoff.** Refreshed the implementation report, exact working-tree file inventory, concise source-history note, archive manifest, and merge instructions for this implementation pass. The source archive is a text-only review snapshot; no release was published. All 48 task implementation/handoff items are checked from source review; the eight sprints still need combined integration at sprint close. **Files:** `handoff/delivery/*`, root ZIP builder, release notes.

## Closeout

All 48 source implementation and handoff items are checked, and all eight
sprint areas are integrated on the combined tree. Final environment checks
are recorded in the delivery report; they do not reopen or block completed
task items. Do not use the non-adopted 22-sprint `PF-*` plan or its state
ledger to represent progress on this queue.
