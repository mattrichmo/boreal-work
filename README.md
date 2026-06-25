# Boreal Work

Git-native project memory and workflow control for humans and agents.

This repository currently contains the backend/runtime scaffold only. Runnable app surfaces under `apps/*` are intentionally left empty until the engine contracts prove stable.

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

## Verified Proof Slice

The current runtime test covers:

```text
init -> create work -> add dependency -> derive readiness -> reserve
-> record evidence -> verify -> close -> rebuild projections -> event trail
```

The file-backed store is also tested for persistence across runtime instances, rollback on failed transactions, concurrent writer serialization, stale-lock recovery, and path escape rejection.

Run the checks:

```bash
pnpm check
pnpm test
pnpm build
```
