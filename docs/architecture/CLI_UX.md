# CLI UX And Dashboard Direction

Reference checked: `claude-code-sourcemap-main`, an ignored local research artifact restored from the public Claude Code npm package sourcemap. Its license is all-rights-reserved, so Boreal must not copy implementation code. The useful takeaways are interface conventions and architecture shape only.

## Design Boundary

Boreal has three CLI UX layers, ordered by priority:

- JSON UI: stable machine envelopes for agents, scripts, CI, MCP, and future package integrations.
- Plain text UI: deterministic, line-oriented human-readable output that is still easy for agents to parse.
- Optional dashboard UI: richer read-only or guided command views for `doctor`, `status`, queues, reservations, sync, workflows, and installers.

The dashboard layer must never replace JSON or stable plain text. It should be opt-in through an explicit flag such as `--view dashboard`, `--interactive`, or a dedicated command whose purpose is already interactive. Prompt and dashboard code should stay dependency-free and easy to audit at first, but it should use shared primitives instead of one-off string formatting in each command.

## Adapted Conventions

- Split interactive views from noninteractive command contracts. Every dashboard command still needs JSON, stable plain text, and fail-closed automation behavior.
- Do not auto-switch ordinary commands into dashboards just because stdout is a TTY; explicit opt-in is safer for agents that run inside pseudo-terminals.
- Use named status primitives: `success`, `error`, `warning`, `info`, `pending`, and `loading`.
- Show keyboard hints consistently at the bottom of interactive views: navigation, selection, confirm, cancel, expand, and back.
- Prefer wizard steps for setup flows that have state and validation, with visible step numbers and a final review before writes.
- Keep descriptions near the active option instead of forcing the user to infer consequences from terse labels.
- Make long lists windowed and stable so navigation does not resize the terminal view.
- Separate install detection from install mutation. The command should first report what it detected, then what it will write, then the final result.
- Surface cleanup or PATH issues as setup notes, not as hard failures when the core install succeeded.
- Treat lock conflicts as first-class user messages with the owning path, stale/fresh status, and exact repair command.
- Keep command registry metadata as the source for help, docs, JSON behavior, and dashboard routing.

## Boreal Primitives To Build

The next shared CLI module should expose render-only primitives that work without adopting a full React/Ink runtime:

- `statusIcon(status)`: stable ASCII/Unicode-aware status markers with no color requirement.
- `shortcutHint(shortcut, action)`: consistent footer hints.
- `section(title, rows)`: compact grouped output for doctor/status dashboards.
- `keyValueRows(rows)`: aligned labels for config, paths, versions, and workspace details.
- `resultSummary(result)`: one-line success/warning/error summary with follow-up command.
- `stepper(steps)`: setup and installer progress states.
- `choiceList(options)`: shared select/multiselect rendering with active descriptions and windowing.

These should live near `apps/cli/src/cli-ui.ts` until there is enough surface area to justify a small `packages/cli-ui` package.

## Dashboard Candidates

V1 should prioritize dashboards where clarity prevents mistakes:

- `bwrk init --interactive`: wizard review, cancel/back, path preview, explicit write plan.
- `bwrk doctor --view dashboard`: grouped health dashboard with fixable versus manual issues and exact repair commands.
- `bwrk sync status --view dashboard`: collaboration health across Git, ledgers, search cache, vault, and locks.
- `bwrk agent status --view dashboard`: active reservation, TTL, current work, stale ownership, and next command.
- `bwrk work next --view dashboard`: ready queue with blockers, priority, owner, and claim command preview.
- `bwrk workflows list --interactive`: workflow picker with allowed commands and templates.
- `bwrk install codex|claude|skills --interactive`: plan-first installer with target roots, files to write, existing files, and setup notes.

## Implementation Rules

- Do not import or copy code from the Claude reference.
- Keep Boreal output deterministic enough for tests; snapshot the rendered primitives.
- Keep JSON mode and stable plain text separate from optional dashboard rendering.
- Interactive commands must detect non-TTY input and offer equivalent flags.
- Ctrl-C, cancel, and thrown errors must always restore terminal raw mode and cursor state.
- Dashboards should read runtime/view-model data; domain decisions stay in engine packages.
