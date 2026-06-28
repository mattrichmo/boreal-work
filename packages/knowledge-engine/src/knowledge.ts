import {
  createRecordMeta,
  deterministicId,
  normalizeMachineString,
  type ActorRef,
  type ClaimRecord,
  type ClaimStatus,
  type DecisionRecord,
  type DecisionStatus,
  type EvidenceId,
  type IsoTimestamp,
  type KnowledgeSource,
  type KnowledgeSourceId,
  type KnowledgeSourceKind,
  withContentHash
} from "@boreal/core";

export interface CreateKnowledgeSourceInput {
  readonly kind: KnowledgeSourceKind;
  readonly title: string;
  readonly uri: string;
  readonly summary?: string;
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export interface CreateClaimInput {
  readonly statement: string;
  readonly status?: ClaimStatus;
  readonly sourceIds?: readonly KnowledgeSourceId[];
  readonly evidenceIds?: readonly EvidenceId[];
  readonly wikiPageIds?: readonly string[];
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export interface CreateDecisionInput {
  readonly title: string;
  readonly status?: DecisionStatus;
  readonly context: string;
  readonly decision: string;
  readonly consequences?: readonly string[];
  readonly sourceIds?: readonly KnowledgeSourceId[];
  readonly wikiPageIds?: readonly string[];
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export function createKnowledgeSource(input: CreateKnowledgeSourceInput): KnowledgeSource {
  const title = normalizeMachineString(input.title, "title");
  const uri = normalizeMachineString(input.uri, "uri");
  const summary = input.summary === undefined ? "" : normalizeMachineString(input.summary, "summary", { allowEmpty: true });
  const id = deterministicId<KnowledgeSourceId>("source", {
    kind: input.kind,
    title,
    uri
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    kind: input.kind,
    title,
    uri,
    summary
  });
}

export function createClaim(input: CreateClaimInput): ClaimRecord {
  const statement = normalizeMachineString(input.statement, "statement");
  const sourceIds = unique([...(input.sourceIds ?? [])].sort());
  const evidenceIds = unique([...(input.evidenceIds ?? [])].sort());
  const wikiPageIds = unique((input.wikiPageIds ?? []).map((id) => normalizeMachineString(id, "wiki page id")).sort());
  const id = deterministicId<ClaimRecord["meta"]["id"]>("claim", {
    statement,
    sourceIds
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    statement,
    status: input.status ?? "proposed",
    sourceIds,
    evidenceIds,
    wikiPageIds
  });
}

export function createDecision(input: CreateDecisionInput): DecisionRecord {
  const title = normalizeMachineString(input.title, "title");
  const context = normalizeMachineString(input.context, "context", { allowEmpty: true });
  const decision = normalizeMachineString(input.decision, "decision");
  const consequences = unique((input.consequences ?? []).map((entry) => normalizeMachineString(entry, "consequence")).sort());
  const sourceIds = unique([...(input.sourceIds ?? [])].sort());
  const wikiPageIds = unique((input.wikiPageIds ?? []).map((id) => normalizeMachineString(id, "wiki page id")).sort());
  const id = deterministicId<DecisionRecord["meta"]["id"]>("decision", {
    title,
    decision
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    title,
    status: input.status ?? "accepted",
    context,
    decision,
    consequences,
    sourceIds,
    wikiPageIds
  });
}

function unique<T>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}
