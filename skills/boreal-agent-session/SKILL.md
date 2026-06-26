---
name: boreal-agent-session
description: Boreal Agent Session skill for Boreal project-scoped workflows. Use when the user asks to run or reason about Boreal memory/workflow commands for: agent session.
---

# Boreal Agent Session

## Required First Step

Confirm the current project context. Prefer `bwrk prime --json` when the workspace is initialized, or ask for the explicit project root before reading or writing memory.

## Routing Rules

- Read `boreal.yaml` in this skill folder to identify the canonical workflow files.
- Read the referenced workflow file before executing steps.
- Follow the workflow's allowed commands and finish criteria.
- Keep this skill as a thin adapter; do not invent steps that belong in the workflow file.
- If the request crosses repositories, stop and ask for the explicit workspace and memory root.

## Workflow References

- `workflows/00-agent/agent-session.md`

## No-Leak Rules

- Do not read sibling `memory/`, `.boreal/`, `.agents/`, or `.claude/` folders unless the user explicitly scopes the request there.
- Do not use global memory as a fallback for a missing workspace.
- Do not install or refresh skills outside the selected install root.

## Completion

End with the workflow result, verification status, and the next suggested workflow.
