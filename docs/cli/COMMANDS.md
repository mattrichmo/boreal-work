# Boreal CLI Commands

`bwrk` is the Boreal Work command surface for local work tracking, evidence capture, verification, lock inspection, and runtime repair.

## Global Rules

Run from source in this repository:

```bash
pnpm bwrk --help
```

Use the packaged binary as:

```bash
bwrk --help
```

Global flags:

- `--workspace <path>`: use this exact path as the Boreal workspace root.
- `--json`: emit a stable JSON envelope for automation.
- `--actor <id>`: override the actor ID stored on new records.
- `--actor-kind human|agent|system`: override the actor kind. Defaults to `human`.
- `--session <id>`: group local command operation records under a session ID. Defaults to `BOREAL_SESSION_ID` or `local`.
- `--help`: show root or group help.

In JSON mode, successful commands write one JSON envelope to stdout, errors write one JSON envelope to stderr, and unexpected raw stdout writes are redirected to stderr so stdout stays parseable. If a JSON result exceeds the command's `behavior.maxResultSizeChars`, Boreal writes the full envelope under `.boreal/results/` and returns compact data with `truncated`, `preview`, `fullResultPath`, and `fullResultBytes`.

Initialized workspace commands append local runtime operation records to `.boreal/runtime/state.json`. Operation records include the command path, session ID, actor, timing, exit status, declared state/artifact effects, redacted argv, and event IDs created by the command. Runtime events created during the same command store that local operation ID so local event history can point back to the exact CLI invocation. Operation records and event operation IDs are local audit data and are excluded from portable exports and snapshot content hashes.

Flag parsing:

- Unknown flags are rejected before any command executes.
- Boolean flags accept explicit false values, for example `--json=false` or `--ready=false`.
- Non-repeatable flags are rejected when supplied more than once.

Machine-facing strings:

- Work/source/decision titles, labels/tags, actor and agent IDs, source/evidence URIs, and search queries are Unicode-normalized before storage or matching.
- Labels and actor/agent IDs are lowercased after normalization; repeated normalized labels collapse to one value.
- Invisible format characters, bidi controls, variation selectors, and unsafe control characters are rejected with `BOREAL_UNSAFE_UNICODE`.
- Free-form summaries, evidence text, claim statements, and decision bodies are preserved as authored.

Work references:

- Commands that target a work item accept an exact work ID, an unambiguous work ID prefix of at least 12 characters, or an exact normalized title.
- Ambiguous references fail closed with `BOREAL_CONFLICT` and include candidate work IDs in JSON error details.
- Missing references fail with `BOREAL_NOT_FOUND`.

Workspace resolution:

- Without `--workspace`, `bwrk` walks upward from the current directory until it finds `.boreal`.
- With `--workspace`, no upward discovery is performed; the provided path is the workspace root.
- Commands that mutate or read work state fail closed until `bwrk init` has created `.boreal/runtime/state.json`.

JSON success envelope:

```json
{
  "ok": true,
  "data": {}
}
```

JSON error envelope:

```json
{
  "ok": false,
  "code": "BOREAL_INVALID_INPUT",
  "message": "Boreal workspace is not initialized; run `bwrk init`",
  "details": {}
}
```

Exit codes:

- `0`: command completed successfully.
- `1`: runtime, storage, policy, doctor, lock, or unexpected failure.
- `2`: invalid command input.

## Help

```bash
bwrk help
bwrk help init
bwrk help work
bwrk help evidence
bwrk help source
bwrk help claim
bwrk help decision
bwrk help context
bwrk help search
bwrk help reservation
bwrk help agent
bwrk help operation
bwrk help export
bwrk help import
bwrk help snapshot
bwrk help doctor
bwrk help lock
bwrk help commands
bwrk work --help
```

Help commands do not require an initialized workspace.

## `commands`

```bash
bwrk commands [--json]
```

Prints the registered command surface used by dispatch, help, and strict flag validation.

JSON `data` shape:

