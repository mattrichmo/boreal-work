```
██████   ██████  ██████  ███████  █████  ██          ██     ██  ██████  ██████  ██   ██
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██     ██ ██    ██ ██   ██ ██  ██
██████  ██    ██ ██████  █████   ███████ ██          ██  █  ██ ██    ██ ██████  █████
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██ ███ ██ ██    ██ ██   ██ ██  ██
██████   ██████  ██   ██ ███████ ██   ██ ███████      ███ ███   ██████  ██   ██ ██   ██
```

# Boreal Work

**Local runtime for evidence-backed work, project memory, and agent handoff.**

Boreal turns tasks, sources, claims, decisions, verification, and workflow state into durable records with JSON-first command contracts and repairable Git-native artifacts. The `.boreal/` runtime tracks operational truth; the `memory/` vault preserves human-readable knowledge, ledgers, and handoff material that people can diff and agents can coordinate against.

> **Status:** v1 local runtime. `apps/cli` (`bwrk`) is the canonical command surface; the MCP server, daemon, and browser console are built on the same JSON-first contracts. npm and Homebrew packaging are prepared; the first public publish and tap push are owner actions.

---

## Why Boreal

- **Evidence-backed operational truth.** Work, evidence, verification, sources, claims, and decisions are records — not Slack threads. They survive process restarts and diff cleanly.
- **Evidence-gated closure.** Work doesn't close because someone says so; it closes because a verification record points at evidence (a passing command, a test run, a note).
- **Built for agent handoff.** Every command has a stable `--json` envelope. Agents claim work atomically, hand off safely, and read the same records people read.
- **Deterministic by design.** IDs carry actor + timestamp + nonce so imports don't collide; readiness is derived and explicitly recomputable; relationship edges use deterministic natural keys.
- **Git-native, fail-closed.** State is a file-backed store with cross-process write locking, schema-drift rejection, and a `doctor` that repairs projections and indexes.

## Install

Install the machine-level `bwrk` with npm or Homebrew after the owner publishes the prepared release artifacts:

```bash
npm install -g @boreal/cli
bwrk --version
```

```bash
brew tap mattrichmo/boreal
brew install boreal-work
bwrk --version
```

The installer channel is available for release artifacts and source checkouts:

```bash
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/main/install.sh | bash -s -- --machine --yes
```

For source development:

```bash
pnpm install
pnpm build

# run the CLI straight from source
pnpm bwrk --help

# or install a local `bwrk` shim for this checkout
pnpm install:local
bwrk --help
```

A first loop, end to end:

```bash
pnpm bwrk init
pnpm bwrk work create "Build CLI surface" --ready
pnpm bwrk work claim --label cli --agent agent-a --purpose "start implementation"
pnpm bwrk evidence add <work-id> --summary "pnpm test passed" --kind test --outcome passed --command "pnpm test"
pnpm bwrk work verify <work-id> --evidence <evidence-id>
pnpm bwrk work close <work-id> --reason "verified by tests"
```

Full walkthrough → **[docs/getting-started.md](docs/getting-started.md)**.

## Core concepts

| Concept | What it is |
| --- | --- |
| **Work** | The unit of tracked effort. Has status, labels, dependencies, and derived readiness. |
| **Evidence & verification** | Proof a work item is actually done. Closure is gated on a verification record. |
| **Sources, claims, decisions** | The knowledge layer — what's true, what backs it, and what was decided. |
| **Context packs** | Projected, searchable bundles of the records relevant to a work item. |
| **Reservations** | How an agent claims work without colliding with another agent. |
| **Memory vault** | The `memory/` tree of durable, human-readable wiki/ledger/raw records. |
| **Sprints & workflows** | Higher-level grouping and the canonical agent procedures that drive them. |

Mental model in depth → **[docs/concepts.md](docs/concepts.md)**.

## Surfaces

Boreal is a workspace with several front ends over one runtime (`@boreal/engine`):

| Surface | Package | Role |
| --- | --- | --- |
| **CLI** (`bwrk`) | `apps/cli` | Canonical command surface. Stable JSON, plain text, opt-in dashboard views. |
| **MCP server** | `apps/mcp` | Project-scoped stdio MCP server for local agent clients. |
| **Daemon** | `apps/daemon` | Observer/coordinator that watches runtime paths and reports lock/process state. |
| **Console** | `apps/console` | Local browser dashboard over CLI JSON contracts. |
| **TUI** *(planned)* | `apps/tui` | Terminal UI surface — scaffold only, no implementation yet. |

## Documentation

