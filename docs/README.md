# Boreal Documentation

The complete map of Boreal documentation. Start with the guides, drop into the reference and architecture docs as needed.

← [Documentation home](index.md) · [project README](../README.md) (repo).

## Guides

| Doc | Read it for |
| --- | --- |
| [Getting started](getting-started.md) | Install, initialize a workspace, and run your first work loop. |
| [Concepts](concepts.md) | The mental model: work, evidence, knowledge, context, memory, agents. |

## CLI reference

| Doc | Read it for |
| --- | --- |
| [CLI commands](cli/COMMANDS.md) | The complete `bwrk` command contract — every group, flag, and JSON envelope. |

## Architecture

| Doc | Read it for |
| --- | --- |
| [Runtime architecture](architecture/RUNTIME.md) | Ports, pure domain operations, and the `@boreal/engine` boundary. |
| [CLI UX](architecture/CLI_UX.md) | The JSON / plain-text / dashboard layering and its design boundary. |
| [CLI ↔ TUI runtime boundary](architecture/CLI_TUI_RUNTIME_BOUNDARY.md) | How terminal surfaces share the runtime. |
| [Skills & workflows](architecture/SKILLS_AND_WORKFLOWS.md) | Workflows (canonical), skills (adapters), and templates (output shapes). |
| [Project setup](architecture/PROJECT_SETUP.md) | Project, memory, and install roots, and supported layouts. |
| [MCP server](architecture/MCP_SERVER.md) | The project-scoped stdio MCP server in `apps/mcp`. |
| [MCP ↔ daemon boundary](architecture/MCP_DAEMON_BOUNDARY.md) | The shared boundary guard between MCP and the daemon. |
| [Daemon](architecture/DAEMON.md) | The observer/coordinator daemon in `apps/daemon`. |
| [Console app](architecture/CONSOLE_APP.md) | The local browser dashboard in `apps/console`. |
| [Dashboard command contracts](architecture/DASHBOARD_COMMAND_CONTRACTS.md) | The data contracts behind dashboard views. |
| [Design system tokens](architecture/DESIGN_SYSTEM_TOKENS.md) | Shared visual tokens for console/TUI surfaces. |
| [Component import plan](architecture/COMPONENT_IMPORT_PLAN.md) | UI component sourcing plan. |
| [Component copy audit](architecture/COMPONENT_COPY_AUDIT.md) | Licensing/copy audit for imported components. |
| [Agent E2E fixture](architecture/AGENT_E2E_FIXTURE.md) | The ordered local agent path exercised by the E2E test. |
| [Git health hardening](architecture/GIT_HEALTH_HARDENING.md) | Git-level health checks and hardening. |
| [JSONL merge driver](architecture/JSONL_MERGE_DRIVER.md) | Conflict-friendly merging of append-style ledgers. |
| [Hardening status](architecture/HARDENING_STATUS.md) | Running status of hardening work. |
| [Live E2E results (2026-06-26)](architecture/LIVE_E2E_RESULTS_HARDENING_2026-06-26.md) | A captured live end-to-end hardening run. |

## Product

| Doc | Read it for |
| --- | --- |
| [V1 closeout & adoption guide](product/V1_CLOSEOUT_ADOPTION_GUIDE.md) | Where v1 landed and how to adopt it. |
| [V1 workflows](product/V1_WORKFLOWS.md) | The canonical v1 workflow set. |
| [V1 remainder baseline](product/V1_REMAINDER_BASELINE.md) | The v1 remainder tracker baseline. |

## Elsewhere in the repo

- [`workflows/`](../workflows/README.md) — canonical agent procedures (source of truth).
- [`templates/`](../templates/README.md) — output shapes for workflow artifacts.
- [`schemas/`](../schemas/README.md) — record, event, projection, and policy schemas.
