import {
  hashContent,
  normalizeGeneratedSearchText,
  nowIso,
  type ClaimRecord,
  type ContentHash,
  type ContextPack,
  type DecisionRecord,
  type EvidenceRecord,
  type IsoTimestamp,
  type KnowledgeSource,
  type WorkItem
} from "@boreal/core";

export const SEARCH_INDEX_SCHEMA_VERSION = "boreal.search-index.v1";

const SEARCH_INDEX_ALGORITHM = "boreal.search.rank.v1";
const DEFAULT_LIMIT = 20;
const MAX_INDEXED_TOKENS_PER_DOCUMENT = 400;

export type SearchDocumentType = "work" | "evidence" | "source" | "claim" | "decision" | "context_pack";

export interface SearchCorpusSnapshot {
  readonly workItems: readonly WorkItem[];
  readonly evidence: readonly EvidenceRecord[];
  readonly knowledgeSources: readonly KnowledgeSource[];
  readonly claims: readonly ClaimRecord[];
  readonly decisions: readonly DecisionRecord[];
  readonly contextPacks: readonly ContextPack[];
}

export interface SearchIndexDocument {
  readonly schemaVersion: typeof SEARCH_INDEX_SCHEMA_VERSION;
  readonly algorithm: typeof SEARCH_INDEX_ALGORITHM;
  readonly builtAt: IsoTimestamp;
  readonly contentHash: ContentHash;
  readonly documentCount: number;
  readonly tokenCount: number;
  readonly documents: readonly SearchIndexEntry[];
}

export interface SearchIndexEntry {
  readonly id: string;
  readonly type: SearchDocumentType;
  readonly recordId: string;
  readonly subjectId?: string;
  readonly title: string;
  readonly summary: string;
  readonly tokenWeights: readonly (readonly [string, number])[];
}

export interface SearchQueryOptions {
  readonly limit?: number;
  readonly type?: SearchDocumentType;
}

export interface SearchResult {
  readonly id: string;
  readonly type: SearchDocumentType;
  readonly recordId: string;
  readonly subjectId?: string;
  readonly title: string;
  readonly summary: string;
  readonly score: number;
  readonly matches: readonly string[];
}

interface WeightedText {
  readonly text: string;
  readonly weight: number;
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with"
]);

const TYPE_ORDER: Record<SearchDocumentType, number> = {
  work: 0,
  context_pack: 1,
  decision: 2,
  claim: 3,
  evidence: 4,
  source: 5
};

export function buildSearchIndex(snapshot: SearchCorpusSnapshot, builtAt: IsoTimestamp = nowIso()): SearchIndexDocument {
  const documents = buildSearchEntries(snapshot);
  return {
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    algorithm: SEARCH_INDEX_ALGORITHM,
    builtAt,
    contentHash: searchIndexContentHash(snapshot),
    documentCount: documents.length,
    tokenCount: documents.reduce((sum, document) => sum + document.tokenWeights.length, 0),
    documents
  };
}

export function searchIndexContentHash(snapshot: SearchCorpusSnapshot): ContentHash {
  const entries = buildSearchEntries(snapshot);
  return hashContent({
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    algorithm: SEARCH_INDEX_ALGORITHM,
    documents: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      recordId: entry.recordId,
      subjectId: entry.subjectId,
      title: entry.title,
      summary: entry.summary,
      tokenWeights: entry.tokenWeights
    }))
  });
}

export function querySearchIndex(
  index: SearchIndexDocument,
  query: string,
  options: SearchQueryOptions = {}
): readonly SearchResult[] {
  const normalizedQuery = normalizeText(query);
  const queryTokens = tokenize(query);
  if (!normalizedQuery || queryTokens.length === 0) {
    return [];
  }

  const limit = options.limit ?? DEFAULT_LIMIT;
  const results = index.documents
    .filter((entry) => !options.type || entry.type === options.type)
    .map((entry) => scoreEntry(entry, normalizedQuery, queryTokens))
    .filter((result): result is SearchResult => result !== undefined)
    .sort(compareSearchResults);

  return limit > 0 ? results.slice(0, limit) : results;
}