| Guide | Read it for |
| --- | --- |
| **[Documentation index](docs/README.md)** | The full map of every doc in this repo. |
| **[Getting started](docs/getting-started.md)** | Install, initialize, and run your first work loop. |
| **[Publishing](docs/release/publishing.md)** | Release package gates, npm publish dry run, and Homebrew tap handoff. |
| **[Concepts](docs/concepts.md)** | The mental model behind work, evidence, knowledge, and memory. |
| **[CLI commands](docs/cli/COMMANDS.md)** | The complete `bwrk` command contract (every flag, every envelope). |
| **[Runtime architecture](docs/architecture/RUNTIME.md)** | Ports, domain operations, and the engine boundary. |
| **[Skills & workflows](docs/architecture/SKILLS_AND_WORKFLOWS.md)** | How workflows, skills, and templates fit together. |
| **[Prior art & originality](docs/architecture/PRIOR_ART_ORIGINALITY.md)** | How Boreal positions itself against adjacent local-first and agent-workflow tools. |
| **[V1 closeout & adoption](docs/product/V1_CLOSEOUT_ADOPTION_GUIDE.md)** | Where v1 landed and how to adopt it. |

## Repository layout

```text
apps/        cli, mcp, daemon, console — front ends over the runtime (tui is a planned scaffold)
packages/    core, storage, engine, work-engine, evidence-engine,
             knowledge-engine, graph-engine, agent-runtime, search, ui-model
workflows/   canonical agent procedures (source of truth)
skills/      thin adapters that route to workflows
templates/   output shapes for workflow artifacts
schemas/     record, event, projection, and policy schemas
memory/      the durable memory vault (wiki, ledgers, raw, work)
docs/        architecture, CLI, and product documentation
```

### Runtime packages

- `packages/core` — durable record types, deterministic IDs, canonical hashing, timestamps, errors, policies.
- `packages/storage` — storage ports, an in-memory transactional store, and a file-backed store at `.boreal/runtime/state.json` with cross-process write locking.
- `packages/work-engine` — work lifecycle, dependency readiness, evidence-gated closure.
- `packages/evidence-engine` — evidence records and verification records.
- `packages/knowledge-engine` — sources, claims, and decisions.
- `packages/graph-engine` — deterministic relationship edges and cycle checks.
- `packages/agent-runtime` — reservations and collision policy.
- `packages/search` — context-pack projection helpers and deterministic hybrid local search-index ranking.
- `packages/ui-model` — shared view models for the CLI/TUI/console surfaces.
- `packages/engine` — outer runtime composition every surface calls.

## Development

```bash
pnpm check          # typecheck the workspace (tsc -b)
pnpm test           # run the vitest suite
pnpm build          # build all packages
pnpm doctor:strict  # CI-style hardening gate (run `pnpm bwrk init` first)
```

`pnpm doctor:strict` runs `bwrk doctor --workspace . --strict --json` and fails on warnings as well as errors.

### Verified proof slice

The runtime test covers the full happy path end to end:

```text
init -> create work -> add dependency -> derive readiness -> reserve
-> record evidence -> verify -> close -> rebuild projections -> event trail
```

The file-backed store is additionally tested for persistence across runtime instances, rollback on failed transactions, concurrent-writer serialization, stale-lock recovery, schema-drift rejection, invalid-JSON rejection, and path-escape rejection. The CLI integration test covers init fail-closed behavior, workspace resolution, idempotent concurrent init, bounded/filtered listing, atomic claim handoffs, reservation lifecycle, the full create→verify→close path, knowledge commands, search, export/import, recovery snapshots, projection/search-index repair through `doctor --fix`, and stale-lock repair through `lock break --stale-only`.

The agent E2E fixture in [docs/architecture/AGENT_E2E_FIXTURE.md](docs/architecture/AGENT_E2E_FIXTURE.md) runs the ordered local path from `init --setup-memory` through raw-source reconciliation, sprint launch, agent claim/finish, `sync refresh`, strict doctor, and JSON/Markdown/ledger exports:

```bash
pnpm test -- tests/runtime/agent-e2e.test.ts
```

### Runtime invariants

Boreal adopts common invariants from Git-native issue trackers and agent workflow tools while implementing them independently in TypeScript:

- Stable natural-key IDs belong on relationship records.
- Work IDs include actor, timestamp, and nonce inputs so same-title imports do not collide.
- Event IDs use random entropy instead of per-process sequence counters.
- Dependency edges keep deterministic natural-key IDs.
- Derived readiness has an explicit recompute/repair operation.
- Search and ready-work paths stay bounded and filterable.
- State-file writes use temp file, fsync, and rename so readers never observe a partial JSON document.

## Artifact policy

This repo is a source workspace, not a checked-in runnable bundle. Do **not** commit `node_modules/`, `dist/`, `*.tsbuildinfo`, or `.boreal/runtime` cache artifacts. Rebuild local artifacts with:

```bash
pnpm install
pnpm build
```

## Conventions

Every command accepts `--workspace <path>` and most accept `--json` for automation. Without `--workspace`, commands discover the nearest parent `.boreal`; with `--workspace`, the path is treated as the exact workspace root. See the [CLI commands reference](docs/cli/COMMANDS.md) for the global flag set, output modes, and JSON envelope contract.
