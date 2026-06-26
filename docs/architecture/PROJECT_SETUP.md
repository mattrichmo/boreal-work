# Project Setup

Boreal setup has three roots:

- Project root: the repository whose work and memory are being managed.
- Memory root: the vault, either in-repo, child repo, or sibling repo.
- Install root: where agent skills are written, such as `.agents/skills` or `.claude`.

The default project setup is intentionally conservative: `bwrk init --setup-memory` creates a sibling memory repository at `../<project>-memory`, initializes Git inside that memory root, and writes local project guards so application Git history and memory Git history do not mix.

## Supported Layouts

- Sibling separate repo: `../<project>-memory` with its own Git repository. This is the default for new setup because it keeps memory outside the project tree.
- Child separate repo: `<project>/memory` with its own Git repository and `/memory/` added to the project `.gitignore`. This matches the local nested-repo shape used by projects that want memory visibly beside source files without committing memory into app history.
- Child submodule: `<project>/memory` with its own Git repository plus `.gitmodules` metadata. Use this when the project repository should pin a specific memory repo commit. Setup writes the metadata; normal Git staging/committing of `.gitmodules` and the gitlink remains explicit.
- In-repo shared memory: `<project>/memory` tracked by the project repository. This is supported for projects that intentionally want memory history mixed with app history, but it is not the recommended default.
- Folder-scoped skills: install generated skills under the folder where agent sessions are opened.

## Setup Config

`bwrk init --setup-memory` writes `.boreal/project.json` with explicit absolute `projectRoot`, `memoryRoot`, `memoryLayout`, `memoryGitMode`, and `installRoot` values. Vault commands resolve this file before touching memory state. Without the config, vault commands use the repo-local default `<project>/memory`.

For in-repo and child memory layouts, setup rejects path escapes after symlink resolution. Sibling memory roots are allowed only when `memoryLayout` is `sibling` and the memory root shares the project root parent.

The project setup config is a local binding and setup adds `.boreal/project.json` to the project `.gitignore`. The memory vault gets its own `.gitignore` for generated runtime artifacts such as `.boreal/db/`, `.boreal/cache/`, `.boreal/locks/`, `.boreal/tmp/`, and `.boreal/results/`.

## Git Modes

- `separate`: initializes the memory root as its own Git repository. For child layout, the project `.gitignore` also gets the child memory path. For sibling layout, no project memory path is ignored because memory is outside the project tree.
- `submodule`: initializes the child memory root as its own Git repository and writes a `.gitmodules` entry using `--memory-remote`. It does not fetch a remote, push a repository, or stage a gitlink automatically.
- `shared`: does not initialize a memory Git repository. Memory files are ordinary project files. This is the default only for `--memory-layout in-repo`.
- `--separate-git`: compatibility alias for `--memory-git-mode separate`.

## Doctor Drift Checks

`bwrk doctor` validates setup drift whenever `.boreal/project.json` exists. It reports copied or moved configs whose `projectRoot` no longer matches the active workspace, missing memory roots, missing memory Git repositories for `separate` and `submodule` modes, missing project or memory `.gitignore` guards, child memory paths tracked by the project Git index, and missing or stale `.gitmodules` metadata.

`bwrk doctor --fix` restores missing ignore guards, initializes a missing memory Git repository when the memory root exists, and rewrites stale child submodule path/URL metadata. It intentionally does not remove memory paths from the project Git index or delete non-submodule `.gitmodules` entries because those are project-history decisions.

## No-Leak Rules

- Init and install must use explicit project, memory, and install roots.
- Workspace-bound commands fail closed when no Boreal workspace is resolved.
- Skill installs must not read or write sibling repositories unless the user explicitly selects them.
- Memory commands use the configured memory root from `.boreal/project.json`, fail closed when the config belongs to another project root, and should not fall back to global or unrelated project memory once setup exists.
- Installed skills use `boreal-*` names so Codex and Claude users can distinguish Boreal workflow skills from global or unrelated project skills.
- Future MCP adapters must bind to one workspace root and must not expose global memory by default.

## Init Direction

`bwrk init --interactive` asks for project root, memory layout, memory Git mode, memory remote when submodule is selected, install root, target agents, and folder-scope. Non-interactive flags provide the same data for automation.

The interactive flow should continue toward an opt-in wizard-style installer: arrow-key choices with active descriptions, back/cancel handling, a final write plan, and setup notes for non-fatal path or shell issues. JSON output and noninteractive flags remain the primary contract for agents, automation, and CI.
