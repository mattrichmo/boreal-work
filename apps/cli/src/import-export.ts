import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  BorealError,
  assertPathInside,
  assertRealPathInside,
  canonicalJson,
  hashContent,
  nowIso,
  parseJsonlStrict,
  readJsonFile,
  runtimeSnapshotSchemaIssues,
  touchRecord,
  withContentHash,
  type AgentReservation,
  type ClaimId,
  type ClaimRecord,
  type ContextPack,
  type DecisionId,
  type DecisionRecord,
  type EvidenceId,
  type EvidenceRecord,
  type GraphEdge,
  type GraphEdgeId,
  type KnowledgeSource,
  type KnowledgeSourceId,
  type ProjectionId,
  type ProjectionRecord,
  type ReservationId,
  type RuntimeEvent,
  type VerificationId,
  type VerificationRecord,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import {
  writeTextFileAtomic,
  type BorealReader,
  type BorealStore,
  type BorealWriter,
  type StoreSnapshot
} from "@boreal/storage";
import { deriveReadinessStatus } from "@boreal/work-engine";

import type { CliContext } from "./context.js";

export interface ExportDocument {
  readonly schemaVersion: "boreal.export.v1";
  readonly exportedAt: string;
  readonly workspaceRoot: string;
  readonly contentHash: string;
  readonly recordCounts: Record<SnapshotSection, number>;
  readonly state: ExportSnapshot;
}

export interface ExportWriteResult {
  readonly path: string;
  readonly contentHash: string;
  readonly recordCounts: Record<SnapshotSection, number>;
}

export interface MarkdownExportResult {
  readonly outDir: string;
  readonly files: readonly string[];
  readonly recordCounts: Record<SnapshotSection, number>;
}

export interface LedgerManifestFile {
  readonly section: SnapshotSection;
  readonly path: string;
  readonly count: number;
  readonly contentHash: string;
}

export interface LedgerDeletionManifestFile {
  readonly path: string;
  readonly count: number;
  readonly contentHash: string;
}

export interface LedgerDeletionRecord {
  readonly schemaVersion: "boreal.ledger-deletion.v1";
  readonly section: SnapshotSection;
  readonly id: string;
  readonly deletedAt: string;
  readonly reason?: string;
  readonly deletedContentHash?: string;
}

export interface LedgerManifest {
  readonly schemaVersion: "boreal.ledgers.v1";
  readonly exportedAt: string;
  readonly workspaceRoot: string;
  readonly contentHash: string;
  readonly recordCounts: Record<SnapshotSection, number>;
  readonly deletedRecordCounts: Record<SnapshotSection, number>;
  readonly files: Record<SnapshotSection, LedgerManifestFile>;
  readonly deletions: LedgerDeletionManifestFile;
}

export interface LedgerExportResult {
  readonly outDir: string;
  readonly manifestPath: string;
  readonly contentHash: string;
  readonly recordCounts: Record<SnapshotSection, number>;
  readonly deletedRecordCounts: Record<SnapshotSection, number>;
  readonly files: readonly LedgerManifestFile[];
  readonly deletions: LedgerDeletionManifestFile;
}

export interface LedgerStatusResult {
  readonly ok: boolean;
  readonly path: string;
  readonly exists: boolean;
  readonly stale: boolean;
  readonly expectedContentHash: string;
  readonly reconstructable: boolean;
  readonly contentHash?: string;
  readonly recordCounts?: Record<SnapshotSection, number>;
  readonly deletedRecordCounts?: Record<SnapshotSection, number>;
  readonly files?: readonly LedgerManifestFile[];
  readonly deletions?: LedgerDeletionManifestFile;
  readonly error?: string;
}

export interface LedgerDeleteRecordResult {
  readonly deleted: true;
  readonly section: SnapshotSection;
  readonly id: string;
  readonly tombstone: LedgerDeletionRecord;
  readonly ledger: LedgerExportResult;
}

export interface ImportResult {
  readonly imported: Record<SnapshotSection, number>;
  readonly skipped: Record<SnapshotSection, number>;
}

export interface ImportJsonOptions {
  readonly allowExternalRead?: boolean;
}

export interface SnapshotCreateResult {
  readonly id: string;
  readonly path: string;
  readonly contentHash: string;
  readonly recordCounts: Record<SnapshotSection, number>;
}

export interface SnapshotListEntry {
  readonly id: string;
  readonly path: string;
  readonly createdAt?: string;
  readonly contentHash?: string;
  readonly sizeBytes: number;
}

export type SnapshotSection =
  | "workItems"
  | "evidence"
  | "verifications"
  | "knowledgeSources"
  | "claims"
  | "decisions"
  | "graphEdges"
  | "reservations"
  | "events"
  | "projections"
  | "contextPacks";

type ExportSnapshot = Required<Pick<StoreSnapshot, SnapshotSection>>;

const SNAPSHOT_SECTIONS: readonly SnapshotSection[] = [
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
];

const LEDGER_SCHEMA_VERSION = "boreal.ledgers.v1";
const LEDGER_MANIFEST_FILE = "manifest.json";
const LEDGER_DELETIONS_FILE = "deletions.jsonl";
const LEDGER_FILES: Record<SnapshotSection, string> = {
  workItems: "work-items.jsonl",
  evidence: "evidence.jsonl",
  verifications: "verifications.jsonl",
  knowledgeSources: "knowledge-sources.jsonl",
  claims: "claims.jsonl",
  decisions: "decisions.jsonl",
  graphEdges: "graph-edges.jsonl",
  reservations: "reservations.jsonl",
  events: "events.jsonl",
  projections: "projections.jsonl",
  contextPacks: "context-packs.jsonl"
};

export async function buildExportDocument(context: CliContext): Promise<ExportDocument> {
  const state = await context.store.read((reader) => readSnapshot(reader));
  const contentHash = hashContent(state);
  return {
    schemaVersion: "boreal.export.v1",
    exportedAt: nowIso(),
    workspaceRoot: context.workspaceRoot,
    contentHash,
    recordCounts: recordCounts(state),
    state
  };
}

export async function exportJson(context: CliContext, outPath: string | undefined): Promise<ExportDocument | ExportWriteResult> {
  const document = await buildExportDocument(context);
  if (!outPath) {
    return document;
  }

  const resolvedPath = await resolveWorkspacePath(context, outPath);
  await writeTextFileAtomic(resolvedPath, `${JSON.stringify(document, null, 2)}\n`);
  return {
    path: resolvedPath,
    contentHash: document.contentHash,
    recordCounts: document.recordCounts
  };
}

export async function exportMarkdown(context: CliContext, outDir: string | undefined): Promise<MarkdownExportResult> {
  const document = await buildExportDocument(context);
  const resolvedDir = await resolveWorkspacePath(context, outDir ?? ".boreal/exports/markdown");
  await mkdir(resolvedDir, { recursive: true });

  const files: string[] = [];
  for (const file of markdownFiles(document)) {
    const path = join(resolvedDir, file.path);
    await mkdir(dirname(path), { recursive: true });
    await writeTextFileAtomic(path, file.content);
    files.push(path);
  }

  return {
    outDir: resolvedDir,
    files,
    recordCounts: document.recordCounts
  };
}

export async function exportLedgers(context: CliContext, outDir: string | undefined): Promise<LedgerExportResult> {
  return exportLedgersWithAdditionalDeletions(context, outDir, []);
}