export function isSearchIndexDocument(value: unknown): value is SearchIndexDocument {
  if (!isRecord(value)) {
    return false;
  }
  return (
    value.schemaVersion === SEARCH_INDEX_SCHEMA_VERSION &&
    value.algorithm === SEARCH_INDEX_ALGORITHM &&
    typeof value.builtAt === "string" &&
    typeof value.contentHash === "string" &&
    typeof value.documentCount === "number" &&
    typeof value.tokenCount === "number" &&
    Array.isArray(value.documents) &&
    value.documents.every(isSearchIndexEntry)
  );
}

function buildSearchEntries(snapshot: SearchCorpusSnapshot): readonly SearchIndexEntry[] {
  return [
    ...snapshot.workItems.map(workEntry),
    ...snapshot.evidence.map(evidenceEntry),
    ...snapshot.knowledgeSources.map(sourceEntry),
    ...snapshot.claims.map(claimEntry),
    ...snapshot.decisions.map(decisionEntry),
    ...snapshot.contextPacks.map(contextPackEntry)
  ].sort((left, right) => left.id.localeCompare(right.id));
}

function workEntry(work: WorkItem): SearchIndexEntry {
  return entry("work", work.meta.id, work.title, work.description, [
    { text: work.meta.id, weight: 10 },
    { text: work.title, weight: 8 },
    { text: work.labels.join(" "), weight: 6 },
    { text: work.acceptanceCriteria.join(" "), weight: 5 },
    { text: `${work.kind} ${work.status} ${work.priority}`, weight: 4 },
    { text: work.description, weight: 3 }
  ]);
}

function evidenceEntry(record: EvidenceRecord): SearchIndexEntry {
  return entry(
    "evidence",
    record.meta.id,
    `${record.outcome} evidence`,
    record.summary,
    [
      { text: record.meta.id, weight: 10 },
      { text: record.subjectId, weight: 7 },
      { text: record.summary, weight: 6 },
      { text: record.command ?? "", weight: 5 },
      { text: record.uri ?? "", weight: 4 },
      { text: `${record.kind} ${record.outcome}`, weight: 3 }
    ],
    record.subjectId
  );
}

function sourceEntry(source: KnowledgeSource): SearchIndexEntry {
  return entry("source", source.meta.id, source.title, source.summary, [
    { text: source.meta.id, weight: 10 },
    { text: source.title, weight: 8 },
    { text: source.summary, weight: 5 },
    { text: source.uri, weight: 4 },
    { text: source.kind, weight: 3 }
  ]);
}

function claimEntry(claim: ClaimRecord): SearchIndexEntry {
  return entry("claim", claim.meta.id, trimSummary(claim.statement), claim.statement, [
    { text: claim.meta.id, weight: 10 },
    { text: claim.statement, weight: 8 },
    { text: claim.status, weight: 4 },
    { text: claim.sourceIds.join(" "), weight: 3 },
    { text: claim.evidenceIds.join(" "), weight: 3 }
  ]);
}

function decisionEntry(decision: DecisionRecord): SearchIndexEntry {
  return entry("decision", decision.meta.id, decision.title, decision.decision, [
    { text: decision.meta.id, weight: 10 },
    { text: decision.title, weight: 8 },
    { text: decision.decision, weight: 7 },
    { text: decision.context, weight: 5 },
    { text: decision.consequences.join(" "), weight: 4 },
    { text: decision.status, weight: 3 },
    { text: decision.sourceIds.join(" "), weight: 3 }
  ]);
}

function contextPackEntry(pack: ContextPack): SearchIndexEntry {
  return entry(
    "context_pack",
    pack.id,
    pack.title,
    pack.summary,
    [
      { text: pack.id, weight: 10 },
      { text: pack.subjectId, weight: 8 },
      { text: pack.title, weight: 8 },
      { text: pack.facts.join(" "), weight: 7 },
      { text: pack.evidence.join(" "), weight: 6 },
      { text: pack.summary, weight: 5 }
    ],
    pack.subjectId
  );
}