```json
{
  "commands": [
    {
      "path": ["work", "reserve"],
      "category": "work",
      "summary": "Reserve ready work for an agent.",
      "usage": "bwrk work reserve <work-id> --agent <agent-id> [--purpose <text>] [--force --reason <text>] [--json]",
      "requiresWorkspace": true,
      "supportsJson": true,
      "behavior": {
        "readOnly": false,
        "destructive": false,
        "writesState": true,
        "writesGeneratedArtifacts": false,
        "requiresFreshIndex": false,
        "concurrencySafe": true,
        "requiresLock": "state",
        "supportsExplain": false,
        "maxResultSizeChars": 50000,
        "jsonOutputSchema": "boreal.cli.work.reserve.v1",
        "humanOutputKind": "record",
        "examples": ["bwrk work reserve bw_work_example --agent agent-a --ttl 2h --json"]
      },
      "flags": [
        {
          "name": "force",
          "type": "boolean",
          "repeatable": false,
          "summary": "Allow a documented reservation of non-ready work."
        }
      ]
    }
  ]
}
```

## `init`

```bash
bwrk init [--workspace <path>] [--json]
```

Initializes a Boreal workspace by creating durable runtime state under `.boreal/runtime/state.json`.

Behavior:

- Idempotent.
- Safe under concurrent init attempts.
- Returns the existing initialization event when the workspace is already initialized.

JSON `data` shape:

```json
{
  "initialized": true,
  "workspaceRoot": "/absolute/path",
  "eventId": "bw_event_..."
}
```

## `work create`

```bash
bwrk work create <title> \
  [--description <text>] \
  [--kind issue|task|sprint|milestone] \
  [--priority low|normal|high|critical] \
  [--label <label>] \
  [--acceptance <text>] \
  [--ready] \
  [--json]
```

Creates a work item. `--label` and `--acceptance` may be repeated.

Behavior:

- Default `kind` is `task`.
- Default `priority` is `normal`.
- `--ready` marks the new item ready in the same runtime write transaction.

Example:

```bash
bwrk work create "Harden CLI output" --label cli --acceptance "JSON shape is documented" --ready
```

## `work ready`

```bash
bwrk work ready <work-id> [--json]
```

Recomputes readiness for one work item and marks it `ready` if its dependencies allow it.

## `work list`

```bash
bwrk work list [--ready] [--status <status>] [--label <label>] [--limit <count>] [--json]
```

Lists work items. `--label` may be repeated and all labels must match.

Statuses:

```text
draft
ready
in_progress
reserved
blocked
needs_verification
verified
closed
cancelled
```

`in_progress` is the normal status for actively reserved work. `reserved` is still accepted for legacy/imported state, but new reservations use `reservationId` plus `in_progress` instead of overloading status as ownership.

Examples:

```bash
bwrk work list --ready
bwrk work list --status ready --label cli --limit 20 --json
```

JSON `data` shape:

```json
[
  {
    "id": "bw_work_...",
    "status": "ready",
    "priority": "normal",
    "title": "Harden CLI output",
    "labels": ["cli"]
  }
]
```

## `work next`

```bash
bwrk work next [--label <label>] [--limit <count>] [--json]
```

Lists claimable ready work from the live runtime view, ordered by priority and title. `--label` may be repeated and all labels must match. Default `--limit` is `10`.

This command does not use the search index; readiness and reservation-sensitive workflow state are read from current runtime state.

## `work show`

```bash
bwrk work show <work-id> [--json]
```

Shows the work view for one item, including evidence, verification, and context-pack summary fields when present.

## `work block`

```bash
bwrk work block <blocked-work-id> <blocking-work-id> [--json]
```

Adds a blocking dependency. Dependency cycles are rejected by runtime policy.

## `dep add`

```bash
bwrk dep add <work-id> <depends-on-work-id> [--type blocks] [--json]
```

Adds a canonical `blocks` dependency edge between work items. This is the dependency-focused alias for `work block`; readiness still derives from the block graph.

## `dep tree`

```bash
bwrk dep tree <work-id> [--json]
```

Shows the recursive blocker tree for one work item from canonical `blocks` graph edges. JSON output is a nested tree with `id`, optional `title`/`status`, and `dependencies`.

## `dep cycles`

```bash
bwrk dep cycles [--json]
```

Lists dependency cycles in canonical `blocks` graph edges.

## `work reserve`

