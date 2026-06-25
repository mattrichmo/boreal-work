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
bwrk help doctor
bwrk help lock
bwrk work --help
```

Help commands do not require an initialized workspace.

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
bwrk work reserve <work-id> [--agent <id>] [--purpose <text>] [--json]
```

Reserves a ready work item for an agent. If `--agent` is omitted, the CLI actor ID is used.

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

Creates a verification record. `--evidence` may be repeated. Verification fails if referenced evidence is not attached to the work item.

## `work close`

```bash
bwrk work close <work-id> --reason <text> [--json]
```

Closes a work item. Runtime policy requires a passing verification before close.

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
- Malformed work, evidence, verification, and context-pack records.
- Dangling work dependencies, evidence references, and verification references.
- Derived readiness consistency.
- Missing context-pack projections.
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
