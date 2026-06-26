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

## Setup Config

`bwrk init --setup-memory` writes `.boreal/project.json` with explicit absolute `projectRoot`, `memoryRoot`, and `installRoot` values. Vault commands resolve this file before touching memory state. Without the config, vault commands use the repo-local default `<project>/memory`.

For in-repo and child memory layouts, setup rejects path escapes after symlink resolution. Sibling memory roots are allowed only when `memoryLayout` is `sibling` and the memory root shares the project root parent.

## No-Leak Rules

- Init and install must use explicit project, memory, and install roots.
- Workspace-bound commands fail closed when no Boreal workspace is resolved.
- Skill installs must not read or write sibling repositories unless the user explicitly selects them.
- Installed skills use `boreal-*` names so Codex and Claude users can distinguish Boreal workflow skills from global or unrelated project skills.
- Future MCP adapters must bind to one workspace root and must not expose global memory by default.

## Init Direction

`bwrk init --interactive` asks for project root, memory layout, separate Git preference, install root, target agents, and folder-scope. Non-interactive flags provide the same data for automation.

The interactive flow should continue toward an opt-in wizard-style installer: arrow-key choices with active descriptions, back/cancel handling, a final write plan, and setup notes for non-fatal path or shell issues. JSON output and noninteractive flags remain the primary contract for agents, automation, and CI.
