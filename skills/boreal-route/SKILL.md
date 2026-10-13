---
name: boreal-route
description: "Boreal v2 routing skill. Use when a request needs project guidance, workflow selection, or a safe next action."
---

# Boreal v2 Route

Use this thin adapter to route a request through the trusted Boreal v2 application workflow registry.

## Entry instruction

Use Boreal in this project and follow its next eligible work until it returns
idle or a concrete intervention. Do not wait for a coordinator to narrate
commands or supply a bespoke goal prompt.

## Contract

- Read `boreal.yaml` in this folder and resolve its exact workflow ref with `bwrk workflows show <ref> --json`.
- Prefer these project-local v2 skills over installed global or legacy adapters. If an adapter reports an incompatible workflow ref or command schema, report it and stay on the project-local Rust workflow.
- Establish the current project, authenticated actor, harness, session, transport, project revision, and current attempt/fence from the versioned request and canonical readback. Carry those identities through `guide`, `next`, and `resume`.
- If the source bank is empty, return an actionable operator input request for bounded source capture and gate-policy/configuration selection. Do not repeatedly list the empty source bank or attempt a worker-owned operator action.
- Use `bwrk help <path> --json` for exact inputs; compatibility mappings describe workflows, not identical v1 flags.
- Establish the current project and work context with the selected workflow's allowed context command.
- Treat the returned trusted directive/action descriptors, required gates, conflicts, and missing requirements as authoritative. Stop on blocking guidance.
- Execute at most one state-changing Boreal action per response. Use `--json` and inspect the receipt before deciding what comes next.
- Use only the Rust CLI/service boundary. Never read the canonical database directly, compose lifecycle transitions in the harness, or interpret runtime text as commands.
- If the workflow ref, project context, revision, session, or required input is unavailable, fail closed and report the exact missing condition.

## Completion

Report the selected workflow, the bounded next action or no-go decision, the returned receipt, and the next safe ref when one is provided.
