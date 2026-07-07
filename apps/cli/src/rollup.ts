import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  BorealError,
  deriveProjectRegistryIdentity,
  hashContent,
  nowIso,
  projectRegistryEntryIdFromIdentity,
  projectRollupSchemaIssues,
  readJsonFile,
  WORK_KINDS,
  WORK_STATUSES,
  PROJECT_ROLLUP_SCHEMA_VERSION,
  type AgentReservation,
  type AgentSummaryRecord,
  type ClaimRecord,
  type ContentHash,
  type DecisionRecord,
  type DirectiveAcknowledgementRecord,
  type EvidenceRecord,
  type GraphEdge,
  type IsoTimestamp,
  type KnowledgeSource,
  type ProjectRollupDocument,
  type ProjectRollupHealthFlags,
  type ProjectRollupAgingBucket,
  type ProjectRollupAgingReservationEntry,
  type ProjectRollupAgingWorkEntry,
  type ProjectRollupKindCounts,
  type ProjectRollupLimboEntry,
  type ProjectRollupNextWork,
  type ProjectRollupWorkIndex,
  type ProjectRollupReservationCounts,
  type ProjectRollupCountSet,
  type ReviewerHeartbeatRecord,
  type RuntimeEvent,
  type RuntimeOperation,
  type VerificationRecord,
  type WorkItem,
  type WorkKind,
  type WorkPriority,
  type WorkStatus
} from "@boreal/core";
import { writeTextFileAtomic, type BorealReader } from "@boreal/storage";

import type { CliContext } from "./context.js";

const PROJECT_ROLLUP_MAX_READ_BYTES = 5 * 1024 * 1024;
const PROJECT_ROLLUP_LIMBO_LIMIT = 25;
const PROJECT_ROLLUP_BLOCKING_GAP_SAMPLE_LIMIT = 25;
const PROJECT_ROLLUP_NEXT_LIMIT = 10;
const PROJECT_ROLLUP_WORK_INDEX_LIMIT = 2_000;
const PROJECT_ROLLUP_AGING_ITEM_LIMIT = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

const PRIORITY_RANK: Record<WorkPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3
};

const TERMINAL_WORK_STATUSES = new Set<WorkStatus>(["closed", "cancelled", "verified"]);

export interface ProjectRollupWriteOptions {
  readonly doctorOk?: boolean | null;
  readonly syncOk?: boolean | null;
}

export interface ProjectRollupWriteResult {
  readonly path: string;
  readonly schemaVersion: typeof PROJECT_ROLLUP_SCHEMA_VERSION;
  readonly generatedAt: IsoTimestamp;
  readonly stateContentHash: ContentHash;
  readonly projectId: string;
  readonly workCount: number;
}

export interface ProjectRollupInspection {
  readonly path: string;
  readonly exists: boolean;
  readonly stale: boolean;
  readonly expectedStateContentHash: ContentHash;
  readonly schemaVersion?: string;
  readonly projectId?: string;
  readonly generatedAt?: string;
  readonly stateContentHash?: string;
  readonly workCount?: number;
  readonly error?: string;
  readonly schemaIssues?: readonly unknown[];
}

interface ProjectRollupSnapshot {
  readonly workItems: readonly WorkItem[];
  readonly agentSummaries: readonly AgentSummaryRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly verifications: readonly VerificationRecord[];
  readonly directiveAcknowledgements: readonly DirectiveAcknowledgementRecord[];
  readonly knowledgeSources: readonly KnowledgeSource[];
  readonly claims: readonly ClaimRecord[];
  readonly decisions: readonly DecisionRecord[];
  readonly graphEdges: readonly GraphEdge[];
  readonly reservations: readonly AgentReservation[];
  readonly reviewerHeartbeats: readonly ReviewerHeartbeatRecord[];
  readonly events: readonly RuntimeEvent[];
  readonly operations: readonly RuntimeOperation[];
}

export function projectRollupPath(context: CliContext): string {
  return join(context.paths.borealDir, "rollup.json");
}

