import { existsSync } from "node:fs";
import { join } from "node:path";

import { BorealError, normalizeSearchQuery, nowIso, readJsonFile, type ContentHash } from "@boreal/core";
import {
  buildSearchIndex,
  isSearchIndexDocument,
  querySearchIndex,
  searchIndexContentHash,
  type SearchCorpusSnapshot,
  type SearchDocumentType,
  type SearchIndexDocument,
  type SearchResult
} from "@boreal/search";
import { normalizeFileLockOptions, withFileLock, writeTextFileAtomic } from "@boreal/storage";

import type { CliContext } from "./context.js";

export interface SearchIndexWriteResult {
  readonly path: string;
  readonly schemaVersion: SearchIndexDocument["schemaVersion"];
  readonly builtAt: string;
  readonly contentHash: ContentHash;
  readonly documentCount: number;
  readonly tokenCount: number;
}

export interface SearchIndexInspection {
  readonly path: string;
  readonly exists: boolean;
  readonly stale: boolean;
  readonly expectedContentHash: ContentHash;
  readonly contentHash?: ContentHash;
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
}

export async function writeSearchIndex(context: CliContext): Promise<SearchIndexWriteResult> {
  return withFileLock(searchIndexLockDir(context), normalizeFileLockOptions(), async () => {
    const snapshot = await readSearchSnapshot(context);
    const index = buildSearchIndex(snapshot, nowIso());
    const path = searchIndexPath(context);
    await writeTextFileAtomic(path, `${JSON.stringify(index, null, 2)}\n`);
    return indexWriteResult(path, index);
  });
}

export async function inspectSearchIndex(context: CliContext): Promise<SearchIndexInspection> {
  const path = searchIndexPath(context);
  const snapshot = await readSearchSnapshot(context);
  const expectedContentHash = searchIndexContentHash(snapshot);
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      stale: true,
      expectedContentHash
    };
  }

  try {
    const index = await readSearchIndex(path);
    return {
      path,
      exists: true,
      stale: index.contentHash !== expectedContentHash,
      expectedContentHash,
      contentHash: index.contentHash,
      builtAt: index.builtAt,
      documentCount: index.documentCount,
      tokenCount: index.tokenCount
    };
  } catch (error) {
    return {
      path,
      exists: true,
      stale: true,
      expectedContentHash,
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

  const index = await loadFreshSearchIndex(context);
  return querySearchIndex(index, normalizedQuery, options);
}

export function searchIndexPath(context: CliContext): string {
  return join(context.paths.runtimeDir, "search-index.json");
}

export function searchIndexLockDir(context: CliContext): string {
  return join(context.paths.runtimeDir, "search-index.lock");
}

async function loadFreshSearchIndex(context: CliContext): Promise<SearchIndexDocument> {
  const inspection = await inspectSearchIndex(context);
  if (!inspection.exists) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Search index is missing; run `bwrk search index`", {
      path: inspection.path,
      expectedContentHash: inspection.expectedContentHash
    });
  }
  if (inspection.error) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Search index is invalid; run `bwrk search index`", {
      path: inspection.path,
      error: inspection.error
    });
  }
  if (inspection.stale) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Search index is stale; run `bwrk search index`", {
      path: inspection.path,
      contentHash: inspection.contentHash,
      expectedContentHash: inspection.expectedContentHash
    });
  }
  return readSearchIndex(inspection.path);
}

async function readSearchIndex(path: string): Promise<SearchIndexDocument> {
  const parsed = await readJsonFile(path, {
    schemaName: "boreal.search-index.v1",
    expectedObject: true,
    maxBytes: 50 * 1024 * 1024
  });
  if (!isSearchIndexDocument(parsed)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Search index has an unsupported shape", { path });
  }
  return parsed;
}

async function readSearchSnapshot(context: CliContext): Promise<SearchCorpusSnapshot> {
  return context.store.read(async (reader) => {
    const [workItems, evidence, knowledgeSources, claims, decisions, contextPacks] = await Promise.all([
      reader.listWorkItems(),
      reader.listEvidence(),
      reader.listKnowledgeSources(),
      reader.listClaims(),
      reader.listDecisions(),
      reader.listContextPacks()
    ]);
    return {
      workItems,
      evidence,
      knowledgeSources,
      claims,
      decisions,
      contextPacks
    };
  });
}

function indexWriteResult(path: string, index: SearchIndexDocument): SearchIndexWriteResult {
  return {
    path,
    schemaVersion: index.schemaVersion,
    builtAt: index.builtAt,
    contentHash: index.contentHash,
    documentCount: index.documentCount,
    tokenCount: index.tokenCount
  };
}