```bash
bwrk work reserve <work-id> [--agent <id>] [--purpose <text>] [--expires-at <iso>|--ttl <duration>] [--force --reason <text>] [--json]
```

Reserves a ready work item for an agent. If `--agent` is omitted, the CLI actor ID is used.

Normal reservation requires `ready` work. A successful reservation writes an active reservation record, stores its ID on the work item, and moves the work to `in_progress`. `--force` allows a documented reservation of non-ready work only when `--reason` is also supplied. Closed and cancelled work still cannot be reserved.

Reservations can expire:

```bash
bwrk work reserve <work-id> --ttl 2h
bwrk work reserve <work-id> --expires-at 2026-06-25T22:00:00.000Z
```

`--ttl` accepts positive durations with `s`, `m`, `h`, or `d` units.

## `work claim`

```bash
bwrk work claim [--label <label>] [--agent <id>] [--purpose <text>] [--expires-at <iso>|--ttl <duration>] [--query <text>] [--limit <count>] [--json]
```

Atomically finds the next live ready work item, reserves it for the agent, rebuilds context-pack projections, rebuilds the local search index, and returns a handoff bundle.

Selection behavior:

- `--label` may be repeated and all labels must match.
- Claimed work is ordered by priority, title, then ID.
- The runtime rechecks blocker-derived readiness inside the same write transaction before reserving.
- If no work matches, the command exits `0` with `claimed: false`.

Handoff output includes:

- The claimed work view.
- The reservation record.
- The refreshed context pack for the claimed work.
- Focused search results using `--query` or a default query built from the work title, labels, context facts, and evidence.

If context/search handoff generation fails after the reservation is created, the command still exits `0` with `claimed: true`, `handoffComplete: false`, the reservation/work view, a warning, and `repairCommand: "bwrk doctor --fix --json"`.

`--limit` controls the number of returned search results and defaults to `8`.

## `work release`

```bash
bwrk work release <work-id> [--json]
```

Marks the active reservation released and restores the work item to derived readiness. If the item is still blocked by open dependencies, it returns to `blocked`; otherwise it becomes `ready`.

## `work renew`

```bash
bwrk work renew <work-id> (--expires-at <iso>|--ttl <duration>) [--json]
```

Extends the active reservation for a work item. The new expiration must be in the future.

## `reservation list`

```bash
bwrk reservation list [--agent <agent-id>] [--work <work-id>] [--status active|released|expired|all] [--expired] [--limit <count>] [--json]
```

Shows reservation ownership and expiration state for multi-agent coordination. By default, only active reservations are shown.

Filters:

- `--agent`: only reservations for one agent.
- `--work`: only reservations for one work item.
- `--status`: lifecycle status; use `all` to include active, released, and expired records.
- `--expired`: only rows whose `expiresAt` timestamp is in the past.
- `--limit`: maximum number of rows.

Rows include reservation ID, status, computed `expired`, agent ID, work ID, work status, work title, `reservedAt`, optional `expiresAt`, and optional purpose.

## `agent guide`

```bash
bwrk agent guide [--agent <agent-id>] [--label <label>] [--json]
```

Prints the compact agent loop without requiring an initialized workspace. The guide includes exact command templates for:

- Checking coordination state with `agent status`.
- Starting or resuming work with `agent start`.
- Finishing work with `agent finish`.
- Renewing active reservations.
- Releasing work when stopping early.
- Running `doctor` and `doctor --fix` for stale reservation recovery.

## `agent finish`

```bash
bwrk agent finish <work-id> \
  --summary <text> \
  (--close --reason <text>|--release) \
  [--agent <agent-id>] \
  [--kind command|test|diff|review|artifact|note] \
  [--outcome passed|failed|observed|unknown] \
  [--command <cmd>] \
  [--uri <uri>] \
  [--verdict passed|failed] \
  [--notes <text>] \
  [--json]
```

Guarded exit workflow for work with an active agent reservation. The command requires the selected agent to own the active, non-expired reservation before it records evidence, verifies the work, and closes or releases anything. Evidence, verification, optional close, reservation release, readiness repair, and the final `agent.finished` event run as one engine transaction. One of `--close` or `--release` is required so finish cannot leave active ownership behind.

Behavior:

