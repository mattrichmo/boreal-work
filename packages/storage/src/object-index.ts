import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import { canonicalJson, deepFreeze, hashContent, resolveWorkspacePaths, type WorkItem } from "@boreal/core";
import { ftsDocumentInputFromFields, searchFieldsForRecord, type FtsDocumentInput, type SearchRecord, type SearchRecordSection } from "@boreal/search";

import type { StoreChange, StoreSectionName, StoreSnapshot } from "./memory-store.js";
import type { WorkItemFilter } from "./ports.js";
import {
  clearSearchFtsDocuments,
  initializeSearchFtsSchema,
  searchFtsStatements,
  upsertSearchFtsDocument
} from "./search-fts-schema.js";

export const OBJECT_INDEX_SCHEMA_VERSION = "boreal.object-index.v2";
export const OBJECT_INDEX_FILENAME = "index-v2.sqlite";

const WORK_ITEMS_FINGERPRINT_KEY = "workItemsFingerprint";

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

export class ObjectIndexCompatibilityError extends Error {
  readonly code = "BOREAL_OBJECT_INDEX_INCOMPATIBLE";
  readonly path: string;
  readonly actualSchemaVersion: string | undefined;

  constructor(path: string, actualSchemaVersion: string | undefined, cause?: unknown) {
    super(
      actualSchemaVersion
        ? `Object index schema ${actualSchemaVersion} is incompatible with ${OBJECT_INDEX_SCHEMA_VERSION}`
        : `Object index at ${path} has an unknown or unreadable schema`,
      cause === undefined ? undefined : { cause }
    );
    this.name = "ObjectIndexCompatibilityError";
    this.path = path;
    this.actualSchemaVersion = actualSchemaVersion;
  }
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
  "reviewerHeartbeats",
  "runs",
  "checkpoints",
  "eventCursors"
] as const satisfies readonly StoreSectionName[];

export function objectIndexPath(rootDir: string): string {
  const paths = resolveWorkspacePaths(rootDir);
  return join(paths.borealDir, "cache", OBJECT_INDEX_FILENAME);
}

