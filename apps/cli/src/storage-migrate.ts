import { existsSync } from "node:fs";
import { rename, rm } from "node:fs/promises";

import { BorealError, nowIso, resolveWorkspacePaths, type RuntimeEvent, type RuntimeOperation } from "@boreal/core";
import {
  FileBorealStore,
  FileEventLog,
  ObjectDirBorealStore,
  type BorealWriter,
  type StoreSnapshot
} from "@boreal/storage";

import type { CliContext } from "./context.js";
import { writeProjectStorageMarker, type ProjectStorageKind } from "./project-setup.js";

export const STORAGE_MIGRATION_SCHEMA_VERSION = "boreal.storage-migration.v1";

export interface StorageRecordCounts {
  readonly workItems: number;
  readonly agentSummaries: number;
  readonly evidence: number;
  readonly verifications: number;
  readonly directiveAcknowledgements: number;
  readonly knowledgeSources: number;
  readonly claims: number;
  readonly decisions: number;
  readonly graphEdges: number;
  readonly reservations: number;
  readonly reviewerHeartbeats: number;
  readonly events: number;
  readonly operations: number;
}

export interface StorageMigrationResult {
  readonly schemaVersion: typeof STORAGE_MIGRATION_SCHEMA_VERSION;
  readonly migrated: boolean;
  readonly from: ProjectStorageKind;
  readonly to: ProjectStorageKind;
  readonly workspaceRoot: string;
  readonly records: StorageRecordCounts;
  readonly eventLog: {
    readonly ok: boolean;
    readonly seq: number;
    readonly hash: string;
  };
  readonly markerPath: string;
  readonly stateBackupPath?: string;
}

export async function migrateStorage(context: CliContext, target: "objects" | "file"): Promise<StorageMigrationResult> {
  const to: ProjectStorageKind = target === "objects" ? "objects-v1" : "file-v2";
  const from = context.storage;
  const paths = resolveWorkspacePaths(context.workspaceRoot);
  const markerPath = paths.borealDir + "/project.json";

  if (from === to) {
    const snapshot = await snapshotForStorage(context.workspaceRoot, from);
    const head = await new FileEventLog({ path: paths.eventLogFile }).head();
    return {
      schemaVersion: STORAGE_MIGRATION_SCHEMA_VERSION,
      migrated: false,
      from,
      to,
      workspaceRoot: context.workspaceRoot,
      records: countSnapshot(snapshot),
      eventLog: { ok: true, ...head },
      markerPath
    };
  }

  return to === "objects-v1" ? migrateFileToObjects(context.workspaceRoot, from, to) : migrateObjectsToFile(context.workspaceRoot, from, to);
}

async function migrateFileToObjects(
  rootDir: string,
  from: ProjectStorageKind,
  to: ProjectStorageKind
): Promise<StorageMigrationResult> {
  const paths = resolveWorkspacePaths(rootDir);
  const source = new FileBorealStore({ rootDir });
  const snapshot = await source.snapshot();

  await rm(paths.objectsDir, { recursive: true, force: true });
  const target = new ObjectDirBorealStore({ rootDir });
  await target.write((writer) => writeSnapshot(writer, snapshot));
  await assertMigratedCounts(snapshot, await target.snapshot());
  const eventLog = await verifiedEventLog(paths.eventLogFile);

  const stateBackupPath = existsSync(paths.stateFile)
    ? `${paths.stateFile}.migrated-${nowIso().replace(/[:.]/gu, "-")}`
    : undefined;
  if (stateBackupPath) {
    await rename(paths.stateFile, stateBackupPath);
  }
  const marker = await writeProjectStorageMarker(rootDir, to);
  return {
    schemaVersion: STORAGE_MIGRATION_SCHEMA_VERSION,
    migrated: true,
    from,
    to,
    workspaceRoot: rootDir,
    records: countSnapshot(snapshot),
    eventLog,
    markerPath: marker.path,
    stateBackupPath
  };
}

