# Console App

Status: Sprint 04 local development runbook.

The console app lives in `apps/console`. It is a local browser dashboard for the current Boreal workspace, backed by the same JSON-first CLI contracts that agents use. It is not a replacement source of truth; runtime records, memory files, generated ledgers, and `bwrk` JSON output remain canonical.

## Local Commands

Run these from the repository root unless noted.

```bash
pnpm console:build
pnpm console:dev
pnpm console:render -- --mode live --route /repo --out .boreal/results/console-repo-live.html
pnpm console:smoke -- --mode fixture --out .boreal/results/console-route-smoke.json
pnpm console:browser-smoke -- --mode fixture --out .boreal/results/console-browser-smoke.json
```

`pnpm console:dev` builds `apps/console` and starts the local server with `--workspace ../..` from the package directory. The default URL is `http://127.0.0.1:4318` unless that port is already occupied by another process.

For one-off commands without package scripts, call the built files directly:

```bash
node apps/console/dist/server.js --workspace . --mode live
node apps/console/dist/render-file.js --workspace . --mode fixture --route /settings --out .boreal/results/console-settings-fixture.html
node apps/console/dist/browser-smoke.js --workspace . --mode fixture --out .boreal/results/console-browser-smoke.json
```

Do not assume a global `bwrk` binary exists. In this repo, use `pnpm bwrk <command>` for source-mode CLI work or `node apps/cli/dist/index.js <command>` after `pnpm build`. A plain `bwrk` command is only expected after `pnpm install:local` has been run for this machine.

## Data Modes

Live mode reads the selected workspace through constrained JSON commands:

- `work list --label <sprint-label> --limit 100 --json`
- `work list --ready --label v1-remainder --limit 20 --json`
- `work list --limit 250 --json`
- `work show <work-id> --json`
- `registry list --json`
- `registry doctor --json`
- `search query <query> --limit 10 --json`
- `operation list --limit 20 --json`
- `sync status --json`
- `doctor --json`
- `reservation list --status active --json`

The CLI also exposes the combined global payload through `dashboard global --json`, with the same registry, queue, search, activity, health, and settings sections used by the console model. The console can keep using narrower live reads when a route only needs part of the payload.

For registered projects beyond the selected workspace, live mode prefixes project-scoped reads with `--workspace <project-root>` instead of changing process context silently. Use live mode when checking real project state, stale generated artifacts, reservations, doctor findings, registry drift, or project setup metadata.

The global route renders project buckets, ready/blocked/needs-verification queues, search results, actor activity, and global health/drift from registry-scoped rows. Queue, search, activity, and health items keep `projectId`, `projectName`, and `projectRoot`, so repeated record IDs in different repositories stay distinct. Search rows expose the CLI source kind, activity rows expose `actorKind` so human, agent, and system operations are visibly separate, and drift rows preserve the original source path from doctor/registry diagnostics when one is available. Ready queue rows show a copyable `bwrk --workspace <project-root> work reserve <work-id> --purpose 'Claim from Boreal Console' --json` command rather than executing a broad claim from the selected workspace.

The settings route renders registry/project setup forms from `GlobalSettingsView`. It exposes project root, memory root, memory layout, memory Git mode, and optional memory remote values, and it shows the exact validation, import, and setup commands for each project. Memory Git modes are explained in the UI: `separate` avoids mixed app/memory history, `submodule` requires remote/submodule metadata, and `shared` is only for intentional mixed history.

The reports route renders stored artifacts from `.boreal/results`, marks artifacts stale when they predate the current console generation time, and exposes read-only reproduction commands for static project, knowledge, and reports dashboard exports. The generated knowledge report is built from the current raw inbox, wiki explorer, claims/decisions, and `vault.health`-backed health findings, and it includes the exact commands needed to regenerate the static HTML and Markdown exports.

The knowledge and reports routes also surface Obsidian compatibility without making Obsidian a runtime requirement. Wiki rows expose local console links first, optional `obsidian://open` URIs when a memory root can be resolved, frontmatter completeness, source/link health, and doctor-visible invalid vault scaffold paths from `vault.structure.details.invalidPaths`. Vault dashboard links point to the canonical index, wiki index, raw index, work queue dashboard, and report artifacts so static exports remain navigable in plain browsers and can optionally deep-link into an Obsidian vault.

Memory workflow actions are intentionally metadata-only. The console lists action kind, installed skill adapter, source workflow path, and `bwrk workflows show <workflow-ref> --json` commands for add, update, retrieve, and reconcile flows. It must not copy workflow steps or safety rules into dashboard actions; agents should open the workflow source and use the thin installed skill adapter such as `$boreal-raw-inbox`, `$boreal-memory-reconcile`, or `$boreal-wiki-claim-decision`.

