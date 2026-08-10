# MCP And Daemon Boundary

The MCP and daemon adapters share the project-boundary guard described here. Both surfaces are project-scoped and command-mediated.

MCP and daemon surfaces must bind every request to exactly one Boreal project before exposing runtime, memory, or generated artifact data. Global project discovery can list registered project identity, but it must not read another project's runtime or memory roots unless the request explicitly selects that project.

## Request Binding

Each request must resolve a project boundary with `bindMcpProjectBoundary()` from `@boreal/core`.

Required inputs:

- `workspaceRoot`: the root the request will execute against.
- `projectRoot`: the selected Boreal project root.
- `memoryRoot`: the selected Boreal memory vault root.
- `memoryLayout`: `in-repo`, `child`, or `sibling` when known.
- `selectedProjectId`: required when the request intentionally targets a registered project other than the adapter's current project.
- `registryEntries`: the machine-local project registry rows available to the adapter.

Binding rules:

- `workspaceRoot` and `projectRoot` must resolve to the same project for the request.
- A `selectedProjectId` must exist in the registry, and the request roots must match that row's `projectRoot` and `memoryRoot`.
- Without `selectedProjectId`, the request is bound only to the current workspace project.
- `memoryRoot` must be distinct from `projectRoot`.
- `in-repo` and `child` memory roots must be inside the selected project root.
- `sibling` memory roots must share the selected project root's parent directory.

After binding, every filesystem-backed resource path must pass `assertMcpResourcePathAllowed(boundary, path)`. The path must be inside the selected project root or selected memory root and must not be inside any unselected registered project's project or memory root.

Filesystem-backed resources that dereference local paths must also pass `assertMcpResourceRealPathAllowed(boundary, path)`. This catches symlinks and existing-path traversal where a lexical path is under the selected memory root but resolves outside the selected project or into another registered project.

## Exposed Resources

The implemented resource-kind contract is `MCP_EXPOSED_RESOURCE_KINDS`:

| Resource kind | Scope | Backing data | Rules |
| --- | --- | --- | --- |
| `command-catalog` | Global read-only | `COMMAND_DEFINITIONS` metadata | No workspace state or memory reads. |
| `workspace-status` | Selected project | `doctor`, `sync status`, lock status | Must include selected `workspaceRoot`. |
| `work-context` | Selected project | work/context/search projections | Must not mix rows from multiple projects in one resource. |
| `search-query` | Selected project | generated search index | Fails closed when the selected project's index is missing or stale. |
| `memory-vault` | Selected memory root | raw/wiki/work vault files | Paths must pass the boundary guard. |
| `generated-ledger` | Selected project | `.boreal/ledgers` export | Read-only bridge; not a second writer. |

## Tool Rules

MCP tools must declare effects and be normalized through `defineMcpToolContract()` from `@boreal/core`.

| Tier | Effects | Confirmation | Command preview | Operation ID | Default safety |
| --- | --- | --- | --- | --- | --- |
| `read` | `read` only | Not allowed/needed | Not required | Not required | Safe by default. |
| `mutating` | Any of `state`, `vault`, `generated`, `registry`, `git`, or `external` | Required | Required and scoped to the selected `workspaceRoot` | Required | Fails closed until confirmed and audited. |

Read-only tools cannot require confirmation and cannot claim an audit operation ID. Mutating tools fail contract validation unless they return an exact command preview, mark confirmation as required, and declare that execution returns an audit operation ID. `bwrk` previews must include `--workspace <selected-project-root>`; Git previews must include `git -C <selected-project-root>`.

Allowed read tools:

- Command catalog and help metadata.
- Project-scoped `work list/show`, `context show`, `search query`, `sync status`, `doctor`, `lock status`, and sprint/dashboard view-model reads.
- Registry list or registry doctor summaries that show project identity and health without reading project runtime/memory content until one project is selected.

Allowed write tools:

- Mutations must route through `@boreal/engine` or exact `bwrk --workspace <selected-project-root> ...` command descriptors.
- Every mutating tool result must include the selected `workspaceRoot`, command/effect metadata, the audit operation ID returned by execution, and any evidence or verification IDs it creates.
- UI or MCP adapters must require explicit confirmation for mutating work, registry, setup, Git, vault, import, merge, compact, and repair operations.

Forbidden tools:

- Arbitrary filesystem read/write.
- Reading raw `.boreal/runtime/state.json` for an unselected registered project.
- Reading another project's `memory/` vault because it appears in the machine-local registry.
- Combining records from multiple projects into one project-scoped resource without retaining project identity on every row.
- Writing runtime state, generated caches, ledgers, or vault files directly instead of using the storage/engine/CLI command boundary.

## Adapter Shape

An MCP or daemon request should follow this order:

```text
parse request -> resolve explicit project selection -> bindMcpProjectBoundary()
-> validate each requested path/resource -> call engine/CLI scoped to boundary.workspaceRoot
-> return bounded JSON with workspaceRoot/projectRoot/memoryRoot metadata
```

This keeps the daemon process root, local registry root, and selected Boreal workspace separate. The registry can help select a project, but project content is readable only after the selection is explicit and the per-request roots validate.

## Leakage And Traversal Fixtures

The core regression suite covers the boundary and adapter fixture matrix:

| Fixture | Expected result | Current coverage |
| --- | --- | --- |
| Current project reads its runtime or memory path | Allowed after boundary binding | `tests/runtime/core.test.ts` |
| Current project reads another registered project's memory path | Fails with `BOREAL_INVALID_INPUT` | `tests/runtime/core.test.ts` |
| Request uses a path outside selected project/memory roots | Fails with `BOREAL_INVALID_INPUT` | `tests/runtime/core.test.ts` |
| Selected memory root symlink points outside the project | Fails realpath validation with `BOREAL_INVALID_INPUT` | `tests/runtime/core.test.ts` |
| Selected project ID does not match registry roots | Fails with `BOREAL_INVALID_INPUT` | `tests/runtime/core.test.ts` |
| Stale copied config points current project at a different memory root | Fails with `BOREAL_INVALID_INPUT` | `tests/runtime/core.test.ts` |
| Mutating tool lacks scoped command preview, confirmation, or operation ID contract | Fails with `BOREAL_INVALID_INPUT` | `tests/runtime/core.test.ts` |

`tests/runtime/mcp.test.ts` now mirrors the selection, read-tool, confirmation, command-preview, and operation-evidence behavior through real MCP tool calls with a fake CLI runner. Filesystem path traversal stays in the core fixture because the first MCP adapter exposes vault/runtime reads through CLI tools instead of arbitrary file resources.
