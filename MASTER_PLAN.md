# M01 — Build the standalone Boreal Work v2 product

Status: file-based execution plan. This is **not** a `bwrk` milestone and no
legacy Boreal state is used for dispatch. The current Rust implementation has
tested domain, store, application, protocol, service, and CLI slices, with
additional source, memory, migration, TUI, workflow, and packaging groundwork;
each product capability below still needs its named acceptance proof. The v2
directory must eventually build outside the legacy repository.

## Goal and authority

Build the complete v2 launch slice: deterministic milestone/sprint/task status
and dependency progression; fenced multi-harness claims and time limits;
structured evidence and self-guiding `guide`/`next`/finish; one Rust
transactional store/service/CLI; Git-published cited memory; a TypeScript TUI;
legacy migration; packaging; and measured multi-agent correctness and speed.
Do not turn this into a CRUD-only or evidence-free rewrite.

Approved D29 launch scope deliberately excludes the old web console, global cross-project
manager, broad custom workflow packs, remote multi-host service, and full MCP
surface for now; see [deferred verticals](project/build-plan/DEFERRED_VERTICALS.md).
Those are explicit launch deferrals, not permission to delete legacy data or
quietly lose a working agent command. P0-04 and P4-11 must record user-visible
parity impact, and P5-08 requires approval for each material deferral.

This file controls **dispatch and sprint advancement**. The
[task index](project/build-plan/TASK_INDEX.md) owns leaf IDs, dependencies, and
baseline acceptance. [Vertical handoffs](project/build-plan/verticals/) own
code boundaries; [status](project/STATUS_MODEL.md),
[CLI](project/CLI_COMMANDS.md), and [guidance](project/AGENT_GUIDANCE.md) own
behavior contracts. Each [sprint file](milestones/M01-v2-product/README.md)
owns its task assignments and gates. If these disagree, stop dispatch and
reconcile the documents; do not choose a convenient interpretation.

The focused completion plan for the next full planning/status release is
[M02 — Deterministic Planning, Lifecycle Hardening, and v1
Parity](project/build-plan/M02-DETERMINISTIC-PLANNING-AND-PARITY.md). It
consolidates the known thin-slice gaps into executable, parallel-safe tasks
and release gates without changing this M01 history.

## Sprint map

| Sprint | Scope and file | Entry gate | Exit gate | May overlap |
| --- | --- | --- | --- | --- |
| S00 | [Contracts, decisions, legacy baseline](milestones/M01-v2-product/sprints/S00-contracts/SPRINT.md) | Existing architecture packet | P0-07 revalidation | Three disjoint P0 discovery lanes |
| S01 | [Domain, dependency/status evaluator, SQLite store](milestones/M01-v2-product/sprints/S01-domain-store/SPRINT.md) | P0-07 | P1-09 revalidation | Domain and schema lanes initially |
| S02 | [Attempts, evidence, runtime, service, CLI, guidance](milestones/M01-v2-product/sprints/S02-runtime-cli/SPRINT.md) | P1-09 | P2-09 revalidation | Application and service lanes; later guidance |
| S03 | [Source engine and Git memory](milestones/M01-v2-product/sprints/S03-source-memory/SPRINT.md) | P2-09 | P3-09 revalidation | S04 TUI |
| S04 | [TypeScript TUI and monitoring](milestones/M01-v2-product/sprints/S04-tui/SPRINT.md) | P2-09 | P4-03 plus mounted UI evidence | S03 source/memory |
| S05 | [Migration, canonical workflows, packaging, docs](milestones/M01-v2-product/sprints/S05-integration/SPRINT.md) | P3-09 and S04 P4-03 for full integration; P4-04/P4-10 can start at P3-09 | P4-09 revalidation | Migration and workflow assets initially |
| S06 | [Load, fault, security, standalone cutover](milestones/M01-v2-product/sprints/S06-release/SPRINT.md) | P4-09 | P5-08 cutover decision | Independent P5-01/02/03 probes |

S03 and S04 are deliberately concurrent after P2-09. S05 is the join. A
later sprint may start a leaf early only when **that leaf's** task-index
prerequisites and owned-path boundary are satisfied; its *sprint gate* does
not pass early. No agent gets a whole sprint as an undifferentiated assignment.

## Coordinator dispatch protocol

1. Read this file, [milestone scope](milestones/M01-v2-product/README.md),
   the relevant sprint file, [task index](project/build-plan/TASK_INDEX.md),
   [review gates](project/build-plan/REVIEW_GATES.md), and
   [handoff](AGENT_HANDOFF.md). Use task IDs, not invented `bwrk` records.
