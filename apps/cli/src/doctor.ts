import { existsSync } from "node:fs";

import {
  BorealError,
  detectSuspiciousUnicode,
  deterministicId,
  normalizeActorId,
  normalizeLabel,
  readJsonFile,
  runtimeSnapshotSchemaIssues,
  type AgentReservation,
  type ClaimRecord,
  type ContextPack,
  type DecisionRecord,
  type EvidenceId,
  type EvidenceRecord,
  type GraphEdge,
  type KnowledgeSource,
  type ProjectionId,
  type ProjectionRecord,
  type RuntimeOperation,
  type VerificationRecord,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import { buildContextPack, buildContextProjection } from "@boreal/search";
import { breakStaleFileLock, inspectFileLock } from "@boreal/storage";
import { deriveReadinessStatus } from "@boreal/work-engine";

import type { CliContext } from "./context.js";
import { inspectGitWorktree } from "./git-worktree.js";
import { exportDriftDiagnostics, ledgerStatus, readGeneratedLedgerTombstones } from "./import-export.js";
import { inspectSearchIndex, searchIndexLockDir, writeSearchIndex } from "./search-cli.js";
import { inspectVault } from "./vault.js";

export type DiagnosticSeverity = "ok" | "warning" | "error" | "fixed";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly details?: unknown;
}

export interface DoctorResult {
  readonly ok: boolean;
  readonly strict: boolean;
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
  "operations",
  "projections",
  "contextPacks"
] as const;

const OPERATION_LOG_WARNING_COUNT = 1_000;

export async function runDoctor(context: CliContext, fix: boolean, strict = false): Promise<DoctorResult> {
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
    return finalize(diagnostics, fixed, strict);
  }

  const lockDiagnostics = await validateRuntimeLocks(context, fix);
  diagnostics.push(...lockDiagnostics.diagnostics);
  fixed = fixed || lockDiagnostics.fixed;

  diagnostics.push(await validateGitWorktree(context));
  diagnostics.push(await validateVaultStructure(context));
  diagnostics.push(await validateVaultHealth(context));

  const state = await readStateDocument(context, diagnostics);
  if (!state) {
    return finalize(diagnostics, fixed, strict);
  }

  validateStateSections(state, diagnostics);
  validateMissingIds(state, diagnostics);
  validateDuplicateIds(state, diagnostics);
  const schemaIssues = validateSchemaConformance(state, diagnostics);

  const storeDiagnostics = await validateStoreRecords(context, fix, state);
  diagnostics.push(...storeDiagnostics.diagnostics);
  fixed = fixed || storeDiagnostics.fixed;

  if (schemaIssues.length === 0) {
    const drift = await exportDriftDiagnostics(context);
    diagnostics.push({
      code: "snapshot.export_drift",
      severity: drift.drift ? "warning" : "ok",
      message: drift.drift
        ? "Latest snapshot content hash differs from current export state"
        : "Latest snapshot matches current export state or no snapshots exist",
      details: drift.drift
        ? {
            ...drift,
            repairCommand: "bwrk snapshot create --json",
            repairNote: "Create a new explicit snapshot baseline when the current state should replace the previous baseline."
          }
        : drift
    });
    const ledgers = await ledgerStatus(context, undefined);
    diagnostics.push({
      code: "ledger.export_drift",
      severity: ledgers.exists && !ledgers.ok ? "warning" : "ok",
      message: ledgerDriftMessage(ledgers),
      details:
        ledgers.exists && !ledgers.ok
          ? {
              ...ledgers,
              repairCommand: "bwrk sync refresh --json"
            }
          : ledgers
    });
  } else {
    diagnostics.push({
      code: "snapshot.export_drift",
      severity: "warning",
      message: "Skipped snapshot drift check because runtime state failed schema validation"
    });
    diagnostics.push({
      code: "ledger.export_drift",
      severity: "warning",
      message: "Skipped ledger drift check because runtime state failed schema validation"
    });
  }

  const searchDiagnostics = await validateSearchIndex(context, fix);
  diagnostics.push(...searchDiagnostics.diagnostics);
  fixed = fixed || searchDiagnostics.fixed;

  return finalize(diagnostics, fixed, strict);
}

async function validateRuntimeLocks(
  context: CliContext,
  fix: boolean
): Promise<{
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];
  let fixed = false;

  for (const target of [
    {
      codePrefix: "lock",
      path: context.paths.stateLockDir,
      label: "runtime state",
      breakHint: " or `bwrk lock break --stale-only`"
    },
    {
      codePrefix: "lock.search_index",
      path: searchIndexLockDir(context),
      label: "search index",
      breakHint: ""
    }
  ]) {
    const lockInspection = await inspectFileLock(target.path);
    if (lockInspection.exists) {
      if (lockInspection.stale) {
        if (fix) {
          await breakStaleFileLock(target.path);
          diagnostics.push({
            code: `${target.codePrefix}.stale`,
            severity: "fixed",
            message: `Removed stale ${target.label} lock`,
            details: lockInspection
          });
          fixed = true;
        } else {
          diagnostics.push({
            code: `${target.codePrefix}.stale`,
            severity: "error",
            message: `${capitalize(target.label)} lock is stale; run \`bwrk doctor --fix\`${target.breakHint}`,
            details: lockInspection
          });
        }
      } else {
        diagnostics.push({
          code: `${target.codePrefix}.active`,
          severity: "warning",
          message: `${capitalize(target.label)} lock is currently active`,
          details: lockInspection
        });
      }
    } else {
      diagnostics.push({
        code: `${target.codePrefix}.absent`,
        severity: "ok",
        message: `No ${target.label} lock present`
      });
    }
  }

  return { fixed, diagnostics };
}

async function validateGitWorktree(context: CliContext): Promise<Diagnostic> {
  const inspection = await inspectGitWorktree(context);
  return {
    code: "git.worktree",
    severity: inspection.ok ? "ok" : "warning",
    message: gitWorktreeDiagnosticMessage(inspection),
    details: inspection
  };
}

async function validateVaultStructure(context: CliContext): Promise<Diagnostic> {
  const inspection = await inspectVault(context);
  const structureOk = inspection.initialized && inspection.invalidPaths.length === 0;
  return {
    code: "vault.structure",
    severity: structureOk ? "ok" : "warning",
    message: vaultStructureDiagnosticMessage(inspection),
    details: inspection
  };
}

