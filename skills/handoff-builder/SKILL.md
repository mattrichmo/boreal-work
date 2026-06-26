---
name: handoff-builder
description: Boreal Handoff Builder skill for Boreal project-scoped workflows.
workflows:
  - 50-handoff/build-handoff.md
  - 50-handoff/session-closeout.md
  - 50-handoff/project-closeout.md
---

# Boreal Handoff Builder

## When To Use

Use this skill when the user asks for work covered by:

- `workflows/50-handoff/build-handoff.md`
- `workflows/50-handoff/session-closeout.md`
- `workflows/50-handoff/project-closeout.md`

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
