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

const SEARCH_INDEX_ALGORITHM = "boreal.search.rank.v2";
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
  readonly documentFrequencies: readonly (readonly [string, number])[];
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
  readonly fieldWeights?: readonly SearchIndexFieldWeights[];
}

export interface SearchQueryOptions {
  readonly limit?: number;
  readonly type?: SearchDocumentType;
  readonly explain?: boolean;
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
  readonly explain?: SearchResultExplain;
}

export interface SearchIndexFieldWeights {
  readonly field: string;
  readonly weight: number;
  readonly tokenWeights: readonly (readonly [string, number])[];
}

export interface SearchResultExplain {
  readonly algorithm: typeof SEARCH_INDEX_ALGORITHM;
  readonly queryTokens: readonly string[];
  readonly fieldMatches: readonly SearchResultFieldMatch[];
  readonly scoreBreakdown: readonly SearchResultScoreContribution[];
}

export interface SearchResultFieldMatch {
  readonly field: string;
  readonly token: string;
  readonly matchedToken: string;
  readonly match: "exact" | "prefix";
  readonly weight: number;
  readonly idf: number;
  readonly contribution: number;
}

export interface SearchResultScoreContribution {
  readonly kind: "id_exact" | "id_prefix" | "token_exact" | "token_prefix";
  readonly token?: string;
  readonly matchedToken?: string;
  readonly baseWeight?: number;
  readonly documentFrequency?: number;
  readonly idf?: number;
  readonly contribution: number;
  readonly fields?: readonly string[];
}

interface WeightedText {
  readonly field: string;
  readonly text: string;
  readonly weight: number;
}

interface SearchScoringStats {
  readonly documentCount: number;
  readonly documentFrequencies: ReadonlyMap<string, number>;
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
  const documentFrequencies = buildDocumentFrequencies(documents);
  return {
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    algorithm: SEARCH_INDEX_ALGORITHM,
    builtAt,
    contentHash: searchIndexContentHash(snapshot),
    documentCount: documents.length,
    tokenCount: documents.reduce((sum, document) => sum + document.tokenWeights.length, 0),
    documentFrequencies,
    documents
  };
}