async function validateVaultHealth(context: CliContext): Promise<Diagnostic> {
  const inspection = await inspectVault(context);
  if (!inspection.initialized) {
    return {
      code: "vault.health",
      severity: "warning",
      message: "Skipped vault health checks because the memory vault is not initialized",
      details: inspection
    };
  }
  const unhealthy = !inspection.health.ok || inspection.health.hasWarnings;
  return {
    code: "vault.health",
    severity: unhealthy ? "warning" : "ok",
    message: unhealthy ? "Boreal memory vault has health warnings" : "Boreal memory vault health checks passed",
    details: inspection.health
  };
}

async function validateSearchIndex(
  context: CliContext,
  fix: boolean
): Promise<{
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}> {
  try {
    const inspection = await inspectSearchIndex(context);
    if (!inspection.exists || inspection.stale || inspection.error) {
      if (fix) {
        const rebuilt = await writeSearchIndex(context);
        return {
          fixed: true,
          diagnostics: [
            {
              code: "search.index",
              severity: "fixed",
              message: "Rebuilt local search index",
              details: { inspection, rebuilt }
            }
          ]
        };
      }
      return {
        fixed: false,
        diagnostics: [
          {
            code: "search.index",
            severity: "warning",
            message: searchIndexDiagnosticMessage(inspection),
            details: inspection
          }
        ]
      };
    }

    return {
      fixed: false,
      diagnostics: [
        {
          code: "search.index",
          severity: "ok",
          message: "Local search index is fresh",
          details: inspection
        }
      ]
    };
  } catch (error) {
    return {
      fixed: false,
      diagnostics: [
        {
          code: "search.index",
          severity: "warning",
          message: "Local search index could not be inspected",
          details: error instanceof Error ? error.message : error
        }
      ]
    };
  }
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
    const parsed = await readJsonFile(context.paths.stateFile, {
      schemaName: "boreal.file-store.v1",
      expectedObject: true,
      maxBytes: 50 * 1024 * 1024
    });
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
    const value = state[section];
    if (value === undefined && section === "operations") {
      continue;
    }
    if (!Array.isArray(value)) {
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

function validateSchemaConformance(
  state: Record<string, unknown>,
  diagnostics: Diagnostic[]
): ReturnType<typeof runtimeSnapshotSchemaIssues> {
  const issues = runtimeSnapshotSchemaIssues({
    workItems: stateSection(state, "workItems"),
    evidence: stateSection(state, "evidence"),
    verifications: stateSection(state, "verifications"),
    knowledgeSources: stateSection(state, "knowledgeSources"),
    claims: stateSection(state, "claims"),
    decisions: stateSection(state, "decisions"),
    graphEdges: stateSection(state, "graphEdges"),
    reservations: stateSection(state, "reservations"),
    events: stateSection(state, "events"),
    operations: stateSection(state, "operations"),
    projections: stateSection(state, "projections"),
    contextPacks: stateSection(state, "contextPacks")
  });

  diagnostics.push({
    code: "state.schema_validation",
    severity: issues.length > 0 ? "error" : "ok",
    message: issues.length > 0 ? "Runtime state failed schema validation" : "Runtime state matches integrated schemas",
    details: issues.length > 0 ? { issues: issues.slice(0, 50), issueCount: issues.length } : undefined
  });
  return issues;
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
  let workStateChanged = false;

  try {
    const generatedTombstones = await readGeneratedLedgerTombstones(context);
    const summary = (() => {
      const rawWorkItems = stateSection<WorkItem>(state, "workItems");
      const rawEvidence = stateSection<EvidenceRecord>(state, "evidence");
      const rawVerifications = stateSection<VerificationRecord>(state, "verifications");
      const rawKnowledgeSources = stateSection<KnowledgeSource>(state, "knowledgeSources");
      const rawClaims = stateSection<ClaimRecord>(state, "claims");
      const rawDecisions = stateSection<DecisionRecord>(state, "decisions");
      const rawContextPacks = stateSection<ContextPack>(state, "contextPacks");
      const rawGraphEdges = stateSection<GraphEdge>(state, "graphEdges");
      const rawReservations = stateSection<AgentReservation>(state, "reservations");
      const rawEvents = stateSection<Record<string, unknown>>(state, "events");
      const rawOperations = stateSection<RuntimeOperation>(state, "operations");
      const rawProjections = stateSection<ProjectionRecord>(state, "projections");
      const malformedRecords = [
        ...malformedIndexes(rawWorkItems, isDoctorWorkItem, "workItems"),
        ...malformedIndexes(rawEvidence, isDoctorEvidence, "evidence"),
        ...malformedIndexes(rawVerifications, isDoctorVerification, "verifications"),
        ...malformedIndexes(rawKnowledgeSources, isDoctorKnowledgeSource, "knowledgeSources"),
        ...malformedIndexes(rawClaims, isDoctorClaim, "claims"),
        ...malformedIndexes(rawDecisions, isDoctorDecision, "decisions"),
        ...malformedIndexes(rawContextPacks, isDoctorContextPack, "contextPacks"),
        ...malformedIndexes(rawGraphEdges, isDoctorGraphEdge, "graphEdges"),
        ...malformedIndexes(rawReservations, isDoctorReservation, "reservations"),
        ...malformedIndexes(rawOperations, isDoctorOperation, "operations"),
        ...malformedIndexes(rawProjections, isDoctorProjection, "projections")
      ];
      const workItems = rawWorkItems.filter(isDoctorWorkItem);
      const evidence = rawEvidence.filter(isDoctorEvidence);
      const verifications = rawVerifications.filter(isDoctorVerification);
      const knowledgeSources = rawKnowledgeSources.filter(isDoctorKnowledgeSource);
      const claims = rawClaims.filter(isDoctorClaim);
      const decisions = rawDecisions.filter(isDoctorDecision);
      const graphEdges = rawGraphEdges.filter(isDoctorGraphEdge);
      const reservations = rawReservations.filter(isDoctorReservation);
      const operations = rawOperations.filter(isDoctorOperation);
      const projections = rawProjections.filter(isDoctorProjection);
      const evidenceById = new Map(evidence.map((record) => [record.meta.id, record]));
      const sourceById = new Map(knowledgeSources.map((record) => [record.meta.id, record]));
      const verificationsById = new Map(verifications.map((record) => [record.meta.id, record]));
      const workById = new Map(workItems.map((work) => [work.meta.id, work]));
      const eventById = new Map<string, Record<string, unknown>>();
      for (const event of rawEvents) {
        const eventId = readRecordId(event, "events");
        if (eventId) {
          eventById.set(eventId, event);
        }
      }
      const eventIds = new Set(eventById.keys());
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
      const blockEdges = graphEdges.filter(
        (edge) => edge.kind === "blocks" && edge.fromType === "work" && edge.toType === "work"
      );
      const expectedDependencyIds = dependencyIdsByWorkFromGraph(workItems, blockEdges);
      const staleReadiness = workItems.flatMap((work) => {
        const dependencyIds = expectedDependencyIds.get(work.meta.id) ?? [];
        const dependencies = dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
        const expected = deriveReadinessStatus({ ...work, dependencyIds }, dependencies);
        return expected === work.status ? [] : [{ workId: work.meta.id, actual: work.status, expected }];
      });
      const contextPackSubjects = new Set(rawContextPacks.filter(isDoctorContextPack).map((pack) => pack.subjectId));
      const missingContextPacks = workItems
        .filter((work) => !contextPackSubjects.has(work.meta.id))
        .filter((work) => !generatedTombstones.contextPackIds.has(expectedContextProjectionId(work.meta.id)))
        .map((work) => work.meta.id);
      const contextPackBySubject = new Map(
        rawContextPacks.filter(isDoctorContextPack).map((pack) => [pack.subjectId, pack])
      );
      const contextProjectionBySubject = new Map(
        projections.filter((projection) => projection.kind === "context-pack").map((projection) => [projection.subjectId, projection])
      );
      const missingContextProjections = workItems
        .filter((work) => !contextProjectionBySubject.has(work.meta.id))
        .filter((work) => !generatedTombstones.projectionIds.has(expectedContextProjectionId(work.meta.id)))
        .map((work) => work.meta.id);
      const contextPackDrift = workItems.flatMap((work) => {
        const pack = contextPackBySubject.get(work.meta.id);
        if (!pack) {
          return [];
        }
        if (generatedTombstones.contextPackIds.has(pack.id)) {
          return [];
        }
        const graphWork = { ...work, dependencyIds: expectedDependencyIds.get(work.meta.id) ?? [] };
        const expected = buildContextPack({
          work: graphWork,
          evidence: evidence.filter((record) => record.subjectId === work.meta.id),
          sources: knowledgeSources,
          claims,
          decisions,
          actor: context.actor,
          now: pack.generatedAt
        });
        return contextPackMatches(pack, expected)
          ? []
          : [{ workId: work.meta.id, contextPackId: pack.id, issue: "context_pack_drift" }];
      });
      const contextProjectionDrift = workItems.flatMap((work) => {
        const projection = contextProjectionBySubject.get(work.meta.id);
        if (!projection) {
          return [];
        }
        if (generatedTombstones.projectionIds.has(projection.meta.id)) {
          return [];
        }
        const graphWork = { ...work, dependencyIds: expectedDependencyIds.get(work.meta.id) ?? [] };
        const expected = buildContextProjection({
          work: graphWork,
          evidence: evidence.filter((record) => record.subjectId === work.meta.id),
          sources: knowledgeSources,
          claims,
          decisions,
          actor: context.actor,
          now: projection.meta.updatedAt
        });
        return contextProjectionMatches(projection, expected)
          ? []
          : [{ workId: work.meta.id, projectionId: projection.meta.id, issue: "context_projection_drift" }];
      });
      const danglingClaimSources = claims.flatMap((claim) =>
        claim.sourceIds
          .filter((sourceId) => !sourceById.has(sourceId))
          .map((sourceId) => ({ claimId: claim.meta.id, sourceId }))
      );
      const danglingClaimEvidence = claims.flatMap((claim) =>
        claim.evidenceIds
          .filter((evidenceId) => !evidenceById.has(evidenceId))
          .map((evidenceId) => ({ claimId: claim.meta.id, evidenceId }))
      );
      const danglingDecisionSources = decisions.flatMap((decision) =>
        decision.sourceIds
          .filter((sourceId) => !sourceById.has(sourceId))
          .map((sourceId) => ({ decisionId: decision.meta.id, sourceId }))
      );
      const duplicateGraphEdges = duplicateGraphEdgeKeys(graphEdges);
      const danglingWorkGraphEdges = graphEdges.flatMap((edge) => {
        const issues: Array<{ edgeId: string; side: "from" | "to"; workId: string }> = [];
        if (edge.fromType === "work" && !workById.has(edge.fromId as WorkId)) {
          issues.push({ edgeId: edge.meta.id, side: "from", workId: edge.fromId });
        }
        if (edge.toType === "work" && !workById.has(edge.toId as WorkId)) {
          issues.push({ edgeId: edge.meta.id, side: "to", workId: edge.toId });
        }
        return issues;
      });
      const blockEdgeKeys = new Set(blockEdges.map((edge) => `${edge.fromId}->${edge.toId}`));
      const blockConsistency = [
        ...blockEdges.flatMap((edge) => {
          const blockedWork = workById.get(edge.toId as WorkId);
          if (!blockedWork || blockedWork.dependencyIds.includes(edge.fromId as WorkId)) {
            return [];
          }
          return [
            {
              issue: "edge_missing_dependency",
              edgeId: edge.meta.id,
              workId: edge.toId,
              dependencyId: edge.fromId
            }
          ];
        }),
        ...workItems.flatMap((work) =>
          work.dependencyIds
            .filter((dependencyId) => workById.has(dependencyId) && !blockEdgeKeys.has(`${dependencyId}->${work.meta.id}`))
            .map((dependencyId) => ({
              issue: "dependency_missing_edge",
              workId: work.meta.id,
              dependencyId
            }))
        )
      ];
      const dependencyCycles = findDependencyCycles(blockEdges);
      const reservationConsistency = reservationPolicyIssues(workItems, reservations);
      const expiredActiveReservations = reservations
        .filter((reservation) => reservation.status === "active")
        .filter((reservation) => reservation.expiresAt !== undefined && Date.parse(reservation.expiresAt) <= Date.now())
        .map((reservation) => ({
          reservationId: reservation.meta.id,
          workId: reservation.workId,
          agentId: reservation.agentId,
          expiresAt: reservation.expiresAt
        }));
      const verificationPolicy = verificationPolicyIssues(workItems, verifications, evidenceById);
      const closedWithoutReason = workItems
        .filter((work) => work.status === "closed" && !work.closedReason?.trim())
        .map((work) => work.meta.id);
      const danglingOperationEvents = operations.flatMap((operation) =>
        operation.eventIds
          .filter((eventId) => !eventIds.has(eventId))
          .map((eventId) => ({ operationId: operation.meta.id, eventId }))
      );
      const operationIdsByEvent = operationIdsByEventId(operations);
      const legacyOperationEvents = rawEvents.flatMap((event) => {
        const eventId = readRecordId(event, "events");
        if (!eventId) {
          return [];
        }
        if (event.operationLink === "legacy") {
          return [{ issue: "legacy_operation_link", eventId }];
        }
        const operationIds = operationIdsByEvent.get(eventId) ?? [];
        if (event.operationId === undefined && operationIds.length > 0) {
          return [{ issue: "unmarked_legacy_operation_link", eventId, operationIds }];
        }
        return [];
      });
      const operationById = new Map<string, RuntimeOperation>(operations.map((operation) => [operation.meta.id, operation]));
      const operationEventCausality = [
        ...operations.flatMap((operation) =>
          operation.eventIds.flatMap((eventId) => {
            const event = eventById.get(eventId);
            if (!event || event.operationId === undefined || event.operationId === operation.meta.id) {
              return [];
            }
            return [
              {
                issue: "event_points_to_different_operation",
                operationId: operation.meta.id,
                eventId,
                eventOperationId: event.operationId
              }
            ];
          })
        ),
        ...rawEvents.flatMap((event) => {
          const eventId = readRecordId(event, "events");
          const operationId = event.operationId;
          if (!eventId || typeof operationId !== "string") {
            return [];
          }
          const operation = operationById.get(operationId);
          if (!operation || operation.eventIds.some((id) => id === eventId)) {
            return [];
          }
          return [{ issue: "operation_missing_event_id", operationId, eventId }];
        })
      ];
      const stringSafety = stringSafetyIssues({
        workItems,
        evidence,
        verifications,
        knowledgeSources,
        claims,
        decisions,
        graphEdges,
        reservations,
        operations,
        contextPacks: rawContextPacks.filter(isDoctorContextPack)
      });
      const labelCollisions = labelNormalizationCollisions(workItems);
      const actorCollisions = actorNormalizationCollisions({
        workItems,
        evidence,
        verifications,
        knowledgeSources,
        claims,
        decisions,
        graphEdges,
        reservations,
        operations
      });

      return {
        workCount: workItems.length,
        operationCount: operations.length,
        malformedRecords,
        danglingDependencies,
        danglingEvidence,
        danglingVerifications,
        staleReadiness,
        missingContextPacks,
        contextPackDrift,
        missingContextProjections,
        contextProjectionDrift,
        danglingClaimSources,
        danglingClaimEvidence,
        danglingDecisionSources,
        duplicateGraphEdges,
        danglingWorkGraphEdges,
        blockConsistency,
        dependencyCycles,
        reservationConsistency,
        expiredActiveReservations,
        verificationPolicy,
        closedWithoutReason,
        danglingOperationEvents,
        legacyOperationEvents,
        operationEventCausality,
        stringSafety,
        labelCollisions,
        actorCollisions
      };
    })();

    diagnostics.push({
      code: "work.count",
      severity: "ok",
      message: `${summary.workCount} work item(s) loaded`
    });
    diagnostics.push({
      code: "operation.count",
      severity: "ok",
      message: `${summary.operationCount} operation(s) loaded`
    });
    diagnostics.push({
      code: "operation.volume",
      severity: summary.operationCount > OPERATION_LOG_WARNING_COUNT ? "warning" : "ok",
      message:
        summary.operationCount > OPERATION_LOG_WARNING_COUNT
          ? `Operation log has more than ${OPERATION_LOG_WARNING_COUNT} records; run \`bwrk operation prune --keep ${OPERATION_LOG_WARNING_COUNT} --json\``
          : "Operation log volume is within the recommended bound",
      details:
        summary.operationCount > OPERATION_LOG_WARNING_COUNT
          ? { operationCount: summary.operationCount, recommendedKeep: OPERATION_LOG_WARNING_COUNT }
          : undefined
    });
    diagnostics.push(diagnosticFromList("state.record_shape", "Malformed runtime records", summary.malformedRecords));
    diagnostics.push(diagnosticFromList("work.dangling_dependencies", "Dangling work dependencies", summary.danglingDependencies));
    diagnostics.push(diagnosticFromList("work.dangling_evidence", "Dangling work evidence references", summary.danglingEvidence));
    diagnostics.push(
      diagnosticFromList("work.dangling_verifications", "Dangling work verification references", summary.danglingVerifications)
    );
    diagnostics.push(diagnosticFromList("knowledge.dangling_sources", "Dangling knowledge source references", [
      ...summary.danglingClaimSources,
      ...summary.danglingDecisionSources
    ]));
    diagnostics.push(diagnosticFromList("knowledge.dangling_evidence", "Dangling claim evidence references", summary.danglingClaimEvidence));
    diagnostics.push(diagnosticFromList("graph.duplicate_edges", "Duplicate graph edges", summary.duplicateGraphEdges));
    diagnostics.push(diagnosticFromList("graph.dangling_work_edges", "Dangling graph work edges", summary.danglingWorkGraphEdges));
    if (summary.blockConsistency.length > 0) {
      if (fix) {
        const repaired = await context.runtime.repairDependencyProjection();
        workStateChanged = workStateChanged || repaired.dependencyChanged > 0 || repaired.readinessChanged > 0;
        diagnostics.push({
          code: "graph.block_consistency",
          severity: "fixed",
          message: "Repaired work dependency projection from block graph",
          details: { issues: summary.blockConsistency, repaired }
        });
        fixed = true;
      } else {
        diagnostics.push(diagnosticFromList("graph.block_consistency", "Block graph and dependency refs disagree", summary.blockConsistency));
      }
    } else {
      diagnostics.push({
        code: "graph.block_consistency",
        severity: "ok",
        message: "Block graph and dependency refs agree"
      });
    }
    diagnostics.push(diagnosticFromList("graph.dependency_cycles", "Dependency cycles found", summary.dependencyCycles));
    diagnostics.push(diagnosticFromList("reservation.consistency", "Reservation consistency issues", summary.reservationConsistency));
    if (summary.expiredActiveReservations.length > 0) {
      if (fix) {
        const repair = await context.runtime.expireStaleReservations();
        workStateChanged = workStateChanged || repair.expired.length > 0;
        diagnostics.push({
          code: "reservation.expired",
          severity: "fixed",
          message: `Expired ${repair.expired.length} stale active reservation(s)`,
          details: summary.expiredActiveReservations
        });
        fixed = true;
      } else {
        diagnostics.push({
          code: "reservation.expired",
          severity: "error",
          message: "Expired active reservations found",
          details: summary.expiredActiveReservations
        });
      }
    } else {
      diagnostics.push({
        code: "reservation.expired",
        severity: "ok",
        message: "No expired active reservations"
      });
    }
    diagnostics.push(diagnosticFromList("verification.policy", "Verification policy issues", summary.verificationPolicy));
    diagnostics.push(diagnosticFromList("work.closed_reason", "Closed work items missing a close reason", summary.closedWithoutReason));
    diagnostics.push(diagnosticFromList("operation.dangling_events", "Operation event references missing runtime events", summary.danglingOperationEvents));
    diagnostics.push(warningDiagnosticFromList("operation.legacy_events", "Legacy operation/event links", summary.legacyOperationEvents));
    diagnostics.push(diagnosticFromList("operation.event_causality", "Operation and event causality links disagree", summary.operationEventCausality));
    diagnostics.push(diagnosticFromList("string.suspicious_unicode", "Unsafe Unicode in machine-facing strings", summary.stringSafety));
    diagnostics.push(warningDiagnosticFromList("label.normalization_collision", "Label normalization collisions", summary.labelCollisions));
    diagnostics.push(warningDiagnosticFromList("actor.normalization_collision", "Actor normalization collisions", summary.actorCollisions));

    if (summary.staleReadiness.length > 0) {
      if (fix) {
        const repair = await context.runtime.recomputeReadiness();
        workStateChanged = workStateChanged || repair.changed > 0;
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

    const contextPackIssues = [...summary.missingContextPacks.map((workId) => ({ workId, issue: "missing_context_pack" })), ...summary.contextPackDrift];
    const contextProjectionIssues = [
      ...summary.missingContextProjections.map((workId) => ({ workId, issue: "missing_context_projection" })),
      ...summary.contextProjectionDrift
    ];
    if (contextPackIssues.length > 0 || contextProjectionIssues.length > 0 || (fix && workStateChanged)) {
      if (fix) {
        await context.runtime.rebuildProjections({
          skipContextPackIds: generatedTombstones.contextPackIds,
          skipProjectionIds: generatedTombstones.projectionIds
        });
        diagnostics.push({
          code: "projection.context_pack",
          severity: "fixed",
          message: "Rebuilt context pack projections",
          details: { contextPackIssues, contextProjectionIssues, workStateChanged }
        });
        fixed = true;
      } else {
        diagnostics.push({
          code: "projection.context_pack",
          severity: "warning",
          message: "Some context pack projections are missing or stale",
          details: { contextPackIssues, contextProjectionIssues }
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

function warningDiagnosticFromList(code: string, label: string, values: readonly unknown[]): Diagnostic {
  return {
    code,
    severity: values.length > 0 ? "warning" : "ok",
    message: values.length > 0 ? label : `${label}: none`,
    details: values.length > 0 ? values : undefined
  };
}

function ledgerDriftMessage(status: Awaited<ReturnType<typeof ledgerStatus>>): string {
  if (!status.exists) {
    return "No JSONL ledger export exists yet";
  }
  if (status.error) {
    return "JSONL ledger export is invalid";
  }
  if (status.stale) {
    return "JSONL ledger export differs from current runtime state";
  }
  return "JSONL ledger export matches current runtime state";
}

function gitWorktreeDiagnosticMessage(status: Awaited<ReturnType<typeof inspectGitWorktree>>): string {
  if (!status.insideWorktree) {
    return "Workspace is not inside a Git worktree";
  }
  if (!status.ok && status.detached) {
    return "Collaboration ledger or memory paths are dirty on a detached Git HEAD";
  }
  if (!status.ok && status.protectedBranch) {
    return "Collaboration ledger or memory paths are dirty on a protected Git branch";
  }
  if (status.protectedBranch) {
    return "Git worktree is on a protected branch with no dirty collaboration paths";
  }
  return "Git worktree collaboration paths are safe";
}

function vaultStructureDiagnosticMessage(status: Awaited<ReturnType<typeof inspectVault>>): string {
  if (status.invalidPaths.length > 0) {
    return "Boreal memory vault has paths with the wrong type";
  }
  if (!status.initialized) {
    return "Boreal memory vault is missing or incomplete; run `bwrk vault init`";
  }
  return "Boreal memory vault structure is initialized";
}

interface MachineStringField {
  readonly section: string;
  readonly id: string;
  readonly field: string;
  readonly value: string;
}

interface StringSafetyInput {
  readonly workItems: readonly WorkItem[];
  readonly evidence: readonly EvidenceRecord[];
  readonly verifications: readonly VerificationRecord[];
  readonly knowledgeSources: readonly KnowledgeSource[];
  readonly claims: readonly ClaimRecord[];
  readonly decisions: readonly DecisionRecord[];
  readonly graphEdges: readonly GraphEdge[];
  readonly reservations: readonly AgentReservation[];
  readonly operations: readonly RuntimeOperation[];
  readonly contextPacks: readonly ContextPack[];
}

function stringSafetyIssues(input: StringSafetyInput): Array<Record<string, unknown>> {
  const fields: MachineStringField[] = [
    ...input.workItems.flatMap((work) => [
      ...metaStringFields("workItems", work.meta.id, work),
      stringField("workItems", work.meta.id, "title", work.title),
      ...work.labels.map((label, index) => stringField("workItems", work.meta.id, `labels[${index}]`, label))
    ]),
    ...input.evidence.flatMap((evidence) => [
      ...metaStringFields("evidence", evidence.meta.id, evidence),
      ...(evidence.uri ? [stringField("evidence", evidence.meta.id, "uri", evidence.uri)] : [])
    ]),
    ...input.verifications.flatMap((verification) => metaStringFields("verifications", verification.meta.id, verification)),
    ...input.knowledgeSources.flatMap((source) => [
      ...metaStringFields("knowledgeSources", source.meta.id, source),
      stringField("knowledgeSources", source.meta.id, "title", source.title),
      stringField("knowledgeSources", source.meta.id, "uri", source.uri)
    ]),
    ...input.claims.flatMap((claim) => metaStringFields("claims", claim.meta.id, claim)),
    ...input.decisions.flatMap((decision) => [
      ...metaStringFields("decisions", decision.meta.id, decision),
      stringField("decisions", decision.meta.id, "title", decision.title)
    ]),
    ...input.graphEdges.flatMap((edge) => metaStringFields("graphEdges", edge.meta.id, edge)),
    ...input.reservations.flatMap((reservation) => [
      ...metaStringFields("reservations", reservation.meta.id, reservation),
      stringField("reservations", reservation.meta.id, "agentId", String(reservation.agentId))
    ]),
    ...input.operations.flatMap((operation) => [
      ...metaStringFields("operations", operation.meta.id, operation),
      stringField("operations", operation.meta.id, "sessionId", operation.sessionId),
      stringField("operations", operation.meta.id, "commandPath", operation.commandPath),
      stringField("operations", operation.meta.id, "actorId", operation.actorId),
      ...operation.argv.map((entry, index) => stringField("operations", operation.meta.id, `argv[${index}]`, entry))
    ]),
    ...input.contextPacks.map((pack) => stringField("contextPacks", pack.id, "title", pack.title))
  ];

  return fields.flatMap((field) => {
    const findings = detectSuspiciousUnicode(field.value);
    return findings.length > 0
      ? [
          {
            section: field.section,
            id: field.id,
            field: field.field,
            findings
          }
        ]
      : [];
  });
}

function labelNormalizationCollisions(workItems: readonly WorkItem[]): Array<Record<string, unknown>> {
  const entries = workItems.flatMap((work) => [
    ...work.labels.map((value, index) => ({
      value,
      section: "workItems",
      id: work.meta.id,
      field: `labels[${index}]`
    })),
    ...work.meta.tags.map((value, index) => ({
      value,
      section: "workItems",
      id: work.meta.id,
      field: `meta.tags[${index}]`
    }))
  ]);
  return normalizationCollisions(entries, normalizeLabel);
}

function actorNormalizationCollisions(input: Omit<StringSafetyInput, "contextPacks">): Array<Record<string, unknown>> {
  const records = [
    ...input.workItems.map((record) => ({ section: "workItems", id: record.meta.id, record })),
    ...input.evidence.map((record) => ({ section: "evidence", id: record.meta.id, record })),
    ...input.verifications.map((record) => ({ section: "verifications", id: record.meta.id, record })),
    ...input.knowledgeSources.map((record) => ({ section: "knowledgeSources", id: record.meta.id, record })),
    ...input.claims.map((record) => ({ section: "claims", id: record.meta.id, record })),
    ...input.decisions.map((record) => ({ section: "decisions", id: record.meta.id, record })),
    ...input.graphEdges.map((record) => ({ section: "graphEdges", id: record.meta.id, record })),
    ...input.reservations.map((record) => ({ section: "reservations", id: record.meta.id, record })),
    ...input.operations.map((record) => ({ section: "operations", id: record.meta.id, record }))
  ];
  const actorEntries = records.flatMap(({ section, id, record }) => [
    {
      value: String(record.meta.createdBy.id),
      section,
      id,
      field: "meta.createdBy.id"
    },
    {
      value: String(record.meta.updatedBy.id),
      section,
      id,
      field: "meta.updatedBy.id"
    }
  ]);
  const reservationEntries = input.reservations.map((reservation) => ({
    value: String(reservation.agentId),
    section: "reservations",
    id: reservation.meta.id,
    field: "agentId"
  }));
  const operationEntries = input.operations.map((operation) => ({
    value: operation.actorId,
    section: "operations",
    id: operation.meta.id,
    field: "actorId"
  }));
  return normalizationCollisions([...actorEntries, ...reservationEntries, ...operationEntries], normalizeActorId);
}

function metaStringFields(
  section: string,
  id: string,
  record: { readonly meta: { readonly createdBy: { readonly id: unknown }; readonly updatedBy: { readonly id: unknown }; readonly tags: readonly string[] } }
): readonly MachineStringField[] {
  return [
    stringField(section, id, "meta.createdBy.id", String(record.meta.createdBy.id)),
    stringField(section, id, "meta.updatedBy.id", String(record.meta.updatedBy.id)),
    ...record.meta.tags.map((tag, index) => stringField(section, id, `meta.tags[${index}]`, tag))
  ];
}

function stringField(section: string, id: string, field: string, value: string): MachineStringField {
  return { section, id, field, value };
}

function normalizationCollisions(
  entries: readonly MachineStringField[],
  normalize: (value: string) => string
): Array<Record<string, unknown>> {
  const byNormalized = new Map<string, MachineStringField[]>();
  for (const entry of entries) {
    const normalized = tryNormalize(entry.value, normalize);
    if (!normalized) {
      continue;
    }
    byNormalized.set(normalized, [...(byNormalized.get(normalized) ?? []), entry]);
  }

  return [...byNormalized.entries()].flatMap(([normalized, values]) => {
    const rawValues = [...new Set(values.map((entry) => entry.value))].sort();
    return rawValues.length > 1
      ? [
          {
            normalized,
            rawValues,
            fields: values.map(({ section, id, field, value }) => ({ section, id, field, value }))
          }
        ]
      : [];
  });
}

function tryNormalize(value: string, normalize: (value: string) => string): string | undefined {
  try {
    return normalize(value);
  } catch {
    return undefined;
  }
}

function searchIndexDiagnosticMessage(inspection: {
  readonly exists: boolean;
  readonly stale: boolean;
  readonly error?: string;
}): string {
  if (!inspection.exists) {
    return "Local search index is missing; run `bwrk search index` or `bwrk doctor --fix`";
  }
  if (inspection.error) {
    return "Local search index is invalid; run `bwrk search index` or `bwrk doctor --fix`";
  }
  if (inspection.stale) {
    return "Local search index is stale; run `bwrk search index` or `bwrk doctor --fix`";
  }
  return "Local search index is fresh";
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

function contextPackMatches(actual: ContextPack, expected: ContextPack): boolean {
  return (
    actual.subjectId === expected.subjectId &&
    actual.title === expected.title &&
    actual.summary === expected.summary &&
    arraysEqual(actual.facts, expected.facts) &&
    arraysEqual(actual.evidence, expected.evidence)
  );
}

function contextProjectionMatches(actual: ProjectionRecord, expected: ProjectionRecord): boolean {
  const actualFacts = stringArrayValue(actual.value.facts);
  const actualEvidence = stringArrayValue(actual.value.evidence);
  const expectedFacts = stringArrayValue(expected.value.facts);
  const expectedEvidence = stringArrayValue(expected.value.evidence);
  return (
    actual.subjectId === expected.subjectId &&
    actual.kind === expected.kind &&
    actual.value.title === expected.value.title &&
    actual.value.summary === expected.value.summary &&
    actualFacts !== undefined &&
    actualEvidence !== undefined &&
    expectedFacts !== undefined &&
    expectedEvidence !== undefined &&
    arraysEqual(actualFacts, expectedFacts) &&
    arraysEqual(actualEvidence, expectedEvidence)
  );
}

function stringArrayValue(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function expectedContextProjectionId(workId: string): ProjectionId {
  return deterministicId<ProjectionId>("projection", {
    kind: "context-pack",
    subjectId: workId
  });
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function duplicateGraphEdgeKeys(graphEdges: readonly GraphEdge[]): Array<{ key: string; edgeIds: readonly string[] }> {
  const edgeIdsByKey = new Map<string, string[]>();
  for (const edge of graphEdges) {
    const key = `${edge.kind}:${edge.fromType}:${edge.fromId}:${edge.toType}:${edge.toId}:${edge.directed}`;
    edgeIdsByKey.set(key, [...(edgeIdsByKey.get(key) ?? []), edge.meta.id]);
  }
  return [...edgeIdsByKey.entries()]
    .filter(([, edgeIds]) => edgeIds.length > 1)
    .map(([key, edgeIds]) => ({ key, edgeIds }));
}

function operationIdsByEventId(operations: readonly RuntimeOperation[]): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const operation of operations) {
    for (const eventId of operation.eventIds) {
      result.set(eventId, [...(result.get(eventId) ?? []), operation.meta.id]);
    }
  }
  return result;
}

function dependencyIdsByWorkFromGraph(
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): ReadonlyMap<WorkId, readonly WorkId[]> {
  const workIds = new Set(workItems.map((work) => work.meta.id));
  const dependencyIdsByWork = new Map<WorkId, WorkId[]>();
  for (const work of workItems) {
    dependencyIdsByWork.set(work.meta.id, []);
  }
  for (const edge of graphEdges) {
    if (
      edge.kind !== "blocks" ||
      edge.fromType !== "work" ||
      edge.toType !== "work" ||
      !workIds.has(edge.fromId as WorkId) ||
      !workIds.has(edge.toId as WorkId)
    ) {
      continue;
    }
    const workId = edge.toId as WorkId;
    dependencyIdsByWork.set(workId, [...(dependencyIdsByWork.get(workId) ?? []), edge.fromId as WorkId]);
  }
  return new Map(
    [...dependencyIdsByWork.entries()].map(([workId, dependencyIds]) => [
      workId,
      [...new Set(dependencyIds)].sort((left, right) => left.localeCompare(right))
    ])
  );
}

function findDependencyCycles(graphEdges: readonly GraphEdge[]): Array<{ cycle: readonly string[] }> {
  const adjacency = new Map<string, string[]>();
  for (const edge of graphEdges) {
    const values = adjacency.get(edge.fromId) ?? [];
    values.push(edge.toId);
    adjacency.set(edge.fromId, values);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];
  const seenCycles = new Set<string>();
  const cycles: Array<{ cycle: readonly string[] }> = [];

  const visit = (node: string): void => {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      const cycle = [...path.slice(start), node];
      const key = cycle.join("->");
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        cycles.push({ cycle });
      }
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visiting.add(node);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      visit(next);
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of adjacency.keys()) {
    visit(node);
  }

  return cycles;
}

function reservationPolicyIssues(
  workItems: readonly WorkItem[],
  reservations: readonly AgentReservation[]
): Array<Record<string, unknown>> {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const activeReservations = reservations.filter((reservation) => reservation.status === "active");
  const activeReservationsById = new Map(activeReservations.map((reservation) => [reservation.meta.id, reservation]));
  const activeReservationsByWork = new Map<string, AgentReservation[]>();

  for (const reservation of activeReservations) {
    activeReservationsByWork.set(reservation.workId, [
      ...(activeReservationsByWork.get(reservation.workId) ?? []),
      reservation
    ]);
  }

  return [
    ...activeReservations.flatMap((reservation) => {
      const work = workById.get(reservation.workId);
      if (!work) {
        return [{ issue: "active_reservation_missing_work", reservationId: reservation.meta.id, workId: reservation.workId }];
      }
      if (work.status === "closed" || work.status === "cancelled") {
        return [
          {
            issue: "active_reservation_for_terminal_work",
            reservationId: reservation.meta.id,
            workId: reservation.workId,
            status: work.status
          }
        ];
      }
      if (!isReservationBackedWorkStatus(work.status) || work.reservationId !== reservation.meta.id) {
        return [
          {
            issue: "active_reservation_not_reflected_by_work",
            reservationId: reservation.meta.id,
            workId: reservation.workId,
            workStatus: work.status,
            workReservationId: work.reservationId
          }
        ];
      }
      return [];
    }),
    ...[...activeReservationsByWork.entries()]
      .filter(([, values]) => values.length > 1)
      .map(([workId, values]) => ({
        issue: "multiple_active_reservations_for_work",
        workId,
        reservationIds: values.map((reservation) => reservation.meta.id)
      })),
    ...workItems.flatMap((work) => {
      if (isReservationBackedWorkStatus(work.status) && work.reservationId && !activeReservationsById.has(work.reservationId)) {
        return [{ issue: "work_status_missing_active_reservation", workId: work.meta.id, status: work.status, reservationId: work.reservationId }];
      }
      if (work.status === "reserved" && !work.reservationId) {
        return [{ issue: "legacy_reserved_work_missing_reservation", workId: work.meta.id }];
      }
      if (work.reservationId && !reservations.some((reservation) => reservation.meta.id === work.reservationId)) {
        return [{ issue: "work_reservation_missing_record", workId: work.meta.id, reservationId: work.reservationId }];
      }
      return [];
    })
  ];
}

function isReservationBackedWorkStatus(status: WorkItem["status"]): boolean {
  return status === "in_progress" || status === "reserved";
}

function verificationPolicyIssues(
  workItems: readonly WorkItem[],
  verifications: readonly VerificationRecord[],
  evidenceById: ReadonlyMap<EvidenceId, EvidenceRecord>
): Array<Record<string, unknown>> {
  const verificationsById = new Map(verifications.map((verification) => [verification.meta.id, verification]));
  const passedVerificationHasPassedEvidence = (verification: VerificationRecord): boolean =>
    verification.verdict === "passed" &&
    verification.evidenceIds.some((evidenceId) => evidenceById.get(evidenceId)?.outcome === "passed");

  return [
    ...verifications
      .filter((verification) => verification.verdict === "passed" && !passedVerificationHasPassedEvidence(verification))
      .map((verification) => ({
        issue: "passed_verification_without_passed_evidence",
        verificationId: verification.meta.id,
        subjectId: verification.subjectId,
        evidenceIds: verification.evidenceIds
      })),
    ...workItems
      .filter((work) => work.status === "verified")
      .filter(
        (work) =>
          !work.verificationIds
            .map((verificationId) => verificationsById.get(verificationId))
            .filter((verification): verification is VerificationRecord => verification !== undefined)
            .some(passedVerificationHasPassedEvidence)
      )
      .map((work) => ({ issue: "verified_work_without_passed_evidence", workId: work.meta.id }))
  ];
}

function finalize(diagnostics: readonly Diagnostic[], fixed: boolean, strict: boolean): DoctorResult {
  const ok = diagnostics.every((diagnostic) => diagnostic.severity !== "error" && (!strict || diagnostic.severity !== "warning"));
  return { ok, strict, fixed, diagnostics };
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
  return (
    isRecord(value) &&
    readRecordId(value, "evidence") !== undefined &&
    typeof value.subjectId === "string" &&
    isEvidenceOutcome(value.outcome)
  );
}

function isDoctorVerification(value: unknown): value is VerificationRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "verifications") !== undefined &&
    typeof value.subjectId === "string" &&
    Array.isArray(value.evidenceIds) &&
    isVerificationVerdict(value.verdict)
  );
}

function isDoctorKnowledgeSource(value: unknown): value is KnowledgeSource {
  return (
    isRecord(value) &&
    readRecordId(value, "knowledgeSources") !== undefined &&
    isKnowledgeSourceKind(value.kind) &&
    typeof value.title === "string" &&
    typeof value.uri === "string" &&
    typeof value.summary === "string"
  );
}

function isDoctorClaim(value: unknown): value is ClaimRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "claims") !== undefined &&
    typeof value.statement === "string" &&
    isClaimStatus(value.status) &&
    Array.isArray(value.sourceIds) &&
    Array.isArray(value.evidenceIds)
  );
}

function isDoctorDecision(value: unknown): value is DecisionRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "decisions") !== undefined &&
    typeof value.title === "string" &&
    typeof value.context === "string" &&
    typeof value.decision === "string" &&
    isDecisionStatus(value.status) &&
    Array.isArray(value.consequences) &&
    Array.isArray(value.sourceIds)
  );
}

function isDoctorContextPack(value: unknown): value is ContextPack {
  return isRecord(value) && typeof value.id === "string" && typeof value.subjectId === "string";
}

function isDoctorProjection(value: unknown): value is ProjectionRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "projections") !== undefined &&
    typeof value.kind === "string" &&
    typeof value.subjectId === "string" &&
    isRecord(value.value)
  );
}

