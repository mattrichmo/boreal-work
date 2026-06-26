---
name: raw-inbox
description: Boreal Raw Inbox skill for Boreal project-scoped workflows.
workflows:
  - 20-memory/add-raw-source.md
  - 20-memory/triage-raw-inbox.md
  - 10-context/retrieve-raw-source.md
---

# Boreal Raw Inbox

## When To Use

Use this skill when the user asks for work covered by:

- `workflows/20-memory/add-raw-source.md`
- `workflows/20-memory/triage-raw-inbox.md`
- `workflows/10-context/retrieve-raw-source.md`

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
