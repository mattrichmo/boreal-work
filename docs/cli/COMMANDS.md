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
- `--brief`: emit a compact JSON envelope profile for automation. This implies `--json`.
- `--actor <id>`: override the actor ID stored on new records.
- `--actor-kind human|agent|system`: override the actor kind. Defaults to `human`.
- `--session <id>`: group local command operation records under a session ID. Defaults to `BOREAL_SESSION_ID` or `local`.
- `--help`: show root or group help.
- `--version`: print the CLI version and exit.

In JSON mode, successful commands write one JSON envelope to stdout, errors write one JSON envelope to stderr, and unexpected raw stdout writes are redirected to stderr so stdout stays parseable. Command metadata declares `behavior.maxResultSizeChars` and `behavior.maxResultLines` budgets for JSON stdout. If a JSON result exceeds the byte budget, Boreal writes the full envelope under `.boreal/results/` and returns compact data with `truncated`, `preview`, `fullResultPath`, and `fullResultBytes`; runtime tests enforce representative byte and line budgets in CI.

Output modes:

- JSON mode is the stable automation contract. `--json` always returns a schema-backed JSON envelope and wins over human view flags.
- Brief JSON mode is the compact automation profile. `--brief` implies JSON output; mutating commands return the compact `data.result` mutation verdict, while read commands return `data.summary` with stable identifiers, statuses, counts, and short row summaries. Agent directives are included only when the command emits them.
- Agent directive bundles are deduped per `--session`: the first source hash emits the full bundle, and repeated unchanged state in the same session emits `agentDirectives: { "unchanged": true, "sourceHash": "sha256:..." }`.
- Plain mode is the default human output. It uses compact tables, records, or lines and avoids richer dashboard grouping unless requested.
- Dashboard mode is opt-in human rendering for commands that accept `--view dashboard`, such as `work next`, `agent status`, `sync status`, `doctor`, `lock inspect`, and `workflows list`. `--view dashboard` changes only human rendering; JSON mode still returns the same schema-backed payload.
- The browser console is a separate local app over CLI JSON contracts. Its global data endpoint is `bwrk dashboard global --json`; it should not be confused with `--view dashboard`, which is terminal-only human formatting.

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

State-mutating commands include a stable primary-result block at `data.result` using schema `boreal.cli.result.v1`. Agents should read this path instead of guessing between command-specific IDs such as `data.meta.id`, `data.id`, `data.summary.meta.id`, or `data.verification.meta.id`.

```json
{
  "ok": true,
  "data": {
    "result": {
      "schemaVersion": "boreal.cli.result.v1",
      "id": "bw_evidence_...",
      "kind": "evidence",
      "status": "passed",
      "subjectId": "bw_work_..."
    }
  }
}
```

`bwrk commands --json` exposes the same global contract at `data.jsonOutput.mutationResult`.

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
bwrk help registry
bwrk help snapshot
bwrk help doctor
bwrk help lock
bwrk help commands
bwrk help completion
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
      "usage": "bwrk work reserve <work-id> --agent <agent-id> [--purpose <text>] [--expires-at <iso>|--ttl <duration>] [--force --reason <text>] [--json]",
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
        "maxResultLines": 1250,
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

## `directives list`

```bash
bwrk directives list [--family <family>] [--status active|deprecated|removed] [--json]
```

Lists trusted static agent directive registry entries. Use `--family` to restrict the registry family and `--status` to inspect active, deprecated, or removed entries. Removed entries are filterable for compatibility, but the current static registry does not retain removed directive records.

JSON `data` uses schema `boreal.cli.directives.list.v1` and contains the registry version, source path, applied filters, family counts, and compact directive rows with lifecycle, derived status, and replacement IDs.

## `directives show`

```bash
bwrk directives show <directive-id> [--json]
```

Shows one trusted static directive registry entry. The payload includes the instruction text, trigger codes, payload fields, acknowledgement rules, and replacement metadata derived from registry `supersedes` links.

JSON `data` uses schema `boreal.cli.directives.show.v1`.

## `directives compile`

```bash
bwrk directives compile [--fixture <name>] [--command <command-path>] [--subject-type <type>] [--subject-id <id>] [--subject-title <title>] [--status <status>] [--json]
```

Compiles a trusted agent directive bundle from a deterministic debug fixture or explicit command and subject snapshot. Use repeated `--label`, `--dependency`, `--active-blocker`, `--open-descendant`, `--evidence`, `--verification`, `--commit`, and `--dirty-path` flags to shape the synthetic snapshot.

JSON `data` uses schema `boreal.cli.directives.compile.v1` and includes the snapshot command path, selected registry IDs, selection provenance, data payloads, missing requirements, assembly issues, and compiled bundle.

## `directives render`

```bash
bwrk directives render [--fixture <name>] [--format markdown|json] [--json]
```

Renders a compiled directive debug fixture for terminal inspection without reading or mutating workspace state. Fixtures include `blocked-work`, `closeout-success`, `doctor-recovery`, and `session-handoff`.

JSON `data` uses schema `boreal.cli.directives.render.v1` and includes the rendered content plus the underlying compile result.

## `directives explain`

```bash
bwrk directives explain <directive-id> [--fixture <name>] [--json]
```

Explains why a directive was emitted, selected but blocked by missing data, or not selected for a debug fixture or explicit command and subject snapshot. The same compile-shaping flags accepted by `directives compile` are accepted here.

JSON `data` uses schema `boreal.cli.directives.explain.v1` and includes selector checks, selection provenance, relevant issues, missing data, conflicts, and the emitted directive when present.

## `directives ack create`

```bash
bwrk directives ack create <directive-id> --outcome satisfied|deferred|noncompliant|not-applicable --subject-type <type> --command <command-path> [--registry-id <id>] [--version <version>] [--bundle-id <id>] [--registry-version <version>] [--envelope-schema <schema>] [--source-hash <sha256>] [--generated-at <iso>] [--subject-id <id>] [--subject-title <title>] [--evidence <id>...] [--summary <id>...] [--verification <id>...] [--artifact-uri <uri>...] [--handoff <id>...] [--reason-code <code>] [--reason <text>] [--json]
```

Records a durable directive acknowledgement. `satisfied` acknowledgements require at least one evidence, summary, verification, artifact URI, handoff, or reason link; `deferred`, `noncompliant`, and `not-applicable` acknowledgements require `--reason` or `--reason-code`.

JSON `data` uses schema `boreal.cli.directives.ack.create.v1` and returns the created acknowledgement record plus the runtime event that recorded it.

## `directives ack list`

```bash
bwrk directives ack list [--subject-id <id>] [--directive-id <id>] [--outcome <outcome>] [--json]
```

Lists durable directive acknowledgement records, optionally filtered by subject, directive id, or outcome.

JSON `data` uses schema `boreal.cli.directives.ack.list.v1`.

## `directives ack show`

```bash
bwrk directives ack show <acknowledgement-id> [--json]
```

Shows one durable directive acknowledgement record.

JSON `data` uses schema `boreal.cli.directives.ack.show.v1`.

## `completion`

```bash
bwrk completion <bash|zsh|fish> [--name <binary>] [--json]
```

Generates shell completion scripts from `COMMAND_DEFINITIONS`. The output includes a command manifest generated from the current registry so installed completions stay aligned with help, docs, and strict flag validation.

Local source checkout examples:

```bash
pnpm bwrk completion zsh > ~/.zsh/completions/_bwrk
pnpm bwrk completion bash > ~/.local/share/bash-completion/completions/bwrk
pnpm bwrk completion fish > ~/.config/fish/completions/bwrk.fish
```

Installed binary examples:

```bash
bwrk completion zsh > ~/.zsh/completions/_bwrk
bwrk completion bash > ~/.local/share/bash-completion/completions/bwrk
bwrk completion fish > ~/.config/fish/completions/bwrk.fish
```

Use `--name <binary>` when completing an alias or renamed package binary:

```bash
bwrk completion zsh --name boreal > ~/.zsh/completions/_boreal
```

JSON mode returns:

```json
{
  "shell": "zsh",
  "name": "bwrk",
  "script": "#compdef bwrk\n..."
}
```

## `version`

```bash
bwrk version [--json]
```

Prints stable Boreal CLI package and runtime version information. `bwrk --version` remains a one-line human probe (`boreal-work <version>`). `bwrk version --json` and `bwrk --version --json` return a `boreal.cli.version.v1` payload with the root package version, `@boreal/cli` package version, Node/package-manager runtime, runtime record schema, file-store schema, export/snapshot schema, JSONL ledger schemas, generated search and SQLite cache schemas, project setup/registry/vault schemas, daemon status schemas, published schema IDs, and the v1 migration policy. Non-reversible migrations must be snapshot-backed by a `boreal.export.v1` recovery snapshot.

## `start`

```bash
bwrk start [work-ref] [--agent <agent-id>] [--label <label>...] [--container <work-ref>] [--purpose <text>] [--expires-at <iso>|--ttl <duration>] [--query <text>] [--limit <n>] [--json]
```

Golden-path alias for `bwrk agent start`. With no work reference it resumes the selected agent's active work before claiming another ready item; with `work-ref` it starts or claims that exact work item. It returns the same JSON contract as `agent start`.

## `done`

```bash
bwrk done --summary <text> --reason <text> [--agent <agent-id>] [--kind command|test|diff|review|artifact|note] [--outcome passed|failed|observed|unknown] [--command <cmd>] [--uri <uri>] [--notes <text>] [--commit <sha>...] [--dirty-path <note>...] [--json]
```

