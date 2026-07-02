import { homedir, platform as currentPlatform } from "node:os";
import { join, resolve } from "node:path";

export const PROJECT_REGISTRY_SCHEMA_VERSION = "boreal.project-registry.v1";
export const PROJECT_REGISTRY_SCHEMA_ID = "https://boreal.work/schemas/projects/project-registry.schema.json";
export const PROJECT_REGISTRY_ROOT_ENV = "BOREAL_PROJECT_REGISTRY_ROOT";
export const PROJECT_REGISTRY_FILE_NAME = "projects.json";
export const PROJECT_REGISTRY_LOCK_NAME = "projects.lock";

export type ProjectRegistryStorageScope = "machine-local";
export type ProjectRegistryEntrySource = "explicit" | "project-setup" | "imported";
export type ProjectRegistryMemoryLayout = "in-repo" | "child" | "sibling";
export type ProjectRegistryMemoryGitMode = "shared" | "separate" | "submodule";
export type ProjectRegistrySkillTarget = "codex" | "claude";

export interface ProjectRegistrySkillInstallRoot {
  readonly target: ProjectRegistrySkillTarget;
  readonly installRoot: string;
  readonly skillRoot: string;
}

export interface ProjectRegistryBwrkPin {
  readonly source: "node_modules" | "project-config";
  readonly binPath: string;
  readonly relativeBinPath: string;
  readonly packageName?: string;
}

export interface ProjectRegistryStorage {
  readonly scope: ProjectRegistryStorageScope;
  readonly rootDir: string;
  readonly registryDir: string;
  readonly registryFile: string;
  readonly lockDir: string;
}

export interface ProjectRegistryDisplayMetadata {
  readonly name: string;
  readonly description?: string;
  readonly labels: readonly string[];
}

export interface ProjectRegistryEntry {
  readonly id: string;
  readonly display: ProjectRegistryDisplayMetadata;
  readonly projectRoot: string;
  readonly borealDir: string;
  readonly runtimeDir: string;
  readonly runtimeStateFile: string;
  readonly projectConfigPath: string;
  readonly memoryRoot: string;
  readonly memoryBorealDir: string;
  readonly memoryLayout: ProjectRegistryMemoryLayout;
  readonly memoryGitMode: ProjectRegistryMemoryGitMode;
  readonly memoryRemote?: string;
  readonly installRoot: string;
  readonly bwrkPin?: ProjectRegistryBwrkPin;
  readonly skillInstallRoots?: readonly ProjectRegistrySkillInstallRoot[];
  readonly skillTargets: readonly ProjectRegistrySkillTarget[];
  readonly folderScoped: boolean;
  readonly source: ProjectRegistryEntrySource;
  readonly addedAt: string;
  readonly updatedAt: string;
  readonly lastSeenAt?: string;
}

export interface ProjectRegistryDocument {
  readonly schemaVersion: typeof PROJECT_REGISTRY_SCHEMA_VERSION;
  readonly storage: ProjectRegistryStorage;
  readonly entries: readonly ProjectRegistryEntry[];
  readonly updatedAt?: string;
}

export interface ResolveProjectRegistryPathsOptions {
  readonly rootDir?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly homeDir?: string;
  readonly platform?: NodeJS.Platform;
}

export function resolveProjectRegistryPaths(options: ResolveProjectRegistryPathsOptions = {}): ProjectRegistryStorage {
  // Honor BOREAL_PROJECT_REGISTRY_ROOT by default (the documented override).
  // Previously the env var was only read when a caller passed `options.env`,
  // so the override silently did nothing for most commands.
  const env = options.env ?? process.env;
  const rootDir = resolve(options.rootDir ?? env[PROJECT_REGISTRY_ROOT_ENV] ?? defaultRegistryRoot({ ...options, env }));
  const registryDir = join(rootDir, "registry");
  return {
    scope: "machine-local",
    rootDir,
    registryDir,
    registryFile: join(registryDir, PROJECT_REGISTRY_FILE_NAME),
    lockDir: join(registryDir, PROJECT_REGISTRY_LOCK_NAME)
  };
}

function defaultRegistryRoot(options: ResolveProjectRegistryPathsOptions): string {
  const env = options.env ?? process.env;
  const home = options.homeDir ?? homedir();
  const platform = options.platform ?? currentPlatform();

  if (platform === "darwin") {
    return join(home, "Library", "Application Support", "Boreal");
  }
  if (platform === "win32") {
    return join(env.LOCALAPPDATA ?? join(home, "AppData", "Local"), "Boreal");
  }
  return join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "boreal");
}
