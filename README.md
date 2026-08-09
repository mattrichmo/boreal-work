# Boreal Work

<p align="center">
  A local project operating layer for humans and coding agents
</p>

> Boreal preserves project context, coordinates safe work, and requires evidence before work can close.

[Install](#quick-start) · [First work loop](#your-first-work-loop) · [Mental model](#the-mental-model) · [Agent manual](AGENT_README.md) · [CLI reference](docs/cli/COMMANDS.md) · [Documentation](docs/README.md)

> [!NOTE]
> **Current status:** Boreal is at <code>0.1.0</code>. The GitHub installer is available now; npm and Homebrew are supported release channels when published. New workspaces use the <code>objects-v1</code> store and the <code>boreal.runtime.v1</code> record schema.

## The problem Boreal solves

Project context is usually scattered across chat, tickets, documents, local branches, and agent sessions. When that context disappears, teams repeat work, miss dependencies, lose the reason behind decisions, or mark tasks complete without proof.

Boreal turns that context into durable, project-scoped records. Humans can inspect them, agents can coordinate against them, and Git can version the repairable artifacts. The result is a work loop that can be resumed, verified, and handed off without reconstructing the whole conversation.

## The Boreal loop

~~~mermaid
flowchart LR
    A["Chat, docs, code, tests"] --> B["Capture context"]
    B --> C["Plan dependencies"]
    C --> D["Claim safe work"]
    D --> E["Verify with evidence"]
    E --> F["Close and hand off"]
    F -. "new context" .-> B
~~~

The loop is local-first: the project keeps its own operational records and memory vault. Boreal is not a hosted issue tracker and not an autonomous coding agent; it is the state and coordination layer that other tools can call.

## What Boreal gives you

| If you are worried about… | Boreal gives you… |
| --- | --- |
| Losing the “why” behind a task | Sources, claims, decisions, and human-readable memory linked to work. |
| Starting work that is not safe yet | Dependency-derived readiness and atomic reservations with expiration. |
| “Done” meaning “someone said so” | Evidence, verification, and closeout gates that can fail closed. |
| Agents colliding or crossing project boundaries | Project-scoped ownership, Git/worktree boundaries, and durable handoffs. |
| State drifting after an interruption | Canonical records plus <code>sync</code> and <code>doctor</code> commands that rebuild or repair derived views. |

## Is Boreal a fit?

Use Boreal when a project has meaningful context to preserve, multiple actors to coordinate, or a real cost to unverifiable completion. It is especially useful for coding-agent workflows where the next session must understand what happened and what is safe to do next.

It does not replace Git hosting, code review, a general-purpose ticketing service, or the coding agent itself. It gives those tools a shared, inspectable project state.

## Quick start

For the GitHub installer, you need Git, Node.js 22 or newer, and pnpm or Corepack. Source development also requires pnpm.

### 1. Install the machine CLI

~~~bash
curl -fsSL https://raw.githubusercontent.com/mattrichmo/boreal-work/main/install.sh \
  | bash -s -- --machine --yes

bwrk --version
~~~

### 2. Set up a project

~~~bash
cd your-project
bwrk setup --yes
bwrk agent guide
~~~

<code>bwrk setup</code> initializes the current repository and creates the project runtime, memory vault, Git guards, and project-level agent skills. The machine CLI installation and project setup are separate operations.

To make an integration available in every repository on this machine:

~~~bash
bwrk integrations add codex --scope user
bwrk integrations add claude --scope user
~~~

Use the default <code>--scope project</code> when an integration belongs to only one repository. See [project setup](docs/architecture/PROJECT_SETUP.md) for alternate memory layouts and Git modes.

<details>
<summary><strong>Install and update details</strong></summary>

For a source checkout, build and install the local CLI:

~~~bash
pnpm install
pnpm build
./install.sh --machine --yes
~~~

For an already-installed machine CLI, <code>bwrk upgrade --machine</code> fetches and builds the configured upstream Git ref. The advanced equivalents are <code>bwrk update self</code> and <code>bwrk update repo</code>. None of these commands package the current working tree.

Preview project setup before writing:

~~~bash
bwrk setup --dry-run
~~~

</details>

## Your first work loop

The shortest useful Boreal loop is: create work, claim it, record proof, and close it with a handoff.

### 1. Create work

~~~bash
bwrk work create "Add request tracing" \
  --description "Attach a trace ID to each request and structured log line" \
  --acceptance "Trace IDs appear in server logs" \
  --ready
~~~

Boreal prints a work ID such as <code>bw_work_...</code>. Use that ID in the commands below.

### 2. Claim it

~~~bash
bwrk work claim <work-id> \
  --agent agent-api \
  --purpose "implement request tracing" \
  --ttl 2h
~~~

The claim is atomic: Boreal rechecks blockers, reserves the work for the agent, refreshes its context, and returns a handoff bundle. The reservation expires unless it is renewed.

### 3. Record proof

Run the project's check, then attach the result to the work item:

~~~bash
pnpm test

bwrk evidence add <work-id> \
  --summary "pnpm test passed" \
  --kind test \
  --outcome passed \
  --command "pnpm test"
~~~

### 4. Close and hand off

Use the evidence ID returned by the previous command:

~~~bash
bwrk agent finish <work-id> \
  --agent agent-api \
  --evidence <evidence-id> \
  --verdict passed \
  --close \
  --reason "acceptance criteria verified" \
  --commit <full-commit-sha>
~~~

> [!IMPORTANT]
> The <code>--command</code> on <code>evidence add</code> records what you report; it does not execute the command. For Boreal-witnessed execution, use [declared gates](#require-boreal-witnessed-evidence).

~~~mermaid
stateDiagram-v2
    [*] --> Ready
    Ready --> InProgress: claim
    InProgress --> Verified: evidence + verification
    Verified --> Closed: close
    InProgress --> Ready: release or expiry
    Closed --> [*]
~~~

<details>
<summary><strong>What <code>agent finish</code> guarantees</strong></summary>

In one guarded workflow, <code>agent finish</code>:

1. validates reservation ownership and expiration;
2. records or reuses evidence against the work;
3. creates a verification record;
4. evaluates required closeout gates;
5. writes the closeout summary and Git checkpoint;
6. closes the work and releases its reservation; and
7. recomputes dependent readiness.

</details>

## The mental model

You do not need to understand Boreal’s storage internals to use it. These are the records that matter:

| Boreal concept | Plain-English meaning | Why it matters |
| --- | --- | --- |
| **Work** | The thing to do, with acceptance criteria. | Makes “done” explicit. |
| **Dependency** | A relationship that says one item blocks another. | The ready queue reflects what is actually safe to start. |
| **Reservation** | A time-limited claim by a human or agent. | Prevents two actors from silently owning the same work. |
| **Source / claim / decision** | The reference, statement, and choice behind the work. | Keeps the reason near the task after the conversation ends. |
| **Evidence / verification** | Proof that something happened, plus the check that it satisfies the work. | Prevents closure on assertion alone. |
| **Memory vault** | Human-readable pages, raw inputs, ledgers, and handoffs. | Makes project knowledge easy to read and version. |

The key distinction is simple:

- **Canonical records** are the project’s authority.
- **Views and indexes** are convenient copies that can be rebuilt.
- **Git** versions the durable artifacts and checkpoints.

## The JSON command contract

Every command has a human-readable mode and a machine-readable mode. Add <code>--json</code> when an agent, script, or CI job needs a stable response:

~~~bash
bwrk work list
bwrk work list --json
bwrk commands --json
~~~

State-changing commands expose a stable result block:

~~~json
{
  "ok": true,
  "data": {
    "result": {
      "schemaVersion": "boreal.cli.result.v1",
      "id": "bw_work_...",
      "kind": "work",
      "status": "ready"
    }
  }
}
~~~

Use the returned ID rather than parsing human output. The live registry is the exact syntax source for the installed version:

~~~bash
bwrk --help
bwrk help work
bwrk commands --format markdown
bwrk commands --json
bwrk version --json
~~~

See the [complete CLI command reference](docs/cli/COMMANDS.md) for flags, behavior, error cases, and JSON envelopes.

## Examples by need

### Make dependencies explicit

Create two tasks, then make documentation wait for implementation:

~~~bash
bwrk work create "Add tracing middleware" --priority high --ready
bwrk work create "Document trace headers" --priority normal --ready

bwrk dep add <docs-work-id> <middleware-work-id> --json
bwrk dep tree <docs-work-id> --json
bwrk work next --json
~~~

Before the dependency, both tasks can be ready. After it is added, the documentation task becomes <code>blocked</code>; when the middleware task closes, it becomes ready again.

~~~mermaid
flowchart LR
    Middleware["Add tracing middleware"] -->|"blocks"| Docs["Document trace headers"]
~~~

Check the graph for cycles:

~~~bash
bwrk dep cycles --json
bwrk doctor --strict --json
~~~

### Coordinate parallel agents

Find claimable work without mutating state, then give exact items to separate agents:

~~~bash
bwrk work parallel \
  --label backend \
  --agent agent-a \
  --agent agent-b \
  --limit 2 \
  --json

bwrk agent start <work-id-a> --agent agent-a --worktree --ttl 90m --json
bwrk agent start <work-id-b> --agent agent-b --worktree --ttl 90m --json

bwrk reservation list --status active --json
bwrk agent renew --all --agent agent-a --extend 30m --json
~~~

Reservations are leases, not a separate work phase. Expiration or explicit release removes ownership and restores blocker-derived readiness. A stale list cannot cause a duplicate claim because selection and reservation happen inside the same locked transaction.

See [lane worktree isolation](docs/architecture/LANE_WORKTREE_ISOLATION.md) for branch naming, worktree cleanup, and the full contract.

### Preserve sources, claims, and decisions

Capture the reason for a task as structured knowledge:

~~~bash
bwrk source add \
  --title "Tracing design note" \
  --uri "docs/tracing.md" \
  --kind document \
  --summary "Defines trace propagation and logging fields"

bwrk claim create \
  --statement "Every inbound request must receive a trace ID" \
  --status accepted \
  --source <source-id>

bwrk decision create \
  --title "Use W3C trace context" \
  --decision "Adopt traceparent for inbound and outbound propagation" \
  --context "Interoperability with existing tooling" \
  --source <source-id>

bwrk work create "Add trace propagation" \
  --source <source-id> \
  --acceptance "Outbound requests preserve traceparent" \
  --ready
~~~

For raw material that still needs interpretation, capture first and reconcile later:

~~~bash
bwrk raw add \
  --title "Tracing incident transcript" \
  --kind chat \
  --tag observability

bwrk wiki create "Request tracing" \
  --source <raw-id> \
  --tag architecture

bwrk wiki show request-tracing --json
~~~

### Resume work with context and search

Claims return a bounded handoff containing the work view, reservation, context pack, freshness metadata, and focused search results. You can request the same information directly:

~~~bash
bwrk context show <work-id> --json
bwrk context search "request tracing" --limit 10 --explain --json
bwrk search query "traceparent logs" --limit 10 --json
~~~

Search repairs a missing or stale local index by default. Use <code>--no-rebuild</code> when automation should fail closed:

~~~bash
bwrk search query "traceparent" --no-rebuild --json
bwrk search index --json
~~~

### Require Boreal-witnessed evidence

When a gate must prove that Boreal observed the command and its outputs, declare the command on the work item and run the gate through Boreal’s bounded runner:

~~~bash
bwrk work create "Harden the parser" \
  --acceptance "The parser suite passes" \
  --required-gate verification \
  --gate-command "pnpm test parser" \
  --gate-expect "tests pass" \
  --gate-trust boreal_witnessed \
  --gate-current-revision \
  --gate-current-git \
  --ready

bwrk evidence run <work-id> --gate verification --dry-run --json
bwrk evidence run <work-id> --gate verification --json
~~~

The runner executes only the command already declared on the gate. It does not invoke a shell, and it records the executable, arguments, exit state, bounded output excerpts and hashes, environment and tool versions, subject revision, Git HEAD and dirty fingerprint, and requested artifact hashes. Failed and timed-out executions remain inspectable evidence but cannot satisfy a passing gate.

See [evidence trust](docs/architecture/EVIDENCE_TRUST.md) for the difference between self-reported, Boreal-witnessed, and externally attested evidence.

## How the runtime stays trustworthy

All interfaces use the same engine and storage contracts:

~~~mermaid
flowchart TB
    subgraph surfaces["Interfaces"]
        cli["bwrk CLI"]
        mcp["MCP server"]
        console["Browser console / TUI"]
        daemon["Daemon"]
    end
    engine["Shared Boreal engine"]
    operational["Canonical operational records<br/>.boreal/objects + .boreal/log"]
    memory["Human-readable memory vault<br/>memory/"]
    views["Rebuildable views<br/>context packs, indexes, ledgers"]

    surfaces --> engine
    engine --> operational
    engine --> memory
    operational --> views
~~~

This gives Boreal a few important guarantees:

| Guarantee | What it means in practice |
| --- | --- |
| **Readiness is derived** | Open dependency blockers cannot be hidden by a stale status field. |
| **Ownership is atomic** | Finding work and reserving it happen in one locked transaction. |
| **Closure is evidence-gated** | Verification, checkpoint, review, and audit requirements remain distinct. |
| **Provenance is visible** | Agent-reported, Boreal-witnessed, and external proof are not presented as equivalent. |
| **Boundaries fail closed** | Workspace, memory, Git, worktree, and path resolution cannot silently cross projects. |
| **Recovery is explicit** | Generated state can be rebuilt, and repair commands report what they changed. |

For the full contracts, see [runtime architecture](docs/architecture/RUNTIME.md), [closeout gates](docs/architecture/CLOSEOUT_GATE_CONTRACT.md), and [long-running tasks](docs/architecture/LONG_RUNNING_TASKS.md).

## Sync, health, and recovery

Use these commands when you want to inspect or repair project health:

~~~bash
bwrk sync refresh --strict --json
bwrk doctor --strict --json
bwrk doctor --fix --json
~~~

<code>sync refresh</code> rebuilds generated context projections, search indexes, project rollups, and JSONL ledgers from canonical state. <code>doctor</code> checks schema and references, dependency consistency, reservations, gate policy, readiness, source and wiki coverage, Git guards, index freshness, ledger drift, and stale locks.

<code>doctor --fix</code> is limited to idempotent repairs such as expiring stale reservations, recomputing readiness, rebuilding projections and indexes, restoring ignore guards, and removing stale locks. It does not silently remove tracked files or rewrite canonical meaning.

For portable state and recovery baselines:

~~~bash
bwrk export json --out boreal-export.json --json
bwrk export ledgers --out .boreal/ledgers --json
bwrk snapshot create --name before-migration --json
bwrk ledger status --json
~~~

## What setup creates

The recommended setup creates a runtime for operational records and a separate human-readable memory vault:

<details>
<summary><strong>Project layout</strong></summary>

~~~text
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
~~~

By default, <code>memory/</code> is a child repository with separate Git history. Project skills are installed at <code>.agents/skills</code>. New workspaces use a Git-friendly per-record object store (<code>ObjectDirBorealStore</code>). The legacy file store remains a compatibility and rollback adapter. See [runtime architecture](docs/architecture/RUNTIME.md) for storage boundaries, event history, locks, and migrations.

</details>

## Interfaces over the same contracts

| Interface | Best for |
| --- | --- |
| <code>bwrk</code> CLI | Canonical commands, scripting, and automation. |
| MCP server | Giving a selected project’s contracts to a local agent client. |
| Daemon | Observing project and coordination status. Repairs remain explicit commands. |
| Browser console | Local project and cross-project dashboards. |
| **TUI** | Optional terminal dashboard using shared runtime loaders and UI models. |

See [MCP server](docs/architecture/MCP_SERVER.md), [daemon](docs/architecture/DAEMON.md), [console app](docs/architecture/CONSOLE_APP.md), and [TUI contracts](docs/architecture/TUI_SURFACE_CONTRACTS.md).

## Develop from source

~~~bash
pnpm install
pnpm build
pnpm bwrk --help
~~~

Run the engineering checks:

~~~bash
pnpm check
pnpm test
git diff --check
~~~

Install a source-linked development shim when working on Boreal itself:

~~~bash
pnpm install:local
bwrk integrations status --json
~~~

The shim executes the current checkout. Use the versioned machine install for ordinary project work.

Before a release or milestone closeout:

~~~bash
pnpm bwrk sync refresh --json
pnpm bwrk doctor --strict --json
pnpm check
pnpm test
git diff --check
~~~

<details>
<summary><strong>Repository map</strong></summary>

~~~text
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
~~~

Generated build outputs and local caches should not be committed: <code>node_modules/</code>, <code>dist/</code>, <code>*.tsbuildinfo</code>, <code>.boreal/cache/</code>, <code>.boreal/runtime/</code>, <code>.boreal/tmp/</code>, and <code>.boreal/results/</code>.

</details>

## Documentation map

| Read this | When you need… |
| --- | --- |
| [Getting started](docs/getting-started.md) | A slower installation walkthrough and first work loop. |
| [Agent manual](AGENT_README.md) | Explicit agent protocol, JSON extraction rules, workflows, gates, checkpoints, and recovery procedures. |
| [Core concepts](docs/concepts.md) | The deeper mental model for work, evidence, knowledge, context, memory, and agents. |
| [CLI commands](docs/cli/COMMANDS.md) | Complete syntax, flags, JSON behavior, and error cases. |
| [Product contract](docs/product/PRODUCT_CONTRACT.md) | Product jobs, invariants, capability profiles, and non-goals. |
| [Runtime architecture](docs/architecture/RUNTIME.md) | Engine, storage, locks, migrations, and interface boundaries. |
| [Evidence trust](docs/architecture/EVIDENCE_TRUST.md) | Provenance, revisions, hashes, and verification behavior. |
| [Closeout gates](docs/architecture/CLOSEOUT_GATE_CONTRACT.md) | Verification, checkpoint, review, and audit policy. |
| [Project setup](docs/architecture/PROJECT_SETUP.md) | Memory layouts, Git modes, install roots, and workspace boundaries. |
| [Long-running tasks](docs/architecture/LONG_RUNNING_TASKS.md) | Durable runs, checkpoints, waits, retries, workers, and event cursors. |
| [Skills and workflows](docs/architecture/SKILLS_AND_WORKFLOWS.md) | Canonical procedures and agent-facing adapters. |
| [Schemas](schemas/README.md) | Published persisted record shapes. |
| [Documentation index](docs/README.md) | The full map of maintained guides and architecture notes. |

## License

Boreal Work is source-available under the [PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0). You may use, modify, and redistribute the software for noncommercial purposes. Commercial use requires separate written permission from the copyright holder.
