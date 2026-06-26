---
name: project-context
description: Boreal Project Context skill for Boreal project-scoped workflows.
workflows:
  - 10-context/retrieve-project-context.md
  - 10-context/retrieve-work-state.md
  - 10-context/retrieve-decision-history.md
---

# Boreal Project Context

## When To Use

Use this skill when the user asks for work covered by:

- `workflows/10-context/retrieve-project-context.md`
- `workflows/10-context/retrieve-work-state.md`
- `workflows/10-context/retrieve-decision-history.md`

## Required First Step

Confirm the current project context. Prefer `bwrk prime --json` when the workspace is initialized, or ask for the explicit project root before reading or writing memory.

## Routing Rules

- Read the referenced workflow file before executing steps.
- Follow the workflow's allowed commands and finish criteria.
- Keep this skill as a thin adapter; do not invent steps that belong in the workflow file.
- If the request crosses repositories, stop and ask for the explicit workspace and memory root.

## No-Leak Rules

- Do not read sibling `memory/`, `.boreal/`, `.agents/`, or `.claude/` folders unless the user explicitly scopes the request there.
- Do not use global memory as a fallback for a missing workspace.
- Do not install or refresh skills outside the selected install root.

## Completion

End with the workflow result, verification status, and the next suggested workflow.
