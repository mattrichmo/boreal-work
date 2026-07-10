import type { FtsDocumentInput } from "@boreal/search";

import type { NodeSqliteModule } from "./object-index.js";

type DatabaseSync = InstanceType<NodeSqliteModule["DatabaseSync"]>;
type SqlValue = string | number | bigint | null;

export const SEARCH_FTS_SCHEMA_VERSION = "boreal.search-fts.v2";

export interface SearchFtsStatements {
  readonly remove: ReturnType<DatabaseSync["prepare"]>;
  readonly insert: ReturnType<DatabaseSync["prepare"]>;
}

const SEARCH_FTS_COLUMNS = [
  "record_id",
  "type",
  "content_hash",
  "subject_id",
  "title",
  "summary",
  "id_text",
  "label_text",
  "body_text",
  "state_text"
] as const;

export function initializeSearchFtsSchema(db: DatabaseSync): boolean {
  try {
    db.exec("CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    const storedVersion = readSearchFtsSchemaVersion(db);
    const existingColumns = searchFtsColumns(db);
    if (
      existingColumns.length > 0 &&
      (storedVersion !== SEARCH_FTS_SCHEMA_VERSION || !sameColumns(existingColumns, SEARCH_FTS_COLUMNS))
    ) {
      db.exec("DROP TABLE search_fts;");
    }
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
        record_id UNINDEXED,
        type UNINDEXED,
        content_hash UNINDEXED,
        subject_id UNINDEXED,
        title,
        summary,
        id_text,
        label_text,
        body_text,
        state_text,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `);
    db.prepare("INSERT OR REPLACE INTO metadata(key, value) VALUES ('ftsSchemaVersion', ?);").run(SEARCH_FTS_SCHEMA_VERSION);
    return true;
  } catch {
    return false;
  }
}

export function validateSearchFtsSchema(db: DatabaseSync): boolean {
  return (
    readSearchFtsSchemaVersion(db) === SEARCH_FTS_SCHEMA_VERSION &&
    sameColumns(searchFtsColumns(db), SEARCH_FTS_COLUMNS)
  );
}

export function clearSearchFtsDocuments(db: DatabaseSync): boolean {
  if (!initializeSearchFtsSchema(db)) {
    return false;
  }
  db.prepare("DELETE FROM search_fts;").run();
  return true;
}

export function searchFtsStatements(db: DatabaseSync): SearchFtsStatements {
  return {
    remove: db.prepare("DELETE FROM search_fts WHERE record_id = ?;"),
    insert: db.prepare(
      `INSERT INTO search_fts(
         record_id, type, content_hash, subject_id, title, summary, id_text, label_text, body_text, state_text
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`
    )
  };
}

export function upsertSearchFtsDocument(statements: SearchFtsStatements, entry: FtsDocumentInput): void {
  statements.remove.run(entry.recordId);
  statements.insert.run(
    entry.recordId,
    entry.type,
    entry.contentHash,
    entry.subjectId ?? null,
    entry.title,
    entry.summary,
    entry.idText,
    entry.labelText,
    entry.bodyText,
    entry.stateText
  );
}

export function upsertSearchFtsDocuments(db: DatabaseSync, entries: readonly FtsDocumentInput[]): boolean {
  if (!initializeSearchFtsSchema(db)) {
    return false;
  }
  const statements = searchFtsStatements(db);
  for (const entry of entries) {
    upsertSearchFtsDocument(statements, entry);
  }
  return true;
}

export function removeSearchFtsDocuments(db: DatabaseSync, recordIds: readonly string[]): boolean {
  if (!initializeSearchFtsSchema(db)) {
    return false;
  }
  const remove = db.prepare("DELETE FROM search_fts WHERE record_id = ?;");
  for (const recordId of recordIds) {
    remove.run(recordId);
  }
  return true;
}

function readSearchFtsSchemaVersion(db: DatabaseSync): string | undefined {
  try {
    const row = db.prepare("SELECT value FROM metadata WHERE key = 'ftsSchemaVersion';").get() as
      | { readonly value?: SqlValue }
      | undefined;
    return typeof row?.value === "string" ? row.value : undefined;
  } catch {
    return undefined;
  }
}

function searchFtsColumns(db: DatabaseSync): readonly string[] {
  try {
    const rows = db.prepare("PRAGMA table_info(search_fts);").all() as Array<{ readonly name?: SqlValue }>;
    return rows.flatMap((row) => (typeof row.name === "string" ? [row.name] : []));
  } catch {
    return [];
  }
}

function sameColumns(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length && actual.every((column, index) => column === expected[index]);
}