function isDoctorGraphEdge(value: unknown): value is GraphEdge {
  return (
    isRecord(value) &&
    readRecordId(value, "graphEdges") !== undefined &&
    isEdgeKind(value.kind) &&
    typeof value.fromId === "string" &&
    typeof value.fromType === "string" &&
    typeof value.toId === "string" &&
    typeof value.toType === "string" &&
    typeof value.directed === "boolean"
  );
}

function isDoctorReservation(value: unknown): value is AgentReservation {
  return (
    isRecord(value) &&
    readRecordId(value, "reservations") !== undefined &&
    typeof value.workId === "string" &&
    typeof value.agentId === "string" &&
    isReservationStatus(value.status) &&
    typeof value.reservedAt === "string" &&
    (value.expiresAt === undefined || typeof value.expiresAt === "string")
  );
}

function isDoctorOperation(value: unknown): value is RuntimeOperation {
  return (
    isRecord(value) &&
    readRecordId(value, "operations") !== undefined &&
    typeof value.sessionId === "string" &&
    typeof value.commandPath === "string" &&
    Array.isArray(value.argv) &&
    typeof value.actorId === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.finishedAt === "string" &&
    Number.isInteger(value.exitCode) &&
    (value.status === "succeeded" || value.status === "failed") &&
    typeof value.stateChanged === "boolean" &&
    typeof value.generatedArtifactsChanged === "boolean" &&
    Array.isArray(value.eventIds)
  );
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

function isEdgeKind(value: unknown): value is GraphEdge["kind"] {
  return (
    value === "blocks" ||
    value === "depends_on" ||
    value === "relates_to" ||
    value === "supports" ||
    value === "contradicts" ||
    value === "verifies" ||
    value === "references"
  );
}

function isReservationStatus(value: unknown): value is AgentReservation["status"] {
  return value === "active" || value === "released" || value === "expired";
}

function isEvidenceOutcome(value: unknown): value is EvidenceRecord["outcome"] {
  return value === "passed" || value === "failed" || value === "observed" || value === "unknown";
}

function isVerificationVerdict(value: unknown): value is VerificationRecord["verdict"] {
  return value === "passed" || value === "failed";
}

function isKnowledgeSourceKind(value: unknown): value is KnowledgeSource["kind"] {
  return value === "raw" || value === "document" || value === "chat" || value === "code" || value === "artifact";
}

function isClaimStatus(value: unknown): value is ClaimRecord["status"] {
  return value === "proposed" || value === "accepted" || value === "rejected" || value === "stale";
}

function isDecisionStatus(value: unknown): value is DecisionRecord["status"] {
  return value === "proposed" || value === "accepted" || value === "superseded" || value === "rejected";
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
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
