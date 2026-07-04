import { randomUUID } from "node:crypto";
import { join, relative } from "node:path";

import { safeParseJson, type AgentDirectiveBundle } from "@boreal/core";
import { writeTextFileAtomic } from "@boreal/storage";

export interface CliOutput {
  write(text: string): void;
  error(text: string): void;
}

export interface CliSuccessEnvelope {
  readonly ok: true;
  readonly ledgerSeq: number | null;
  readonly data: unknown;
  readonly agentDirectives?: AgentDirectiveOutput;
}

export type JsonOutputProfile = "full" | "brief";

export interface AgentDirectiveUnchangedMarker {
  readonly unchanged: true;
  readonly sourceHash: string;
}

export type AgentDirectiveOutput = readonly AgentDirectiveBundle[] | AgentDirectiveUnchangedMarker;

export interface ResultSpoolingOutput extends CliOutput {
  flush(): Promise<void>;
}

export interface ResultSpoolingOptions {
  readonly workspaceRoot: string;
  readonly command: string;
  readonly maxResultSizeChars: number;
  readonly jsonOutputProfile?: JsonOutputProfile;
  readonly readOnly?: boolean;
  readonly jsonEnvelopeMetadata?: () => Promise<Record<string, unknown>> | Record<string, unknown>;
}

export function formatRecord(
  value: unknown,
  json: boolean,
  options: { readonly agentDirectives?: AgentDirectiveOutput; readonly ledgerSeq?: number | null } = {}
): string {
  if (json) {
    const envelope: CliSuccessEnvelope = {
      ok: true,
      ledgerSeq: options.ledgerSeq ?? null,
      data: value,
      ...(hasAgentDirectiveOutput(options.agentDirectives)
        ? { agentDirectives: options.agentDirectives }
        : {})
    };
    return `${JSON.stringify(envelope, null, 2)}\n`;
  }
  if (typeof value === "string") {
    return `${value}\n`;
  }
  return `${JSON.stringify(value, null, 2)}\n`;
}

function hasAgentDirectiveOutput(value: AgentDirectiveOutput | undefined): value is AgentDirectiveOutput {
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}

export function createResultSpoolingOutput(output: CliOutput, options: ResultSpoolingOptions): ResultSpoolingOutput {
  let stdout = "";
  return {
    write(text) {
      stdout += text;
    },
    error(text) {
      output.error(text);
    },
    async flush() {
      const metadata = await options.jsonEnvelopeMetadata?.();
      const text = options.jsonOutputProfile === "brief" ? briefJsonEnvelope(stdout, options.readOnly ?? false) : stdout;
      if (text.length <= options.maxResultSizeChars) {
        output.write(decorateJsonEnvelope(text, metadata));
        return;
      }

      const fullResultPath = resultPath(options.workspaceRoot);
      await writeTextFileAtomic(fullResultPath, text);
      output.write(
        decorateJsonEnvelope(
          formatRecord(
            {
              ...stableTruncatedVerdictFields(options.command, text),
              truncated: true,
              command: options.command,
              maxResultSizeChars: options.maxResultSizeChars,
              fullResultPath: relative(options.workspaceRoot, fullResultPath),
              fullResultBytes: Buffer.byteLength(text, "utf8"),
              preview: previewJsonEnvelope(text)
            },
            true
          ),
          metadata
        )
      );
    }
  };
}

function briefJsonEnvelope(text: string, readOnly: boolean): string {
  try {
    const parsed = safeParseJson(text, { schemaName: "boreal.cli.output.brief.v1", expectedObject: true });
    if (!isRecord(parsed) || parsed.ok !== true || !("data" in parsed)) {
      return text;
    }
    const data = readOnly
      ? { summary: briefJsonSummary(parsed.data) }
      : { result: briefJsonResult(parsed.data) };
    return `${JSON.stringify(pickDefined({
      ok: true,
      ledgerSeq: parsed.ledgerSeq ?? null,
      data,
      agentDirectives: parsed.agentDirectives
    }), null, 2)}\n`;
  } catch {
    return text;
  }
}

function briefJsonResult(value: unknown): unknown {
  if (isRecord(value) && isRecord(value.result)) {
    return value.result;
  }
  return briefJsonSummary(value);
}

