```
██████   ██████  ██████  ███████  █████  ██          ██     ██  ██████  ██████  ██   ██
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██     ██ ██    ██ ██   ██ ██  ██
██████  ██    ██ ██████  █████   ███████ ██          ██  █  ██ ██    ██ ██████  █████
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██ ███ ██ ██    ██ ██   ██ ██  ██
██████   ██████  ██   ██ ███████ ██   ██ ███████      ███ ███   ██████  ██   ██ ██   ██
```

# Boreal Work

**Keep project truth alive between humans, coding agents, and sessions.**

Boreal Work is a local-first project operating layer. It preserves the state around the code: why work exists, what blocks it, who owns it, which sources and decisions matter, what evidence proves completion, and what the next person or agent should do.

Most agent tools optimize one run. Boreal optimizes the continuity between runs. The result is less context reconstruction, safer parallel work, and closeouts that can be trusted instead of merely asserted.

[Get started](docs/getting-started.md) · [Understand the model](docs/concepts.md) · [Browse CLI commands](docs/cli/COMMANDS.md) · [Open the documentation map](docs/README.md)

> **Status:** Boreal is currently a v0.1.0 local runtime. The `bwrk` CLI is the canonical interface; the browser console, MCP server, and daemon share its project-scoped contracts. The GitHub installer works today. npm and Homebrew packaging are prepared, but their first public publication remains an owner action.

## The problem Boreal solves

Serious project work rarely lives in one place. The ticket holds the task, a chat holds the reasoning, a terminal holds the test result, a person remembers the decision, and an agent session disappears with the handoff context. When the next session starts, it has to reconstruct the project before it can move it forward.

Boreal turns that fragmented context into durable, inspectable project records. The same local workspace can answer:

- What work is actually ready, and what is still blocked?
- Who or what has claimed it?
- Which source, claim, or decision explains the work?
- What acceptance gates remain?
- What concrete evidence proves it is complete?
- Where should the next human or agent resume?
- Is the workspace healthy, current, and recoverable?

This makes Boreal more than a task list. It is the continuity and accountability layer between planning, implementation, verification, memory, and handoff.

## What you gain

| Moment | Without durable project state | With Boreal |
| --- | --- | --- |
| A new session begins | Re-read chats and rediscover the repo | Load current work, decisions, context, and next actions |
| Several agents are active | Duplicate effort and branch collisions | Atomic reservations, dependency-aware queues, and lane metadata |
| Someone says “done” | Completion depends on a summary | Evidence, verification, acceptance gates, and closeout records |
| A decision is questioned later | Re-litigate it from memory | Trace it to sources, claims, and recorded rationale |
| Generated state drifts | Quietly trust stale output | Detect and repair it with `sync` and `doctor` |
| Work changes hands | Pass a fragile prose recap | Hand off structured state plus human-readable artifacts |

## One continuous project loop

```text
capture a request or source
        ↓
reconcile durable knowledge
        ↓
structure work and dependencies
        ↓
claim an actionable item
        ↓
implement with current context
        ↓
record evidence and verification
        ↓
close, summarize, and hand off
        ↓
refresh and health-check the workspace
```

Boreal supports the whole loop without requiring a hosted service:

- **Capture and memory** preserve raw inputs, wiki pages, claims, decisions, and source provenance.
- **Work and planning** model tasks, sprints, milestones, dependencies, readiness, priority, and acceptance gates.
- **Coordination** gives humans and agents atomic claims, expiring reservations, scoped queues, sessions, and worktree-aware handoffs.
- **Proof and closeout** connect evidence to verification, verification to closure, and closure to summaries and Git checkpoints.
- **Health and recovery** rebuild derived artifacts, detect stale or inconsistent state, repair safe failures, and export portable records.

## What Boreal is—and is not

Boreal is project-scoped infrastructure for work and memory. It runs locally, stores durable collaboration records beside the project, emits stable JSON for automation, and keeps human-readable knowledge available for review and Git history.