- Records one evidence item against the work. If `--outcome` is omitted, it defaults to `passed` for a passed verdict and `failed` for a failed verdict.
- Verifies the work using the new evidence ID.
- With `--close`, requires a passed verdict and `--reason`, closes the work, then releases the active reservation so closed work does not keep stale ownership.
- With `--release`, releases the reservation after verification without closing.
- Rejects `--close --release` together.

## `agent start`

```bash
bwrk agent start [--agent <agent-id>] [--label <label>] [--purpose <text>] [--expires-at <iso>|--ttl <duration>] [--query <text>] [--limit <count>] [--json]
```

Safe entrypoint for an agent before it starts work:

- Blocks with exit code `1` when the agent has expired active reservations; the response points at `bwrk doctor --fix`.
- Resumes the agent's existing active reservation before claiming more work.
- Atomically claims the next ready matching work only when the agent has no active work and has reservation capacity.
- Returns the selected work view, reservation, context pack, and handoff search results.
- If context/search handoff generation fails after a reservation is claimed or resumed, returns the reservation with `handoffComplete: false`, a warning, and `repairCommand: "bwrk doctor --fix --json"` instead of losing the successful claim behind an error.
- Returns `started: false` with `reason: "no_ready_work"` when no matching ready work exists.

## `agent status`

```bash
bwrk agent status [--agent <agent-id>] [--label <label>] [--json]
```

Summarizes an agent's coordination state. If `--agent` is omitted, the CLI actor ID is used.

JSON `data` includes:

- `policy.maxActiveReservations`.
- Active and expired-active reservation counts.
- Remaining claim capacity under the reservation policy.
- Active and expired-active reservation rows.
- Claimable ready-work count for the optional label filter.
- The next claimable work row when one exists.
- `recommendedAction` with a `kind`, optional command, and reason.

## `operation list`

```bash
bwrk operation list [--session-id <id>] [--command <path>] [--status succeeded|failed|all] [--limit <count>] [--json]
```

Lists local command operation records newest first. Default `--limit` is `50`. Filters are exact after normalization:

- `--session-id`: only operations from one session.
- `--command`: only one command path, for example `work create`.
- `--status`: `succeeded`, `failed`, or `all`.

JSON rows include operation ID, session ID, command path, status, exit code, state/artifact effect flags, actor ID, timestamps, and event count.

## `operation show`

```bash
bwrk operation show <operation-id-or-prefix> [--json]
```

Shows one full local operation record, including redacted argv and generated event IDs. Prefixes must include at least 12 hex characters and be unambiguous.

## `operation prune`

```bash
bwrk operation prune (--keep <count>|--before <iso>) [--json]
```

Prunes local operation history without changing exported project records. `--keep` keeps the newest N operations including the prune command's own operation record, so `bwrk operation prune --keep 500` leaves at most 500 operation records after the command finishes. `--before` deletes operations finished before the given ISO timestamp. When both flags are provided, the age filter is applied first and the remaining newest records are capped by `--keep`.

JSON `data` includes `deleted`, `keptBeforeOperationLog`, `remainingAfterOperationLog`, optional `keep`/`before`, and `deletedIds`.

## `operation repair`

```bash
bwrk operation repair [--dry-run] [--json]
```

Repairs local operation/event causality after upgrading older workspaces. The command backfills event `operationId` when exactly one retained operation references the event, repairs operation records that are missing a retained event reference, removes operation references to missing events, and marks events with no unambiguous retained operation as `operationLink: "legacy"`.

Use `--dry-run` to inspect the planned changes without applying repair writes. The command itself is still recorded in the local operation log.

JSON `data` includes inspected counts, linked event IDs, legacy-marked event IDs, repaired operation IDs, removed dangling/conflicting references, and ambiguous events.

## `evidence add`

```bash
bwrk evidence add <work-id> \
  --summary <text> \
  [--kind command|test|diff|review|artifact|note] \
  [--outcome passed|failed|observed|unknown] \
  [--command <cmd>] \
  [--uri <uri>] \
  [--json]
```

Records evidence against a work item and moves the work item to `needs_verification` unless it is already closed.

Example:

```bash
bwrk evidence add bw_work_... --summary "pnpm test passed" --kind test --outcome passed --command "pnpm test"
```

