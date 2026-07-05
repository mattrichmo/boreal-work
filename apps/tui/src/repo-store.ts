// Direct-store repo reads used by the Roll-Up / Sprint Board / Task Detail
// route loaders (see docs/superpowers/plans/2026-07-05-tui-shell-v1.md for
// why: no CLI command currently emits a rollup-shaped envelope with graph
// edges, so these routes read the object store directly the same way the
// legacy `loadTuiData` in load.ts already does -- this is the one documented
// direct-store read path besides the event-log head poll).

import { existsSync } from "node:fs";

import { resolveWorkspacePaths, type AgentReservation, type GraphEdge, type WorkItem } from "@boreal/core";
import { FileBorealStore } from "@boreal/storage";
import type { WorkReservationView } from "@boreal/ui-model";

export interface RepoWorkGraph {
  readonly initialized: boolean;
  readonly items: readonly WorkItem[];
  readonly graphEdges: readonly GraphEdge[];
  readonly reservations: readonly AgentReservation[];
}

export function isWorkspaceInitialized(workspaceRoot: string): boolean {
  const paths = resolveWorkspacePaths(workspaceRoot);
  return existsSync(paths.borealDir) && existsSync(paths.stateFile);
}

export async function readRepoWorkGraph(workspaceRoot: string): Promise<RepoWorkGraph> {
  if (!isWorkspaceInitialized(workspaceRoot)) {
    return { initialized: false, items: [], graphEdges: [], reservations: [] };
  }
  const store = new FileBorealStore({ rootDir: workspaceRoot });
  const [items, graphEdges, reservations] = await Promise.all([
    store.read((reader) => reader.listWorkItems()),
    store.read((reader) => reader.listGraphEdges()),
    store.read((reader) => reader.listReservations())
  ]);
  return { initialized: true, items, graphEdges, reservations };
}

/** Active reservations keyed by work id, in the shape the roll-up builder
 * and sprint board builder both expect. */
export function activeReservationViewsByWorkId(reservations: readonly AgentReservation[]): Map<string, WorkReservationView> {
  const map = new Map<string, WorkReservationView>();
  for (const reservation of reservations) {
    if (reservation.status !== "active") continue;
    map.set(reservation.workId, {
      id: reservation.meta.id,
      agentId: String(reservation.agentId),
      reservedAt: reservation.reservedAt,
      expiresAt: reservation.expiresAt,
      expired: false
    });
  }
  return map;
}
