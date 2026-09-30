# CLI parity implementation

This implementation ports useful v1 behavior into the Rust v2 application and
store boundaries. The legacy workspace is a reference only; it is not imported
by the runtime. Command spelling compatibility does not imply identical flags
or persistence contracts. Inspect `bwrk help PATH --json` before migrating a
script; `bwrk commands compatibility --json` reports available spellings and
workflow replacements separately.

## Implemented workflows

| Area | Public entry points | Authority and persistence |
| --- | --- | --- |
| Agent briefing | `prime`, `agent guide`, `next`, `directives` | Conditional canonical status, trusted versioned directive IDs, project instruction digests, current action descriptors |
| Discovery | `work list`, `ready`, `parallel`, `next`, `recent-closed`, `review-candidates` | Full revision-consistent discovery, actor-specific permissions, filters before pagination, stable priority order |
| Planning | `cycle` / `sprint`, `work labels set`, work creation acceptance profiles | Active-cycle snapshots, atomic sibling work splits with immutable lineage, application lifecycle policy, explicit revision and role checks |
| Knowledge | `intake promote/disposition`, `decision`, `claim`, `context`, `search` | Append-only knowledge histories, cited immutable sources, atomic intake-to-work creation, project-scoped targets and bounded retrieval |
| Summaries | `summary create/list/show/render/compose/backfill`, `handoff compose/show` | Summary metadata and immutable body in one transaction; historical imports cannot become live proof |
| Templates | `template list/show/validate/run/capture` | Parameters, hierarchy, dependencies, labels and focused/reviewed profiles; atomic application with dry-run default |
| History | `operation list/stats`, `work history`, `export json/markdown` | Project/work filters before pagination, revision drift rejected, confined outputs refuse overwrite |
| Orchestration | `orchestrate start/list/show/tick/progress/events`, run state changes, harness policies and concurrent worker pools | Durable tick identity and claim readback; canonical attempt fencing, separate authenticated sessions, policy revocation and bounded process cleanup; process execution outside transactions |
| Help | `commands`, `help`, `commands compatibility`, `completion` | Executable registry, bounded route pages, input schemas and declared argument contracts |

See [CLI_WORKFLOWS.md](CLI_WORKFLOWS.md) and
[CLI_KNOWLEDGE.md](CLI_KNOWLEDGE.md) and [CLI_ORCHESTRATION.md](CLI_ORCHESTRATION.md) and [CLI_WORK_SPLIT.md](CLI_WORK_SPLIT.md) for the detailed public grammar.

## Isolation and recovery

Project commands resolve the nearest initialized local workspace and reject
mismatched project IDs or databases. Path inputs and generated artifacts stay
inside that workspace; symlink traversal and parent traversal reject. Project
instructions are returned as bounded source data, never executable trusted
directives. Published curated memory remains in `memory/` under Git;
`.boreal/` holds private project metadata, the live store and local assets.

The installation-wide global manager has its own schema and service. Its
workspace associations and derived progress views do not own project work or
attempts. Concurrent global-manager implementation in this checkout is kept
separate from the CLI parity changes.

The embedded workflow package is version 1.2.0. Its command recipes include
current proof inputs and fencing, and its asset digest is regenerated from the
checked-in bytes. Shipped skills declare this same package version.

Feature schemas are additive, named and versioned. Reopening an installed
schema checks its version and SQL identity rather than silently overwriting a
changed definition. Live locks are never force-broken by these workflows.
Failed receipts, old attempts, summaries, acknowledgements and operation
readback remain available.

## Qualification

Compilation and executable command discovery are checked during integration.
No tests, provider executions or mutations of a user project are run as part
of this implementation. These compile checks do not qualify process recovery,
concurrent workers or a release installation end to end.

## Maintenance and diagnostic restoration

The former 26 unmapped v1 spellings now have explicit implementation or
retirement dispositions. Installation status and skill verification operate on
the actual running binary and managed assets; project scope is the default.
Schema and aggregate gate checks are read-only and do not repair or prune.
Registry participation controls retain the independent global-manager boundary.
Reservation/ownership inspection and backup browsing expose durable recovery
state. Reviewed duplicate lineage and versioned summaries preserve originals
and acceptance proof, with retrieval and pagination through maintenance show
routes. Diagnostic-only log rotation retains canonical audit history.

See [CLI_DIAGNOSTICS.md](CLI_DIAGNOSTICS.md),
[CLI_MAINTENANCE.md](CLI_MAINTENANCE.md),
[CLI_OPERATIONS.md](CLI_OPERATIONS.md) and
[CLI_GLOBAL_DISCOVERY.md](CLI_GLOBAL_DISCOVERY.md).

Three old destructive behaviors are intentionally retired: operation pruning,
generic ledger deletion and force-breaking locks. Compatibility discovery
reports those reasons explicitly. Exact spelling does not promise legacy
flags or persistence semantics. Compilation and metadata checks do not
qualify database mutation, recovery, publication or concurrency end to end.
