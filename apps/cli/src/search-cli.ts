import { existsSync } from "node:fs";
import { open, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  BorealError,
  normalizeSearchQuery,
  nowIso,
  readJsonFile,
  type ContentHash,
  type EnforcementGap
} from "@boreal/core";
import {
  buildSearchIndex,
  isSearchIndexDocument,
  querySearchIndex,
  SEARCH_INDEX_ALGORITHM,
  SEARCH_INDEX_SCHEMA_VERSION,
  searchCorpusFingerprint,
  type SearchCorpusSnapshot,
  type SearchDocumentType,
  type SearchIndexDocument,
  type SearchResult
} from "@boreal/search";
import {
  FileEventLog,
  FtsSearchIndex,
  type FtsSearchResult,
  loadNodeSqlite,
  normalizeFileLockOptions,
  ObjectReadIndex,
  objectIndexPath,
  type StoreSnapshot,
  withFileLock,
  writeTextFileAtomic
} from "@boreal/storage";

import type { CliContext } from "./context.js";

const SEARCH_INDEX_MAX_READ_BYTES = 100 * 1024 * 1024;
const SEARCH_INDEX_METADATA_READ_BYTES = 64 * 1024;
const SEARCH_INDEX_LOCK_RETRY_ATTEMPTS = 3;
const SEARCH_INDEX_LOCK_RETRY_DELAY_MS = 100;
const SEARCH_FINGERPRINT_SECTIONS = [
  "workItems",
  "agentSummaries",
  "evidence",
  "knowledgeSources",
  "claims",
  "decisions"
] as const;

export interface SearchIndexWriteResult {
  readonly path: string;
  readonly mode?: "json" | "fts";
  readonly schemaVersion: SearchIndexDocument["schemaVersion"];
  readonly builtAt: string;
  readonly contentHash: ContentHash;
  readonly corpusFingerprint?: ContentHash;
  readonly documentCount: number;
  readonly tokenCount: number;
}

export interface SearchIndexInspection {
  readonly path: string;
  readonly mode?: "json" | "fts";
  readonly exists: boolean;
  readonly stale: boolean;
  readonly expectedCorpusFingerprint: ContentHash;
  readonly expectedContentHash?: ContentHash;
  readonly contentHash?: ContentHash;
  readonly corpusFingerprint?: ContentHash;
  readonly builtAt?: string;
  readonly documentCount?: number;
  readonly tokenCount?: number;
  readonly error?: string;
}

export interface SearchCommandOptions {
  readonly limit?: number;
  readonly type?: SearchDocumentType;
  readonly types?: readonly SearchDocumentType[];
  readonly explain?: boolean;
  readonly rebuildStaleIndex?: boolean;
}

export async function writeSearchIndex(context: CliContext): Promise<SearchIndexWriteResult> {
  return withSearchIndexLockRetry(context, () =>
    withFileLock(searchIndexLockDir(context), normalizeFileLockOptions(), async () => {
      return writeSearchIndexUnlocked(context);
    })
  );
}

