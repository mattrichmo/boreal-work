import {
  createRecordMeta,
  deterministicId,
  type ActorRef,
  type ClaimRecord,
  type ContextPack,
  type DecisionRecord,
  type EvidenceRecord,
  type IsoTimestamp,
  type KnowledgeSource,
  type ProjectionId,
  type WorkItem
} from "@boreal/core";

export interface BuildContextPackInput {
  readonly work: WorkItem;
  readonly evidence: readonly EvidenceRecord[];
  readonly sources?: readonly KnowledgeSource[];
  readonly claims?: readonly ClaimRecord[];
  readonly decisions?: readonly DecisionRecord[];
  readonly policy?: Partial<ContextPackPolicy>;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export interface ContextPackPolicy {
  readonly maxClaims: number;
  readonly maxDecisions: number;
  readonly includeGlobalAcceptedClaims: boolean;
  readonly includeGlobalAcceptedDecisions: boolean;
}

export const DEFAULT_CONTEXT_PACK_POLICY: ContextPackPolicy = {
  maxClaims: 5,
  maxDecisions: 5,
  includeGlobalAcceptedClaims: false,
  includeGlobalAcceptedDecisions: false
};

export function buildContextPack(input: BuildContextPackInput): ContextPack {
  const id = deterministicId<ProjectionId>("projection", {
    kind: "context-pack",
    subjectId: input.work.meta.id
  });

  const policy = { ...DEFAULT_CONTEXT_PACK_POLICY, ...input.policy };
  const context = workContext(input.work, input.evidence, input.sources ?? []);
  const acceptedClaims = selectRelevantClaims(input.claims ?? [], context, policy);
  const acceptedDecisions = selectRelevantDecisions(input.decisions ?? [], context, policy);
  const evidenceSummaries = input.evidence.map((record) => `${record.outcome}: ${record.summary}`);

  return {
    id,
    subjectId: input.work.meta.id,
    generatedAt: input.now,
    title: input.work.title,
    summary: summarizeWork(input.work),
    facts: [
      `status: ${input.work.status}`,
      `priority: ${input.work.priority}`,
      ...acceptedClaims.map((claim) => `claim: ${claim.statement}`),
      ...acceptedDecisions.map((decision) => `decision: ${decision.decision}`)
    ],
    evidence: evidenceSummaries
  };
}

export function buildContextProjection(input: BuildContextPackInput) {
  const pack = buildContextPack(input);
  return {
    meta: createRecordMeta({
      id: pack.id,
      now: input.now,
      actor: input.actor
    }),
    kind: "context-pack",
    subjectId: input.work.meta.id,
    value: {
      title: pack.title,
      summary: pack.summary,
      facts: pack.facts,
      evidence: pack.evidence
    }
  };
}

function summarizeWork(work: WorkItem): string {
  const criteria = work.acceptanceCriteria.length > 0 ? ` Criteria: ${work.acceptanceCriteria.join("; ")}` : "";
  return `${work.kind} "${work.title}" (${work.meta.id}) is ${work.status}. ${work.description}${criteria}`.trim();
}

function selectRelevantClaims(
  claims: readonly ClaimRecord[],
  context: WorkContextRelevance,
  policy: ContextPackPolicy
): readonly ClaimRecord[] {
  return claims
    .filter((claim) => claim.status === "accepted")
    .map((claim) => ({ claim, score: claimRelevanceScore(claim, context, policy) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.claim.meta.id.localeCompare(right.claim.meta.id))
    .slice(0, policy.maxClaims)
    .map((entry) => entry.claim);
}

function selectRelevantDecisions(
  decisions: readonly DecisionRecord[],
  context: WorkContextRelevance,
  policy: ContextPackPolicy
): readonly DecisionRecord[] {
  return decisions
    .filter((decision) => decision.status === "accepted")
    .map((decision) => ({ decision, score: decisionRelevanceScore(decision, context, policy) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.decision.meta.id.localeCompare(right.decision.meta.id))
    .slice(0, policy.maxDecisions)
    .map((entry) => entry.decision);
}

interface WorkContextRelevance {
  readonly tokens: ReadonlySet<string>;
  readonly evidenceIds: ReadonlySet<string>;
  readonly sourceIds: ReadonlySet<string>;
}

function claimRelevanceScore(
  claim: ClaimRecord,
  context: WorkContextRelevance,
  policy: ContextPackPolicy
): number {
  if (policy.includeGlobalAcceptedClaims) {
    return 1;
  }
  return (
    directReferenceScore(claim.evidenceIds, context.evidenceIds, 100) +
    directReferenceScore(claim.sourceIds, context.sourceIds, 80) +
    relevanceScore(claimTokens(claim), context.tokens)
  );
}

function decisionRelevanceScore(
  decision: DecisionRecord,
  context: WorkContextRelevance,
  policy: ContextPackPolicy
): number {
  if (policy.includeGlobalAcceptedDecisions) {
    return 1;
  }
  return directReferenceScore(decision.sourceIds, context.sourceIds, 80) + relevanceScore(decisionTokens(decision), context.tokens);
}

function directReferenceScore(
  candidateIds: readonly string[],
  contextIds: ReadonlySet<string>,
  weight: number
): number {
  return candidateIds.reduce((score, id) => score + (contextIds.has(id) ? weight : 0), 0);
}

function relevanceScore(candidateTokens: ReadonlySet<string>, contextTokens: ReadonlySet<string>): number {
  let score = 0;
  for (const token of candidateTokens) {
    if (contextTokens.has(token)) {
      score += 1;
    }
  }
  return score;
}

function workContext(
  work: WorkItem,
  evidence: readonly EvidenceRecord[],
  sources: readonly KnowledgeSource[]
): WorkContextRelevance {
  const sourceUris = new Set([
    ...work.meta.sourceRefs.map((sourceRef) => sourceRef.uri),
    ...evidence.map((record) => record.uri).filter(isString)
  ]);
  const sourceIds = new Set(sources.filter((source) => sourceUris.has(source.uri)).map((source) => source.meta.id));
  return {
    tokens: tokens([
      work.meta.id,
      work.title,
      work.description,
      work.kind,
      work.priority,
      work.labels.join(" "),
      work.acceptanceCriteria.join(" "),
      work.meta.sourceRefs.map((sourceRef) => sourceRef.uri).join(" "),
      evidence.map((record) => [record.meta.id, record.summary, record.command ?? "", record.uri ?? ""].join(" ")).join(" ")
    ]),
    evidenceIds: new Set(evidence.map((record) => record.meta.id)),
    sourceIds
  };
}

function claimTokens(claim: ClaimRecord): ReadonlySet<string> {
  return tokens([claim.meta.id, claim.statement, claim.sourceIds.join(" "), claim.evidenceIds.join(" ")]);
}

function decisionTokens(decision: DecisionRecord): ReadonlySet<string> {
  return tokens([
    decision.meta.id,
    decision.title,
    decision.context,
    decision.decision,
    decision.consequences.join(" "),
    decision.sourceIds.join(" ")
  ]);
}

function tokens(values: readonly string[]): ReadonlySet<string> {
  const result = new Set<string>();
  for (const value of values) {
    for (const token of value.toLowerCase().split(/[^a-z0-9_/-]+/u)) {
      const normalized = token.replace(/^[-_/]+|[-_/]+$/gu, "");
      if (normalized.length >= 3 && !STOP_WORDS.has(normalized)) {
        result.add(normalized);
      }
    }
  }
  return result;
}

const STOP_WORDS = new Set([
  "and",
  "are",
  "but",
  "for",
  "from",
  "has",
  "the",
  "this",
  "that",
  "then",
  "through",
  "with"
]);

function isString(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}
