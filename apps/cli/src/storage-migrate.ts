import { existsSync } from "node:fs";
import { copyFile, rm } from "node:fs/promises";

import { BorealError, hashContent, nowIso, resolveWorkspacePaths, withContentHash, type RuntimeEvent, type RuntimeOperation } from "@boreal/core";
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
  readonly runs: number;
  readonly checkpoints: number;
  readonly eventCursors: number;
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
  readonly preflight: {
    readonly sourceReadable: true;
    readonly sourceStorage: ProjectStorageKind;
    readonly targetStorage: ProjectStorageKind;
  };
  readonly parity: {
    readonly counts: true;
    readonly contentHash: true;
    readonly sourceContentHash: string;
    readonly targetContentHash: string;
  };
  readonly rollback: {
    readonly command: string;
    readonly sourceRetained: boolean;
    readonly backupPath?: string;
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
    const contentHash = snapshotContentHash(snapshot);
    return {
      schemaVersion: STORAGE_MIGRATION_SCHEMA_VERSION,
      migrated: false,
      from,
      to,
      workspaceRoot: context.workspaceRoot,
      records: countSnapshot(snapshot),
      eventLog: { ok: true, ...head },
      preflight: { sourceReadable: true, sourceStorage: from, targetStorage: to },
      parity: { counts: true, contentHash: true, sourceContentHash: contentHash, targetContentHash: contentHash },
      rollback: { command: `bwrk storage migrate --to ${to === "objects-v1" ? "file" : "objects"} --json`, sourceRetained: true },
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
  const parity = assertMigratedParity(snapshot, await target.snapshot());
  const eventLog = await verifiedEventLog(paths.eventLogFile);

  const stateBackupPath = existsSync(paths.stateFile)
    ? `${paths.stateFile}.migrated-${nowIso().replace(/[:.]/gu, "-")}`
    : undefined;
  if (stateBackupPath) {
    await copyFile(paths.stateFile, stateBackupPath);
  }
  const marker = await writeProjectStorageMarker(rootDir, to);
  if (stateBackupPath) {
    await rm(paths.stateFile, { force: true });
  }
  return {
    schemaVersion: STORAGE_MIGRATION_SCHEMA_VERSION,
    migrated: true,
    from,
    to,
    workspaceRoot: rootDir,
    records: countSnapshot(snapshot),
    eventLog,
    preflight: { sourceReadable: true, sourceStorage: from, targetStorage: to },
    parity,
    rollback: {
      command: "bwrk storage migrate --to file --json",
      sourceRetained: false,
      ...(stateBackupPath ? { backupPath: stateBackupPath } : {})
    },
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
  const parity = assertMigratedParity(snapshot, await target.snapshot());
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
    preflight: { sourceReadable: true, sourceStorage: from, targetStorage: to },
    parity,
    rollback: { command: "bwrk storage migrate --to objects --json", sourceRetained: true },
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
  for (const record of snapshot.runs ?? []) await writer.putRun(record);
  for (const record of snapshot.checkpoints ?? []) await writer.putCheckpoint(record);
  for (const record of snapshot.eventCursors ?? []) await writer.putEventCursor(record);
  for (const record of snapshot.events ?? []) await writer.putEvent(record as RuntimeEvent);
  for (const record of snapshot.operations ?? []) await writer.putOperation(record as RuntimeOperation);
}

function assertMigratedParity(expected: StoreSnapshot, actual: StoreSnapshot): StorageMigrationResult["parity"] {
  const expectedCounts = countSnapshot(expected);
  const actualCounts = countSnapshot(actual);
  if (JSON.stringify(expectedCounts) !== JSON.stringify(actualCounts)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Storage migration record count verification failed", {
      expected: expectedCounts,
      actual: actualCounts
    });
  }
  const sourceContentHash = snapshotContentHash(expected);
  const targetContentHash = snapshotContentHash(actual);
  if (sourceContentHash !== targetContentHash) {
    const sourceSections = migrationSectionHashes(expected);
    const targetSections = migrationSectionHashes(actual);
    throw new BorealError("BOREAL_STORAGE_ERROR", "Storage migration content parity verification failed", {
      sourceContentHash,
      targetContentHash,
      differingSections: Object.keys(sourceSections).filter((section) => sourceSections[section] !== targetSections[section]),
      sourceSections,
      targetSections
    });
  }
  return { counts: true, contentHash: true, sourceContentHash, targetContentHash };
}

function snapshotContentHash(snapshot: StoreSnapshot): string {
  return hashContent(portableMigrationSnapshot(snapshot));
}

function portableMigrationSnapshot(snapshot: StoreSnapshot) {
  return {
    workItems: stableRecords(snapshot.workItems),
    agentSummaries: stableRecords(snapshot.agentSummaries),
    evidence: stableRecords(snapshot.evidence),
    verifications: stableRecords(snapshot.verifications),
    directiveAcknowledgements: stableRecords(snapshot.directiveAcknowledgements),
    knowledgeSources: stableRecords(snapshot.knowledgeSources),
    claims: stableRecords(snapshot.claims),
    decisions: stableRecords(snapshot.decisions),
    graphEdges: stableRecords(snapshot.graphEdges),
    reservations: stableRecords(snapshot.reservations),
    reviewerHeartbeats: stableRecords(snapshot.reviewerHeartbeats),
    runs: stableRecords(snapshot.runs),
    checkpoints: stableRecords(snapshot.checkpoints),
    eventCursors: stableRecords(snapshot.eventCursors),
    events: (snapshot.events ?? []).map(portableMigrationEvent)
  };
}

function stableRecords<T extends { readonly meta: { readonly id: string } }>(records: readonly T[] | undefined): readonly T[] {
  return [...(records ?? [])].sort((left, right) => left.meta.id.localeCompare(right.meta.id));
}

function migrationSectionHashes(snapshot: StoreSnapshot): Record<string, string> {
  return Object.fromEntries(
    Object.entries(portableMigrationSnapshot(snapshot)).map(([section, records]) => [section, hashContent(records)])
  );
}

function portableMigrationEvent(value: RuntimeEvent): RuntimeEvent {
  if (value.operationId === undefined && value.operationLink === undefined) return value;
  const { operationId: _operationId, operationLink: _operationLink, ...event } = value;
  return withContentHash(event as RuntimeEvent);
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
    runs: snapshot.runs?.length ?? 0,
    checkpoints: snapshot.checkpoints?.length ?? 0,
    eventCursors: snapshot.eventCursors?.length ?? 0,
    events: snapshot.events?.length ?? 0,
    operations: snapshot.operations?.length ?? 0
  };
}