async function exportLedgersWithAdditionalDeletions(
  context: CliContext,
  outDir: string | undefined,
  additionalDeletions: readonly LedgerDeletionRecord[]
): Promise<LedgerExportResult> {
  const document = await buildExportDocument(context);
  const resolvedDir = await resolveWorkspacePath(context, outDir ?? ".boreal/ledgers");
  const existingDeletions = await readExistingLedgerDeletions(resolvedDir);
  const ledgerDeletions = canonicalLedgerDeletions([...existingDeletions, ...additionalDeletions]);
  assertUniqueDeletions(ledgerDeletions);
  await mkdir(resolvedDir, { recursive: true });

  const ledgerState = canonicalLedgerSnapshot(document.state);
  assertNoDeletedLiveRecords(ledgerState, ledgerDeletions);
  const files = Object.fromEntries(
    await Promise.all(
      SNAPSHOT_SECTIONS.map(async (section) => {
        const records = ledgerState[section] as readonly unknown[];
        const file = ledgerManifestFile(section, records);
        const path = join(resolvedDir, file.path);
        const content = records.map((record) => canonicalJson(record)).join("\n");
        await writeTextFileAtomic(path, content.length > 0 ? `${content}\n` : "");
        return [section, file];
      })
    )
  ) as Record<SnapshotSection, LedgerManifestFile>;
  const deletions = ledgerDeletionManifestFile(ledgerDeletions);
  await writeTextFileAtomic(join(resolvedDir, deletions.path), ledgerDeletionContent(ledgerDeletions));
  const manifest: LedgerManifest = {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    exportedAt: document.exportedAt,
    workspaceRoot: context.workspaceRoot,
    contentHash: ledgerContentHash(ledgerState, ledgerDeletions),
    recordCounts: recordCounts(ledgerState),
    deletedRecordCounts: deletionRecordCounts(ledgerDeletions),
    files,
    deletions
  };
  const manifestPath = join(resolvedDir, LEDGER_MANIFEST_FILE);
  await writeTextFileAtomic(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    outDir: resolvedDir,
    manifestPath,
    contentHash: manifest.contentHash,
    recordCounts: manifest.recordCounts,
    deletedRecordCounts: manifest.deletedRecordCounts,
    files: SNAPSHOT_SECTIONS.map((section) => manifest.files[section]),
    deletions: manifest.deletions
  };
}

export async function importJson(context: CliContext, fromPath: string, options: ImportJsonOptions = {}): Promise<ImportResult> {
  const resolvedPath = await resolveReadablePath(context, fromPath, Boolean(options.allowExternalRead));
  const parsed = await readJsonFile(resolvedPath, {
    schemaName: "boreal.export.v1",
    expectedObject: true,
    maxBytes: 50 * 1024 * 1024
  });
  const incoming = parseImportSnapshot(parsed);
  return importSnapshot(context.store, incoming);
}

export async function importLedgers(
  context: CliContext,
  fromDir: string,
  options: ImportJsonOptions = {}
): Promise<ImportResult> {
  const resolvedDir = await resolveReadablePath(context, fromDir, Boolean(options.allowExternalRead));
  const incoming = (await readLedgerDirectory(resolvedDir)).state;
  return importSnapshot(context.store, incoming);
}

export async function deleteWorkItemWithTombstone(
  context: CliContext,
  workId: WorkId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedWork: WorkItem | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedWork = await context.store.write(async (writer) => {
      const work = await writer.getWorkItem(workId);
      if (!work) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Work item does not exist", { workId });
      }
      await assertWorkItemCanBeDeleted(writer, workId);
      const deleted = await writer.deleteWorkItem(workId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Work item changed before deletion", { workId });
      }
      return work;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "workItems",
      id: workId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedWork.meta.contentHash ?? hashContent(deletedWork)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "workItems",
      id: workId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreWork = deletedWork;
    if (restoreWork && tombstone) {
      await context.store.write((writer) => writer.putWorkItem(restoreWork));
    }
    throw error;
  }
}

export async function deleteEvidenceWithTombstone(
  context: CliContext,
  evidenceId: EvidenceId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedEvidence: EvidenceRecord | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedEvidence = await context.store.write(async (writer) => {
      const evidence = await writer.getEvidence(evidenceId);
      if (!evidence) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Evidence does not exist", { evidenceId });
      }
      await assertEvidenceCanBeDeleted(writer, evidenceId);
      const deleted = await writer.deleteEvidence(evidenceId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Evidence changed before deletion", { evidenceId });
      }
      return evidence;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "evidence",
      id: evidenceId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedEvidence.meta.contentHash ?? hashContent(deletedEvidence)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "evidence",
      id: evidenceId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreEvidence = deletedEvidence;
    if (restoreEvidence && tombstone) {
      await context.store.write((writer) => writer.putEvidence(restoreEvidence));
    }
    throw error;
  }
}

export async function deleteVerificationWithTombstone(
  context: CliContext,
  verificationId: VerificationId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedVerification: VerificationRecord | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedVerification = await context.store.write(async (writer) => {
      const verification = await writer.getVerification(verificationId);
      if (!verification) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Verification does not exist", { verificationId });
      }
      await assertVerificationCanBeDeleted(writer, verificationId);
      const deleted = await writer.deleteVerification(verificationId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Verification changed before deletion", { verificationId });
      }
      return verification;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "verifications",
      id: verificationId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedVerification.meta.contentHash ?? hashContent(deletedVerification)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "verifications",
      id: verificationId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreVerification = deletedVerification;
    if (restoreVerification && tombstone) {
      await context.store.write((writer) => writer.putVerification(restoreVerification));
    }
    throw error;
  }
}

export async function deleteKnowledgeSourceWithTombstone(
  context: CliContext,
  sourceId: KnowledgeSourceId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedSource: KnowledgeSource | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedSource = await context.store.write(async (writer) => {
      const source = await writer.getKnowledgeSource(sourceId);
      if (!source) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Knowledge source does not exist", { sourceId });
      }
      await assertKnowledgeSourceCanBeDeleted(writer, sourceId);
      const deleted = await writer.deleteKnowledgeSource(sourceId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Knowledge source changed before deletion", { sourceId });
      }
      return source;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "knowledgeSources",
      id: sourceId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedSource.meta.contentHash ?? hashContent(deletedSource)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "knowledgeSources",
      id: sourceId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreSource = deletedSource;
    if (restoreSource && tombstone) {
      await context.store.write((writer) => writer.putKnowledgeSource(restoreSource));
    }
    throw error;
  }
}

export async function deleteClaimWithTombstone(
  context: CliContext,
  claimId: ClaimId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedClaim: ClaimRecord | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedClaim = await context.store.write(async (writer) => {
      const claim = await writer.getClaim(claimId);
      if (!claim) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Claim does not exist", { claimId });
      }
      await assertRecordHasNoGraphEdges(writer, "claim", claimId);
      const deleted = await writer.deleteClaim(claimId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Claim changed before deletion", { claimId });
      }
      return claim;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "claims",
      id: claimId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedClaim.meta.contentHash ?? hashContent(deletedClaim)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "claims",
      id: claimId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreClaim = deletedClaim;
    if (restoreClaim && tombstone) {
      await context.store.write((writer) => writer.putClaim(restoreClaim));
    }
    throw error;
  }
}

export async function deleteDecisionWithTombstone(
  context: CliContext,
  decisionId: DecisionId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedDecision: DecisionRecord | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedDecision = await context.store.write(async (writer) => {
      const decision = await writer.getDecision(decisionId);
      if (!decision) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Decision does not exist", { decisionId });
      }
      await assertRecordHasNoGraphEdges(writer, "decision", decisionId);
      const deleted = await writer.deleteDecision(decisionId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Decision changed before deletion", { decisionId });
      }
      return decision;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "decisions",
      id: decisionId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedDecision.meta.contentHash ?? hashContent(deletedDecision)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "decisions",
      id: decisionId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreDecision = deletedDecision;
    if (restoreDecision && tombstone) {
      await context.store.write((writer) => writer.putDecision(restoreDecision));
    }
    throw error;
  }
}

