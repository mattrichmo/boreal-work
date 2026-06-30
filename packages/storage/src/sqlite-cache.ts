import { existsSync } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { BorealError, assertPathInside, canonicalJson, hashContent, resolveWorkspacePaths, runBoundedProcess } from "@boreal/core";

import type { StoreSnapshot } from "./memory-store.js";

export const SQLITE_CACHE_SCHEMA_VERSION = "boreal.sqlite-cache.v1";

export type SQLiteCacheSection =
  | "workItems"
  | "agentSummaries"
  | "evidence"
  | "verifications"
  | "knowledgeSources"
  | "claims"
  | "decisions"
  | "graphEdges"
  | "reservations"
  | "events"
  | "projections"
  | "contextPacks";

export interface SQLiteCacheOptions {
  readonly rootDir: string;
  readonly cacheFile?: string;
  readonly sqliteBin?: string;
}

export interface SQLiteCacheRebuildOptions extends SQLiteCacheOptions {
  readonly snapshot: StoreSnapshot;
  readonly sourceContentHash?: string;
}

export interface SQLiteCacheInspectionOptions extends SQLiteCacheOptions {
  readonly expectedSnapshot?: StoreSnapshot;
  readonly expectedSourceContentHash?: string;
}

export interface SQLiteCacheQueryOptions extends SQLiteCacheOptions {
  readonly section?: SQLiteCacheSection;
  readonly limit?: number;
}

export interface SQLiteCacheResultBase {
  readonly path: string;
  readonly schemaVersion: typeof SQLITE_CACHE_SCHEMA_VERSION;
  readonly sqliteAvailable: boolean;
}

export interface SQLiteCacheRebuildResult extends SQLiteCacheResultBase {
  readonly rebuilt: boolean;
  readonly skipped: boolean;
  readonly sourceContentHash: string;
  readonly recordCounts: Record<SQLiteCacheSection, number>;
  readonly sizeBytes?: number;
  readonly error?: string;
}

export interface SQLiteCacheInspection extends SQLiteCacheResultBase {
  readonly ok: boolean;
  readonly exists: boolean;
  readonly stale: boolean;
  readonly sourceContentHash?: string;
  readonly expectedSourceContentHash?: string;
  readonly recordCounts?: Record<SQLiteCacheSection, number>;
  readonly expectedRecordCounts?: Record<SQLiteCacheSection, number>;
  readonly sizeBytes?: number;
  readonly error?: string;
}

export interface SQLiteCacheRecordRow {
  readonly section: SQLiteCacheSection;
  readonly id: string;
  readonly title?: string;
  readonly status?: string;
  readonly kind?: string;
  readonly updatedAt?: string;
  readonly contentHash?: string;
  readonly json: string;
}

const CACHE_SECTIONS: readonly SQLiteCacheSection[] = [
  "workItems",
  "agentSummaries",
  "evidence",
  "verifications",
  "knowledgeSources",
  "claims",
  "decisions",
  "graphEdges",
  "reservations",
  "events",
  "projections",
  "contextPacks"
];

const DEFAULT_SQLITE_BIN = "sqlite3";

export function sqliteCachePath(rootDir: string): string {
  const paths = resolveWorkspacePaths(rootDir);
  return join(paths.borealDir, "cache", "runtime-cache.sqlite");
}