Fixture mode uses deterministic local data from `apps/console/src/app/fixtures.ts`. Use fixture mode for UI development, browser smoke checks, screenshots, and fast route verification when the live workspace is intentionally dirty or unavailable.

The console carries the current mode in the rendered page and `/api/state` payload. Do not mix fixture screenshots with live state evidence unless the evidence note says which mode produced it.

## CLI Output Modes

Boreal has three related but separate surfaces:

- JSON mode is the canonical contract for agents and the console. Commands with `--json` return schema-backed envelopes; `--view dashboard` must not change those payloads.
- Plain CLI mode is the default terminal format. It uses compact records and tables for repeated command-line use.
- Dashboard human mode is an opt-in terminal view selected with `--view dashboard` on supported commands. It groups diagnostics, queues, locks, agent status, and workflow choices for scanning, but it remains terminal text.

The browser console uses CLI JSON and route view models, not terminal dashboard text. `bwrk dashboard global --json` is the combined global dashboard data endpoint for registry, queues, search, activity, health, and settings. It is different from `--view dashboard`, which only changes human rendering for individual CLI commands.

## Verification

Use focused tests while editing:

```bash
node node_modules/.pnpm/vitest@2.1.9_@types+node@22.20.0/node_modules/vitest/vitest.mjs run \
  tests/runtime/console-app.test.tsx \
  tests/runtime/console-server.test.ts \
  tests/runtime/console-smoke.test.ts \
  tests/runtime/console-cli-contracts.test.ts
```

Use browser smoke before closing UI route work:

```bash
node apps/console/dist/browser-smoke.js --workspace . --mode fixture --out .boreal/results/console-browser-smoke.json
```

The browser smoke command launches local Chrome through the DevTools protocol, visits every console route at desktop `1440x960` and mobile `390x844`, captures screenshots, checks route markers, checks nonblank text, fails on console/runtime errors, and fails on page-level horizontal overflow.

Use a live render before closing data-adapter work:

```bash
node apps/console/dist/render-file.js --workspace . --mode live --route /health --out .boreal/results/console-health-live.html
```

## Command Boundary

The console server only executes command endpoints through `POST /api/commands/<id>`. Read commands can run directly. Mutating commands require explicit confirmation in the request body. Targeted template commands such as claim/release/sprint-start are listed for operator visibility but stay disabled until the UI supplies concrete target inputs.

Global queue claim commands are displayed as concrete operator commands, not server-side command actions. If they later become executable UI actions, the request must carry the queue item's target `projectRoot` and `workId`, and the handler must route through `--workspace <projectRoot>`.

Global drift repair commands are displayed as scoped operator commands, not broad server-side fixes. `bwrk` repair commands include `--workspace <projectRoot>`, Git repairs include `git -C <projectRoot>`, and mutating repairs are labeled as confirmation-required before execution. If these become executable UI actions, the request must carry the target project root and the server must enforce the same confirmation check used by safe command endpoints.

Project settings writes use dedicated POST endpoints:

- `POST /api/settings/projects/add`
- `POST /api/settings/projects/import-setup`
- `POST /api/settings/projects/apply-setup`

Each endpoint requires `confirm=yes`, absolute path inputs, and a successful target `bwrk --workspace <projectRoot> doctor --json` before it writes registry or setup state. `apply-setup` rejects `submodule` memory mode without a memory remote.

Safe command definitions live in `apps/console/src/app/commands.ts`. The live adapter validates command output with `boreal.console-cli-contract.v1` before building UI models. If a CLI schema changes, update `apps/console/src/app/cli-contracts.ts` and `tests/runtime/console-cli-contracts.test.ts` in the same change.

## Closeout Checklist

Before closing console work:

```bash
node node_modules/typescript/bin/tsc -b --pretty false
node node_modules/.pnpm/vitest@2.1.9_@types+node@22.20.0/node_modules/vitest/vitest.mjs run tests/runtime/console-app.test.tsx tests/runtime/console-server.test.ts tests/runtime/console-smoke.test.ts tests/runtime/console-cli-contracts.test.ts
node apps/console/dist/smoke.js --workspace . --mode fixture --out .boreal/results/console-route-smoke.json
node apps/console/dist/browser-smoke.js --workspace . --mode fixture --out .boreal/results/console-browser-smoke.json
node apps/console/dist/render-file.js --workspace . --mode live --route /health --out .boreal/results/console-health-live.html
```

After state-changing tracker closeout, run:

```bash
node apps/cli/dist/index.js sync refresh --json
node apps/cli/dist/index.js doctor --strict --json
```

If strict doctor fails only because expected protected-branch or generated-artifact caveats are present, report the finding category and continue with the next explicit remediation step instead of hiding it.
