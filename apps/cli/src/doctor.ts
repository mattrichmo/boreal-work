import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import {
  BorealError,
  type ContextPack,
  type EvidenceId,
  type EvidenceRecord,
  type VerificationRecord,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import { breakStaleFileLock, inspectFileLock } from "@boreal/storage";
import { deriveReadinessStatus } from "@boreal/work-engine";

import type { CliContext } from "./context.js";

export type DiagnosticSeverity = "ok" | "warning" | "error" | "fixed";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly details?: unknown;
}

export interface DoctorResult {
  readonly ok: boolean;
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

const STATE_SECTIONS = [
  "workItems",
  "evidence",
  "verifications",
  "knowledgeSources",
  "claims",
  "decisions",
  "graphEdges",
  "reservations",
  "events",
  "projections",
  "contextPacks"
] as const;

export async function runDoctor(context: CliContext, fix: boolean): Promise<DoctorResult> {
  const diagnostics: Diagnostic[] = [];
  let fixed = false;

  diagnostics.push({
    code: "workspace.root",
    severity: "ok",
    message: `Workspace root: ${context.workspaceRoot}`
  });

  if (!existsSync(context.paths.borealDir)) {
    diagnostics.push({
      code: "workspace.missing",
      severity: "error",
      message: "Missing .boreal directory; run `bwrk init`"
    });
    return finalize(diagnostics, fixed);
  }

  const lockInspection = await inspectFileLock(context.paths.stateLockDir);
  if (lockInspection.exists) {
    if (lockInspection.stale) {
      if (fix) {
        await breakStaleFileLock(context.paths.stateLockDir);
        diagnostics.push({
          code: "lock.stale",
          severity: "fixed",
          message: "Removed stale runtime state lock",
          details: lockInspection
        });
        fixed = true;
      } else {
        diagnostics.push({
          code: "lock.stale",
          severity: "error",
          message: "Runtime state lock is stale; run `bwrk doctor --fix` or `bwrk lock break --stale-only`",
          details: lockInspection
        });
      }
    } else {
      diagnostics.push({
        code: "lock.active",
        severity: "warning",
        message: "Runtime state lock is currently active",
        details: lockInspection
      });
    }
  } else {
    diagnostics.push({
      code: "lock.absent",
      severity: "ok",
      message: "No runtime state lock present"
    });
  }

  const state = await readStateDocument(context, diagnostics);
  if (!state) {
    return finalize(diagnostics, fixed);
  }

  validateStateSections(state, diagnostics);
  validateMissingIds(state, diagnostics);
  validateDuplicateIds(state, diagnostics);

  const storeDiagnostics = await validateStoreRecords(context, fix, state);
  diagnostics.push(...storeDiagnostics.diagnostics);
  fixed = fixed || storeDiagnostics.fixed;

  return finalize(diagnostics, fixed);
}

async function readStateDocument(
  context: CliContext,
  diagnostics: Diagnostic[]
): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(context.paths.stateFile)) {
    diagnostics.push({
      code: "state.missing",
      severity: "error",
      message: "Missing runtime state file; run `bwrk init`"
    });
    return undefined;
  }

  try {
    const parsed = JSON.parse(await readFile(context.paths.stateFile, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      diagnostics.push({
        code: "state.shape",
        severity: "error",
        message: "Runtime state must be a JSON object"
      });
      return undefined;
    }
    if (parsed.schemaVersion !== "boreal.file-store.v1") {
      diagnostics.push({
        code: "state.schema",
        severity: "error",
        message: "Unsupported runtime state schema version",
        details: { schemaVersion: parsed.schemaVersion }
      });
      return undefined;
    }
    diagnostics.push({
      code: "state.parse",
      severity: "ok",
      message: "Runtime state JSON parses and schema version is supported"
    });
    return parsed;
  } catch (error) {
    diagnostics.push({
      code: "state.parse",
      severity: "error",
      message: "Runtime state JSON is invalid",
      details: error instanceof Error ? error.message : error
    });
    return undefined;
  }
}

function validateStateSections(state: Record<string, unknown>, diagnostics: Diagnostic[]): void {
  for (const section of STATE_SECTIONS) {
    if (!Array.isArray(state[section])) {
      diagnostics.push({
        code: "state.section",
        severity: "error",
        message: `Runtime state section ${section} must be an array`
      });
    }
  }
}

