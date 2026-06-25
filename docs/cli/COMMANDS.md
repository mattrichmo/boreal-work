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
- `--help`: show root or group help.

Flag parsing:

- Unknown flags are rejected before any command executes.
- Boolean flags accept explicit false values, for example `--json=false` or `--ready=false`.
- Non-repeatable flags are rejected when supplied more than once.

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
reserved
in_progress
blocked
needs_verification
verified
closed
cancelled
```

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

## `work reserve`

```bash
bwrk work reserve <work-id> [--agent <id>] [--purpose <text>] [--force --reason <text>] [--json]
```

Reserves a ready work item for an agent. If `--agent` is omitted, the CLI actor ID is used.

Normal reservation requires `ready` work. `--force` allows a documented reservation of non-ready work only when `--reason` is also supplied. Closed and cancelled work still cannot be reserved.

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

## `doctor`

```bash
bwrk doctor [--fix] [--json]
```

Validates workspace health.

Checks:

- `.boreal` and runtime state presence.
- Runtime state JSON parse and schema version.
- Required state sections.
- Missing IDs and duplicate IDs within each state section.
- Malformed work, evidence, verification, source, claim, decision, context-pack, graph, and reservation records.
- Dangling work dependencies, evidence references, and verification references.
- Dangling knowledge source and claim evidence references.
- Duplicate graph edges, dangling work graph edges, graph/dependency disagreement, and dependency cycles.
- Reservation consistency, including active reservations for terminal work and reserved work without active reservations.
- Verification policy drift, including passed verifications without passed evidence.
- Closed work items without close reasons.
- Derived readiness consistency.
- Missing or stale context-pack projections.
- Runtime lock state.

`--fix` performs only idempotent repairs:

- Remove stale runtime locks.
- Recompute derived readiness.
- Rebuild context-pack projections.

Doctor exits `1` when any diagnostic has severity `error`.

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
