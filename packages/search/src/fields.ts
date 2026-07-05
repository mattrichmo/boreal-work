import type {
  AgentSummaryRecord,
  ClaimRecord,
  DecisionRecord,
  EvidenceRecord,
  KnowledgeSource,
  WorkItem
} from "@boreal/core";

export type SearchDocumentType =
  | "work"
  | "agent_summary"
  | "evidence"
  | "source"
  | "claim"
  | "decision";

export type SearchRecordSection =
  | "workItems"
  | "agentSummaries"
  | "evidence"
  | "knowledgeSources"
  | "claims"
  | "decisions";

export type SearchRecord =
  | WorkItem
  | AgentSummaryRecord
  | EvidenceRecord
  | KnowledgeSource
  | ClaimRecord
  | DecisionRecord;

export interface SearchWeightedText {
  readonly field: string;
  readonly text: string;
  readonly weight: number;
}

export interface SearchRecordFields {
  readonly type: SearchDocumentType;
  readonly recordId: string;
  readonly subjectId?: string;
  readonly title: string;
  readonly summary: string;
  readonly fields: readonly SearchWeightedText[];
}

export interface FtsDocumentInput {
  readonly recordId: string;
  readonly type: SearchDocumentType;
  readonly title: string;
  readonly summary: string;
  readonly idText: string;
  readonly labelText: string;
  readonly bodyText: string;
  readonly stateText: string;
}

export function searchFieldsForRecord(section: SearchRecordSection, record: SearchRecord): SearchRecordFields {
  switch (section) {
    case "workItems":
      return workFields(record as WorkItem);
    case "agentSummaries":
      return agentSummaryFields(record as AgentSummaryRecord);
    case "evidence":
      return evidenceFields(record as EvidenceRecord);
    case "knowledgeSources":
      return sourceFields(record as KnowledgeSource);
    case "claims":
      return claimFields(record as ClaimRecord);
    case "decisions":
      return decisionFields(record as DecisionRecord);
  }
}

export function ftsDocumentInputFromFields(document: SearchRecordFields): FtsDocumentInput {
  const idText: string[] = [];
  const labelText: string[] = [];
  const bodyText: string[] = [];
  const stateText: string[] = [];

  for (const field of document.fields) {
    if (!field.text.trim()) {
      continue;
    }
    if (isIdField(field.field)) {
      idText.push(field.text);
      continue;
    }
    if (field.field === "labels") {
      labelText.push(field.text);
      continue;
    }
    if (isStateField(field.field)) {
      stateText.push(field.text);
      continue;
    }
    if (field.field !== "title" && field.field !== "summary") {
      bodyText.push(field.text);
    }
  }

  return {
    recordId: document.recordId,
    type: document.type,
    title: document.title,
    summary: document.summary,
    idText: idText.join(" "),
    labelText: labelText.join(" "),
    bodyText: bodyText.join(" "),
    stateText: stateText.join(" ")
  };
}

function workFields(work: WorkItem): SearchRecordFields {
  return {
    type: "work",
    recordId: work.meta.id,
    title: work.title,
    summary: work.description,
    fields: [
      { field: "id", text: work.meta.id, weight: 10 },
      { field: "title", text: work.title, weight: 8 },
      { field: "labels", text: work.labels.join(" "), weight: 6 },
      { field: "acceptanceCriteria", text: work.acceptanceCriteria.join(" "), weight: 5 },
      { field: "state", text: `${work.kind} ${work.status} ${work.priority}`, weight: 4 },
      { field: "description", text: work.description, weight: 3 }
    ]
  };
}

function agentSummaryFields(summary: AgentSummaryRecord): SearchRecordFields {
  const completedWorkText = summary.completedWork
    .map((work) => [work.workId ?? "", work.title, work.outcome, work.notes].join(" "))
    .join(" ");
  return {
    type: "agent_summary",
    recordId: summary.meta.id,
    subjectId: summary.subjectId,
    title: summary.title,
    summary: summary.body,
    fields: [
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
    ]
  };
}

function evidenceFields(record: EvidenceRecord): SearchRecordFields {
  return {
    type: "evidence",
    recordId: record.meta.id,
    subjectId: record.subjectId,
    title: `${record.outcome} evidence`,
    summary: record.summary,
    fields: [
      { field: "id", text: record.meta.id, weight: 10 },
      { field: "subjectId", text: record.subjectId, weight: 7 },
      { field: "summary", text: record.summary, weight: 6 },
      { field: "command", text: record.command ?? "", weight: 5 },
      { field: "uri", text: record.uri ?? "", weight: 4 },
      { field: "state", text: `${record.kind} ${record.outcome}`, weight: 3 }
    ]
  };
}

function sourceFields(source: KnowledgeSource): SearchRecordFields {
  return {
    type: "source",
    recordId: source.meta.id,
    title: source.title,
    summary: source.summary,
    fields: [
      { field: "id", text: source.meta.id, weight: 10 },
      { field: "title", text: source.title, weight: 8 },
      { field: "summary", text: source.summary, weight: 5 },
      { field: "uri", text: source.uri, weight: 4 },
      { field: "kind", text: source.kind, weight: 3 }
    ]
  };
}

function claimFields(claim: ClaimRecord): SearchRecordFields {
  return {
    type: "claim",
    recordId: claim.meta.id,
    title: trimSummary(claim.statement),
    summary: claim.statement,
    fields: [
      { field: "id", text: claim.meta.id, weight: 10 },
      { field: "statement", text: claim.statement, weight: 8 },
      { field: "status", text: claim.status, weight: 4 },
      { field: "sourceIds", text: claim.sourceIds.join(" "), weight: 3 },
      { field: "evidenceIds", text: claim.evidenceIds.join(" "), weight: 3 },
      { field: "wikiPageIds", text: (claim.wikiPageIds ?? []).join(" "), weight: 3 }
    ]
  };
}

function decisionFields(decision: DecisionRecord): SearchRecordFields {
  return {
    type: "decision",
    recordId: decision.meta.id,
    title: decision.title,
    summary: decision.decision,
    fields: [
      { field: "id", text: decision.meta.id, weight: 10 },
      { field: "title", text: decision.title, weight: 8 },
      { field: "decision", text: decision.decision, weight: 7 },
      { field: "context", text: decision.context, weight: 5 },
      { field: "consequences", text: decision.consequences.join(" "), weight: 4 },
      { field: "status", text: decision.status, weight: 3 },
      { field: "sourceIds", text: decision.sourceIds.join(" "), weight: 3 },
      { field: "wikiPageIds", text: (decision.wikiPageIds ?? []).join(" "), weight: 3 }
    ]
  };
}

function isIdField(field: string): boolean {
  return field === "id" || field === "subjectId" || field.endsWith("Ids") || field === "commitShas" || field === "uri";
}

function isStateField(field: string): boolean {
  return field === "state" || field === "status" || field === "kind" || field === "force";
}

function trimSummary(value: string): string {
  const compact = value.replace(/\s+/gu, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 177)}...` : compact;
}