2. Select a leaf only when **all** listed prerequisite IDs have accepted
   evidence and the last finding-producing review has passed through
   reconciliation and revalidation. `queued` means waiting for a planned
   prerequisite; `blocked` means an intervention/decision or failed gate.
3. Assign one named agent, one task ID, one exclusive write set, an input
   snapshot, and a bounded timebox. A fresh assignment means claimed, not
   productive. Never assign two agents the same schema, manifest, protocol,
   or crate file set. Shared interfaces are changed by their named steward
   or by a reviewed integration request.
4. Agents report exact changed paths, checks, proof, limitations, and findings
   using [AGENT_HANDOFF.md](AGENT_HANDOFF.md). The coordinator verifies the
   claimed source snapshot and reviews diffs; a worker report is not a closed
   task. If an agent's timebox elapses, mark it for review, confirm the
   process/worktree has stopped, and reconcile its output before replacement.
   Markdown cannot automatically enforce lease expiry.
5. Run an independent review for finding-producing work, record each finding
   with disposition (`fixed`, `no_change`, or `deferred` with owner/gate), then
   run the named revalidation on the combined tree. Advance successors only
   after that gate passes. A scoped test is not full-release validation.
6. Preserve failed receipts, attempts, and migration provenance. On an
   uncertain change outcome, inspect the diff/operation evidence before
   retrying; do not blindly replay a mutation. Update the sprint file's
   dispatch ledger and this master plan's current-wave line after the gate.

## Dispatch waves and exclusive ownership

| Wave | Ready work when gate passes | Parallelism | Coordinator integration point |
| --- | --- | --- | --- |
| 0 — complete | P0-01 approved decisions, P0-03 contracts revalidated; P0-02/P0-04 limitations explicitly deferred | Coordinator, Luna review, baseline, and migration lanes | P1-01 and P1-03 are eligible; P0/P5 deferrals remain tracked |
| 1 | P1-01 typed domain and P1-03 schema/migrations after P0-07 | Domain owner and store owner | P1-02/04 integrate; P1-07/08/09 gate |
| 2 | P2-01 attempt lifecycle and P2-03 service after P1-09 | Application owner and service owner | P2-04/05/06, then P2-10/11/12; P2-07/08/09 gate |
| 3 | P3-01 source intake and P4-01 TS client after P2-09 | Source/memory lane and TUI lane | P3-09 and P4-03 are independent join inputs to S05 |
| 4 | P4-04 migration and P4-10 workflow assets after P3-09; P4-02/03 may continue | Migration, workflow, and TUI owners | P4-05/06/11, then P4-07/08/09 gate |
| 5 | P5-01 load, P5-02 fault/clock, P5-03 security after P4-09 | Independent validation lanes | P5-04/05/06/07, then P5-08 cutover |

Only the coordinator edits shared planning/dispatch state. Agents write their
owned implementation paths and return a handoff; they do not declare a sprint
or milestone closed. The source of current assignment truth is the relevant
sprint's dispatch ledger, not this illustrative wave table.

## Current wave and next action

Current wave: **2 / S02**, P0-07 and P1-09 passed with approved deferrals;
P2-07 blockers are reconciled for the current snapshot and P2-09 has bounded
application plus real local-socket multi-harness/restart proof but remains open
for service-routed evidence/closeout acceptance. Their assignment and evidence state is recorded in
[S02](milestones/M01-v2-product/sprints/S02-runtime-cli/SPRINT.md).
The [policy choices](project/spec/POLICY_DRAFT.md) are approved, including the
two-hour default hard claim deadline, profile-gated independent review, and
focused M01 scope. P0-03 is closed after reconciled revalidation and P1-09
passed with the migration/status limitations recorded in its revalidation;
the [baseline matrix](project/build-plan/baseline/REPRO_MATRIX.md) has no
reproduced timing result yet; the [legacy map](project/legacy-map/RECORD_MAPPING.md)
is reported but awaits independent review. P0-02/P0-04 limitations remain
tracked as approved deferrals. Source/memory/TUI files added ahead of P2-09
are groundwork only and do not unlock S03/S04.
The initial scaffold test result was a zero-test baseline; the current scoped
tests are evidence for their slices, not proof of full v2 behavior.

## Milestone close gate

M01 closes only after P5-08 records a standalone external-checkout build,
scripted and unfamiliar-agent no-goal claim/evidence/finish paths, multi-
harness races and expiry/fencing safety, TUI-on/off throughput with the same
validation quality, source/Git recovery, legacy import and rollback, every
required CLI/workflow parity disposition, and remaining limitations. The
decision must say `ship`, `ship with approved deferrals`, or `do not ship`;
critical integrity, security, or core guided-workflow gaps cannot be waived
by a status edit.