export async function rebuildSQLiteCache(options: SQLiteCacheRebuildOptions): Promise<SQLiteCacheRebuildResult> {
  const cacheFile = resolveCachePath(options);
  const sqliteBin = options.sqliteBin ?? DEFAULT_SQLITE_BIN;
  const sqliteAvailable = await checkSQLiteAvailable(sqliteBin);
  const cacheSnapshot = canonicalCacheSnapshot(options.snapshot);
  const sourceContentHash = options.sourceContentHash ?? hashContent(cacheSnapshot);
  const recordCounts = snapshotRecordCounts(cacheSnapshot);
  if (!sqliteAvailable) {
    return {
      path: cacheFile,
      schemaVersion: SQLITE_CACHE_SCHEMA_VERSION,
      sqliteAvailable,
      rebuilt: false,
      skipped: true,
      sourceContentHash,
      recordCounts,
      error: "sqlite3 executable is not available"
    };
  }

  await mkdir(join(resolve(options.rootDir), ".boreal", "cache"), { recursive: true });
  const tempFile = `${cacheFile}.tmp-${process.pid}-${Date.now()}`;
  await rm(tempFile, { force: true });
  await rm(`${tempFile}-journal`, { force: true });

  try {
    await runSQLite(sqliteBin, [tempFile], buildRebuildSql(cacheSnapshot, sourceContentHash, recordCounts));
    await rename(tempFile, cacheFile);
    const info = await stat(cacheFile);
    return {
      path: cacheFile,
      schemaVersion: SQLITE_CACHE_SCHEMA_VERSION,
      sqliteAvailable,
      rebuilt: true,
      skipped: false,
      sourceContentHash,
      recordCounts,
      sizeBytes: info.size
    };
  } catch (error) {
    await rm(tempFile, { force: true });
    await rm(`${tempFile}-journal`, { force: true });
    throw error;
  }
}

export async function inspectSQLiteCache(options: SQLiteCacheInspectionOptions): Promise<SQLiteCacheInspection> {
  const cacheFile = resolveCachePath(options);
  const sqliteBin = options.sqliteBin ?? DEFAULT_SQLITE_BIN;
  const expectedSnapshot = options.expectedSnapshot ? canonicalCacheSnapshot(options.expectedSnapshot) : undefined;
  const expectedSourceContentHash = options.expectedSourceContentHash ?? (expectedSnapshot ? hashContent(expectedSnapshot) : undefined);
  const expectedRecordCounts = expectedSnapshot ? snapshotRecordCounts(expectedSnapshot) : undefined;
  const sqliteAvailable = await checkSQLiteAvailable(sqliteBin);
  if (!existsSync(cacheFile)) {
    return {
      path: cacheFile,
      schemaVersion: SQLITE_CACHE_SCHEMA_VERSION,
      sqliteAvailable,
      ok: true,
      exists: false,
      stale: false,
      expectedSourceContentHash,
      expectedRecordCounts
    };
  }
  if (!sqliteAvailable) {
    return {
      path: cacheFile,
      schemaVersion: SQLITE_CACHE_SCHEMA_VERSION,
      sqliteAvailable,
      ok: false,
      exists: true,
      stale: true,
      expectedSourceContentHash,
      expectedRecordCounts,
      error: "sqlite3 executable is not available"
    };
  }

  try {
    const metadata = await readCacheMetadata(sqliteBin, cacheFile);
    const recordCounts = await readCacheRecordCounts(sqliteBin, cacheFile);
    const info = await stat(cacheFile);
    const sourceContentHash = metadata.sourceContentHash;
    const stale =
      metadata.schemaVersion !== SQLITE_CACHE_SCHEMA_VERSION ||
      (expectedSourceContentHash !== undefined && sourceContentHash !== expectedSourceContentHash) ||
      (expectedRecordCounts !== undefined && !recordCountsEqual(recordCounts, expectedRecordCounts));
    return {
      path: cacheFile,
      schemaVersion: SQLITE_CACHE_SCHEMA_VERSION,
      sqliteAvailable,
      ok: !stale,
      exists: true,
      stale,
      sourceContentHash,
      expectedSourceContentHash,
      recordCounts,
      expectedRecordCounts,
      sizeBytes: info.size,
      error: metadata.schemaVersion === SQLITE_CACHE_SCHEMA_VERSION ? undefined : "Unsupported SQLite cache schema version"
    };
  } catch (error) {
    return {
      path: cacheFile,
      schemaVersion: SQLITE_CACHE_SCHEMA_VERSION,
      sqliteAvailable,
      ok: false,
      exists: true,
      stale: true,
      expectedSourceContentHash,
      expectedRecordCounts,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function querySQLiteCacheRecords(options: SQLiteCacheQueryOptions): Promise<readonly SQLiteCacheRecordRow[]> {
  const cacheFile = resolveCachePath(options);
  const sqliteBin = options.sqliteBin ?? DEFAULT_SQLITE_BIN;
  const limit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 1000));
  if (options.section !== undefined && !CACHE_SECTIONS.includes(options.section)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Unknown SQLite cache section", { section: options.section });
  }
  if (!existsSync(cacheFile)) {
    throw new BorealError("BOREAL_NOT_FOUND", "SQLite cache does not exist; run `bwrk sync refresh --json`", {
      path: cacheFile
    });
  }
  if (!(await checkSQLiteAvailable(sqliteBin))) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "sqlite3 executable is not available");
  }

  const where = options.section === undefined ? "" : `WHERE section = ${sqlString(options.section)}`;
  const rows = await runSQLiteJson<SQLiteCacheRecordRow>(
    sqliteBin,
    cacheFile,
    `SELECT section, id, title, status, kind, updated_at AS updatedAt, content_hash AS contentHash, json
       FROM records
       ${where}
       ORDER BY section, id
       LIMIT ${limit};`
  );
  return rows;
}

