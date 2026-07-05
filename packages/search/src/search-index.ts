import {
  hashContent,
  normalizeGeneratedSearchText,
  nowIso,
  type AgentSummaryRecord,
  type ClaimRecord,
  type ContentHash,
  type DecisionRecord,
  type EvidenceRecord,
  type IsoTimestamp,
  type KnowledgeSource,
  type WorkItem
} from "@boreal/core";

export const SEARCH_INDEX_SCHEMA_VERSION = "boreal.search-index.v1";

export const SEARCH_INDEX_ALGORITHM = "boreal.search.hybrid.v1";
const DEFAULT_LIMIT = 20;
const MAX_INDEXED_TOKENS_PER_DOCUMENT = 400;
const VECTOR_DIMENSIONS = 4096;
const VECTOR_TOKEN_WEIGHT = 1;
const VECTOR_PREFIX_WEIGHT = 0.7;
const VECTOR_TRIGRAM_WEIGHT = 0.3;
const VECTOR_SCORE_WEIGHT = 4;
const MIN_VECTOR_SIMILARITY = 0.06;

export type SearchDocumentType =
  | "work"
  | "agent_summary"
  | "evidence"
  | "source"
  | "claim"
  | "decision";

export interface SearchCorpusSnapshot {
  readonly workItems: readonly WorkItem[];
  readonly agentSummaries?: readonly AgentSummaryRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly knowledgeSources: readonly KnowledgeSource[];
  readonly claims: readonly ClaimRecord[];
  readonly decisions: readonly DecisionRecord[];
}

export interface SearchIndexDocument {
  readonly schemaVersion: typeof SEARCH_INDEX_SCHEMA_VERSION;
  readonly algorithm: typeof SEARCH_INDEX_ALGORITHM;
  readonly builtAt: IsoTimestamp;
  readonly contentHash: ContentHash;
  readonly corpusFingerprint?: ContentHash;
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
  readonly vectorWeights: readonly (readonly [number, number])[];
  readonly fieldWeights?: readonly SearchIndexFieldWeights[];
}

export interface SearchQueryOptions {
  readonly limit?: number;
  readonly type?: SearchDocumentType;
  readonly types?: readonly SearchDocumentType[];
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
  readonly kind: "id_exact" | "id_prefix" | "token_exact" | "token_prefix" | "vector_similarity";
  readonly token?: string;
  readonly matchedToken?: string;
  readonly baseWeight?: number;
  readonly documentFrequency?: number;
  readonly idf?: number;
  readonly similarity?: number;
  readonly matchedDimensions?: number;
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

interface VectorSimilarity {
  readonly similarity: number;
  readonly matchedDimensions: number;
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
  agent_summary: 1,
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
    corpusFingerprint: searchCorpusFingerprint(snapshot),
    documentCount: documents.length,
    tokenCount: documents.reduce((sum, document) => sum + document.tokenWeights.length, 0),
    documentFrequencies,
    documents
  };
}

export function searchCorpusFingerprint(snapshot: SearchCorpusSnapshot): ContentHash {
  return hashContent({
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    workItems: snapshot.workItems.map(metaPair),
    agentSummaries: (snapshot.agentSummaries ?? []).map(metaPair),
    evidence: snapshot.evidence.map(metaPair),
    knowledgeSources: snapshot.knowledgeSources.map(metaPair),
    claims: snapshot.claims.map(metaPair),
    decisions: snapshot.decisions.map(metaPair)
  });
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
      vectorWeights: entry.vectorWeights,
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
  const allowedTypes = searchDocumentTypeFilter(options);
  const queryVectorWeights = vectorWeights(queryTokens.map((token) => [token, 1] as const));
  const results = index.documents
    .filter((entry) => !allowedTypes || allowedTypes.has(entry.type))
    .map((entry) => scoreEntry(entry, normalizedQuery, queryTokens, queryVectorWeights, Boolean(options.explain), scoringStats))
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
    (value.corpusFingerprint === undefined || typeof value.corpusFingerprint === "string") &&
    typeof value.documentCount === "number" &&
    typeof value.tokenCount === "number" &&
    Array.isArray(value.documentFrequencies) &&
    value.documentFrequencies.every(isTokenFrequency) &&
    Array.isArray(value.documents) &&
    value.documents.every(isSearchIndexEntry)
  );
}

