# Global Manager Layer — Design Recommendation (2026-07-02)

Status: proposal for owner review. Companion to
`docs/architecture/AUDIT_2026-07-01_ACCOUNTABILITY_AND_AGENT_CONTEXT.md` and the directive-refactor epic
(`bw_work_ada82d27cb3eef95`). Nothing here is filed as work yet.

## Product definition

The global manager is a **top-level addon**: a machine-level (later team-level) project-management layer over
any number of linked Boreal workspaces. It is the surface both humans and PM-agents use to see what is
happening and what needs to happen across projects — Trello-style boards, an inbox, a ranked "next" queue —
without ever becoming a second store of project truth.

It owns exactly three kinds of state, and projects everything else:

1. **The registry** — which projects are linked, their lifecycle state, display metadata.
2. **Global records** — work/notes/decisions that genuinely belong to no project (the global workspace that
   already exists), plus portfolio containers that *reference* project records.
3. **Rollup caches** — regenerable projections of per-project state, always stamped with freshness.

Everything else (statuses, gates, evidence, readiness) lives in project workspaces and is projected upward.
The moment global state can disagree with a project about that project's truth, the design has failed.

## The six primitives

### 1. Cross-workspace references (load-bearing; build first)

A qualified reference form — `boreal://<project-id>/<record-id>` — accepted wherever a `SourceRef` URI or
graph-edge endpoint is accepted, resolved through the registry. Design constraints:

- References are **by registry project id, never by filesystem path**, so they survive repo moves and are not
  machine-coupled (this matters for the multi-machine future in `V2_STORAGE_COLLABORATION_PLAN.md`).
- Resolution is read-only and fail-soft: a reference into an unlinked or missing project resolves to a typed
  `unresolved` result carrying the last-known rollup snapshot, never an exception that breaks a board.
- Graph edges gain optional `fromProjectId`/`toProjectId` (additive), letting global containers block on
  project work.

### 2. Rollup contract

Each project workspace exports a small versioned projection (`.boreal/rollup.json` or via the sqlite cache):
counts by status, active reservations, limbo items (`verified`, `needs_verification`), open blocking gaps,
doctor status, last event timestamp, top-N `next` directives. The global layer consumes **only rollups** —
never `state.json` directly — so one stale or schema-drifted project cannot break the whole view.

- Producer: the project itself, on every mutating command (same hook as context-pack refresh) — cheap because
  it is counts, not records.
- Aggregator: the daemon watches registered project paths and refreshes the global cache; `bwrk global` works
  without the daemon by lazy fan-out with a TTL (the `--live-cache-ttl-ms` flag already exists).
- Honesty rule: every rollup carries `generatedAt`; the UI renders staleness per project instead of
  pretending liveness.

### 3. Global capture (inbox-first)

`bwrk capture "<note>" [--label ...] [--uri ...]` works from **any cwd**, registry-present or not, and lands
in the global inbox (the existing `memory/raw` machinery, globally scoped). No routing decision at capture
time. A triage flow (the existing raw-inbox workflow, pointed at the global vault) later routes each item:
promote to a project (as work, claim, decision, or source — carrying a provenance reference back to the
capture), keep global, or drop. The board gets an Inbox column for free; discoveries stop dying in whatever
repo you were standing in.

### 4. Portfolio containers

Global work items of kind `milestone`/`sprint` (later `epic`/`phase`) whose dependencies are §1 references
into project workspaces. Readiness derives across the boundary using rollup status for the referenced items:
a global initiative is `blocked` while any referenced project item is open, exactly like local
`deriveReadinessStatus`. This is the cross-repo paired-work-order pattern promoted to a first-class object.

### 5. Aggregate next — the killer view

`bwrk global next [--agent <id>] [--json]`: fan `bwrk next` across every linked project (from rollups, not
live fan-out), rank, and return the single most important directive per project plus one overall. This is the
PM's morning view, and no other tracker can build it honestly because no other tracker's "needs to happen"
column is derived from enforcement. Ranking inputs: severity, priority of subject, **age of obligation**
(ready-rot, limbo age, expired reservations — all derivable from event logs projects already write).

### 6. Honest kanban (the thin gorgeous layer)

The console's global view: one lane per project (or per initiative), columns mapped to *derived* statuses,
plus Inbox and Next rails. Writes from the UI are command invocations — drag to In Progress issues
`work reserve`, drag to Closed issues `work close` **and visibly refuses when gates are unsatisfied, showing
the gap**. Never let the UI place a card in a state the runtime did not derive; a board that refuses to lie
is the UI expression of the whole system. The console already renders CLI JSON contracts — keep that boundary
absolute.

## Link / delink semantics

Linking must be trivially reversible and non-invasive:

- `bwrk global link <path> [--name --label]` — validates the target is (or can become) a Boreal workspace;
  if uninitialized, offers `bwrk init` there (prompt, or `--init` flag non-interactively). Writes a registry
  entry and backfills the first rollup. **Writes nothing into the project repo** — linking is a machine-local
  registry fact, so linking someone else's checkout never dirties it.
- `bwrk global unlink <project-id>` — soft by default: entry moves to `archived` (kept for reference
  resolution and history), rollups stop refreshing, boards hide it. `--purge` removes the entry entirely.
  **Never touches project data.**
- Dangling references: global records referencing an unlinked project keep their references; resolution
  reports `unresolved (project unlinked)` with the last rollup snapshot. Relinking the same project id
  restores resolution. Registry ids must therefore be stable across unlink/relink (derive from project config
  identity, not insertion order).