export function searchIndexContentHash(snapshot: SearchCorpusSnapshot): ContentHash {
  const entries = buildSearchEntries(snapshot);
  const documentFrequencies = buildDocumentFrequencies(entries);
  return hashContent({
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    algorithm: SEARCH_INDEX_ALGORITHM,
    documentFrequencies,
    documents: entries.map((entry) => ({
      id: entry.id,
      type: entry.type,
      recordId: entry.recordId,
      subjectId: entry.subjectId,
      title: entry.title,
      summary: entry.summary,
      tokenWeights: entry.tokenWeights,
      fieldWeights: entry.fieldWeights
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
  const scoringStats = searchScoringStats(index);
  const results = index.documents
    .filter((entry) => !options.type || entry.type === options.type)
    .map((entry) => scoreEntry(entry, normalizedQuery, queryTokens, Boolean(options.explain), scoringStats))
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
    Array.isArray(value.documentFrequencies) &&
    value.documentFrequencies.every(isTokenFrequency) &&
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
    { field: "id", text: work.meta.id, weight: 10 },
    { field: "title", text: work.title, weight: 8 },
    { field: "labels", text: work.labels.join(" "), weight: 6 },
    { field: "acceptanceCriteria", text: work.acceptanceCriteria.join(" "), weight: 5 },
    { field: "state", text: `${work.kind} ${work.status} ${work.priority}`, weight: 4 },
    { field: "description", text: work.description, weight: 3 }
  ]);
}

function evidenceEntry(record: EvidenceRecord): SearchIndexEntry {
  return entry(
    "evidence",
    record.meta.id,
    `${record.outcome} evidence`,
    record.summary,
    [
      { field: "id", text: record.meta.id, weight: 10 },
      { field: "subjectId", text: record.subjectId, weight: 7 },
      { field: "summary", text: record.summary, weight: 6 },
      { field: "command", text: record.command ?? "", weight: 5 },
      { field: "uri", text: record.uri ?? "", weight: 4 },
      { field: "state", text: `${record.kind} ${record.outcome}`, weight: 3 }
    ],
    record.subjectId
  );
}

function sourceEntry(source: KnowledgeSource): SearchIndexEntry {
  return entry("source", source.meta.id, source.title, source.summary, [
    { field: "id", text: source.meta.id, weight: 10 },
    { field: "title", text: source.title, weight: 8 },
    { field: "summary", text: source.summary, weight: 5 },
    { field: "uri", text: source.uri, weight: 4 },
    { field: "kind", text: source.kind, weight: 3 }
  ]);
}

function claimEntry(claim: ClaimRecord): SearchIndexEntry {
  return entry("claim", claim.meta.id, trimSummary(claim.statement), claim.statement, [
    { field: "id", text: claim.meta.id, weight: 10 },
    { field: "statement", text: claim.statement, weight: 8 },
    { field: "status", text: claim.status, weight: 4 },
    { field: "sourceIds", text: claim.sourceIds.join(" "), weight: 3 },
    { field: "evidenceIds", text: claim.evidenceIds.join(" "), weight: 3 }
  ]);
}

function decisionEntry(decision: DecisionRecord): SearchIndexEntry {
  return entry("decision", decision.meta.id, decision.title, decision.decision, [
    { field: "id", text: decision.meta.id, weight: 10 },
    { field: "title", text: decision.title, weight: 8 },
    { field: "decision", text: decision.decision, weight: 7 },
    { field: "context", text: decision.context, weight: 5 },
    { field: "consequences", text: decision.consequences.join(" "), weight: 4 },
    { field: "status", text: decision.status, weight: 3 },
    { field: "sourceIds", text: decision.sourceIds.join(" "), weight: 3 }
  ]);
}

function contextPackEntry(pack: ContextPack): SearchIndexEntry {
  return entry(
    "context_pack",
    pack.id,
    pack.title,
    pack.summary,
    [
      { field: "id", text: pack.id, weight: 10 },
      { field: "subjectId", text: pack.subjectId, weight: 8 },
      { field: "title", text: pack.title, weight: 8 },
      { field: "facts", text: pack.facts.join(" "), weight: 7 },
      { field: "evidence", text: pack.evidence.join(" "), weight: 6 },
      { field: "summary", text: pack.summary, weight: 5 }
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
    tokenWeights: tokenWeights(weightedText),
    fieldWeights: fieldWeights(weightedText)
  };
}

function fieldWeights(weightedText: readonly WeightedText[]): readonly SearchIndexFieldWeights[] {
  return weightedText
    .map(({ field, text, weight }) => ({
      field,
      weight,
      tokenWeights: tokenWeights([{ field, text, weight }])
    }))
    .filter((entry) => entry.tokenWeights.length > 0);
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

function buildDocumentFrequencies(entries: readonly SearchIndexEntry[]): readonly (readonly [string, number])[] {
  const frequencies = new Map<string, number>();
  for (const entry of entries) {
    for (const [token] of entry.tokenWeights) {
      frequencies.set(token, (frequencies.get(token) ?? 0) + 1);
    }
  }
  return [...frequencies.entries()].sort(([left], [right]) => left.localeCompare(right));
}

function searchScoringStats(index: SearchIndexDocument): SearchScoringStats {
  return {
    documentCount: index.documentCount,
    documentFrequencies: new Map(index.documentFrequencies)
  };
}

function scoreEntry(
  entry: SearchIndexEntry,
  normalizedQuery: string,
  queryTokens: readonly string[],
  explain: boolean,
  stats: SearchScoringStats
): SearchResult | undefined {
  const weights = new Map(entry.tokenWeights);
  const matches = new Set<string>();
  const fieldMatches: SearchResultFieldMatch[] = [];
  const scoreBreakdown: SearchResultScoreContribution[] = [];
  let score = 0;
  const normalizedRecordId = normalizeText(entry.recordId);

  if (normalizedRecordId === normalizedQuery) {
    score += 100;
    matches.add(entry.recordId);
    scoreBreakdown.push({ kind: "id_exact", contribution: 100 });
  } else if (normalizedRecordId.startsWith(normalizedQuery)) {
    score += 60;
    matches.add(entry.recordId);
    scoreBreakdown.push({ kind: "id_prefix", contribution: 60 });
  }

  for (const token of queryTokens) {
    const exactWeight = weights.get(token);
    if (exactWeight !== undefined) {
      const documentFrequency = documentFrequencyForToken(stats, token);
      const idf = inverseDocumentFrequency(stats.documentCount, documentFrequency);
      const contribution = exactWeight * idf;
      score += contribution;
      matches.add(token);
      const exactFieldMatches = fieldMatchesForToken(entry, token, token, "exact", idf);
      fieldMatches.push(...exactFieldMatches);
      scoreBreakdown.push({
        kind: "token_exact",
        token,
        matchedToken: token,
        baseWeight: exactWeight,
        documentFrequency,
        idf,
        contribution,
        fields: exactFieldMatches.map((match) => match.field)
      });
      continue;
    }

    const prefixMatch = prefixTokenMatch(weights, token);
    if (prefixMatch) {
      const documentFrequency = documentFrequencyForToken(stats, prefixMatch.token);
      const idf = inverseDocumentFrequency(stats.documentCount, documentFrequency);
      const contribution = (prefixMatch.weight * idf) / 2;
      score += contribution;
      matches.add(`${token}*`);
      const prefixFieldMatches = fieldMatchesForToken(entry, token, prefixMatch.token, "prefix", idf);
      fieldMatches.push(...prefixFieldMatches);
      scoreBreakdown.push({
        kind: "token_prefix",
        token,
        matchedToken: prefixMatch.token,
        baseWeight: prefixMatch.weight,
        documentFrequency,
        idf,
        contribution,
        fields: prefixFieldMatches.map((match) => match.field)
      });
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
    matches: [...matches].sort(),
    explain: explain && queryTokens.length > 0
      ? {
          algorithm: SEARCH_INDEX_ALGORITHM,
          queryTokens,
          fieldMatches: dedupeFieldMatches(fieldMatches),
          scoreBreakdown
        }
      : undefined
  };
}

function prefixTokenMatch(weights: ReadonlyMap<string, number>, token: string): { readonly token: string; readonly weight: number } | undefined {
  let best: { token: string; weight: number } | undefined;
  for (const [candidate, weight] of weights) {
    if (candidate.startsWith(token) && (!best || weight > best.weight || (weight === best.weight && candidate.localeCompare(best.token) < 0))) {
      best = { token: candidate, weight };
    }
  }
  return best;
}

function fieldMatchesForToken(
  entry: SearchIndexEntry,
  queryToken: string,
  matchedToken: string,
  match: SearchResultFieldMatch["match"],
  idf: number
): readonly SearchResultFieldMatch[] {
  const fields = entry.fieldWeights ?? [];
  const matches = fields.flatMap((field) => {
    const fieldWeightsByToken = new Map(field.tokenWeights);
    const weight = fieldWeightsByToken.get(matchedToken);
    if (weight === undefined || weight <= 0) {
      return [];
    }
    return [
      {
        field: field.field,
        token: queryToken,
        matchedToken,
        match,
        weight,
        idf,
        contribution: match === "exact" ? weight * idf : (weight * idf) / 2
      }
    ];
  });
  return matches.sort((left, right) => right.weight - left.weight || left.field.localeCompare(right.field));
}

function documentFrequencyForToken(stats: SearchScoringStats, token: string): number {
  return stats.documentFrequencies.get(token) ?? 0;
}

function inverseDocumentFrequency(documentCount: number, documentFrequency: number): number {
  if (documentCount <= 0) {
    return 0;
  }
  return Math.log(1 + (documentCount - documentFrequency + 0.5) / (documentFrequency + 0.5));
}

function dedupeFieldMatches(matches: readonly SearchResultFieldMatch[]): readonly SearchResultFieldMatch[] {
  const byKey = new Map<string, SearchResultFieldMatch>();
  for (const match of matches) {
    const key = `${match.field}:${match.token}:${match.matchedToken}:${match.match}`;
    const existing = byKey.get(key);
    if (!existing || match.weight > existing.weight) {
      byKey.set(key, match);
    }
  }
  return [...byKey.values()].sort(
    (left, right) =>
      right.contribution - left.contribution ||
      left.field.localeCompare(right.field) ||
      left.token.localeCompare(right.token) ||
      left.matchedToken.localeCompare(right.matchedToken)
  );
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
    value.tokenWeights.every(isTokenWeight) &&
    (value.fieldWeights === undefined ||
      (Array.isArray(value.fieldWeights) && value.fieldWeights.every(isSearchIndexFieldWeights)))
  );
}

function isSearchIndexFieldWeights(value: unknown): value is SearchIndexFieldWeights {
  return (
    isRecord(value) &&
    typeof value.field === "string" &&
    typeof value.weight === "number" &&
    Array.isArray(value.tokenWeights) &&
    value.tokenWeights.every(isTokenWeight)
  );
}

function isTokenFrequency(value: unknown): value is readonly [string, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === "string" &&
    typeof value[1] === "number" &&
    Number.isInteger(value[1]) &&
    value[1] >= 0
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
