# Boreal Work

Git-native project memory and workflow control for humans and agents.

This repository currently contains the TypeScript runtime and the first command surface under `apps/cli`.

## Artifact Policy

This repo is a source workspace, not a checked-in runnable bundle. Do not commit `node_modules/`, `dist/`, `*.tsbuildinfo`, or `.boreal/runtime` cache artifacts. Rebuild local artifacts with:

```bash
pnpm install
pnpm build
```

## Runtime Packages

- `packages/core`: durable record types, deterministic IDs, canonical hashing, timestamps, errors, policies.
- `packages/storage`: storage ports, an in-memory transactional store, and a file-backed store at `.boreal/runtime/state.json` with cross-process write locking.
- `packages/work-engine`: work lifecycle, dependency readiness, evidence-gated closure.
- `packages/evidence-engine`: evidence records and verification records.
- `packages/knowledge-engine`: sources, claims, and decisions.
- `packages/graph-engine`: deterministic relationship edges and cycle checks.
- `packages/agent-runtime`: reservations and collision policy.
- `packages/search`: context-pack projection helpers and deterministic hybrid local search-index ranking.
- `packages/ui-model`: shared view models for future CLI/TUI/console surfaces.
- `packages/engine`: outer runtime composition used by every future surface.

## CLI Surface

Full command contract: [docs/cli/COMMANDS.md](docs/cli/COMMANDS.md).

Run the CLI from source:

```bash
pnpm bwrk --help
```

The packaged binary is `bwrk` from `@boreal/cli`.

Core commands:

```bash
pnpm bwrk init
pnpm bwrk work create "Build CLI surface" --ready
pnpm bwrk work list --status ready --label cli --limit 20
pnpm bwrk work next --label cli
pnpm bwrk agent guide --label cli --agent agent-a
pnpm bwrk agent start --label cli --agent agent-a --purpose "start implementation"
pnpm bwrk agent finish <work-id> --agent agent-a --summary "implemented and tested" --command "pnpm test" --close --reason "verified by evidence"
pnpm bwrk work claim --label cli --agent agent-a --purpose "start implementation"
pnpm bwrk reservation list --agent agent-a --status active
pnpm bwrk agent status --agent agent-a
pnpm bwrk work renew <work-id> --ttl 2h
pnpm bwrk work release <work-id>
pnpm bwrk evidence add <work-id> --summary "pnpm test passed" --kind test --outcome passed --command "pnpm test"
pnpm bwrk work verify <work-id> --evidence <evidence-id>
pnpm bwrk work close <work-id> --reason "verified by tests"
pnpm bwrk source add --title "Design note" --uri "file://design.md" --kind document
pnpm bwrk claim create --statement "Context packs include accepted claims" --status accepted --source <source-id>
pnpm bwrk decision create --title "Expose context" --decision "Expose context packs through the CLI" --source <source-id>
pnpm bwrk context rebuild
pnpm bwrk context show <work-id>
pnpm bwrk search index
pnpm bwrk search query "context packs"
pnpm bwrk context search "accepted claims"
pnpm bwrk export json --out boreal-export.json
pnpm bwrk export markdown --out .boreal/exports/markdown
pnpm bwrk snapshot create --name baseline
pnpm bwrk import json --from boreal-export.json
pnpm bwrk doctor --fix
```

Every command accepts `--workspace <path>` and most commands accept `--json` for automation. Without `--workspace`, commands discover the nearest parent `.boreal`; with `--workspace`, the path is treated as the exact workspace root.

## Verified Proof Slice

The current runtime test covers:

```text
init -> create work -> add dependency -> derive readiness -> reserve
-> record evidence -> verify -> close -> rebuild projections -> event trail
```

The file-backed store is also tested for persistence across runtime instances, rollback on failed transactions, concurrent writer serialization, stale-lock recovery, schema drift rejection, invalid JSON rejection, and path escape rejection.

The CLI integration test covers init fail-closed behavior, exact versus discovered workspace resolution, idempotent concurrent init, bounded/filtered listing, next-ready work, atomic claim handoffs, safe agent guide/start/finish handoffs, reservation visibility/renewal/release/expiration repair, agent coordination status, create/ready/list/evidence/verify/close, source/claim/decision/context commands, fresh-index search, JSON and Markdown export, JSON import, recovery snapshots, projection and search-index repair through `doctor --fix`, and explicit stale lock repair through `lock break --stale-only`.

Several runtime invariants intentionally follow the Beads methodology while staying TypeScript-native:

- Work IDs include actor, timestamp, and nonce inputs so same-title imports do not collide.
- Event IDs use random entropy instead of per-process sequence counters.
- Dependency edges keep deterministic natural-key IDs.
- Derived readiness has an explicit recompute/repair operation.

Run the checks:

```bash
pnpm check
pnpm test
pnpm doctor:strict
pnpm build
```

`pnpm doctor:strict` runs `bwrk doctor --workspace . --strict --json` as a CI-style hardening gate. It fails on warnings as well as errors, so run `pnpm bwrk init` first when a fresh workspace has not been initialized.