## `work verify`

```bash
bwrk work verify <work-id> --evidence <evidence-id> [--verdict passed|failed] [--notes <text>] [--json]
```

Creates a verification record. `--evidence` may be repeated. Verification fails if referenced evidence is not attached to the work item. A `passed` verdict requires at least one referenced evidence record with outcome `passed`.

## `work close`

```bash
bwrk work close <work-id> --reason <text> [--json]
```

Closes a work item. Runtime policy requires a passing verification before close.

## `source add`

```bash
bwrk source add \
  --title <text> \
  --uri <uri> \
  [--kind raw|document|chat|code|artifact] \
  [--summary <text>] \
  [--json]
```

Creates a knowledge source. Default `kind` is `document`.

JSON `data` is the full source record, including `meta.id`, `kind`, `title`, `uri`, and `summary`.

## `source list`

```bash
bwrk source list [--kind raw|document|chat|code|artifact] [--limit <count>] [--json]
```

Lists knowledge sources. JSON output is an array of rows with `id`, `kind`, `title`, and `uri`.

## `source show`

```bash
bwrk source show <source-id> [--json]
```

Shows one knowledge source record.

JSON `data` is the full source record.

## `claim create`

```bash
bwrk claim create \
  --statement <text> \
  [--status proposed|accepted|rejected|stale] \
  [--source <source-id>] \
  [--evidence <evidence-id>] \
  [--json]
```

Creates a claim. `--source` and `--evidence` may be repeated. Referenced sources and evidence must already exist.

JSON `data` is the full claim record, including `meta.id`, `statement`, `status`, `sourceIds`, and `evidenceIds`.

## `claim list`

```bash
bwrk claim list [--status proposed|accepted|rejected|stale] [--source <source-id>] [--limit <count>] [--json]
```

Lists claims, optionally filtered by status and source.

JSON `data` is an array of rows with `id`, `status`, `statement`, `sources`, and `evidence`.

## `claim show`

```bash
bwrk claim show <claim-id> [--json]
```

Shows one claim record.

JSON `data` is the full claim record.

## `decision create`

```bash
bwrk decision create \
  --title <text> \
  --decision <text> \
  [--context <text>] \
  [--status proposed|accepted|superseded|rejected] \
  [--consequence <text>] \
  [--source <source-id>] \
  [--json]
```

Creates a decision record. `--consequence` and `--source` may be repeated. Referenced sources must already exist.

JSON `data` is the full decision record, including `meta.id`, `title`, `status`, `context`, `decision`, `consequences`, and `sourceIds`.

## `decision list`

```bash
bwrk decision list [--status proposed|accepted|superseded|rejected] [--source <source-id>] [--limit <count>] [--json]
```

Lists decisions, optionally filtered by status and source.

JSON `data` is an array of rows with `id`, `status`, `title`, `decision`, and `sources`.

## `decision show`

```bash
bwrk decision show <decision-id> [--json]
```

Shows one decision record.

JSON `data` is the full decision record.

## `context rebuild`

```bash
bwrk context rebuild [--json]
```

Rebuilds context-pack projections for all work items. JSON `data` contains `rebuilt` and `views`.

## `context show`

```bash
bwrk context show <work-id> [--json]
```

Shows the stored context pack for a work item. Run `bwrk context rebuild` first when the context pack is missing or stale.

JSON `data` is the context pack record with `id`, `subjectId`, `generatedAt`, `title`, `summary`, `facts`, and `evidence`.
Context facts always include work status and priority, plus capped accepted claims and decisions selected by direct evidence/source references first, then overlap with the work title, description, labels, acceptance criteria, and evidence. Unrelated accepted knowledge is not copied into every work pack by default.

## `context search`

```bash
bwrk context search <query> [--limit <count>] [--explain] [--json]
```

Searches context-pack summary documents and bounded context-chunk documents only. The search index must be fresh; run `bwrk search index` or `bwrk doctor --fix` after imports, writes, or context rebuilds that change searchable content.

JSON `data` is an array of search results with `id`, `type`, `recordId`, `subjectId`, `title`, `summary`, `score`, and `matches`. With `--explain`, each result also includes `explain.algorithm`, `queryTokens`, `scoreBreakdown`, and `fieldMatches`.

