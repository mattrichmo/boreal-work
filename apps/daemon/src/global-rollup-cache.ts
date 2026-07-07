import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  BorealError,
  PROJECT_REGISTRY_SCHEMA_VERSION,
  nowIso,
  projectRegistryDocumentSchemaIssues,
  projectRollupSchemaIssues,
  readJsonFile,
  resolveProjectRegistryPaths,
  type IsoTimestamp,
  type ProjectRegistryDocument,
  type ProjectRegistryEntry,
  type ProjectRegistryStorage,
  type ProjectRollupDocument
} from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

export const GLOBAL_ROLLUP_CACHE_SCHEMA_VERSION = "boreal.global-rollup-cache.v1";

const PROJECT_ROLLUP_MAX_READ_BYTES = 5 * 1024 * 1024;
const DEFAULT_LIVE_CACHE_TTL_MS = 60_000;

export type GlobalRollupCacheRefreshSource = "daemon" | "lazy";
export type GlobalRollupCacheProjectSource = "daemon" | "lazy" | "cache";
export type GlobalRollupCacheProjectStatus = "fresh" | "stale" | "degraded";

export interface GlobalRollupCacheOptions {
  readonly registryRoot?: string;
  readonly ttlMs?: number;
  readonly source?: GlobalRollupCacheRefreshSource;
  readonly now?: () => string;
}

export interface GlobalRollupCacheProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly lifecycle: ProjectRegistryEntry["lifecycle"];
  readonly sourceRollupPath: string;
  readonly cachePath: string;
  readonly source: GlobalRollupCacheProjectSource;
  readonly status: GlobalRollupCacheProjectStatus;
  readonly stale: boolean;
  readonly ttlMs: number;
  readonly fetchedAt?: IsoTimestamp;
  readonly cacheAgeMs?: number;
  readonly generatedAt?: IsoTimestamp;
  readonly stateContentHash?: string;
  readonly rollup?: ProjectRollupDocument;
  readonly error?: string;
}

export interface GlobalRollupCacheResult {
  readonly schemaVersion: typeof GLOBAL_ROLLUP_CACHE_SCHEMA_VERSION;
  readonly generatedAt: IsoTimestamp;
  readonly registryRoot: string;
  readonly registryFile: string;
  readonly cacheDir: string;
  readonly ttlMs: number;
  readonly source: GlobalRollupCacheRefreshSource;
  readonly projectCount: number;
  readonly freshCount: number;
  readonly staleCount: number;
  readonly degradedCount: number;
  readonly projects: readonly GlobalRollupCacheProject[];
  readonly registryError?: string;
}

interface CachedRollupRead {
  readonly rollup: ProjectRollupDocument;
  readonly fetchedAt: IsoTimestamp;
  readonly cacheAgeMs: number;
  readonly stale: boolean;
}

export async function refreshGlobalRollupCache(options: GlobalRollupCacheOptions = {}): Promise<GlobalRollupCacheResult> {
  const generatedAt = iso(options.now?.() ?? nowIso());
  const ttlMs = normalizeTtlMs(options.ttlMs);
  const source = options.source ?? "lazy";
  const storage = resolveProjectRegistryPaths({ rootDir: options.registryRoot });
  let document: ProjectRegistryDocument;
  try {
    document = await readProjectRegistryDocument(storage);
  } catch (error) {
    return emptyGlobalRollupCacheResult({
      ...options,
      source,
      now: () => generatedAt
    }, error);
  }
  const cacheDir = globalRollupCacheDir(storage);
  const projects = await Promise.all(
    document.entries
      .filter((entry) => entry.lifecycle === "linked")
      .slice()
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((entry) => refreshGlobalRollupCacheProject({
        entry,
        cacheDir,
        generatedAt,
        ttlMs,
        source
      }))
  );

  return {
    schemaVersion: GLOBAL_ROLLUP_CACHE_SCHEMA_VERSION,
    generatedAt,
    registryRoot: storage.rootDir,
    registryFile: storage.registryFile,
    cacheDir,
    ttlMs,
    source,
    projectCount: projects.length,
    freshCount: projects.filter((project) => project.status === "fresh").length,
    staleCount: projects.filter((project) => project.status === "stale").length,
    degradedCount: projects.filter((project) => project.status === "degraded").length,
    projects
  };
}

export function emptyGlobalRollupCacheResult(options: GlobalRollupCacheOptions = {}, error?: unknown): GlobalRollupCacheResult {
  const generatedAt = iso(options.now?.() ?? nowIso());
  const ttlMs = normalizeTtlMs(options.ttlMs);
  const source = options.source ?? "lazy";
  const storage = resolveProjectRegistryPaths({ rootDir: options.registryRoot });
  return {
    schemaVersion: GLOBAL_ROLLUP_CACHE_SCHEMA_VERSION,
    generatedAt,
    registryRoot: storage.rootDir,
    registryFile: storage.registryFile,
    cacheDir: globalRollupCacheDir(storage),
    ttlMs,
    source,
    projectCount: 0,
    freshCount: 0,
    staleCount: 0,
    degradedCount: 0,
    projects: [],
    registryError: errorMessage(error)
  };
}

export function globalRollupCacheDir(storage: ProjectRegistryStorage): string {
  return join(storage.rootDir, "cache", "rollups");
}

export function globalRollupCachePath(storage: ProjectRegistryStorage, projectId: string): string {
  return join(globalRollupCacheDir(storage), `${projectId}.json`);
}

