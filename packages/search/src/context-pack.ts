import {
  createRecordMeta,
  deterministicId,
  type ActorRef,
  type ClaimRecord,
  type ContextPack,
  type DecisionRecord,
  type EvidenceRecord,
  type IsoTimestamp,
  type ProjectionId,
  type WorkItem
} from "@boreal/core";

export interface BuildContextPackInput {
  readonly work: WorkItem;
  readonly evidence: readonly EvidenceRecord[];
  readonly claims?: readonly ClaimRecord[];
  readonly decisions?: readonly DecisionRecord[];
  readonly actor: ActorRef;
  readonly now: IsoTimestamp;
}

export function buildContextPack(input: BuildContextPackInput): ContextPack {
  const id = deterministicId<ProjectionId>("projection", {
    kind: "context-pack",
    subjectId: input.work.meta.id
  });

  const acceptedClaims = (input.claims ?? []).filter((claim) => claim.status === "accepted");
  const acceptedDecisions = (input.decisions ?? []).filter((decision) => decision.status === "accepted");
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
