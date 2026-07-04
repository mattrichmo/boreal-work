import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  BorealError,
  normalizeSearchQuery,
  nowIso,
  readJsonFile,
  type ContentHash,
  type ContextPack,
  type EnforcementGap,
  type GraphEdge,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import {
  buildContextPack,
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

const SEARCH_INDEX_MAX_READ_BYTES = 100 * 1024 * 1024;
const SEARCH_INDEX_LOCK_RETRY_ATTEMPTS = 3;
const SEARCH_INDEX_LOCK_RETRY_DELAY_MS = 100;

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
      expectedContentHash: inspection.expectedContentHash
    });
  }
  if (inspection.error) {
    if (options.rebuildStaleIndex) {
      await rebuildSearchIndexIfStillNeeded(context);
      return readSearchIndex(inspection.path);
    }
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Search index is invalid; run `bwrk search index`", {
      path: inspection.path,
      error: inspection.error
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
      expectedContentHash: inspection.expectedContentHash
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
        return await writeSearchIndexUnlocked(context);
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
            gaps
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
  const snapshot = await readSearchSnapshot(context);
  const index = buildSearchIndex(snapshot, nowIso());
  const path = searchIndexPath(context);
  await writeTextFileAtomic(path, `${JSON.stringify(index)}\n`);
  return indexWriteResult(path, index);
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

async function readSearchSnapshot(context: CliContext): Promise<SearchCorpusSnapshot> {
  return context.store.read(async (reader) => {
    const [workItems, agentSummaries, evidence, knowledgeSources, claims, decisions, graphEdges, contextPacks] = await Promise.all([
      reader.listWorkItems(),
      reader.listAgentSummaries(),
      reader.listEvidence(),
      reader.listKnowledgeSources(),
      reader.listClaims(),
      reader.listDecisions(),
      reader.listGraphEdges(),
      reader.listContextPacks()
    ]);
    return {
      workItems,
      agentSummaries,
      evidence,
      knowledgeSources,
      claims,
      decisions,
      contextPacks: contextPacksWithSyntheticMissing({
        workItems,
        graphEdges,
        evidence,
        knowledgeSources,
        claims,
        decisions,
        contextPacks,
        actor: context.actor
      })
    };
  });
}

function contextPacksWithSyntheticMissing(input: {
  readonly workItems: readonly WorkItem[];
  readonly graphEdges: readonly GraphEdge[];
  readonly evidence: SearchCorpusSnapshot["evidence"];
  readonly knowledgeSources: SearchCorpusSnapshot["knowledgeSources"];
  readonly claims: SearchCorpusSnapshot["claims"];
  readonly decisions: SearchCorpusSnapshot["decisions"];
  readonly contextPacks: readonly ContextPack[];
  readonly actor: CliContext["actor"];
}): readonly ContextPack[] {
  const existingSubjects = new Set(input.contextPacks.map((pack) => pack.subjectId));
  const dependencyIdsByWork = dependencyIdsByWorkFromGraph(input.workItems, input.graphEdges);
  const generatedAt = nowIso();
  const synthetic = input.workItems
    .filter((work) => !existingSubjects.has(work.meta.id))
    .map((work) =>
      buildContextPack({
        work: { ...work, dependencyIds: dependencyIdsByWork.get(work.meta.id) ?? work.dependencyIds },
        evidence: input.evidence.filter((record) => record.subjectId === work.meta.id),
        sources: input.knowledgeSources,
        claims: input.claims,
        decisions: input.decisions,
        actor: input.actor,
        now: generatedAt
      })
    );
  return [...input.contextPacks, ...synthetic];
}

function dependencyIdsByWorkFromGraph(
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): ReadonlyMap<WorkId, readonly WorkId[]> {
  const workIds = new Set(workItems.map((work) => work.meta.id));
  const dependencyIdsByWork = new Map<WorkId, WorkId[]>();
  for (const work of workItems) {
    dependencyIdsByWork.set(work.meta.id, []);
  }
  for (const edge of graphEdges) {
    if (
      edge.kind !== "blocks" ||
      edge.fromType !== "work" ||
      edge.toType !== "work" ||
      !workIds.has(edge.fromId as WorkId) ||
      !workIds.has(edge.toId as WorkId)
    ) {
      continue;
    }
    const workId = edge.toId as WorkId;
    dependencyIdsByWork.set(workId, [...(dependencyIdsByWork.get(workId) ?? []), edge.fromId as WorkId]);
  }
  return new Map(
    [...dependencyIdsByWork.entries()].map(([workId, dependencyIds]) => [
      workId,
      [...new Set(dependencyIds)].sort((left, right) => left.localeCompare(right))
    ])
  );
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
