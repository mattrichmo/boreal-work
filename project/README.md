# Boreal v2 project packet

Status: proposed architecture, 2026-09-14. This folder travels with v2 when it
becomes a separate repository. It is the starting point for design and
implementation agents. The legacy repository is reference material, not a
runtime dependency.

The file-based execution authority is the root [master plan](../MASTER_PLAN.md)
with [M01 sprint folders](../milestones/M01-v2-product/README.md) and
[agent handoff](../AGENT_HANDOFF.md). The documents below are its behavior
and architecture contracts.

Read in this order:

1. [PRODUCT.md](PRODUCT.md) — product shape and the first useful vertical slice.
2. [ARCHITECTURE.md](ARCHITECTURE.md) — processes, Rust modules, TypeScript TUI,
   and service boundary.
3. [STATE_AND_CONCURRENCY.md](STATE_AND_CONCURRENCY.md) — canonical state,
   transactions, snapshots, locks, and recovery.
4. [AGENT_LIFECYCLE.md](AGENT_LIFECYCLE.md) — one attempt lifecycle across all
   agent harnesses.
5. [STATUS_MODEL.md](STATUS_MODEL.md) — deterministic queued/blocked/complete/
   closed distinctions, proof-gated advancement, and lease expiry review.
6. [SOURCE_ENGINE.md](SOURCE_ENGINE.md) — intake, parsing, provenance, and
   promotion of raw project material.
7. [MEMORY_BANK.md](MEMORY_BANK.md) — operational memory and Git-portable product
   memory.
8. [INTERFACES.md](INTERFACES.md) — CLI, local API, TUI, envelopes, and events.
9. [CLI_COMMANDS.md](CLI_COMMANDS.md) — commands v2 commits to keeping,
   their purposes, and exact-spelling versus behavior-parity rules.
10. [AGENT_GUIDANCE.md](AGENT_GUIDANCE.md) — the trusted, self-guiding agent
   protocol and no-goal loop; this is required product behavior.
11. [WORKFLOW_PARITY.md](WORKFLOW_PARITY.md) — legacy conditional-status,
   claim, evidence, and workflow features to keep, rework, or explicitly defer.
12. [build-plan/README.md](build-plan/README.md) — authoritative full v2
   task graph, vertical handoffs, ownership, review gates, and cutover plan.
13. [DELIVERY_PLAN.md](DELIVERY_PLAN.md) — architectural implementation order,
   tests, benchmarks, and migration; the build plan is the detailed execution
   authority.
14. [NEXT_AGENT_TASKS.md](NEXT_AGENT_TASKS.md) — earlier high-level lane sketch;
    use the build plan for actual assignments.
15. [DECISIONS.md](DECISIONS.md) — accepted constraints, recommendations, and
   questions that can change the architecture.
16. [AUDIT_BASELINE.md](AUDIT_BASELINE.md) — condensed evidence from the 2026-09
   long-running orchestration audit.

## Rules for implementation agents

- Treat the explicit invariants and acceptance tests here as the design
  contract. Verify a failure against implementation before claiming its root
  cause or patching it.
- Do not add a second authority for work status, dispatch eligibility,
  reservations, attempts, or memory provenance.
- Do not remove the self-guiding agent loop. A new agent must get current
  context, conditional status, required obligations, and a trusted next safe
  action from the same Rust application state as CLI and TUI.
- Do not hold a database transaction during tests, model calls, subprocesses,
  network requests, Git operations, UI rendering, or waits.
- Preserve failed attempts and evidence. Supersede or annotate history; do not
  erase it to make current health appear green.
- Record operation IDs, revisions, timings, and payload sizes at the boundary.
  Performance claims need before/after measurements on the same workload.
- Keep the v2 build and runtime independent of legacy packages and paths.
- Keep schema/protocol migrations explicit and tested against fixtures.
- Edit only the assigned module or file set when multiple agents work in this
  repository. Run an integration check after their changes are combined.

## First deliverable

Build one complete vertical slice: initialize a project, create a milestone,
sprint, and task, activate the sprint, then let an unfamiliar agent with no
bespoke goal discover and claim it through Boreal guidance. Race that claim
against another CLI client, acknowledge one attempt, follow required evidence
and finish directives, complete it, and view an accurate revisioned dashboard
from the TUI while concurrent reads and writes continue. The memory
bank's first slice must ingest a source, create a cited memory entry, retrieve
it, and publish a Git revision without blocking work mutations.
