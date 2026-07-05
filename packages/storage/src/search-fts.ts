import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { tokenize, type FtsDocumentInput, type SearchDocumentType } from "@boreal/search";

import { loadNodeSqlite, objectIndexPath, type NodeSqliteModule, type ObjectIndexHead } from "./object-index.js";

type DatabaseSync = InstanceType<NodeSqliteModule["DatabaseSync"]>;
type SqlValue = string | number | bigint | null;

export type { FtsDocumentInput } from "@boreal/search";

export interface FtsSearchOptions {
  readonly limit?: number;
  readonly types?: readonly string[];
}

export interface FtsSearchResult {
  readonly recordId: string;
  readonly type: string;
  readonly title: string;
  readonly summary: string;
  readonly score: number;
  readonly snippet?: string;
}

export interface FtsSearchStatus {
  readonly available: boolean;
  readonly fresh: boolean;
  readonly documentCount: number;
  readonly recordCount: number;
}

export class FtsSearchIndex {
  readonly path: string;

  private constructor(private readonly db: DatabaseSync, path: string) {
    this.path = path;
  }

  static async open(
    rootDir: string,
    options: {
      readonly sqlite?: NodeSqliteModule;
      readonly loadSqlite?: () => Promise<NodeSqliteModule | undefined>;
      readonly create?: boolean;
    } = {}
  ): Promise<FtsSearchIndex | undefined> {
    const sqlite = Object.hasOwn(options, "sqlite") ? options.sqlite : await (options.loadSqlite ?? loadNodeSqlite)();
    if (!sqlite) {
      return undefined;
    }
    const path = objectIndexPath(rootDir);
    if (options.create === false && !existsSync(path)) {
      return undefined;
    }
    await mkdir(dirname(path), { recursive: true });
    let db: DatabaseSync | undefined;
    try {
      db = new sqlite.DatabaseSync(path, { timeout: 250 });
      if (!initializeFtsSchema(db)) {
        db.close();
        return undefined;
      }
      return new FtsSearchIndex(db, path);
    } catch {
      db?.close();
      return undefined;
    }
  }

  close(): void {
    this.db.close();
  }

  status(expectedHead: ObjectIndexHead): FtsSearchStatus {
    const head = readHead(this.db);
    const documentCount = this.count();
    const recordCount = searchableRecordCount(this.db);
    return {
      available: true,
      fresh: head?.seq === expectedHead.seq && head.hash === expectedHead.hash && documentCount === recordCount,
      documentCount,
      recordCount
    };
  }