export async function deleteGraphEdgeWithTombstone(
  context: CliContext,
  edgeId: GraphEdgeId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedEdge: GraphEdge | undefined;
  let repairedWorkBefore: WorkItem | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedEdge = await context.store.write(async (writer) => {
      const edge = await writer.getGraphEdge(edgeId);
      if (!edge) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Graph edge does not exist", { edgeId });
      }
      const deleted = await writer.deleteGraphEdge(edgeId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Graph edge changed before deletion", { edgeId });
      }
      repairedWorkBefore = await repairWorkAfterGraphEdgeDelete(writer, edge, context);
      return edge;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "graphEdges",
      id: edgeId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedEdge.meta.contentHash ?? hashContent(deletedEdge)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "graphEdges",
      id: edgeId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreEdge = deletedEdge;
    if (restoreEdge && tombstone) {
      await context.store.write(async (writer) => {
        await writer.putGraphEdge(restoreEdge);
        if (repairedWorkBefore) {
          await writer.putWorkItem(repairedWorkBefore);
        }
      });
    }
    throw error;
  }
}

export async function deleteReservationWithTombstone(
  context: CliContext,
  reservationId: ReservationId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedReservation: AgentReservation | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedReservation = await context.store.write(async (writer) => {
      const reservation = await writer.getReservation(reservationId);
      if (!reservation) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Reservation does not exist", { reservationId });
      }
      await assertReservationCanBeDeleted(writer, reservation);
      const deleted = await writer.deleteReservation(reservationId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Reservation changed before deletion", { reservationId });
      }
      return reservation;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "reservations",
      id: reservationId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedReservation.meta.contentHash ?? hashContent(deletedReservation)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "reservations",
      id: reservationId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreReservation = deletedReservation;
    if (restoreReservation && tombstone) {
      await context.store.write((writer) => writer.putReservation(restoreReservation));
    }
    throw error;
  }
}

export async function deleteProjectionWithTombstone(
  context: CliContext,
  projectionId: ProjectionId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedProjection: ProjectionRecord | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedProjection = await context.store.write(async (writer) => {
      const projection = await writer.getProjection(projectionId);
      if (!projection) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Projection does not exist", { projectionId });
      }
      const deleted = await writer.deleteProjection(projectionId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Projection changed before deletion", { projectionId });
      }
      return projection;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "projections",
      id: projectionId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: deletedProjection.meta.contentHash ?? hashContent(deletedProjection)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "projections",
      id: projectionId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreProjection = deletedProjection;
    if (restoreProjection && tombstone) {
      await context.store.write((writer) => writer.putProjection(restoreProjection));
    }
    throw error;
  }
}

export async function deleteContextPackWithTombstone(
  context: CliContext,
  contextPackId: ProjectionId,
  reason: string | undefined
): Promise<LedgerDeleteRecordResult> {
  let deletedContextPack: ContextPack | undefined;
  let tombstone: LedgerDeletionRecord | undefined;
  try {
    deletedContextPack = await context.store.write(async (writer) => {
      const contextPack = (await writer.listContextPacks()).find((pack) => pack.id === contextPackId);
      if (!contextPack) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Context pack does not exist", { contextPackId });
      }
      const deleted = await writer.deleteContextPack(contextPackId);
      if (!deleted) {
        throw new BorealError("BOREAL_CONFLICT", "Context pack changed before deletion", { contextPackId });
      }
      return contextPack;
    });
    tombstone = {
      schemaVersion: "boreal.ledger-deletion.v1",
      section: "contextPacks",
      id: contextPackId,
      deletedAt: nowIso(),
      reason,
      deletedContentHash: hashContent(deletedContextPack)
    };
    const ledger = await exportLedgersWithAdditionalDeletions(context, undefined, [tombstone]);
    return {
      deleted: true,
      section: "contextPacks",
      id: contextPackId,
      tombstone,
      ledger
    };
  } catch (error) {
    const restoreContextPack = deletedContextPack;
    if (restoreContextPack && tombstone) {
      await context.store.write((writer) => writer.putContextPack(restoreContextPack));
    }
    throw error;
  }
}

export async function ledgerStatus(context: CliContext, dir: string | undefined): Promise<LedgerStatusResult> {
  const document = await buildExportDocument(context);
  const currentLedgerState = canonicalLedgerSnapshot(document.state);
  const emptyExpectedContentHash = ledgerContentHash(currentLedgerState, []);
  const resolvedDir = await resolveWorkspacePath(context, dir ?? ".boreal/ledgers");
  const manifestPath = join(resolvedDir, LEDGER_MANIFEST_FILE);

  try {
    const { manifest, deletions } = await readLedgerDirectory(resolvedDir);
    assertNoDeletedLiveRecords(currentLedgerState, deletions);
    const expectedContentHash = ledgerContentHash(currentLedgerState, deletions);
    return {
      ok: manifest.contentHash === expectedContentHash,
      path: manifestPath,
      exists: true,
      stale: manifest.contentHash !== expectedContentHash,
      expectedContentHash,
      reconstructable: true,
      contentHash: manifest.contentHash,
      recordCounts: manifest.recordCounts,
      deletedRecordCounts: manifest.deletedRecordCounts,
      files: SNAPSHOT_SECTIONS.map((section) => manifest.files[section]),
      deletions: manifest.deletions
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        ok: false,
        path: manifestPath,
        exists: false,
        stale: true,
        expectedContentHash: emptyExpectedContentHash,
        reconstructable: false
      };
    }
    return {
      ok: false,
      path: manifestPath,
      exists: true,
      stale: true,
      expectedContentHash: emptyExpectedContentHash,
      reconstructable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function createSnapshot(context: CliContext, name: string | undefined): Promise<SnapshotCreateResult> {
  const document = await buildExportDocument(context);
  const snapshotDir = join(context.paths.borealDir, "snapshots");
  await mkdir(snapshotDir, { recursive: true });
  const id = snapshotId(document, name);
  const path = join(snapshotDir, `${id}.json`);
  await writeTextFileAtomic(path, `${JSON.stringify(document, null, 2)}\n`);
  return {
    id,
    path,
    contentHash: document.contentHash,
    recordCounts: document.recordCounts
  };
}

export async function listSnapshots(context: CliContext): Promise<readonly SnapshotListEntry[]> {
  const snapshotDir = join(context.paths.borealDir, "snapshots");
  let entries: string[];
  try {
    entries = await readdir(snapshotDir);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const snapshots = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map(async (entry) => snapshotListEntry(join(snapshotDir, entry)))
  );
  return snapshots;
}

export async function showSnapshot(context: CliContext, id: string): Promise<ExportDocument> {
  const safeId = parseSnapshotId(id);
  const path = join(context.paths.borealDir, "snapshots", `${safeId}.json`);
  const parsed = await readJsonFile(path, {
    schemaName: "boreal.export.v1",
    expectedObject: true,
    maxBytes: 50 * 1024 * 1024
  });
  const snapshot = parseExportDocument(parsed);
  return {
    schemaVersion: "boreal.export.v1",
    exportedAt: snapshot.exportedAt,
    workspaceRoot: snapshot.workspaceRoot,
    contentHash: snapshot.contentHash,
    recordCounts: snapshot.recordCounts,
    state: snapshot.state
  };
}

export async function exportDriftDiagnostics(context: CliContext): Promise<{
  readonly snapshotCount: number;
  readonly latestSnapshot?: SnapshotListEntry;
  readonly exportHash: string;
  readonly latestSnapshotHash?: string;
  readonly drift: boolean;
}> {
  const document = await buildExportDocument(context);
  const snapshots = await listSnapshots(context);
  const latestSnapshot = snapshots.at(-1);
  return {
    snapshotCount: snapshots.length,
    latestSnapshot,
    exportHash: document.contentHash,
    latestSnapshotHash: latestSnapshot?.contentHash,
    drift: latestSnapshot?.contentHash !== undefined && latestSnapshot.contentHash !== document.contentHash
  };
}

async function readSnapshot(reader: BorealReader): Promise<ExportSnapshot> {
  return {
    workItems: await reader.listWorkItems(),
    evidence: await reader.listEvidence(),
    verifications: await reader.listVerifications(),
    knowledgeSources: await reader.listKnowledgeSources(),
    claims: await reader.listClaims(),
    decisions: await reader.listDecisions(),
    graphEdges: await reader.listGraphEdges(),
    reservations: await reader.listReservations(),
    events: (await reader.listEvents()).map(portableEvent),
    projections: await reader.listProjections(),
    contextPacks: await reader.listContextPacks()
  };
}

async function readLedgerDirectory(
  dir: string
): Promise<{
  readonly manifest: LedgerManifest;
  readonly state: ExportSnapshot;
  readonly deletions: readonly LedgerDeletionRecord[];
}> {
  const manifestPath = join(dir, LEDGER_MANIFEST_FILE);
  const manifest = parseLedgerManifest(
    await readJsonFile(manifestPath, {
      schemaName: LEDGER_SCHEMA_VERSION,
      expectedObject: true,
      maxBytes: 1024 * 1024
    })
  );
  const state = Object.fromEntries(
    await Promise.all(
      SNAPSHOT_SECTIONS.map(async (section) => [
        section,
        await readLedgerSection(dir, section, manifest.files[section])
      ])
    )
  ) as ExportSnapshot;
  const deletions = await readLedgerDeletions(dir, manifest.deletions);
  validateSnapshot(state);
  assertNoDeletedLiveRecords(state, deletions);
  const contentHash = ledgerContentHash(canonicalLedgerSnapshot(state), deletions);
  if (contentHash !== manifest.contentHash) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest content hash does not match JSONL records", {
      contentHash: manifest.contentHash,
      expectedHash: contentHash
    });
  }
  return { manifest, state, deletions };
}

