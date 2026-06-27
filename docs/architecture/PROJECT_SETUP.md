# Project Setup

Boreal setup has three roots:

- Project root: the repository whose work and memory are being managed.
- Memory root: the `memory/` vault, either in-repo, child repo, or sibling repo.
- Install root: where agent skills are written, such as `.agents/skills` or `.claude`.

## Supported Layouts

- In-repo memory: `<project>/memory`.
- Child memory repo: `<project>/memory` with its own Git repository.
- Sibling memory repo: `../<project>-memory` with explicit config.
- Folder-scoped skills: install generated skills under the folder where agent sessions are opened.

## No-Leak Rules

- Init and install must use explicit project, memory, and install roots.
- Workspace-bound commands fail closed when no Boreal workspace is resolved.
- Skill installs must not read or write sibling repositories unless the user explicitly selects them.
- MCP and daemon adapters must call the shared `@boreal/core` project-boundary guard per request, bind to one selected workspace root, and must not expose global memory by default.
- `.boreal/mcp.json` is local machine config for project-scoped MCP launches. It must be ignored by Git and must name a `--workspace` that resolves to the selected project.
- Local source checkouts run through `pnpm bwrk <command>` without requiring a global install. `bwrk install status --json` reports whether that source runner is available, whether the local shim exists and is executable, whether the shim directory is on PATH, and whether the resolved global `bwrk` passes `--version`.

## Init Direction

`bwrk init --interactive` should ask for project root, memory layout, separate Git preference, install root, target agents, and folder-scope. Non-interactive flags should provide the same data for automation.