export async function inspectSearchIndex(context: CliContext): Promise<SearchIndexInspection> {
  const ftsInspection = await inspectFtsSearchIndex(context);
  if (ftsInspection) {
    return ftsInspection;
  }

  const path = searchIndexPath(context);
  const snapshot = await readSearchFingerprintSnapshot(context);
  const expectedCorpusFingerprint = searchCorpusFingerprint(snapshot);
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      stale: true,
      expectedCorpusFingerprint
    };
  }

  try {
    const metadata = await readSearchIndexMetadata(path);
    return {
      path,
      exists: true,
      stale: metadata.corpusFingerprint === undefined || metadata.corpusFingerprint !== expectedCorpusFingerprint,
      expectedCorpusFingerprint,
      contentHash: metadata.contentHash,
      corpusFingerprint: metadata.corpusFingerprint,
      builtAt: metadata.builtAt,
      documentCount: metadata.documentCount,
      tokenCount: metadata.tokenCount
    };
  } catch (error) {
    return {
      path,
      exists: true,
      stale: true,
      expectedCorpusFingerprint,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function runSearch(
  context: CliContext,
  query: string,
  options: SearchCommandOptions = {}
): Promise<readonly SearchResult[]> {
  const normalizedQuery = normalizeSearchQuery(query);
  if (!normalizedQuery) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Search query is required");
  }

  const ftsResults = await queryFtsSearchIndex(context, normalizedQuery, options);
  if (ftsResults) {
    return ftsResults;
  }

  const index = await loadFreshSearchIndex(context, { rebuildStaleIndex: options.rebuildStaleIndex ?? true });
  return querySearchIndex(index, normalizedQuery, options);
}

export function searchIndexPath(context: CliContext): string {
  return join(context.paths.runtimeDir, "search-index.json");
}

export function searchIndexLockDir(context: CliContext): string {
  return join(context.paths.runtimeDir, "search-index.lock");
}

async function loadFreshSearchIndex(
  context: CliContext,
  options: { readonly rebuildStaleIndex: boolean }
): Promise<SearchIndexDocument> {
  const inspection = await inspectSearchIndex(context);
  if (!inspection.exists) {
    if (options.rebuildStaleIndex) {
      await rebuildSearchIndexIfStillNeeded(context);
      return readSearchIndex(inspection.path);
    }
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Search index is missing; run `bwrk search index`", {
      path: inspection.path,
      expectedCorpusFingerprint: inspection.expectedCorpusFingerprint,
      expectedContentHash: inspection.expectedContentHash,
      domain: "workflow"
    });
  }
  if (inspection.error) {
    if (options.rebuildStaleIndex) {
      await rebuildSearchIndexIfStillNeeded(context);
      return readSearchIndex(inspection.path);
    }
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Search index is invalid; run `bwrk search index`", {
      path: inspection.path,
      error: inspection.error,
      domain: "workflow"
    });
  }
  if (inspection.stale) {
    if (options.rebuildStaleIndex) {
      await rebuildSearchIndexIfStillNeeded(context);
      return readSearchIndex(inspection.path);
    }
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Search index is stale; run `bwrk search index`", {
      path: inspection.path,
      contentHash: inspection.contentHash,
      corpusFingerprint: inspection.corpusFingerprint,
      expectedCorpusFingerprint: inspection.expectedCorpusFingerprint,
      expectedContentHash: inspection.expectedContentHash,
      domain: "workflow"
    });
  }
  return readSearchIndex(inspection.path);
}

async function rebuildSearchIndexIfStillNeeded(context: CliContext): Promise<SearchIndexWriteResult | undefined> {
  return withSearchIndexLockRetry(context, () =>
    withFileLock(searchIndexLockDir(context), normalizeFileLockOptions(), async () => {
      const inspection = await inspectSearchIndex(context);
      if (inspection.exists && !inspection.stale && !inspection.error) {
        return undefined;
      }
      try {
        return await writeJsonSearchIndexUnlocked(context);
      } catch (error) {
        const gaps = [
          {
            code: "doctor.recovery.required",
            subjectType: "workspace",
            subjectId: context.workspaceRoot,
            data: {
              reason: "automatic search index rebuild failed"
            }
          }
        ] satisfies readonly EnforcementGap[];
        throw new BorealError(
          "BOREAL_POLICY_VIOLATION",
          "Automatic search index rebuild failed; run `bwrk doctor --strict --json`",
          {
            doNotRetry: true,
            repairCommand: "bwrk doctor --strict --json",
            indexPath: searchIndexPath(context),
            originalError: error instanceof Error ? error.message : String(error),
            gaps,
            domain: "workflow"
          },
          gaps
        );
      }
    })
  );
}

async function withSearchIndexLockRetry<T>(context: CliContext, operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= SEARCH_INDEX_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSearchIndexLockConflict(error, context) || attempt === SEARCH_INDEX_LOCK_RETRY_ATTEMPTS) {
        throw error;
      }
      lastError = error;
      await sleep(SEARCH_INDEX_LOCK_RETRY_DELAY_MS);
    }
  }
  throw lastError;
}

