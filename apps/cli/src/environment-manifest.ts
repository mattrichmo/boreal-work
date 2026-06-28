import { join, resolve } from "node:path";

import type { CliContext } from "./context.js";
import { readProjectSetupConfig, skillInstallRootConfig, type MemoryGitMode, type MemoryLayout, type SkillInstallRootConfig, type SkillTarget } from "./project-setup.js";
import { resolveWorkflowAssetRoots, type WorkflowAssetRoots } from "./workflow-assets.js";

export const ENVIRONMENT_MANIFEST_SCHEMA_VERSION = "boreal.environment-manifest.v1";

export interface EnvironmentManifest {
  readonly schemaVersion: typeof ENVIRONMENT_MANIFEST_SCHEMA_VERSION;
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly borealDir: string;
  readonly runtimeDir: string;
  readonly runtimeStateFile: string;
  readonly projectConfigPath: string;
  readonly memoryRoot: string;
  readonly memoryBorealDir: string;
  readonly memoryLayout: MemoryLayout;
  readonly memoryGitMode: MemoryGitMode;
  readonly memoryRemote?: string;
  readonly skillTargets: readonly SkillTarget[];
  readonly installRoot: string;
  readonly skillInstallRoots: readonly SkillInstallRootConfig[];
  readonly workflowAssets: WorkflowAssetRoots;
}

export async function resolveEnvironmentManifest(context: CliContext): Promise<EnvironmentManifest> {
  const projectRoot = context.workspaceRoot;
  const config = await readProjectSetupConfig(projectRoot);
  const memoryRoot = config?.memoryRoot ?? join(projectRoot, "memory");
  const memoryLayout = config?.memoryLayout ?? "in-repo";
  const memoryGitMode = config?.memoryGitMode ?? "shared";
  const installRoot = config?.installRoot ?? join(projectRoot, ".agents", "skills");
  const skillTargets = config?.skillTargets ?? (["codex"] as const);
  const skillInstallRoots =
    config?.skillInstallRoots ?? skillTargets.map((target) => skillInstallRootConfig(projectRoot, installRoot, target));

  return {
    schemaVersion: ENVIRONMENT_MANIFEST_SCHEMA_VERSION,
    workspaceRoot: projectRoot,
    projectRoot,
    borealDir: context.paths.borealDir,
    runtimeDir: context.paths.runtimeDir,
    runtimeStateFile: context.paths.stateFile,
    projectConfigPath: join(projectRoot, ".boreal", "project.json"),
    memoryRoot,
    memoryBorealDir: join(memoryRoot, ".boreal"),
    memoryLayout,
    memoryGitMode,
    memoryRemote: config?.memoryRemote,
    skillTargets,
    installRoot: resolve(installRoot),
    skillInstallRoots,
    workflowAssets: resolveWorkflowAssetRoots({ workspaceRoot: projectRoot })
  };
}