- Registry id contract: new entries derive `project_<hash>` from a durable identity fingerprint. The fallback
  chain is project setup identity from `.boreal/project.json` contents first (explicit future `id`/`projectId`
  if present, otherwise install-time `createdAt` plus non-path setup shape), then project Git remote
  fingerprint, then normalized project-root path hash. If two different fingerprints collide on the short id,
  the later entry receives a deterministic collision-salted id and keeps its full fingerprint in the row.
- Registry migration: `boreal.project-registry.v1` files migrate additively to `boreal.project-registry.v2`.
  Existing ids are preserved to avoid breaking references; missing lifecycle defaults to `linked`, and missing
  identity is backfilled from the existing row's path when no stronger source was stored.
- Lifecycle states in the registry entry: `linked | paused | archived | missing` (path gone — `registry
  doctor` already detects drift; promote that to a state instead of just a warning).

## Install and packaging

Two things people conflate; keep them separate:

1. **The `bwrk` binary** — package manager's job.
2. **The global workspace** — a first-run experience (`bwrk global init`), not a package.

That separation is what makes "global manager as top-level addon" clean: one package, and the addon is
activated by a command, not a different install artifact.

### Packaging track

- **Phase A (now → npm):** build `apps/cli` to a self-contained `dist` with a real bin entry (the current
  shim runs `tsx` against source and requires a checkout — fine for dev, not distributable). Publish as a
  single npm package (`npm i -g bwrk` or `@boreal/bwrk`). All workspace packages bundle in; no runtime
  `node_modules` resolution outside the package.
- **Phase B (Homebrew):** formula wrapping the npm tarball (node dependency), the standard route for
  node CLIs. Later, if node-free install matters, a Node SEA / bun-compiled single binary — but do not block
  brew on that.
- The CLI must know its install channel (`bwrk --version` reporting `source|npm|brew`) so `doctor` can give
  channel-correct upgrade advice; `install-status.ts` already does a version of this for the shim.

### install.sh flow

A curl-able `install.sh` that orchestrates, with every prompt skippable by flags for CI:

```
install.sh                  # interactive default
  1. Install/upgrade bwrk binary (npm global or brew if available; else download).
  2. Detect existing global: registry file at the registry root?
     - exists  -> "Global manager already set up (N projects linked)." (skip prompt)
     - missing -> "Set up the global manager (cross-repo boards, inbox, next queue)? [Y/n]"
                  yes -> bwrk global init
  3. If run inside a repo: "Link this repo to the global manager? [Y/n]" -> bwrk global link .

install.sh --repo           # repo-only path
  1. Ensure binary.
  2. Skip the global setup prompt entirely.
  3. Run project install in cwd (bwrk install ...).
  4. If a global registry already exists: auto-link (or --no-link to skip); if not, print one line
     telling the user the global addon exists. Never create global implicitly.

install.sh --global | --no-global | --yes    # non-interactive overrides
```

Idempotency rules: re-running never re-prompts for things that exist; `--repo` on an already-installed repo
is a no-op upgrade; global detection is by registry file presence, not by guessing from PATH.

### First-run inside `bwrk` itself

Mirror the same logic in the CLI so the addon works regardless of how the binary arrived (brew users never
run install.sh): any `bwrk global ...` command in the absence of a registry offers
"Global manager is not set up. Initialize now? [Y/n]" (`--json` mode: typed error with the init command, no
prompt). This makes the package-manager story trivial — `brew install` ships only the binary, and the addon
self-bootstraps on first use.

## What global work items are for (scope guard)

With capture (§3) and portfolio containers (§4), the global workspace's work items should be *only*:
portfolio containers, cross-project chores (e.g. "upgrade bwrk in all repos"), and triaged inbox items that
genuinely belong to no repo. Anything that names a single repo's code belongs in that repo's workspace —
the triage flow should push it there. Two of the current global items drifted into exactly this trap
(closeout/gate reliability work that belongs to the boreal-work repo); the triage convention prevents the
global backlog from becoming a junk drawer.

## Phasing

| Phase | Delivers | Depends on |
|---|---|---|
| 0 | Registry lifecycle states + stable ids + link/unlink semantics above | nothing (registry-only) |
| 1 | Reference URIs + fail-soft resolution | 0 |
| 2 | Rollup contract + daemon aggregation + staleness stamps | 0 |
| 3 | Global capture + triage routing to projects | 1 |
| 4 | `bwrk global next` + aging signals | 2 |
| 5 | Portfolio containers (cross-boundary readiness) | 1, 2 |
| 6 | Console global board (honest kanban, drag=command) | 2, 4; 5 for initiative lanes |
| A/B | npm dist build → install.sh → brew formula | independent track, start anytime |

Phases 0, 2, and A are independent and can start immediately; 1 touches core record types and should wait for
Sprint 6 (hardening) to land. The packaging track is deliberately decoupled — a distributable binary makes
every other phase easier to dogfood.

## Explicit non-goals

- Global never stores project truth (no mirrored work items, no editable copies).
- No second workflow engine at the global level — global directives come from the same registry mechanism.
- No multi-user/multi-machine sync in v1 — but reference URIs and registry ids are designed now so they
  survive that transition (`V2_STORAGE_COLLABORATION_PLAN.md`).
- The UI stays thin: renders CLI JSON, writes through commands, adds zero private state beyond view prefs.
