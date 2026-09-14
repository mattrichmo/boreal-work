// Direct-store repo reads used by the Roll-Up / Sprint Board / Task Detail
// route loaders (see docs/architecture/TUI_SURFACE_CONTRACTS.md for
// why: no CLI command currently emits a rollup-shaped envelope with graph
// edges, so these routes read the object store directly -- this is the one
// documented direct-store read path besides the event-log head poll).
//
// A workspace's storage backend (`file-v2` vs the now-default `objects-v1`)
// is a per-project choice recorded in `.boreal/project.json` (see
// `apps/cli/src/project-setup.ts#readProjectStorage` /
// `apps/cli/src/context.ts#selectStorageKind`). apps/tui intentionally does
// not depend on apps/cli, so this module re-reads the same marker file
// directly rather than hardcoding one store implementation -- the legacy
// `load.ts` hardcoded `FileBorealStore`, which silently returns an empty
// workspace against the CLI's own default `objects-v1` storage.

import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  deterministicId,
  resolveWorkspacePaths,
  type AgentReservation,
  type AgentSummaryRecord,
  type EvidenceRecord,
  type GraphEdge,
  type VerificationRecord,
  type ProjectionId,
  type ProjectionRecord,
  type RuntimeEvent,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import { FileBorealStore, ObjectDirBorealStore, type BorealStore } from "@boreal/storage";
import type { WorkReservationView } from "@boreal/ui-model";

export type RepoStorageKind = "file-v2" | "objects-v1";

export interface RepoWorkGraph {
  readonly initialized: boolean;
  readonly items: readonly WorkItem[];
  readonly graphEdges: readonly GraphEdge[];
  readonly reservations: readonly AgentReservation[];
  /** The active sprint resolved from the same store snapshot as the graph. */
  readonly activeSprintId?: WorkId;
  /** True when a writer prevented a fresh read and this is the last snapshot. */
  readonly stale?: boolean;
  readonly warning?: string;
}

/** Closeout records are fetched only when the task-detail route is opened.
 * Keeping this separate from `readRepoWorkGraph` prevents roll-up refreshes
 * from loading every summary and evidence record in a workspace. */
export interface RepoTaskCloseoutRecords {
  readonly summaries: readonly AgentSummaryRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly verifications: readonly VerificationRecord[];
}

const TUI_READ_LOCK_OPTIONS = {
  // A visualizer should yield quickly to a writer and retry rather than hold
  // the screen hostage for the storage layer's ten-second command timeout.
  waitTimeoutMs: 750,
  staleAfterMs: 60_000,
  retryDelayMs: 25
} as const;
const OBJECT_STORE_REVISION_FILE = "objects-revision.json";

const repoStoreCache = new Map<string, { readonly kind: RepoStorageKind; readonly store: BorealStore }>();
const repoGraphCache = new Map<string, {
  readonly kind: RepoStorageKind;
  readonly signature: string;
  readonly graph?: RepoWorkGraph;
  readonly pending?: Promise<RepoWorkGraph>;
}>();

function repoCacheKey(workspaceRoot: string, kind: RepoStorageKind): string {
  return `${kind}\u0000${workspaceRoot}`;
}

function repoStoreFor(workspaceRoot: string, kind: RepoStorageKind): BorealStore {
  const key = repoCacheKey(workspaceRoot, kind);
  const existing = repoStoreCache.get(key);
  if (existing) return existing.store;
  const store: BorealStore = kind === "objects-v1"
    ? new ObjectDirBorealStore({ rootDir: workspaceRoot, lock: TUI_READ_LOCK_OPTIONS })
    : new FileBorealStore({ rootDir: workspaceRoot, lock: TUI_READ_LOCK_OPTIONS });
  repoStoreCache.set(key, { kind, store });
  return store;
}

async function storageSignature(workspaceRoot: string, kind: RepoStorageKind): Promise<string> {
  const paths = resolveWorkspacePaths(workspaceRoot);
  const trackedPaths = kind === "objects-v1"
    ? [paths.eventLogFile, paths.objectsDir, join(paths.runtimeDir, OBJECT_STORE_REVISION_FILE)]
    : [paths.stateFile, paths.eventLogFile];
  const rows = await Promise.all(trackedPaths.map(async (path) => {
    const details = await stat(path).catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") return undefined;
      throw error;
    });
    return details
      ? `${path}:${details.dev}:${details.ino}:${details.size}:${details.mtimeMs}:${details.ctimeMs}`
      : `${path}:missing`;
  }));
  return rows.join("|");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isWriterConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = "code" in error ? (error as { readonly code?: unknown }).code : undefined;
  const message = error instanceof Error ? error.message : String(error);
  return code === "BOREAL_CONFLICT" || message.includes("locked by another writer");
}

