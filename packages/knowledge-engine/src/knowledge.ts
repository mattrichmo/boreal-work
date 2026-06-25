import {
  BorealError,
  createRecordMeta,
  deterministicId,
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
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export function createKnowledgeSource(input: CreateKnowledgeSourceInput): KnowledgeSource {
  assertNonEmpty(input.title, "title");
  assertNonEmpty(input.uri, "uri");
  const id = deterministicId<KnowledgeSourceId>("source", {
    kind: input.kind,
    title: input.title,
    uri: input.uri
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    kind: input.kind,
    title: input.title.trim(),
    uri: input.uri.trim(),
    summary: input.summary?.trim() ?? ""
  });
}

export function createClaim(input: CreateClaimInput): ClaimRecord {
  assertNonEmpty(input.statement, "statement");
  const id = deterministicId<ClaimRecord["meta"]["id"]>("claim", {
    statement: input.statement,
    sourceIds: [...(input.sourceIds ?? [])].sort()
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    statement: input.statement.trim(),
    status: input.status ?? "proposed",
    sourceIds: input.sourceIds ?? [],
    evidenceIds: input.evidenceIds ?? []
  });
}

export function createDecision(input: CreateDecisionInput): DecisionRecord {
  assertNonEmpty(input.title, "title");
  assertNonEmpty(input.decision, "decision");
  const id = deterministicId<DecisionRecord["meta"]["id"]>("decision", {
    title: input.title,
    decision: input.decision
  });

  return withContentHash({
    meta: createRecordMeta({
      id,
      now: input.now,
      actor: input.actor
    }),
    title: input.title.trim(),
    status: input.status ?? "accepted",
    context: input.context.trim(),
    decision: input.decision.trim(),
    consequences: input.consequences ?? [],
    sourceIds: input.sourceIds ?? []
  });
}

function assertNonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} cannot be empty`);
  }
}