It does not choose what to build, replace Git, or act as an autonomous coding agent. It gives people and agent clients a shared operating contract so they can work from the same truth. It can be the local tracker for a project or the execution layer beneath a broader issue-tracking process.

## Quick start

Requirements: Git, Node.js 22 or newer, and pnpm (or Corepack).

### 1. Install the machine CLI

```bash
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/main/install.sh \
  | bash -s -- --machine --yes

bwrk --version
```

The installer builds a versioned bundle and places a `bwrk` shim in `~/.local/bin`. Pin an explicit release or Git ref with `--ref <tag-or-ref>`.

### 2. Install Boreal into a project

```bash
cd your-project
bwrk install --yes
bwrk agent guide
bwrk prime --json
```

The recommended setup creates project-scoped runtime state, a child `memory/` repository with separate Git history, and Codex skill adapters under `.agents/skills`. Use interactive `bwrk install` to choose another memory or agent layout, or preview all writes with `bwrk install --dry-run`.

### 3. Run an evidence-backed work loop

```bash
bwrk work create "Add a service health check" \
  --description "Expose health state for operators" \
  --acceptance "The health check passes in the test suite" \
  --required-gate verification \
  --gate-command "pnpm test" \
  --gate-expect "tests pass" \
  --ready \
  --json

bwrk work claim <work-id> \
  --agent agent-a \
  --purpose "implement the health check" \
  --start \
  --json

# After implementation, validation, and a Git checkpoint:
bwrk agent finish <work-id> \
  --agent agent-a \
  --summary "Implemented the health check; tests pass" \
  --kind test \
  --command "pnpm test" \
  --verdict passed \
  --close \
  --reason "acceptance criteria verified" \
  --commit <commit-sha> \
  --json

bwrk sync refresh --strict --json
bwrk doctor --strict --json
```

The important distinction is that `agent finish` does not merely flip a status. It records evidence, creates verification, composes the closeout summary, links the checkpoint, closes the work, and releases its reservation through one guarded workflow.

For a slower walkthrough with setup variants and individual evidence commands, use the [getting-started guide](docs/getting-started.md).

## How Boreal stores truth

New workspaces use a Git-friendly per-record object store:

| Path | Purpose | Durability |
| --- | --- | --- |
| `.boreal/objects/` | Canonical structured work, evidence, knowledge, graph, reservation, and summary records | Durable collaboration data |
| `.boreal/log/` | Append-only, hash-linked operation and event history | Durable collaboration data |
| `.boreal/project.json` | Project, memory, storage, and installed-skill configuration | Durable project metadata |
| `memory/` | Human-readable wiki, raw sources, ledgers, work artifacts, and handoffs | Durable knowledge; separate Git history by default |
| `.boreal/cache/`, `.boreal/runtime/`, `.boreal/tmp/`, `.boreal/results/` | Locks, indexes, generated read models, and local results | Local and rebuildable |

`bwrk sync refresh` rebuilds context projections, local search, and JSONL ledgers from canonical records. `bwrk doctor` checks record shape, references, graph consistency, reservations, verification policy, readiness, and installed workflow assets; repairable problems can be handled with `--fix`.

Existing compact `state.json` workspaces can be migrated with `bwrk update repo`, which also refreshes installed agent skills.

## Interfaces over one runtime

| Interface | Role |
| --- | --- |
| **CLI (`bwrk`)** | Canonical human and automation surface with plain output and stable JSON envelopes |
| **Browser console** | Local project and global-manager boards built from CLI contracts |
| **MCP server** | Project-scoped tools for compatible agent clients |
| **Daemon** | Observer and coordination status surface; it does not silently rewrite project truth |
| **TUI** | Optional terminal dashboard (`bwrk-tui`) with project and global views |

The engine remains the source of domain behavior, so interfaces do not invent their own lifecycle rules. See [runtime architecture](docs/architecture/RUNTIME.md) for the boundary.

## Find the right documentation

### Start here