export function objectIndexWorkItemsFingerprint(workItems: readonly unknown[]): string {
  return hashContent(
    workItems
      .map((record) => {
        const object = isRecord(record) ? record : {};
        const meta = isRecord(object.meta) ? object.meta : {};
        return {
          id: stringValue(meta.id) ?? hashContent(record),
          contentHash: hashContent(record)
        };
      })
      .sort((left, right) => left.id.localeCompare(right.id))
  );
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

  async status(expectedHead: ObjectIndexHead, expectedWorkItemsFingerprint?: string): Promise<ObjectIndexStatus> {
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
      if (!hasCurrentSchema(db)) {
        return { path: this.path, available: true, exists: true, fresh: false };
      }
      const storedHead = readHead(db);
      return {
        path: this.path,
        available: true,
        exists: storedHead !== undefined,
        fresh:
          headsEqual(storedHead, expectedHead) &&
          (expectedWorkItemsFingerprint === undefined || readMetadata(db, WORK_ITEMS_FINGERPRINT_KEY) === expectedWorkItemsFingerprint)
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

  async listWorkItems(
    filter: WorkItemFilter | undefined,
    expectedHead: ObjectIndexHead,
    expectedWorkItemsFingerprint: string
  ): Promise<readonly WorkItem[] | undefined> {
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
      if (
        !hasCurrentSchema(db) ||
        !headsEqual(readHead(db), expectedHead) ||
        readMetadata(db, WORK_ITEMS_FINGERPRINT_KEY) !== expectedWorkItemsFingerprint
      ) {
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
    try {
      await assertExistingIndexCompatible(sqlite, this.path);
    } catch (error) {
      if (isLockedSqliteError(error)) {
        return { path: this.path, available: false, changed: false };
      }
      throw error;
    }
    const temporaryPath = temporaryIndexPath(this.path);
    let db: DatabaseSync | undefined;
    try {
      db = new sqlite.DatabaseSync(temporaryPath, { timeout: 250 });
      initializeSchema(db, temporaryPath);
      try {
        db.exec("BEGIN;");
        db.prepare("DELETE FROM records;").run();
        const fts = clearSearchFtsDocuments(db) ? searchFtsStatements(db) : undefined;
        const insert = db.prepare(
          `INSERT OR REPLACE INTO records(section, id, status, kind, updated_at, content_hash, json)
           VALUES (?, ?, ?, ?, ?, ?, ?);`
        );
        for (const section of INDEXED_SECTIONS) {
          for (const record of snapshot[section] ?? []) {
            const row = indexRow(section, record);
            insert.run(row.section, row.id, row.status, row.kind, row.updatedAt, row.contentHash, row.json);
            const ftsDocument = ftsDocumentForRecord(section, record);
            if (fts && ftsDocument) {
              upsertSearchFtsDocument(fts, ftsDocument);
            }
          }
        }
        writeHead(db, head);
        writeMetadata(db, WORK_ITEMS_FINGERPRINT_KEY, objectIndexWorkItemsFingerprint(snapshot.workItems ?? []));
        db.exec("COMMIT;");
      } catch (error) {
        rollback(db);
        throw error;
      } finally {
        db.close();
        db = undefined;
      }
      await assertExistingIndexCompatible(sqlite, this.path);
      await removeSqliteSidecars(this.path);
      await rename(temporaryPath, this.path);
      return { path: this.path, available: true, changed: true };
    } catch (error) {
      if (isLockedSqliteError(error)) {
        return { path: this.path, available: false, changed: false };
      }
      throw error;
    } finally {
      db?.close();
      await removeSqliteFiles(temporaryPath);
    }
  }

  async applyChanges(
    changes: readonly StoreChange[],
    head: ObjectIndexHead,
    expectedPreviousHead: ObjectIndexHead | undefined,
    workItemsFingerprint: string
  ): Promise<ObjectIndexMutationResult> {
    const indexedChanges = changes.filter((change) => isIndexedSection(change.section));
    const sqlite = await this.sqlite();
    if (!sqlite) {
      return { path: this.path, available: false, changed: false };
    }
    if (!existsSync(this.path)) {
      return { path: this.path, available: true, changed: false };
    }
    if (indexedChanges.length === 0 && (await this.status(head, workItemsFingerprint)).fresh) {
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
      if (expectedPreviousHead) {
        const storedHead = readHead(db);
        if (!headsEqual(storedHead, expectedPreviousHead)) {
          return { path: this.path, available: true, changed: false };
        }
      }
      db.exec("BEGIN;");
      const upsert = db.prepare(
        `INSERT OR REPLACE INTO records(section, id, status, kind, updated_at, content_hash, json)
         VALUES (?, ?, ?, ?, ?, ?, ?);`
      );
      const remove = db.prepare("DELETE FROM records WHERE id = ?;");
      const fts = initializeSearchFtsSchema(db) ? searchFtsStatements(db) : undefined;
      for (const change of indexedChanges) {
        fts?.remove.run(change.id);
        if (change.record === null) {
          remove.run(change.id);
          continue;
        }
        const row = indexRow(change.section, change.record);
        upsert.run(row.section, row.id, row.status, row.kind, row.updatedAt, row.contentHash, row.json);
        const ftsDocument = ftsDocumentForRecord(change.section, change.record);
        if (fts && ftsDocument) {
          upsertSearchFtsDocument(fts, ftsDocument);
        }
      }
      writeHead(db, head);
      writeMetadata(db, WORK_ITEMS_FINGERPRINT_KEY, workItemsFingerprint);
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

  async invalidate(): Promise<void> {
    const sqlite = await this.sqlite();
    if (!sqlite || !existsSync(this.path)) {
      return;
    }
    await assertExistingIndexCompatible(sqlite, this.path);
    await removeSqliteFiles(this.path);
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
    await assertExistingIndexCompatible(sqlite, this.path);
    const db = new sqlite.DatabaseSync(this.path, { timeout: 250 });
    try {
      initializeSchema(db, this.path);
      return db;
    } catch (error) {
      db.close();
      throw error;
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

export function initializeObjectIndexSchema(db: DatabaseSync, path: string): void {
  initializeSchema(db, path);
}

export function objectIndexSchemaVersion(db: DatabaseSync): string | undefined {
  return readMetadata(db, "schemaVersion");
}

function initializeSchema(db: DatabaseSync, path: string): void {
  const existingTables = userTableNames(db);
  if (existingTables.length > 0) {
    const schemaVersion = readMetadata(db, "schemaVersion");
    if (schemaVersion !== OBJECT_INDEX_SCHEMA_VERSION) {
      throw new ObjectIndexCompatibilityError(path, schemaVersion);
    }
  }
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
  writeMetadata(db, "schemaVersion", OBJECT_INDEX_SCHEMA_VERSION);
}

async function assertExistingIndexCompatible(sqlite: NodeSqliteModule, path: string): Promise<void> {
  if (!existsSync(path)) {
    return;
  }
  let db: DatabaseSync | undefined;
  try {
    db = new sqlite.DatabaseSync(path, { readOnly: true, timeout: 100 });
    const schemaVersion = objectIndexSchemaVersion(db);
    if (schemaVersion !== OBJECT_INDEX_SCHEMA_VERSION) {
      throw new ObjectIndexCompatibilityError(path, schemaVersion);
    }
  } catch (error) {
    if (error instanceof ObjectIndexCompatibilityError || isLockedSqliteError(error)) {
      throw error;
    }
    throw new ObjectIndexCompatibilityError(path, undefined, error);
  } finally {
    db?.close();
  }
}

function hasCurrentSchema(db: DatabaseSync): boolean {
  try {
    return objectIndexSchemaVersion(db) === OBJECT_INDEX_SCHEMA_VERSION;
  } catch {
    return false;
  }
}

function userTableNames(db: DatabaseSync): readonly string[] {
  return (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")
      .all() as Array<{ readonly name?: SqlValue }>
  ).flatMap((row) => (typeof row.name === "string" ? [row.name] : []));
}

function readMetadata(db: DatabaseSync, key: string): string | undefined {
  const metadataExists = db
    .prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'metadata' LIMIT 1;")
    .get() as { readonly found?: SqlValue } | undefined;
  if (metadataExists?.found !== 1) {
    return undefined;
  }
  const row = db.prepare("SELECT value FROM metadata WHERE key = ?;").get(key) as { readonly value?: SqlValue } | undefined;
  return typeof row?.value === "string" ? row.value : undefined;
}

function writeMetadata(db: DatabaseSync, key: string, value: string): void {
  db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES (?, ?);").run(key, value);
}

function temporaryIndexPath(path: string): string {
  return join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
}

async function removeSqliteFiles(path: string): Promise<void> {
  await Promise.all([rm(path, { force: true }), removeSqliteSidecars(path)]);
}

async function removeSqliteSidecars(path: string): Promise<void> {
  await Promise.all([`${path}-journal`, `${path}-shm`, `${path}-wal`].map((candidate) => rm(candidate, { force: true })));
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

function ftsDocumentForRecord(section: StoreSectionName, record: unknown): FtsDocumentInput | undefined {
  if (!isSearchRecordSection(section)) {
    return undefined;
  }
  if (!isRecord(record)) {
    return undefined;
  }
  return ftsDocumentInputFromFields(searchFieldsForRecord(section, record as unknown as SearchRecord));
}

function isSearchRecordSection(section: StoreSectionName): section is SearchRecordSection {
  return (
    section === "workItems" ||
    section === "agentSummaries" ||
    section === "evidence" ||
    section === "knowledgeSources" ||
    section === "claims" ||
    section === "decisions"
  );
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
