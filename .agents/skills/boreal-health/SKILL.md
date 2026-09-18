---
name: boreal-health
description: "Boreal v2 health skill. Use when diagnosing or recovering service, synchronization, context, search, or memory health."
---

# Boreal v2 Health

Use this thin adapter to diagnose and recover Boreal v2 subsystems through bounded, observable operations.

## Contract

- Read `boreal.yaml` and resolve `boreal.workflow.health.v1` with `bwrk workflows show <ref> --json`.
- Establish project and service scope before a doctor, sync, rebuild, or index action. Prefer diagnostics that do not mutate state.
- Use the application-owned doctor, sync, context rebuild, search index, dashboard, and operation-readback commands. Never repair tables or projections directly.
- Treat projections, indexes, and rollups as rebuildable derived data; preserve transactional work, attempts, evidence, and publication history.
- Inspect operation IDs, receipts, `agentDirectives`, and recovery gates. Execute one recovery action at a time and stop on ambiguous ownership or live-lock conditions.

## Completion

Report the diagnosed component, revision/operation ID, observed health, recovery action and receipt, remaining risk, and the next safe check.