async function migrateObjectsToFile(
  rootDir: string,
  from: ProjectStorageKind,
  to: ProjectStorageKind
): Promise<StorageMigrationResult> {
  const paths = resolveWorkspacePaths(rootDir);
  const source = new ObjectDirBorealStore({ rootDir });
  const snapshot = await source.snapshot();

  await rm(paths.stateFile, { force: true });
  const target = new FileBorealStore({ rootDir });
  await target.write((writer) => writeSnapshot(writer, snapshot));
  await assertMigratedCounts(snapshot, await target.snapshot());
  const eventLog = await verifiedEventLog(paths.eventLogFile);
  const marker = await writeProjectStorageMarker(rootDir, to);

  return {
    schemaVersion: STORAGE_MIGRATION_SCHEMA_VERSION,
    migrated: true,
    from,
    to,
    workspaceRoot: rootDir,
    records: countSnapshot(snapshot),
    eventLog,
    markerPath: marker.path
  };
}

async function snapshotForStorage(rootDir: string, storage: ProjectStorageKind): Promise<StoreSnapshot> {
  return storage === "objects-v1" ? new ObjectDirBorealStore({ rootDir }).snapshot() : new FileBorealStore({ rootDir }).snapshot();
}

async function writeSnapshot(writer: BorealWriter, snapshot: StoreSnapshot): Promise<void> {
  for (const record of snapshot.workItems ?? []) await writer.putWorkItem(record);
  for (const record of snapshot.agentSummaries ?? []) await writer.putAgentSummary(record);
  for (const record of snapshot.evidence ?? []) await writer.putEvidence(record);
  for (const record of snapshot.verifications ?? []) await writer.putVerification(record);
  for (const record of snapshot.directiveAcknowledgements ?? []) await writer.putDirectiveAcknowledgement(record);
  for (const record of snapshot.knowledgeSources ?? []) await writer.putKnowledgeSource(record);
  for (const record of snapshot.claims ?? []) await writer.putClaim(record);
  for (const record of snapshot.decisions ?? []) await writer.putDecision(record);
  for (const record of snapshot.graphEdges ?? []) await writer.putGraphEdge(record);
  for (const record of snapshot.reservations ?? []) await writer.putReservation(record);
  for (const record of snapshot.reviewerHeartbeats ?? []) await writer.putReviewerHeartbeat(record);
  for (const record of snapshot.events ?? []) await writer.putEvent(record as RuntimeEvent);
  for (const record of snapshot.operations ?? []) await writer.putOperation(record as RuntimeOperation);
}

async function assertMigratedCounts(expected: StoreSnapshot, actual: StoreSnapshot): Promise<void> {
  const expectedCounts = countSnapshot(expected);
  const actualCounts = countSnapshot(actual);
  if (JSON.stringify(expectedCounts) !== JSON.stringify(actualCounts)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Storage migration record count verification failed", {
      expected: expectedCounts,
      actual: actualCounts
    });
  }
}

async function verifiedEventLog(path: string): Promise<StorageMigrationResult["eventLog"]> {
  const log = new FileEventLog({ path });
  const verification = await log.verify();
  if (!verification.ok) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Storage migration produced a broken event log", {
      brokenAtSeq: verification.brokenAtSeq
    });
  }
  const head = await log.head();
  return { ok: true, ...head };
}

function countSnapshot(snapshot: StoreSnapshot): StorageRecordCounts {
  return {
    workItems: snapshot.workItems?.length ?? 0,
    agentSummaries: snapshot.agentSummaries?.length ?? 0,
    evidence: snapshot.evidence?.length ?? 0,
    verifications: snapshot.verifications?.length ?? 0,
    directiveAcknowledgements: snapshot.directiveAcknowledgements?.length ?? 0,
    knowledgeSources: snapshot.knowledgeSources?.length ?? 0,
    claims: snapshot.claims?.length ?? 0,
    decisions: snapshot.decisions?.length ?? 0,
    graphEdges: snapshot.graphEdges?.length ?? 0,
    reservations: snapshot.reservations?.length ?? 0,
    reviewerHeartbeats: snapshot.reviewerHeartbeats?.length ?? 0,
    events: snapshot.events?.length ?? 0,
    operations: snapshot.operations?.length ?? 0
  };
}
