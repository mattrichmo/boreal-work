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
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  deterministicId,
  resolveWorkspacePaths,
  type AgentReservation,
  type GraphEdge,
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
  const store: BorealStore =
    storageKind === "objects-v1" ? new ObjectDirBorealStore({ rootDir: workspaceRoot }) : new FileBorealStore({ rootDir: workspaceRoot });
  // Keep all related reads inside one store transaction. The file and object
  // stores lock per `read()` call, so separate calls can otherwise observe a
  // writer between the item, edge, and reservation reads.
  return store.read(async (reader) => {
    const [items, graphEdges, reservations, projections] = await Promise.all([
      reader.listWorkItems(),
      reader.listGraphEdges(),
      reader.listReservations(),
      reader.listProjections()
    ]);
    const activeProjection = selectActiveSprintProjection(projections);
    const activeSprintId = activeSprintIdFromProjection(activeProjection) ?? activeSprintIdFromEvents(await reader.listEvents());
    return { initialized: true, items, graphEdges, reservations, activeSprintId };
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
