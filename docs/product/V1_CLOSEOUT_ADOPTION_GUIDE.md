# V1 Closeout Report And Adoption Guide

Evidence timestamp: 2026-06-27T12:22Z from the local `codex/runtime-cli-hardening-20260627` checkout.

This report closes the v1 implementation/readiness pass at the documentation level. It does not by itself close the final v1 tracker gate; `S10T09 - Close v1 milestone with evidence and verification` remains the explicit final tracker closure after this artifact is verified.

## Current Tracker State

Live `v1-remainder` queue evidence:

- Total `v1-remainder` records: 146.
- Closed: 141.
- In progress: 1, `S10T08 - Produce v1 closeout report and adoption guide`.
- Ready: 1, `S10T09 - Close v1 milestone with evidence and verification`.
- Blocked parent gates: 3, including the v1 bucket, Sprint 10, and Phase 10C until S10T08/S10T09 close.

Sprint 10 status:

- Phase 10A, package and install hardening: closed.
- Phase 10B, generated docs and agent test suite: closed.
- S10T07, strict doctor, tests, and browser verification: closed with evidence and verification.
- S10T08: this report.
- S10T09: final evidence-backed milestone closure.

## Architecture Status

V1 now has a coherent local runtime, command, and integration boundary:

- `apps/cli` is the canonical command surface. It keeps JSON output stable for automation and separates plain human output from opt-in terminal dashboard views.
- `@boreal/engine` owns runtime orchestration; domain packages stay behind storage and engine contracts.
- `FileBorealStore` remains the durable runtime adapter at `.boreal/runtime/state.json`, with cross-process write locks, atomic replace, stale-lock repair, and schema validation.
- `sync refresh` is the generated-artifact closeout command. It rebuilds context projections, the search index, JSONL ledgers, and the SQLite generated cache.
- JSONL ledgers are Git-friendly rebuild/export artifacts, not the primary writer yet.
- SQLite is a disposable generated cache/read model, not the primary runtime database.
- Project setup now distinguishes project root, memory root, and skill install root, with explicit memory Git modes and no-leak guards.
- The browser console is a local dashboard over CLI JSON contracts. It is not a source of truth.
- MCP and daemon surfaces are project-scoped. MCP mutating tools route through scoped `bwrk --workspace <project-root>` commands with confirmation and operation evidence. The daemon is an observer/status surface, not a second writer.

## Verification Evidence

Release-gate evidence from S10T07:

- `pnpm bwrk sync refresh --json` passed.
- `pnpm bwrk doctor --strict --json` passed.
- `pnpm check` passed.
- `pnpm test` passed with 21 test files and 190 tests.
- `pnpm console:build` passed.
- `pnpm console:smoke` passed across desktop and mobile console routes.
- `pnpm console:browser-smoke` passed through local Chrome DevTools, with screenshots, nonblank route markers, no console errors, and no horizontal overflow.
- `pnpm bwrk doctor skills --json` passed with 38 workflows, 15 templates, 11 skills, and no issues.
- `pnpm bwrk dashboard global --json` passed and returned healthy project/registry/dashboard state.
- `pnpm daemon:status`, `pnpm daemon:watch:once`, and `pnpm mcp:dev` passed after workspace install metadata was repaired.
- `git diff --check` passed.

One release-gate defect was found and fixed during S10T07: the pnpm lockfile lacked workspace importers for `apps/daemon` and `apps/mcp`, and `apps/cli` did not have its `@boreal/daemon` dependency represented in the lockfile. That caused daemon package scripts to fail at runtime after build. The fix refreshed the lock metadata, restored package-local workspace links, added a package-smoke lockfile regression test, and made the package-smoke console check use its fixture `bwrk` shim instead of ambient `PATH`.

Ledger export evidence after S10T08 claim and pre-closeout refresh:

- Work items: 153.
- Evidence records: 151.
- Verification records: 148.
- Graph edges: 251.
- Reservations: 139.
- Events: 1626.
- Projections/context packs: 154/153.

## Adoption Guide

Use source mode first:

```bash
pnpm install
pnpm check
pnpm test
pnpm bwrk --help
```

Install a local `bwrk` shim only when the machine needs a global command:

```bash
pnpm install:local
bwrk install status --json
```

Initialize a project with explicit roots. Prefer separate memory history unless mixed app/memory commits are intentional.

Sibling memory repo:

```bash
bwrk init \
  --setup-memory \
  --memory-root ../my-project-memory \
  --memory-layout sibling \
  --memory-git-mode separate \
  --install-root .agents/skills \
  --skill-target codex \
  --json
```

Child memory repo inside the project:

```bash
bwrk init \
  --setup-memory \
  --memory-root memory \
  --memory-layout child \
  --memory-git-mode separate \
  --install-root .agents/skills \
  --skill-target codex \
  --json
```

For automation, always scope commands:

```bash
bwrk --workspace /absolute/path/to/project prime --json
bwrk --workspace /absolute/path/to/project sync refresh --json
bwrk --workspace /absolute/path/to/project doctor --strict --json
```

Use the agent lifecycle for owned work:

```bash
bwrk agent guide --agent <agent-id> --json
bwrk session start --agent <agent-id> --json
bwrk prime --agent <agent-id> --json
bwrk agent start --agent <agent-id> --purpose "start implementation" --json
bwrk agent finish current --agent <agent-id> --summary "implemented and tested" --kind test --command "pnpm test" --verdict passed --close --reason "verified" --json
```

Console development and verification:

```bash
pnpm console:dev
pnpm console:smoke
pnpm console:browser-smoke
```

The console default URL is `http://127.0.0.1:4318`. Browser smoke uses fixture mode by default and writes screenshots under `apps/console/.boreal/results/console-browser-smoke`.

MCP and daemon local checks:

```bash
pnpm build
node apps/mcp/dist/index.js --workspace /absolute/path/to/project
pnpm daemon:status
pnpm daemon:watch:once
```

Keep MCP client config local. `.boreal/mcp.json` contains machine paths and is intentionally ignored.

## Git Boundaries

Do not commit generated dependency/build/runtime artifacts:

- `node_modules/`
- `dist/`
- `*.tsbuildinfo`
- `.boreal/runtime`
- `.boreal/cache`
- `.boreal/results`

If memory uses `separate` Git mode, commit memory changes in the memory repository and project changes in the project repository. Do not stage child `memory/` contents into the project Git history unless `memory-git-mode shared` is the explicit policy.

The JSONL merge driver is local checkout config:

```bash
git config --local merge.boreal-jsonl.name "Boreal deterministic JSONL ledger merge"
git config --local merge.boreal-jsonl.driver "node tools/boreal-jsonl-merge-driver.mjs %O %A %B %P"
```

## Command Inventory

The current registry exposes 95 commands across these categories: agent, claim, compact, context, daemon, dashboard, decision, dependency, doctor, duplicate, evidence, export, import, install, ledger, lock, merge, meta, operation, raw, registry, reservation, search, session, snapshot, source, sprint, sync, vault, wiki, work, workflow, and workspace.

Use these references instead of copying command text into downstream docs:

- Full hand-maintained reference: `docs/cli/COMMANDS.md`.
- Generated registry reference: `bwrk commands --format markdown`.
- Machine-readable registry: `bwrk commands --json`.

## Known Limitations

- `.boreal/runtime/state.json` is still the primary durable runtime adapter.
- JSONL ledgers are deterministic export/import collaboration artifacts, not the primary runtime backend.
- SQLite is a generated cache only.
- Schema validation is hand-written, although schema/validator parity is now tested.
- Wiki pages can back source-linked claims and decisions, but runtime JSON remains the primary source of truth for those records.
- Narrower dashboard endpoints for project, sprint, queues, health, and status remain future work beyond `dashboard global`.
- First-class claim review/status transition commands and decision supersession commands remain future work.
- The daemon intentionally does not repair or refresh state implicitly.

## Next V2 Candidates

1. Add a doc-check command that compares `docs/cli/COMMANDS.md` against `bwrk commands --format markdown`.
2. Add narrower dashboard JSON endpoints for project, sprint, queues, health, and status.
3. Promote claim review/status transitions and decision supersession into first-class commands.
4. Define when larger registries should query SQLite cache instead of JSON state.
5. Expand real-ledger JSONL merge-driver fixtures.
6. Add larger MCP client fixtures against local stdio transport.
7. Decide whether the daemon should gain an explicit opt-in `sync refresh` trigger that still routes through CLI command contracts.

## Closeout Rule

Before any release or milestone closeout, run:

```bash
pnpm bwrk sync refresh --json
pnpm bwrk doctor --strict --json
pnpm check
pnpm test
git diff --check
```

For UI or console changes, also run:

```bash
pnpm console:build
pnpm console:smoke
pnpm console:browser-smoke
```