export async function writeProjectRollup(
  context: CliContext,
  options: ProjectRollupWriteOptions = {}
): Promise<ProjectRollupWriteResult> {
  const snapshot = await readProjectRollupSnapshot(context);
  const document = buildProjectRollupDocument(context, snapshot, options);
  const issues = projectRollupSchemaIssues(document);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_INVARIANT", "Project rollup producer emitted an invalid document", { issues });
  }
  const path = projectRollupPath(context);
  await writeTextFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`);
  return {
    path,
    schemaVersion: document.schemaVersion,
    generatedAt: document.generatedAt,
    stateContentHash: document.stateContentHash,
    projectId: document.projectId,
    workCount: document.counts.work.total
  };
}

export async function inspectProjectRollup(context: CliContext): Promise<ProjectRollupInspection> {
  const snapshot = await readProjectRollupSnapshot(context);
  const expectedStateContentHash = projectRollupStateContentHash(snapshot);
  const path = projectRollupPath(context);
  if (!existsSync(path)) {
    return {
      path,
      exists: false,
      stale: true,
      expectedStateContentHash
    };
  }

  try {
    const parsed = await readJsonFile(path, {
      schemaName: PROJECT_ROLLUP_SCHEMA_VERSION,
      expectedObject: true,
      maxBytes: PROJECT_ROLLUP_MAX_READ_BYTES
    });
    const issues = projectRollupSchemaIssues(parsed);
    if (issues.length > 0 || !isRecord(parsed)) {
      return {
        path,
        exists: true,
        stale: true,
        expectedStateContentHash,
        error: "Project rollup does not match the published schema",
        schemaIssues: issues
      };
    }

    const stateContentHash = typeof parsed.stateContentHash === "string" ? parsed.stateContentHash : undefined;
    return {
      path,
      exists: true,
      stale: stateContentHash !== expectedStateContentHash,
      expectedStateContentHash,
      schemaVersion: typeof parsed.schemaVersion === "string" ? parsed.schemaVersion : undefined,
      projectId: typeof parsed.projectId === "string" ? parsed.projectId : undefined,
      generatedAt: typeof parsed.generatedAt === "string" ? parsed.generatedAt : undefined,
      stateContentHash,
      workCount: readRollupWorkCount(parsed)
    };
  } catch (error) {
    return {
      path,
      exists: true,
      stale: true,
      expectedStateContentHash,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function readProjectRollupDocument(context: CliContext): Promise<ProjectRollupDocument> {
  const path = projectRollupPath(context);
  const parsed = await readJsonFile(path, {
    schemaName: PROJECT_ROLLUP_SCHEMA_VERSION,
    expectedObject: true,
    maxBytes: PROJECT_ROLLUP_MAX_READ_BYTES
  });
  const issues = projectRollupSchemaIssues(parsed);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Project rollup does not match the published schema", {
      path,
      issues
    });
  }
  return parsed as ProjectRollupDocument;
}

function buildProjectRollupDocument(
  context: CliContext,
  snapshot: ProjectRollupSnapshot,
  options: ProjectRollupWriteOptions
): ProjectRollupDocument {
  const generatedAt = nowIso();
  const reservationDetails = projectRollupReservationDetails(snapshot.reservations, generatedAt);
  return {
    schemaVersion: PROJECT_ROLLUP_SCHEMA_VERSION,
    projectId: projectIdForContext(context),
    workspaceRoot: context.workspaceRoot,
    generatedAt,
    stateContentHash: projectRollupStateContentHash(snapshot),
    counts: {
      work: projectRollupWorkCounts(snapshot.workItems),
      reservations: reservationDetails.counts
    },
    limbo: {
      needsVerification: projectRollupLimbo(snapshot.workItems, "needs_verification", generatedAt),
      verified: projectRollupLimbo(snapshot.workItems, "verified", generatedAt)
    },
    reservations: {
      activeIds: reservationDetails.activeIds,
      expiredIds: reservationDetails.expiredIds
    },
    enforcement: {
      blockingGaps: projectRollupBlockingGaps(snapshot.workItems)
    },
    health: projectRollupHealth(options),
    lastEvent: projectRollupLastEvent(snapshot.events),
    lastOperation: projectRollupLastOperation(snapshot.operations),
    next: {
      limit: PROJECT_ROLLUP_NEXT_LIMIT,
      work: projectRollupNextWork(snapshot.workItems)
    },
    workIndex: projectRollupWorkIndex(snapshot.workItems),
    aging: projectRollupAging(snapshot.workItems, snapshot.reservations, generatedAt)
  };
}

function projectRollupStateContentHash(snapshot: ProjectRollupSnapshot): ContentHash {
  return hashContent({
    schemaVersion: "boreal.project-rollup.state-fingerprint.v1",
    workItems: snapshot.workItems,
    agentSummaries: snapshot.agentSummaries,
    evidence: snapshot.evidence,
    verifications: snapshot.verifications,
    directiveAcknowledgements: snapshot.directiveAcknowledgements,
    knowledgeSources: snapshot.knowledgeSources,
    claims: snapshot.claims,
    decisions: snapshot.decisions,
    graphEdges: snapshot.graphEdges,
    reservations: snapshot.reservations,
    reviewerHeartbeats: snapshot.reviewerHeartbeats,
    events: snapshot.events
  });
}

async function readProjectRollupSnapshot(context: CliContext): Promise<ProjectRollupSnapshot> {
  return context.store.read((reader) => readProjectRollupSnapshotFromReader(reader));
}

async function readProjectRollupSnapshotFromReader(reader: BorealReader): Promise<ProjectRollupSnapshot> {
  const [
    workItems,
    agentSummaries,
    evidence,
    verifications,
    directiveAcknowledgements,
    knowledgeSources,
    claims,
    decisions,
    graphEdges,
    reservations,
    reviewerHeartbeats,
    events,
    operations
  ] = await Promise.all([
    reader.listWorkItems(),
    reader.listAgentSummaries(),
    reader.listEvidence(),
    reader.listVerifications(),
    reader.listDirectiveAcknowledgements(),
    reader.listKnowledgeSources(),
    reader.listClaims(),
    reader.listDecisions(),
    reader.listGraphEdges(),
    reader.listReservations(),
    reader.listReviewerHeartbeats(),
    reader.listEvents(),
    reader.listOperations()
  ]);
  return {
    workItems,
    agentSummaries,
    evidence,
    verifications,
    directiveAcknowledgements,
    knowledgeSources,
    claims,
    decisions,
    graphEdges,
    reservations,
    reviewerHeartbeats,
    events,
    operations
  };
}

function projectIdForContext(context: CliContext): string {
  return projectRegistryEntryIdFromIdentity(deriveProjectRegistryIdentity({ projectRoot: context.workspaceRoot }));
}

function projectRollupWorkCounts(workItems: readonly WorkItem[]) {
  const byStatus = Object.fromEntries(WORK_STATUSES.map((status) => [status, 0])) as Record<WorkStatus, number>;
  const byKind = Object.fromEntries(WORK_KINDS.map((kind) => [kind, 0])) as Record<WorkKind, number>;
  for (const work of workItems) {
    byStatus[work.status] += 1;
    byKind[work.kind] += 1;
  }
  return {
    total: workItems.length,
    byStatus: byStatus as ProjectRollupCountSet,
    byKind: byKind as ProjectRollupKindCounts
  };
}

function projectRollupReservationDetails(reservations: readonly AgentReservation[], generatedAt: IsoTimestamp) {
  const counts = {
    total: reservations.length,
    active: 0,
    expired: 0,
    released: 0
  } satisfies ProjectRollupReservationCounts;
  const activeIds: AgentReservation["meta"]["id"][] = [];
  const expiredIds: AgentReservation["meta"]["id"][] = [];
  for (const reservation of reservations) {
    if (reservation.status === "released") {
      counts.released += 1;
      continue;
    }
    if (reservationIsExpired(reservation, generatedAt)) {
      counts.expired += 1;
      expiredIds.push(reservation.meta.id);
      continue;
    }
    if (reservation.status === "active") {
      counts.active += 1;
      activeIds.push(reservation.meta.id);
    }
  }
  return {
    counts,
    activeIds: activeIds.sort(),
    expiredIds: expiredIds.sort()
  };
}

function reservationIsExpired(reservation: AgentReservation, generatedAt: IsoTimestamp): boolean {
  return (
    reservation.status === "expired" ||
    (reservation.status === "active" &&
      reservation.expiresAt !== undefined &&
      Date.parse(reservation.expiresAt) <= Date.parse(generatedAt))
  );
}

function projectRollupAging(
  workItems: readonly WorkItem[],
  reservations: readonly AgentReservation[],
  generatedAt: IsoTimestamp
): ProjectRollupDocument["aging"] {
  const readyItems = agingWorkItems(workItems, ["ready"], generatedAt);
  const limboItems = agingWorkItems(workItems, ["needs_verification", "verified"], generatedAt);
  const expiredReservations = agingExpiredReservations(reservations, generatedAt);
  return {
    ready: agingBucket(readyItems),
    limbo: agingBucket(limboItems),
    expiredReservations: agingBucket(expiredReservations),
    maxima: {
      readyAgeMs: oldestAgeMs(readyItems),
      limboAgeMs: oldestAgeMs(limboItems),
      expiredReservationAgeMs: oldestAgeMs(expiredReservations)
    },
    approximation: {
      readySinceSource: "work.meta.updatedAt",
      limboSinceSource: "work.meta.updatedAt",
      expiredReservationSinceSource: "reservation.expiresAt_or_meta.updatedAt",
      eventHistoryScanned: false
    }
  };
}

function agingWorkItems(
  workItems: readonly WorkItem[],
  statuses: readonly ProjectRollupAgingWorkEntry["status"][],
  generatedAt: IsoTimestamp
): readonly ProjectRollupAgingWorkEntry[] {
  const statusSet = new Set<WorkStatus>(statuses);
  return workItems
    .filter((work) => statusSet.has(work.status))
    .map((work) => {
      const ageMs = ageSince(work.meta.updatedAt, generatedAt);
      return {
        workId: work.meta.id,
        title: work.title,
        status: work.status as ProjectRollupAgingWorkEntry["status"],
        since: work.meta.updatedAt,
        ageMs,
        ageDays: ageDays(ageMs)
      };
    })
    .sort(compareAgingWorkEntries);
}

function agingExpiredReservations(
  reservations: readonly AgentReservation[],
  generatedAt: IsoTimestamp
): readonly ProjectRollupAgingReservationEntry[] {
  return reservations
    .filter((reservation) => reservationIsExpired(reservation, generatedAt))
    .map((reservation) => {
      const since = expiredReservationSince(reservation, generatedAt);
      const ageMs = ageSince(since, generatedAt);
      return {
        reservationId: reservation.meta.id,
        workId: reservation.workId,
        agentId: String(reservation.agentId),
        status: reservation.status === "released" ? "expired" : reservation.status,
        reservedAt: reservation.reservedAt,
        ...(reservation.expiresAt ? { expiresAt: reservation.expiresAt } : {}),
        since,
        ageMs,
        ageDays: ageDays(ageMs)
      };
    })
    .sort(compareAgingReservationEntries);
}

function expiredReservationSince(reservation: AgentReservation, generatedAt: IsoTimestamp): IsoTimestamp {
  if (reservation.expiresAt !== undefined && Date.parse(reservation.expiresAt) <= Date.parse(generatedAt)) {
    return reservation.expiresAt;
  }
  return reservation.meta.updatedAt;
}

function agingBucket<TEntry extends { readonly ageMs: number }>(
  items: readonly TEntry[]
): ProjectRollupAgingBucket<TEntry> {
  const oldest = oldestAgeMs(items);
  return {
    count: items.length,
    oldestAgeMs: oldest,
    oldestAgeDays: ageDays(oldest),
    items: items.slice(0, PROJECT_ROLLUP_AGING_ITEM_LIMIT)
  };
}

function oldestAgeMs(items: readonly { readonly ageMs: number }[]): number {
  return items[0]?.ageMs ?? 0;
}

function ageSince(since: IsoTimestamp, generatedAt: IsoTimestamp): number {
  return Math.max(0, Date.parse(generatedAt) - Date.parse(since));
}

function ageDays(ageMs: number): number {
  return Math.floor(ageMs / DAY_MS);
}

function compareAgingWorkEntries(left: ProjectRollupAgingWorkEntry, right: ProjectRollupAgingWorkEntry): number {
  return right.ageMs - left.ageMs || left.workId.localeCompare(right.workId);
}

function compareAgingReservationEntries(
  left: ProjectRollupAgingReservationEntry,
  right: ProjectRollupAgingReservationEntry
): number {
  return right.ageMs - left.ageMs || left.reservationId.localeCompare(right.reservationId);
}

function projectRollupLimbo(
  workItems: readonly WorkItem[],
  status: "needs_verification" | "verified",
  generatedAt: IsoTimestamp
): readonly ProjectRollupLimboEntry[] {
  return workItems
    .filter((work) => work.status === status)
    .map((work) => {
      const ageMs = Math.max(0, Date.parse(generatedAt) - Date.parse(work.meta.updatedAt));
      return {
        workId: work.meta.id,
        title: work.title,
        status,
        updatedAt: work.meta.updatedAt,
        ageMs,
        ageDays: ageDays(ageMs)
      };
    })
    .sort((left, right) => right.ageMs - left.ageMs || left.workId.localeCompare(right.workId))
    .slice(0, PROJECT_ROLLUP_LIMBO_LIMIT);
}

function projectRollupBlockingGaps(workItems: readonly WorkItem[]) {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const blocked = workItems
    .filter((work) => !TERMINAL_WORK_STATUSES.has(work.status))
    .map((work) => {
      const blockerIds = work.dependencyIds.filter((dependencyId) => {
        const dependency = workById.get(dependencyId);
        return dependency ? !TERMINAL_WORK_STATUSES.has(dependency.status) : true;
      });
      return { work, blockerIds };
    })
    .filter((entry) => entry.blockerIds.length > 0);
  return {
    openCount: blocked.reduce((total, entry) => total + entry.blockerIds.length, 0),
    blockedWorkCount: blocked.length,
    samples: blocked
      .sort((left, right) => left.work.meta.updatedAt.localeCompare(right.work.meta.updatedAt) || left.work.meta.id.localeCompare(right.work.meta.id))
      .slice(0, PROJECT_ROLLUP_BLOCKING_GAP_SAMPLE_LIMIT)
      .map((entry) => ({
        workId: entry.work.meta.id,
        title: entry.work.title,
        blockerIds: [...entry.blockerIds].sort()
      }))
  };
}

function projectRollupHealth(options: ProjectRollupWriteOptions): ProjectRollupHealthFlags {
  return {
    doctorOk: options.doctorOk ?? null,
    syncOk: options.syncOk ?? null
  };
}

function projectRollupLastEvent(events: readonly RuntimeEvent[]): ProjectRollupDocument["lastEvent"] {
  const event = [...events].sort(
    (left, right) => right.meta.createdAt.localeCompare(left.meta.createdAt) || right.meta.id.localeCompare(left.meta.id)
  )[0];
  return event
    ? {
        id: event.meta.id,
        type: event.type,
        subjectId: event.subjectId,
        at: event.meta.createdAt
      }
    : null;
}

function projectRollupLastOperation(operations: readonly RuntimeOperation[]): ProjectRollupDocument["lastOperation"] {
  const operation = [...operations].sort(
    (left, right) => right.finishedAt.localeCompare(left.finishedAt) || right.meta.id.localeCompare(left.meta.id)
  )[0];
  return operation
    ? {
        id: operation.meta.id,
        commandPath: operation.commandPath,
        status: operation.status,
        finishedAt: operation.finishedAt
      }
    : null;
}

function projectRollupNextWork(workItems: readonly WorkItem[]): readonly ProjectRollupNextWork[] {
  return workItems
    .filter((work) => work.status === "ready")
    .sort(compareNextWork)
    .slice(0, PROJECT_ROLLUP_NEXT_LIMIT)
    .map((work) => ({
      workId: work.meta.id,
      title: work.title,
      kind: work.kind,
      priority: work.priority,
      status: work.status,
      updatedAt: work.meta.updatedAt
    }));
}

function projectRollupWorkIndex(workItems: readonly WorkItem[]): ProjectRollupWorkIndex {
  const work = workItems
    .slice()
    .sort((left, right) => left.meta.id.localeCompare(right.meta.id))
    .slice(0, PROJECT_ROLLUP_WORK_INDEX_LIMIT)
    .map((item) => ({
      workId: item.meta.id,
      title: item.title,
      kind: item.kind,
      priority: item.priority,
      status: item.status,
      updatedAt: item.meta.updatedAt
    }));
  return {
    limit: PROJECT_ROLLUP_WORK_INDEX_LIMIT,
    total: workItems.length,
    truncated: workItems.length > PROJECT_ROLLUP_WORK_INDEX_LIMIT,
    work
  };
}

function compareNextWork(left: WorkItem, right: WorkItem): number {
  return (
    PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority] ||
    left.meta.updatedAt.localeCompare(right.meta.updatedAt) ||
    left.meta.id.localeCompare(right.meta.id)
  );
}

function readRollupWorkCount(value: Record<string, unknown>): number | undefined {
  const counts = value.counts;
  if (!isRecord(counts) || !isRecord(counts.work)) {
    return undefined;
  }
  return typeof counts.work.total === "number" ? counts.work.total : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
