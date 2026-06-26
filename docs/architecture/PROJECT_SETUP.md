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
- Future MCP adapters must bind to one workspace root and must not expose global memory by default.

## Init Direction

`bwrk init --interactive` should ask for project root, memory layout, separate Git preference, install root, target agents, and folder-scope. Non-interactive flags should provide the same data for automation.
