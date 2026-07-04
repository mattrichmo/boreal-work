import {
  BorealError,
  nowIso,
  touchRecord,
  type ClaimId,
  type ClaimRecord,
  type ClaimStatus,
  type DecisionId,
  type DecisionRecord,
  type DecisionStatus,
  type EvidenceId,
  type EvidenceRecord,
  type IsoTimestamp,
  type KnowledgeSource,
  type KnowledgeSourceId,
  type KnowledgeSourceKind,
  type RuntimeEvent
} from "@boreal/core";
import type { BorealReader, BorealWriter } from "@boreal/storage";

import { flagValue, flagValues, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import type { CommandResult } from "./shared.js";

type KnowledgeCommandGroup = "source" | "claim" | "decision";

export interface KnowledgeCommandDependencies {
  readonly defaultListLimit: number;
  readonly parseLimit: (value: string | undefined) => number | undefined;
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
  readonly asSourceId: (value: string) => KnowledgeSourceId;
  readonly asClaimId: (value: string) => ClaimId;
  readonly asDecisionId: (value: string) => DecisionId;
  readonly asEvidenceId: (value: string) => EvidenceId;
  readonly resolveWikiPageIds: (context: CliContext, references: readonly string[]) => Promise<readonly string[]>;
  readonly requireCliClaim: (reader: BorealReader, claimId: ClaimId) => Promise<ClaimRecord>;
  readonly requireCliDecision: (reader: BorealReader, decisionId: DecisionId) => Promise<DecisionRecord>;
  readonly requireCliKnowledgeSources: (reader: BorealReader, sourceIds: readonly KnowledgeSourceId[]) => Promise<void>;
  readonly requireCliEvidenceRecords: (reader: BorealReader, evidenceIds: readonly EvidenceId[]) => Promise<void>;
  readonly appendCliEvent: (
    writer: BorealWriter,
    context: CliContext,
    type: string,
    subjectId: string,
    subjectType: string,
    payload: Record<string, unknown>,
    current?: IsoTimestamp
  ) => Promise<RuntimeEvent>;
  readonly uniqueValues: <T extends string>(values: readonly T[]) => readonly T[];
  readonly uniqueStrings: (values: readonly string[]) => readonly string[];
}

export async function knowledgeCommand(
  group: KnowledgeCommandGroup,
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: KnowledgeCommandDependencies
): Promise<CommandResult> {
  switch (group) {
    case "source":
      return sourceCommand(action, rest, context, args, output, json, dependencies);
    case "claim":
      return claimCommand(action, rest, context, args, output, json, dependencies);
    case "decision":
      return decisionCommand(action, rest, context, args, output, json, dependencies);
  }
}

async function sourceCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: KnowledgeCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "add": {
      const source = await context.runtime.createKnowledgeSource({
        kind: parseSourceKind(flagValue(args, "kind")) ?? "document",
        title: requiredFlag(args, "title"),
        uri: requiredFlag(args, "uri"),
        summary: flagValue(args, "summary")
      });
      output.write(formatRecord(source, json));
      return { exitCode: 0 };
    }
    case "list": {
      const kind = parseSourceKind(flagValue(args, "kind"));
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
      const sources = await context.runtime.listKnowledgeSources();
      const rows = sources
        .filter((source) => !kind || source.kind === kind)
        .slice(0, limit)
        .map(sourceListRow);
      output.write(json ? formatRecord(rows, true) : table(rows));
      return { exitCode: 0 };
    }
    case "show": {
      const source = await context.runtime.getKnowledgeSource(
        dependencies.asSourceId(dependencies.requiredPositional(rest, 0, "source id"))
      );
      output.write(formatRecord(source, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown source command: ${action ?? ""}`);
  }
}

async function claimCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: KnowledgeCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const wikiPageIds = await dependencies.resolveWikiPageIds(context, flagValues(args, "wiki"));
      const claim = await context.runtime.createClaim({
        statement: requiredFlag(args, "statement"),
        status: parseClaimStatus(flagValue(args, "status")),
        sourceIds: flagValues(args, "source").map(dependencies.asSourceId),
        evidenceIds: flagValues(args, "evidence").map(dependencies.asEvidenceId),
        wikiPageIds
      });
      output.write(formatRecord(claim, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = parseClaimStatus(flagValue(args, "status"));
      const sourceId = optionalSourceId(flagValue(args, "source"), dependencies);
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
      const claims = await context.runtime.listClaims();
      const rows = claims
        .filter((claim) => !status || claim.status === status)
        .filter((claim) => !sourceId || claim.sourceIds.includes(sourceId))
        .slice(0, limit)
        .map(claimListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textClaimListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const claim = await context.runtime.getClaim(
        dependencies.asClaimId(dependencies.requiredPositional(rest, 0, "claim id"))
      );
      output.write(formatRecord(claim, json));
      return { exitCode: 0 };
    }
    case "review": {
      const result = await reviewClaimCommand(
        context,
        dependencies.asClaimId(dependencies.requiredPositional(rest, 0, "claim id")),
        args,
        dependencies
      );
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown claim command: ${action ?? ""}`);
  }
}

async function reviewClaimCommand(
  context: CliContext,
  claimId: ClaimId,
  args: ParsedArgs,
  dependencies: KnowledgeCommandDependencies
) {
  const status = parseClaimStatus(requiredFlag(args, "status"));
  if (!status) {
    throw new BorealError("BOREAL_INVALID_INPUT", "claim review requires --status");
  }
  const sourceIds = flagValues(args, "source").map(dependencies.asSourceId);
  const evidenceIds = flagValues(args, "evidence").map(dependencies.asEvidenceId);
  const wikiPageIds = await dependencies.resolveWikiPageIds(context, flagValues(args, "wiki"));
  const notes = flagValue(args, "notes");
  const current = nowIso();

  return context.store.write(async (writer) => {
    const claim = await dependencies.requireCliClaim(writer, claimId);
    await dependencies.requireCliKnowledgeSources(writer, sourceIds);
    await dependencies.requireCliEvidenceRecords(writer, evidenceIds);
    const updated = touchRecord(
      {
        ...claim,
        status,
        sourceIds: dependencies.uniqueValues([...claim.sourceIds, ...sourceIds]),
        evidenceIds: dependencies.uniqueValues([...claim.evidenceIds, ...evidenceIds]),
        wikiPageIds: dependencies.uniqueStrings([...(claim.wikiPageIds ?? []), ...wikiPageIds])
      },
      current,
      context.actor
    );
    await writer.putClaim(updated);
    const event = await dependencies.appendCliEvent(writer, context, "knowledge.claim_reviewed", updated.meta.id, "claim", {
      status,
      addedSourceIds: sourceIds,
      addedEvidenceIds: evidenceIds,
      addedWikiPageIds: wikiPageIds,
      notes
    }, current);
    return { claim: updated, event };
  });
}

async function decisionCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: KnowledgeCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "create": {
      const wikiPageIds = await dependencies.resolveWikiPageIds(context, flagValues(args, "wiki"));
      const decision = await context.runtime.createDecision({
        title: requiredFlag(args, "title"),
        context: flagValue(args, "context") ?? "",
        decision: requiredFlag(args, "decision"),
        status: parseDecisionStatus(flagValue(args, "status")),
        consequences: flagValues(args, "consequence"),
        sourceIds: flagValues(args, "source").map(dependencies.asSourceId),
        wikiPageIds
      });
      output.write(formatRecord(decision, json));
      return { exitCode: 0 };
    }
    case "list": {
      const status = parseDecisionStatus(flagValue(args, "status"));
      const sourceId = optionalSourceId(flagValue(args, "source"), dependencies);
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
      const decisions = await context.runtime.listDecisions();
      const rows = decisions
        .filter((decision) => !status || decision.status === status)
        .filter((decision) => !sourceId || decision.sourceIds.includes(sourceId))
        .slice(0, limit)
        .map(decisionListRow);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textDecisionListRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const decision = await context.runtime.getDecision(
        dependencies.asDecisionId(dependencies.requiredPositional(rest, 0, "decision id"))
      );
      output.write(formatRecord(decision, json));
      return { exitCode: 0 };
    }
    case "supersede": {
      const result = await supersedeDecisionCommand(
        context,
        dependencies.asDecisionId(dependencies.requiredPositional(rest, 0, "decision id")),
        args,
        dependencies
      );
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown decision command: ${action ?? ""}`);
  }
}

async function supersedeDecisionCommand(
  context: CliContext,
  decisionId: DecisionId,
  args: ParsedArgs,
  dependencies: KnowledgeCommandDependencies
) {
  const previous = await context.runtime.getDecision(decisionId);
  if (previous.status === "superseded") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Decision is already superseded", { decisionId });
  }
  const title = flagValue(args, "title") ?? previous.title;
  const decisionText = requiredFlag(args, "decision");
  if (title === previous.title && decisionText.trim() === previous.decision) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Replacement decision must differ from the decision it supersedes", {
      decisionId
    });
  }
  const sourceIds = dependencies.uniqueValues([
    ...previous.sourceIds,
    ...flagValues(args, "source").map(dependencies.asSourceId)
  ]);
  const wikiPageIds = dependencies.uniqueStrings([
    ...(previous.wikiPageIds ?? []),
    ...(await dependencies.resolveWikiPageIds(context, flagValues(args, "wiki")))
  ]);
  const replacement = await context.runtime.createDecision({
    title,
    context: flagValue(args, "context") ?? previous.context,
    decision: decisionText,
    consequences: flagValues(args, "consequence").length > 0 ? normalizedNonEmptyStrings(flagValues(args, "consequence")) : previous.consequences,
    sourceIds,
    wikiPageIds,
    status: "accepted"
  });
  if (replacement.meta.id === previous.meta.id) {
    throw new BorealError("BOREAL_CONFLICT", "Replacement decision resolved to the same record id", {
      decisionId,
      replacementDecisionId: replacement.meta.id
    });
  }

  const current = nowIso();
  const superseded = await context.store.write(async (writer) => {
    const latest = await dependencies.requireCliDecision(writer, decisionId);
    const updated = touchRecord({ ...latest, status: "superseded" as const }, current, context.actor) satisfies DecisionRecord;
    await writer.putDecision(updated);
    await dependencies.appendCliEvent(writer, context, "knowledge.decision_superseded", updated.meta.id, "decision", {
      replacementDecisionId: replacement.meta.id,
      reason: flagValue(args, "reason")
    }, current);
    return updated;
  });
  return { superseded, decision: replacement };
}

function parseSourceKind(value: string | undefined): KnowledgeSourceKind | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "raw" || value === "document" || value === "chat" || value === "code" || value === "artifact") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be raw, document, chat, code, or artifact");
}

function parseClaimStatus(value: string | undefined): ClaimStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "proposed" || value === "accepted" || value === "rejected" || value === "stale") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be proposed, accepted, rejected, or stale");
}

function parseDecisionStatus(value: string | undefined): DecisionStatus | undefined {
  if (!value) {
    return undefined;
  }
  if (value === "proposed" || value === "accepted" || value === "superseded" || value === "rejected") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--status must be proposed, accepted, superseded, or rejected");
}

function optionalSourceId(
  value: string | undefined,
  dependencies: Pick<KnowledgeCommandDependencies, "asSourceId">
): KnowledgeSourceId | undefined {
  return value ? dependencies.asSourceId(value) : undefined;
}

function sourceListRow(source: KnowledgeSource): Record<string, string> {
  return {
    id: source.meta.id,
    kind: source.kind,
    title: source.title,
    uri: source.uri
  };
}

function claimListRow(claim: ClaimRecord): Record<string, string | number | readonly string[]> {
  const wikiPageIds = claim.wikiPageIds ?? [];
  return {
    id: claim.meta.id,
    status: claim.status,
    statement: claim.statement,
    sources: claim.sourceIds.join(","),
    sourceIds: claim.sourceIds,
    sourceCount: claim.sourceIds.length,
    evidence: claim.evidenceIds.join(","),
    evidenceIds: claim.evidenceIds,
    evidenceCount: claim.evidenceIds.length,
    wikiPages: wikiPageIds.join(","),
    wikiPageIds,
    wikiPageCount: wikiPageIds.length,
    reviewState: claimReviewState(claim.status),
    updatedAt: claim.meta.updatedAt
  };
}

function textClaimListRow(row: Record<string, string | number | readonly string[]>): Record<string, string | number> {
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? ""),
    statement: String(row.statement ?? ""),
    sources: String(row.sources ?? ""),
    evidence: String(row.evidence ?? ""),
    wiki: String(row.wikiPages ?? ""),
    review: String(row.reviewState ?? "")
  };
}

function decisionListRow(decision: DecisionRecord): Record<string, string | number | readonly string[]> {
  const wikiPageIds = decision.wikiPageIds ?? [];
  return {
    id: decision.meta.id,
    status: decision.status,
    title: decision.title,
    context: decision.context,
    decision: decision.decision,
    consequences: decision.consequences,
    consequenceCount: decision.consequences.length,
    sources: decision.sourceIds.join(","),
    sourceIds: decision.sourceIds,
    sourceCount: decision.sourceIds.length,
    wikiPages: wikiPageIds.join(","),
    wikiPageIds,
    wikiPageCount: wikiPageIds.length,
    reviewState: decisionReviewState(decision.status),
    supersessionStatus: decision.status === "superseded" ? "superseded" : "none",
    updatedAt: decision.meta.updatedAt
  };
}

function textDecisionListRow(row: Record<string, string | number | readonly string[]>): Record<string, string | number> {
  return {
    id: String(row.id ?? ""),
    status: String(row.status ?? ""),
    title: String(row.title ?? ""),
    decision: String(row.decision ?? ""),
    sources: String(row.sources ?? ""),
    wiki: String(row.wikiPages ?? ""),
    review: String(row.reviewState ?? "")
  };
}

function claimReviewState(status: EvidenceRecord["outcome"] | ClaimRecord["status"]): string {
  if (status === "proposed") return "needs_review";
  if (status === "stale") return "needs_refresh";
  return status;
}

function decisionReviewState(status: DecisionRecord["status"]): string {
  if (status === "proposed") return "needs_review";
  if (status === "superseded") return "superseded";
  return status;
}

function normalizedNonEmptyStrings(values: readonly string[]): readonly string[] {
  return values.map((value) => value.trim()).filter((value) => value.length > 0);
}
