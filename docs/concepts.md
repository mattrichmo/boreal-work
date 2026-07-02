# Concepts

The mental model behind Boreal. Read this once and the [CLI commands](cli/COMMANDS.md) stop looking like a flat list and start looking like a small number of records moving through well-defined states.

← [Documentation home](index.md) · [Documentation index](README.md)

## The core idea

Most project context is ephemeral: it lives in chat, in tickets that rot, in someone's memory. Boreal makes that context **durable records** with explicit evidence, verification, sources, claims, decisions, and workflow state. A record is created once, transitions through explicit states, and leaves an event trail. Humans read the records; agents coordinate against them; Git versions the repairable artifacts.

Two roots hold everything:

- **`.boreal/runtime/`** — the durable runtime store (`state.json`), a file-backed transactional store with cross-process write locking. This is the operational source of truth.
- **`memory/`** — the human-readable vault of wiki pages, ledgers, and raw sources. This is the narrative/knowledge source of truth.

## Work

**Work** is the unit of tracked effort. A work item has a status, labels, a body, dependencies, and a *derived* readiness flag.

- Readiness is **computed**, not set by hand: a work item is ready when its dependencies are satisfied. Because it's derived, it has an explicit recompute/repair operation rather than drifting out of sync.
- Dependency edges use **deterministic natural-key IDs** and are checked for cycles.
- Work IDs embed **actor + timestamp + nonce**, so importing two work items with the same title never collides.

Lifecycle: `create` → (becomes `ready` when deps clear) → `reserved`/claimed → `verified` → `closed`.

## Evidence and verification

This is the invariant that makes Boreal more than a to-do list: **work cannot close on assertion.**

- **Evidence** is a record of something that happened — a command that ran, a test that passed, a note. It has a kind, an outcome, and optionally the command that produced it.
- **Verification** is a separate record that points at evidence and says "this satisfies the work."
- `work close` is **gated** on a verification record. No verification, no close.

This keeps the audit trail honest: every closed item can be traced back to the concrete proof that closed it.

## Knowledge: sources, claims, decisions

The knowledge layer answers "what is true here, and why."

- **Source** — a referenceable artifact (a document, a URL, a file). Claims hang off sources.
- **Claim** — a statement with a status (e.g. `accepted`) backed by one or more sources.
- **Decision** — a recorded choice, backed by sources, that captures *what was decided* so it doesn't have to be re-litigated.

Accepted claims and decisions flow into context packs, so the reasoning travels with the work.

## Context packs

A **context pack** is a projected, searchable bundle of the records relevant to a work item — its claims, decisions, and related state. Packs are *rebuilt* from the underlying records (`context rebuild`), never hand-edited, so they stay consistent with the source of truth. `context show` reads a pack; `context search` and `search query` rank across them with a deterministic hybrid local index.

## Reservations and agents

Boreal assumes multiple actors — human and agent — may work the same queue. **Reservations** are how an agent claims a work item without colliding:

- Claims are **atomic**: find-ready-and-reserve happens in one operation, so two agents can't grab the same item.
- Reservations carry a **TTL** and can be renewed, released, or repaired when stale.
- Agent-facing commands (`agent guide` / `start` / `finish`) wrap the primitives into safe handoffs, and `agent status` reports coordination state.

Every command has a stable `--json` envelope, which is what makes agent coordination practical: the agent reads exactly the structured data a human would read in a table.

## Memory vault

The `memory/` tree is the durable, human-readable side of Boreal:

- **wiki** — long-lived pages.
- **ledgers** — append-style records that merge cleanly (see the [JSONL merge driver](architecture/JSONL_MERGE_DRIVER.md)).
- **raw** — captured raw sources awaiting triage/reconciliation.
- **work**, **graph**, **dashboards** — projected views.

Memory can live in a child repo, a sibling repo, or in-repo with shared history. The installer default is child `memory/` with separate Git history, so knowledge history stays visible in the project folder without mixing into application history. See [Project setup](architecture/PROJECT_SETUP.md).

## Sprints and workflows

- **Sprints** group work for planning and reporting (`sprint list/show/activate/board/report`).
- **Workflows** are the *canonical* agent procedures — the source of truth for how an agent should move through a task. **Skills** are thin adapters that route to workflows, and **templates** shape the artifacts workflows produce. See [Skills & workflows](architecture/SKILLS_AND_WORKFLOWS.md).

## Determinism and fail-closed behavior

Boreal is built so the same inputs produce the same records and broken states surface loudly:

- Machine-facing strings (titles, labels, IDs, URIs, queries) are Unicode-normalized; unsafe control/bidi characters are **rejected**, not silently stripped.
- State-mutating commands **fail closed** until `bwrk init` exists.
- The store rejects schema drift, invalid JSON, and path escapes; transactions roll back on failure.
- `doctor` (and `doctor --fix`) recompute projections, rebuild search indexes, and repair stale locks; `doctor --strict` is the CI gate.

## How the surfaces relate

One runtime, several front ends — none of them is a second source of truth:

- **CLI (`bwrk`)** is canonical and the contract everything else builds on.
- **MCP server** exposes the same operations to local agent clients.
- **Daemon** observes and coordinates; it watches paths and reports lock/process state but never silently writes truth.
- **Console** renders the CLI's JSON in a local browser dashboard.

See [Runtime architecture](architecture/RUNTIME.md) for the engine boundary that keeps this honest.