function resolveCachePath(options: SQLiteCacheOptions): string {
  const rootDir = resolve(options.rootDir);
  const cacheFile = resolve(options.cacheFile ?? sqliteCachePath(rootDir));
  assertPathInside(rootDir, cacheFile);
  return cacheFile;
}

function canonicalCacheSnapshot(snapshot: StoreSnapshot): Record<SQLiteCacheSection, readonly unknown[]> {
  return {
    workItems: snapshot.workItems ?? [],
    agentSummaries: snapshot.agentSummaries ?? [],
    evidence: snapshot.evidence ?? [],
    verifications: snapshot.verifications ?? [],
    knowledgeSources: snapshot.knowledgeSources ?? [],
    claims: snapshot.claims ?? [],
    decisions: snapshot.decisions ?? [],
    graphEdges: snapshot.graphEdges ?? [],
    reservations: snapshot.reservations ?? [],
    events: snapshot.events ?? [],
    projections: snapshot.projections ?? [],
    contextPacks: snapshot.contextPacks ?? []
  };
}

function snapshotRecordCounts(snapshot: Record<SQLiteCacheSection, readonly unknown[]>): Record<SQLiteCacheSection, number> {
  return Object.fromEntries(CACHE_SECTIONS.map((section) => [section, snapshot[section].length])) as Record<
    SQLiteCacheSection,
    number
  >;
}

function buildRebuildSql(
  snapshot: Record<SQLiteCacheSection, readonly unknown[]>,
  sourceContentHash: string,
  recordCounts: Record<SQLiteCacheSection, number>
): string {
  const statements = [
    "PRAGMA journal_mode = OFF;",
    "PRAGMA synchronous = OFF;",
    "BEGIN;",
    "CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE TABLE records (section TEXT NOT NULL, id TEXT NOT NULL, title TEXT, status TEXT, kind TEXT, updated_at TEXT, content_hash TEXT, json TEXT NOT NULL, PRIMARY KEY (section, id));",
    "CREATE INDEX records_section_status_idx ON records(section, status);",
    "CREATE INDEX records_section_kind_idx ON records(section, kind);",
    insertMetadata("schemaVersion", SQLITE_CACHE_SCHEMA_VERSION),
    insertMetadata("sourceContentHash", sourceContentHash),
    insertMetadata("recordCounts", JSON.stringify(recordCounts))
  ];
  for (const section of CACHE_SECTIONS) {
    for (const record of snapshot[section]) {
      const row = cacheRecordRow(section, record);
      statements.push(
        `INSERT INTO records(section, id, title, status, kind, updated_at, content_hash, json) VALUES (${[
          row.section,
          row.id,
          row.title,
          row.status,
          row.kind,
          row.updatedAt,
          row.contentHash,
          row.json
        ]
          .map(sqlString)
          .join(", ")});`
      );
    }
  }
  statements.push("COMMIT;");
  return `${statements.join("\n")}\n`;
}