function isSearchIndexLockConflict(error: unknown, context: CliContext): boolean {
  if (!(error instanceof BorealError) || error.code !== "BOREAL_CONFLICT") {
    return false;
  }
  const details = error.details;
  return (
    typeof details === "object" &&
    details !== null &&
    "lockDir" in details &&
    (details as { readonly lockDir?: unknown }).lockDir === searchIndexLockDir(context)
  );
}

async function writeSearchIndexUnlocked(context: CliContext): Promise<SearchIndexWriteResult> {
  const ftsResult = await writeFtsSearchIndexIfAvailable(context);
  if (ftsResult) {
    return ftsResult;
  }
  return writeJsonSearchIndexUnlocked(context);
}

async function writeJsonSearchIndexUnlocked(context: CliContext): Promise<SearchIndexWriteResult> {
  const snapshot = await readSearchSnapshot(context);
  const index = buildSearchIndex(snapshot, nowIso());
  const path = searchIndexPath(context);
  await writeTextFileAtomic(path, `${JSON.stringify(index)}\n`);
  return { ...indexWriteResult(path, index), mode: "json" };
}

async function queryFtsSearchIndex(
  context: CliContext,
  query: string,
  options: SearchCommandOptions
): Promise<readonly SearchResult[] | undefined> {
  if (options.explain) {
    return undefined;
  }
  const fts = await FtsSearchIndex.open(context.workspaceRoot, { create: false });
  if (!fts) {
    return undefined;
  }
  try {
    const head = await new FileEventLog({ path: context.paths.eventLogFile }).head();
    if (!fts.status(head).fresh) {
      return undefined;
    }
    const types = [...(options.type ? [options.type] : []), ...(options.types ?? [])];
    return fts.query(query, { limit: options.limit, types }).map(ftsResultToSearchResult);
  } finally {
    fts.close();
  }
}

async function inspectFtsSearchIndex(context: CliContext): Promise<SearchIndexInspection | undefined> {
  const fts = await FtsSearchIndex.open(context.workspaceRoot, { create: false });
  if (!fts) {
    return undefined;
  }
  try {
    const head = await new FileEventLog({ path: context.paths.eventLogFile }).head();
    const status = fts.status(head);
    if (!status.fresh) {
      return undefined;
    }
    const snapshot = await readSearchFingerprintSnapshot(context);
    const corpusFingerprint = searchCorpusFingerprint(snapshot);
    return {
      path: fts.path,
      mode: "fts",
      exists: true,
      stale: false,
      expectedCorpusFingerprint: corpusFingerprint,
      contentHash: head.hash as ContentHash,
      corpusFingerprint,
      builtAt: nowIso(),
      documentCount: status.documentCount,
      tokenCount: 0
    };
  } finally {
    fts.close();
  }
}

async function writeFtsSearchIndexIfAvailable(context: CliContext): Promise<SearchIndexWriteResult | undefined> {
  const sqlite = await loadNodeSqlite();
  if (!sqlite) {
    return undefined;
  }
  const snapshot = await readFullStoreSnapshot(context);
  const head = await new FileEventLog({ path: context.paths.eventLogFile }).head();
  const objectIndex = new ObjectReadIndex({ path: objectIndexPath(context.workspaceRoot), sqlite });
  const rebuilt = await objectIndex.rebuild(snapshot, head);
  if (!rebuilt.available) {
    return undefined;
  }
  const fts = await FtsSearchIndex.open(context.workspaceRoot, { sqlite });
  if (!fts) {
    return undefined;
  }
  try {
    const status = fts.status(head);
    if (!status.fresh) {
      return undefined;
    }
    await rm(searchIndexPath(context), { force: true });
    const corpusFingerprint = searchCorpusFingerprint(searchSnapshotFromStoreSnapshot(snapshot));
    return {
      path: fts.path,
      mode: "fts",
      schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
      builtAt: nowIso(),
      contentHash: head.hash as ContentHash,
      corpusFingerprint,
      documentCount: status.documentCount,
      tokenCount: 0
    };
  } finally {
    fts.close();
  }
}

function ftsResultToSearchResult(result: FtsSearchResult): SearchResult {
  return {
    id: `${result.type}:${result.recordId}`,
    type: result.type as SearchResult["type"],
    recordId: result.recordId,
    title: result.title,
    summary: result.summary,
    snippet: result.snippet,
    score: result.score,
    matches: result.snippet ? [result.snippet] : []
  };
}