function validateMissingIds(state: Record<string, unknown>, diagnostics: Diagnostic[]): void {
  const missing: Array<{ section: string; index: number }> = [];

  for (const section of STATE_SECTIONS) {
    const values = state[section];
    if (!Array.isArray(values)) {
      continue;
    }
    values.forEach((value, index) => {
      if (!readRecordId(value, section)) {
        missing.push({ section, index });
      }
    });
  }

  diagnostics.push({
    code: "state.missing_ids",
    severity: missing.length > 0 ? "error" : "ok",
    message: missing.length > 0 ? "Records missing IDs found" : "All records expose IDs",
    details: missing.length > 0 ? missing : undefined
  });
}

function validateDuplicateIds(state: Record<string, unknown>, diagnostics: Diagnostic[]): void {
  const duplicates: Array<{ section: string; id: string }> = [];

  for (const section of STATE_SECTIONS) {
    const values = state[section];
    if (!Array.isArray(values)) {
      continue;
    }
    const seen = new Set<string>();
    for (const value of values) {
      const id = readRecordId(value, section);
      if (!id) {
        continue;
      }
      if (seen.has(id)) {
        duplicates.push({ section, id });
      } else {
        seen.add(id);
      }
    }
  }

  diagnostics.push({
    code: "state.duplicate_ids",
    severity: duplicates.length > 0 ? "error" : "ok",
    message: duplicates.length > 0 ? "Duplicate record IDs found" : "No duplicate record IDs found",
    details: duplicates.length > 0 ? duplicates : undefined
  });
}

async function validateStoreRecords(
  context: CliContext,
  fix: boolean,
  state: Record<string, unknown>
): Promise<{
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];
  let fixed = false;

  try {
    const summary = (() => {
      const rawWorkItems = stateSection<WorkItem>(state, "workItems");
      const rawEvidence = stateSection<EvidenceRecord>(state, "evidence");
      const rawVerifications = stateSection<VerificationRecord>(state, "verifications");
      const rawContextPacks = stateSection<ContextPack>(state, "contextPacks");
      const malformedRecords = [
        ...malformedIndexes(rawWorkItems, isDoctorWorkItem, "workItems"),
        ...malformedIndexes(rawEvidence, isDoctorEvidence, "evidence"),
        ...malformedIndexes(rawVerifications, isDoctorVerification, "verifications"),
        ...malformedIndexes(rawContextPacks, isDoctorContextPack, "contextPacks")
      ];
      const workItems = rawWorkItems.filter(isDoctorWorkItem);
      const evidenceById = new Set(rawEvidence.filter(isDoctorEvidence).map((record) => record.meta.id));
      const verificationsById = new Set(
        rawVerifications.filter(isDoctorVerification).map((record) => record.meta.id)
      );
      const workById = new Map(workItems.map((work) => [work.meta.id, work]));
      const danglingDependencies = workItems.flatMap((work) =>
        work.dependencyIds
          .filter((dependencyId) => !workById.has(dependencyId))
          .map((dependencyId) => ({ workId: work.meta.id, dependencyId }))
      );
      const danglingEvidence = workItems.flatMap((work) =>
        work.evidenceIds
          .filter((evidenceId) => !evidenceById.has(evidenceId))
          .map((evidenceId) => ({ workId: work.meta.id, evidenceId }))
      );
      const danglingVerifications = workItems.flatMap((work) =>
        work.verificationIds
          .filter((verificationId) => !verificationsById.has(verificationId))
          .map((verificationId) => ({ workId: work.meta.id, verificationId }))
      );
      const staleReadiness = workItems.flatMap((work) => {
        const dependencies = work.dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
        const expected = deriveReadinessStatus(work, dependencies);
        return expected === work.status ? [] : [{ workId: work.meta.id, actual: work.status, expected }];
      });
      const contextPackSubjects = new Set(rawContextPacks.filter(isDoctorContextPack).map((pack) => pack.subjectId));
      const missingContextPacks = workItems
        .filter((work) => !contextPackSubjects.has(work.meta.id))
        .map((work) => work.meta.id);

      return {
        workCount: workItems.length,
        malformedRecords,
        danglingDependencies,
        danglingEvidence,
        danglingVerifications,
        staleReadiness,
        missingContextPacks
      };
    })();

    diagnostics.push({
      code: "work.count",
      severity: "ok",
      message: `${summary.workCount} work item(s) loaded`
    });
    diagnostics.push(diagnosticFromList("state.record_shape", "Malformed runtime records", summary.malformedRecords));
    diagnostics.push(diagnosticFromList("work.dangling_dependencies", "Dangling work dependencies", summary.danglingDependencies));
    diagnostics.push(diagnosticFromList("work.dangling_evidence", "Dangling work evidence references", summary.danglingEvidence));
    diagnostics.push(
      diagnosticFromList("work.dangling_verifications", "Dangling work verification references", summary.danglingVerifications)
    );

    if (summary.staleReadiness.length > 0) {
      if (fix) {
        const repair = await context.runtime.recomputeReadiness();
        diagnostics.push({
          code: "work.readiness",
          severity: "fixed",
          message: `Recomputed derived readiness for ${repair.changed} item(s)`,
          details: summary.staleReadiness
        });
        fixed = true;
      } else {
        diagnostics.push({
          code: "work.readiness",
          severity: "error",
          message: "Derived readiness is stale",
          details: summary.staleReadiness
        });
      }
    } else {
      diagnostics.push({
        code: "work.readiness",
        severity: "ok",
        message: "Derived readiness is consistent"
      });
    }

    if (summary.missingContextPacks.length > 0) {
      if (fix) {
        await context.runtime.rebuildProjections();
        diagnostics.push({
          code: "projection.context_pack",
          severity: "fixed",
          message: "Rebuilt context pack projections",
          details: { missingContextPacks: summary.missingContextPacks }
        });
        fixed = true;
      } else {
        diagnostics.push({
          code: "projection.context_pack",
          severity: "warning",
          message: "Some work items are missing context pack projections",
          details: { missingContextPacks: summary.missingContextPacks }
        });
      }
    } else {
      diagnostics.push({
        code: "projection.context_pack",
        severity: "ok",
        message: "Context pack projections are present"
      });
    }
  } catch (error) {
    if (error instanceof BorealError) {
      diagnostics.push({
        code: "store.load",
        severity: "error",
        message: error.message,
        details: error.details
      });
    } else {
      throw error;
    }
  }

  return { fixed, diagnostics };
}

