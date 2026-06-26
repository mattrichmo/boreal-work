import { mkdir, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  BorealError,
  assertPathInside,
  assertRealPathInside,
  canonicalJson,
  hashContent,
  nowIso,
  readJsonFile
} from "@boreal/core";
import {
  writeTextFileAtomic,
  type BorealReader,
  type BorealStore,
  type BorealWriter,
  type StoreSnapshot
} from "@boreal/storage";

import type { CliContext } from "./context.js";

export interface ExportDocument {
  readonly schemaVersion: "boreal.export.v1";
  readonly exportedAt: string;
  readonly workspaceRoot: string;
  readonly contentHash: string;
  readonly recordCounts: Record<SnapshotSection, number>;
  readonly state: Required<StoreSnapshot>;
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

async function readSnapshot(reader: BorealReader): Promise<Required<StoreSnapshot>> {
  return {
    workItems: await reader.listWorkItems(),
    evidence: await reader.listEvidence(),
    verifications: await reader.listVerifications(),
    knowledgeSources: await reader.listKnowledgeSources(),
    claims: await reader.listClaims(),
    decisions: await reader.listDecisions(),
    graphEdges: await reader.listGraphEdges(),
    reservations: await reader.listReservations(),
    events: await reader.listEvents(),
    projections: await reader.listProjections(),
    contextPacks: await reader.listContextPacks()
  };
}

async function importSnapshot(store: BorealStore, incoming: Required<StoreSnapshot>): Promise<ImportResult> {
  validateSnapshot(incoming);
  return store.write(async (writer) => {
    const current = await readSnapshot(writer);
    const merged = mergeSnapshot(current, incoming);
    validateSnapshot(merged.state);
    await writeImportedRecords(writer, incoming, merged.importableIds);
    return { imported: merged.imported, skipped: merged.skipped };
  });
}

function parseImportSnapshot(value: unknown): Required<StoreSnapshot> {
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

function normalizeSnapshot(value: unknown): Required<StoreSnapshot> {
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
      return [section, sectionValue];
    })
  ) as unknown as Required<StoreSnapshot>;
  return snapshot;
}

function validateSnapshot(snapshot: Required<StoreSnapshot>): void {
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
  current: Required<StoreSnapshot>,
  incoming: Required<StoreSnapshot>
): {
  readonly state: Required<StoreSnapshot>;
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
  incoming: Required<StoreSnapshot>,
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
      content: frontmatter("work", record.meta.id) + `# ${record.title}\n\nStatus: ${record.status}\nPriority: ${record.priority}\nKind: ${record.kind}\n\n${record.description}\n`
    })),
    ...document.state.evidence.map((record) => ({
      path: `evidence/${record.meta.id}.md`,
      content: frontmatter("evidence", record.meta.id) + `# ${record.summary}\n\nOutcome: ${record.outcome}\nKind: ${record.kind}\nSubject: ${record.subjectType}:${record.subjectId}\n\n${record.command ? `Command: \`${record.command}\`\n` : ""}${record.uri ? `URI: ${record.uri}\n` : ""}`
    })),
    ...document.state.knowledgeSources.map((record) => ({
      path: `sources/${record.meta.id}.md`,
      content: frontmatter("source", record.meta.id) + `# ${record.title}\n\nKind: ${record.kind}\nURI: ${record.uri}\n\n${record.summary}\n`
    })),
    ...document.state.claims.map((record) => ({
      path: `claims/${record.meta.id}.md`,
      content: frontmatter("claim", record.meta.id) + `# Claim\n\nStatus: ${record.status}\n\n${record.statement}\n\nSources: ${record.sourceIds.join(", ")}\nEvidence: ${record.evidenceIds.join(", ")}\n`
    })),
    ...document.state.decisions.map((record) => ({
      path: `decisions/${record.meta.id}.md`,
      content: frontmatter("decision", record.meta.id) + `# ${record.title}\n\nStatus: ${record.status}\n\n## Context\n\n${record.context}\n\n## Decision\n\n${record.decision}\n\n## Consequences\n\n${record.consequences.map((item) => `- ${item}`).join("\n")}\n`
    })),
    ...document.state.contextPacks.map((record) => ({
      path: `context/${record.subjectId}.md`,
      content: frontmatter("context-pack", record.id) + `# ${record.title}\n\n${record.summary}\n\n## Facts\n\n${record.facts.map((fact) => `- ${fact}`).join("\n")}\n\n## Evidence\n\n${record.evidence.map((entry) => `- ${entry}`).join("\n")}\n`
    }))
  ];
}

function frontmatter(kind: string, id: string): string {
  return `---\nkind: ${kind}\nid: ${id}\n---\n\n`;
}

function recordCounts(state: Required<StoreSnapshot>): Record<SnapshotSection, number> {
  return Object.fromEntries(SNAPSHOT_SECTIONS.map((section) => [section, state[section].length])) as Record<
    SnapshotSection,
    number
  >;
}

function emptySectionCounts(): Record<SnapshotSection, number> {
  return Object.fromEntries(SNAPSHOT_SECTIONS.map((section) => [section, 0])) as Record<SnapshotSection, number>;
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