function briefJsonSummary(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      count: value.length,
      items: value.slice(0, 20).map(briefJsonEntity)
    };
  }
  if (!isRecord(value)) {
    return value;
  }
  if (Array.isArray(value.items)) {
    return pickDefined({
      schemaVersion: value.schemaVersion,
      count: value.items.length,
      items: value.items.slice(0, 20).map(briefJsonEntity)
    });
  }
  if (Array.isArray(value.work)) {
    return pickDefined({
      schemaVersion: value.schemaVersion,
      count: value.work.length,
      work: value.work.slice(0, 20).map(briefJsonEntity)
    });
  }
  return pickDefined({
    schemaVersion: value.schemaVersion,
    id: value.id,
    kind: value.kind,
    status: value.status,
    title: value.title,
    priority: value.priority,
    ok: value.ok,
    active: value.active,
    action: value.action,
    workspaceRoot: value.workspaceRoot,
    subjectId: value.subjectId,
    subjectType: value.subjectType,
    evidenceCount: value.evidenceCount,
    verificationCount: value.verificationCount,
    activeBlockerIds: value.activeBlockerIds,
    blockedBy: value.blockedBy,
    requiredCloseoutGates: value.requiredCloseoutGates,
    result: isRecord(value.result) ? value.result : undefined,
    sync: isRecord(value.sync)
      ? pickDefined({
          ok: value.sync.ok,
          vaultOk: value.sync.vaultOk,
          ledgersOk: value.sync.ledgersOk,
          searchIndexOk: value.sync.searchIndexOk,
          gitOk: value.sync.gitOk
        })
      : undefined,
    agent: isRecord(value.agent)
      ? pickDefined({
          agentId: value.agent.agentId,
          activeReservations: isRecord(value.agent.reservations) ? value.agent.reservations.activeCount : undefined,
          capacityRemaining: isRecord(value.agent.reservations) ? value.agent.reservations.capacityRemaining : undefined,
          readyWork: isRecord(value.agent.readyWork) ? value.agent.readyWork.claimableCount : undefined
        })
      : undefined
  });
}

function briefJsonEntity(value: unknown): unknown {
  if (!isRecord(value)) {
    return value;
  }
  const meta = isRecord(value.meta) ? value.meta : undefined;
  return pickDefined({
    id: typeof value.id === "string" ? value.id : meta?.id,
    kind: value.kind,
    status: value.status,
    priority: value.priority,
    title: value.title,
    subjectId: value.subjectId,
    outcome: value.outcome,
    verdict: value.verdict
  });
}

function decorateJsonEnvelope(text: string, metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return text;
  }
  try {
    const parsed = safeParseJson(text, { schemaName: "boreal.cli.output.v1", expectedObject: true });
    if (isRecord(parsed) && parsed.ok === true && "data" in parsed) {
      return `${JSON.stringify({ ...parsed, ...metadata }, null, 2)}\n`;
    }
  } catch {
    return text;
  }
  return text;
}

function resultPath(workspaceRoot: string): string {
  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  return join(workspaceRoot, ".boreal", "results", `result-${timestamp}-${process.pid}-${randomUUID()}.json`);
}

function previewJsonEnvelope(text: string): unknown {
  try {
    const parsed = safeParseJson(text, { schemaName: "boreal.cli.output.v1", expectedObject: true });
    if (isRecord(parsed) && parsed.ok === true && "data" in parsed) {
      const agentDirectives = previewAgentDirectiveOutput(parsed.agentDirectives);
      if (agentDirectives) {
        return {
          data: previewJsonValue(parsed.data, 0),
          agentDirectives
        };
      }
      return previewJsonValue(parsed.data, 0);
    }
  } catch {
    return text.slice(0, 1_000);
  }
  return text.slice(0, 1_000);
}

function previewAgentDirectiveOutput(value: unknown): unknown | undefined {
  if (isRecord(value) && value.unchanged === true && typeof value.sourceHash === "string") {
    return {
      unchanged: true,
      sourceHash: value.sourceHash
    };
  }
  return previewAgentDirectiveBundles(value);
}

