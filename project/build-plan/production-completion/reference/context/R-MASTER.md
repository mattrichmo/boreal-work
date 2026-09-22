# R-MASTER — MASTER_PLAN.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `MASTER_PLAN.md:L1–L132`  
**File SHA-256:** `69ef87d6bfce408357633a16029b65a86c4e1c6b55b4dcd01fd447de4324921e`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing M01/M02 authority, prior gates, current-wave limitations and approved launch scope.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,132p' 'MASTER_PLAN.md'
```

## Exact baseline excerpt

````text
    1 | # M01 — Build the standalone Boreal Work v2 product
    2 | 
    3 | Status: file-based execution plan. This is **not** a `bwrk` milestone and no
    4 | legacy Boreal state is used for dispatch. The current Rust implementation has
    5 | tested domain, store, application, protocol, service, and CLI slices, with
    6 | additional source, memory, migration, TUI, workflow, and packaging groundwork;
    7 | each product capability below still needs its named acceptance proof. The v2
    8 | directory must eventually build outside the legacy repository.
    9 | 
   10 | ## Goal and authority
   11 | 
   12 | Build the complete v2 launch slice: deterministic milestone/sprint/task status
   13 | and dependency progression; fenced multi-harness claims and time limits;
   14 | structured evidence and self-guiding `guide`/`next`/finish; one Rust
   15 | transactional store/service/CLI; Git-published cited memory; a TypeScript TUI;
   16 | legacy migration; packaging; and measured multi-agent correctness and speed.
   17 | Do not turn this into a CRUD-only or evidence-free rewrite.
   18 | 
   19 | Approved D29 launch scope deliberately excludes the old web console, global cross-project
   20 | manager, broad custom workflow packs, remote multi-host service, and full MCP
   21 | surface for now; see [deferred verticals](project/build-plan/DEFERRED_VERTICALS.md).
   22 | Those are explicit launch deferrals, not permission to delete legacy data or
   23 | quietly lose a working agent command. P0-04 and P4-11 must record user-visible
   24 | parity impact, and P5-08 requires approval for each material deferral.
   25 | 
   26 | This file controls **dispatch and sprint advancement**. The
   27 | [task index](project/build-plan/TASK_INDEX.md) owns leaf IDs, dependencies, and
   28 | baseline acceptance. [Vertical handoffs](project/build-plan/verticals/) own
   29 | code boundaries; [status](project/STATUS_MODEL.md),
   30 | [CLI](project/CLI_COMMANDS.md), and [guidance](project/AGENT_GUIDANCE.md) own
   31 | behavior contracts. Each [sprint file](milestones/M01-v2-product/README.md)
   32 | owns its task assignments and gates. If these disagree, stop dispatch and
   33 | reconcile the documents; do not choose a convenient interpretation.
   34 | 
   35 | The focused completion plan for the next full planning/status release is
   36 | [M02 — Deterministic Planning, Lifecycle Hardening, and v1
   37 | Parity](project/build-plan/M02-DETERMINISTIC-PLANNING-AND-PARITY.md). It
   38 | consolidates the known thin-slice gaps into executable, parallel-safe tasks
   39 | and release gates without changing this M01 history.
   40 | 
   41 | ## Sprint map
   42 | 
   43 | | Sprint | Scope and file | Entry gate | Exit gate | May overlap |
   44 | | --- | --- | --- | --- | --- |
   45 | | S00 | [Contracts, decisions, legacy baseline](milestones/M01-v2-product/sprints/S00-contracts/SPRINT.md) | Existing architecture packet | P0-07 revalidation | Three disjoint P0 discovery lanes |
   46 | | S01 | [Domain, dependency/status evaluator, SQLite store](milestones/M01-v2-product/sprints/S01-domain-store/SPRINT.md) | P0-07 | P1-09 revalidation | Domain and schema lanes initially |
   47 | | S02 | [Attempts, evidence, runtime, service, CLI, guidance](milestones/M01-v2-product/sprints/S02-runtime-cli/SPRINT.md) | P1-09 | P2-09 revalidation | Application and service lanes; later guidance |
   48 | | S03 | [Source engine and Git memory](milestones/M01-v2-product/sprints/S03-source-memory/SPRINT.md) | P2-09 | P3-09 revalidation | S04 TUI |
   49 | | S04 | [TypeScript TUI and monitoring](milestones/M01-v2-product/sprints/S04-tui/SPRINT.md) | P2-09 | P4-03 plus mounted UI evidence | S03 source/memory |
   50 | | S05 | [Migration, canonical workflows, packaging, docs](milestones/M01-v2-product/sprints/S05-integration/SPRINT.md) | P3-09 and S04 P4-03 for full integration; P4-04/P4-10 can start at P3-09 | P4-09 revalidation | Migration and workflow assets initially |
   51 | | S06 | [Load, fault, security, standalone cutover](milestones/M01-v2-product/sprints/S06-release/SPRINT.md) | P4-09 | P5-08 cutover decision | Independent P5-01/02/03 probes |
   52 | 
   53 | S03 and S04 are deliberately concurrent after P2-09. S05 is the join. A
   54 | later sprint may start a leaf early only when **that leaf's** task-index
   55 | prerequisites and owned-path boundary are satisfied; its *sprint gate* does
   56 | not pass early. No agent gets a whole sprint as an undifferentiated assignment.
   57 | 
   58 | ## Coordinator dispatch protocol
   59 | 
   60 | 1. Read this file, [milestone scope](milestones/M01-v2-product/README.md),
   61 |    the relevant sprint file, [task index](project/build-plan/TASK_INDEX.md),
   62 |    [review gates](project/build-plan/REVIEW_GATES.md), and
   63 |    [handoff](AGENT_HANDOFF.md). Use task IDs, not invented `bwrk` records.
   64 | 2. Select a leaf only when **all** listed prerequisite IDs have accepted
   65 |    evidence and the last finding-producing review has passed through
   66 |    reconciliation and revalidation. `queued` means waiting for a planned
   67 |    prerequisite; `blocked` means an intervention/decision or failed gate.
   68 | 3. Assign one named agent, one task ID, one exclusive write set, an input
   69 |    snapshot, and a bounded timebox. A fresh assignment means claimed, not
   70 |    productive. Never assign two agents the same schema, manifest, protocol,
   71 |    or crate file set. Shared interfaces are changed by their named steward
   72 |    or by a reviewed integration request.
   73 | 4. Agents report exact changed paths, checks, proof, limitations, and findings
   74 |    using [AGENT_HANDOFF.md](AGENT_HANDOFF.md). The coordinator verifies the
   75 |    claimed source snapshot and reviews diffs; a worker report is not a closed
   76 |    task. If an agent's timebox elapses, mark it for review, confirm the
   77 |    process/worktree has stopped, and reconcile its output before replacement.
   78 |    Markdown cannot automatically enforce lease expiry.
   79 | 5. Run an independent review for finding-producing work, record each finding
   80 |    with disposition (`fixed`, `no_change`, or `deferred` with owner/gate), then
   81 |    run the named revalidation on the combined tree. Advance successors only
   82 |    after that gate passes. A scoped test is not full-release validation.
   83 | 6. Preserve failed receipts, attempts, and migration provenance. On an
   84 |    uncertain change outcome, inspect the diff/operation evidence before
   85 |    retrying; do not blindly replay a mutation. Update the sprint file's
   86 |    dispatch ledger and this master plan's current-wave line after the gate.
   87 | 
   88 | ## Dispatch waves and exclusive ownership
   89 | 
   90 | | Wave | Ready work when gate passes | Parallelism | Coordinator integration point |
   91 | | --- | --- | --- | --- |
   92 | | 0 — complete | P0-01 approved decisions, P0-03 contracts revalidated; P0-02/P0-04 limitations explicitly deferred | Coordinator, Luna review, baseline, and migration lanes | P1-01 and P1-03 are eligible; P0/P5 deferrals remain tracked |
   93 | | 1 | P1-01 typed domain and P1-03 schema/migrations after P0-07 | Domain owner and store owner | P1-02/04 integrate; P1-07/08/09 gate |
   94 | | 2 | P2-01 attempt lifecycle and P2-03 service after P1-09 | Application owner and service owner | P2-04/05/06, then P2-10/11/12; P2-07/08/09 gate |
   95 | | 3 | P3-01 source intake and P4-01 TS client after P2-09 | Source/memory lane and TUI lane | P3-09 and P4-03 are independent join inputs to S05 |
   96 | | 4 | P4-04 migration and P4-10 workflow assets after P3-09; P4-02/03 may continue | Migration, workflow, and TUI owners | P4-05/06/11, then P4-07/08/09 gate |
   97 | | 5 | P5-01 load, P5-02 fault/clock, P5-03 security after P4-09 | Independent validation lanes | P5-04/05/06/07, then P5-08 cutover |
   98 | 
   99 | Only the coordinator edits shared planning/dispatch state. Agents write their
  100 | owned implementation paths and return a handoff; they do not declare a sprint
  101 | or milestone closed. The source of current assignment truth is the relevant
  102 | sprint's dispatch ledger, not this illustrative wave table.
  103 | 
  104 | ## Current wave and next action
  105 | 
  106 | Current wave: **2 / S02**, P0-07 and P1-09 passed with approved deferrals;
  107 | P2-07 blockers are reconciled for the current snapshot and P2-09 has bounded
  108 | application plus real local-socket multi-harness/restart proof but remains open
  109 | for service-routed evidence/closeout acceptance. Their assignment and evidence state is recorded in
  110 | [S02](milestones/M01-v2-product/sprints/S02-runtime-cli/SPRINT.md).
  111 | The [policy choices](project/spec/POLICY_DRAFT.md) are approved, including the
  112 | two-hour default hard claim deadline, profile-gated independent review, and
  113 | focused M01 scope. P0-03 is closed after reconciled revalidation and P1-09
  114 | passed with the migration/status limitations recorded in its revalidation;
  115 | the [baseline matrix](project/build-plan/baseline/REPRO_MATRIX.md) has no
  116 | reproduced timing result yet; the [legacy map](project/legacy-map/RECORD_MAPPING.md)
  117 | is reported but awaits independent review. P0-02/P0-04 limitations remain
  118 | tracked as approved deferrals. Source/memory/TUI files added ahead of P2-09
  119 | are groundwork only and do not unlock S03/S04.
  120 | The initial scaffold test result was a zero-test baseline; the current scoped
  121 | tests are evidence for their slices, not proof of full v2 behavior.
  122 | 
  123 | ## Milestone close gate
  124 | 
  125 | M01 closes only after P5-08 records a standalone external-checkout build,
  126 | scripted and unfamiliar-agent no-goal claim/evidence/finish paths, multi-
  127 | harness races and expiry/fencing safety, TUI-on/off throughput with the same
  128 | validation quality, source/Git recovery, legacy import and rollback, every
  129 | required CLI/workflow parity disposition, and remaining limitations. The
  130 | decision must say `ship`, `ship with approved deferrals`, or `do not ship`;
  131 | critical integrity, security, or core guided-workflow gaps cannot be waived
  132 | by a status edit.
````
