# Boreal Hardening Status

Audit basis: `Boreal Current-State Hardening Audit` from June 2026, reconciled against the live repo.

This file is the current checkpoint for the broad hardening goal. It separates archive-specific or already-fixed findings from the remaining architecture work so future slices do not re-litigate stale audit items.

## Verified In Current Repo

- Repository hygiene exists: `.gitignore` excludes `node_modules`, `dist`, build info, runtime locks, caches, DB files, and result spools; `.gitattributes` reserves JSONL merge-driver paths.
- CLI parser flag values come from the command registry, not a separate `VALUE_FLAGS` table.
- `--json`, `--json=true`, and `--json=false` are recognized before command execution, including error paths.
- JSON stdout guard redirects accidental stdout writes during JSON mode so envelopes remain parseable.
- Command registry metadata includes read/write behavior, lock expectations, freshness expectations, result caps, output schema IDs, and examples.
- High-volume CLI result limits are bounded before expensive handoff/search/list flows run.
- Oversized JSON output can spool to `.boreal/results`.
- Machine-facing strings are Unicode-normalized and suspicious invisible/bidi/control characters fail closed.
- Direct app/package JSON parsing is centralized through `packages/core/src/json-safe.ts`.
- File-store writes use lock-directory coordination, temp file, fsync, and atomic rename.
- Generated search index writes use lock coordination plus fsync atomic replace.
- State paths and generated workspace paths are realpath-checked against workspace escapes.
- External import reads require `--allow-external-read`.
- Graph edge IDs include the full natural identity: kind, from/to IDs, from/to types, and directed flag.
- Block graph edges are canonical for dependencies; `work.dependencyIds` is a projection/cache.
- `dep add`, `dep remove`, `dep tree`, and `dep cycles` exist as the first-class dependency namespace.
- `agent finish` is a single runtime transaction for reservation ownership, evidence, verification, optional close/release, readiness recompute, and eventing.
- `agent start` and `work claim` degrade handoff failures instead of hiding a successful reservation.
- Reservations support expiration, renewal, release, stale doctor repair, and `current`/`active` work references.
- Context packs are capped and scoped instead of copying every accepted claim/decision into every pack.
- Search has deterministic hybrid ranking, field weights, vector-lite similarity, and `--explain` field-level output.
- JSONL ledger export/import/delete/status exists as a bridge toward Git-native collaboration.
- Repo-local `memory/` vault scaffolding, raw source index, wiki pages, duplicate scan, merge plans, and compaction plans exist.
- Doctor validates schema shape, IDs, references, dependencies, reservations, context drift, ledger drift, search freshness, operation/event causality, and locks.

## Hardened In This Checkpoint

- `dep remove` now removes canonical dependency graph edges transactionally and recomputes readiness/projection.
- CLI docs coverage is derived from `COMMAND_DEFINITIONS` so command additions cannot silently miss documentation headings.
- `work create --priority` registry/docs now match the actual accepted enum values.
- Runtime schema validation now covers all persisted state sections, not just work/evidence/events/operations.
- Runtime schema IDs are backed by published schema files, and tests enforce that every published ID has a matching file.
- `bwrk commands --format markdown` emits a generated command reference from `COMMAND_DEFINITIONS`.

## Remaining Architecture Work

- Single-file `.boreal/runtime/state.json` is still the durable runtime adapter. JSONL ledgers and Markdown vault files exist, but they are not yet the primary rebuildable source of truth.
- There is no SQLite generated cache adapter yet. The store port can support it, but the cache/rebuild contract is not implemented.
- Schema validation is still hand-written. It is integrated into storage/import/doctor, but schemas are not generated from TypeScript nor are TypeScript validators generated from schema files.
- Vault/wiki knowledge is present as a scaffold and CLI surface, but core domain rules still treat runtime JSON records as primary for claims and decisions.
- Global project/bucket registry is not implemented.
- Shell completion generation is not implemented.
- The hand-written CLI guide is not fully generated yet; `bwrk commands --format markdown` now provides the registry-backed reference surface.
- Work lifecycle semantics still retain legacy `reserved` as an accepted imported state; the live runtime uses reservation leases plus `in_progress`.
- Beads-style JSONL merge driver behavior is reserved in `.gitattributes` but not implemented as an executable merge tool.

## Next Priority Slices

1. Make JSONL ledgers a stronger rebuild source: add a doctor/import check that a ledger export can reconstruct the runtime snapshot and make the repair command explicit.
2. Add a doc-check command that compares `docs/cli/COMMANDS.md` against the generated command reference.
3. Expand vault truth: link runtime claims/decisions to `memory/wiki` pages and add doctor checks for stale source-backed assertions.
4. Add a SQLite cache adapter behind the existing store boundary and prove it is rebuildable from canonical files.
5. Implement the Boreal JSONL merge driver fixture and document local Git config setup.
