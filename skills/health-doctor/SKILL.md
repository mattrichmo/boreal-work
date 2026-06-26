---
name: health-doctor
description: Boreal Health Doctor skill for Boreal project-scoped workflows.
workflows:
  - 60-health/sync-and-doctor.md
  - 60-health/ledger-export-import.md
  - 60-health/recover-from-failure.md
---

# Boreal Health Doctor

## When To Use

Use this skill when the user asks for work covered by:

- `workflows/60-health/sync-and-doctor.md`
- `workflows/60-health/ledger-export-import.md`
- `workflows/60-health/recover-from-failure.md`

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