function searchSnapshotFromStoreSnapshot(snapshot: StoreSnapshot): SearchCorpusSnapshot {
  return {
    workItems: snapshot.workItems ?? [],
    agentSummaries: snapshot.agentSummaries ?? [],
    evidence: snapshot.evidence ?? [],
    knowledgeSources: snapshot.knowledgeSources ?? [],
    claims: snapshot.claims ?? [],
    decisions: snapshot.decisions ?? []
  };
}

async function readFullStoreSnapshot(context: CliContext): Promise<StoreSnapshot> {
  return context.store.read(async (reader) => {
    const [
      workItems,
      agentSummaries,
      evidence,
      verifications,
      directiveAcknowledgements,
      knowledgeSources,
      claims,
      decisions,
      graphEdges,
      reservations,
      reviewerHeartbeats,
      events,
      operations,
      projections,
      contextPacks
    ] = await Promise.all([
      reader.listWorkItems(),
      reader.listAgentSummaries(),
      reader.listEvidence(),
      reader.listVerifications(),
      reader.listDirectiveAcknowledgements(),
      reader.listKnowledgeSources(),
      reader.listClaims(),
      reader.listDecisions(),
      reader.listGraphEdges(),
      reader.listReservations(),
      reader.listReviewerHeartbeats(),
      reader.listEvents(),
      reader.listOperations(),
      reader.listProjections(),
      reader.listContextPacks()
    ]);
    return {
      workItems,
      agentSummaries,
      evidence,
      verifications,
      directiveAcknowledgements,
      knowledgeSources,
      claims,
      decisions,
      graphEdges,
      reservations,
      reviewerHeartbeats,
      events,
      operations,
      projections,
      contextPacks
    };
  });
}

async function readSearchIndex(path: string): Promise<SearchIndexDocument> {
  const parsed = await readJsonFile(path, {
    schemaName: "boreal.search-index.v1",
    expectedObject: true,
    maxBytes: SEARCH_INDEX_MAX_READ_BYTES
  });
  if (!isSearchIndexDocument(parsed)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Search index has an unsupported shape", { path });
  }
  return parsed;
}

interface SearchIndexMetadata {
  readonly builtAt: string;
  readonly contentHash: ContentHash;
  readonly corpusFingerprint?: ContentHash;
  readonly documentCount: number;
  readonly tokenCount: number;
}

async function readSearchIndexMetadata(path: string): Promise<SearchIndexMetadata> {
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(SEARCH_INDEX_METADATA_READ_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    const prefix = buffer.subarray(0, bytesRead).toString("utf8");
    const schemaVersion = metadataString(prefix, "schemaVersion", true);
    const algorithm = metadataString(prefix, "algorithm", true);
    if (schemaVersion !== SEARCH_INDEX_SCHEMA_VERSION || algorithm !== SEARCH_INDEX_ALGORITHM) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Search index has an unsupported shape", { path });
    }
    return {
      builtAt: metadataString(prefix, "builtAt", true),
      contentHash: metadataString(prefix, "contentHash", true) as ContentHash,
      corpusFingerprint: metadataString(prefix, "corpusFingerprint", false) as ContentHash | undefined,
      documentCount: metadataNumber(prefix, "documentCount"),
      tokenCount: metadataNumber(prefix, "tokenCount")
    };
  } finally {
    await handle.close();
  }
}

