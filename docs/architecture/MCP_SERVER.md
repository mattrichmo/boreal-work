# MCP Server

`apps/mcp` provides a project-scoped stdio MCP server for local clients.

The server is intentionally scoped to one Boreal project. Launch it from this repository with an explicit workspace root:

```bash
pnpm build
node apps/mcp/dist/index.js --workspace /absolute/path/to/boreal-work
```

For local development, the root script builds and launches the package from `apps/mcp`:

```bash
pnpm mcp:dev
```

## Local Config

MCP client config should live in the client, but Boreal can also keep a local project-scoped marker at `.boreal/mcp.json` so `bwrk doctor --strict` can detect copied or unscoped configuration:

```json
{
  "schemaVersion": "boreal.mcp-config.v1",
  "workspaceRoot": "/absolute/path/to/boreal-work",
  "projectRoot": "/absolute/path/to/boreal-work",
  "memoryRoot": "/absolute/path/to/boreal-work/memory",
  "memoryLayout": "in-repo",
  "command": "node",
  "args": ["apps/mcp/dist/index.js", "--workspace", "."]
}
```

`.boreal/mcp.json` is local-only because it contains machine paths. It is ignored by the project Git guards and should not be shared across repositories.

## Tool Surface

Read tools:

- `boreal_command_catalog`
- `boreal_workspace_status`
- `boreal_directives_current`
- `boreal_directives_compile`
- `boreal_directives_explain`
- `boreal_work_next`
- `boreal_work_show`
- `boreal_work_context`
- `boreal_search`
- `boreal_workflows_list`

Mutating tools:

- `boreal_work_claim`
- `boreal_work_reserve`
- `boreal_work_release`
- `boreal_work_renew`
- `boreal_agent_finish`
- `boreal_sync_refresh`

Every tool binds the request through the shared MCP boundary guard. Read tools return bounded structured JSON. Mutating tools require `confirmed: true`, execute an exact scoped `bwrk --workspace <project-root> ... --json` command, stamp a unique MCP session ID, and return the resulting operation ID from `bwrk operation list --session-id <id>`.

Directive tools are read-only bridges over the same CLI directive contracts. `boreal_directives_current` preserves the command envelope's `agentDirectives` bundle for a selected work, sprint, phase, or milestone ID and summarizes directive, conflict, deprecation, and missing-required counts. `boreal_directives_compile` and `boreal_directives_explain` wrap `bwrk directives compile` and `bwrk directives explain` for fixture or typed-subject debugging without reimplementing directive selection inside MCP.

## Doctor Drift Check

`bwrk doctor` reports `mcp.config`:

- `ok` when no local config is present.
- `ok` when `.boreal/mcp.json` exists and scopes `workspaceRoot`, `projectRoot`, `memoryRoot`, and `args --workspace` to this project.
- `warning` when a copied config points at another project, lacks a scoped `--workspace`, uses the wrong schema version, or fails the shared MCP root-boundary guard.

Strict doctor treats that warning as a failing result, which is the intended CI/local closeout behavior before enabling MCP access.