function insertMetadata(key: string, value: string): string {
  return `INSERT INTO metadata(key, value) VALUES (${sqlString(key)}, ${sqlString(value)});`;
}

function cacheRecordRow(section: SQLiteCacheSection, record: unknown): SQLiteCacheRecordRow {
  const object = isObject(record) ? record : {};
  const meta = isObject(object.meta) ? object.meta : {};
  const id = section === "contextPacks" ? stringField(object.id) : stringField(meta.id);
  return {
    section,
    id: id || `${section}:${hashContent(record).replace("sha256:", "").slice(0, 16)}`,
    title: stringField(object.title),
    status: stringField(object.status),
    kind: stringField(object.kind),
    updatedAt: stringField(meta.updatedAt) || stringField(object.generatedAt),
    contentHash: stringField(meta.contentHash) || hashContent(record),
    json: canonicalJson(record)
  };
}

async function readCacheMetadata(sqliteBin: string, cacheFile: string): Promise<Record<string, string>> {
  const rows = await runSQLiteJson<{ readonly key: string; readonly value: string }>(
    sqliteBin,
    cacheFile,
    "SELECT key, value FROM metadata;"
  );
  return Object.fromEntries(rows.map((row) => [row.key, row.value]));
}

async function readCacheRecordCounts(sqliteBin: string, cacheFile: string): Promise<Record<SQLiteCacheSection, number>> {
  const rows = await runSQLiteJson<{ readonly section: SQLiteCacheSection; readonly count: number }>(
    sqliteBin,
    cacheFile,
    "SELECT section, COUNT(*) AS count FROM records GROUP BY section;"
  );
  const counts = Object.fromEntries(CACHE_SECTIONS.map((section) => [section, 0])) as Record<SQLiteCacheSection, number>;
  for (const row of rows) {
    if (CACHE_SECTIONS.includes(row.section)) {
      counts[row.section] = Number(row.count);
    }
  }
  return counts;
}

function recordCountsEqual(left: Record<SQLiteCacheSection, number>, right: Record<SQLiteCacheSection, number>): boolean {
  return CACHE_SECTIONS.every((section) => left[section] === right[section]);
}

async function checkSQLiteAvailable(sqliteBin: string): Promise<boolean> {
  try {
    await runSQLite(sqliteBin, ["--version"]);
    return true;
  } catch {
    return false;
  }
}

async function runSQLiteJson<T>(sqliteBin: string, cacheFile: string, sql: string): Promise<readonly T[]> {
  const result = await runSQLite(sqliteBin, ["-json", cacheFile, sql]);
  if (result.trim().length === 0) {
    return [];
  }
  return JSON.parse(result) as readonly T[];
}

function runSQLite(sqliteBin: string, args: readonly string[], input?: string): Promise<string> {
  return runBoundedProcess({
    command: sqliteBin,
    args,
    input,
    timeoutMs: 30_000,
    stdoutMaxBytes: 16 * 1024 * 1024,
    stderrMaxBytes: 1024 * 1024
  }).then((result) => {
    if (result.exitCode === 0) {
      return result.stdout.text;
    }
    throw new BorealError("BOREAL_STORAGE_ERROR", "sqlite3 command failed", {
      exitCode: result.exitCode,
      stderr: result.stderr.text.trim()
    });
  }, (error: unknown) => {
    if (error instanceof BorealError) {
      throw error;
    }
    throw new BorealError("BOREAL_STORAGE_ERROR", "sqlite3 command failed", {
      error: error instanceof Error ? error.message : String(error)
    });
  });
}

function sqlString(value: string | undefined): string {
  if (value === undefined) {
    return "NULL";
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
