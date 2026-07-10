import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { BorealError, assertRealPathInside } from "@boreal/core";
import {
  MAX_SEARCH_QUERY_CHARS,
  tokenize,
  type FtsDocumentInput,
  type SearchDocumentType
} from "@boreal/search";

import { loadNodeSqlite, objectIndexPath, type NodeSqliteModule, type ObjectIndexHead } from "./object-index.js";
import {
  initializeSearchFtsSchema,
  removeSearchFtsDocuments,
  upsertSearchFtsDocuments,
  validateSearchFtsSchema
} from "./search-fts-schema.js";

type DatabaseSync = InstanceType<NodeSqliteModule["DatabaseSync"]>;
type SqlValue = string | number | bigint | null;

export type { FtsDocumentInput } from "@boreal/search";
export {
  SEARCH_FTS_SCHEMA_VERSION,
  clearSearchFtsDocuments as clearFtsDocuments,
  initializeSearchFtsSchema as initializeFtsSchema,
  removeSearchFtsDocuments as removeFtsDocuments,
  upsertSearchFtsDocuments as upsertFtsDocuments
} from "./search-fts-schema.js";

export interface FtsSearchOptions {
  readonly limit?: number;
  readonly types?: readonly string[];
}

export interface FtsSearchResult {
  readonly recordId: string;
  readonly type: string;
  readonly subjectId?: string;
  readonly title: string;
  readonly summary: string;
  readonly score: number;
  readonly snippet?: string;
  readonly matches: readonly string[];
}

export interface FtsSearchStatus {
  readonly available: boolean;
  readonly fresh: boolean;
  readonly integrityValid: boolean;
  readonly documentCount: number;
  readonly recordCount: number;
  readonly mismatchedCount: number;
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
    const create = options.create !== false;
    await assertRealPathInside(rootDir, path);
    if (!create && !existsSync(path)) {
      return undefined;
    }
    if (create) {
      await mkdir(dirname(path), { recursive: true });
    }

