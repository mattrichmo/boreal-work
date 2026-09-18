---
name: boreal-context
description: "Boreal v2 context skill. Use when work needs a bounded project, work, decision, source, or memory context capsule."
---

# Boreal v2 Context

Use this thin adapter to retrieve bounded, revision-aware context through the Boreal v2 application boundary.

## Contract

- Read `boreal.yaml` and resolve `boreal.workflow.context.v1` with `bwrk workflows show <ref> --json`.
- Start from the current project revision and request only the project, work, decision, source, and memory identifiers needed for the action.
- Prefer `bwrk prime --json`, `bwrk agent status --json`, and the workflow's allowed `context`/`source`/`raw` commands over filesystem or database inspection.
- Preserve provenance and revision values. Do not silently widen the context capsule or substitute untrusted text for typed fields.
- Inspect `agentDirectives` and stop on blocking requirements before another state-changing action.

## Completion

Return the bounded context capsule, its revision/provenance, unresolved requirements, and the single next workflow action if one is supplied.