async function readLedgerSection(
  dir: string,
  section: SnapshotSection,
  file: LedgerManifestFile
): Promise<readonly unknown[]> {
  const path = resolve(dir, file.path);
  assertPathInside(dir, path);
  await assertRealPathInside(dir, path);
  const info = await stat(path);
  if (!info.isFile()) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger path must be a regular file", { section, path });
  }
  if (info.size > 50 * 1024 * 1024) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger file exceeds maximum readable size", {
      section,
      path,
      sizeBytes: info.size,
      maxBytes: 50 * 1024 * 1024
    });
  }
  const records = parseJsonlStrict(await readFile(path, "utf8"), {
    path,
    schemaName: `boreal.ledgers.${section}.v1`,
    expectedObject: true
  });
  if (records.length !== file.count) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger file count does not match manifest", {
      section,
      path,
      count: file.count,
      actualCount: records.length
    });
  }
  const contentHash = hashContent(records);
  if (contentHash !== file.contentHash) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger file content hash does not match manifest", {
      section,
      path,
      contentHash: file.contentHash,
      expectedHash: contentHash
    });
  }
  return records;
}

async function readExistingLedgerDeletions(dir: string): Promise<readonly LedgerDeletionRecord[]> {
  const manifestPath = join(dir, LEDGER_MANIFEST_FILE);
  try {
    const manifest = parseLedgerManifest(
      await readJsonFile(manifestPath, {
        schemaName: LEDGER_SCHEMA_VERSION,
        expectedObject: true,
        maxBytes: 1024 * 1024
      })
    );
    return readLedgerDeletions(dir, manifest.deletions);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function readLedgerDeletions(
  dir: string,
  file: LedgerDeletionManifestFile
): Promise<readonly LedgerDeletionRecord[]> {
  const path = resolve(dir, file.path);
  assertPathInside(dir, path);
  await assertRealPathInside(dir, path);
  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(path);
  } catch (error) {
    if (file.count === 0 && isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  if (!info.isFile()) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletions path must be a regular file", { path });
  }
  if (info.size > 50 * 1024 * 1024) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletions file exceeds maximum readable size", {
      path,
      sizeBytes: info.size,
      maxBytes: 50 * 1024 * 1024
    });
  }
  const records = parseJsonlStrict(await readFile(path, "utf8"), {
    path,
    schemaName: "boreal.ledger-deletions.v1",
    expectedObject: true
  }).map(parseLedgerDeletionRecord);
  if (records.length !== file.count) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletions count does not match manifest", {
      path,
      count: file.count,
      actualCount: records.length
    });
  }
  const contentHash = hashContent(canonicalLedgerDeletions(records));
  if (contentHash !== file.contentHash) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletions content hash does not match manifest", {
      path,
      contentHash: file.contentHash,
      expectedHash: contentHash
    });
  }
  assertUniqueDeletions(records);
  return records;
}

async function importSnapshot(store: BorealStore, incoming: ExportSnapshot): Promise<ImportResult> {
  validateSnapshot(incoming);
  return store.write(async (writer) => {
    const current = await readSnapshot(writer);
    const merged = mergeSnapshot(current, incoming);
    validateSnapshot(merged.state);
    await writeImportedRecords(writer, incoming, merged.importableIds);
    return { imported: merged.imported, skipped: merged.skipped };
  });
}

async function assertWorkItemCanBeDeleted(reader: BorealReader, workId: WorkId): Promise<void> {
  const [workItems, evidence, verifications, graphEdges, reservations, projections, contextPacks] = await Promise.all([
    reader.listWorkItems(),
    reader.listEvidence(),
    reader.listVerifications(),
    reader.listGraphEdges(),
    reader.listReservations(),
    reader.listProjections(),
    reader.listContextPacks()
  ]);
  const childWorkIds = workItems.filter((work) => work.parentId === workId).map((work) => work.meta.id);
  const dependencyWorkIds = workItems
    .filter((work) => work.dependencyIds.includes(workId))
    .map((work) => work.meta.id);
  const evidenceIds = evidence
    .filter((record) => subjectReferences(record, workId, GRAPH_TYPE_ALIASES.work))
    .map((record) => record.meta.id);
  const verificationIds = verifications
    .filter((record) => subjectReferences(record, workId, GRAPH_TYPE_ALIASES.work))
    .map((record) => record.meta.id);
  const graphEdgeIds = graphEdges
    .filter((edge) => graphEdgeReferences(edge, workId, GRAPH_TYPE_ALIASES.work))
    .map((edge) => edge.meta.id);
  const reservationIds = reservations.filter((reservation) => reservation.workId === workId).map((reservation) => reservation.meta.id);
  const projectionIds = projections
    .filter((projection) => projection.subjectId === workId)
    .map((projection) => projection.meta.id);
  const contextPackIds = contextPacks.filter((pack) => pack.subjectId === workId).map((pack) => pack.id);

  if (
    childWorkIds.length > 0 ||
    dependencyWorkIds.length > 0 ||
    evidenceIds.length > 0 ||
    verificationIds.length > 0 ||
    graphEdgeIds.length > 0 ||
    reservationIds.length > 0 ||
    projectionIds.length > 0 ||
    contextPackIds.length > 0
  ) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot delete work item while records reference it", {
      workId,
      references: {
        childWork: childWorkIds,
        dependencyWork: dependencyWorkIds,
        evidence: evidenceIds,
        verifications: verificationIds,
        graphEdges: graphEdgeIds,
        reservations: reservationIds,
        projections: projectionIds,
        contextPacks: contextPackIds
      }
    });
  }
}

async function assertEvidenceCanBeDeleted(reader: BorealReader, evidenceId: EvidenceId): Promise<void> {
  const [workItems, verifications, claims, graphEdges] = await Promise.all([
    reader.listWorkItems(),
    reader.listVerifications(),
    reader.listClaims(),
    reader.listGraphEdges()
  ]);
  const workIds = workItems.filter((work) => work.evidenceIds.includes(evidenceId)).map((work) => work.meta.id);
  const verificationIds = verifications
    .filter((verification) => verification.evidenceIds.includes(evidenceId))
    .map((verification) => verification.meta.id);
  const claimIds = claims.filter((claim) => claim.evidenceIds.includes(evidenceId)).map((claim) => claim.meta.id);
  const graphEdgeIds = graphEdges
    .filter((edge) => graphEdgeReferences(edge, evidenceId, GRAPH_TYPE_ALIASES.evidence))
    .map((edge) => edge.meta.id);

  if (workIds.length > 0 || verificationIds.length > 0 || claimIds.length > 0 || graphEdgeIds.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot delete evidence while records reference it", {
      evidenceId,
      references: {
        workItems: workIds,
        verifications: verificationIds,
        claims: claimIds,
        graphEdges: graphEdgeIds
      }
    });
  }
}

