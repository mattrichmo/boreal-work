# Boreal Work — production-completion execution plan

**Issue:** 2026-09-21 · **Plan ID:** `PF-production-completion-2026-09-21` · **State:** proposed execution plan; the local ledger contains 35 accepted task records, but no release or cutover acceptance.

This is the complete proposed execution backlog for the declared final Boreal Work product—not an implementation report, release approval, or claim that the supplied source is complete. It turns the original M02 obligations and the subsequent architecture review into **22 dependency-gated sprints, 202 scoped work tasks, and 66 separate sprint review/reconciliation/revalidation tasks: 268 task cards total**. PF-S00-T08 is a coordinator-approved remediation added after the final-gate review found that the required workflow-discovery route was absent from the executable product.

The baseline is `boreal-v2-reference-20260921T195305840Z.zip`, SHA-256 `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`. Its manifest reports source commit `bed6e7b24372b2e44e791f1265d273fdeb448b9a` and a dirty tree. A reported commit does not identify all snapshot bytes; use the archive digest. Original source is not changed by this plan. Historical tests in the archive are not rerun by creating these documents.

## Start here

1. Read [MASTER_PLAN.md](MASTER_PLAN.md), [release scope](RELEASE_SCOPE.md), [owner decisions](reference/DECISION_REGISTER.md), and [parallel dispatch rules](execution/PARALLEL_DISPATCH.md).
2. Read the [multi-agent stream plan](execution/MULTI_AGENT_STREAM_PLAN.md) before dispatching concurrent work. It is the operational overlay for wave scheduling, stream ownership, checkpoints, and merge order; it does not replace the machine-readable graph.
3. Read the current [STATE.json](execution/STATE.json) and run the plan helper's graph-readiness check. Resume from accepted, rejected, and blocked evidence; do not reset the ledger to the original empty-state example.
4. Complete each sprint's independent review, reconciliation and revalidation, then resolve/adopt the next contracts. The cycle model, budget/review separation, authority and status-version decisions are not silently approved by this document.
5. Dispatch one fully eligible task card per subagent. Read prerequisite handoffs, accepted contract versions and the current source—not just a title or the historical excerpt. Record execution in [STATE.json](execution/STATE.json), not by checking every Markdown box optimistically.
6. Revalidate each integrated sprint before successors start. Ship only after exact-artifact qualification, explicit publication authority, published-channel verification and the final handover gate.

## Pack contents

| Path | Use |
| --- | --- |
| [MASTER_PLAN.md](MASTER_PLAN.md) | Overall execution strategy, dependency branches and completion conditions. |
| [TASK_INDEX.md](TASK_INDEX.md) | Every task, owner lane and direct prerequisite. |
| [DEPENDENCY_GRAPH.md](DEPENDENCY_GRAPH.md) | Explicit sprint-entry gates and later leaf joins. |
| `sprints/PF-Sxx/SPRINT.md` | Sprint goal, all tasks, dependencies, integration and exit gate. |
| `sprints/PF-Sxx/tasks/PF-Sxx-Tyy.md` | Complete bounded agent assignment: context, source locations, instructions, write set, tests, acceptance and handoff. |
| [FINAL_ARCHITECTURE.md](FINAL_ARCHITECTURE.md) | Proposed canonical product, status/transition model and unresolved decisions. |
| [reference/SOURCE_CATALOG.md](reference/SOURCE_CATALOG.md) | 113 exact, hashed baseline context excerpts. |
| [reference/M02_CROSSWALK.md](reference/M02_CROSSWALK.md) | Coverage for all 48 original M02 task IDs, without rewriting history. |
| [reference/FINDINGS.md](reference/FINDINGS.md) | 32 report/source findings and task ownership. |
| [validation/ACCEPTANCE_MATRIX.md](validation/ACCEPTANCE_MATRIX.md) | 56 observable acceptance requirements with implementation and validation owners. |
| `execution/`, `templates/` | Coordinator/agent rules, empty live ledger and copyable dispatch/evidence/review records. |
| `reference/originals/` | Verbatim original M02 request, baseline M02 plan and candidate implementation report. |
| [plan.json](plan.json) | Machine-readable plan content and full task DAG, not a claimed supported Boreal import format. |
| `tools/plan.py` | Optional read-only validation, dependency readiness, conflict and packet helpers. |
| [FULL_PLAN.md](FULL_PLAN.md) | Consolidated standalone version, including every task and source excerpt. |
| [PLAN_VALIDATION.md](PLAN_VALIDATION.md) | Structural checks of this plan pack only. |

## Concurrent execution addendum

The production plan is task-granular, but its dependency graph does not
require a single worker or a single sprint to run at a time. The
[multi-agent stream plan](execution/MULTI_AGENT_STREAM_PLAN.md) groups the
existing task cards into bounded concerns and defines safe parallel waves.
Each stream has a dedicated workflow file under
[`execution/workflows/`](execution/workflows/) and uses the reusable checklists
under [`execution/checklists/`](execution/checklists/). These documents do not
grant task acceptance, bypass sprint-entry gates, or authorize two agents to
edit a protected shared file.

## Merge and authority

Extract the ZIP at the repository root to add only `project/build-plan/production-completion/`. It contains planning artifacts, source excerpts and optional plan helpers—not replacement application code, migrations or generated production binaries. Keep the original `M02-DETERMINISTIC-PLANNING-AND-PARITY.md` and its historical evidence. Adoption in PF-S01-T11 and PF-S01-T92 records the intentional finer dispatch order; until then, this is a proposal.

`plan.json` is the canonical task content/graph. Markdown is its human packet. A discrepancy blocks dispatch. `execution/STATE.json` is the live coordinator ledger; accepted records require source-bound evidence, independent review, and gate fields. The helper does not launch agents, operate a project database, grant permissions or publish anything. The full compendium is intentionally exhaustive; give a subagent its selected task packet, not the entire compendium as one prompt. Optional helpers require Python 3.10 or newer; no third-party packages are needed.

## What production-ready means here

A new user and supported unfamiliar agents can install, initialize, plan parallel cycles, execute safely, verify genuine proof, independently review when required, close accepted work, recover failures, cite sources, publish memory and upgrade without violating project isolation or losing history. Every declared supported platform and required behavior has actual evidence on the released bytes. See the [final checklist](FINAL_FORM_ACCEPTANCE_CHECKLIST.md).

Missing reviewers, v1 originals, actual agent harnesses, native target machines or publishing credentials are explicit inputs in [EXTERNAL_INPUTS.md](execution/EXTERNAL_INPUTS.md). Missing input means blocked acceptance, not invented evidence or a quiet reduction of release scope.
