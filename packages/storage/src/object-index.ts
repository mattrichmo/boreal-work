import { existsSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { canonicalJson, deepFreeze, hashContent, resolveWorkspacePaths, type WorkItem } from "@boreal/core";

import type { StoreChange, StoreSectionName, StoreSnapshot } from "./memory-store.js";
import type { WorkItemFilter } from "./ports.js";

export const OBJECT_INDEX_SCHEMA_VERSION = "boreal.object-index.v1";

export type NodeSqliteModule = typeof import("node:sqlite");

export interface ObjectIndexHead {
  readonly seq: number;
  readonly hash: string;
}

export interface ObjectReadIndexOptions {
  readonly path: string;
  readonly sqlite?: NodeSqliteModule;
  readonly loadSqlite?: () => Promise<NodeSqliteModule | undefined>;
}

export interface ObjectIndexStatus {
  readonly path: string;
  readonly available: boolean;
  readonly exists: boolean;
  readonly fresh: boolean;
}

export interface ObjectIndexMutationResult {
  readonly path: string;
  readonly available: boolean;
  readonly changed: boolean;
}

type DatabaseSync = InstanceType<NodeSqliteModule["DatabaseSync"]>;
type SqlValue = string | number | bigint | null;

const INDEXED_SECTIONS = [
  "workItems",
  "agentSummaries",
  "evidence",
  "verifications",
  "directiveAcknowledgements",
  "knowledgeSources",
  "claims",
  "decisions",
  "graphEdges",
  "reservations",
  "reviewerHeartbeats"
] as const satisfies readonly StoreSectionName[];

export function objectIndexPath(rootDir: string): string {
  const paths = resolveWorkspacePaths(rootDir);
  return join(paths.borealDir, "cache", "index.sqlite");
}

export async function loadNodeSqlite(): Promise<NodeSqliteModule | undefined> {
  try {
    return await import("node:sqlite");
  } catch {
    return undefined;
  }
}

export class ObjectReadIndex {
  readonly path: string;

  readonly #providedSqlite: NodeSqliteModule | undefined;
  readonly #loadSqlite: (() => Promise<NodeSqliteModule | undefined>) | undefined;
  #sqlite: NodeSqliteModule | undefined;
  #sqliteLoaded = false;

  constructor(options: ObjectReadIndexOptions) {
    this.path = resolve(options.path);
    const hasExplicitSqlite = Object.hasOwn(options, "sqlite");
    this.#providedSqlite = options.sqlite;
    this.#loadSqlite = hasExplicitSqlite ? undefined : (options.loadSqlite ?? loadNodeSqlite);
  }

  async status(expectedHead: ObjectIndexHead): Promise<ObjectIndexStatus> {
    const sqlite = await this.sqlite();
    if (!sqlite) {
      return { path: this.path, available: false, exists: false, fresh: false };
    }
    if (!existsSync(this.path)) {
      return { path: this.path, available: true, exists: false, fresh: false };
    }

    let db: DatabaseSync;
    try {
      db = this.openReadonly(sqlite);
    } catch (error) {
      return this.statusForOpenError(error);
    }
    try {
      const storedHead = readHead(db);
      return {
        path: this.path,
        available: true,
        exists: storedHead !== undefined,
        fresh: headsEqual(storedHead, expectedHead)
      };
    } catch (error) {
      if (isLockedSqliteError(error)) {
        return { path: this.path, available: false, exists: true, fresh: false };
      }
      return { path: this.path, available: true, exists: true, fresh: false };
    } finally {
      db.close();
    }
  }

  async listWorkItems(filter: WorkItemFilter | undefined, expectedHead: ObjectIndexHead): Promise<readonly WorkItem[] | undefined> {
    const sqlite = await this.sqlite();
    if (!sqlite) {
      return undefined;
    }
    if (!existsSync(this.path)) {
      return undefined;
    }

    let db: DatabaseSync;
    try {
      db = this.openReadonly(sqlite);
    } catch {
      return undefined;
    }
    try {
      if (!headsEqual(readHead(db), expectedHead)) {
        return undefined;
      }
      const rows = queryWorkRows(db, filter);
      return rows.map((row) => deepFreeze(JSON.parse(row.json) as WorkItem)).filter((item) => matchesWorkFilter(item, filter));
    } catch {
      return undefined;
    } finally {
      db.close();
    }
  }

  async rebuild(snapshot: StoreSnapshot, head: ObjectIndexHead): Promise<ObjectIndexMutationResult> {
    const sqlite = await this.sqlite();
    if (!sqlite) {
      return { path: this.path, available: false, changed: false };
    }

    await mkdir(dirname(this.path), { recursive: true });
    let db: DatabaseSync;
    try {
      db = await this.openWritable(sqlite);
    } catch (error) {
      if (isLockedSqliteError(error)) {
        return { path: this.path, available: false, changed: false };
      }
      throw error;
    }
    try {
      db.exec("BEGIN;");
      db.prepare("DELETE FROM records;").run();
      const insert = db.prepare(
        `INSERT OR REPLACE INTO records(section, id, status, kind, updated_at, content_hash, json)
         VALUES (?, ?, ?, ?, ?, ?, ?);`
      );
      for (const section of INDEXED_SECTIONS) {
        for (const record of snapshot[section] ?? []) {
          const row = indexRow(section, record);
          insert.run(row.section, row.id, row.status, row.kind, row.updatedAt, row.contentHash, row.json);
        }
      }
      writeHead(db, head);
      db.exec("COMMIT;");
      return { path: this.path, available: true, changed: true };
    } catch (error) {
      rollback(db);
      if (isLockedSqliteError(error)) {
        return { path: this.path, available: false, changed: false };
      }
      throw error;
    } finally {
      db.close();
    }
  }

  async applyChanges(changes: readonly StoreChange[], head: ObjectIndexHead): Promise<ObjectIndexMutationResult> {
    const indexedChanges = changes.filter((change) => isIndexedSection(change.section));
    const sqlite = await this.sqlite();
    if (!sqlite) {
      return { path: this.path, available: false, changed: false };
    }
    if (indexedChanges.length === 0 && (await this.status(head)).fresh) {
      return { path: this.path, available: true, changed: false };
    }

    await mkdir(dirname(this.path), { recursive: true });
    let db: DatabaseSync;
    try {
      db = await this.openWritable(sqlite);
    } catch (error) {
      if (isLockedSqliteError(error)) {
        return { path: this.path, available: false, changed: false };
      }
      throw error;
    }
    try {
      db.exec("BEGIN;");
      const upsert = db.prepare(
        `INSERT OR REPLACE INTO records(section, id, status, kind, updated_at, content_hash, json)
         VALUES (?, ?, ?, ?, ?, ?, ?);`
      );
      const remove = db.prepare("DELETE FROM records WHERE id = ?;");
      for (const change of indexedChanges) {
        if (change.record === null) {
          remove.run(change.id);
          continue;
        }
        const row = indexRow(change.section, change.record);
        upsert.run(row.section, row.id, row.status, row.kind, row.updatedAt, row.contentHash, row.json);
      }
      writeHead(db, head);
      db.exec("COMMIT;");
      return { path: this.path, available: true, changed: indexedChanges.length > 0 };
    } catch (error) {
      rollback(db);
      if (isLockedSqliteError(error)) {
        return { path: this.path, available: false, changed: false };
      }
      throw error;
    } finally {
      db.close();
    }
  }

  private async sqlite(): Promise<NodeSqliteModule | undefined> {
    if (this.#providedSqlite) {
      return this.#providedSqlite;
    }
    if (!this.#loadSqlite) {
      return undefined;
    }
    if (!this.#sqliteLoaded) {
      this.#sqlite = await this.#loadSqlite();
      this.#sqliteLoaded = true;
    }
    return this.#sqlite;
  }

  private openReadonly(sqlite: NodeSqliteModule): DatabaseSync {
    return new sqlite.DatabaseSync(this.path, { readOnly: true, timeout: 100 });
  }

  private async openWritable(sqlite: NodeSqliteModule): Promise<DatabaseSync> {
    await mkdir(dirname(this.path), { recursive: true });
    const db = new sqlite.DatabaseSync(this.path, { timeout: 250 });
    try {
      initializeSchema(db);
      return db;
    } catch (error) {
      db.close();
      if (isLockedSqliteError(error)) {
        throw error;
      }
      await rm(this.path, { force: true });
      const retry = new sqlite.DatabaseSync(this.path, { timeout: 250 });
      initializeSchema(retry);
      return retry;
    }
  }

  private statusForOpenError(error: unknown): ObjectIndexStatus {
    if (isLockedSqliteError(error)) {
      return { path: this.path, available: false, exists: true, fresh: false };
    }
    return { path: this.path, available: true, exists: true, fresh: false };
  }
}

interface IndexRow {
  readonly section: string;
  readonly id: string;
  readonly status: string | null;
  readonly kind: string | null;
  readonly updatedAt: string | null;
  readonly contentHash: string;
  readonly json: string;
}

function initializeSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS records (
      section TEXT NOT NULL,
      id TEXT PRIMARY KEY,
      status TEXT,
      kind TEXT,
      updated_at TEXT,
      content_hash TEXT,
      json TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS records_section_status_idx ON records(section, status);
    CREATE INDEX IF NOT EXISTS records_section_kind_idx ON records(section, kind);
    CREATE TABLE IF NOT EXISTS head (seq INTEGER NOT NULL, hash TEXT NOT NULL);
  `);
  const row = db.prepare("SELECT value FROM metadata WHERE key = 'schemaVersion';").get() as { value?: SqlValue } | undefined;
  if (row?.value !== undefined && row.value !== OBJECT_INDEX_SCHEMA_VERSION) {
    resetSchema(db);
    return;
  }
  db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('schemaVersion', ?);").run(OBJECT_INDEX_SCHEMA_VERSION);
}

function resetSchema(db: DatabaseSync): void {
  db.exec(`
    DROP TABLE IF EXISTS metadata;
    DROP TABLE IF EXISTS records;
    DROP TABLE IF EXISTS head;
  `);
  initializeSchema(db);
}

function indexRow(section: StoreSectionName, record: unknown): IndexRow {
  const object = isRecord(record) ? record : {};
  const meta = isRecord(object.meta) ? object.meta : {};
  return {
    section,
    id: stringValue(meta.id) ?? `${section}:${hashContent(record).replace("sha256:", "").slice(0, 16)}`,
    status: stringValue(object.status) ?? null,
    kind: stringValue(object.kind) ?? null,
    updatedAt: stringValue(meta.updatedAt) ?? null,
    contentHash: stringValue(meta.contentHash) ?? hashContent(record),
    json: canonicalJson(record)
  };
}

function queryWorkRows(db: DatabaseSync, filter: WorkItemFilter | undefined): Array<{ readonly json: string }> {
  if (filter?.status) {
    return db
      .prepare("SELECT json FROM records WHERE section = 'workItems' AND status = ? ORDER BY id;")
      .all(filter.status) as Array<{ readonly json: string }>;
  }
  return db.prepare("SELECT json FROM records WHERE section = 'workItems' ORDER BY id;").all() as Array<{ readonly json: string }>;
}

function readHead(db: DatabaseSync): ObjectIndexHead | undefined {
  const row = db.prepare("SELECT seq, hash FROM head LIMIT 1;").get() as
    | {
        readonly seq?: SqlValue;
        readonly hash?: SqlValue;
      }
    | undefined;
  if (typeof row?.seq !== "number" || typeof row.hash !== "string") {
    return undefined;
  }
  return { seq: row.seq, hash: row.hash };
}

function writeHead(db: DatabaseSync, head: ObjectIndexHead): void {
  db.prepare("DELETE FROM head;").run();
  db.prepare("INSERT INTO head(seq, hash) VALUES (?, ?);").run(head.seq, head.hash);
}

function headsEqual(stored: ObjectIndexHead | undefined, expected: ObjectIndexHead): boolean {
  return stored?.seq === expected.seq && stored.hash === expected.hash;
}

function isIndexedSection(section: StoreSectionName): boolean {
  return INDEXED_SECTIONS.includes(section as (typeof INDEXED_SECTIONS)[number]);
}

function matchesWorkFilter(item: WorkItem, filter: WorkItemFilter | undefined): boolean {
  if (!filter) {
    return true;
  }
  if (filter.status && item.status !== filter.status) {
    return false;
  }
  if (filter.labels && !filter.labels.every((label) => item.labels.includes(label))) {
    return false;
  }
  return true;
}

function rollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK;");
  } catch {
    // The transaction may already be closed by SQLite after a hard error.
  }
}

function isLockedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
