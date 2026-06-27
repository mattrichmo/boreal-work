import { lstat, realpath } from "node:fs/promises";
import { dirname, parse, relative, resolve } from "node:path";

import { BorealError } from "./errors.js";
import type { ProjectRegistryEntry, ProjectRegistryMemoryLayout } from "./project-registry.js";

export const MCP_RESOURCE_BOUNDARY_VERSION = "boreal.mcp-boundary.v1";

export type McpExposedResourceKind =
  | "command-catalog"
  | "workspace-status"
  | "work-context"
  | "search-query"
  | "memory-vault"
  | "generated-ledger";

export type McpToolEffect = "read" | "state" | "vault" | "generated" | "registry" | "git" | "external";
export type McpPermissionTier = "read" | "mutating";

export const MCP_EXPOSED_RESOURCE_KINDS: readonly McpExposedResourceKind[] = [
  "command-catalog",
  "workspace-status",
  "work-context",
  "search-query",
  "memory-vault",
  "generated-ledger"
] as const;

export const MCP_READ_TOOL_EFFECTS: readonly McpToolEffect[] = ["read"] as const;
export const MCP_MUTATING_TOOL_EFFECTS: readonly McpToolEffect[] = [
  "state",
  "vault",
  "generated",
  "registry",
  "git",
  "external"
] as const;

export type McpProjectRegistryEntry = Pick<ProjectRegistryEntry, "id" | "projectRoot" | "memoryRoot" | "memoryLayout">;

export interface BindMcpProjectBoundaryInput {
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout?: ProjectRegistryMemoryLayout;
  readonly selectedProjectId?: string;
  readonly registryEntries?: readonly McpProjectRegistryEntry[];
}

export interface McpProjectBoundary {
  readonly schemaVersion: typeof MCP_RESOURCE_BOUNDARY_VERSION;
  readonly selectedProjectId?: string;
  readonly selectedExplicitly: boolean;
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: ProjectRegistryMemoryLayout;
  readonly allowedRoots: readonly string[];
  readonly unselectedProjectRoots: readonly string[];
}

export interface McpToolContractInput {
  readonly id: string;
  readonly title?: string;
  readonly effects: readonly McpToolEffect[];
  readonly commandPreview?: readonly string[];
  readonly requiresConfirmation?: boolean;
  readonly returnsOperationId?: boolean;
}

export interface McpCommandPreview {
  readonly argv: readonly string[];
  readonly workspaceRoot: string;
}

export interface McpToolContract {
  readonly id: string;
  readonly title?: string;
  readonly tier: McpPermissionTier;
  readonly effects: readonly McpToolEffect[];
  readonly readOnly: boolean;
  readonly requiresConfirmation: boolean;
  readonly returnsOperationId: boolean;
  readonly commandPreview?: McpCommandPreview;
}

export function bindMcpProjectBoundary(input: BindMcpProjectBoundaryInput): McpProjectBoundary {
  const workspaceRoot = resolveChecked(input.workspaceRoot, "workspaceRoot");
  const projectRoot = resolveChecked(input.projectRoot, "projectRoot");
  const memoryRoot = resolveChecked(input.memoryRoot, "memoryRoot");
  const registryEntries = (input.registryEntries ?? []).map((entry) => ({
    ...entry,
    projectRoot: resolveChecked(entry.projectRoot, `registryEntries.${entry.id}.projectRoot`),
    memoryRoot: resolveChecked(entry.memoryRoot, `registryEntries.${entry.id}.memoryRoot`)
  }));
  const selectedEntry = selectedRegistryEntry(input.selectedProjectId, registryEntries);

  if (workspaceRoot !== projectRoot) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP workspace root must match the selected project root", {
      workspaceRoot,
      projectRoot
    });
  }

  if (selectedEntry) {
    if (projectRoot !== selectedEntry.projectRoot || memoryRoot !== selectedEntry.memoryRoot) {
      throw new BorealError("BOREAL_INVALID_INPUT", "MCP selected project roots must match the registry entry", {
        selectedProjectId: selectedEntry.id,
        projectRoot,
        expectedProjectRoot: selectedEntry.projectRoot,
        memoryRoot,
        expectedMemoryRoot: selectedEntry.memoryRoot
      });
    }
  } else {
    const currentEntry = registryEntries.find((entry) => entry.projectRoot === projectRoot);
    if (currentEntry && memoryRoot !== currentEntry.memoryRoot) {
      throw new BorealError("BOREAL_INVALID_INPUT", "MCP current project memory root must match the registry entry", {
        projectRoot,
        memoryRoot,
        expectedMemoryRoot: currentEntry.memoryRoot
      });
    }
  }

  const memoryLayout = input.memoryLayout ?? selectedEntry?.memoryLayout ?? inferMemoryLayout(projectRoot, memoryRoot);
  validateMemoryRoot(projectRoot, memoryRoot, memoryLayout);

  return {
    schemaVersion: MCP_RESOURCE_BOUNDARY_VERSION,
    selectedProjectId: input.selectedProjectId,
    selectedExplicitly: Boolean(input.selectedProjectId),
    workspaceRoot,
    projectRoot,
    memoryRoot,
    memoryLayout,
    allowedRoots: uniqueResolved([projectRoot, memoryRoot]),
    unselectedProjectRoots: unselectedRegistryRoots(registryEntries, { projectRoot, memoryRoot })
  };
}