function metaPair(record: { readonly meta: { readonly id: string; readonly contentHash?: string } }): readonly [string, string] {
  return [record.meta.id, record.meta.contentHash ?? ""];
}

function buildSearchEntries(snapshot: SearchCorpusSnapshot): readonly SearchIndexEntry[] {
  return [
    ...snapshot.workItems.map(workEntry),
    ...(snapshot.agentSummaries ?? []).map(agentSummaryEntry),
    ...snapshot.evidence.map(evidenceEntry),
    ...snapshot.knowledgeSources.map(sourceEntry),
    ...snapshot.claims.map(claimEntry),
    ...snapshot.decisions.map(decisionEntry)
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

function agentSummaryEntry(summary: AgentSummaryRecord): SearchIndexEntry {
  const completedWorkText = summary.completedWork
    .map((work) => [work.workId ?? "", work.title, work.outcome, work.notes].join(" "))
    .join(" ");
  return entry(
    "agent_summary",
    summary.meta.id,
    summary.title,
    summary.body,
    [
      { field: "id", text: summary.meta.id, weight: 10 },
      { field: "subjectId", text: summary.subjectId, weight: 8 },
      { field: "title", text: summary.title, weight: 8 },
      { field: "body", text: summary.body, weight: 7 },
      { field: "completedWork", text: completedWorkText, weight: 6 },
      { field: "evidenceIds", text: summary.evidenceIds.join(" "), weight: 5 },
      { field: "verificationIds", text: summary.verificationIds.join(" "), weight: 5 },
      { field: "commitShas", text: summary.commitShas.join(" "), weight: 5 },
      { field: "state", text: `${summary.subjectType} ${summary.summaryKind} ${summary.status} ${summary.outcome}`, weight: 4 },
      { field: "force", text: `${summary.forceReasonCode ?? ""} ${summary.forceComment ?? ""}`.trim(), weight: 3 }
    ],
    summary.subjectId
  );
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
    { field: "evidenceIds", text: claim.evidenceIds.join(" "), weight: 3 },
    { field: "wikiPageIds", text: (claim.wikiPageIds ?? []).join(" "), weight: 3 }
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
    { field: "sourceIds", text: decision.sourceIds.join(" "), weight: 3 },
    { field: "wikiPageIds", text: (decision.wikiPageIds ?? []).join(" "), weight: 3 }
  ]);
}

