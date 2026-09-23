# PF-S02-T04 — Attempt 8 start

## Scope

Remove the status snapshot's per-work pinned-requirement lookup. Load current
pinned requirement headers and profile definitions in one relation scan, load
current declaration rows in one relation scan, validate each work's immutable
snapshot in memory, and join observed gate state without weakening the
canonical fail-closed boundary.

Noncanonical schema-v2 fixtures may retain their explicitly documented
observed-gate fallback when no pinned snapshot exists. A canonical production
store, or a noncanonical store with an existing malformed pinned snapshot,
must keep the affected work quarantined with a scoped diagnostic.

## Write boundary

- Production source: `crates/store/src/lib.rs`
- Evidence: this attempt directory only

Do not modify `STATE.json`, the plan graph, acceptance ledger, `memory/`,
commit history, or remote branches.