## `search index`

```bash
bwrk search index [--json]
```

Builds a deterministic local search index at `.boreal/runtime/search-index.json`. Rebuilds are serialized with `.boreal/runtime/search-index.lock` and use atomic fsync writes. The index stores compact weighted aggregate tokens, per-field tokens, document-frequency statistics, compact vector-lite weights, and result summaries for work, evidence, sources, claims, decisions, context packs, and bounded context chunks; it does not store full record bodies.

JSON `data` contains `path`, `schemaVersion`, `builtAt`, `contentHash`, `documentCount`, and `tokenCount`.

## `search query`

```bash
bwrk search query <query> [--limit <count>] [--explain] [--json]
```

Searches work, evidence, sources, claims, decisions, context packs, and bounded context chunks. Results are ranked by ID prefix matches, field-weighted token matches adjusted by document frequency, deterministic vector-lite similarity, and stable type/title ordering. Tokenization preserves compact tokens while adding camelCase, path/URI, underscore, and alpha-numeric split variants.

Use `--explain` to include the normalized query tokens, score contributions, document frequencies, IDF factors, vector similarity, and field-level matches that caused each result to rank.

The command fails closed when the index is missing, malformed, or stale. Rebuild with `bwrk search index` or `bwrk doctor --fix`.

## `export json`

```bash
bwrk export json [--out <path>] [--json]
```

Builds a `boreal.export.v1` document containing a full runtime state snapshot, record counts, and a deterministic content hash. Without `--out`, the export document is printed. With `--out`, the file is written inside the workspace and JSON `data` contains `path`, `contentHash`, and `recordCounts`.

## `export markdown`

```bash
bwrk export markdown [--out <dir>] [--json]
```

Writes Git-friendly Markdown files for work, evidence, sources, claims, decisions, and context packs. Each file includes flat frontmatter with stable IDs, status/kind fields, references, tags, and timestamps where available. Default output directory is `.boreal/exports/markdown`.

JSON `data` contains `outDir`, `files`, and `recordCounts`.

## `export ledgers`

```bash
bwrk export ledgers [--out <dir>] [--json]
```

Writes a `boreal.ledgers.v1` JSONL bridge: one `.jsonl` file per runtime section, a `deletions.jsonl` tombstone ledger, and `manifest.json` with per-file counts, per-file content hashes, deleted-record counts, and the whole-ledger content hash. Default output directory is `.boreal/ledgers`.

JSON `data` contains `outDir`, `manifestPath`, `contentHash`, `recordCounts`, `deletedRecordCounts`, `files`, and `deletions`.

## `import json`

```bash
bwrk import json --from <path> [--allow-external-read] [--json]
```

Imports a `boreal.export.v1` document or raw `boreal.file-store.v1` state document. Import validates required sections and references before writing. Existing records with identical IDs and identical content are skipped. Existing records with identical IDs and different content are rejected as conflicts.

By default, `--from` must resolve inside the workspace, including after symlink resolution. Use `--allow-external-read` for an intentional external file import.

JSON `data` contains per-section `imported` and `skipped` counts.

## `import ledgers`

```bash
bwrk import ledgers --from <dir> [--allow-external-read] [--json]
```

Imports a `boreal.ledgers.v1` directory. The importer reads `manifest.json`, verifies every JSONL file and `deletions.jsonl` count/content hash, reconstructs the snapshot, rejects tombstones that conflict with live records, validates record schemas and references, then merges records with the same conflict rules as `import json`.

By default, `--from` must resolve inside the workspace, including after symlink resolution. Use `--allow-external-read` for an intentional external ledger import.

JSON `data` contains per-section `imported` and `skipped` counts.

## `ledger status`

```bash
bwrk ledger status [--dir <dir>] [--json]
```

Compares an exported JSONL ledger directory with the current runtime state. Missing ledgers, stale content hashes, parse errors, count mismatches, file hash mismatches, and invalid tombstones return a non-zero exit code. Default directory is `.boreal/ledgers`.

JSON `data` contains `ok`, `path`, `exists`, `stale`, `expectedContentHash`, `reconstructable`, and, when present, `contentHash`, `recordCounts`, `deletedRecordCounts`, `files`, `deletions`, or `error`.