async function assertVerificationCanBeDeleted(reader: BorealReader, verificationId: VerificationId): Promise<void> {
  const [workItems, graphEdges] = await Promise.all([reader.listWorkItems(), reader.listGraphEdges()]);
  const workIds = workItems
    .filter((work) => work.verificationIds.includes(verificationId))
    .map((work) => work.meta.id);
  const graphEdgeIds = graphEdges
    .filter((edge) => graphEdgeReferences(edge, verificationId, GRAPH_TYPE_ALIASES.verification))
    .map((edge) => edge.meta.id);

  if (workIds.length > 0 || graphEdgeIds.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot delete verification while records reference it", {
      verificationId,
      references: {
        workItems: workIds,
        graphEdges: graphEdgeIds
      }
    });
  }
}

async function repairWorkAfterGraphEdgeDelete(
  writer: BorealWriter,
  edge: GraphEdge,
  context: CliContext
): Promise<WorkItem | undefined> {
  if (edge.kind !== "blocks" || edge.fromType !== "work" || edge.toType !== "work") {
    return undefined;
  }
  const work = await writer.getWorkItem(edge.toId as WorkId);
  if (!work) {
    return undefined;
  }
  const workItems = await writer.listWorkItems();
  const workById = new Map(workItems.map((item) => [item.meta.id, item]));
  const dependencyIds = uniqueStrings(
    (await writer.listGraphEdges())
      .filter((candidate) => candidate.kind === "blocks" && candidate.fromType === "work" && candidate.toType === "work")
      .filter((candidate) => candidate.toId === work.meta.id && workById.has(candidate.fromId as WorkId))
      .map((candidate) => candidate.fromId)
  ) as readonly WorkId[];
  const dependencies = dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
  const status = deriveReadinessStatus({ ...work, dependencyIds }, dependencies);
  if (arraysEqual(work.dependencyIds, dependencyIds) && work.status === status) {
    return undefined;
  }
  await writer.putWorkItem(touchRecord({ ...work, dependencyIds, status }, nowIso(), context.actor));
  return work;
}

async function assertReservationCanBeDeleted(reader: BorealReader, reservation: AgentReservation): Promise<void> {
  const referencingWorkIds = (await reader.listWorkItems())
    .filter((work) => work.reservationId === reservation.meta.id)
    .map((work) => work.meta.id);
  if (reservation.status === "active" || referencingWorkIds.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot delete reservation while it is active or referenced by work", {
      reservationId: reservation.meta.id,
      status: reservation.status,
      references: {
        workItems: referencingWorkIds
      }
    });
  }
}

async function assertKnowledgeSourceCanBeDeleted(reader: BorealReader, sourceId: KnowledgeSourceId): Promise<void> {
  const [claims, decisions, graphEdges] = await Promise.all([
    reader.listClaims(),
    reader.listDecisions(),
    reader.listGraphEdges()
  ]);
  const claimIds = claims.filter((claim) => claim.sourceIds.includes(sourceId)).map((claim) => claim.meta.id);
  const decisionIds = decisions.filter((decision) => decision.sourceIds.includes(sourceId)).map((decision) => decision.meta.id);
  const graphEdgeIds = graphEdges
    .filter((edge) => graphEdgeReferences(edge, sourceId, GRAPH_TYPE_ALIASES.source))
    .map((edge) => edge.meta.id);

  if (claimIds.length > 0 || decisionIds.length > 0 || graphEdgeIds.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot delete knowledge source while records reference it", {
      sourceId,
      references: {
        claims: claimIds,
        decisions: decisionIds,
        graphEdges: graphEdgeIds
      }
    });
  }
}

type DeletableGraphRecordKind = "work" | "evidence" | "verification" | "source" | "claim" | "decision";

const GRAPH_TYPE_ALIASES: Record<DeletableGraphRecordKind, readonly string[]> = {
  work: ["work", "workItem", "workItems"],
  evidence: ["evidence"],
  verification: ["verification", "verifications"],
  source: ["source", "knowledgeSource", "knowledge_source", "knowledgeSources"],
  claim: ["claim", "claims"],
  decision: ["decision", "decisions"]
};

async function assertRecordHasNoGraphEdges(
  reader: BorealReader,
  recordType: DeletableGraphRecordKind,
  recordId: string
): Promise<void> {
  const graphEdgeIds = (await reader.listGraphEdges())
    .filter((edge) => graphEdgeReferences(edge, recordId, GRAPH_TYPE_ALIASES[recordType]))
    .map((edge) => edge.meta.id);
  if (graphEdgeIds.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot delete record while graph edges reference it", {
      recordType,
      recordId,
      references: {
        graphEdges: graphEdgeIds
      }
    });
  }
}

function graphEdgeReferences(
  edge: { readonly fromType: string; readonly fromId: string; readonly toType: string; readonly toId: string },
  id: string,
  types: readonly string[]
): boolean {
  return (types.includes(edge.fromType) && edge.fromId === id) || (types.includes(edge.toType) && edge.toId === id);
}

function subjectReferences(
  record: { readonly subjectType: string; readonly subjectId: string },
  id: string,
  types: readonly string[]
): boolean {
  return types.includes(record.subjectType) && record.subjectId === id;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
}

function parseLedgerManifest(value: unknown): LedgerManifest {
  if (!isRecord(value) || value.schemaVersion !== LEDGER_SCHEMA_VERSION) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest must be a boreal.ledgers.v1 document");
  }
  const filesValue = value.files;
  if (!isRecord(filesValue)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest files must be an object");
  }
  const recordCounts = parseSectionCounts(value.recordCounts, "recordCounts");
  const files = Object.fromEntries(
    SNAPSHOT_SECTIONS.map((section) => [section, parseLedgerManifestFile(section, filesValue[section])])
  ) as Record<SnapshotSection, LedgerManifestFile>;
  const deletions = parseLedgerDeletionManifestFile(value.deletions);
  const deletedRecordCounts = parseOptionalDeletionCounts(value.deletedRecordCounts);
  for (const section of SNAPSHOT_SECTIONS) {
    if (recordCounts[section] !== files[section].count) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest section count does not match file count", {
        section,
        count: recordCounts[section],
        fileCount: files[section].count
      });
    }
  }
  if (Object.values(deletedRecordCounts).reduce((sum, count) => sum + count, 0) !== deletions.count) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest deleted record counts do not match deletions count", {
      deletedRecordCounts,
      deletionCount: deletions.count
    });
  }
  return {
    schemaVersion: LEDGER_SCHEMA_VERSION,
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    workspaceRoot: typeof value.workspaceRoot === "string" ? value.workspaceRoot : "",
    contentHash: typeof value.contentHash === "string" ? value.contentHash : "",
    recordCounts,
    deletedRecordCounts,
    files,
    deletions
  };
}

function parseLedgerManifestFile(section: SnapshotSection, value: unknown): LedgerManifestFile {
  if (!isRecord(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest file entry must be an object", { section });
  }
  if (value.section !== section) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest file entry has the wrong section", {
      section,
      actualSection: value.section
    });
  }
  if (typeof value.path !== "string" || value.path.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest file entry must include a path", { section });
  }
  if (typeof value.count !== "number" || !Number.isInteger(value.count) || value.count < 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest file entry must include a non-negative count", {
      section,
      count: value.count
    });
  }
  if (typeof value.contentHash !== "string" || !value.contentHash.startsWith("sha256:")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest file entry must include a content hash", {
      section
    });
  }
  return {
    section,
    path: value.path,
    count: value.count,
    contentHash: value.contentHash
  };
}

