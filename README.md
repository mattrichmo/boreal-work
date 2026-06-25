# Boreal Work

Git-native project memory and workflow control for humans and agents.

This repository currently contains the TypeScript runtime and the first command surface under `apps/cli`.

## Runtime Packages

- `packages/core`: durable record types, deterministic IDs, canonical hashing, timestamps, errors, policies.
- `packages/storage`: storage ports, an in-memory transactional store, and a file-backed store at `.boreal/runtime/state.json` with cross-process write locking.
- `packages/work-engine`: work lifecycle, dependency readiness, evidence-gated closure.
- `packages/evidence-engine`: evidence records and verification records.
- `packages/knowledge-engine`: sources, claims, and decisions.
- `packages/graph-engine`: deterministic relationship edges and cycle checks.
- `packages/agent-runtime`: reservations and collision policy.
- `packages/search`: context-pack projection helpers.
- `packages/ui-model`: shared view models for future CLI/TUI/console surfaces.
- `packages/engine`: outer runtime composition used by every future surface.

## CLI Surface

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
pnpm bwrk evidence add <work-id> --summary "pnpm test passed" --kind test --outcome passed --command "pnpm test"
pnpm bwrk work verify <work-id> --evidence <evidence-id>
pnpm bwrk work close <work-id> --reason "verified by tests"
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

The CLI integration test covers init fail-closed behavior, exact versus discovered workspace resolution, idempotent concurrent init, bounded/filtered listing, create/ready/list/evidence/verify/close, projection repair through `doctor --fix`, and explicit stale lock repair through `lock break --stale-only`.

Several runtime invariants intentionally follow the Beads methodology while staying TypeScript-native:

- Work IDs include actor, timestamp, and nonce inputs so same-title imports do not collide.
- Event IDs use random entropy instead of per-process sequence counters.
- Dependency edges keep deterministic natural-key IDs.
- Derived readiness has an explicit recompute/repair operation.

Run the checks:

```bash
pnpm check
pnpm test
pnpm build
```
