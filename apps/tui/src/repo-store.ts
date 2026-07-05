// Direct-store repo reads used by the Roll-Up / Sprint Board / Task Detail
// route loaders (see docs/superpowers/plans/2026-07-05-tui-shell-v1.md for
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

import { resolveWorkspacePaths, type AgentReservation, type GraphEdge, type WorkItem } from "@boreal/core";
import { FileBorealStore, ObjectDirBorealStore, type BorealStore } from "@boreal/storage";
import type { WorkReservationView } from "@boreal/ui-model";

export type RepoStorageKind = "file-v2" | "objects-v1";

export interface RepoWorkGraph {
  readonly initialized: boolean;
  readonly items: readonly WorkItem[];
  readonly graphEdges: readonly GraphEdge[];
  readonly reservations: readonly AgentReservation[];
}

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