| Guide | Use it for |
| --- | --- |
| [Getting started](docs/getting-started.md) | Installation, workspace setup, the first closeout, and the global manager |
| [Core concepts](docs/concepts.md) | Work, evidence, knowledge, context packs, reservations, memory, and determinism |
| [Complete CLI reference](docs/cli/COMMANDS.md) | Command groups, flags, examples, JSON envelopes, and error behavior |
| [Documentation map](docs/README.md) | Every maintained guide, reference, architecture note, and product document |

### Operate Boreal

| Guide | Use it for |
| --- | --- |
| [Canonical workflows](workflows/README.md) | The source procedures for context, memory, knowledge, work, handoff, and health |
| [Skills and workflows](docs/architecture/SKILLS_AND_WORKFLOWS.md) | How agent skill adapters route to workflows and templates |
| [Project setup](docs/architecture/PROJECT_SETUP.md) | Project roots, memory layouts, Git modes, skill roots, and no-leak rules |
| [Sync and doctor workflow](workflows/60-health/sync-and-doctor.md) | Routine health checks, safe repairs, and finish criteria |
| [Closeout gate contract](docs/architecture/CLOSEOUT_GATE_CONTRACT.md) | Verification, checkpoint, review, and audit gates |
| [Lane worktree isolation](docs/architecture/LANE_WORKTREE_ISOLATION.md) | Safe parallel execution across agents and branches |
| [Agent end-to-end fixture](docs/architecture/AGENT_E2E_FIXTURE.md) | The complete agent lifecycle exercised by the test suite |

### Understand and extend the system

| Guide | Use it for |
| --- | --- |
| [Runtime architecture](docs/architecture/RUNTIME.md) | Engine, storage, domain, and interface boundaries |
| [CLI UX contracts](docs/architecture/CLI_UX.md) | Human output, JSON output, dashboards, and exit behavior |
| [MCP server](docs/architecture/MCP_SERVER.md) | Project-scoped MCP tools and safety boundaries |
| [Daemon](docs/architecture/DAEMON.md) | Observer lifecycle, status, and ownership boundaries |
| [Console app](docs/architecture/CONSOLE_APP.md) | Browser console routes and CLI-backed data loading |
| [Schemas](schemas/README.md) | Durable record, event, projection, and policy shapes |
| [Templates](templates/README.md) | Human-readable artifact contracts |
| [Publishing](docs/release/publishing.md) | npm and Homebrew release preparation and owner handoff |

## Discover commands from the CLI

The checked-in CLI reference is the narrative guide. The live registry is the exact command truth for the installed version:

```bash
bwrk --help
bwrk help work
bwrk commands --format markdown
bwrk commands --json
```

Every command supports project discovery from the nearest parent `.boreal` directory. Use `--workspace /absolute/path/to/project` when automation must bind to an exact project. Most commands support `--json`; mutating commands fail closed when no Boreal workspace is resolved.

## Develop from source

```bash
pnpm install
pnpm build
pnpm bwrk --help

pnpm check
pnpm test
```

For a source-linked development shim:

```bash
pnpm install:local
bwrk install status --json
```

The source-linked shim executes the checkout, so use the segmented machine install for ordinary project work and the shim only while developing Boreal itself.

Before a release or milestone closeout, run:

```bash
pnpm bwrk sync refresh --json
pnpm bwrk doctor --strict --json
pnpm check
pnpm test
git diff --check
```

## Repository map

```text
apps/        CLI, MCP server, daemon, browser console, and planned TUI surfaces
packages/    core records, storage, domain engines, search, and shared UI models
workflows/   canonical operating procedures
skills/      thin agent-facing adapters to workflows
templates/   human-readable artifact shapes
schemas/     durable record and policy contracts
memory/      this project's Boreal knowledge vault
docs/        guides, command reference, architecture, product, and release notes
tests/       runtime, CLI, storage, workflow, and end-to-end verification
```

Build outputs, dependency trees, TypeScript build info, and local Boreal caches are generated artifacts. Do not commit `node_modules/`, `dist/`, `*.tsbuildinfo`, `.boreal/cache/`, `.boreal/runtime/`, `.boreal/tmp/`, or `.boreal/results/`.