Golden-path alias for `bwrk agent finish current --close` with a passed verification. It records evidence, verifies, closes, releases the active reservation, creates an agent closeout summary, and returns the same finish payload as `agent finish`.

## `pause`

```bash
bwrk pause --summary <text> [--agent <agent-id>] [--kind command|test|diff|review|artifact|note] [--outcome passed|failed|observed|unknown] [--command <cmd>] [--uri <uri>] [--verdict passed|failed] [--notes <text>] [--json]
```

Golden-path alias for `bwrk agent finish current --release`. It records evidence and verification, then releases the active reservation without closing the work. The default verdict is `failed` so partial work does not look complete accidentally.

## `status`

```bash
bwrk status [--agent <agent-id>] [--label <label>...] [--json]
```

Compatibility alias for `bwrk prime`. It prints the compact agent/session startup brief without claiming work. New agent-facing instructions should prefer `bwrk agent guide` for the command loop and `bwrk agent status` for coordination state.

## `next`

```bash
bwrk next [--agent <agent-id>] [--label <label>...] [--json]
```

Returns the next single executable directive for an agent. The command checks active reservations first, then claimable ready work, then workspace health. JSON output uses schema `boreal.cli.next.v1` and returns `state`, `checked`, one selected `directive` with `command`, and a top-level `agentDirectives` bundle containing exactly that directive. When nothing applies, it returns `state: "idle"` with `directive: null`. Plain output prints the executable command on the last line when a directive has a command.

## `workflows list`

```bash
bwrk workflows list [--view dashboard] [--json]
```

Lists the checked-in Boreal v1 workflow playbooks. JSON rows include workflow ID, title, group, relative path, allowed-command count, and template count. `--view dashboard` renders a grouped human workflow picker without changing JSON output.

## `workflows show`

```bash
bwrk workflows show <workflow-id|path|slug> [--json]
```

Shows one workflow playbook by exact workflow ID, relative path under `workflows/`, or filename slug. Human output is the Markdown workflow text; JSON output includes metadata and text.

## `install`

```bash
bwrk install [--yes] [--dry-run] [--interactive] [--workspace <dir>|--project-root <dir>] [--memory-root <dir>] [--memory-layout in-repo|child|sibling] [--memory-git-mode shared|separate|submodule] [--memory-remote <url>] [--install-root <dir>] [--skill-target codex|claude...] [--folder-scoped] [--json]
```

Runs the first-run project installer. In a TTY, bare `bwrk install` opens the setup flow. `bwrk install --yes` applies the recommended safe default: `./memory` as a child Git repository ignored by the app repo, Codex skills in `.agents/skills`, and folder-scoped skill metadata. `bwrk install --dry-run` previews the same plan without writing files. `bwrk install --json` is non-mutating unless `--yes` is also supplied. Short alias: `-y` means `--yes`.

## `install codex`

```bash
bwrk install codex [--install-root <dir>] [--dry-run] [--interactive] [--json]
```

Plans or installs Boreal skill adapters for Codex. Defaults to the configured `.agents/skills` root when project setup exists, otherwise `.agents` under the selected workspace. Both `.agents` and `.agents/skills` are accepted; the actual scanned skill root is reported as `skillRoot`. Installed skills include Codex UI metadata in `agents/openai.yaml` and reference workflows by canonical IDs that resolve through `bwrk workflows show <ref>`. Use `--dry-run` before writing. Use `--interactive` in a TTY to review the install plan before files are written.

## `install claude`

```bash
bwrk install claude [--install-root <dir>] [--dry-run] [--interactive] [--json]
```

Plans or installs Boreal skill adapters for Claude. Defaults to a configured `.claude/skills` root when project setup uses one, otherwise `.claude` under the selected workspace. Both `.claude` and `.claude/skills` are accepted; the actual scanned skill root is reported as `skillRoot`. Codex-specific `agents/openai.yaml` files are omitted, and workflow references remain canonical IDs resolvable by `bwrk workflows show <ref>`. Use `--dry-run` before writing. Use `--interactive` in a TTY to review the install plan before files are written.

## `install skills`

```bash
bwrk install skills [--install-root <dir>] [--dry-run] [--interactive] [--json]
```

Plans or installs generic namespaced Boreal skill folders into a folder-scoped skill root. Defaults to the configured install root when project setup exists, otherwise `.agents/skills` under the selected workspace. Workflow references are installed as canonical IDs that `bwrk workflows show <ref>` accepts verbatim. Use `--interactive` in a TTY to review the install plan before files are written.

## `install status`

```bash
bwrk install status [--bin-dir <dir>] [--path <value>] [--json]
```

Inspects local and global `bwrk` availability without writing files. JSON output includes the local source runner command, generated shim path, whether the shim directory is on PATH, the resolved global command, and `--version` probe output. Use `--bin-dir` to check a non-default local shim directory and `--path` to inspect a supplied PATH value.

## `registry list`

```bash
bwrk registry list [--registry-root <dir>] [--json]
```

Lists explicitly registered Boreal projects from the machine-local registry. It never scans parent directories or sibling repositories.

## `registry add`

```bash
bwrk registry add --workspace <path> [--registry-root <dir>] [--name <text>] [--label <label>...] [--json]
```

Adds or updates one explicit Boreal workspace in the machine-local registry. The target workspace must be initialized and must have `.boreal/project.json`; the stored row includes stable project identity, lifecycle, project root, `.boreal` root, runtime state file, project setup config, memory root, memory `.boreal` root, memory layout, memory Git mode, install root, skill targets, folder scope, display metadata, and timestamps.

## `registry remove`

```bash
bwrk registry remove <project-id> [--registry-root <dir>] [--purge] [--json]
```

Archives the registry row for a project by default so references can still resolve if it is relinked later. With `--purge`, removes only the registry row. It does not delete project files, memory files, or skill installs.

## `registry import-setup`

```bash
bwrk registry import-setup [--registry-root <dir>] [--name <text>] [--label <label>...] [--json]
```

Seeds or updates the registry from the selected workspace `.boreal/project.json`. It does not scan unrelated repositories; repeated imports of unchanged setup metadata return `changed: false` and keep one project bucket.

## `registry doctor`

```bash
bwrk registry doctor [--registry-root <dir>] [--json]
```

Validates registered project roots, Boreal runtime files, project setup config paths, memory roots, memory runtime directories, install roots, and setup mismatches. It exits nonzero when registered projects are stale, moved, invalid, or inconsistent with their `.boreal/project.json`.

## `dashboard`

```bash
bwrk dashboard [--web] [--global] [--json] [--mouse] [--refresh-ms <ms>] [--host <host>] [--port <n>] [--no-open] [--mode live|fixture] [--live-cache-ttl-ms <ms>] [--allow-fixture-fallback]
```

Opens the Boreal dashboard for the current workspace. **By default it runs the live terminal dashboard** (no HTTP server, no browser); it works in-process against the workspace and is dismissed with `q`. Surface and scope are independent flags:

- `--web` opens the browser console instead (binds `127.0.0.1:4318`, prints the URL, opens a browser).
- `--global` scopes to every registered project instead of the current repo.
- `--json` emits the bounded cross-repo data payload (no UI) for agents and adapters; same schema as `bwrk dashboard global`.

So `bwrk dashboard` is the terminal repo view, `bwrk dashboard --web` the browser, `bwrk dashboard --global` the terminal cross-repo view, and `bwrk dashboard --global --web` the browser cross-repo view.

Options:

- `--web`: open the browser console instead of the terminal dashboard.
- `--global`: scope to every registered project instead of the current repo.
- `--json`: print the bounded data payload instead of launching a UI.
- `--mouse`: terminal dashboard mouse wheel (off by default; enabling it disables the terminal's native text selection).
- `--tui`: deprecated and ignored; the terminal dashboard is now the default.
- `--refresh-ms`: terminal dashboard auto-refresh interval in milliseconds. Defaults to `5000`.
- `--host`: browser console (`--web`) bind address. Defaults to `127.0.0.1`.
- `--port`: browser console (`--web`) port number. Defaults to `4318`.
- `--no-open`: browser console (`--web`): print the URL without launching a browser.
- `--mode`: `live` for workspace data or `fixture` for demo data. Defaults to `live`.
- `--live-cache-ttl-ms`: browser console (`--web`) live data cache TTL between route clicks. Defaults to `60000`.
- `--allow-fixture-fallback`: browser console (`--web`) renders deterministic fixture data with warnings if live data fails. Without this flag, live data failures return an error.

## `dashboard global`

```bash
bwrk dashboard global [--limit <n>] [--registry-root <dir>] [--json]
```

Emits the bounded global dashboard payload for registered projects, or the current workspace when the registry is empty. The command reads runtime state and registry metadata only; it does not render the browser dashboard or mutate project state.

The JSON `data` payload uses schema `boreal.cli.dashboard.global.v1` and includes registry, global queue, search, activity, health, daemon status, and settings view-model sections. Results are capped at 100 projects, 250 work rows per project, 200 rows per queue, 10 search rows per project, and 20 activity rows per project.

Examples:

```bash
bwrk dashboard global --json
bwrk dashboard global --limit 10 --json
```

## `global`

```bash
bwrk global [link <path>|unlink <project-id>] [--web] [--json] [--mouse] [--refresh-ms <ms>] [--host <host>] [--port <n>] [--no-open] [--mode live|fixture] [--live-cache-ttl-ms <ms>] [--allow-fixture-fallback] [--name <text>] [--label <label>...] [--registry-root <dir>] [--purge]
```

The machine-level **global workspace**: a real Boreal workspace (its own to-dos, plans, tasks, sprints) that lives at the registry root, plus a monitor over the projects you've linked. It is not tied to any repo.

- With **no subcommand**, opens the cross-repo dashboard — terminal by default, `--web` for the browser, `--json` for the bounded data payload. `bwrk dashboard` shows only the current workspace; `bwrk global` shows your global workspace plus all linked projects.
- **`bwrk global <command> ...`** runs any command against the global workspace. For example `bwrk global work create "Plan Q3"`, `bwrk global work list`. This is sugar for `bwrk <command> ... --global`.
- **`bwrk global link <path>`** links a project so it's tracked here; **`bwrk global unlink <project-id>`** removes it.

The global workspace is created automatically on first use. Nothing is tracked globally until you link it; `bwrk init` never auto-links a project.

Options match `bwrk dashboard` (`--web`, `--mouse`, `--refresh-ms`, `--host`, `--port`, `--no-open`, `--mode`, `--live-cache-ttl-ms`, `--allow-fixture-fallback`), plus `--name`/`--label`/`--registry-root` for `link`.

## `link`

```bash
bwrk link [<path>] [--name <text>] [--label <label>...] [--registry-root <dir>] [--json]
```

Links a project to your global workspace so the global dashboard tracks it (machine-local registry). With no path, links the current repo. Equivalent to `bwrk registry add`; nothing flows up to Global until you link it. Also available as `bwrk global link <path>`.

## `unlink`

```bash
bwrk unlink <project-id> [--registry-root <dir>] [--purge] [--json]
```

Stops tracking a project in your global workspace by archiving it in the machine-local registry. Equivalent to `bwrk registry remove`. Also available as `bwrk global unlink <project-id>`.

## `daemon status`

```bash
bwrk daemon status [--json]
```

Reports the selected project's local daemon status without requiring the daemon to be running. The payload includes the daemon status file path, PID liveness when present, watched paths, runtime/search lock awareness, findings, and command-mediated repair recommendations. A stopped daemon is healthy; stale PID files and copied status files are warnings under strict doctor.

## `sprint list`

```bash
bwrk sprint list [--limit <n>] [--json]
```

Lists workspace-local work records with `kind: "sprint"` and marks the sprint selected by the explicit active-sprint projection. Results default to 200 rows and reject larger limits than 200.

## `sprint show`

```bash
bwrk sprint show <sprint-ref> [--limit <n>] [--json]
```

Shows one sprint resolved by exact ID, unambiguous ID prefix, exact title, or `current`. The returned `scope` is built from canonical `blocks` graph edges plus stored dependency IDs, not labels, and is capped at 500 descendant rows.

## `sprint current`

```bash
bwrk sprint current [--json]
```

Reads the workspace-local active-sprint projection. When no sprint is selected, the JSON payload returns `active: false`; when the projection points at missing or non-sprint work, it returns `stale: true` with projection details.

## `sprint activate`

```bash
bwrk sprint activate <sprint-ref> [--json]
```

Sets the workspace-local active sprint. Activation fails closed for missing, ambiguous, or non-sprint references, writes the deterministic `active-sprint` projection, and records a `sprint.activated` runtime event linked to the command operation.

## `sprint board`

```bash
bwrk sprint board [<sprint-ref>] [--limit <n>] [--json]
```

Returns the active or selected sprint as a `SprintBoardView` payload using schema `boreal.cli.sprint.board.v1`. The board groups dependency-scoped work into status lanes, lists milestone phases, summarizes status totals and reservations, and keeps `dependencyIds` separate from `activeBlockerIds`. Scope is built from canonical `blocks` graph edges plus dependency ID projections, not labels, and defaults to 500 descendant rows.

## `sprint report`

```bash
bwrk sprint report [<sprint-ref>] --doctor-evidence <evidence-id> --sync-evidence <evidence-id> [--format markdown|html] [--out <file>] [--limit <n>] [--json]
```

Exports a static sprint closeout report using schema `boreal.cli.sprint.report.v1`. The report is built from dependency-scoped sprint work, scoped agent summaries, summary checkpoint coverage, scoped evidence, directly linked decisions, unresolved blockers, and open next-sprint candidates. `--format` defaults to `markdown`; `--out` writes a workspace-relative artifact file, and omitted `--out` returns the rendered content.

Closeout reports fail closed unless `--doctor-evidence` and `--sync-evidence` point at distinct passed evidence records inside the selected sprint scope. The evidence text, command, or URI must reference `doctor` or `sync` respectively.

## `sprint metrics`

```bash
bwrk sprint metrics [<sprint-ref>] [--capacity <n>] [--commit <work-ref>...] [--carryover <work-ref>...] [--risk <text>...] [--closeout-reason <text>] [--limit <n>] [--json]
```

Computes sprint planning and closeout metrics from dependency-scoped work. The payload reports committed scope, capacity pressure, completed/open/blocked counts, carryover, explicit and derived risks, and whether the sprint is report-ready.

## `sprint close`

```bash
bwrk sprint close [<sprint-ref>] --reason <text> [--auto-report] [--report-format markdown|html] [--report-out <file>] [--strict] [--capacity <n>] [--carryover <work-ref>...] [--risk <text>...] [--limit <n>] [--agent-summary <id>...] [--force-summary --force-reason <code> --force-comment <text>] [--commit <sha>...] [--dirty-path <note>...] [--json]
```

Closes a verified sprint through the normal work close policy after ensuring a final or forced agent summary exists for the sprint. If no summary is supplied or already linked to the sprint, the command composes one from sprint state, child summaries, evidence, verification, commits, and dirty-path notes. When no sprint-level `--commit` is provided, at least one `--dirty-path` value must start with a checkpoint reason code such as `no_repo_changes: ...`; use `sprint_checkpoint_rollup: ...` when the sprint checkpoint is intentionally represented by child summary commits or dirty-path notes. Use `--force-summary` only with `--force-reason` and `--force-comment` for audited bypasses.

With `--auto-report`, sprint close runs sync refresh and doctor, records sprint-scoped passed evidence for both gates, verifies the sprint with that evidence, writes a sprint closeout report, composes the rollup summary, and closes the sprint in one command. The default report path is `.boreal/results/sprint-closeout-<sprint-id>.md`; use `--report-out` and `--report-format` to override it. `--strict` makes doctor warnings fail the auto-report gate.

## `init`

```bash
bwrk init [--workspace <dir>|--project-root <dir>] [--setup-memory] [--memory-root <dir>] [--memory-layout in-repo|child|sibling] [--memory-git-mode shared|separate|submodule] [--memory-remote <url>] [--separate-git] [--install-root <dir>] [--skill-target codex|claude...] [--folder-scoped] [--interactive] [--json]
```

Initializes a Boreal workspace by creating durable runtime state under `.boreal/runtime/state.json`.

Behavior:

- Idempotent.
- Safe under concurrent init attempts.
- Plain `bwrk init` does not create memory files; use `bwrk vault init` for the repo-local default vault or `--setup-memory` for explicit project setup.
- With setup flags, writes `.boreal/project.json`, scaffolds the selected memory root, writes memory `.gitignore` guards, applies the selected memory Git mode, and installs the selected skill targets.
- Default setup uses child memory at `<project>/memory` with `--memory-git-mode separate`, so memory stays visible in the project folder while keeping its own Git history.
- Supplying `--memory-root` without `--memory-layout` uses the default child layout. Pass `--memory-layout sibling` or `--memory-layout in-repo` explicitly for those shapes.
- `--memory-layout child` requires the memory root to be a direct child of the project root.
- `--memory-layout child` defaults to `--memory-git-mode separate`, initializes the child memory Git repo, and adds the child path to the project `.gitignore`.
- `--memory-layout sibling` requires the memory root to share the project root parent and always uses `--memory-git-mode separate`.
- `--memory-git-mode submodule` requires `--memory-layout child` and `--memory-remote`; setup writes `.gitmodules` metadata, but doctor still requires a real project-index gitlink (`160000` mode). Run `git submodule add <remote> <path>` or otherwise create the gitlink before treating submodule mode as healthy.
- `--memory-git-mode shared` keeps memory in the project repository and is only the default for `--memory-layout in-repo`.
- `--separate-git` is retained as a compatibility alias for `--memory-git-mode separate`.
- `--interactive` prompts for the same setup fields and requires a TTY. Path fields use editable text prompts; choice fields use arrow-key selectors with descriptions. Use Space to toggle multiple skill targets and Enter to accept.
- `--skill-target codex` installs to `.agents/skills`; `--skill-target claude` installs to `.claude/skills` unless the configured install root is already Claude-shaped. Setup stores resolved `skillInstallRoots[]` so future installs, registry entries, and doctor output agree per target.
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
      "skillInstallRoots": [
        {
          "target": "codex",
          "installRoot": "/absolute/path/.agents/skills",
          "skillRoot": "/absolute/path/.agents/skills"
        }
      ],
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
bwrk work create <title> [--description <text>] [--priority low|normal|high|critical] [--kind <kind>] [--label <label>...] [--acceptance <text>...] [--required-gate verification|checkpoint|review|audit[:self|direct_children|descendants]...] [--gate-command <command>...] [--gate-expect <text>...] [--source <source-ref>...] [--ready] [--json]
```

Creates a work item. `--label`, `--acceptance`, `--required-gate`, and `--source` may be repeated. Source references are stored on the work record metadata so promoted discoveries keep their original context.

Behavior:

- Default `kind` is `task`.
- Default `priority` is `normal`.
- `--required-gate` stores first-class closeout gate metadata on the work record. Use `kind` for a self-scoped gate or `kind:scope` for `self`, `direct_children`, or `descendants`; for example `--required-gate review --required-gate audit:descendants`.
- `--gate-command` and `--gate-expect` attach declared command and observable metadata to the same-index `--required-gate`.
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
bwrk work list [--ready] [--status <status>] [--label <label>...] [--container <work-ref>] [--limit <n>] [--json]
```

Lists work items. `--label` may be repeated and all labels must match. `--container` scopes results to the container and its dependency-graph descendants; use it for epic/milestone/sprint-style scopes, while labels remain tags. `--ready` returns dependency-valid claimable work from the current graph; `--status ready` is a raw status filter. Default `--limit` is `100`; max is `1000`.

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
bwrk work list --status ready --container <work-id> --label cli --limit 20 --json
```

JSON `data` shape:

```json
[
  {
    "id": "bw_work_...",
    "kind": "task",
    "status": "ready",
    "priority": "normal",
    "title": "Harden CLI output",
    "labels": ["cli"],
    "containerId": "bw_work_...",
    "parentIds": ["bw_work_..."],
    "lineage": [
      {
        "id": "bw_work_...",
        "kind": "sprint",
        "role": "sprint",
        "title": "Sprint 01",
        "labels": ["sprint-01"]
      }
    ]
  }
]
```

`containerId` is present only when `--container` is used. `parentIds` and `lineage` are present when Boreal can derive parent containers from explicit `parentId` or dependency-graph ancestry.

## `work recent-closed`

```bash
bwrk work recent-closed [--since <duration|iso>] [--after <iso|checkpoint-id>] [--container <work-ref>] [--kind issue|task|sprint|milestone] [--phase] [--limit <n>] [--order asc|desc] [--json]
```

Lists closed work from durable work records plus matching `work.closed` events, sorted by `closedAt`. The rows include id, title, kind, status, closedAt, closedReason, labels, evidence count, verification count, and the latest closed event id when present.

Use `--since` for an inclusive ISO timestamp or relative duration such as `2h`; use `--after` for an exclusive ISO timestamp or an inclusive reviewer heartbeat checkpoint id. `--container` scopes results to the container and its dependency-graph descendants. `--phase` returns phase milestones, represented as milestone work carrying the `phase` label.

## `work review-candidates`

```bash
bwrk work review-candidates [--since <duration|iso>] [--after <iso|checkpoint-id>] [--container <work-ref>] [--kind issue|task|sprint|milestone] [--phase] [--review-status pending|passed|forced|optional|all] [--include-optional] [--limit <n>] [--order asc|desc] [--json]
```

Lists closed work with required review or audit gates, using the same durable closed-work and `work.closed` sources as `work recent-closed`. The default `--review-status pending` returns required gates still waiting on review evidence. Use `--review-status all` to include passed and forced bypass rows, and `--include-optional` to include ordinary recent closures with no required review/audit gate.

Each JSON row includes review/audit gate counts, pending/passed/forced gate IDs, the current `closeoutGateStatus`, a `reviewEvidenceCommand`, and, when `--after` is a heartbeat checkpoint, a `heartbeatAdvanceCommand`. A reviewer-agent loop is:

```bash
bwrk heartbeat show <checkpoint> --reviewer <reviewer-id> --container <work-ref> --json
bwrk work review-candidates --container <work-ref> --after <checkpoint-id> --review-status pending --json
bwrk evidence add <work-id> --kind review --outcome passed --summary <review-summary> --json
bwrk heartbeat advance <checkpoint-id> --work <work-id> --json
```

## `work next`

```bash
bwrk work next [--label <label>...] [--container <work-ref>] [--agent <agent-id>] [--purpose <text>] [--limit <n>] [--view dashboard] [--json]
```

Lists dependency-valid claimable ready work from the live runtime view, ordered by priority and title. `--label` may be repeated and all labels must match. `--container` scopes results to the container and its dependency-graph descendants; use it for epic/milestone/sprint-style scopes rather than relying on labels alone. Scoped rows include `containerId`, and rows with known parents include root-to-nearest `parentIds` plus structured `lineage`. JSON rows include `showCommand`, `agentStartCommand`, and `workClaimCommand` exact commands. `--agent` and `--purpose` customize those generated commands. Default `--limit` is `10`; max is `1000`. `--view dashboard` renders a grouped ready-queue view for humans.

This command does not use the search index; readiness and reservation-sensitive workflow state are read from current runtime state.

## `work parallel`

```bash
bwrk work parallel [--label <label>...] [--container <work-ref>] [--agent <agent-id>...] [--agent-prefix <prefix>] [--purpose <text>] [--limit <n>] [--json]
```

Builds a read-only coordinator queue for parallel agent fan-out. It uses the same dependency-valid readiness, priority ordering, label filtering, lineage, and container scoping as `work next`, but returns a `boreal.cli.work.parallel.v1` record with `items`, `filters`, and refresh commands.

Each item includes the ready work row plus an assigned `agentId`, exact `agentStartCommand`, exact `workClaimCommand`, and `showCommand`. Use repeated `--agent` values to round-robin rows across named workers, or `--agent-prefix worker` to generate `worker-1`, `worker-2`, and so on. The command only reads queue state; the generated `agent start <work-id>` or `work claim <work-id>` command performs the actual reservation.

## `work show`

```bash
bwrk work show <work-id> [--since <ledger-seq>] [--json]
```

Shows the work view for one item, including evidence, verification, dependency, active-blocker, and context-pack summary fields when present. In JSON output, `dependencyIds` is the full dependency list, `activeBlockerIds` is the unresolved blocker list, and the legacy `blockedBy` field mirrors `activeBlockerIds`.
When `--since` is supplied, JSON output returns a minimal unchanged payload if no newer ledger event touches that item.

## `work block`

```bash
bwrk work block <work-id> <blocked-by-work-id> [--json]
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
When a dependency has already been expanded elsewhere in the same tree, later appearances are returned as a `shared: true` node with an empty `dependencies` array to keep output bounded on shared dependency subgraphs.

## `dep cycles`

```bash
bwrk dep cycles [--json]
```

Lists dependency cycles in canonical `blocks` graph edges.

## `work reserve`

```bash
bwrk work reserve <work-id> --agent <agent-id> [--purpose <text>] [--expires-at <iso>|--ttl <duration>] [--force --reason <text>] [--json]
```

Reserves a ready work item for an agent. If `--agent` is omitted, the CLI actor ID is used.

Normal reservation requires `ready` work. A successful reservation writes an active reservation record, stores its ID on the work item, and moves the work to `in_progress`. JSON output keeps the updated work fields at top level and also includes the active `reservation` record and `releasedReservations`. `--force` allows a documented reservation of non-ready work only when `--reason` is also supplied. Closed and cancelled work still cannot be reserved.

Reservations can expire:

```bash
bwrk work reserve <work-id> --ttl 2h
bwrk work reserve <work-id> --expires-at 2026-06-25T22:00:00.000Z
```

`--ttl` accepts positive durations with `s`, `m`, `h`, or `d` units.

## `work claim`

```bash
bwrk work claim [work-ref] [--start] [--label <label>...] [--container <work-ref>] [--agent <agent-id>] [--purpose <text>] [--expires-at <iso>|--ttl <duration>] [--query <text>] [--limit <n>] [--json]
```

Atomically finds the next live ready work item, or claims the specified ready work item, reserves it for the agent, rebuilds context-pack projections, rebuilds the local search index, and returns a handoff bundle.

Selection behavior:

- `work-ref` claims one exact work item; use this when a task ID is already known.
- `--label` may be repeated and all labels must match.
- `--container` restricts selection to the container and its dependency-graph descendants.
- When `work-ref` is provided, `--label` and `--container` validate that the exact work item matches those filters before reserving.
- Claimed work is ordered by priority, title, then ID.
- The runtime rechecks blocker-derived readiness inside the same write transaction before reserving.
- `--start` returns the same start-shaped handoff payload as `bwrk agent start`, including resume behavior for an existing active reservation.
- If no work matches, the command exits `0` with `claimed: false`.

Handoff output includes:

- The claimed work view.
- The reservation record.
- The refreshed context pack for the claimed work.
- `contextFreshness.contextPackLedgerSeq` and `contextFreshness.currentLedgerSeq`, using the same ledger sequence basis as JSON response envelopes.
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
bwrk reservation list [--agent <agent-id>] [--work <work-id>] [--status active|released|expired|all] [--expired] [--limit <n>] [--json]
```

Shows reservation ownership and expiration state for multi-agent coordination. By default, only active reservations are shown.

Filters:

- `--agent`: only reservations for one agent.
- `--work`: only reservations for one work item.
- `--status`: lifecycle status; use `all` to include active, released, and expired records.
- `--expired`: only rows whose `expiresAt` timestamp is in the past.
- `--limit`: maximum number of rows. Default is `100`; max is `1000`.

Rows include reservation ID, status, computed `expired`, agent ID, work ID, work status, work title, `reservedAt`, optional `expiresAt`, and optional purpose.

## `heartbeat create`

```bash
bwrk heartbeat create <name> [--reviewer <id>|--agent <id>] [--container <work-ref>] [--work <work-ref>|--closed-at <iso>] [--event <event-id>] [--json]
```

Creates a named reviewer heartbeat checkpoint. A heartbeat stores the reviewer's last reviewed closed-work watermark, optionally scoped to a sprint, milestone, or other work container.

Use `--work` to seed the checkpoint from a closed work item. Use `--closed-at` and optional `--event` when importing a known cursor from another review pass. JSON output includes `sinceHeartbeat.includeEqualClosedAt: true`; candidate queries should treat the stored `closedAt` as inclusive so equal-timestamp closures are not skipped.

## `heartbeat show`

```bash
bwrk heartbeat show <name|heartbeat-id> [--reviewer <id>|--agent <id>] [--container <work-ref>] [--json]
```

Shows a reviewer heartbeat checkpoint. Name lookup uses the reviewer ID and optional container scope; exact heartbeat IDs can be shown without those lookup flags.

## `heartbeat advance`

```bash
bwrk heartbeat advance <name|heartbeat-id> [--reviewer <id>|--agent <id>] [--container <work-ref>] [--work <work-ref>|--closed-at <iso>] [--event <event-id>] [--json]
```

Advances a heartbeat to a new cursor. Supplying `--work` requires a closed work item inside the heartbeat's container scope. Without an explicit cursor, the command advances to the latest closed work in scope.

## `prime`

```bash
bwrk prime [--agent <agent-id>] [--label <label>...] [--json]
```

Compatibility startup brief for an agent session without claiming work. The brief includes workspace sync health, agent coordination state, active context-pack freshness versus current ledger sequence, bounded operation history for the active `--session`, copyable protocol commands, and concrete recommended actions.

`prime` is read-only for project state. Like other initialized workspace commands, it is still logged in local operation history for auditability. New agent-facing instructions should prefer `bwrk agent guide` for the command loop and `bwrk agent status` for coordination state; `prime` remains available for existing workflows and scripts.

## `agent guide`

```bash
bwrk agent guide [--agent <agent-id>] [--label <label>...] [--json]
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
bwrk agent finish <work-id> (--summary <text>|--evidence <inline-or-evidence-id>) (--close --reason <text>|--release) [--agent <agent-id>] [--kind command|test|diff|review|artifact|note] [--outcome passed|failed|observed|unknown] [--command <cmd>] [--uri <uri>] [--verdict passed|failed] [--notes <text>] [--commit <sha>...] [--dirty-path <note>...] [--json]
```

Guarded exit workflow for work with an active agent reservation, plus explicit unreserved work refs. When the work has an active reservation, the command requires the selected agent to own the active, non-expired reservation before it records evidence, verifies the work, and closes or releases anything. Use `current` or `active` as the work reference when the selected `--agent` has exactly one non-expired active reservation. When an explicit work ID or title has no active reservation, Boreal creates a short-lived reservation for the selected agent and releases it inside the same transaction. Evidence, verification, optional close, reservation release, readiness repair, and the final `agent.finished` event run as one engine transaction. One of `--close` or `--release` is required so finish cannot leave active ownership behind. When closing, the evidence summary becomes the generated agent closeout summary body and optional `--commit` / `--dirty-path` values are linked into that summary; if no `--commit` is provided, one `--dirty-path` must start with a checkpoint reason code such as `no_repo_changes: ...`.

Behavior:

- Records one evidence item against the work. If `--outcome` is omitted, it defaults to `passed` for a passed verdict and `failed` for a failed verdict.
- `--evidence` can supply an inline evidence summary or an existing evidence ID as the finish evidence source when `--summary` is omitted.
- Verifies the work using the new evidence ID.
- Refreshes the work context/projection for the returned view so `work.status`, counts, and `contextSummary` describe the same post-finish state.
- With `--close`, requires a passed verdict and `--reason`, closes the work, then releases the active reservation so closed work does not keep stale ownership.
- With `--release`, releases the reservation after verification without closing.
- Rejects `--close --release` together.

## `agent start`

```bash
bwrk agent start [work-ref] [--agent <agent-id>] [--label <label>...] [--container <work-ref>] [--purpose <text>] [--expires-at <iso>|--ttl <duration>] [--query <text>] [--limit <n>] [--json]
```

Safe entrypoint for an agent before it starts work:

- Blocks with exit code `1` when the agent has expired active reservations; the response points at `bwrk doctor --fix`.
- Resumes the agent's existing active reservation before claiming more work.
- With no `work-ref`, atomically claims the next ready matching work only when the agent has no active work and has reservation capacity.
- With `work-ref`, resumes that exact work if already reserved by the agent, otherwise atomically claims that exact ready work when reservation capacity remains.
- `--container` restricts queue claims to the container and descendants; with `work-ref`, it validates the exact work item is inside that scope before reserving.
- Returns the selected work view, reservation, context pack, and handoff search results.
- If context/search handoff generation fails after a reservation is claimed or resumed, returns the reservation with `handoffComplete: false`, a warning, and `repairCommand: "bwrk doctor --fix --json"` instead of losing the successful claim behind an error.
- Returns `started: false` with `reason: "no_ready_work"` when no matching ready work exists.

`--limit` controls returned handoff search results, defaults to `8`, and is capped at `50`. Limit validation happens before resuming or claiming work so invalid input cannot create a reservation.

## `agent status`

```bash
bwrk agent status [--agent <agent-id>] [--label <label>...] [--view dashboard] [--json]
```

Summarizes an agent's coordination state. If `--agent` is omitted, the CLI actor ID is used. `--view dashboard` renders reservation, ready-work, and recommended-action sections.

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
bwrk session start [--id <session-id>] [--agent <agent-id>] [--label <label>...] [--json]
```

Starts the local agent protocol around a normalized session ID. If `--id` is omitted, the command uses `--session`, `BOREAL_SESSION_ID`, or generates a new `session-...` ID. The command logs itself under that same session ID and returns the same brief shape as `prime`.

Use the returned `commands.*` strings for the rest of the run so every operation is grouped under the same session.

## `session end`

```bash
bwrk session end [--id <session-id>] [--agent <agent-id>] [--label <label>...] [--json]
```

Summarizes the target session without deleting or closing records. The result reports operation totals, failed commands, state/artifact-changing command counts, sync health, current agent reservations, and recommended follow-up commands. When active reservations remain, the recommendations point at reservation review instead of pretending the session is clean.

## `operation list`

```bash
bwrk operation list [--session-id <id>] [--command <path>] [--status succeeded|failed|all] [--limit <n>] [--json]
```

Lists local command operation records newest first. Default `--limit` is `50`; max is `1000`. Filters are exact after normalization:

- `--session-id`: only operations from one session.
- `--command`: only one command path, for example `work create`.
- `--status`: `succeeded`, `failed`, or `all`.

JSON rows include operation ID, session ID, command path, status, exit code, state/artifact effect flags, actor ID, actor kind (`human`, `agent`, or `system`), timestamps, and event count.

## `operation show`

```bash
bwrk operation show <operation-id-or-prefix> [--json]
```

Shows one full local operation record, including redacted argv and generated event IDs. Prefixes must include at least 12 hex characters and be unambiguous.

## `operation stats`

```bash
bwrk operation stats [--session-id <id>] [--json]
```

Aggregates local operation records into totals, read/mutation ratio, per-command counts, failure clusters grouped by command and error code, and the longest consecutive identical failure run. The command is read-only and uses the operation log directly.

## `operation prune`

```bash
bwrk operation prune (--keep <n>|--before <iso>) [--json]
```

Prunes local operation history without changing exported project records. `--keep` keeps the newest N operations including the prune command's own operation record, so `bwrk operation prune --keep 500` leaves at most 500 operation records after the command finishes. `--before` deletes operations finished before the given ISO timestamp. When both flags are provided, the age filter is applied first and the remaining newest records are capped by `--keep`. The same command also prunes old spilled JSON result files under `.boreal/results`, skipping files inside the fresh-file grace window.

JSON `data` includes `deleted`, `keptBeforeOperationLog`, `remainingAfterOperationLog`, optional `keep`/`before`, `deletedIds`, and a `results` object describing removed result files.

## `operation repair`

```bash
bwrk operation repair [--dry-run] [--json]
```

Repairs local operation/event causality after upgrading older workspaces. The command backfills event `operationId` when exactly one retained operation references the event, repairs operation records that are missing a retained event reference, removes operation references to missing events, and marks events with no unambiguous retained operation as `operationLink: "legacy"`.

Use `--dry-run` to inspect the planned changes without applying repair writes. The command itself is still recorded in the local operation log.

JSON `data` includes inspected counts, linked event IDs, legacy-marked event IDs, repaired operation IDs, removed dangling/conflicting references, and ambiguous events.

## `evidence add`

```bash
bwrk evidence add <work-id> --summary <text> [--kind command|test|diff|review|artifact|note] [--outcome passed|failed|observed|unknown] [--command <cmd>] [--uri <uri>] [--json]
```

Records evidence against a work item and moves the work item to `needs_verification` unless it is already closed. Use `--kind artifact` for files or generated artifacts such as source maps; `document` is a source/raw kind, not an evidence kind. JSON output includes the created evidence record and `data.result`; inspect `closeoutGateStatus` through `work verify`, `summary compose`, or `summary show`. A passed `--kind review` record satisfies `review` gates and can satisfy `audit` gates; passed `command` and `artifact` evidence can also satisfy `audit` gates.

Example:

```bash
bwrk evidence add bw_work_... --summary "pnpm test passed" --kind test --outcome passed --command "pnpm test"
```

## `summary create`

```bash
bwrk summary create <work-ref|subject-id> --body <text> [--subject-type work|sprint|milestone|phase|project|session] [--kind task|sprint|milestone|phase|project|session|legacy_backfill] [--title <text>] [--status draft|final|forced] [--outcome completed|partial|deferred|duplicate|cancelled|blocked|no_change] [--evidence <id>...] [--verification <id>...] [--commit <sha>...] [--dirty-path <note>...] [--completed <work|title>|<title>|<outcome>|<notes>...] [--child-summary <id>...] [--parent-summary <id>] [--duplicate-of <id>] [--force-reason <code>] [--force-comment <text>] [--artifact-uri <uri>] [--no-render] [--json]
```

Creates a typed agent closeout summary. By default it writes a Markdown artifact under `memory://agent-summaries/` and links evidence, verification, commit SHAs, child summaries, and dirty-path notes into the record. JSON output includes `closeoutGateStatus` when the summary subject resolves to work, sprint, or milestone work.

Forced summaries require both `--force-reason` and `--force-comment`. Use forced summaries for documented bypasses such as duplicate closeout, legacy backfill, external closeout, or operator override.

## `summary compose`

```bash
bwrk summary compose <work-ref|subject-id> [--subject-type work|sprint|milestone|phase|project|session] [--kind task|sprint|milestone|phase|project|session|legacy_backfill] [--title <text>] [--status draft|final|forced] [--outcome completed|partial|deferred|duplicate|cancelled|blocked|no_change] [--evidence <id>...] [--verification <id>...] [--commit <sha>...] [--dirty-path <note>...] [--child-summary <id>...] [--parent-summary <id>] [--duplicate-of <id>] [--force-reason <code>] [--force-comment <text>] [--artifact-uri <uri>] [--no-render] [--json]
```

Builds the summary body from the current work item, evidence, verification, child dependency tree, closeout gate status, and prior summaries, then persists the same record shape as `summary create`. Generated Markdown includes a `Closeout Gates` section.

## `summary show`

```bash
bwrk summary show <summary-id|work-ref|subject-id> [--subject-type work|sprint|milestone|phase|project|session] [--json]
```

Shows an agent summary by summary ID, or the latest summary for a resolved subject. JSON output includes `closeoutGateStatus` when the summary subject resolves to work, sprint, or milestone work.

## `summary list`

```bash
bwrk summary list [--subject <work-ref|subject-id>] [--subject-type work|sprint|milestone|phase|project|session] [--limit <n>] [--json]
```

Lists agent summaries, newest first. Use `--subject` to inspect the summary chain for one task, sprint, phase, milestone, project, or session.

## `summary render`

```bash
bwrk summary render <summary-id> [--out <memory-uri-or-relative-path>] [--json]
```

Renders an existing agent summary to Markdown and updates the summary artifact URI.

## `summary backfill`

```bash
bwrk summary backfill [--closed-only|--all] [--limit <n>] [--json]
```

Creates `legacy_backfill` summaries for existing work items that do not already have summaries. The default is `--closed-only`.

## `work verify`

```bash
bwrk work verify <work-id> --evidence <evidence-id>... [--verdict passed|failed] [--notes <text>] [--json]
```

Creates a verification record. `--evidence` may be repeated. Verification fails if referenced evidence is not attached to the work item. A `passed` verdict requires at least one referenced evidence record with outcome `passed`. JSON output includes `closeoutGateStatus` so callers can see whether required review, audit, verification, or checkpoint gates are still open.

## `work close`

```bash
bwrk work close <work-id> --reason <text> [--agent-summary <id>...] [--force-summary --force-reason <code> --force-comment <text>] [--commit <sha>...] [--dirty-path <note>...] [--json]
```

Closes a work item. Runtime policy requires a passing verification before close, and the CLI ensures a final or forced agent summary exists for the work subject before calling the close path. If no summary is supplied or already exists, the command composes a final closeout summary automatically. When no `--commit` is provided, at least one `--dirty-path` value must start with a checkpoint reason code such as `no_repo_changes: ...`. JSON output is a `boreal.cli.work.close.v1` envelope with `work`, compact `agentSummaries` rows, and optional compact `createdAgentSummary` / `createdAgentSummaryArtifact`; use `summary show` for full summary body and checkpoint metadata.

## `work edit`

```bash
bwrk work edit <work-ref> [--title <text>] [--description <text>] [--kind issue|task|sprint|milestone] [--priority low|normal|high|critical] [--label <label>...] [--acceptance <text>...] [--required-gate verification|checkpoint|review|audit[:self|direct_children|descendants]... [--gate-command <command>...] [--gate-expect <text>...]|--clear-required-gates] [--force-gate <gate-id|kind[:scope]>... --force-gate-reason <code> --force-gate-comment <text>] [--force-gate-evidence <evidence-id>...] [--json]
```

Updates mutable work fields while preserving source refs, evidence IDs, verification IDs, dependencies, reservation history, and audit events. Repeated `--label` and `--acceptance` values replace those lists. Repeated `--required-gate` replaces required closeout gate metadata; `--clear-required-gates` removes it.

Use `--gate-command` and `--gate-expect` with repeated `--required-gate` values to replace declared command and observable metadata for the same-index required gate.

Use `--force-gate` for an audited bypass of an existing required gate, not as normal satisfaction. It accepts a gate id, kind, or `kind:scope`, requires `--force-gate-reason` and `--force-gate-comment`, and may attach support records with repeated `--force-gate-evidence`. Allowed force reason codes are `review_unavailable`, `audit_unavailable`, `external_review_record`, `legacy_backfill`, `user_accepted_risk`, and `emergency_closeout`. `--force-summary` does not force required review or audit gates.

## `work cancel`

```bash
bwrk work cancel <work-ref> --reason <text> [--agent-summary <id>...] [--force-summary --force-reason <code> --force-comment <text>] [--commit <sha>...] [--dirty-path <note>...] [--json]
```

Cancels open work only after ensuring a final or forced agent summary exists for the work subject. If no summary is supplied or already exists, the command composes a cancellation summary with outcome `cancelled`, renders its Markdown artifact, and returns a `boreal.cli.work.cancel.v1` envelope with `work`, compact `agentSummaries` rows, and optional compact `createdAgentSummary` / `createdAgentSummaryArtifact`. When no `--commit` is provided, at least one `--dirty-path` value must start with a checkpoint reason code such as `no_repo_changes: ...`. The command fails closed when the work has an active non-expired reservation.

## `work reopen`

```bash
bwrk work reopen <work-ref> [--ready] [--reason <text>] [--json]
```

Reopens closed or cancelled work by clearing closeout fields. Without `--ready`, the item returns to `draft`; with `--ready`, readiness is derived from current blockers.

## `work split`

```bash
bwrk work split <work-ref> --title <text> [--description <text>] [--priority low|normal|high|critical] [--label <label>...] [--acceptance <text>...] [--ready] [--json]
```

Creates a child task that inherits the parent source refs and labels, then blocks the parent on that child task. Use this when discovery finds an actionable subtask that must complete before the original work can close.

## `source add`

```bash
bwrk source add --title <text> --uri <uri> [--kind raw|document|chat|code|artifact] [--summary <text>] [--json]
```

Creates a knowledge source. Default `kind` is `document`.

JSON `data` is the full source record, including `meta.id`, `kind`, `title`, `uri`, and `summary`.

## `source list`

```bash
bwrk source list [--kind raw|document|chat|code|artifact] [--limit <n>] [--json]
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
bwrk claim create --statement <text> [--status proposed|accepted|rejected|stale] [--source <source-id>...] [--evidence <evidence-id>...] [--wiki <wiki-page-ref>...] [--json]
```

Creates a claim. `--source`, `--evidence`, and `--wiki` may be repeated. Referenced sources and evidence must already exist. `--wiki` accepts a wiki page ID, slug, title, or path and stores the canonical page reference in `wikiPageIds`.

JSON `data` is the full claim record, including `meta.id`, `statement`, `status`, `sourceIds`, `evidenceIds`, and `wikiPageIds`.

## `claim list`

```bash
bwrk claim list [--status proposed|accepted|rejected|stale] [--source <source-id>] [--limit <n>] [--json]
```

Lists claims, optionally filtered by status and source. Default `--limit` is `100`; max is `1000`.

JSON `data` is an array of rows with `id`, `status`, `statement`, `sources`, `sourceIds`, `sourceCount`, `evidence`, `evidenceIds`, `evidenceCount`, `wikiPages`, `wikiPageIds`, `wikiPageCount`, `reviewState`, and `updatedAt`.

## `claim show`

```bash
bwrk claim show <claim-id> [--json]
```

Shows one claim record.

JSON `data` is the full claim record.

## `claim review`

```bash
bwrk claim review <claim-id> --status proposed|accepted|rejected|stale [--source <source-id>...] [--evidence <evidence-id>...] [--wiki <page-ref>...] [--notes <text>] [--json]
```

Transitions a claim through review and appends source, evidence, and wiki coverage while preserving existing links. Referenced sources and evidence must exist; `--wiki` accepts page ID, slug, title, or path.

## `decision create`

```bash
bwrk decision create --title <text> --decision <text> [--context <text>] [--status proposed|accepted|superseded|rejected] [--consequence <text>...] [--source <source-id>...] [--wiki <wiki-page-ref>...] [--json]
```

Creates a decision record. `--consequence`, `--source`, and `--wiki` may be repeated. Referenced sources must already exist. `--wiki` accepts a wiki page ID, slug, title, or path and stores the canonical page reference in `wikiPageIds`.

JSON `data` is the full decision record, including `meta.id`, `title`, `status`, `context`, `decision`, `consequences`, `sourceIds`, and `wikiPageIds`.

## `decision list`

```bash
bwrk decision list [--status proposed|accepted|superseded|rejected] [--source <source-id>] [--limit <n>] [--json]
```

Lists decisions, optionally filtered by status and source. Default `--limit` is `100`; max is `1000`.

JSON `data` is an array of rows with `id`, `status`, `title`, `context`, `decision`, `consequences`, `consequenceCount`, `sources`, `sourceIds`, `sourceCount`, `wikiPages`, `wikiPageIds`, `wikiPageCount`, `reviewState`, `supersessionStatus`, and `updatedAt`.

## `decision show`

```bash
bwrk decision show <decision-id> [--json]
```

Shows one decision record.

JSON `data` is the full decision record.

## `decision supersede`

```bash
bwrk decision supersede <decision-id> --decision <text> [--title <text>] [--context <text>] [--consequence <text>...] [--source <source-id>...] [--wiki <page-ref>...] [--reason <text>] [--json]
```

Marks the prior decision `superseded` and creates an accepted replacement decision with inherited source and wiki coverage plus any additional links supplied on the command.

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
bwrk context search <query> [--limit <n>] [--explain] [--no-rebuild] [--json]
```

Searches context-pack summary documents and bounded context-chunk documents only. `--limit` is capped at `100`. The search index is rebuilt automatically when missing, malformed, or stale unless `--no-rebuild` is set.

JSON `data` is an array of search results with `id`, `type`, `recordId`, `subjectId`, `title`, `summary`, `score`, and `matches`. With `--explain`, each result also includes `explain.algorithm`, `queryTokens`, `scoreBreakdown`, and `fieldMatches`.

Search commands rebuild a missing, invalid, or stale local search index by default. Use `--no-rebuild` to preserve fail-closed behavior.

## `search index`

```bash
bwrk search index [--json]
```

Builds a deterministic local search index at `.boreal/runtime/search-index.json`. Rebuilds are serialized with `.boreal/runtime/search-index.lock` and use atomic fsync writes. The index stores compact weighted aggregate tokens, per-field tokens, document-frequency statistics, compact vector-lite weights, and result summaries for work, evidence, sources, claims, decisions, context packs, and bounded context chunks; it does not store full record bodies.

JSON `data` contains `path`, `schemaVersion`, `builtAt`, `contentHash`, `documentCount`, and `tokenCount`.

## `search query`

```bash
bwrk search query <query> [--limit <n>] [--explain] [--no-rebuild] [--json]
```

Searches work, evidence, sources, claims, decisions, context packs, and bounded context chunks. `--limit` is capped at `100`. Results are ranked by ID prefix matches, field-weighted token matches adjusted by document frequency, deterministic vector-lite similarity, and stable type/title ordering. Tokenization preserves compact tokens while adding camelCase, path/URI, underscore, and alpha-numeric split variants.

Use `--explain` to include the normalized query tokens, score contributions, document frequencies, IDF factors, vector similarity, and field-level matches that caused each result to rank.
Search commands rebuild a missing, invalid, or stale local search index by default. Use `--no-rebuild` to preserve fail-closed behavior.

With `--no-rebuild`, the command fails closed when the index is missing, malformed, or stale. Rebuild with `bwrk search index` or `bwrk doctor --fix`.

## `export json`

```bash
bwrk export json [--out <path>] [--json]
```

Builds a `boreal.export.v1` document containing the portable canonical runtime record set, record counts, and a deterministic content hash. Portable exports include work items, evidence, verifications, directive acknowledgements, knowledge sources, claims, decisions, graph edges, reservations, events, projections, and context packs. They exclude local operation records and strip event operation links before hashing, so command history from one checkout does not become imported project truth in another checkout.

Directive migration behavior is explicit: durable `directiveAcknowledgements` are exported as runtime state, while emitted `agentDirectives` bundles are only top-level transport metadata when a result spool intentionally includes them. A carried `agentDirectives` bundle is schema-validated but is not written into `state`, not counted in `recordCounts`, and not sufficient proof of acknowledgement without a durable acknowledgement record.

Without `--out`, the export document is printed. With `--out`, the file is written inside the workspace and JSON `data` contains `path`, `contentHash`, and `recordCounts`.

## `export markdown`

```bash
bwrk export markdown [--out <dir>] [--json]
```

Writes Git-friendly Markdown files for work, agent summaries, evidence, directive acknowledgements, reviewer heartbeats, sources, claims, decisions, and context packs. Each file includes flat frontmatter with stable IDs, status/kind fields, references, tags, and timestamps where available. Durable acknowledgement records render under `directive-acknowledgements/<acknowledgement-id>.md` with directive, registry, command, subject, outcome, proof-link, and reason metadata. Default output directory is `.boreal/exports/markdown`.

JSON `data` contains `outDir`, `files`, and `recordCounts`.

## `export ledgers`

```bash
bwrk export ledgers [--out <dir>] [--json]
```

Writes a `boreal.ledgers.v1` JSONL bridge for the same portable canonical runtime sections as `export json`: one `.jsonl` file per section, a `deletions.jsonl` tombstone ledger, and `manifest.json` with per-file counts, per-file content hashes, deleted-record counts, and the whole-ledger content hash. The directive acknowledgement section is written as `directive-acknowledgements.jsonl`. Ledgers are reconstructable collaboration artifacts, not a second hidden source of truth, and they exclude local operation records. Default output directory is `.boreal/ledgers`.

JSON `data` contains `outDir`, `manifestPath`, `contentHash`, `recordCounts`, `deletedRecordCounts`, `files`, and `deletions`.

## `import json`

```bash
bwrk import json --from <path> [--allow-external-read] [--json]
```

Imports a `boreal.export.v1` document or raw `boreal.file-store.v1` state document. Import validates required sections and references before writing, normalizes imported event operation links away, and never imports operation records from the source file. Existing records with identical IDs and identical content are skipped. Existing records with identical IDs and different content are rejected as conflicts.

Directive acknowledgement records import only as durable runtime records with valid links. Import rejects acknowledgement records that point at missing evidence, verification, summaries, artifact URIs, handoffs, or work subjects. If the export carries a top-level `agentDirectives` bundle, import validates directive references against that carrier; the bundle itself remains transport metadata and is not added to runtime state. Historical closeout summaries without acknowledgement records import as legacy-compatible records and are classified by doctor/report surfaces instead of being silently modernized.

By default, `--from` must resolve inside the workspace, including after symlink resolution. Use `--allow-external-read` for an intentional external file import.

JSON `data` contains per-section `imported` and `skipped` counts.

## `import ledgers`

```bash
bwrk import ledgers --from <dir> [--allow-external-read] [--json]
```

Imports a `boreal.ledgers.v1` directory. The importer reads `manifest.json`, verifies every JSONL file and `deletions.jsonl` count/content hash, reconstructs the portable snapshot, rejects tombstones that conflict with live records, validates record schemas and references, then merges records with the same conflict rules as `import json`.

Directive acknowledgement ledger rows follow the same link validation as `import json`. A ledger import can preserve durable acknowledgements and legacy-only closeout facts, but it must not fabricate acknowledgements from legacy summaries.

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

## `raw list`

```bash
bwrk raw list [--limit <n>] [--json]
```

Lists immutable raw source records from the configured vault raw index. Rows include source kind, summary, URI, tags, content hash, derived processing status, linked wiki page count, and retrieval commands.

Processing status is derived from source-backed wiki links: raw sources referenced by at least one wiki page are `linked`; otherwise they remain `queued`.

## `raw show`

```bash
bwrk raw show <raw-id> [--preview-bytes <n>] [--json]
```

Shows one immutable raw source record with linked wiki pages, retrieval commands, and a bounded local asset preview. Local previews are restricted to the workspace or configured memory root. External URIs are not fetched, missing files are reported as missing, directories and binary assets are reported as unsupported, and large text assets are truncated to `--preview-bytes`.

JSON `data.preview` contains `status`, `mediaType`, `message`, `maxBytes`, `truncated`, and optional `path`, `body`, `bytes`, and `totalBytes`.

## `wiki create`

```bash
bwrk wiki create <title> [--slug <slug>] [--summary <text>] [--source <raw-id>...] [--tag <tag>...] [--json]
```

Creates a Markdown wiki page under the configured vault wiki directory with flat Boreal frontmatter. Existing page slugs are never overwritten. Slug existence checks and writes are serialized with a vault wiki lock under `.boreal/locks/`. Use `--source` to link the page to raw source records from the configured raw index.

JSON `data` contains `created`, `path`, and the created `page` summary.

## `wiki list`

```bash
bwrk wiki list [--limit <n>] [--json]
```

Lists structured wiki page records from the configured vault wiki directory. Rows include ID, slug, title, path, source refs, outbound links, accepted/draft/proposed truth status, source ref count, backlink count, outbound link count, and a show command.

Default `--limit` is `100`; max is `1000`.

## `wiki show`

```bash
bwrk wiki show <wiki-id|slug|title> [--json]
```

Shows one structured wiki page record with source refs, outbound links, matched outbound pages, missing outbound link targets, backlinks, and accepted/draft/proposed truth status.

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
bwrk sync status [--view dashboard] [--json]
```

Checks collaboration readiness without mutating state. The command combines repo-local memory vault readiness and content health, JSONL ledger freshness, generated search-index freshness, and Git worktree safety so agents can see whether the workspace is ready to share and query from one place. `--view dashboard` renders grouped checks and recommended actions.

JSON `data` contains `ok`, `workspaceRoot`, `checkedAt`, `vault`, `ledgers`, `searchIndex`, `git`, and `recommendedActions`. It exits `1` when the memory vault is missing/incomplete, when ledgers are missing/stale/invalid, when the local search index is missing/stale/invalid, or when `.boreal/ledgers` or `memory` paths are dirty on a protected branch or detached HEAD. Protected branches default to `main`, `master`, and `trunk`; set `BOREAL_PROTECTED_BRANCHES` to a comma-separated list to override. Recommended repairs are specific commands such as `bwrk vault init --json`, `bwrk sync refresh --json`, and `git switch -c boreal/sync-work`.

## `sync refresh`

```bash
bwrk sync refresh [--strict] [--json]
```

Refreshes generated collaboration artifacts in one closeout command: context-pack projections, the local search index, the JSONL ledger export, and the optional SQLite generated cache at `.boreal/cache/runtime-cache.sqlite`. It then returns the same status shape as `sync status` under `data.status`. Snapshot creation remains explicit through `bwrk snapshot create --json` because snapshots are named baselines, not routine cache refreshes.

JSON `data` contains `refreshed`, `refreshOk`, `postRefreshStatusOk`, `exitReason`, `contextViews`, `searchIndex`, `ledgers`, `sqliteCache`, and `status`. `refreshOk: true` means projections, search, ledger export, and the cache rebuild path completed. If `sqlite3` is unavailable, `sqliteCache.skipped` is `true` and file-store behavior remains supported. `postRefreshStatusOk` mirrors nested `status.ok` after the rebuild. `exitReason` is `ok` when post-refresh status is healthy, or `post_refresh_status_unhealthy` when the refresh completed but the final health gate still failed.

By default the command exits `0` when the refresh itself succeeds, even if `postRefreshStatusOk` is false. Pass `--strict` to restore status-based exit semantics and exit `1` when the post-refresh sync status is still not clean, for example because the vault is missing or Git collaboration paths are dirty on a protected branch. Agents should treat `exitReason: post_refresh_status_unhealthy` as partial success: generated artifacts were refreshed, but the nested `status` object and `recommendedActions` describe the remaining repair.

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

Creates a recovery snapshot under `.boreal/snapshots`. Snapshot files are named `boreal.export.v1` baselines with content hashes. They are explicit recovery/checkpoint artifacts, so `sync refresh` does not create them automatically.

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
bwrk doctor [--fix] [--strict] [--view dashboard] [--json]
```

Validates workspace health. `--view dashboard` renders a grouped diagnostic dashboard while leaving JSON and default line output unchanged.

Checks:

- `.boreal` and runtime state presence.
- Runtime state JSON parse and schema version.
- Project setup and environment manifest drift: config root mismatch, configured memory root presence, expected memory Git repository boundary, target-specific skill install roots, resolved workflow asset roots, project/memory `.gitignore` guards, child memory accidentally tracked by the project Git index, child submodule `.gitmodules` metadata, and the required submodule gitlink.
- Integrated schema validation for all persisted runtime state sections and runtime policy payloads.
- Required state sections.
- Missing IDs and duplicate IDs within each state section.
- Malformed work, evidence, verification, source, claim, decision, context-pack, graph, and reservation records.
- Dangling work dependencies, evidence references, and verification references.
- Dangling knowledge source, claim evidence, and claim/decision wiki page references.
- Source-backed claims and decisions without wiki coverage, plus stale source-backed claims.
- Accepted claim contradictions, superseded decisions that need replacement review, and raw sources waiting for memory reconciliation. These diagnostics include workflow references plus separate safe recheck commands and manual review commands.
- Duplicate graph edges, dangling work graph edges, graph/dependency disagreement, and dependency cycles.
- Reservation consistency, including active reservations for terminal work, work ownership pointers, and legacy `reserved` work without active reservations.
- Expired active reservations.
- Verification policy drift, including passed verifications without passed evidence.
- Closed work items without close reasons.
- Agent summary closeout coverage for terminal work, directive acknowledgement coverage for current-policy closeout summaries, legacy-compatible directive closeout classification, checkpoint commit/dirty-path coverage, Markdown artifact URI coverage, and forced summaries without a reason code or human comment.
- Unsafe Unicode in machine-facing strings.
- Label and actor normalization collisions in imported or hand-edited state.
- Local operation log shape, volume, legacy operation-event links, dangling event references, and retained operation/event causality.
- Repo-local `memory/` vault scaffold presence, path types, raw source JSONL, wiki links, source references, orphan pages, and stale claims.
- Derived readiness consistency.
- Missing or stale context-pack projections.
- Snapshot/export drift between the current export hash and the latest recovery snapshot.
- Missing, malformed, or stale local search index.
- SQLite generated cache freshness when a cache file exists.
- Runtime state and search-index lock state.
- Git collaboration safety across the project repository and any separate child/sibling memory repository. Generated artifact and raw-index caveats are advisory; blocking dirty paths on detached HEAD or uninspectable Git status remain warnings that fail strict mode.

Directive migration diagnostics are split deliberately. `summary.directive_coverage` reports current-policy closeout summaries without durable acknowledgement proof. `summary.legacy_directive_compatibility` reports closeout summaries that predate directive acknowledgement policy or are explicitly marked through `legacy_backfill`. Legacy checkpoint, artifact, and closeout summary diagnostics remain separate so operators can tell missing proof from accepted historical state.

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

`--fix` does not create a submodule gitlink, remove child memory from the project Git index, or delete stale non-submodule `.gitmodules` entries. Those are reported with exact Git details so a human can decide whether to run commands such as `git submodule add <remote> memory` or `git rm -r --cached -- memory`.

`--strict` treats operationally blocking warnings as a failing doctor result for CI and hardening gates. Advisory warnings such as stopped/stale daemon status, install status caveats, generated artifact drift, SQLite cache drift, search-index rebuild guidance, current directive-acknowledgement coverage gaps, and legacy agent-summary coverage gaps are surfaced without failing strict mode unless they are paired with an error or a blocking Git finding. Diagnostic severities are not rewritten; JSON `data.ok` and the command exit code reflect the strict gate result.

Without `--strict`, doctor exits `1` when any diagnostic has severity `error`.

Package script:

```bash
pnpm doctor:strict
```

Runs `bwrk doctor --workspace . --strict --json` from the repository root.

## `doctor skills`

```bash
bwrk doctor skills [--install-root <dir>] [--skill-target codex|claude|skills...] [--json]
```

Validates the checked-in workflow, template, and skill source files without requiring an initialized workspace. It checks duplicate workflow IDs, workflow command references, workflow template references, and skill workflow references. Skill `boreal.yaml` files and `SKILL.md` workflow lists must use canonical workflow IDs that `bwrk workflows show <ref>` accepts verbatim.

With `--skill-target` or `--install-root`, it also validates installed skill roots against the checked-in assets. The installed-root check detects missing files such as `boreal.yaml`, stale `SKILL.md` content, missing workflow resolver guidance, noncanonical or unknown workflow refs, and Claude installs that accidentally contain Codex `agents/openai.yaml` metadata. If `--install-root` is omitted, configured project setup roots are used where possible.

## `schema validate`

```bash
bwrk schema validate [--json]
```

Validates current runtime records against the published schema contracts and checks command behavior metadata consistency. It exits nonzero when persisted records or command metadata drift from the published contracts.

## `docs check`

```bash
bwrk docs check [--json]
```

Checks workflow, template, skill, and command documentation assets from the resolved workflow asset root. The payload includes workflow asset counts, asset issues, and command metadata validation status. Skill frontmatter uses standards-compatible YAML scalars; values containing `: ` must be quoted. Workflow and skill Markdown references to machine-readable `data.*` extraction paths are validated against the known JSON envelope paths so stale automation instructions fail the docs gate.

## `gate`

```bash
bwrk gate [--strict] [--no-auto-prune-operations] [--json]
```

Golden-path alias for `bwrk gate closeout`. Use it as a compact final gate before closing work or handing off.

## `gate closeout`

```bash
bwrk gate closeout [--strict] [--no-auto-prune-operations] [--json]
```

Runs the closeout sequence: `sync refresh`, `doctor`, `schema validate`, and `docs check`. JSON `data.ok` is true only when all nested checks pass; `--strict` makes doctor warnings fail the gate.

When `--strict` is set and the only strict gate blocker is the `operation.volume` doctor warning, the gate prunes local operation history to the recommended keep target by default, refreshes generated state again, and reruns the closeout checks. The JSON payload includes `autoPruneOperations: true` and an `operationPrune` result when pruning ran. Pass `--no-auto-prune-operations` to disable this maintenance step and preserve the hard operation-volume block.

## `lock inspect`

```bash
bwrk lock inspect [--view dashboard] [--json]
```

Inspects runtime locks, including `.boreal/runtime/state.lock` and `.boreal/runtime/search-index.lock`. `--view dashboard` renders lock state, owner, age, stale reason, and repair action sections.

JSON `data` shape:

```json
{
  "schemaVersion": "boreal.cli.lock-inspect.v1",
  "ok": true,
  "locks": [
    {
      "name": "state",
      "diagnosticCode": "lock.absent",
      "status": "absent",
      "inspection": {
        "exists": false,
        "stale": false,
        "lockDir": "/absolute/path/.boreal/runtime/state.lock"
      }
    },
    {
      "name": "searchIndex",
      "diagnosticCode": "lock.search_index.absent",
      "status": "absent",
      "inspection": {
        "exists": false,
        "stale": false,
        "lockDir": "/absolute/path/.boreal/runtime/search-index.lock"
      }
    }
  ],
  "state": {
    "exists": false,
    "stale": false,
    "lockDir": "/absolute/path/.boreal/runtime/state.lock"
  },
  "searchIndex": {
    "exists": false,
    "stale": false,
    "lockDir": "/absolute/path/.boreal/runtime/search-index.lock"
  },
  "exists": false,
  "stale": false,
  "lockDir": "/absolute/path/.boreal/runtime/state.lock"
}
```

The top-level `exists`, `stale`, and `lockDir` fields mirror `state` for compatibility with earlier callers.

## `lock break`

```bash
bwrk lock break [--stale-only] [--json]
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