export function invalidateRepoReadCache(workspaceRoot?: string): void {
  for (const key of repoGraphCache.keys()) {
    if (!workspaceRoot || key.endsWith(`\u0000${workspaceRoot}`)) repoGraphCache.delete(key);
  }
}

const ACTIVE_SPRINT_PROJECTION_KIND = "active-sprint";
const ACTIVE_SPRINT_PROJECTION_ID = deterministicId<ProjectionId>("projection", {
  kind: ACTIVE_SPRINT_PROJECTION_KIND,
  subjectId: "workspace"
});

async function readProjectStorageMarker(workspaceRoot: string): Promise<RepoStorageKind | undefined> {
  const configPath = join(workspaceRoot, ".boreal", "project.json");
  if (!existsSync(configPath)) return undefined;
  try {
    const parsed = JSON.parse(await readFile(configPath, "utf8")) as { readonly storage?: unknown };
    return parsed.storage === "file-v2" || parsed.storage === "objects-v1" ? parsed.storage : undefined;
  } catch {
    return undefined;
  }
}

/** Mirrors `assertInitialized`'s two detection paths (apps/cli/src/context.ts):
 * objects-v1 workspaces are "initialized" once the event log or objects dir
 * exists; file-v2 workspaces require the legacy state.json. */
export async function resolveRepoStorageKind(workspaceRoot: string): Promise<RepoStorageKind | undefined> {
  const marker = await readProjectStorageMarker(workspaceRoot);
  if (marker) return marker;
  const paths = resolveWorkspacePaths(workspaceRoot);
  if (!existsSync(paths.borealDir)) return undefined;
  if (existsSync(paths.eventLogFile) || existsSync(paths.objectsDir)) return "objects-v1";
  if (existsSync(paths.stateFile)) return "file-v2";
  return undefined;
}

export async function isWorkspaceInitialized(workspaceRoot: string): Promise<boolean> {
  return (await resolveRepoStorageKind(workspaceRoot)) !== undefined;
}

export async function readRepoWorkGraph(workspaceRoot: string): Promise<RepoWorkGraph> {
  const storageKind = await resolveRepoStorageKind(workspaceRoot);
  if (!storageKind) {
    return { initialized: false, items: [], graphEdges: [], reservations: [] };
  }
  const key = repoCacheKey(workspaceRoot, storageKind);
  const signature = await storageSignature(workspaceRoot, storageKind);
  const cached = repoGraphCache.get(key);
  if (cached?.graph && cached.signature === signature) return cached.graph;
  if (cached?.pending) return cached.pending;

  const store = repoStoreFor(workspaceRoot, storageKind);
  const previousGraph = cached?.graph;
  let pending: Promise<RepoWorkGraph> | undefined;
  pending = (async () => {
    try {
      const graph = store instanceof ObjectDirBorealStore
        ? await store.readGraphSnapshot()
        : await store.read(async (reader) => {
            const [items, graphEdges, reservations, projections] = await Promise.all([
              reader.listWorkItems(),
              reader.listGraphEdges(),
              reader.listReservations(),
              reader.listProjections()
            ]);
            const activeProjection = selectActiveSprintProjection(projections);
            const activeSprintId = activeSprintIdFromProjection(activeProjection) ?? activeSprintIdFromEvents(await reader.listEvents());
            return { items, graphEdges, reservations, activeSprintId };
          });
      const result: RepoWorkGraph = {
        initialized: true,
        items: "workItems" in graph ? graph.workItems : graph.items,
        graphEdges: graph.graphEdges,
        reservations: graph.reservations,
        ...(graph.activeSprintId ? { activeSprintId: graph.activeSprintId } : {})
      };
      repoGraphCache.set(key, { kind: storageKind, signature: await storageSignature(workspaceRoot, storageKind), graph: result });
      return result;
    } catch (error) {
      if (previousGraph && isWriterConflict(error)) {
        const stale: RepoWorkGraph = {
          ...previousGraph,
          stale: true,
          warning: "Boreal is being updated; showing the last successful snapshot while retrying."
        };
        repoGraphCache.set(key, { kind: storageKind, signature: cached?.signature ?? signature, graph: stale });
        return stale;
      }
      throw error;
    } finally {
      const current = repoGraphCache.get(key);
      if (current && current.pending === pending) {
        repoGraphCache.set(key, {
          kind: current.kind,
          signature: current.signature,
          ...(current.graph ? { graph: current.graph } : {})
        });
      }
    }
  })();
  repoGraphCache.set(key, { kind: storageKind, signature, graph: previousGraph, pending });
  return pending as Promise<RepoWorkGraph>;
}

