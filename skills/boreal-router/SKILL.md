---
name: boreal-router
description: Boreal Router skill for Boreal project-scoped workflows. Use when the user asks to run or reason about Boreal memory/workflow commands for: route request.
---

# Boreal Router

## Required First Step

Confirm the current project context. Prefer `bwrk prime --json` when the workspace is initialized, or ask for the explicit project root before reading or writing memory.

## Routing Rules

- Read `boreal.yaml` in this skill folder to identify the canonical workflow refs.
- Resolve each workflow ref before executing steps: first try the repo-relative `workflows/<ref>` path from the Boreal checkout or current workspace, then use `bwrk workflows show <ref>` when the local workflow file is not present.
- Treat the `workflows/...` entries below as source workflow references, not paths that must exist inside the installed skill folder.
- Stop and report the missing workflow source if neither the local file nor `bwrk workflows show <ref>` is available.
- Follow the workflow's allowed commands and finish criteria.
- Keep this skill as a thin adapter; do not invent steps that belong in the workflow file.
- If the request crosses repositories, stop and ask for the explicit workspace and memory root.

## Workflow References

Use the value after `workflows/` with `bwrk workflows show <ref>` if the repo-relative file is not available.

- `workflows/00-agent/route-request.md`

## No-Leak Rules

- You may read this skill folder's `SKILL.md`, `boreal.yaml`, and target metadata such as `agents/openai.yaml` to follow this adapter.
- Do not read sibling or unrelated workspace `memory/`, `.boreal/`, `.agents/`, or `.claude/` folders unless the user explicitly scopes the request there.
- Do not use global memory as a fallback for a missing workspace.
- Do not install or refresh skills outside the selected install root.

## Completion

End with the workflow result, verification status, and the next suggested workflow.