function parseLedgerDeletionManifestFile(value: unknown): LedgerDeletionManifestFile {
  if (value === undefined) {
    return {
      path: LEDGER_DELETIONS_FILE,
      count: 0,
      contentHash: hashContent([])
    };
  }
  if (!isRecord(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest deletions entry must be an object");
  }
  if (typeof value.path !== "string" || value.path.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest deletions entry must include a path");
  }
  if (typeof value.count !== "number" || !Number.isInteger(value.count) || value.count < 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest deletions entry must include a non-negative count", {
      count: value.count
    });
  }
  if (typeof value.contentHash !== "string" || !value.contentHash.startsWith("sha256:")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger manifest deletions entry must include a content hash");
  }
  return {
    path: value.path,
    count: value.count,
    contentHash: value.contentHash
  };
}

function parseImportSnapshot(value: unknown): ExportSnapshot {
  if (!isRecord(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Import file must contain a JSON object");
  }
  if (value.schemaVersion === "boreal.export.v1") {
    return parseExportDocument(value).state;
  }
  if (value.schemaVersion === "boreal.file-store.v1") {
    return normalizeSnapshot(value);
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "Unsupported import schema version", {
    schemaVersion: value.schemaVersion
  });
}

function parseExportDocument(value: unknown): ExportDocument {
  if (!isRecord(value) || value.schemaVersion !== "boreal.export.v1") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot file must be a boreal.export.v1 document");
  }
  const state = normalizeSnapshot(value.state);
  const contentHash = String(value.contentHash ?? "");
  const expectedHash = hashContent(state);
  if (contentHash !== expectedHash) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot content hash does not match state", {
      contentHash,
      expectedHash
    });
  }
  validateSnapshot(state);
  return {
    schemaVersion: "boreal.export.v1",
    exportedAt: typeof value.exportedAt === "string" ? value.exportedAt : "",
    workspaceRoot: typeof value.workspaceRoot === "string" ? value.workspaceRoot : "",
    contentHash,
    recordCounts: recordCounts(state),
    state
  };
}

function normalizeSnapshot(value: unknown): ExportSnapshot {
  if (!isRecord(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot state must be an object");
  }
  const snapshot = Object.fromEntries(
    SNAPSHOT_SECTIONS.map((section) => {
      const sectionValue = value[section];
      if (sectionValue === undefined) {
        return [section, []];
      }
      if (!Array.isArray(sectionValue)) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot section must be an array", { section });
      }
      return [section, section === "events" ? sectionValue.map(portableEvent) : sectionValue];
    })
  ) as unknown as ExportSnapshot;
  return snapshot;
}

function portableEvent<T>(value: T): T {
  if (!isRecord(value) || (value.operationId === undefined && value.operationLink === undefined)) {
    return value;
  }
  const { operationId: _operationId, operationLink: _operationLink, ...event } = value;
  return isRecord(event.meta) ? (withContentHash(event as unknown as RuntimeEvent) as T) : (event as T);
}

function validateSnapshot(snapshot: ExportSnapshot): void {
  const schemaIssues = runtimeSnapshotSchemaIssues(snapshot);
  if (schemaIssues.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot failed schema validation", {
      issues: schemaIssues.slice(0, 50),
      issueCount: schemaIssues.length
    });
  }

  const ids = new Map<SnapshotSection, Set<string>>();
  for (const section of SNAPSHOT_SECTIONS) {
    const seen = new Set<string>();
    for (const record of snapshot[section] as readonly unknown[]) {
      const id = recordId(section, record);
      if (!id) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot record is missing an id", { section });
      }
      if (seen.has(id)) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot section contains duplicate ids", { section, id });
      }
      seen.add(id);
    }
    ids.set(section, seen);
  }

  const workIds = ids.get("workItems") ?? new Set<string>();
  const evidenceIds = ids.get("evidence") ?? new Set<string>();
  const verificationIds = ids.get("verifications") ?? new Set<string>();
  const sourceIds = ids.get("knowledgeSources") ?? new Set<string>();
  const reservationIds = ids.get("reservations") ?? new Set<string>();

  for (const work of snapshot.workItems) {
    assertArrayField(work, "dependencyIds", "workItems", work.meta.id);
    assertArrayField(work, "evidenceIds", "workItems", work.meta.id);
    assertArrayField(work, "verificationIds", "workItems", work.meta.id);
    assertReferences("work dependency", work.meta.id, work.dependencyIds, workIds);
    assertReferences("work evidence", work.meta.id, work.evidenceIds, evidenceIds);
    assertReferences("work verification", work.meta.id, work.verificationIds, verificationIds);
    if (work.reservationId && !reservationIds.has(work.reservationId)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Work references missing reservation", {
        workId: work.meta.id,
        reservationId: work.reservationId
      });
    }
  }
  for (const evidence of snapshot.evidence) {
    if (evidence.subjectType === "work" && !workIds.has(evidence.subjectId)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Evidence references missing work", {
        evidenceId: evidence.meta.id,
        workId: evidence.subjectId
      });
    }
  }
  for (const verification of snapshot.verifications) {
    assertArrayField(verification, "evidenceIds", "verifications", verification.meta.id);
    if (verification.subjectType === "work" && !workIds.has(verification.subjectId)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Verification references missing work", {
        verificationId: verification.meta.id,
        workId: verification.subjectId
      });
    }
    assertReferences("verification evidence", verification.meta.id, verification.evidenceIds, evidenceIds);
  }
  for (const claim of snapshot.claims) {
    assertArrayField(claim, "sourceIds", "claims", claim.meta.id);
    assertArrayField(claim, "evidenceIds", "claims", claim.meta.id);
    assertReferences("claim source", claim.meta.id, claim.sourceIds, sourceIds);
    assertReferences("claim evidence", claim.meta.id, claim.evidenceIds, evidenceIds);
  }
  for (const decision of snapshot.decisions) {
    assertArrayField(decision, "sourceIds", "decisions", decision.meta.id);
    assertArrayField(decision, "consequences", "decisions", decision.meta.id);
    assertReferences("decision source", decision.meta.id, decision.sourceIds, sourceIds);
  }
  for (const edge of snapshot.graphEdges) {
    if (edge.fromType === "work" && !workIds.has(edge.fromId)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Graph edge references missing source work", {
        edgeId: edge.meta.id,
        workId: edge.fromId
      });
    }
    if (edge.toType === "work" && !workIds.has(edge.toId)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Graph edge references missing target work", {
        edgeId: edge.meta.id,
        workId: edge.toId
      });
    }
  }
  for (const reservation of snapshot.reservations) {
    if (!workIds.has(reservation.workId)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Reservation references missing work", {
        reservationId: reservation.meta.id,
        workId: reservation.workId
      });
    }
  }
  for (const pack of snapshot.contextPacks) {
    assertArrayField(pack, "facts", "contextPacks", pack.id);
    assertArrayField(pack, "evidence", "contextPacks", pack.id);
    if (!workIds.has(pack.subjectId)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Context pack references missing work", {
        contextPackId: pack.id,
        workId: pack.subjectId
      });
    }
  }
}

function assertArrayField(record: unknown, field: string, section: SnapshotSection, id: string): void {
  if (!isRecord(record) || !Array.isArray(record[field])) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot record field must be an array", { section, id, field });
  }
}

