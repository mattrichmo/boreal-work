# Project Setup

Boreal setup has four root families:

- Project root: the repository whose work and memory are being managed.
- Memory root: the `memory/` vault, either in-repo, child repo, or sibling repo.
- Install root: the user-selected skill root preference, such as `.agents/skills`.
- Target-specific skill roots: resolved per-agent install roots stored in project setup and registry state, such as `.agents/skills` for Codex and `.claude/skills` for Claude.
- Workflow asset root: the source of Boreal workflows, templates, and skill adapters. It resolves from `BOREAL_ASSET_ROOT`, the workspace root, or the installed/source checkout that contains `workflows/`, `templates/`, and `skills/`.

## Supported Layouts

- In-repo memory: `<project>/memory`.
- Child memory repo: `<project>/memory` with its own Git repository.
- Sibling memory repo: `../<project>-memory` with explicit config.
- Child submodule memory: `<project>/memory` as a real Git submodule gitlink. `.gitmodules` path/URL metadata is necessary but not sufficient; doctor reports an error until the project index contains a `160000` gitlink for the child path.
- Folder-scoped skills: install generated skills under the folder where agent sessions are opened.

## No-Leak Rules

- Init and install must use explicit project, memory, and install roots.
- Setup writes `skillInstallRoots[]` so future `install codex`, `install claude`, registry, manifest, and doctor surfaces all agree on the target-specific resolved root.
- Workspace-bound commands fail closed when no Boreal workspace is resolved.
- Skill installs must not read or write sibling repositories unless the user explicitly selects them.
- Workflow and MCP skill asset resolution must not depend on the current source checkout layout; use the resolved workflow asset root instead of hard-coded repository-relative paths.
- MCP and daemon adapters must call the shared `@boreal/core` project-boundary guard per request, bind to one selected workspace root, and must not expose global memory by default.
- `.boreal/mcp.json` is local machine config for project-scoped MCP launches. It must be ignored by Git and must name a `--workspace` that resolves to the selected project.
- Local source checkouts run through `pnpm bwrk <command>` without requiring a global install. `bwrk install status --json` reports whether that source runner is available, whether the local shim exists and is executable, whether the shim directory is on PATH, and whether the resolved global `bwrk` passes `--version`.
- `bwrk doctor` resolves a single environment manifest covering project, memory, skills, Git mode, runtime, and workflow asset roots. Diagnostics should read from that manifest instead of reconstructing root paths independently.

## Init Direction

`bwrk init --interactive` should ask for project root, memory layout, separate Git preference, install root, target agents, and folder-scope. Non-interactive flags should provide the same data for automation.
