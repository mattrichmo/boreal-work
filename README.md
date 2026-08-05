```
██████   ██████  ██████  ███████  █████  ██          ██     ██  ██████  ██████  ██   ██
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██     ██ ██    ██ ██   ██ ██  ██
██████  ██    ██ ██████  █████   ███████ ██          ██  █  ██ ██    ██ ██████  █████
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██ ███ ██ ██    ██ ██   ██ ██  ██
██████   ██████  ██   ██ ███████ ██   ██ ███████      ███ ███   ██████  ██   ██ ██   ██
```

# Boreal Work

Boreal Work is a local-first runtime for evidence-backed work, project memory, and agent coordination. It stores the operational state around a codebase—work, dependencies, reservations, sources, decisions, evidence, verification, and handoffs—in durable project records.

The `bwrk` CLI is the canonical interface. Human-readable output is intended for operators; `--json` exposes versioned contracts for agents and automation.

> **Current release:** Boreal is at `0.1.0`. The runtime record schema is `boreal.runtime.v1`, and new workspaces use the `objects-v1` store. The GitHub installer works today; npm and Homebrew are supported release channels when published.

[Install](#install-and-initialize) · [Run a work loop](#example-an-evidence-backed-work-loop) · [Understand the runtime](#runtime-architecture) · [CLI reference](docs/cli/COMMANDS.md) · [Documentation map](docs/README.md)

## License

Boreal Work is source-available under the [PolyForm Noncommercial License
1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0). You may use,
modify, and redistribute the software for noncommercial purposes. Commercial
use requires separate written permission from the copyright holder.

## Technical overview

| Concern | Boreal's implementation |
| --- | --- |
| Runtime | TypeScript monorepo on Node.js 22+ |
| Command surface | `bwrk`, with plain output and `boreal.cli.result.v1` JSON envelopes |
| Domain boundary | `@boreal/engine` composes work, graph, evidence, knowledge, and storage operations |
| Canonical storage | One JSON object per record under `.boreal/objects/` |
| History | Append-only, hash-linked domain events and local operation records under `.boreal/log/` |
| Concurrency | In-process write ordering plus a cross-process workspace lock |
| Search | SQLite FTS5 index with a content-hashed JSON compatibility fallback |
| Human memory | Markdown and JSONL vault under `memory/`, normally with separate Git history |
| Recovery | Deterministic projections, ledgers, and indexes rebuilt by `sync` and checked by `doctor` |
| Interfaces | CLI, MCP server, daemon, browser console, and terminal UI over shared runtime contracts |

Boreal is not a hosted issue tracker or an autonomous coding agent. It is a project-scoped state and coordination layer that other tools can call.

## Runtime architecture

All interfaces are expected to use the same engine path instead of reimplementing lifecycle rules:

```text
CLI / MCP / daemon / console / TUI
                  │
                  ▼
         @boreal/engine
                  │
       ┌──────────┼──────────┐
       ▼          ▼          ▼
  work/graph   evidence   knowledge/search
       └──────────┼──────────┘
                  ▼
       @boreal/storage ports
                  │
       ┌──────────┴──────────┐
       ▼                     ▼
 .boreal/objects/      .boreal/log/
 canonical records     events and operations
```

A mutating command follows one orchestration path:

```text
validate input
  → resolve the exact workspace
  → load canonical records
  → run a domain operation
  → enforce policy and closeout gates
  → commit records and events atomically
  → invalidate or rebuild derived views
  → return a human view or JSON envelope
```

Important consequences:

- Readiness is derived from the canonical dependency graph; a stale `status` field is not allowed to override an open blocker.
- Claiming work rechecks readiness and creates the reservation in one write transaction.
- Evidence, verification, closeout, reservation release, and readiness repair can run as one guarded `agent finish` transaction.
- Search indexes, context projections, and JSONL ledgers are generated artifacts. They can be deleted and rebuilt from canonical records.
- The CLI discovers the nearest parent `.boreal` directory. Automation can bind to an exact project with `--workspace /absolute/path`.

See [runtime architecture](docs/architecture/RUNTIME.md), [evidence trust](docs/architecture/EVIDENCE_TRUST.md), and [project setup](docs/architecture/PROJECT_SETUP.md) for the full contracts.

## Install and initialize

Requirements: Git, Node.js 22 or newer, and pnpm or Corepack.

Install the machine CLI:

```bash
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/main/install.sh \
  | bash -s -- --machine --yes

bwrk --version
```

Install Boreal into a project:

```bash
cd your-project
bwrk install --yes
bwrk agent guide
bwrk prime --json
```

Install the agent adapters for every project on this machine:

```bash
bwrk install codex --scope user
bwrk install claude --scope user
```

Use `--scope project` (the default) when the adapter should be checked out with one repository. The global CLI, user-wide adapters, and project state are separate: `bwrk update self` updates the CLI, rerun the user-scope skill install commands to refresh global adapters, and use `bwrk update repo` for an initialized project.

In short:

| Goal | Command | Writes to |
| --- | --- | --- |
| Install the `bwrk` CLI for this machine | `./install.sh --machine --yes` (from a checkout) | `~/.local/bin` and the CLI install directory |
| Make Codex skills available in every repo | `bwrk install codex --scope user` | `~/.agents/skills` |
| Set up the current repository | `bwrk install --yes` | `.boreal/`, `memory/`, and `.agents/skills` |

The CLI installer does not install agent skills, and a user-wide skill install
does not initialize a project. `bwrk update self` updates the machine CLI from
the configured upstream ref; it does not package the current working tree.

The recommended install creates:

```text
your-project/
├── .boreal/
│   ├── project.json       project and storage configuration
│   ├── objects/           canonical per-record JSON objects
│   ├── log/               append-only events and local operations
│   ├── ledgers/           generated Git-friendly JSONL exports
│   ├── cache/             disposable SQLite indexes
│   ├── runtime/           locks and compatibility projections
│   └── results/           local spooled command results
├── .agents/skills/        installed agent adapters
└── memory/                human-readable project vault
```

By default `memory/` is a child repository with separate Git history, and project skills are installed at `.agents/skills` without folder-scoped duplication. Run interactive `bwrk install` to select another layout, or preview writes first:

```bash
bwrk install --dry-run
```

## The JSON command contract

Machine-readable commands return a stable top-level envelope:

```json
{
  "ok": true,
  "ledgerSeq": 5,
  "data": {
    "meta": {
      "id": "bw_work_example",
      "schemaVersion": "boreal.runtime.v1"
    },
    "kind": "task",
    "title": "Add request tracing",
    "status": "ready",
    "priority": "high",
    "acceptanceCriteria": [
      "Trace IDs appear in server logs"
    ],
    "dependencyIds": [],
    "evidenceIds": [],
    "verificationIds": []
  }
}
```

This is an abbreviated response from `work create`; persisted records also contain actor metadata, timestamps, source references, content hashes, labels, and closeout-gate definitions.

Use the live command registry when writing automation:

```bash
bwrk --help
bwrk help work
bwrk commands --format markdown
bwrk commands --json
bwrk version --json
```

The checked-in [CLI command reference](docs/cli/COMMANDS.md) explains behavior and error cases. The live registry is the exact syntax source for the installed version.

## Example: an evidence-backed work loop

Create ready work with explicit acceptance criteria and a declared verification command:

```bash
bwrk work create "Add request tracing" \
  --description "Attach a trace ID to each request and structured log line" \
  --kind task \
  --priority high \
  --label observability \
  --acceptance "Trace IDs appear in server logs" \
  --required-gate verification \
  --gate-command "pnpm test" \
  --gate-expect "tests pass" \
  --ready \
  --json
```

Claim it for an agent. The claim is atomic: Boreal rechecks blockers, creates an expiring reservation, moves the work to `in_progress`, refreshes its context pack, and returns a handoff bundle.

```bash
bwrk work claim <work-id> \
  --agent agent-api \
  --purpose "implement request tracing" \
  --start \
  --ttl 2h \
  --json
```

After implementation and a Git checkpoint, run the declared gate through Boreal's bounded runner, then finish with the returned evidence ID:

```bash
bwrk evidence run <work-id> --gate <gate-id> --json
```

```bash
bwrk agent finish <work-id> \
  --agent agent-api \
  --evidence <evidence-id> \
  --verdict passed \
  --close \
  --reason "acceptance criteria verified" \
  --commit <full-commit-sha> \
  --json
```

`agent finish` does more than change a status. In one guarded workflow it:

1. validates reservation ownership and expiration;
2. records evidence against the current work revision;
3. creates a verification record;
4. evaluates required gates;
5. writes the closeout summary and Git checkpoint;
6. closes the work and releases its reservation; and
7. recomputes dependent readiness.

The inline `--summary` and `--command` form records self-reported evidence; it does not execute the command. Use the witnessed path below when the gate must prove that Boreal observed the process and its outputs.

For stronger provenance, require Boreal-witnessed evidence and execute only the command declared on the gate:

```bash
bwrk work create "Harden the parser" \
  --acceptance "The parser suite passes" \
  --required-gate verification \
  --gate-command "pnpm test parser" \
  --gate-expect "tests pass" \
  --gate-trust boreal_witnessed \
  --gate-current-revision \
  --gate-current-git \
  --ready \
  --json

bwrk evidence run <work-id> --gate verification --dry-run --json
bwrk evidence run <work-id> --gate verification --json
```

The bounded runner does not invoke a shell. It records the executable, arguments, exit state, bounded output excerpts and hashes, environment and tool versions, subject revision, Git HEAD and dirty fingerprint, and requested artifact hashes. Failed and timed-out executions remain inspectable evidence but cannot satisfy a passing gate.

## Example: dependencies and derived readiness

Create two independently ready tasks, then make the documentation depend on the implementation:

```bash
bwrk work create "Add tracing middleware" --priority high --ready --json
bwrk work create "Document trace headers" --priority normal --ready --json

bwrk dep add <docs-work-id> <middleware-work-id> --json
bwrk dep tree <docs-work-id> --json
bwrk work next --json
```

The `blocks` graph edge is canonical. Adding it changes the documentation task from `ready` to `blocked`; closing the middleware task makes the documentation task ready again. `work.dependencyIds` is a generated projection retained for views and exports.

Cycle detection is explicit:

```bash
bwrk dep cycles --json
bwrk doctor --strict --json
```

## Example: coordinating parallel agents

Inspect claimable work without mutating state:

```bash
bwrk work parallel \
  --label backend \
  --agent agent-a \
  --agent agent-b \
  --limit 2 \
  --json
```

Then claim exact items, optionally with isolated Git worktrees:

```bash
bwrk agent start <work-id-a> --agent agent-a --worktree --ttl 90m --json
bwrk agent start <work-id-b> --agent agent-b --worktree --ttl 90m --json

bwrk reservation list --status active --json
bwrk agent renew --all --agent agent-a --extend 30m --json
```

Reservations are leases, not a separate work phase. Expiration or explicit release removes ownership and restores blocker-derived readiness. A claim cannot be created from a stale list/read race because selection and reservation occur inside the same locked transaction.

The worktree contract, branch naming, and cleanup behavior are documented in [lane worktree isolation](docs/architecture/LANE_WORKTREE_ISOLATION.md).

## Example: sources, claims, and decisions

Boreal keeps the reason for a task near the task without treating arbitrary Markdown as the runtime database.

```bash
bwrk source add \
  --title "Tracing design note" \
  --uri "docs/tracing.md" \
  --kind document \
  --summary "Defines trace propagation and logging fields" \
  --json

bwrk claim create \
  --statement "Every inbound request must receive a trace ID" \
  --status accepted \
  --source <source-id> \
  --json

bwrk decision create \
  --title "Use W3C trace context" \
  --decision "Adopt traceparent for inbound and outbound propagation" \
  --context "Interoperability with existing tooling" \
  --source <source-id> \
  --json

bwrk work create "Add trace propagation" \
  --source <source-id> \
  --acceptance "Outbound requests preserve traceparent" \
  --ready \
  --json
```

The runtime stores source, claim, and decision records. The vault stores durable human-readable pages and raw inputs:

```bash
bwrk raw add \
  --title "Tracing incident transcript" \
  --kind chat \
  --tag observability \
  --json

bwrk wiki create "Request tracing" \
  --source <raw-id> \
  --tag architecture \
  --json

bwrk wiki show request-tracing --json
```

Doctor validates runtime-to-vault references, raw-source reconciliation, source-backed wiki coverage, stale claims, and superseded-decision review gaps.

## Example: context and search

Claims return a bounded handoff containing the work view, reservation, context pack, freshness metadata, and focused search results. The same data is available independently:

```bash
bwrk context show <work-id> --json
bwrk context search "request tracing" --limit 10 --explain --json
bwrk search query "traceparent logs" --limit 10 --json
```

Search normally uses a versioned FTS5 table in `.boreal/cache/index-v2.sqlite`. If SQLite is unavailable, Boreal uses `.boreal/runtime/search-index.json`. Both paths share result fields and scoring behavior.

Queries repair missing or stale indexes by default. Use `--no-rebuild` when automation should fail closed instead:

```bash
bwrk search query "traceparent" --no-rebuild --json
bwrk search index --json
```

## Sync, health, and recovery

`sync refresh` rebuilds generated collaboration artifacts from canonical state:

```bash
bwrk sync refresh --strict --json
```

It refreshes context projections, search indexes, project rollups, and JSONL ledgers. It does not create a recovery snapshot; snapshots are intentional baselines.

`doctor` checks the canonical records and their derived views:

```bash
bwrk doctor --strict --json
bwrk doctor --fix --json
bwrk doctor --strict --json
```

Checks include schema and reference validity, graph consistency, duplicate IDs, reservations, gate policy, readiness, source and wiki coverage, event/operation causality, project setup, Git guards, index freshness, ledger drift, and stale locks.

`--fix` is limited to idempotent repairs such as expiring stale reservations, recomputing readiness, rebuilding projections and indexes, repairing dependency projections, restoring ignore guards, and removing stale locks. It does not silently remove tracked files or rewrite canonical meaning.

For portable state and recovery:

```bash
bwrk export json --out boreal-export.json --json
bwrk export ledgers --out .boreal/ledgers --json
bwrk snapshot create --name before-migration --json
bwrk ledger status --json
```

Portable exports exclude machine-local operation telemetry so the same project state can move between machines without acquiring another machine's command history.

## Storage boundaries

Not every file below `.boreal/` has the same authority:

| Path | Role | Authority |
| --- | --- | --- |
| `.boreal/objects/` | Work, evidence, verification, knowledge, graph, reservation, summary, directive-acknowledgement, and heartbeat records | Canonical and durable |
| `.boreal/log/events.jsonl` | Hash-linked domain events plus local, prunable operation records | Mixed: events are durable; operations are machine-local |
| `.boreal/project.json` | Workspace, memory, storage, and installed-skill configuration | Canonical and durable |
| `memory/` | Human-readable wiki, raw sources, work artifacts, ledgers, and handoffs | Durable vault data |
| `.boreal/ledgers/` | Deterministic JSONL bridge for collaboration and merge | Generated from canonical records |
| `.boreal/cache/` | SQLite object/read/search indexes | Disposable and rebuildable |
| `.boreal/runtime/` | Locks, compatibility projections, and JSON search fallback | Local and rebuildable |
| `.boreal/results/` | Local spooled command results | Local and disposable |

New workspaces use a Git-friendly per-record object store (`ObjectDirBorealStore`). The legacy `FileBorealStore` remains a supported compatibility and rollback adapter around `.boreal/runtime/state.json`. Both implement the same storage port and portable record model.

Canonical writes use atomic replacement. Cross-process mutations are serialized by `.boreal/runtime/state.lock`, with bounded waiting, owner metadata, token-based release, and guarded stale-lock recovery. Object-store commits verify the event-log head before applying changes.

## Interfaces over the same contracts

| Interface | Responsibility |
| --- | --- |
| `bwrk` CLI | Canonical command, scripting, and automation surface |
| MCP server | Selected-project tools that call scoped CLI/runtime contracts |
| Daemon | Observer and coordination status; repairs remain explicit commands |
| Browser console | Project and global-manager views loaded from CLI contracts |
| **TUI** | Optional terminal dashboard using shared UI models and runtime loaders |

The MCP and daemon boundaries reject paths that leave the selected project or enter another registered project. See [MCP server](docs/architecture/MCP_SERVER.md), [daemon](docs/architecture/DAEMON.md), [console app](docs/architecture/CONSOLE_APP.md), and [TUI contracts](docs/architecture/TUI_SURFACE_CONTRACTS.md).

## Develop from source

```bash
pnpm install
pnpm build
pnpm bwrk --help
```

Run the engineering checks:

```bash
pnpm check
pnpm test
git diff --check
```

Install a source-linked development shim:

```bash
pnpm install:local
bwrk install status --json
```

The source-linked shim executes the current checkout. Use the versioned machine install for ordinary project work and the shim only while developing Boreal itself.

Before a release or milestone closeout:

```bash
pnpm bwrk sync refresh --json
pnpm bwrk doctor --strict --json
pnpm check
pnpm test
git diff --check
```

## Repository map

```text
apps/
  cli/          canonical command surface
  mcp/          stdio MCP server
  daemon/       observer and coordinator runtime
  console/      local browser application
  tui/          terminal interface

packages/
  core/         record types, policies, schemas, IDs, and directives
  engine/       application orchestration boundary
  storage/      object/file stores, locks, event log, and indexes
  work-engine/  work lifecycle operations
  graph-engine/ dependency graph operations
  evidence-engine/
                evidence and witnessed-execution behavior
  knowledge-engine/
                sources, claims, and decisions
  search/       context packs and search models
  agent-runtime/
                reservations and agent directives
  ui-model/     shared dashboard and terminal view models

workflows/      canonical operating procedures
skills/         thin agent-facing adapters to workflows
templates/      human-readable artifact shapes
schemas/        published record, event, projection, and policy schemas
docs/           guides, contracts, architecture, product, and release notes
tests/          runtime, CLI, storage, workflow, release, and E2E tests
```

Generated build outputs and local caches should not be committed: `node_modules/`, `dist/`, `*.tsbuildinfo`, `.boreal/cache/`, `.boreal/runtime/`, `.boreal/tmp/`, and `.boreal/results/`.

## Documentation

| Document | Use it for |
| --- | --- |
| [Getting started](docs/getting-started.md) | Setup variants and a slower first work loop |
| [Core concepts](docs/concepts.md) | Work, evidence, knowledge, context, reservations, and memory |
| [CLI commands](docs/cli/COMMANDS.md) | Complete syntax, flags, JSON behavior, and error cases |
| [Runtime architecture](docs/architecture/RUNTIME.md) | Engine, storage, locks, migrations, and interface boundaries |
| [Evidence trust](docs/architecture/EVIDENCE_TRUST.md) | Self-reported, witnessed, and external evidence contracts |
| [Closeout gates](docs/architecture/CLOSEOUT_GATE_CONTRACT.md) | Verification, checkpoint, review, and audit policy |
| [Skills and workflows](docs/architecture/SKILLS_AND_WORKFLOWS.md) | Canonical procedures and agent adapters |
| [Schemas](schemas/README.md) | Published persisted record shapes |
| [Documentation map](docs/README.md) | Every maintained guide and architecture note |
