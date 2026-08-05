# Boreal Documentation

Use this index to move from installation and first use into the CLI reference, architecture contracts, and release guidance.

← [Documentation home](index.md) · [Project README](../README.md)

## Guides

| Document | Read it for |
| --- | --- |
| [Getting started](getting-started.md) | Install Boreal, initialize a workspace, and run a first work loop. |
| [Concepts](concepts.md) | The mental model for work, evidence, knowledge, context, memory, and agents. |
| [Release and publishing](release/publishing.md) | Package preparation, smoke tests, and npm/Homebrew release steps. |
| [Security and release boundary](security/RELEASE_BOUNDARY_AUDIT.md) | Secret scanning, dependency provenance, ignored local data, and release checks. |

## CLI reference

| Document | Read it for |
| --- | --- |
| [CLI commands](cli/COMMANDS.md) | The complete `bwrk` command contract, flags, and JSON envelopes. |

## Architecture

| Document | Read it for |
| --- | --- |
| [Runtime architecture](architecture/RUNTIME.md) | Ports, domain operations, storage, locks, and generated artifacts. |
| [Long-running tasks](architecture/LONG_RUNNING_TASKS.md) | Durable runs, checkpoints, waits, retries, workers, and event cursors. |
| [Evidence trust](architecture/EVIDENCE_TRUST.md) | Trust levels, provenance, revisions, hashes, and verification behavior. |
| [Compatibility policy](architecture/COMPATIBILITY_POLICY.md) | SemVer, supported storage versions, migration, and rollback. |
| [CLI UX](architecture/CLI_UX.md) | JSON, plain-text, and optional dashboard interaction layers. |
| [CLI and TUI runtime boundary](architecture/CLI_TUI_RUNTIME_BOUNDARY.md) | How terminal surfaces share runtime contracts. |
| [TUI surface contracts](architecture/TUI_SURFACE_CONTRACTS.md) | Global and repository terminal UI pages, flows, and data shapes. |
| [Skills and workflows](architecture/SKILLS_AND_WORKFLOWS.md) | Canonical workflows, skill adapters, and templates. |
| [Project setup](architecture/PROJECT_SETUP.md) | Project, memory, and install roots and supported layouts. |
| [Originality and attribution](architecture/PRIOR_ART_ORIGINALITY.md) | Category boundaries, independent implementation, and attribution rules. |
| [Agent directives](architecture/AGENT_DIRECTIVES.md) | Typed runtime guidance generated from enforcement gaps. |
| [MCP server](architecture/MCP_SERVER.md) | The project-scoped stdio MCP server. |
| [MCP and daemon boundary](architecture/MCP_DAEMON_BOUNDARY.md) | Request binding and filesystem safety for adapters. |
| [Daemon](architecture/DAEMON.md) | The project-scoped observer and status surface. |
| [Console app](architecture/CONSOLE_APP.md) | The local browser dashboard and its data modes. |
| [Dashboard command contracts](architecture/DASHBOARD_COMMAND_CONTRACTS.md) | JSON contracts behind dashboard views. |
| [Design system tokens](architecture/DESIGN_SYSTEM_TOKENS.md) | Shared console and TUI visual tokens. |
| [Component inventory](architecture/COMPONENT_IMPORT_PLAN.md) | The typed console component inventory and package boundaries. |
| [Component language rules](architecture/COMPONENT_COPY_AUDIT.md) | UI copy, command labels, and attribution rules. |
| [Git health](architecture/GIT_HEALTH_HARDENING.md) | Git status classification and generated-artifact handling. |
| [JSONL merge driver](architecture/JSONL_MERGE_DRIVER.md) | Conflict-friendly merging of append-style ledgers. |
| [Storage and collaboration direction](architecture/V2_STORAGE_COLLABORATION_PLAN.md) | Current storage boundaries and future collaboration constraints. |

## Product

| Document | Read it for |
| --- | --- |
| [Product contract](product/PRODUCT_CONTRACT.md) | Boreal's product wedge, invariants, capability profiles, and non-goals. |
| [Global manager design](product/GLOBAL_MANAGER_DESIGN.md) | Cross-project registry, rollups, capture, and dashboard direction. |
| [V1 workflows](product/V1_WORKFLOWS.md) | The canonical workflow set for the current product line. |

## Elsewhere in the repository

- [`workflows/`](../workflows/README.md) — canonical agent procedures.
- [`templates/`](../templates/README.md) — output shapes for workflow artifacts.
- [`schemas/`](../schemas/README.md) — record, event, projection, and policy schemas.
- [`skills/`](../skills/) — thin adapters that point agents at canonical workflows.