function entry(
  type: SearchDocumentType,
  recordId: string,
  title: string,
  summary: string,
  weightedText: readonly WeightedText[],
  subjectId?: string
): SearchIndexEntry {
  const weights = tokenWeights(weightedText);
  return {
    id: `${type}:${recordId}`,
    type,
    recordId,
    subjectId,
    title: title.trim(),
    summary: trimSummary(summary),
    tokenWeights: weights,
    vectorWeights: vectorWeights(weights),
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

function vectorWeights(tokenWeights: readonly (readonly [string, number])[]): readonly (readonly [number, number])[] {
  const weights = new Map<number, number>();
  for (const [token, weight] of tokenWeights) {
    const scaledWeight = Math.sqrt(Math.max(weight, 0));
    addVectorFeature(weights, `token:${token}`, VECTOR_TOKEN_WEIGHT * scaledWeight);
    if (token.length >= 5) {
      addVectorFeature(weights, `prefix:${token.slice(0, 5)}`, VECTOR_PREFIX_WEIGHT * scaledWeight);
    }
    for (const trigram of tokenTrigrams(token)) {
      addVectorFeature(weights, `trigram:${trigram}`, VECTOR_TRIGRAM_WEIGHT * scaledWeight);
    }
  }
  return [...weights.entries()]
    .filter(([, weight]) => weight > 0)
    .sort(([left], [right]) => left - right);
}

function addVectorFeature(weights: Map<number, number>, feature: string, weight: number): void {
  const dimension = hashVectorFeature(feature) % VECTOR_DIMENSIONS;
  weights.set(dimension, (weights.get(dimension) ?? 0) + weight);
}

function tokenTrigrams(token: string): readonly string[] {
  if (token.length < 3) {
    return [];
  }
  const trigrams = new Set<string>();
  for (let index = 0; index <= token.length - 3; index += 1) {
    trigrams.add(token.slice(index, index + 3));
  }
  return [...trigrams];
}

function hashVectorFeature(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
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
  queryVectorWeights: readonly (readonly [number, number])[],
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

  const vector = vectorSimilarity(entry.vectorWeights, queryVectorWeights);
  if (vector.similarity >= MIN_VECTOR_SIMILARITY) {
    const contribution = vector.similarity * VECTOR_SCORE_WEIGHT;
    score += contribution;
    matches.add("vector");
    scoreBreakdown.push({
      kind: "vector_similarity",
      similarity: vector.similarity,
      matchedDimensions: vector.matchedDimensions,
      contribution
    });
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

function vectorSimilarity(
  documentWeights: readonly (readonly [number, number])[],
  queryWeights: readonly (readonly [number, number])[]
): VectorSimilarity {
  if (documentWeights.length === 0 || queryWeights.length === 0) {
    return { similarity: 0, matchedDimensions: 0 };
  }

  const documentByDimension = new Map(documentWeights);
  let dotProduct = 0;
  let matchedDimensions = 0;
  for (const [dimension, queryWeight] of queryWeights) {
    const documentWeight = documentByDimension.get(dimension);
    if (documentWeight === undefined) {
      continue;
    }
    dotProduct += documentWeight * queryWeight;
    matchedDimensions += 1;
  }

  if (dotProduct <= 0) {
    return { similarity: 0, matchedDimensions: 0 };
  }

  const documentNorm = vectorNorm(documentWeights);
  const queryNorm = vectorNorm(queryWeights);
  if (documentNorm <= 0 || queryNorm <= 0) {
    return { similarity: 0, matchedDimensions: 0 };
  }

  return {
    similarity: dotProduct / (documentNorm * queryNorm),
    matchedDimensions
  };
}

function vectorNorm(weights: readonly (readonly [number, number])[]): number {
  return Math.sqrt(weights.reduce((sum, [, weight]) => sum + weight * weight, 0));
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
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const candidate of [normalizeText(text), normalizeText(expandTokenBoundaries(text))]) {
    for (const rawToken of candidate.split(/[^a-z0-9_]+/u)) {
      for (const token of tokenVariants(rawToken)) {
        if (token.length <= 1 || STOP_WORDS.has(token) || seen.has(token)) {
          continue;
        }
        seen.add(token);
        tokens.push(token);
      }
    }
  }
  return tokens;
}

function normalizeText(text: string): string {
  return normalizeGeneratedSearchText(text);
}

function expandTokenBoundaries(text: string): string {
  return text
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1 $2")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/([A-Za-z])([0-9])/gu, "$1 $2")
    .replace(/([0-9])([A-Za-z])/gu, "$1 $2")
    .replace(/[./:@?#&=+~|-]+/gu, " ");
}

function tokenVariants(token: string): readonly string[] {
  if (!token.includes("_")) {
    return [token];
  }
  return [token, ...token.split("_")];
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
    Array.isArray(value.vectorWeights) &&
    value.vectorWeights.every(isVectorWeight) &&
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

function isVectorWeight(value: unknown): value is readonly [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    Number.isInteger(value[0]) &&
    value[0] >= 0 &&
    value[0] < VECTOR_DIMENSIONS &&
    typeof value[1] === "number" &&
    Number.isFinite(value[1])
  );
}

function isSearchDocumentType(value: unknown): value is SearchDocumentType {
  return (
    value === "work" ||
    value === "agent_summary" ||
    value === "evidence" ||
    value === "source" ||
    value === "claim" ||
    value === "decision"
  );
}

function searchDocumentTypeFilter(options: SearchQueryOptions): ReadonlySet<SearchDocumentType> | undefined {
  const types = [...(options.type ? [options.type] : []), ...(options.types ?? [])];
  return types.length > 0 ? new Set(types) : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