function stableTruncatedVerdictFields(command: string, text: string): Record<string, unknown> {
  if (command !== "doctor" && command !== "gate closeout") {
    return {};
  }
  try {
    const parsed = safeParseJson(text, { schemaName: "boreal.cli.output.v1", expectedObject: true });
    if (isRecord(parsed) && parsed.ok === true && isRecord(parsed.data)) {
      return pickDefined({
        ok: parsed.data.ok,
        fixed: parsed.data.fixed,
        blockingDiagnosticCodes: parsed.data.blockingDiagnosticCodes
      });
    }
  } catch {
    return {};
  }
  return {};
}

function previewAgentDirectiveBundles(value: unknown): unknown | undefined {
  if (!Array.isArray(value) || value.length === 0) {
    return undefined;
  }
  return {
    bundleCount: value.length,
    bundles: value.map((bundle) => previewAgentDirectiveBundle(bundle))
  };
}

function previewAgentDirectiveBundle(value: unknown): unknown {
  if (!isRecord(value)) {
    return previewJsonValue(value, 0);
  }
  const directives = Array.isArray(value.directives) ? value.directives.map((directive) => previewAgentDirective(directive)) : [];
  const conflicts = Array.isArray(value.conflicts) ? value.conflicts : [];
  const deprecations = Array.isArray(value.deprecations) ? value.deprecations : [];
  const missingRequired = Array.isArray(value.missingRequired) ? value.missingRequired : [];
  return {
    meta: previewAgentDirectiveMeta(value.meta),
    directiveCount: directives.length,
    directives,
    conflictCount: conflicts.length,
    conflicts,
    deprecationCount: deprecations.length,
    deprecations,
    missingRequiredCount: missingRequired.length,
    missingRequired
  };
}

function previewAgentDirectiveMeta(value: unknown): unknown {
  if (!isRecord(value)) {
    return previewJsonValue(value, 0);
  }
  return pickDefined({
    id: value.id,
    schemaVersion: value.schemaVersion,
    registryVersion: value.registryVersion,
    generatedAt: value.generatedAt,
    commandPath: value.commandPath,
    envelopeSchema: value.envelopeSchema,
    sourceSnapshotHash: value.sourceSnapshotHash
  });
}

function previewAgentDirective(value: unknown): unknown {
  if (!isRecord(value)) {
    return previewJsonValue(value, 0);
  }
  return pickDefined({
    id: value.id,
    registryId: value.registryId,
    version: value.version,
    family: value.family,
    severity: value.severity,
    audience: value.audience,
    kind: value.kind,
    title: value.title,
    instruction: value.instruction,
    subject: value.subject,
    blocksCloseout: value.blocksCloseout,
    acknowledgement: value.acknowledgement,
    data: previewJsonValue(value.data, 0)
  });
}

function pickDefined(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function previewJsonValue(value: unknown, depth: number): unknown {
  if (typeof value === "string") {
    return value.length > 500 ? `${value.slice(0, 500)}...` : value;
  }
  if (typeof value !== "object" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return {
      kind: "array",
      length: value.length,
      items: value.slice(0, 5).map((entry) => previewJsonValue(entry, depth + 1))
    };
  }
  const entries = Object.entries(value);
  if (depth >= 2) {
    return {
      kind: "object",
      keys: entries.slice(0, 20).map(([key]) => key),
      keyCount: entries.length
    };
  }
  return Object.fromEntries(entries.slice(0, 20).map(([key, entry]) => [key, previewJsonValue(entry, depth + 1)]));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function table(rows: readonly Record<string, string | number | undefined>[]): string {
  if (rows.length === 0) {
    return "";
  }

  const columns = Object.keys(rows[0] ?? {});
  const widths = new Map(
    columns.map((column) => [
      column,
      Math.max(column.length, ...rows.map((row) => String(row[column] ?? "").length))
    ])
  );

  const header = columns.map((column) => column.padEnd(widths.get(column) ?? column.length)).join("  ");
  const divider = columns.map((column) => "-".repeat(widths.get(column) ?? column.length)).join("  ");
  const body = rows
    .map((row) => columns.map((column) => String(row[column] ?? "").padEnd(widths.get(column) ?? 0)).join("  "))
    .join("\n");
  return `${header}\n${divider}\n${body}\n`;
}