async function refreshGlobalRollupCacheProject(input: {
  readonly entry: ProjectRegistryEntry;
  readonly cacheDir: string;
  readonly generatedAt: IsoTimestamp;
  readonly ttlMs: number;
  readonly source: GlobalRollupCacheRefreshSource;
}): Promise<GlobalRollupCacheProject> {
  const cachePath = join(input.cacheDir, `${input.entry.id}.json`);
  const sourceRollupPath = projectRollupPath(input.entry);
  const cached = await readCachedRollup(cachePath, input.generatedAt, input.ttlMs).catch(() => undefined);
  if (input.source === "lazy" && cached && !cached.stale) {
    return globalRollupCacheProject(input.entry, {
      sourceRollupPath,
      cachePath,
      source: "cache",
      status: "fresh",
      stale: false,
      ttlMs: input.ttlMs,
      cached
    });
  }

  try {
    const rollup = await readProjectRollup(sourceRollupPath, input.entry.id);
    await writeTextFileAtomic(cachePath, `${JSON.stringify(rollup, null, 2)}\n`);
    return globalRollupCacheProject(input.entry, {
      sourceRollupPath,
      cachePath,
      source: input.source,
      status: "fresh",
      stale: false,
      ttlMs: input.ttlMs,
      cached: {
        rollup,
        fetchedAt: input.generatedAt,
        cacheAgeMs: 0,
        stale: false
      }
    });
  } catch (error) {
    if (input.source === "lazy" && cached) {
      return globalRollupCacheProject(input.entry, {
        sourceRollupPath,
        cachePath,
        source: "cache",
        status: "stale",
        stale: true,
        ttlMs: input.ttlMs,
        cached,
        error
      });
    }
    return globalRollupCacheProject(input.entry, {
      sourceRollupPath,
      cachePath,
      source: input.source,
      status: "degraded",
      stale: false,
      ttlMs: input.ttlMs,
      error
    });
  }
}

function globalRollupCacheProject(
  entry: ProjectRegistryEntry,
  input: {
    readonly sourceRollupPath: string;
    readonly cachePath: string;
    readonly source: GlobalRollupCacheProjectSource;
    readonly status: GlobalRollupCacheProjectStatus;
    readonly stale: boolean;
    readonly ttlMs: number;
    readonly cached?: CachedRollupRead;
    readonly error?: unknown;
  }
): GlobalRollupCacheProject {
  return {
    projectId: entry.id,
    projectName: entry.display.name,
    projectRoot: entry.projectRoot,
    lifecycle: entry.lifecycle,
    sourceRollupPath: input.sourceRollupPath,
    cachePath: input.cachePath,
    source: input.source,
    status: input.status,
    stale: input.stale,
    ttlMs: input.ttlMs,
    fetchedAt: input.cached?.fetchedAt,
    cacheAgeMs: input.cached?.cacheAgeMs,
    generatedAt: input.cached?.rollup.generatedAt,
    stateContentHash: input.cached?.rollup.stateContentHash,
    rollup: input.cached?.rollup,
    error: errorMessage(input.error)
  };
}

async function readCachedRollup(path: string, generatedAt: IsoTimestamp, ttlMs: number): Promise<CachedRollupRead> {
  const [rollup, info] = await Promise.all([
    readProjectRollup(path),
    stat(path)
  ]);
  const fetchedAt = info.mtime.toISOString() as IsoTimestamp;
  const cacheAgeMs = Math.max(0, Date.parse(generatedAt) - info.mtimeMs);
  return {
    rollup,
    fetchedAt,
    cacheAgeMs,
    stale: cacheAgeMs > ttlMs
  };
}

async function readProjectRollup(path: string, expectedProjectId?: string): Promise<ProjectRollupDocument> {
  if (!existsSync(path)) {
    throw new BorealError("BOREAL_NOT_FOUND", "Project rollup is missing", { path });
  }
  const parsed = await readJsonFile(path, {
    schemaName: "boreal.project-rollup.v1",
    expectedObject: true,
    maxBytes: PROJECT_ROLLUP_MAX_READ_BYTES
  });
  const issues = projectRollupSchemaIssues(parsed);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Project rollup failed schema validation", { path, issues });
  }
  const rollup = parsed as ProjectRollupDocument;
  if (expectedProjectId && rollup.projectId !== expectedProjectId) {
    throw new BorealError("BOREAL_CONFLICT", "Project rollup projectId does not match the registry entry", {
      path,
      expectedProjectId,
      actualProjectId: rollup.projectId
    });
  }
  return rollup;
}

async function readProjectRegistryDocument(storage: ProjectRegistryStorage): Promise<ProjectRegistryDocument> {
  if (!existsSync(storage.registryFile)) {
    return {
      schemaVersion: PROJECT_REGISTRY_SCHEMA_VERSION,
      storage,
      entries: []
    };
  }
  const parsed = await readJsonFile(storage.registryFile, {
    schemaName: PROJECT_REGISTRY_SCHEMA_VERSION,
    expectedObject: true,
    maxBytes: 2 * 1024 * 1024
  });
  const issues = projectRegistryDocumentSchemaIssues(parsed);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Project registry file failed schema validation", {
      registryFile: storage.registryFile,
      issues
    });
  }
  return parsed as ProjectRegistryDocument;
}

function projectRollupPath(entry: ProjectRegistryEntry): string {
  return join(resolve(entry.borealDir || join(entry.projectRoot, ".boreal")), "rollup.json");
}

function normalizeTtlMs(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIVE_CACHE_TTL_MS;
  }
  if (!Number.isInteger(value) || value < 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "live cache TTL must be a non-negative integer", { ttlMs: value });
  }
  return value;
}

function iso(value: string): IsoTimestamp {
  return value as IsoTimestamp;
}

function errorMessage(error: unknown): string | undefined {
  if (error === undefined) {
    return undefined;
  }
  if (error instanceof BorealError && isRecord(error.details) && Array.isArray(error.details.issues)) {
    return `${error.message}: ${JSON.stringify(error.details.issues)}`;
  }
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