function entry(
  type: SearchDocumentType,
  recordId: string,
  title: string,
  summary: string,
  weightedText: readonly WeightedText[],
  subjectId?: string
): SearchIndexEntry {
  return {
    id: `${type}:${recordId}`,
    type,
    recordId,
    subjectId,
    title: title.trim(),
    summary: trimSummary(summary),
    tokenWeights: tokenWeights(weightedText)
  };
}

function tokenWeights(weightedText: readonly WeightedText[]): readonly (readonly [string, number])[] {
  const weights = new Map<string, number>();
  for (const { text, weight } of weightedText) {
    for (const token of tokenize(text)) {
      weights.set(token, Math.max(weights.get(token) ?? 0, weight));
      if (weights.size >= MAX_INDEXED_TOKENS_PER_DOCUMENT) {
        break;
      }
    }
    if (weights.size >= MAX_INDEXED_TOKENS_PER_DOCUMENT) {
      break;
    }
  }
  return [...weights.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function scoreEntry(
  entry: SearchIndexEntry,
  normalizedQuery: string,
  queryTokens: readonly string[]
): SearchResult | undefined {
  const weights = new Map(entry.tokenWeights);
  const matches = new Set<string>();
  let score = 0;
  const normalizedRecordId = normalizeText(entry.recordId);

  if (normalizedRecordId === normalizedQuery) {
    score += 100;
    matches.add(entry.recordId);
  } else if (normalizedRecordId.startsWith(normalizedQuery)) {
    score += 60;
    matches.add(entry.recordId);
  }

  for (const token of queryTokens) {
    const exactWeight = weights.get(token);
    if (exactWeight !== undefined) {
      score += exactWeight;
      matches.add(token);
      continue;
    }

    const prefixWeight = prefixTokenWeight(weights, token);
    if (prefixWeight > 0) {
      score += prefixWeight / 2;
      matches.add(`${token}*`);
    }
  }

  if (score <= 0) {
    return undefined;
  }

  return {
    id: entry.id,
    type: entry.type,
    recordId: entry.recordId,
    subjectId: entry.subjectId,
    title: entry.title,
    summary: entry.summary,
    score,
    matches: [...matches].sort()
  };
}

function prefixTokenWeight(weights: ReadonlyMap<string, number>, token: string): number {
  let max = 0;
  for (const [candidate, weight] of weights) {
    if (candidate.startsWith(token)) {
      max = Math.max(max, weight);
    }
  }
  return max;
}

function compareSearchResults(left: SearchResult, right: SearchResult): number {
  return (
    right.score - left.score ||
    TYPE_ORDER[left.type] - TYPE_ORDER[right.type] ||
    left.title.localeCompare(right.title) ||
    left.recordId.localeCompare(right.recordId)
  );
}

function tokenize(text: string): readonly string[] {
  return normalizeText(text)
    .split(/[^a-z0-9_]+/u)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

function normalizeText(text: string): string {
  return normalizeGeneratedSearchText(text);
}

function trimSummary(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}

function isSearchIndexEntry(value: unknown): value is SearchIndexEntry {
  if (!isRecord(value)) {
    return false;
  }
  return (
    isSearchDocumentType(value.type) &&
    typeof value.id === "string" &&
    typeof value.recordId === "string" &&
    (value.subjectId === undefined || typeof value.subjectId === "string") &&
    typeof value.title === "string" &&
    typeof value.summary === "string" &&
    Array.isArray(value.tokenWeights) &&
    value.tokenWeights.every(isTokenWeight)
  );
}

function isTokenWeight(value: unknown): value is readonly [string, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "string" && typeof value[1] === "number";
}

function isSearchDocumentType(value: unknown): value is SearchDocumentType {
  return (
    value === "work" ||
    value === "evidence" ||
    value === "source" ||
    value === "claim" ||
    value === "decision" ||
    value === "context_pack"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