## `ledger delete`

```bash
bwrk ledger delete <source|claim|decision> <id> [--reason <text>] [--json]
```

Deletes a supported unreferenced record from runtime state, writes a `boreal.ledger-deletion.v1` tombstone to `deletions.jsonl`, and refreshes the JSONL ledger export. Supported record kinds are `source`, `claim`, and `decision`. Source deletion fails with `BOREAL_CONFLICT` when any claim, decision, or graph edge still references the source. Claim and decision deletion fail when graph edges reference the record.

JSON `data` contains `deleted`, `section`, `id`, `tombstone`, and the refreshed `ledger` export result.

## `snapshot create`

```bash
bwrk snapshot create [--name <slug>] [--json]
```

Creates a recovery snapshot under `.boreal/snapshots`. Snapshot files are `boreal.export.v1` documents with content hashes.

JSON `data` contains `id`, `path`, `contentHash`, and `recordCounts`.

## `snapshot list`

```bash
bwrk snapshot list [--json]
```

Lists recovery snapshots. JSON `data` is an array with `id`, `path`, `createdAt`, `contentHash`, and `sizeBytes` when the snapshot parses cleanly.

## `snapshot show`

```bash
bwrk snapshot show <snapshot-id> [--json]
```

Shows one recovery snapshot by ID. JSON `data` is the full `boreal.export.v1` document.

## `doctor`

```bash
bwrk doctor [--fix] [--strict] [--json]
```

Validates workspace health.

Checks:

- `.boreal` and runtime state presence.
- Runtime state JSON parse and schema version.
- Integrated schema validation for work, evidence, runtime events, and runtime policy payloads.
- Required state sections.
- Missing IDs and duplicate IDs within each state section.
- Malformed work, evidence, verification, source, claim, decision, context-pack, graph, and reservation records.
- Dangling work dependencies, evidence references, and verification references.
- Dangling knowledge source and claim evidence references.
- Duplicate graph edges, dangling work graph edges, graph/dependency disagreement, and dependency cycles.
- Reservation consistency, including active reservations for terminal work, work ownership pointers, and legacy `reserved` work without active reservations.
- Expired active reservations.
- Verification policy drift, including passed verifications without passed evidence.
- Closed work items without close reasons.
- Unsafe Unicode in machine-facing strings.
- Label and actor normalization collisions in imported or hand-edited state.
- Local operation log shape, volume, legacy operation-event links, dangling event references, and retained operation/event causality.
- Derived readiness consistency.
- Missing or stale context-pack projections.
- Snapshot/export drift between the current export hash and the latest recovery snapshot.
- Missing, malformed, or stale local search index.
- Runtime state and search-index lock state.

`--fix` performs only idempotent repairs:

- Remove stale runtime and search-index locks.
- Repair `work.dependencyIds` from canonical `blocks` graph edges.
- Recompute derived readiness.
- Rebuild context-pack projections.
- Rebuild the local search index.
- Expire stale active reservations and restore affected work to derived readiness.

`--strict` treats warnings as a failing doctor result for CI and hardening gates. Diagnostic severities are not rewritten; JSON `data.ok` and the command exit code fail when any `warning` remains.

Without `--strict`, doctor exits `1` when any diagnostic has severity `error`.

Package script:

```bash
pnpm doctor:strict
```

Runs `bwrk doctor --workspace . --strict --json` from the repository root.

## `lock inspect`

```bash
bwrk lock inspect [--json]
```

Inspects the runtime state lock at `.boreal/runtime/state.lock`.

JSON `data` shape:

```json
{
  "exists": false,
  "stale": false,
  "lockDir": "/absolute/path/.boreal/runtime/state.lock"
}
```

## `lock break`

```bash
bwrk lock break --stale-only [--json]
```

Breaks only stale runtime locks. Active locks are never broken. Concurrent stale-lock breakers coordinate through an adjacent recovery lock.

JSON `data` shape:

```json
{
  "removed": true,
  "inspection": {
    "exists": true,
    "stale": true,
    "lockDir": "/absolute/path/.boreal/runtime/state.lock"
  }
}
```