function assertReferences(label: string, recordId: string, values: readonly string[], validIds: ReadonlySet<string>): void {
  const missing = values.filter((value) => !validIds.has(value));
  if (missing.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Snapshot has dangling ${label} reference`, {
      recordId,
      missing
    });
  }
}

function mergeSnapshot(
  current: ExportSnapshot,
  incoming: ExportSnapshot
): {
  readonly state: ExportSnapshot;
  readonly imported: Record<SnapshotSection, number>;
  readonly skipped: Record<SnapshotSection, number>;
  readonly importableIds: Record<SnapshotSection, ReadonlySet<string>>;
} {
  const state = { ...current };
  const imported = emptySectionCounts();
  const skipped = emptySectionCounts();
  const importableIds = Object.fromEntries(SNAPSHOT_SECTIONS.map((section) => [section, new Set<string>()])) as Record<
    SnapshotSection,
    Set<string>
  >;

  for (const section of SNAPSHOT_SECTIONS) {
    const existingById = new Map((current[section] as readonly unknown[]).map((record) => [recordId(section, record), record]));
    const mergedRecords = [...(current[section] as readonly unknown[])];
    for (const record of incoming[section] as readonly unknown[]) {
      const id = recordId(section, record);
      const existing = id ? existingById.get(id) : undefined;
      if (!id) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Snapshot record is missing an id", { section });
      }
      if (existing) {
        if (canonicalJson(existing) !== canonicalJson(record)) {
          throw new BorealError("BOREAL_CONFLICT", "Import record id collides with different existing content", {
            section,
            id
          });
        }
        skipped[section] += 1;
      } else {
        mergedRecords.push(record);
        imported[section] += 1;
        importableIds[section].add(id);
      }
    }
    state[section] = mergedRecords as never;
  }

  return { state, imported, skipped, importableIds };
}

async function writeImportedRecords(
  writer: BorealWriter,
  incoming: ExportSnapshot,
  importableIds: Record<SnapshotSection, ReadonlySet<string>>
): Promise<void> {
  for (const record of incoming.workItems.filter((entry) => importableIds.workItems.has(entry.meta.id))) {
    await writer.putWorkItem(record);
  }
  for (const record of incoming.evidence.filter((entry) => importableIds.evidence.has(entry.meta.id))) {
    await writer.putEvidence(record);
  }
  for (const record of incoming.verifications.filter((entry) => importableIds.verifications.has(entry.meta.id))) {
    await writer.putVerification(record);
  }
  for (const record of incoming.knowledgeSources.filter((entry) => importableIds.knowledgeSources.has(entry.meta.id))) {
    await writer.putKnowledgeSource(record);
  }
  for (const record of incoming.claims.filter((entry) => importableIds.claims.has(entry.meta.id))) {
    await writer.putClaim(record);
  }
  for (const record of incoming.decisions.filter((entry) => importableIds.decisions.has(entry.meta.id))) {
    await writer.putDecision(record);
  }
  for (const record of incoming.graphEdges.filter((entry) => importableIds.graphEdges.has(entry.meta.id))) {
    await writer.putGraphEdge(record);
  }
  for (const record of incoming.reservations.filter((entry) => importableIds.reservations.has(entry.meta.id))) {
    await writer.putReservation(record);
  }
  for (const record of incoming.events.filter((entry) => importableIds.events.has(entry.meta.id))) {
    await writer.putEvent(record);
  }
  for (const record of incoming.projections.filter((entry) => importableIds.projections.has(entry.meta.id))) {
    await writer.putProjection(record);
  }
  for (const record of incoming.contextPacks.filter((entry) => importableIds.contextPacks.has(entry.id))) {
    await writer.putContextPack(record);
  }
}

function markdownFiles(document: ExportDocument): Array<{ path: string; content: string }> {
  return [
    {
      path: "README.md",
      content: `# Boreal Export\n\n- Schema: ${document.schemaVersion}\n- Exported: ${document.exportedAt}\n- Hash: ${document.contentHash}\n\n${SNAPSHOT_SECTIONS.map((section) => `- ${section}: ${document.recordCounts[section]}`).join("\n")}\n`
    },
    ...document.state.workItems.map((record) => ({
      path: `work/${record.meta.id}.md`,
      content:
        frontmatter({
          kind: "work",
          id: record.meta.id,
          work_kind: record.kind,
          status: record.status,
          priority: record.priority,
          labels: record.labels,
          parent_id: record.parentId,
          depends_on: record.dependencyIds,
          evidence: record.evidenceIds,
          verifications: record.verificationIds,
          reservation_id: record.reservationId,
          closed_at: record.closedAt,
          created_at: record.meta.createdAt,
          updated_at: record.meta.updatedAt,
          tags: record.meta.tags
        }) +
        `# ${record.title}\n\nStatus: ${record.status}\nPriority: ${record.priority}\nKind: ${record.kind}\n\n${record.description}\n`
    })),
    ...document.state.evidence.map((record) => ({
      path: `evidence/${record.meta.id}.md`,
      content:
        frontmatter({
          kind: "evidence",
          id: record.meta.id,
          evidence_kind: record.kind,
          outcome: record.outcome,
          subject_type: record.subjectType,
          subject_id: record.subjectId,
          command: record.command,
          uri: record.uri,
          observed_at: record.observedAt,
          created_at: record.meta.createdAt,
          updated_at: record.meta.updatedAt,
          tags: record.meta.tags
        }) +
        `# ${record.summary}\n\nOutcome: ${record.outcome}\nKind: ${record.kind}\nSubject: ${record.subjectType}:${record.subjectId}\n\n${record.command ? `Command: \`${record.command}\`\n` : ""}${record.uri ? `URI: ${record.uri}\n` : ""}`
    })),
    ...document.state.knowledgeSources.map((record) => ({
      path: `sources/${record.meta.id}.md`,
      content:
        frontmatter({
          kind: "source",
          id: record.meta.id,
          source_kind: record.kind,
          uri: record.uri,
          created_at: record.meta.createdAt,
          updated_at: record.meta.updatedAt,
          tags: record.meta.tags
        }) + `# ${record.title}\n\nKind: ${record.kind}\nURI: ${record.uri}\n\n${record.summary}\n`
    })),
    ...document.state.claims.map((record) => ({
      path: `claims/${record.meta.id}.md`,
      content:
        frontmatter({
          kind: "claim",
          id: record.meta.id,
          status: record.status,
          sources: record.sourceIds,
          evidence: record.evidenceIds,
          created_at: record.meta.createdAt,
          updated_at: record.meta.updatedAt,
          tags: record.meta.tags
        }) + `# Claim\n\nStatus: ${record.status}\n\n${record.statement}\n\nSources: ${record.sourceIds.join(", ")}\nEvidence: ${record.evidenceIds.join(", ")}\n`
    })),
    ...document.state.decisions.map((record) => ({
      path: `decisions/${record.meta.id}.md`,
      content:
        frontmatter({
          kind: "decision",
          id: record.meta.id,
          status: record.status,
          sources: record.sourceIds,
          created_at: record.meta.createdAt,
          updated_at: record.meta.updatedAt,
          tags: record.meta.tags
        }) + `# ${record.title}\n\nStatus: ${record.status}\n\n## Context\n\n${record.context}\n\n## Decision\n\n${record.decision}\n\n## Consequences\n\n${record.consequences.map((item) => `- ${item}`).join("\n")}\n`
    })),
    ...document.state.contextPacks.map((record) => ({
      path: `context/${record.subjectId}.md`,
      content:
        frontmatter({
          kind: "context-pack",
          id: record.id,
          subject_id: record.subjectId,
          generated_at: record.generatedAt
        }) + `# ${record.title}\n\n${record.summary}\n\n## Facts\n\n${record.facts.map((fact) => `- ${fact}`).join("\n")}\n\n## Evidence\n\n${record.evidence.map((entry) => `- ${entry}`).join("\n")}\n`
    }))
  ];
}

type FrontmatterValue = string | number | boolean | undefined | readonly string[];

function frontmatter(fields: Record<string, FrontmatterValue>): string {
  const lines = ["---"];
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) {
      continue;
    }
    if (isStringArray(value)) {
      lines.push(`${key}:`);
      for (const entry of value) {
        lines.push(`  - ${yamlScalar(entry)}`);
      }
      continue;
    }
    lines.push(`${key}: ${yamlScalar(value)}`);
  }
  lines.push("---", "");
  return `${lines.join("\n")}\n`;
}

function yamlScalar(value: string | number | boolean): string {
  if (typeof value !== "string") {
    return String(value);
  }
  return /^[A-Za-z0-9_.:/@-]+$/u.test(value) ? value : JSON.stringify(value);
}

function isStringArray(value: FrontmatterValue): value is readonly string[] {
  return Array.isArray(value);
}

