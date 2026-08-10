# CLI TUI Runtime Boundary

## Decision

Boreal should keep `apps/cli` dependency-light for v1 and use render-only primitives in `apps/cli/src/cli-ui.ts` for installer prompts, health summaries, queues, and other opt-in rich terminal views.

Do not adopt Ink in `apps/cli` for v1. `apps/tui` is the separate ownership boundary for the optional Ink/React terminal app, which is now implemented independently from the CLI command runtime.

## Why

Dependency cost:

- The CLI is the machine-facing surface for agents, scripts, CI, and future MCP integrations.
- Adding a React/Ink runtime to the core CLI would increase install weight and terminal lifecycle surface before the dashboard contracts are stable.
- The current primitives are plain TypeScript functions and can be tested without a TTY.

Testability:

- Render-only primitives can be snapshot-tested as strings.
- Prompt behavior can be tested with fake input/output streams.
- JSON and plain text output remain separate from rich dashboard rendering.

Terminal cleanup:

- `apps/cli` should only use raw mode in narrow prompt sessions.
- Prompt sessions must restore raw mode and cursor state on normal completion and errors.
- More complex rendering loops, focus management, and subscriptions belong in `apps/tui`, not ordinary `bwrk` commands.

JSON/plain separation:

- Every command must keep stable JSON output for automation.
- Plain text output should remain deterministic and line-oriented.
- Rich views must be opt-in through explicit flags or dedicated interactive commands.

Ownership:

- `apps/cli`: command registry, strict JSON/plain contracts, small prompt and render primitives.
- `packages/ui-model`: shared typed data contracts for CLI dashboard, console, TUI, and MCP.
- `apps/tui`: optional full-screen Ink/React terminal app over the shared view-model and command-descriptor contracts.
- `apps/console`: browser dashboard using the same `packages/ui-model` contracts.

## Revisit Trigger

Revisit the TUI runtime or its contract boundary when at least two of these are true:

- The CLI dashboard needs persistent full-screen state rather than short command output.
- Multiple views require keyboard focus, nested panels, async refresh, or background subscriptions.
- Snapshot-tested string primitives become harder to maintain than a component runtime.
- `apps/tui` has a clear package boundary and does not affect ordinary `bwrk --json` or plain text command startup.

## TUI Expansion Conditions

The current Ink implementation remains isolated under `apps/tui`. Any further TUI expansion must:

- Add it only under `apps/tui`, not `apps/cli`.
- Keep `packages/ui-model` as the data contract source.
- Add terminal lifecycle tests for raw mode, cursor restoration, Ctrl-C, resize, and render teardown.
- Add fixture-driven view tests for global dashboard, sprint board, health, queues, and installer review screens.
- Keep JSON/plain command output independent from TUI rendering.

## V1 Path

For CLI-level v1 output, continue with:

- `statusIcon`
- `shortcutHint`
- `section`
- `keyValueRows`
- `resultSummary`
- `stepper`
- `choiceList`

These primitives cover the immediate installer and dashboard needs without changing the dependency posture of the CLI.

The optional TUI can evolve separately over the same contracts. Its current v1 scope is the global overview/projects/queues routes, repo roll-up and sprint board routes, and task-detail drill-down; unsupported rail routes remain explicit planned placeholders.