function metadataString(prefix: string, key: string, required: true): string;
function metadataString(prefix: string, key: string, required: false): string | undefined;
function metadataString(prefix: string, key: string, required: boolean): string | undefined {
  const match = new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]*(?:\\\\.[^"\\\\]*)*)"`).exec(prefix);
  if (!match) {
    if (required) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Search index metadata is incomplete", { key });
    }
    return undefined;
  }
  return JSON.parse(`"${match[1]}"`) as string;
}

function metadataNumber(prefix: string, key: string): number {
  const match = new RegExp(`"${key}"\\s*:\\s*(\\d+)`).exec(prefix);
  if (!match) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Search index metadata is incomplete", { key });
  }
  return Number(match[1]);
}

async function readSearchFingerprintSnapshot(context: CliContext): Promise<SearchCorpusSnapshot> {
  const indexed = await readIndexedSearchFingerprintSnapshot(context);
  if (indexed) {
    return indexed;
  }
  return context.store.read(async (reader) => {
    const [workItems, agentSummaries, evidence, knowledgeSources, claims, decisions] = await Promise.all([
      reader.listWorkItems(),
      reader.listAgentSummaries(),
      reader.listEvidence(),
      reader.listKnowledgeSources(),
      reader.listClaims(),
      reader.listDecisions()
    ]);
    return {
      workItems,
      agentSummaries,
      evidence,
      knowledgeSources,
      claims,
      decisions
    };
  });
}

interface FingerprintRow {
  readonly section: string;
  readonly id: string;
  readonly content_hash: string;
}

async function readIndexedSearchFingerprintSnapshot(context: CliContext): Promise<SearchCorpusSnapshot | undefined> {
  const sqlite = await loadNodeSqlite();
  const path = objectIndexPath(context.workspaceRoot);
  if (!sqlite || !existsSync(path)) {
    return undefined;
  }

  const expectedHead = await new FileEventLog({ path: context.paths.eventLogFile }).head();
  let db: InstanceType<typeof sqlite.DatabaseSync> | undefined;
  try {
    db = new sqlite.DatabaseSync(path, { readOnly: true, timeout: 100 });
    const head = db.prepare("SELECT seq, hash FROM head LIMIT 1;").get() as
      | {
          readonly seq?: unknown;
          readonly hash?: unknown;
        }
      | undefined;
    if (head?.seq !== expectedHead.seq || head.hash !== expectedHead.hash) {
      return undefined;
    }

    const placeholders = SEARCH_FINGERPRINT_SECTIONS.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT section, id, content_hash FROM records WHERE section IN (${placeholders}) ORDER BY section, id;`)
      .all(...SEARCH_FINGERPRINT_SECTIONS) as unknown as FingerprintRow[];
    const bySection = new Map<string, FingerprintRow[]>();
    for (const row of rows) {
      bySection.set(row.section, [...(bySection.get(row.section) ?? []), row]);
    }

    const recordsFor = (section: (typeof SEARCH_FINGERPRINT_SECTIONS)[number]) =>
      (bySection.get(section) ?? []).map((row) => ({
        meta: {
          id: row.id,
          contentHash: row.content_hash as ContentHash
        }
      }));

    return {
      workItems: recordsFor("workItems") as unknown as SearchCorpusSnapshot["workItems"],
      agentSummaries: recordsFor("agentSummaries") as unknown as SearchCorpusSnapshot["agentSummaries"],
      evidence: recordsFor("evidence") as unknown as SearchCorpusSnapshot["evidence"],
      knowledgeSources: recordsFor("knowledgeSources") as unknown as SearchCorpusSnapshot["knowledgeSources"],
      claims: recordsFor("claims") as unknown as SearchCorpusSnapshot["claims"],
      decisions: recordsFor("decisions") as unknown as SearchCorpusSnapshot["decisions"]
    };
  } catch {
    return undefined;
  } finally {
    db?.close();
  }
}

async function readSearchSnapshot(context: CliContext): Promise<SearchCorpusSnapshot> {
  return context.store.read(async (reader) => {
    const [workItems, agentSummaries, evidence, knowledgeSources, claims, decisions] = await Promise.all([
      reader.listWorkItems(),
      reader.listAgentSummaries(),
      reader.listEvidence(),
      reader.listKnowledgeSources(),
      reader.listClaims(),
      reader.listDecisions()
    ]);
    return {
      workItems,
      agentSummaries,
      evidence,
      knowledgeSources,
      claims,
      decisions
    };
  });
}

function indexWriteResult(path: string, index: SearchIndexDocument): SearchIndexWriteResult {
  return {
    path,
    schemaVersion: index.schemaVersion,
    builtAt: index.builtAt,
    contentHash: index.contentHash,
    corpusFingerprint: index.corpusFingerprint,
    documentCount: index.documentCount,
    tokenCount: index.tokenCount
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
