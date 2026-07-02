# Getting started

This guide takes you from a fresh checkout to a closed, evidence-backed work item.

← [Documentation home](index.md) · [Documentation index](README.md)

## Prerequisites

- **Node.js >= 22**
- **pnpm 9** (`packageManager` is pinned to `pnpm@9.15.1`)
- Git (Boreal is git-native; state and memory are meant to be committed)

## Install

```bash
pnpm install
pnpm build
```

You can run the CLI two ways.

**From source**, with the workspace script:

```bash
pnpm bwrk --help
```

**As a local `bwrk` shim**, while the package is unpublished:

```bash
pnpm install:local
bwrk --help
```

`install:local` builds the workspace and writes an executable shim to `~/.local/bin/bwrk` (override with `BOREAL_BIN_DIR` or `--bin-dir <path>`). The shim runs *this checkout's* built CLI, so rebuild and re-run the installer if you move the repo. If local pnpm policy blocks script execution, run the installer steps directly:

```bash
node node_modules/typescript/bin/tsc -b
node tools/install-local-bwrk.mjs
```

### Version compatibility

Boreal supports three install scopes on one machine: a source checkout (`pnpm bwrk`), a machine-level binary (`bwrk` from npm or Homebrew), and a repo-pinned package at `node_modules/.bin/bwrk`. When a machine binary is run inside a repo that declares a pinned package, the launcher must delegate to that repo-pinned binary before touching runtime state. If the pinned binary is missing because dependencies are not installed, Boreal fails closed with a typed error that names `pnpm install`; it does not fall back to the machine binary.

Patch-level skew between the machine launcher and repo-pinned binary is allowed. Major or minor skew is reported by `bwrk doctor` as `install.version_skew` with channel-correct upgrade commands. A binary may only operate on the file-store schema it supports (`boreal.file-store.v1` today); newer state files are rejected by doctor and by the storage adapter instead of being read silently.

The rest of this guide uses `pnpm bwrk`; substitute `bwrk` if you installed the shim.

## Install Boreal into a project

```bash
pnpm bwrk install
```

The installer walks through project setup in a TTY. The recommended default creates `memory/` inside the project as a separate Git repository, keeps the app repository clean with `.gitignore` guards, and installs Codex skills into `.agents/skills`.

For unattended setup with the recommended defaults:

```bash
pnpm bwrk install --yes
```

To preview without writing files:

```bash
pnpm bwrk install --dry-run
```

`init` remains the low-level primitive. Plain `init` is idempotent and creates durable runtime state at `.boreal/runtime/state.json`; it does **not** create memory files. Use `init --setup-memory` only when you need explicit noninteractive setup flags.

See [Project setup](architecture/PROJECT_SETUP.md) for sibling, shared-history, and submodule layouts.

> **Workspace resolution:** without `--workspace`, every command walks upward from the current directory until it finds `.boreal`. With `--workspace <path>`, that exact path is the workspace root (no discovery).

## Your first work loop

### 1. Create work

```bash
pnpm bwrk work create "Build CLI surface" --ready
pnpm bwrk work list --status ready --label cli --limit 20
pnpm bwrk work next --label cli
```

### 2. Claim it

A single atomic call that finds ready work, reserves it for an agent, and returns guidance:

```bash
pnpm bwrk work claim --label cli --agent agent-a --purpose "start implementation"
```

Or do it in steps, the way an agent does:

```bash
pnpm bwrk agent guide  --label cli --agent agent-a
pnpm bwrk agent start  --label cli --agent agent-a --purpose "start implementation"
pnpm bwrk reservation list --agent agent-a --status active
```

Reservations have a TTL. Renew or release as needed:

```bash
pnpm bwrk work renew <work-id> --ttl 2h
pnpm bwrk work release <work-id>
```

### 3. Record evidence and verify

Work doesn't close on assertion — it closes on evidence plus a verification record pointing at it:

```bash
pnpm bwrk evidence add <work-id> --summary "pnpm test passed" --kind test --outcome passed --command "pnpm test"
pnpm bwrk work verify <work-id> --evidence <evidence-id>
pnpm bwrk work close  <work-id> --reason "verified by tests"
```

An agent can do evidence → verify → close in one handoff:

```bash
pnpm bwrk agent finish <work-id> --agent agent-a \
  --summary "implemented and tested" --command "pnpm test" \
  --close --reason "verified by evidence"
```

> **Work references** accept an exact work ID, an unambiguous ID prefix (≥12 chars), or an exact normalized title. `current` / `active` resolve to the selected actor or agent's single active reservation.

## Capture knowledge

Sources back claims; claims and decisions feed context packs:

```bash
pnpm bwrk source add --title "Design note" --uri "file://design.md" --kind document
pnpm bwrk claim create --statement "Context packs include accepted claims" --status accepted --source <source-id>
pnpm bwrk decision create --title "Expose context" --decision "Expose context packs through the CLI" --source <source-id>
```

## Context and search

```bash
pnpm bwrk context rebuild
pnpm bwrk context show <work-id>
pnpm bwrk search index
pnpm bwrk search query "context packs"
pnpm bwrk context search "accepted claims"
```

## Export, snapshot, import

```bash
pnpm bwrk export json --out boreal-export.json
pnpm bwrk export markdown --out .boreal/exports/markdown
pnpm bwrk snapshot create --name baseline
pnpm bwrk import json --from boreal-export.json
```

## Keep it healthy

```bash
pnpm bwrk doctor --fix          # repair projections and search indexes
pnpm doctor:strict              # CI-style gate: fails on warnings too
```

Run `pnpm bwrk init` before `doctor:strict` on a fresh workspace.

## Where to go next

- **[Concepts](concepts.md)** — the model behind these commands.
- **[CLI commands](cli/COMMANDS.md)** — every command, flag, and JSON envelope.
- **[Skills & workflows](architecture/SKILLS_AND_WORKFLOWS.md)** — the agent procedures that orchestrate these primitives.
