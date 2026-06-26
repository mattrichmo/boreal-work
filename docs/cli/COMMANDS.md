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

Result limits:

- List commands default to `100` rows and reject `--limit` values over `1000`.
- `operation list` defaults to `50` rows and rejects `--limit` values over `1000`.
- `work next` defaults to `10` rows and rejects `--limit` values over `1000`.
- `context search` and `search query` reject `--limit` values over `100`.
- `work claim` and `agent start` handoff search output defaults to `8` results and rejects `--limit` values over `50`.

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
- `current` and `active` resolve to the selected actor or agent's single non-expired active reservation. Agent-aware commands such as `agent finish` use `--agent` for this shortcut.
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

Top-level `ok: true` means the command invocation produced a valid response envelope. Commands that act as health or diagnostic gates can still return nested `data.ok: false`; agents should treat nested `data.ok === false` and any nonzero process exit as a failed gate even when stdout is valid JSON.

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
bwrk help session
bwrk help operation
bwrk help export
bwrk help import
bwrk help snapshot
bwrk help doctor
bwrk help lock
bwrk help commands
bwrk help prime
bwrk work --help
```

Help commands do not require an initialized workspace.

## `commands`

```bash
bwrk commands [--format table|markdown] [--json]
```

Prints the registered command surface used by dispatch, help, strict flag validation, and generated documentation references.

Human output defaults to a compact table. `--format markdown` emits a generated command reference from `COMMAND_DEFINITIONS`, including usage, flags, behavior metadata, output schema IDs, and examples. JSON mode returns the machine registry envelope and ignores the human format.

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

## `workflows list`

```bash
bwrk workflows list [--json]
```

Lists the checked-in Boreal v1 workflow playbooks. JSON rows include workflow ID, title, group, relative path, allowed-command count, and template count.

## `workflows show`

```bash
bwrk workflows show <workflow-id|path|slug> [--json]
```

Shows one workflow playbook by exact workflow ID, relative path under `workflows/`, or filename slug. Human output is the Markdown workflow text; JSON output includes metadata and text.

## `install codex`

```bash
bwrk install codex [--install-root <dir>] [--dry-run] [--json]
```

Plans or installs Boreal skill adapters for Codex. Defaults to the configured `.agents/skills` root when project setup exists, otherwise `.agents` under the selected workspace. Both `.agents` and `.agents/skills` are accepted; the actual scanned skill root is reported as `skillRoot`. Installed skills include Codex UI metadata in `agents/openai.yaml`. Use `--dry-run` before writing.

## `install claude`

```bash
bwrk install claude [--install-root <dir>] [--dry-run] [--json]
```

Plans or installs Boreal skill adapters for Claude. Defaults to a configured `.claude/skills` root when project setup uses one, otherwise `.claude` under the selected workspace. Both `.claude` and `.claude/skills` are accepted; the actual scanned skill root is reported as `skillRoot`. Codex-specific `agents/openai.yaml` files are omitted. Use `--dry-run` before writing.

## `install skills`

```bash
bwrk install skills [--install-root <dir>] [--dry-run] [--json]
```

Plans or installs generic namespaced Boreal skill folders into a folder-scoped skill root. Defaults to the configured install root when project setup exists, otherwise `.agents/skills` under the selected workspace.

## `init`

```bash
bwrk init [--workspace <path>|--project-root <path>] [--setup-memory] [--memory-root <path>] [--memory-layout in-repo|child|sibling] [--memory-git-mode shared|separate|submodule] [--memory-remote <url>] [--separate-git] [--install-root <path>] [--skill-target codex|claude...] [--folder-scoped] [--interactive] [--json]
```

Initializes a Boreal workspace by creating durable runtime state under `.boreal/runtime/state.json`.

Behavior:

- Idempotent.
- Safe under concurrent init attempts.
- Plain `bwrk init` does not create memory files; use `bwrk vault init` for the repo-local default vault or `--setup-memory` for explicit project setup.
- With setup flags, writes `.boreal/project.json`, scaffolds the selected memory root, writes memory `.gitignore` guards, applies the selected memory Git mode, and installs the selected skill targets.
- Default setup uses sibling memory at `../<project>-memory` with `--memory-git-mode separate`, so memory history does not mix with application history.
- Supplying `--memory-root` without `--memory-layout` keeps the legacy explicit-root default of `--memory-layout in-repo`.
- `--memory-layout child` requires the memory root to be a direct child of the project root.
- `--memory-layout child` defaults to `--memory-git-mode separate`, initializes the child memory Git repo, and adds the child path to the project `.gitignore`.
- `--memory-layout sibling` requires the memory root to share the project root parent and always uses `--memory-git-mode separate`.
- `--memory-git-mode submodule` requires `--memory-layout child` and `--memory-remote`; setup writes `.gitmodules` metadata but leaves normal Git staging and the gitlink commit to the user.
- `--memory-git-mode shared` keeps memory in the project repository and is only the default for `--memory-layout in-repo`.
- `--separate-git` is retained as a compatibility alias for `--memory-git-mode separate`.
- `--interactive` prompts for the same setup fields and requires a TTY. Path fields use editable text prompts; choice fields use arrow-key selectors with descriptions. Use Space to toggle multiple skill targets and Enter to accept.
- `--skill-target codex` installs to `.agents/skills`; `--skill-target claude` installs to `.claude/skills` unless the configured install root is already Claude-shaped.
- Returns the existing initialization event when the workspace is already initialized.
- Human output is a short setup summary with Git guard status. Use `--json` when automation needs the full `projectSetup` object.

Common setup examples:

```bash
bwrk init --setup-memory --install-root .agents/skills --skill-target codex --folder-scoped --json
bwrk init --setup-memory --memory-root memory --memory-layout child --memory-git-mode separate --json
bwrk init --setup-memory --memory-root memory --memory-layout child --memory-git-mode submodule --memory-remote git@example.com:team/project-memory.git --json
```

JSON `data` shape:

```json
{
  "initialized": true,
  "workspaceRoot": "/absolute/path",
  "eventId": "bw_event_...",
  "projectSetup": {
    "configured": true,
    "configPath": "/absolute/path/.boreal/project.json",
    "config": {
      "schemaVersion": "boreal.project-setup.v1",
      "projectRoot": "/absolute/path",
      "memoryRoot": "/absolute/path-memory",
      "memoryLayout": "sibling",
      "memoryGitMode": "separate",
      "installRoot": "/absolute/path/.agents/skills",
      "skillTargets": ["codex"],
      "folderScoped": true,
      "createdAt": "2026-06-26T00:00:00.000Z",
      "updatedAt": "2026-06-26T00:00:00.000Z"
    },
    "gitSetup": {
      "memoryGitMode": "separate",
      "memoryRepoInitialized": true,
      "memoryRepoExisting": false,
      "memoryGitignoreUpdated": true,
      "projectGitignoreUpdated": true,
      "gitmodulesUpdated": false,
      "ignoredByProject": false,
      "memoryGitDir": "/absolute/path-memory/.git",
      "memoryGitignorePath": "/absolute/path-memory/.gitignore",
      "projectGitignorePath": "/absolute/path/.gitignore"
    },
    "createdDirectories": ["path-memory", "raw", "wiki"],
    "existingDirectories": [],
    "createdFiles": ["index.md", "raw/index.jsonl"],
    "existingFiles": []
  },
  "skillInstalls": [
    {
      "target": "codex",
      "installRoot": "/absolute/path/.agents/skills",
      "skillRoot": "/absolute/path/.agents/skills",
      "fileCount": 33
    }
  ]
}
```

`projectSetup` is omitted when no setup flags are supplied.

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

Lists work items. `--label` may be repeated and all labels must match. Default `--limit` is `100`; max is `1000`.

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

Lists claimable ready work from the live runtime view, ordered by priority and title. `--label` may be repeated and all labels must match. Default `--limit` is `10`; max is `1000`.

This command does not use the search index; readiness and reservation-sensitive workflow state are read from current runtime state.

## `work show`

```bash
bwrk work show <work-id> [--json]
```

Shows the work view for one item, including evidence, verification, dependency, active-blocker, and context-pack summary fields when present. In JSON output, `dependencyIds` is the full dependency list, `activeBlockerIds` is the unresolved blocker list, and the legacy `blockedBy` field mirrors `activeBlockerIds`.

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

## `dep remove`

```bash
bwrk dep remove <work-id> <depends-on-work-id> [--type blocks] [--json]
```

Removes a canonical `blocks` dependency edge between work items. The dependent work's `dependencyIds` projection and readiness are recomputed from the remaining block graph in the same runtime transaction. Missing dependencies fail closed with `BOREAL_NOT_FOUND`.

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

`--limit` controls the number of returned search results, defaults to `8`, and is capped at `50`. Limit validation happens before claiming work so invalid input cannot create a reservation.

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
- `--limit`: maximum number of rows. Default is `100`; max is `1000`.

Rows include reservation ID, status, computed `expired`, agent ID, work ID, work status, work title, `reservedAt`, optional `expiresAt`, and optional purpose.

## `prime`

```bash
bwrk prime [--agent <agent-id>] [--label <label>] [--json]
```

Prints the compact startup brief for an agent session without claiming work. The brief includes workspace sync health, agent coordination state, bounded operation history for the active `--session`, copyable protocol commands, and concrete recommended actions.

`prime` is read-only for project state. Like other initialized workspace commands, it is still logged in local operation history for auditability.

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

Guarded exit workflow for work with an active agent reservation. The command requires the selected agent to own the active, non-expired reservation before it records evidence, verifies the work, and closes or releases anything. Use `current` or `active` as the work reference when the selected `--agent` has exactly one non-expired active reservation. Evidence, verification, optional close, reservation release, readiness repair, and the final `agent.finished` event run as one engine transaction. One of `--close` or `--release` is required so finish cannot leave active ownership behind.

Behavior:

- Records one evidence item against the work. If `--outcome` is omitted, it defaults to `passed` for a passed verdict and `failed` for a failed verdict.
- Verifies the work using the new evidence ID.
- Refreshes the work context/projection for the returned view so `work.status`, counts, and `contextSummary` describe the same post-finish state.
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

`--limit` controls returned handoff search results, defaults to `8`, and is capped at `50`. Limit validation happens before resuming or claiming work so invalid input cannot create a reservation.

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

## `session start`

```bash
bwrk session start [--id <session-id>] [--agent <agent-id>] [--label <label>] [--json]
```

Starts the local agent protocol around a normalized session ID. If `--id` is omitted, the command uses `--session`, `BOREAL_SESSION_ID`, or generates a new `session-...` ID. The command logs itself under that same session ID and returns the same brief shape as `prime`.

Use the returned `commands.*` strings for the rest of the run so every operation is grouped under the same session.

## `session end`

```bash
bwrk session end [--id <session-id>] [--agent <agent-id>] [--label <label>] [--json]
```

Summarizes the target session without deleting or closing records. The result reports operation totals, failed commands, state/artifact-changing command counts, sync health, current agent reservations, and recommended follow-up commands. When active reservations remain, the recommendations point at reservation review instead of pretending the session is clean.

## `operation list`

```bash
bwrk operation list [--session-id <id>] [--command <path>] [--status succeeded|failed|all] [--limit <count>] [--json]
```

Lists local command operation records newest first. Default `--limit` is `50`; max is `1000`. Filters are exact after normalization:

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

Lists knowledge sources. Default `--limit` is `100`; max is `1000`. JSON output is an array of rows with `id`, `kind`, `title`, and `uri`.

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

Lists claims, optionally filtered by status and source. Default `--limit` is `100`; max is `1000`.

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

Lists decisions, optionally filtered by status and source. Default `--limit` is `100`; max is `1000`.

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

Searches context-pack summary documents and bounded context-chunk documents only. `--limit` is capped at `100`. The search index must be fresh; run `bwrk search index` or `bwrk doctor --fix` after imports, writes, or context rebuilds that change searchable content.

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

Searches work, evidence, sources, claims, decisions, context packs, and bounded context chunks. `--limit` is capped at `100`. Results are ranked by ID prefix matches, field-weighted token matches adjusted by document frequency, deterministic vector-lite similarity, and stable type/title ordering. Tokenization preserves compact tokens while adding camelCase, path/URI, underscore, and alpha-numeric split variants.

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

## `vault init`

```bash
bwrk vault init [--json]
```

Creates the configured Boreal memory vault scaffold. Without `.boreal/project.json`, this is the repo-local `memory/` directory. With project setup config, the command uses the configured `memoryRoot`, including explicit child or sibling memory roots. The scaffold includes `raw/`, `wiki/`, `work/`, `graph/`, `ledgers/`, `dashboards/`, local `.boreal/` runtime folders, Markdown index pages, and JSONL placeholders for raw source, graph, and ledger records. Existing files are not overwritten.

JSON `data` contains `ok`, `initialized`, `rootDir`, `schemaVersion`, path status lists, and `createdDirectories`, `existingDirectories`, `createdFiles`, and `existingFiles`.

## `vault status`

```bash
bwrk vault status [--json]
```

Checks whether the configured vault scaffold exists and whether required paths have the expected file or directory type. It exits `1` when the vault is missing, incomplete, structurally invalid, or has hard content-health failures.

The status also scans raw source JSONL and wiki pages for malformed raw records, broken wikilinks, missing source references, orphan wiki pages, and stale claim pages. Wiki pages with valid raw source references are treated as source-backed entry pages, not orphan warnings.

JSON `data` contains `ok`, `initialized`, `rootDir`, `schemaVersion`, `health`, `requiredDirectories`, `requiredFiles`, `missingDirectories`, `missingFiles`, and `invalidPaths`.

## `raw add`

```bash
bwrk raw add --title <text> [--uri <uri>] [--kind raw|document|chat|code|artifact] [--summary <text>] [--tag <tag>...] [--json]
```

Appends an immutable raw source record to the configured vault raw index. The memory vault must be initialized first with `bwrk vault init` or `bwrk init --setup-memory`. Concurrent JSONL appends are serialized with locks under the configured vault `.boreal/locks/` directory.

JSON `data` contains `added`, `indexPath`, and the raw source `record` with stable metadata and a content hash.

## `wiki create`

```bash
bwrk wiki create <title> [--slug <slug>] [--summary <text>] [--source <raw-id>...] [--tag <tag>...] [--json]
```

Creates a Markdown wiki page under the configured vault wiki directory with flat Boreal frontmatter. Existing page slugs are never overwritten. Slug existence checks and writes are serialized with a vault wiki lock under `.boreal/locks/`. Use `--source` to link the page to raw source records from the configured raw index.

JSON `data` contains `created`, `path`, and the created `page` summary.

## `duplicate scan`

```bash
bwrk duplicate scan [--domain all|work|raw|wiki] [--json]
```

Scans runtime work items and memory vault raw/wiki records for likely duplicates. Work and wiki duplicates are grouped by normalized title; raw source duplicates are grouped by normalized URI and normalized title. The command is read-only and emits review-only merge plans.

JSON `data` contains `ok`, `domain`, `scanned`, `skipped`, `duplicateGroups`, and `mergePlans`. Each merge plan has `destructive: false` and `strategy: manual_review`.

## `merge plan`

```bash
bwrk merge plan --domain work|raw|wiki --survivor <id> --duplicate <id>... [--json]
```

Builds a non-destructive merge review document. It validates command shape and prints the same plan format emitted by `duplicate scan`; it does not mutate runtime state or vault files.

JSON `data` contains `id`, `domain`, `destructive`, `strategy`, `survivorId`, `duplicateIds`, and `commands`.

## `merge apply`

```bash
bwrk merge apply --domain work|raw|wiki --survivor <id> --duplicate <id>... --plan <plan-id> --confirm [--json]
```

Applies a reviewed merge plan only when the exact current plan ID and `--confirm` are supplied. The command recomputes the plan from the provided inputs and refuses mismatches so stale review output cannot be applied accidentally.

Behavior:

- `work`: archives duplicate work items by marking them `cancelled`, keeps the survivor, unions labels, acceptance criteria, evidence IDs, verification IDs, and source refs onto the survivor, and records a runtime `merge.applied` event.
- `raw` and `wiki`: preserve source records/pages and append a merge event to `memory/ledgers/events.jsonl`.
- Active, reserved, or in-progress duplicate work fails closed instead of cancelling someone else's reservation.

## `compact analyze`

```bash
bwrk compact analyze [--domain all|work|wiki] [--older-than-days <n>] [--json]
```

Finds compaction candidates without mutating runtime state or vault files. Closed work is eligible when it has been closed for at least the age threshold, defaulting to 30 days. Vault wiki pages are eligible when they are orphaned or marked with stale claim frontmatter.

JSON `data` contains `ok`, `domain`, `olderThanDays`, `scanned`, `skipped`, `candidates`, and `plans`. Every plan has `destructive: false`, `strategy: summarize_preserve_sources`, and explicit preservation guarantees for evidence IDs, verification IDs, source refs, wiki links, and original paths.

## `compact apply`

```bash
bwrk compact apply --domain work|wiki --target <id> --plan <plan-id> --summary <text> --confirm [--older-than-days <n>] [--json]
```

Applies one reviewed compaction plan only when the target is still eligible and the exact plan ID plus `--confirm` are supplied. The memory vault must be initialized because apply archives original content before summarizing the target.

Behavior:

- `work`: writes `memory/work/compacted/<work-id>.md`, replaces the work description with the reviewed summary plus preservation references, tags the work as compacted, and records runtime/vault compaction events.
- `wiki`: writes `memory/wiki/archive/<slug>-<timestamp>.md`, rewrites the page body to the reviewed summary, keeps source refs and links visible, and records a vault compaction event.
- The command is non-destructive: original content is kept in the archive path returned in JSON.

## `sync status`

```bash
bwrk sync status [--json]
```

Checks collaboration readiness without mutating state. The command combines repo-local memory vault readiness and content health, JSONL ledger freshness, generated search-index freshness, and Git worktree safety so agents can see whether the workspace is ready to share and query from one place.

JSON `data` contains `ok`, `workspaceRoot`, `checkedAt`, `vault`, `ledgers`, `searchIndex`, `git`, and `recommendedActions`. It exits `1` when the memory vault is missing/incomplete, when ledgers are missing/stale/invalid, when the local search index is missing/stale/invalid, or when `.boreal/ledgers` or `memory` paths are dirty on a protected branch or detached HEAD. Protected branches default to `main`, `master`, and `trunk`; set `BOREAL_PROTECTED_BRANCHES` to a comma-separated list to override. Recommended repairs are specific commands such as `bwrk vault init --json`, `bwrk sync refresh --json`, and `git switch -c boreal/sync-work`.

## `sync refresh`

```bash
bwrk sync refresh [--json]
```

Refreshes generated collaboration artifacts in one closeout command: context-pack projections, the local search index, and the JSONL ledger export. It then returns the same status shape as `sync status` under `data.status`. Snapshot creation remains explicit through `bwrk snapshot create --json` because snapshots are named baselines, not routine cache refreshes.

JSON `data` contains `refreshed`, `contextViews`, `searchIndex`, `ledgers`, and `status`. The command exits `1` if the post-refresh sync status is still not clean, for example because the vault is missing or Git collaboration paths are dirty on a protected branch.

## `ledger status`

```bash
bwrk ledger status [--dir <dir>] [--json]
```

Compares an exported JSONL ledger directory with the current runtime state. Missing ledgers, stale content hashes, parse errors, count mismatches, file hash mismatches, and invalid tombstones return a non-zero exit code. Default directory is `.boreal/ledgers`.

JSON `data` contains `ok`, `path`, `exists`, `stale`, `expectedContentHash`, `reconstructable`, and, when present, `contentHash`, `recordCounts`, `deletedRecordCounts`, `files`, `deletions`, or `error`.

## `ledger delete`

```bash
bwrk ledger delete <work|evidence|verification|source|claim|decision|graph-edge|reservation|projection|context-pack> <id> [--reason <text>] [--json]
```

Deletes a supported unreferenced record from runtime state, writes a `boreal.ledger-deletion.v1` tombstone to `deletions.jsonl`, and refreshes the JSONL ledger export. Supported record kinds are `work`, `evidence`, `verification`, `source`, `claim`, `decision`, `graph-edge`, `reservation`, `projection`, and `context-pack`. The command fails with `BOREAL_CONFLICT` whenever deletion would leave live runtime references dangling: work references include child/dependency work, evidence, verifications, graph edges, reservations, projections, and context packs; evidence references include work, verifications, claims, and graph edges; verification references include work and graph edges; source references include claims, decisions, and graph edges; claim and decision references include graph edges. Graph-edge deletion updates the affected work dependency projection when deleting a canonical `blocks` edge. Reservation deletion refuses active or work-referenced reservations. Projection and context-pack deletion are generated-artifact cleanup paths; CLI projection rebuilds and `doctor --fix` do not recreate generated IDs that already have ledger tombstones.

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
- Project setup drift: config root mismatch, configured memory root presence, expected memory Git repository boundary, project/memory `.gitignore` guards, child memory accidentally tracked by the project Git index, and child submodule `.gitmodules` metadata.
- Integrated schema validation for all persisted runtime state sections and runtime policy payloads.
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
- Repo-local `memory/` vault scaffold presence, path types, raw source JSONL, wiki links, source references, orphan pages, and stale claims.
- Derived readiness consistency.
- Missing or stale context-pack projections.
- Snapshot/export drift between the current export hash and the latest recovery snapshot.
- Missing, malformed, or stale local search index.
- Runtime state and search-index lock state.
- Git collaboration safety for `.boreal/ledgers` and `memory` paths on protected branches or detached HEAD.

`--fix` performs only idempotent repairs:

- Remove stale runtime and search-index locks.
- Repair `work.dependencyIds` from canonical `blocks` graph edges.
- Recompute derived readiness.
- Rebuild context-pack projections.
- Rebuild the local search index.
- Expire stale active reservations and restore affected work to derived readiness.
- Restore missing project/memory `.gitignore` guards.
- Initialize a missing memory Git repository when setup mode is `separate` or `submodule` and the memory root exists.
- Repair missing or stale child submodule `.gitmodules` path/URL metadata.

`--fix` does not remove child memory from the project Git index and does not delete stale non-submodule `.gitmodules` entries. Those are reported with exact Git details so a human can decide whether to run commands such as `git rm -r --cached -- memory`.

`--strict` treats warnings as a failing doctor result for CI and hardening gates. Diagnostic severities are not rewritten; JSON `data.ok` and the command exit code fail when any `warning` remains.

Without `--strict`, doctor exits `1` when any diagnostic has severity `error`.

Package script:

```bash
pnpm doctor:strict
```

Runs `bwrk doctor --workspace . --strict --json` from the repository root.

## `doctor skills`

```bash
bwrk doctor skills [--json]
```

Validates the checked-in workflow, template, and skill source files without requiring an initialized workspace. It checks duplicate workflow IDs, workflow command references, workflow template references, and skill workflow references.

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