export async function readRepoTaskCloseoutRecords(
  workspaceRoot: string,
  workId: string
): Promise<RepoTaskCloseoutRecords> {
  const storageKind = await resolveRepoStorageKind(workspaceRoot);
  if (!storageKind) return { summaries: [], evidence: [], verifications: [] };
  const store = repoStoreFor(workspaceRoot, storageKind);
  if (store instanceof ObjectDirBorealStore) {
    return store.readTaskCloseout(workId);
  }
  return store.read(async (reader) => {
    const [summaries, evidence, verifications] = await Promise.all([
      reader.listAgentSummariesForSubject(workId),
      reader.listEvidenceForSubject(workId),
      reader.listVerificationsForSubject(workId)
    ]);
    return { summaries, evidence, verifications };
  });
}

/** Active reservations keyed by work id, in the shape the roll-up builder
 * and sprint board builder both expect. */
export function activeReservationViewsByWorkId(
  reservations: readonly AgentReservation[],
  now: Date | string | number = new Date(),
  preferredReservationIds?: ReadonlyMap<string, string>
): Map<string, WorkReservationView> {
  const activeByWorkId = new Map<string, AgentReservation[]>();
  for (const reservation of reservations) {
    if (reservation.status !== "active") continue;
    const rows = activeByWorkId.get(reservation.workId) ?? [];
    rows.push(reservation);
    activeByWorkId.set(reservation.workId, rows);
  }
  const map = new Map<string, WorkReservationView>();
  for (const [workId, rows] of activeByWorkId) {
    const preferredId = preferredReservationIds?.get(workId);
    const candidate = rows.find((reservation) => reservation.meta.id === preferredId) ??
      rows.reduce<AgentReservation | undefined>((best, reservation) => {
        if (!best) return reservation;
        const candidateView = reservationViewFrom(reservation, now);
        const bestView = reservationViewFrom(best, now);
        return reservationViewIsPreferred(candidateView, bestView) ? reservation : best;
      }, undefined);
    if (candidate) map.set(workId, reservationViewFrom(candidate, now));
  }
  return map;
}

/** Convert the persisted reservation record to the one canonical TUI shape. */
export function reservationViewFrom(
  reservation: AgentReservation,
  now: Date | string | number = new Date()
): WorkReservationView {
  return {
    id: reservation.meta.id,
    agentId: String(reservation.agentId),
    reservedAt: reservation.reservedAt,
    expiresAt: reservation.expiresAt,
    expired: reservationExpiredAt(reservation.expiresAt, now)
  };
}

export function reservationExpiredAt(expiresAt: string | undefined, now: Date | string | number = new Date()): boolean {
  if (!expiresAt) return false;
  const expiryMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiryMs)) return false;
  const nowMs = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  return Number.isFinite(nowMs) && expiryMs <= nowMs;
}

function reservationViewIsPreferred(candidate: WorkReservationView, existing: WorkReservationView): boolean {
  if (candidate.expired !== existing.expired) return candidate.expired !== true;
  const reservedAt = String(candidate.reservedAt ?? "").localeCompare(String(existing.reservedAt ?? ""));
  return reservedAt !== 0 ? reservedAt > 0 : candidate.id.localeCompare(existing.id) > 0;
}

function selectActiveSprintProjection(
  projections: readonly ProjectionRecord[]
): ProjectionRecord | undefined {
  const deterministic = projections.find(
    (projection) => projection.meta.id === ACTIVE_SPRINT_PROJECTION_ID && projection.kind === ACTIVE_SPRINT_PROJECTION_KIND && projection.subjectId === "workspace"
  );
  if (deterministic) return deterministic;
  return projections
    .filter((projection) => projection.kind === ACTIVE_SPRINT_PROJECTION_KIND && projection.subjectId === "workspace")
    .sort((left, right) => right.meta.updatedAt.localeCompare(left.meta.updatedAt))[0];
}

function activeSprintIdFromProjection(
  projection: { readonly value: Record<string, unknown> } | undefined
): WorkId | undefined {
  const value = projection?.value.sprintId;
  return typeof value === "string" && value.startsWith("bw_work_") ? value as WorkId : undefined;
}

function activeSprintIdFromEvents(events: readonly RuntimeEvent[]): WorkId | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event?.type !== "sprint.activated" || event.subjectType !== "sprint") continue;
    const sprintId = typeof event.payload.sprintId === "string" ? event.payload.sprintId : event.subjectId;
    if (sprintId.startsWith("bw_work_")) return sprintId as WorkId;
  }
  return undefined;
}