    let db: DatabaseSync | undefined;
    try {
      db = new sqlite.DatabaseSync(path, create ? { timeout: 250 } : { readOnly: true, timeout: 250 });
      const schemaValid = create ? initializeSearchFtsSchema(db) : validateSearchFtsSchema(db);
      if (!schemaValid) {
        db.close();
        if (!create) {
          throw invalidIndexError(path, "FTS schema is missing or obsolete");
        }
        return undefined;
      }
      return new FtsSearchIndex(db, path);
    } catch (error) {
      db?.close();
      if (isLockedSqliteError(error)) {
        throw new BorealError("BOREAL_CONFLICT", "Search index is busy; retry the command", { path });
      }
      if (error instanceof BorealError) {
        throw error;
      }
      throw invalidIndexError(path, error instanceof Error ? error.message : String(error));
    }
  }

  close(): void {
    this.db.close();
  }

  status(expectedHead: ObjectIndexHead): FtsSearchStatus {
    const head = readHead(this.db);
    const documentCount = this.count();
    const recordCount = searchableRecordCount(this.db);
    const mismatchedCount = mismatchedRecordCount(this.db);
    const integrityValid = sqliteIntegrityValid(this.db);
    return {
      available: true,
      fresh:
        integrityValid &&
        head?.seq === expectedHead.seq &&
        head.hash === expectedHead.hash &&
        documentCount === recordCount &&
        mismatchedCount === 0,
      integrityValid,
      documentCount,
      recordCount,
      mismatchedCount
    };
  }

  upsert(entries: readonly FtsDocumentInput[]): void {
    if (entries.length === 0) {
      return;
    }
    this.db.exec("BEGIN;");
    try {
      if (!upsertSearchFtsDocuments(this.db, entries)) {
        throw invalidIndexError(this.path, "FTS5 is unavailable");
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
    this.db.exec("BEGIN;");
    try {
      if (!removeSearchFtsDocuments(this.db, recordIds)) {
        throw invalidIndexError(this.path, "FTS5 is unavailable");
      }
      this.db.exec("COMMIT;");
    } catch (error) {
      rollback(this.db);
      throw error;
    }
  }

  count(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM search_fts;").get() as { readonly count?: SqlValue } | undefined;
    if (typeof row?.count !== "number") {
      throw invalidIndexError(this.path, "FTS document count is unreadable");
    }
    return row.count;
  }

  query(text: string, options: FtsSearchOptions = {}): readonly FtsSearchResult[] {
    if (text.length > MAX_SEARCH_QUERY_CHARS) {
      throw new BorealError("BOREAL_INVALID_INPUT", `Search query exceeds ${MAX_SEARCH_QUERY_CHARS} characters`, {
        maximum: MAX_SEARCH_QUERY_CHARS,
        actual: text.length
      });
    }
    const queryTokens = tokenize(text);
    const match = ftsMatchQuery(queryTokens);
    if (!match) {
      return [];
    }
    const limit = Math.min(100, Math.max(0, Math.floor(options.limit ?? 20)));
    if (limit === 0) {
      return [];
    }

    const requestedTypes = [...new Set(options.types ?? [])];
    if (requestedTypes.some((type) => !isSearchDocumentType(type))) {
      return [];
    }
    const types = requestedTypes as SearchDocumentType[];
    const typeFilter = types.length > 0 ? ` AND type IN (${types.map(() => "?").join(", ")})` : "";
    const rows = this.db
      .prepare(
        `SELECT record_id, type, subject_id, title, summary, id_text, label_text, body_text, state_text,
                bm25(search_fts, 0.0, 0.0, 0.0, 0.0, 8.0, 5.0, 10.0, 6.0, 3.0, 4.0) AS rank,
                snippet(search_fts, -1, '[', ']', '...', 12) AS snippet
         FROM search_fts
         WHERE search_fts MATCH ?${typeFilter}
         ORDER BY rank ASC, title ASC, record_id ASC
         LIMIT ?;`
      )
      .all(match, ...types, limit) as FtsRow[];

    const parsed = rows.flatMap((row) => parseFtsRow(row, queryTokens));
    const maximumScore = Math.max(0, ...parsed.map((result) => result.rawScore));
    return parsed.map(({ rawScore, ...result }) => ({
      ...result,
      score: maximumScore > 0 ? rawScore / maximumScore : 0
    }));
  }
}

export function ftsAvailableAtPath(path: string): boolean {
  return existsSync(path);
}

interface FtsRow {
  readonly record_id?: SqlValue;
  readonly type?: SqlValue;
  readonly subject_id?: SqlValue;
  readonly title?: SqlValue;
  readonly summary?: SqlValue;
  readonly id_text?: SqlValue;
  readonly label_text?: SqlValue;
  readonly body_text?: SqlValue;
  readonly state_text?: SqlValue;
  readonly rank?: SqlValue;
  readonly snippet?: SqlValue;
}

function parseFtsRow(
  row: FtsRow,
  queryTokens: readonly string[]
): readonly (Omit<FtsSearchResult, "score"> & { readonly rawScore: number })[] {
  if (
    typeof row.record_id !== "string" ||
    typeof row.type !== "string" ||
    typeof row.title !== "string" ||
    typeof row.summary !== "string" ||
    typeof row.rank !== "number"
  ) {
    return [];
  }
  const documentTokens = tokenize(
    [row.record_id, row.subject_id, row.title, row.summary, row.id_text, row.label_text, row.body_text, row.state_text]
      .filter((value): value is string => typeof value === "string")
      .join(" ")
  );
  const matches = queryTokens.filter((token) => documentTokens.some((candidate) => candidate.startsWith(token)));
  return [
    {
      recordId: row.record_id,
      type: row.type,
      ...(typeof row.subject_id === "string" && row.subject_id ? { subjectId: row.subject_id } : {}),
      title: row.title,
      summary: row.summary,
      rawScore: Math.max(0, -row.rank),
      matches,
      ...(typeof row.snippet === "string" && row.snippet.includes("[") ? { snippet: row.snippet } : {})
    }
  ];
}

function ftsMatchQuery(tokens: readonly string[]): string | undefined {
  if (tokens.length === 0) {
    return undefined;
  }
  return tokens.map((token) => `${escapeFtsToken(token)}*`).join(" OR ");
}

function escapeFtsToken(token: string): string {
  return `"${token.replace(/"/gu, "\"\"")}"`;
}

function searchableRecordCount(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM records
       WHERE section IN ('workItems', 'agentSummaries', 'evidence', 'knowledgeSources', 'claims', 'decisions');`
    )
    .get() as { readonly count?: SqlValue } | undefined;
  if (typeof row?.count !== "number") {
    throw new Error("Searchable record count is unreadable");
  }
  return row.count;
}

function mismatchedRecordCount(db: DatabaseSync): number {
  const row = db
    .prepare(
      `SELECT
         (SELECT COUNT(*)
          FROM records AS r
          LEFT JOIN search_fts AS f ON f.record_id = r.id
          WHERE r.section IN ('workItems', 'agentSummaries', 'evidence', 'knowledgeSources', 'claims', 'decisions')
            AND (f.record_id IS NULL OR f.content_hash <> r.content_hash OR f.type <> CASE r.section
              WHEN 'workItems' THEN 'work'
              WHEN 'agentSummaries' THEN 'agent_summary'
              WHEN 'evidence' THEN 'evidence'
              WHEN 'knowledgeSources' THEN 'source'
              WHEN 'claims' THEN 'claim'
              WHEN 'decisions' THEN 'decision'
            END))
         +
         (SELECT COUNT(*)
          FROM search_fts AS f
          LEFT JOIN records AS r ON r.id = f.record_id
          WHERE r.id IS NULL OR r.content_hash <> f.content_hash) AS count;`
    )
    .get() as { readonly count?: SqlValue } | undefined;
  if (typeof row?.count !== "number") {
    throw new Error("Search integrity comparison is unreadable");
  }
  return row.count;
}

function sqliteIntegrityValid(db: DatabaseSync): boolean {
  const row = db.prepare("PRAGMA quick_check(1);").get() as { readonly quick_check?: SqlValue } | undefined;
  return row?.quick_check === "ok";
}

function readHead(db: DatabaseSync): ObjectIndexHead | undefined {
  const row = db.prepare("SELECT seq, hash FROM head LIMIT 1;").get() as
    | { readonly seq?: SqlValue; readonly hash?: SqlValue }
    | undefined;
  if (typeof row?.seq !== "number" || typeof row.hash !== "string") {
    return undefined;
  }
  return { seq: row.seq, hash: row.hash };
}

function rollback(db: DatabaseSync): void {
  try {
    db.exec("ROLLBACK;");
  } catch {
    // The transaction may already be closed by SQLite after a hard error.
  }
}

function invalidIndexError(path: string, detail: string): BorealError {
  return new BorealError("BOREAL_STORAGE_ERROR", "Search index is invalid; run `bwrk search index`", {
    path,
    detail
  });
}

function isLockedSqliteError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /database is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
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