export function defineMcpToolContract(boundary: McpProjectBoundary, input: McpToolContractInput): McpToolContract {
  const effects = uniqueEffects(input.effects);
  const readOnly = effects.every((effect) => effect === "read");

  if (readOnly) {
    return {
      id: input.id,
      title: input.title,
      tier: "read",
      effects,
      readOnly: true,
      requiresConfirmation: false,
      returnsOperationId: false
    };
  }

  if (input.requiresConfirmation !== true) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Mutating MCP tools must require explicit confirmation", {
      toolId: input.id,
      effects
    });
  }
  if (input.returnsOperationId !== true) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Mutating MCP tools must return an audit operation ID", {
      toolId: input.id,
      effects
    });
  }
  if (!input.commandPreview || input.commandPreview.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Mutating MCP tools must return an exact command preview", {
      toolId: input.id,
      effects
    });
  }

  assertScopedCommandPreview(boundary, input.id, input.commandPreview);

  return {
    id: input.id,
    title: input.title,
    tier: "mutating",
    effects,
    readOnly: false,
    requiresConfirmation: true,
    returnsOperationId: true,
    commandPreview: {
      argv: [...input.commandPreview],
      workspaceRoot: boundary.workspaceRoot
    }
  };
}

export function assertMcpResourcePathAllowed(boundary: McpProjectBoundary, resourcePath: string): void {
  const resolvedPath = resolveChecked(resourcePath, "resourcePath");
  const insideAllowedRoot = boundary.allowedRoots.some((root) => pathInside(root, resolvedPath));
  if (!insideAllowedRoot) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP resource path is outside the selected Boreal workspace", {
      resourcePath: resolvedPath,
      allowedRoots: boundary.allowedRoots,
      projectRoot: boundary.projectRoot,
      memoryRoot: boundary.memoryRoot
    });
  }

  const deniedRoot = boundary.unselectedProjectRoots.find((root) => pathInside(root, resolvedPath));
  if (deniedRoot) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP resource path targets an unselected Boreal project", {
      resourcePath: resolvedPath,
      deniedRoot,
      projectRoot: boundary.projectRoot,
      memoryRoot: boundary.memoryRoot,
      selectedProjectId: boundary.selectedProjectId
    });
  }
}

export async function assertMcpResourceRealPathAllowed(boundary: McpProjectBoundary, resourcePath: string): Promise<void> {
  assertMcpResourcePathAllowed(boundary, resourcePath);
  const resolvedPath = resolveChecked(resourcePath, "resourcePath");
  const existingPath = await deepestExistingPath(resolvedPath);
  const realResourcePath = await realpath(existingPath);
  const allowedRootRealPaths = await Promise.all(boundary.allowedRoots.map((root) => realpath(root)));
  const insideAllowedRoot = allowedRootRealPaths.some((root) => pathInside(root, realResourcePath));
  if (!insideAllowedRoot) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP resource real path is outside the selected Boreal workspace", {
      resourcePath: resolvedPath,
      realResourcePath,
      allowedRoots: boundary.allowedRoots,
      projectRoot: boundary.projectRoot,
      memoryRoot: boundary.memoryRoot
    });
  }

  const deniedRoots = await existingRealPaths(boundary.unselectedProjectRoots);
  const deniedRoot = deniedRoots.find((root) => pathInside(root, realResourcePath));
  if (deniedRoot) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP resource real path targets an unselected Boreal project", {
      resourcePath: resolvedPath,
      realResourcePath,
      deniedRoot,
      projectRoot: boundary.projectRoot,
      memoryRoot: boundary.memoryRoot,
      selectedProjectId: boundary.selectedProjectId
    });
  }
}