function canonicalLedgerSnapshot(state: ExportSnapshot): ExportSnapshot {
  return Object.fromEntries(
    SNAPSHOT_SECTIONS.map((section) => [
      section,
      [...(state[section] as readonly unknown[])].sort((left, right) =>
        (recordId(section, left) ?? "").localeCompare(recordId(section, right) ?? "")
      )
    ])
  ) as unknown as ExportSnapshot;
}

function ledgerContentHash(state: ExportSnapshot, deletions: readonly LedgerDeletionRecord[]): string {
  return hashContent({
    schemaVersion: LEDGER_SCHEMA_VERSION,
    sections: state,
    deletions: canonicalLedgerDeletions(deletions)
  });
}

function ledgerManifestFile(section: SnapshotSection, records: readonly unknown[]): LedgerManifestFile {
  return {
    section,
    path: LEDGER_FILES[section],
    count: records.length,
    contentHash: hashContent(records)
  };
}

function ledgerDeletionManifestFile(records: readonly LedgerDeletionRecord[]): LedgerDeletionManifestFile {
  return {
    path: LEDGER_DELETIONS_FILE,
    count: records.length,
    contentHash: hashContent(canonicalLedgerDeletions(records))
  };
}

function ledgerDeletionContent(records: readonly LedgerDeletionRecord[]): string {
  const content = canonicalLedgerDeletions(records).map((record) => canonicalJson(record)).join("\n");
  return content.length > 0 ? `${content}\n` : "";
}

function recordCounts(state: ExportSnapshot): Record<SnapshotSection, number> {
  return Object.fromEntries(SNAPSHOT_SECTIONS.map((section) => [section, state[section].length])) as Record<
    SnapshotSection,
    number
  >;
}

function deletionRecordCounts(records: readonly LedgerDeletionRecord[]): Record<SnapshotSection, number> {
  const counts = emptySectionCounts();
  for (const record of records) {
    counts[record.section] += 1;
  }
  return counts;
}

function parseSectionCounts(value: unknown, label: string): Record<SnapshotSection, number> {
  if (!isRecord(value)) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Ledger manifest ${label} must be an object`);
  }
  return Object.fromEntries(
    SNAPSHOT_SECTIONS.map((section) => {
      const count = value[section];
      if (typeof count !== "number" || !Number.isInteger(count) || count < 0) {
        throw new BorealError("BOREAL_INVALID_INPUT", `Ledger manifest ${label} has an invalid count`, {
          section,
          count
        });
      }
      return [section, count];
    })
  ) as Record<SnapshotSection, number>;
}

function parseOptionalDeletionCounts(value: unknown): Record<SnapshotSection, number> {
  if (value === undefined) {
    return emptySectionCounts();
  }
  return parseSectionCounts(value, "deletedRecordCounts");
}

function emptySectionCounts(): Record<SnapshotSection, number> {
  return Object.fromEntries(SNAPSHOT_SECTIONS.map((section) => [section, 0])) as Record<SnapshotSection, number>;
}

function parseLedgerDeletionRecord(value: unknown): LedgerDeletionRecord {
  if (!isRecord(value) || value.schemaVersion !== "boreal.ledger-deletion.v1") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletion record must be a boreal.ledger-deletion.v1 object");
  }
  if (!isSnapshotSection(value.section)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletion record has an invalid section", {
      section: value.section
    });
  }
  if (typeof value.id !== "string" || value.id.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletion record must include an id", {
      section: value.section
    });
  }
  if (typeof value.deletedAt !== "string" || value.deletedAt.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletion record must include deletedAt", {
      section: value.section,
      id: value.id
    });
  }
  if (value.reason !== undefined && typeof value.reason !== "string") {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletion reason must be a string", {
      section: value.section,
      id: value.id
    });
  }
  if (
    value.deletedContentHash !== undefined &&
    (typeof value.deletedContentHash !== "string" || !value.deletedContentHash.startsWith("sha256:"))
  ) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletion content hash must be a sha256 hash", {
      section: value.section,
      id: value.id
    });
  }
  return {
    schemaVersion: "boreal.ledger-deletion.v1",
    section: value.section,
    id: value.id,
    deletedAt: value.deletedAt,
    reason: value.reason,
    deletedContentHash: value.deletedContentHash
  };
}

function canonicalLedgerDeletions(records: readonly LedgerDeletionRecord[]): readonly LedgerDeletionRecord[] {
  return [...records].sort((left, right) => deletionKey(left).localeCompare(deletionKey(right)));
}

function assertUniqueDeletions(records: readonly LedgerDeletionRecord[]): void {
  const seen = new Set<string>();
  for (const record of records) {
    const key = deletionKey(record);
    if (seen.has(key)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Ledger deletion records contain duplicate tombstones", {
        section: record.section,
        id: record.id
      });
    }
    seen.add(key);
  }
}

function assertNoDeletedLiveRecords(state: ExportSnapshot, deletions: readonly LedgerDeletionRecord[]): void {
  const liveIdsBySection = new Map(
    SNAPSHOT_SECTIONS.map((section) => [
      section,
      new Set((state[section] as readonly unknown[]).map((record) => recordId(section, record)).filter(isString))
    ])
  );
  for (const deletion of deletions) {
    if (liveIdsBySection.get(deletion.section)?.has(deletion.id)) {
      throw new BorealError("BOREAL_CONFLICT", "Ledger tombstone conflicts with a live record", {
        section: deletion.section,
        id: deletion.id
      });
    }
  }
}

function deletionKey(record: Pick<LedgerDeletionRecord, "section" | "id">): string {
  return `${record.section}:${record.id}`;
}

function isSnapshotSection(value: unknown): value is SnapshotSection {
  return typeof value === "string" && (SNAPSHOT_SECTIONS as readonly string[]).includes(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function recordId(section: SnapshotSection, record: unknown): string | undefined {
  if (!isRecord(record)) {
    return undefined;
  }
  if (section === "contextPacks") {
    return typeof record.id === "string" ? record.id : undefined;
  }
  const meta = record.meta;
  return isRecord(meta) && typeof meta.id === "string" ? meta.id : undefined;
}

function snapshotId(document: ExportDocument, name: string | undefined): string {
  const timestamp = document.exportedAt.replace(/[:.]/g, "-");
  const suffix = document.contentHash.replace("sha256:", "").slice(0, 12);
  const cleanName = name ? `${slugify(name)}-` : "";
  return `${timestamp}-${cleanName}${suffix}`;
}

function parseSnapshotId(value: string): string {
  const clean = value.endsWith(".json") ? basename(value, ".json") : value;
  if (!/^[a-zA-Z0-9_.-]+$/.test(clean) || clean.includes("..")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Invalid snapshot id", { id: value });
  }
  return clean;
}

async function snapshotListEntry(path: string): Promise<SnapshotListEntry> {
  const info = await stat(path);
  const id = basename(path, ".json");
  try {
    const parsed = await readJsonFile(path, {
      schemaName: "boreal.export.v1",
      expectedObject: true,
      maxBytes: 50 * 1024 * 1024
    });
    const document = parseExportDocument(parsed);
    return {
      id,
      path,
      createdAt: document.exportedAt,
      contentHash: document.contentHash,
      sizeBytes: info.size
    };
  } catch {
    return { id, path, sizeBytes: info.size };
  }
}

async function resolveWorkspacePath(context: CliContext, path: string): Promise<string> {
  const resolvedPath = resolve(context.workspaceRoot, path);
  assertPathInside(context.workspaceRoot, resolvedPath);
  await assertRealPathInside(context.workspaceRoot, resolvedPath);
  return resolvedPath;
}

async function resolveReadablePath(context: CliContext, path: string, allowExternalRead: boolean): Promise<string> {
  const resolvedPath = resolve(context.workspaceRoot, path);
  if (!allowExternalRead) {
    assertPathInside(context.workspaceRoot, resolvedPath);
    await assertRealPathInside(context.workspaceRoot, resolvedPath);
  }
  return resolvedPath;
}

function slugify(value: string): string {
  const slug = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "snapshot";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