function diagnosticFromList(code: string, label: string, values: readonly unknown[]): Diagnostic {
  return {
    code,
    severity: values.length > 0 ? "error" : "ok",
    message: values.length > 0 ? label : `${label}: none`,
    details: values.length > 0 ? values : undefined
  };
}

function stateSection<T>(state: Record<string, unknown>, section: (typeof STATE_SECTIONS)[number]): readonly T[] {
  const values = state[section];
  return Array.isArray(values) ? (values as readonly T[]) : [];
}

function malformedIndexes<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
  section: string
): Array<{ section: string; index: number }> {
  return values.flatMap((value, index) => (predicate(value) ? [] : [{ section, index }]));
}

function finalize(diagnostics: readonly Diagnostic[], fixed: boolean): DoctorResult {
  const ok = diagnostics.every((diagnostic) => diagnostic.severity !== "error");
  return { ok, fixed, diagnostics };
}

function readRecordId(value: unknown, section: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (section === "contextPacks") {
    return typeof value.id === "string" ? value.id : undefined;
  }
  const meta = value.meta;
  if (!isRecord(meta)) {
    return undefined;
  }
  return typeof meta.id === "string" ? meta.id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
}

function isDoctorWorkItem(value: unknown): value is WorkItem {
  return (
    isRecord(value) &&
    readRecordId(value, "workItems") !== undefined &&
    isWorkStatus(value.status) &&
    Array.isArray(value.dependencyIds) &&
    Array.isArray(value.evidenceIds) &&
    Array.isArray(value.verificationIds)
  );
}

function isDoctorEvidence(value: unknown): value is EvidenceRecord {
  return isRecord(value) && readRecordId(value, "evidence") !== undefined && typeof value.subjectId === "string";
}

function isDoctorVerification(value: unknown): value is VerificationRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "verifications") !== undefined &&
    typeof value.subjectId === "string" &&
    Array.isArray(value.evidenceIds)
  );
}

function isDoctorContextPack(value: unknown): value is ContextPack {
  return isRecord(value) && typeof value.id === "string" && typeof value.subjectId === "string";
}

function isWorkStatus(value: unknown): value is WorkItem["status"] {
  return (
    value === "draft" ||
    value === "ready" ||
    value === "reserved" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "needs_verification" ||
    value === "verified" ||
    value === "closed" ||
    value === "cancelled"
  );
}

export function asWorkId(value: string): WorkId {
  if (!value.startsWith("bw_work_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a work id, got ${value}`);
  }
  return value as WorkId;
}

export function asEvidenceId(value: string): EvidenceId {
  if (!value.startsWith("bw_evidence_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected an evidence id, got ${value}`);
  }
  return value as EvidenceId;
}
