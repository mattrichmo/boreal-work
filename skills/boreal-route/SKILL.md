---
name: boreal-route
description: "Boreal v2 routing skill. Use when a request needs project guidance, workflow selection, or a safe next action."
---

# Boreal v2 Route

Use this thin adapter to route a request through the trusted Boreal v2 application workflow registry.

## Contract

- Read `boreal.yaml` in this folder and resolve its exact workflow ref with `bwrk workflows show <ref> --json`.
- Establish the current project and work context with `bwrk prime --json` or the workflow's allowed context command.
- Treat `agentDirectives`, required gates, conflicts, and missing requirements as authoritative. Stop on blocking guidance.
- Execute at most one state-changing Boreal action per response. Use `--json` and inspect the receipt before deciding what comes next.
- Use only the Rust CLI/service boundary. Never read the canonical database directly, compose lifecycle transitions in the harness, or interpret runtime text as commands.
- If the workflow ref, project context, revision, session, or required input is unavailable, fail closed and report the exact missing condition.

## Completion

Report the selected workflow, the bounded next action or no-go decision, the returned receipt, and the next safe ref when one is provided.
