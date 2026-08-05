# Boreal Release Readiness

This page summarizes the runtime guarantees, release checks, and known boundaries of the current Boreal release. It is maintained alongside the implementation and is descriptive rather than an authorization or project tracker.

## Verified In Current Repo

- Repository hygiene exists: `.gitignore` excludes `node_modules`, `dist`, build info, runtime locks, caches, DB files, and result spools; `.gitattributes` reserves JSONL merge-driver paths.
- CLI parser flag values come from the command registry, not a separate `VALUE_FLAGS` table.
- `--json`, `--json=true`, and `--json=false` are recognized before command execution, including error paths.
- JSON stdout guard redirects accidental stdout writes during JSON mode so envelopes remain parseable.
- Command registry metadata includes read/write behavior, lock expectations, freshness expectations, result caps, output schema IDs, and examples.
- High-volume CLI result limits are bounded before expensive handoff/search/list flows run.
- Oversized JSON output can spool to `.boreal/results` through a stable compact envelope with a relative result-file path and bounded preview.
- Machine-facing strings are Unicode-normalized and suspicious invisible/bidi/control characters fail closed.
- Direct app/package JSON parsing is centralized through `packages/core/src/json-safe.ts`.
- File-store writes use lock-directory coordination, temp file, fsync, and atomic rename.
- Generated search index writes use lock coordination plus fsync atomic replace.
- State paths and generated workspace paths are realpath-checked against workspace escapes.
- External import reads require `--allow-external-read`.
- Graph edge IDs include the full natural identity: kind, from/to IDs, from/to types, and directed flag.
- Block graph edges are canonical for dependencies; `work.dependencyIds` is a projection/cache.
- `dep add`, `dep remove`, `dep tree`, and `dep cycles` exist as the first-class dependency namespace.
- `dep tree` expands each work item once and marks repeated shared dependency subgraphs as `shared: true` so dense graphs cannot explode output size.
- `agent finish` is a single runtime transaction for reservation ownership, evidence, verification, optional close/release, readiness recompute, and eventing.
- `agent finish` refreshes the finished work context/projection before returning its work view, so `contextSummary` cannot lag behind the returned status/counts.
- Work views separate full `dependencyIds` from `activeBlockerIds`; legacy `blockedBy` now mirrors active blockers rather than all historical dependencies.
- Source-backed wiki pages with valid raw source references are treated as valid vault entry pages instead of orphan warnings.
- `sync refresh` is the single generated-artifact closeout command for context projections, search index, and JSONL ledger export.
- Generated/vault writer commands declare explicit `generated`, `vault`, or `state+generated` lock domains instead of `none`.
- `wiki create` serializes slug existence checks and page writes with a vault wiki lock.
- `agent start` and `work claim` degrade handoff failures instead of hiding a successful reservation.
- Reservations support expiration, renewal, release, stale doctor repair, and `current`/`active` work references.
- Context packs are capped and scoped instead of copying every accepted claim/decision into every pack.
- Search has deterministic hybrid ranking, field weights, vector-lite similarity, and `--explain` field-level output.
- JSONL ledger export/import/delete/status exists as a bridge toward Git-native collaboration.
- The `boreal-jsonl` merge driver is now executable and tested for deterministic non-conflicting appends, with local-only Git config instructions.
- Runtime regression coverage now exercises stale-lock recovery under concurrent writer bursts, concurrent CLI state writes, dependency projection status, generated context/search refresh, and spooled large-result envelopes.
- Shell completion scripts for bash, zsh, and fish are generated from `COMMAND_DEFINITIONS`.
- `apps/mcp` now exposes the first project-scoped stdio MCP server with read-only project tools and confirmed mutating tools routed through exact scoped CLI commands plus operation evidence.
- `apps/daemon` exposes a project-scoped daemon status/watch surface with stale PID detection, lock awareness, bounded watched paths, CLI/global-dashboard visibility, and doctor drift diagnostics.
- Repo-local `memory/` vault scaffolding, raw source index, wiki pages, duplicate scan, merge plans, and compaction plans exist.
- Project setup now separates memory Git history by default with child ignored memory repos, while still supporting sibling memory repos, child submodule metadata, generated `.gitignore` guards, and explicit `shared` opt-in for mixed project history.
- Doctor validates project setup drift, schema shape, IDs, references, dependencies, reservations, context drift, ledger drift, search freshness, operation/event causality, and locks.
- Git health uses the policy in `docs/architecture/GIT_HEALTH_HARDENING.md` to distinguish blocking Git failures from protected-branch, generated-artifact, and memory-index caveats.
- The machine-local project registry contract has a published schema, explicit storage-location helper, display metadata, project/memory/install path bindings, and no implicit directory scanning.
- MCP/daemon resource scoping has shared `@boreal/core` boundary and tool-contract guards that bind each request to one selected project, validate workspace/project/memory roots, reject lexical and realpath traversal under unselected or external projects, keep read tools safe by default, and require command previews plus audit operation IDs for mutating tools.
- The per-record `.boreal/objects/` store is the default durable runtime adapter for new workspaces, with a hash-linked event log and a disposable SQLite read/search index; `FileBorealStore` remains the legacy compatibility and rollback adapter.
- The optional Ink TUI is implemented with project roll-up, sprint board, task detail, global overview, project, and queue routes over the shared engine and UI-model contracts.