  upsert(entries: readonly FtsDocumentInput[]): void {
    if (entries.length === 0) {
      return;
    }
    const remove = this.db.prepare("DELETE FROM search_fts WHERE record_id = ?;");
    const insert = this.db.prepare(
      `INSERT INTO search_fts(record_id, type, title, summary, id_text, label_text, body_text, state_text)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
    );
    this.db.exec("BEGIN;");
    try {
      for (const entry of entries) {
        remove.run(entry.recordId);
        insert.run(entry.recordId, entry.type, entry.title, entry.summary, entry.idText, entry.labelText, entry.bodyText, entry.stateText);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  remove(recordIds: readonly string[]): void {
    if (recordIds.length === 0) {
      return;
    }
    const remove = this.db.prepare("DELETE FROM search_fts WHERE record_id = ?;");
    this.db.exec("BEGIN;");
    try {
      for (const recordId of recordIds) {
        remove.run(recordId);
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM search_fts;").get() as { readonly count?: SqlValue } | undefined;
    return typeof row?.count === "number" ? row.count : 0;
  }

  query(text: string, options: FtsSearchOptions = {}): readonly FtsSearchResult[] {
    const match = ftsMatchQuery(text);
    if (!match) {
      return [];
    }
    const limit = Math.max(0, options.limit ?? 20);
    if (limit === 0) {
      return [];
    }

    const types = [...new Set(options.types ?? [])].filter((type) => isSearchDocumentType(type));
    const typeFilter = types.length > 0 ? ` AND type IN (${types.map(() => "?").join(", ")})` : "";
    const rows = this.db
      .prepare(
        `SELECT record_id, type, title, summary,
                bm25(search_fts, 0.0, 0.0, 8.0, 5.0, 10.0, 6.0, 3.0, 4.0) AS rank,
                snippet(search_fts, 6, '[', ']', '...', 12) AS snippet
         FROM search_fts
         WHERE search_fts MATCH ?${typeFilter}
         ORDER BY rank ASC, title ASC, record_id ASC
         LIMIT ?;`
      )
      .all(match, ...types, limit) as Array<{
      readonly record_id?: SqlValue;
      readonly type?: SqlValue;
      readonly title?: SqlValue;
      readonly summary?: SqlValue;
      readonly rank?: SqlValue;
      readonly snippet?: SqlValue;
    }>;

    return rows.flatMap((row) => {
      if (
        typeof row.record_id !== "string" ||
        typeof row.type !== "string" ||
        typeof row.title !== "string" ||
        typeof row.summary !== "string" ||
        typeof row.rank !== "number"
      ) {
        return [];
      }
      return [
        {
          recordId: row.record_id,
          type: row.type,
          title: row.title,
          summary: row.summary,
          score: -row.rank,
          ...(typeof row.snippet === "string" && row.snippet.trim() ? { snippet: row.snippet } : {})
        }
      ];
    });
  }
}

export function initializeFtsSchema(db: DatabaseSync): boolean {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        record_id UNINDEXED,
        type UNINDEXED,
        title,
        summary,
        id_text,
        label_text,
        body_text,
        state_text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
    return true;
  } catch {
    return false;
  }
}

export function clearFtsDocuments(db: DatabaseSync): boolean {
  if (!initializeFtsSchema(db)) {
    return false;
  }
  db.prepare("DELETE FROM search_fts;").run();
  return true;
}

export function upsertFtsDocuments(db: DatabaseSync, entries: readonly FtsDocumentInput[]): boolean {
  if (!initializeFtsSchema(db)) {
    return false;
  }
  const remove = db.prepare("DELETE FROM search_fts WHERE record_id = ?;");
  const insert = db.prepare(
    `INSERT INTO search_fts(record_id, type, title, summary, id_text, label_text, body_text, state_text)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?);`
  );
  for (const entry of entries) {
    remove.run(entry.recordId);
    insert.run(entry.recordId, entry.type, entry.title, entry.summary, entry.idText, entry.labelText, entry.bodyText, entry.stateText);
  }
  return true;
}

export function removeFtsDocuments(db: DatabaseSync, recordIds: readonly string[]): boolean {
  if (!initializeFtsSchema(db)) {
    return false;
  }
  const remove = db.prepare("DELETE FROM search_fts WHERE record_id = ?;");
  for (const recordId of recordIds) {
    remove.run(recordId);
  }
  return true;
}

export function ftsAvailableAtPath(path: string): boolean {
  return existsSync(path);
}

function ftsMatchQuery(text: string): string | undefined {
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.map((token, index) => `${escapeFtsToken(token)}${index === tokens.length - 1 ? "*" : ""}`).join(" ");
}

function escapeFtsToken(token: string): string {
  return `"${token.replace(/"/gu, "\"\"")}"`;
}

function searchableRecordCount(db: DatabaseSync): number {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS count
         FROM records
         WHERE section IN ('workItems', 'agentSummaries', 'evidence', 'knowledgeSources', 'claims', 'decisions');`
      )
      .get() as { readonly count?: SqlValue } | undefined;
    return typeof row?.count === "number" ? row.count : 0;
  } catch {
    return 0;
  }
}

function readHead(db: DatabaseSync): ObjectIndexHead | undefined {
  try {
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
  } catch {
    return undefined;
  }
}

function rollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK;");
  } catch {
    // The transaction may already be closed by SQLite after a hard error.
  }
}

function isSearchDocumentType(value: string): value is SearchDocumentType {
  return (
    value === "work" ||
    value === "agent_summary" ||
    value === "evidence" ||
    value === "source" ||
    value === "claim" ||
    value === "decision"
  );
}