function assertScopedCommandPreview(boundary: McpProjectBoundary, toolId: string, argv: readonly string[]): void {
  const bwrkWorkspaceIndex = argv.findIndex((value) => value === "--workspace");
  const gitWorkspaceIndex = argv.findIndex((value) => value === "-C");
  const scopedWorkspace =
    bwrkWorkspaceIndex >= 0
      ? argv[bwrkWorkspaceIndex + 1]
      : argv[0] === "git" && gitWorkspaceIndex >= 0
        ? argv[gitWorkspaceIndex + 1]
        : undefined;

  if (!scopedWorkspace || resolve(scopedWorkspace) !== boundary.workspaceRoot) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Mutating MCP command previews must be scoped to the selected workspace", {
      toolId,
      workspaceRoot: boundary.workspaceRoot,
      argv
    });
  }
}

function uniqueEffects(effects: readonly McpToolEffect[]): readonly McpToolEffect[] {
  if (effects.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP tool effects must not be empty");
  }
  return [...new Set(effects)];
}

function selectedRegistryEntry(
  selectedProjectId: string | undefined,
  registryEntries: readonly McpProjectRegistryEntry[]
): McpProjectRegistryEntry | undefined {
  if (!selectedProjectId) {
    return undefined;
  }
  const selectedEntry = registryEntries.find((entry) => entry.id === selectedProjectId);
  if (!selectedEntry) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Selected MCP project is not registered", { selectedProjectId });
  }
  return selectedEntry;
}

function validateMemoryRoot(projectRoot: string, memoryRoot: string, memoryLayout: ProjectRegistryMemoryLayout): void {
  if (projectRoot === memoryRoot) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP memory root must be distinct from the project root", {
      projectRoot,
      memoryRoot
    });
  }

  if (memoryLayout === "sibling") {
    if (dirname(projectRoot) !== dirname(memoryRoot)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "MCP sibling memory root must share the project root parent", {
        projectRoot,
        memoryRoot
      });
    }
    return;
  }

  if (!pathInside(projectRoot, memoryRoot)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP memory root must be inside the selected project root", {
      projectRoot,
      memoryRoot,
      memoryLayout
    });
  }
}

function inferMemoryLayout(projectRoot: string, memoryRoot: string): ProjectRegistryMemoryLayout {
  if (pathInside(projectRoot, memoryRoot) && memoryRoot !== projectRoot) {
    return "in-repo";
  }
  if (dirname(projectRoot) === dirname(memoryRoot)) {
    return "sibling";
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "MCP memory root does not match a supported project layout", {
    projectRoot,
    memoryRoot
  });
}

function unselectedRegistryRoots(
  registryEntries: readonly McpProjectRegistryEntry[],
  selected: { readonly projectRoot: string; readonly memoryRoot: string }
): readonly string[] {
  return uniqueResolved(
    registryEntries.flatMap((entry) =>
      entry.projectRoot === selected.projectRoot && entry.memoryRoot === selected.memoryRoot
        ? []
        : [entry.projectRoot, entry.memoryRoot]
    )
  );
}

function uniqueResolved(paths: readonly string[]): readonly string[] {
  return [...new Set(paths.map((path) => resolve(path)))];
}

function resolveChecked(path: string, field: string): string {
  if (path.includes("\0")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "MCP path contains a null byte", { field });
  }
  return resolve(path);
}

function pathInside(parentDir: string, childPath: string): boolean {
  const parent = resolve(parentDir);
  const child = resolve(childPath);
  const relation = relative(parent, child);
  return relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
}

async function deepestExistingPath(path: string): Promise<string> {
  let current = resolve(path);
  const root = parse(current).root;
  while (current !== root) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      current = dirname(current);
    }
  }
  return root;
}

async function existingRealPaths(paths: readonly string[]): Promise<readonly string[]> {
  const resolvedPaths: string[] = [];
  for (const path of paths) {
    try {
      resolvedPaths.push(await realpath(path));
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
    }
  }
  return uniqueResolved(resolvedPaths);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