## Current Runtime Guarantees

- `dep remove` now removes canonical dependency graph edges transactionally and recomputes readiness/projection.
- CLI docs coverage is derived from `COMMAND_DEFINITIONS` so command additions cannot silently miss documentation headings.
- `work create --priority` registry/docs now match the actual accepted enum values.
- Runtime schema validation now covers all persisted state sections, not just work/evidence/events/operations.
- Runtime schema IDs are backed by published schema files, and tests enforce that every published ID has a matching file.
- Published schema files are bound through `PUBLISHED_SCHEMA_CONTRACTS`, which records schema ID, file path, validator, and runtime section where relevant; tests fail when a schema file lacks a validator, a validator reports the wrong schema ID, or a registry entry points at the wrong `$id`.
- Runtime claims and decisions can now store `wikiPageIds` through repeatable `--wiki` flags, and `doctor` detects dangling wiki references, source-backed records missing wiki coverage, and stale source-backed claims.
- `doctor` now emits workflow-aware stale truth findings for accepted claim contradictions, superseded decisions without accepted replacements, and raw sources waiting for memory reconciliation. Findings separate safe recheck commands from manual review commands.
- `bwrk commands --format markdown` emits a generated command reference from `COMMAND_DEFINITIONS`.
- The CLI UX contract keeps JSON and deterministic plain text canonical, with richer views opt-in behind explicit commands or flags.
- `bwrk doctor` now detects project setup drift for copied configs, missing memory Git repositories, missing ignore guards, child memory tracked by project Git, and stale child submodule metadata; `doctor --fix` repairs the safe/idempotent subset.
- `bwrk sync status`, `sync refresh`, `prime`, and `doctor` now surface categorized Git findings instead of making expected protected-main collaboration caveats look like sync failures.
- The global project registry foundation is now a machine-local `boreal.project-registry.v2` document at the resolved registry root, with validation that rejects cross-project path leakage and records stable project identity plus lifecycle state.
- `bwrk registry list`, `registry add`, `registry remove`, `registry import-setup`, and `registry doctor` now manage explicit project rows, idempotently seed the current workspace from `.boreal/project.json`, archive rows by default, and detect stale roots, moved projects, memory-root drift, and project setup mismatches.
- The console global overview now reads registry entries, renders project buckets with health/open/stale/reservation/memory/sync fields, and uses explicit `--workspace <project-root>` reads for registered projects outside the selected workspace.
- The console global route now renders ready, blocked, and needs-verification queues from project-scoped registry data. Queue rows keep project identity even for repeated work IDs, and ready rows expose `work reserve <work-id>` commands that include the target `--workspace <project-root>`.
- The console global route now renders project-scoped search results and actor activity. Search rows keep project identity plus source kind, `operation list` exposes `actorKind`, and activity rows distinguish human, agent, and system operations without actor-ID heuristics.
- The console global route now renders project-scoped health and drift panels. Doctor, sync, lock, search, ledger, Git, vault, registry, and project setup findings retain original project/workspace paths, and mutating repair commands are displayed with scoped `--workspace` or `git -C` commands plus confirmation-required metadata.
- The console settings route now renders guarded registry/project setup forms with project root, memory root, memory layout, memory Git mode, optional memory remote, and exact validate/import/apply commands. Settings writes require confirmation, absolute paths, and a successful target `doctor --json` before registry or setup state changes; submodule memory mode requires a remote.
- `bwrk dashboard global --json` now exposes the bounded registry, queue, search, activity, health, and settings view-model payload through a first-class CLI command without implicit browser/dashboard rendering.
- `bwrk sprint list`, `sprint show`, `sprint current`, `sprint activate`, and `sprint board` now provide JSON-first workspace-scoped sprint contracts. Activation writes a deterministic `active-sprint` projection plus a `sprint.activated` event linked to the command operation, and sprint scope/board lanes are derived from graph dependencies instead of labels while keeping active blockers separate from historical dependencies.
- The board transition contract now maps lane actions to exact CLI commands and requires confirmation for every mutating action; board UI is explicitly forbidden from writing raw runtime state or bypassing evidence/verification policy.
- `bwrk completion <bash|zsh|fish>` emits registry-backed shell completion scripts with local source and installed-binary setup documented in the CLI guide.
- `bwrk install status --json` now reports the local source runner, local shim path/executability, PATH membership, resolved global `bwrk`, and bounded `--version` probe output; `doctor` surfaces the same install status payload.
- Package smoke coverage now installs a temp `bwrk` shim, runs `init`, `work create`, `sync refresh`, strict `doctor`, skill install/doctor, live console startup, and child/sibling memory Git-contamination checks from clean fixture repositories.
- `bwrk version --json` now exposes `boreal.cli.version.v1` with CLI/runtime/schema versions, published schema IDs, and the v1 migration policy requiring reversible migrations or `boreal.export.v1` snapshot-backed recovery for non-reversible changes.
- Agent E2E fixture coverage now encodes the ordered local-project workflow from `init --setup-memory` through raw-source reconciliation, sprint launch, agent claim/finish, `sync refresh`, strict `doctor`, and JSON/Markdown/ledger exports with JSON-only command outputs and workspace-local paths.
- Skill/workflow/template audits now make `doctor skills` fail when skills duplicate long workflow body sections, while package smoke verifies Codex, Claude, and generic skill-root installs from a clean project.
- Installed Boreal skill adapters now carry canonical workflow IDs in `boreal.yaml` and `SKILL.md` instead of path-shaped workflow refs. `doctor skills` validates installed roots for missing files, stale files, resolver guidance, and unknown or noncanonical workflow refs so agents can use `bwrk workflows show <ref>` without scanning unrelated checkouts for stale `workflows/` copies.
- `docs/architecture/MCP_DAEMON_BOUNDARY.md` now defines the MCP resource/tool boundary, permission tiers, and the per-request root/tool-validation guards adapters must use.
- MCP leakage and path traversal fixtures now cover wrong-repo memory access, external paths, symlink escapes, stale copied memory roots, selected-project mismatch, mutating tool contract failures, real MCP tool calls, and operation evidence returned after confirmed mutations.
- `.boreal/mcp.json` is a local-only project-scoped config marker, and `bwrk doctor` now reports `mcp.config` drift when copied configs point at another project or omit `--workspace`.
- `bwrk daemon status --json`, `dashboard global --json`, and `doctor` now surface daemon state without requiring the daemon to run; stale PID files and boundary drift are warnings.
- Golden-path command aliases, explicit closeout gates, work edit/cancel/reopen/split lifecycle commands, claim review, decision supersession, sprint metrics/close, schema validation, docs checking, and `gate`/`gate closeout` now have CLI contracts, registry metadata, command docs, and runtime tests.
- `docs/architecture/V2_STORAGE_COLLABORATION_PLAN.md` documents the superseded storage alternative and the collaboration invariants around the shipped `objects-v1` boundary. SQLite remains a disposable read/search index rather than the primary writer.
- Agent directive migration docs now define the release boundary between emitted `agentDirectives` transport metadata, durable `directiveAcknowledgements` runtime records, and legacy-compatible closeout summaries. JSON export, JSONL ledgers, Markdown export, import validation, and doctor/report classifications all preserve acknowledgement proof without fabricating it for historical records.

## Known Boundaries

- Multi-clone import, conflict, deletion, and recovery semantics still need end-to-end proof around the object store, event-log generations, JSONL ledgers, and tombstones.
- SQLite is deliberately a disposable read/search index, not the primary runtime writer. Any future writer change requires a new accepted decision instead of treating the superseded V2 plan as authority.
- Schema validation is still hand-written. Schema/validator parity now fails in CI, but schemas are not generated from TypeScript nor are TypeScript validators generated from schema files.
- Runtime claims and decisions can link to vault wiki pages, but runtime JSON remains the primary source of truth; wiki pages are not yet the primary rebuild source for claim/decision records.
- Global project/bucket registry has the schema, storage-location contract, list/add/remove/import/doctor commands, setup import path, overview buckets, scoped global work queues, search results, actor activity, global health/drift panels, guarded settings forms, and the first-class `bwrk dashboard global --json` endpoint. The remaining dashboard command work is to add narrower project, dashboard-sprint, queue, health, and status endpoints over the same model boundary.
- The hand-written CLI guide is now checked against every registry command heading, usage line, and flag by `bwrk docs check`; `bwrk commands --format markdown` remains the fully generated reference surface.
- Work lifecycle semantics still retain legacy `reserved` as an accepted imported state; the live runtime uses reservation leases plus `in_progress`.

## Future Work

1. Prove two-clone object-store collaboration, conflict identity, deletion, offline rejoin, worktree, and recovery behavior with deterministic fixtures.
2. Harden evidence provenance, review/merge, and specification-change business rules behind the engine boundary.
3. Add narrower project, dashboard-sprint, queue, health, and status dashboard JSON endpoints over the existing global dashboard model boundary.
4. Expand the JSONL merge-driver fixture to cover generated ledger directories from real `export ledgers` output.
5. Add larger MCP client fixtures once a real client config is checked against local stdio transport behavior.
6. Decide whether the daemon should gain an opt-in explicit `sync refresh` trigger, still mediated through the CLI command contract.
