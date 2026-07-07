import { existsSync } from "node:fs";
import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BorealError,
  assertPathInside,
  assertRealPathInside,
  hashContent,
  normalizeLabels,
  normalizeMachineString,
  nowIso,
  randomId,
  safeParseJson
} from "@boreal/core";
import { normalizeFileLockOptions, withFileLock, writeTextFileAtomic } from "@boreal/storage";

import type { CliContext } from "./context.js";
import { readProjectSetupConfig } from "./project-setup.js";

export const VAULT_SCHEMA_VERSION = "boreal.vault.v1";

export interface VaultPathStatus {
  readonly path: string;
  readonly kind: "directory" | "file";
  readonly exists: boolean;
  readonly valid: boolean;
}

export interface VaultStatusResult {
  readonly ok: boolean;
  readonly initialized: boolean;
  readonly rootDir: string;
  readonly schemaVersion: typeof VAULT_SCHEMA_VERSION;
  readonly health: VaultHealthResult;
  readonly requiredDirectories: readonly VaultPathStatus[];
  readonly requiredFiles: readonly VaultPathStatus[];
  readonly missingDirectories: readonly string[];
  readonly missingFiles: readonly string[];
  readonly invalidPaths: readonly VaultPathStatus[];
}

export interface VaultLayout {
  readonly rootDir: string;
  readonly displayRoot: string;
}

export interface VaultInitResult extends VaultStatusResult {
  readonly createdDirectories: readonly string[];
  readonly existingDirectories: readonly string[];
  readonly createdFiles: readonly string[];
  readonly existingFiles: readonly string[];
}

export interface RawAddInput {
  readonly title: string;
  readonly kind?: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
}

export interface RawSourceRecord {
  readonly schemaVersion: typeof VAULT_SCHEMA_VERSION;
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly addedAt: string;
  readonly actorId: string;
  readonly contentHash: string;
}

export type RawProcessingStatus = "queued" | "linked" | "routed" | "kept_global" | "dropped";

export type RawTriageOutcome = "promoted" | "kept_global" | "dropped";

export interface RawTriageState {
  readonly outcome: RawTriageOutcome;
  readonly eventId: string;
  readonly updatedAt: string;
  readonly provenanceUri?: string;
  readonly targetProjectId?: string;
  readonly targetProjectName?: string;
  readonly targetRecordKind?: string;
  readonly targetRecordId?: string;
  readonly targetRecordUri?: string;
  readonly reason?: string;
}

export interface RawSourceRow {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly tags: readonly string[];
  readonly addedAt: string;
  readonly actorId: string;
  readonly contentHash: string;
  readonly sourceBacked: true;
  readonly immutable: true;
  readonly processingStatus: RawProcessingStatus;
  readonly linkedPageCount: number;
  readonly triage?: RawTriageState;
  readonly retrievalCommand: string;
  readonly previewCommand: string;
}

export type RawPreviewStatus =
  | "available"
  | "empty"
  | "external"
  | "missing"
  | "outside_workspace"
  | "truncated"
  | "unsupported";

export type RawPreviewMediaType = "binary" | "directory" | "external" | "missing" | "none" | "text";

export interface RawSourcePreviewResult {
  readonly status: RawPreviewStatus;
  readonly mediaType: RawPreviewMediaType;
  readonly message: string;
  readonly uri?: string;
  readonly path?: string;
  readonly body?: string;
  readonly bytes?: number;
  readonly totalBytes?: number;
  readonly maxBytes: number;
  readonly truncated: boolean;
}

export interface RawSourceDetail extends RawSourceRow {
  readonly linkedPages: readonly WikiPageRecord[];
  readonly preview: RawSourcePreviewResult;
}

export interface RawAddResult {
  readonly added: true;
  readonly indexPath: string;
  readonly record: RawSourceRecord;
}

export interface RawTriageEventInput {
  readonly rawSourceId: string;
  readonly outcome: RawTriageOutcome;
  readonly provenanceUri?: string;
  readonly targetProjectId?: string;
  readonly targetProjectName?: string;
  readonly targetRecordKind?: string;
  readonly targetRecordId?: string;
  readonly targetRecordUri?: string;
  readonly reason?: string;
}

export interface WikiCreateInput {
  readonly title: string;
  readonly slug?: string;
  readonly summary?: string;
  readonly sourceRefs?: readonly string[];
  readonly tags?: readonly string[];
}

export interface WikiPageRecord {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly sourceRefs: readonly string[];
  readonly links: readonly string[];
  readonly claimStatus?: string;
  readonly compactionPlan?: string;
  readonly compactionArchive?: string;
}

export interface WikiCreateResult {
  readonly created: true;
  readonly path: string;
  readonly page: WikiPageRecord;
}

export interface VaultHealthResult {
  readonly ok: boolean;
  readonly hasWarnings: boolean;
  readonly rawSourceCount: number;
  readonly wikiPageCount: number;
  readonly ledgerEventCount: number;
  readonly brokenLinks: readonly VaultBrokenLink[];
  readonly orphanPages: readonly string[];
  readonly missingSourceRefs: readonly VaultMissingSourceRef[];
  readonly staleClaims: readonly string[];
  readonly malformedRawRecords: readonly VaultMalformedRawRecord[];
  readonly malformedLedgerEvents: readonly VaultMalformedLedgerEvent[];
  readonly missingArchiveRefs: readonly VaultMissingArchiveRef[];
  readonly missingMergeRefs: readonly VaultMissingMergeRef[];
}

export interface VaultBrokenLink {
  readonly page: string;
  readonly target: string;
}

export interface VaultMissingSourceRef {
  readonly page: string;
  readonly sourceRef: string;
}

export interface VaultMalformedRawRecord {
  readonly line: number;
  readonly error: string;
}

export interface VaultMalformedLedgerEvent {
  readonly line: number;
  readonly error: string;
}

export interface VaultMissingArchiveRef {
  readonly eventId: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly archivePath: string;
}

export interface VaultMissingMergeRef {
  readonly eventId: string;
  readonly subjectType: string;
  readonly missingIds: readonly string[];
}

export interface VaultLedgerEventInput {
  readonly type: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly payload: Record<string, unknown>;
}

export interface VaultLedgerEvent {
  readonly schemaVersion: typeof VAULT_SCHEMA_VERSION;
  readonly id: string;
  readonly type: string;
  readonly subjectType: string;
  readonly subjectId: string;
  readonly createdAt: string;
  readonly actorId: string;
  readonly payload: Record<string, unknown>;
  readonly contentHash: string;
}

const VAULT_JSONL_LOCK_OPTIONS = normalizeFileLockOptions();
const DEFAULT_RAW_PREVIEW_BYTES = 4_096;

const REQUIRED_DIRECTORIES = [
  ".",
  "raw",
  "wiki",
  "work",
  "graph",
  "ledgers",
  "dashboards",
  ".boreal",
  ".boreal/db",
  ".boreal/cache",
  ".boreal/locks",
  ".boreal/tmp",
  ".boreal/results"
] as const;

const REQUIRED_FILES = [
  {
    path: "index.md",
    content: `---\nkind: boreal-vault-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Boreal Memory Vault\n\nThis directory is canonical project memory for Boreal.\n\n`
  },
  {
    path: "wiki/index.md",
    content: `---\nkind: boreal-wiki-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Wiki\n\nStable project knowledge pages live here.\n\n`
  },
  {
    path: "work/index.md",
    content: `---\nkind: boreal-work-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Work Memory\n\nDurable work summaries and sprint notes live here.\n\n`
  },
  {
    path: "dashboards/Work Queue.md",
    content: `---\nkind: boreal-dashboard\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Work Queue\n\nThis page is reserved for generated or curated work queue summaries.\n\n`
  },
  {
    path: ".boreal/README.md",
    content: "# Boreal Local Memory Runtime\n\nGenerated local memory cache, lock, and result files live under this directory. Most subdirectories are ignored by Git.\n"
  },
  {
    path: "raw/index.jsonl",
    content: ""
  },
  {
    path: "graph/relationships.jsonl",
    content: ""
  },
  {
    path: "ledgers/events.jsonl",
    content: ""
  },
  {
    path: "ledgers/deletions.jsonl",
    content: ""
  }
] as const;

export async function initVault(context: CliContext): Promise<VaultInitResult> {
  const layout = await resolveVaultLayout(context);
  const before = await inspectVault(context);
  if (before.invalidPaths.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot initialize Boreal vault over paths with the wrong type", {
      invalidPaths: before.invalidPaths
    });
  }

  const createdDirectories: string[] = [];
  const existingDirectories: string[] = [];
  for (const relativePath of REQUIRED_DIRECTORIES) {
    const absolutePath = vaultPath(layout, relativePath);
    const displayPath = vaultDisplayPath(layout, relativePath);
    if (existsSync(absolutePath)) {
      existingDirectories.push(displayPath);
      continue;
    }
    await mkdir(absolutePath, { recursive: true });
    createdDirectories.push(displayPath);
  }

  const createdFiles: string[] = [];
  const existingFiles: string[] = [];
  for (const file of REQUIRED_FILES) {
    const absolutePath = vaultPath(layout, file.path);
    const displayPath = vaultDisplayPath(layout, file.path);
    if (existsSync(absolutePath)) {
      existingFiles.push(displayPath);
      continue;
    }
    await writeTextFileAtomic(absolutePath, file.content);
    createdFiles.push(displayPath);
  }

  return {
    ...(await inspectVault(context)),
    createdDirectories,
    existingDirectories,
    createdFiles,
    existingFiles
  };
}

export async function addRawSource(context: CliContext, input: RawAddInput): Promise<RawAddResult> {
  await requireInitializedVault(context);
  const title = normalizeMachineString(input.title, "raw source title");
  const kind = normalizeRawKind(input.kind);
  const uri = input.uri ? normalizeMachineString(input.uri, "raw source uri") : undefined;
  const summary = input.summary ? normalizeMachineString(input.summary, "raw source summary") : undefined;
  const tags = normalizeLabels(input.tags ?? []);
  const baseRecord = {
    schemaVersion: VAULT_SCHEMA_VERSION,
    id: randomId("source"),
    title,
    kind,
    uri,
    summary,
    tags,
    addedAt: nowIso(),
    actorId: String(context.actor.id)
  } as const;
  const record: RawSourceRecord = {
    ...baseRecord,
    contentHash: hashContent(baseRecord)
  };
  const indexPath = await appendVaultJsonlRecord(context, "raw/index.jsonl", "raw-index", record);
  return {
    added: true,
    indexPath,
    record
  };
}

export async function createWikiPage(context: CliContext, input: WikiCreateInput): Promise<WikiCreateResult> {
  const layout = await requireInitializedVault(context);
  const title = normalizeMachineString(input.title, "wiki title");
  const slug = normalizeWikiSlug(input.slug ?? title);
  const summary = input.summary ? normalizeMachineString(input.summary, "wiki summary") : undefined;
  const sourceRefs = [...new Set((input.sourceRefs ?? []).map((sourceRef) => normalizeMachineString(sourceRef, "source ref")))];
  const tags = normalizeLabels(input.tags ?? []);
  const vaultRelativePath = `wiki/${slug}.md`;
  const path = vaultPath(layout, vaultRelativePath);
  const displayPath = vaultDisplayPath(layout, vaultRelativePath);
  const page = {
    id: randomId("page"),
    slug,
    title,
    path: displayPath,
    sourceRefs,
    links: [] as readonly string[],
    claimStatus: undefined
  } satisfies WikiPageRecord;
  await withFileLock(vaultPath(layout, ".boreal/locks", "wiki-pages.lock"), VAULT_JSONL_LOCK_OPTIONS, async () => {
    if (existsSync(path)) {
      throw new BorealError("BOREAL_CONFLICT", "Wiki page already exists", { path: displayPath, slug });
    }
    await writeTextFileAtomic(path, wikiPageMarkdown({ page, summary, tags }));
  });
  return {
    created: true,
    path,
    page
  };
}

export async function inspectVault(context: CliContext): Promise<VaultStatusResult> {
  const layout = await resolveVaultLayout(context);
  const requiredDirectories = await Promise.all(
    REQUIRED_DIRECTORIES.map((relativePath) => pathStatus(layout, relativePath, "directory"))
  );
  const requiredFiles = await Promise.all(REQUIRED_FILES.map((file) => pathStatus(layout, file.path, "file")));
  const missingDirectories = requiredDirectories.filter((entry) => !entry.exists).map((entry) => entry.path);
  const missingFiles = requiredFiles.filter((entry) => !entry.exists).map((entry) => entry.path);
  const invalidPaths = [...requiredDirectories, ...requiredFiles].filter((entry) => entry.exists && !entry.valid);
  const initialized = missingDirectories.length === 0 && missingFiles.length === 0 && invalidPaths.length === 0;
  const health = initialized ? await inspectVaultHealth(context) : emptyVaultHealth();
  return {
    ok: initialized && health.ok,
    initialized,
    rootDir: layout.rootDir,
    schemaVersion: VAULT_SCHEMA_VERSION,
    health,
    requiredDirectories,
    requiredFiles,
    missingDirectories,
    missingFiles,
    invalidPaths
  };
}

export async function listVaultRawSources(context: CliContext): Promise<readonly RawSourceRecord[]> {
  return (await readRawSources(context)).records;
}

export async function listRawSourceRows(
  context: CliContext,
  options: { readonly limit?: number } = {}
): Promise<readonly RawSourceRow[]> {
  await requireInitializedVault(context);
  const [rawSources, wikiPages, ledgerEvents] = await Promise.all([
    listVaultRawSources(context),
    listVaultWikiPages(context),
    listVaultLedgerEvents(context)
  ]);
  const linkedPageCounts = rawLinkedPageCounts(rawSources, wikiPages);
  const triageByRawSource = rawTriageStateBySource(ledgerEvents);
  return rawSources
    .slice(0, options.limit ?? rawSources.length)
    .map((record) => rawSourceRow(record, linkedPageCounts.get(record.id) ?? 0, triageByRawSource.get(record.id)));
}

export async function getRawSourceDetail(
  context: CliContext,
  sourceId: string,
  options: { readonly previewBytes?: number } = {}
): Promise<RawSourceDetail> {
  await requireInitializedVault(context);
  const [rawSources, wikiPages, ledgerEvents] = await Promise.all([
    listVaultRawSources(context),
    listVaultWikiPages(context),
    listVaultLedgerEvents(context)
  ]);
  const record = rawSources.find((source) => source.id === sourceId);
  if (!record) {
    throw new BorealError("BOREAL_NOT_FOUND", "Raw source not found", { sourceId, domain: "evidence" });
  }
  const linkedPages = wikiPages.filter((page) => page.sourceRefs.includes(record.id));
  const triage = rawTriageStateBySource(ledgerEvents).get(record.id);
  return {
    ...rawSourceRow(record, linkedPages.length, triage),
    linkedPages,
    preview: await previewRawSource(context, record, options.previewBytes ?? DEFAULT_RAW_PREVIEW_BYTES)
  };
}

export async function listVaultWikiPages(context: CliContext): Promise<readonly WikiPageRecord[]> {
  return readWikiPages(context);
}

export async function listVaultLedgerEvents(context: CliContext): Promise<readonly VaultLedgerEvent[]> {
  return (await readVaultLedgerEvents(context)).records;
}

export async function appendVaultLedgerEvent(context: CliContext, input: VaultLedgerEventInput): Promise<VaultLedgerEvent> {
  await requireInitializedVault(context);
  const type = normalizeMachineString(input.type, "vault event type", { lowerCase: true });
  const subjectType = normalizeMachineString(input.subjectType, "vault event subject type", { lowerCase: true });
  const subjectId = normalizeMachineString(input.subjectId, "vault event subject id");
  const baseRecord = {
    schemaVersion: VAULT_SCHEMA_VERSION,
    id: randomId("event"),
    type,
    subjectType,
    subjectId,
    createdAt: nowIso(),
    actorId: String(context.actor.id),
    payload: input.payload
  } as const;
  const record: VaultLedgerEvent = {
    ...baseRecord,
    contentHash: hashContent(baseRecord)
  };
  await appendVaultJsonlRecord(context, "ledgers/events.jsonl", "ledger-events", record);
  return record;
}

export async function appendRawTriageEvent(context: CliContext, input: RawTriageEventInput): Promise<VaultLedgerEvent> {
  return appendVaultLedgerEvent(context, {
    type: "raw.triaged",
    subjectType: "raw",
    subjectId: input.rawSourceId,
    payload: {
      outcome: input.outcome,
      provenanceUri: input.provenanceUri,
      targetProjectId: input.targetProjectId,
      targetProjectName: input.targetProjectName,
      targetRecordKind: input.targetRecordKind,
      targetRecordId: input.targetRecordId,
      targetRecordUri: input.targetRecordUri,
      reason: input.reason
    }
  });
}

export function rawSourceProvenanceUri(sourceId: string): string {
  return `boreal://global/${normalizeMachineString(sourceId, "raw source id")}`;
}

export async function resolveVaultLayout(context: CliContext): Promise<VaultLayout> {
  const config = await readProjectSetupConfig(context.workspaceRoot);
  const rootDir = resolve(config?.memoryRoot ?? join(context.workspaceRoot, "memory"));
  return {
    rootDir,
    displayRoot: vaultDisplayRoot(context.workspaceRoot, rootDir)
  };
}

export function vaultPath(layout: VaultLayout, ...parts: readonly string[]): string {
  return resolve(layout.rootDir, ...parts);
}

export function vaultDisplayPath(layout: VaultLayout, relativePath: string): string {
  return relativePath === "." ? layout.displayRoot : join(layout.displayRoot, relativePath);
}

export async function resolveVaultDisplayPath(context: CliContext, path: string): Promise<string> {
  if (isAbsolute(path)) {
    return resolve(path);
  }
  const layout = await resolveVaultLayout(context);
  if (path === layout.displayRoot) {
    return layout.rootDir;
  }
  if (path.startsWith(`${layout.displayRoot}/`)) {
    return vaultPath(layout, path.slice(layout.displayRoot.length + 1));
  }
  return resolve(context.workspaceRoot, path);
}

async function appendVaultJsonlRecord(
  context: CliContext,
  relativePath: string,
  lockName: string,
  record: unknown
): Promise<string> {
  const layout = await resolveVaultLayout(context);
  const path = vaultPath(layout, relativePath);
  const lockDir = vaultPath(layout, ".boreal/locks", `${lockName}.lock`);
  await withFileLock(lockDir, VAULT_JSONL_LOCK_OPTIONS, async () => {
    const existing = await readTextIfExists(path);
    const prefix = existing && !existing.endsWith("\n") ? `${existing}\n` : existing;
    await writeTextFileAtomic(path, `${prefix}${JSON.stringify(record)}\n`);
  });
  return path;
}

async function pathStatus(
  layout: VaultLayout,
  relativePath: string,
  kind: "directory" | "file"
): Promise<VaultPathStatus> {
  const absolutePath = vaultPath(layout, relativePath);
  const displayPath = vaultDisplayPath(layout, relativePath);
  try {
    const info = await stat(absolutePath);
    return {
      path: displayPath,
      kind,
      exists: true,
      valid: kind === "directory" ? info.isDirectory() : info.isFile()
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        path: displayPath,
        kind,
        exists: false,
        valid: false
      };
    }
    if (isNodeError(error) && error.code === "ENOTDIR") {
      return {
        path: displayPath,
        kind,
        exists: true,
        valid: false
      };
    }
    throw error;
  }
}

async function requireInitializedVault(context: CliContext): Promise<VaultLayout> {
  const status = await inspectVault(context);
  if (!status.initialized || status.invalidPaths.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Boreal memory vault is not initialized; run `bwrk vault init`", {
      status
    });
  }
  return resolveVaultLayout(context);
}

async function inspectVaultHealth(context: CliContext): Promise<VaultHealthResult> {
  const raw = await readRawSources(context);
  const ledger = await readVaultLedgerEvents(context);
  const pages = await readWikiPages(context);
  const pageSlugs = new Set(pages.map((page) => page.slug));
  const incoming = new Set<string>();
  const brokenLinks = pages.flatMap((page) =>
    page.links.flatMap((target) => {
      const slug = normalizeWikiSlug(target);
      if (pageSlugs.has(slug)) {
        incoming.add(slug);
        return [];
      }
      return [{ page: page.path, target }] satisfies VaultBrokenLink[];
    })
  );
  const rawSourceIds = new Set(raw.records.map((record) => record.id));
  const missingSourceRefs = pages.flatMap((page) =>
    page.sourceRefs
      .filter((sourceRef) => !rawSourceIds.has(sourceRef))
      .map((sourceRef) => ({ page: page.path, sourceRef }))
  );
  const hasValidSourceRef = (page: WikiPageRecord): boolean =>
    page.sourceRefs.length > 0 && page.sourceRefs.every((sourceRef) => rawSourceIds.has(sourceRef));
  const orphanPages = pages
    .filter((page) => page.slug !== "index")
    .filter((page) => page.claimStatus !== "compacted")
    .filter((page) => !hasValidSourceRef(page))
    .filter((page) => !incoming.has(page.slug))
    .map((page) => page.path);
  const staleClaims = pages.filter((page) => page.claimStatus === "stale").map((page) => page.path);
  const missingArchiveRefs = await missingArchiveRefsForLedger(context, ledger.records);
  const missingMergeRefs = missingMergeRefsForLedger(ledger.records, raw.records, pages);
  return {
    ok:
      brokenLinks.length === 0 &&
      missingSourceRefs.length === 0 &&
      raw.malformed.length === 0 &&
      ledger.malformed.length === 0 &&
      missingArchiveRefs.length === 0 &&
      missingMergeRefs.length === 0,
    hasWarnings: orphanPages.length > 0 || staleClaims.length > 0,
    rawSourceCount: raw.records.length,
    wikiPageCount: pages.filter((page) => page.slug !== "index").length,
    ledgerEventCount: ledger.records.length,
    brokenLinks,
    orphanPages,
    missingSourceRefs,
    staleClaims,
    malformedRawRecords: raw.malformed,
    malformedLedgerEvents: ledger.malformed,
    missingArchiveRefs,
    missingMergeRefs
  };
}

function rawLinkedPageCounts(
  rawSources: readonly RawSourceRecord[],
  wikiPages: readonly WikiPageRecord[]
): ReadonlyMap<string, number> {
  const knownRawIds = new Set(rawSources.map((record) => record.id));
  const counts = new Map<string, number>();
  for (const page of wikiPages) {
    for (const sourceRef of page.sourceRefs) {
      if (knownRawIds.has(sourceRef)) {
        counts.set(sourceRef, (counts.get(sourceRef) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function rawSourceRow(record: RawSourceRecord, linkedPageCount: number, triage?: RawTriageState): RawSourceRow {
  return {
    id: record.id,
    title: record.title,
    kind: record.kind,
    uri: record.uri,
    summary: record.summary,
    tags: record.tags,
    addedAt: record.addedAt,
    actorId: record.actorId,
    contentHash: record.contentHash,
    sourceBacked: true,
    immutable: true,
    processingStatus: rawProcessingStatus(linkedPageCount, triage),
    linkedPageCount,
    triage,
    retrievalCommand: `bwrk raw show ${record.id} --json`,
    previewCommand: `bwrk raw show ${record.id} --preview-bytes ${DEFAULT_RAW_PREVIEW_BYTES} --json`
  };
}

function rawProcessingStatus(linkedPageCount: number, triage: RawTriageState | undefined): RawProcessingStatus {
  if (!triage) {
    return linkedPageCount > 0 ? "linked" : "queued";
  }
  switch (triage.outcome) {
    case "promoted":
      return "routed";
    case "kept_global":
      return "kept_global";
    case "dropped":
      return "dropped";
  }
}

function rawTriageStateBySource(events: readonly VaultLedgerEvent[]): ReadonlyMap<string, RawTriageState> {
  const states = new Map<string, RawTriageState>();
  for (const event of events) {
    if (event.type !== "raw.triaged" || event.subjectType !== "raw") {
      continue;
    }
    const outcome = rawTriageOutcome(event.payload.outcome);
    if (!outcome) {
      continue;
    }
    states.set(event.subjectId, {
      outcome,
      eventId: event.id,
      updatedAt: event.createdAt,
      provenanceUri: stringPayloadValue(event.payload, "provenanceUri"),
      targetProjectId: stringPayloadValue(event.payload, "targetProjectId"),
      targetProjectName: stringPayloadValue(event.payload, "targetProjectName"),
      targetRecordKind: stringPayloadValue(event.payload, "targetRecordKind"),
      targetRecordId: stringPayloadValue(event.payload, "targetRecordId"),
      targetRecordUri: stringPayloadValue(event.payload, "targetRecordUri"),
      reason: stringPayloadValue(event.payload, "reason")
    });
  }
  return states;
}

function rawTriageOutcome(value: unknown): RawTriageOutcome | undefined {
  return value === "promoted" || value === "kept_global" || value === "dropped" ? value : undefined;
}

async function previewRawSource(
  context: CliContext,
  record: RawSourceRecord,
  maxBytes: number
): Promise<RawSourcePreviewResult> {
  const limit = Math.max(1, maxBytes);
  if (!record.uri) {
    return rawPreview({
      status: "unsupported",
      mediaType: "none",
      message: "Raw source has no local URI to preview.",
      maxBytes: limit,
      uri: record.uri
    });
  }
  const local = rawUriToLocalPath(context, record.uri);
  if (local.kind !== "local") {
    return rawPreview({
      status: local.status,
      mediaType: local.mediaType,
      message: local.message,
      maxBytes: limit,
      uri: record.uri
    });
  }
  const layout = await resolveVaultLayout(context);
  if (!(await rawPreviewPathAllowed(context, layout, local.path))) {
    return rawPreview({
      status: "outside_workspace",
      mediaType: "none",
      message: "Local preview path is outside the workspace and configured memory root.",
      maxBytes: limit,
      uri: record.uri,
      path: local.path
    });
  }

  let info: Awaited<ReturnType<typeof stat>>;
  try {
    info = await stat(local.path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return rawPreview({
        status: "missing",
        mediaType: "missing",
        message: "Local preview file is missing.",
        maxBytes: limit,
        uri: record.uri,
        path: local.path
      });
    }
    throw error;
  }

  if (info.isDirectory()) {
    return rawPreview({
      status: "unsupported",
      mediaType: "directory",
      message: "Directories are not previewed.",
      maxBytes: limit,
      uri: record.uri,
      path: local.path,
      totalBytes: info.size
    });
  }
  if (!info.isFile()) {
    return rawPreview({
      status: "unsupported",
      mediaType: "binary",
      message: "Only regular text files can be previewed.",
      maxBytes: limit,
      uri: record.uri,
      path: local.path,
      totalBytes: info.size
    });
  }

  const bytesToRead = Math.min(info.size, limit);
  const buffer = await readFilePrefix(local.path, bytesToRead);
  if (looksBinary(buffer)) {
    return rawPreview({
      status: "unsupported",
      mediaType: "binary",
      message: "Binary or non-UTF-8 assets are listed but not rendered inline.",
      maxBytes: limit,
      uri: record.uri,
      path: local.path,
      bytes: buffer.length,
      totalBytes: info.size
    });
  }
  const body = buffer.toString("utf8");
  if (body.length === 0) {
    return rawPreview({
      status: "empty",
      mediaType: "text",
      message: "Local preview file is empty.",
      maxBytes: limit,
      uri: record.uri,
      path: local.path,
      bytes: 0,
      totalBytes: info.size
    });
  }
  const truncated = info.size > buffer.length;
  return rawPreview({
    status: truncated ? "truncated" : "available",
    mediaType: "text",
    message: truncated ? `Preview truncated to ${buffer.length} of ${info.size} bytes.` : "Text preview available.",
    maxBytes: limit,
    uri: record.uri,
    path: local.path,
    body,
    bytes: buffer.length,
    totalBytes: info.size
  });
}

function rawPreview(input: Omit<RawSourcePreviewResult, "truncated">): RawSourcePreviewResult {
  return {
    ...input,
    truncated: input.status === "truncated"
  };
}

type RawUriResolution =
  | { readonly kind: "local"; readonly path: string }
  | {
      readonly kind: "nonLocal";
      readonly status: "external" | "unsupported";
      readonly mediaType: "external" | "none";
      readonly message: string;
    };

function rawUriToLocalPath(context: CliContext, uri: string): RawUriResolution {
  const trimmed = uri.trim();
  if (!trimmed) {
    return {
      kind: "nonLocal",
      status: "unsupported",
      mediaType: "none",
      message: "Raw source URI is empty."
    };
  }
  if (trimmed.startsWith("file://")) {
    try {
      const url = new URL(trimmed);
      if (url.hostname && url.hostname !== "localhost" && url.pathname !== "/" && url.pathname !== "") {
        return {
          kind: "nonLocal",
          status: "unsupported",
          mediaType: "none",
          message: "File URIs with remote hosts are not previewed."
        };
      }
      if (url.hostname && url.hostname !== "localhost" && (url.pathname === "/" || url.pathname === "")) {
        return { kind: "local", path: resolve(context.workspaceRoot, url.hostname) };
      }
      return { kind: "local", path: fileURLToPath(url) };
    } catch {
      return { kind: "local", path: resolve(context.workspaceRoot, trimmed.slice("file://".length)) };
    }
  }
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(trimmed)) {
    return {
      kind: "nonLocal",
      status: "external",
      mediaType: "external",
      message: "External URIs are not fetched by local preview."
    };
  }
  return { kind: "local", path: resolve(context.workspaceRoot, trimmed) };
}

async function rawPreviewPathAllowed(context: CliContext, layout: VaultLayout, path: string): Promise<boolean> {
  const roots = [...new Set([resolve(context.workspaceRoot), resolve(layout.rootDir)])];
  for (const root of roots) {
    try {
      assertPathInside(root, path);
      await assertRealPathInside(root, path);
      return true;
    } catch (error) {
      if (!(error instanceof BorealError) || error.code !== "BOREAL_INVALID_INPUT") {
        throw error;
      }
    }
  }
  return false;
}

async function readFilePrefix(path: string, bytesToRead: number): Promise<Buffer> {
  if (bytesToRead <= 0) {
    return Buffer.alloc(0);
  }
  const handle = await open(path, "r");
  try {
    const buffer = Buffer.alloc(bytesToRead);
    const { bytesRead } = await handle.read(buffer, 0, bytesToRead, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

function looksBinary(buffer: Buffer): boolean {
  if (buffer.includes(0)) {
    return true;
  }
  return buffer.toString("utf8").includes("\uFFFD");
}

async function readRawSources(context: CliContext): Promise<{
  readonly records: readonly RawSourceRecord[];
  readonly malformed: readonly VaultMalformedRawRecord[];
}> {
  const layout = await resolveVaultLayout(context);
  const indexPath = vaultPath(layout, "raw/index.jsonl");
  const displayPath = vaultDisplayPath(layout, "raw/index.jsonl");
  const text = await readTextIfExists(indexPath);
  const records: RawSourceRecord[] = [];
  const malformed: VaultMalformedRawRecord[] = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) {
      return;
    }
    try {
      const parsed = safeParseJson(line, {
        schemaName: VAULT_SCHEMA_VERSION,
        path: `${displayPath}:${index + 1}`,
        expectedObject: true
      });
      if (isRawSourceRecord(parsed)) {
        records.push(parsed);
      } else {
        malformed.push({ line: index + 1, error: "Raw source record has an unsupported shape" });
      }
    } catch (error) {
      malformed.push({ line: index + 1, error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { records, malformed };
}

async function readVaultLedgerEvents(context: CliContext): Promise<{
  readonly records: readonly VaultLedgerEvent[];
  readonly malformed: readonly VaultMalformedLedgerEvent[];
}> {
  const layout = await resolveVaultLayout(context);
  const ledgerPath = vaultPath(layout, "ledgers/events.jsonl");
  const displayPath = vaultDisplayPath(layout, "ledgers/events.jsonl");
  const text = await readTextIfExists(ledgerPath);
  const records: VaultLedgerEvent[] = [];
  const malformed: VaultMalformedLedgerEvent[] = [];
  text.split(/\r?\n/u).forEach((line, index) => {
    if (!line.trim()) {
      return;
    }
    try {
      const parsed = safeParseJson(line, {
        schemaName: VAULT_SCHEMA_VERSION,
        path: `${displayPath}:${index + 1}`,
        expectedObject: true
      });
      if (!isVaultLedgerEvent(parsed)) {
        malformed.push({ line: index + 1, error: "Vault ledger event has an unsupported shape" });
        return;
      }
      if (parsed.contentHash !== hashVaultLedgerEvent(parsed)) {
        malformed.push({ line: index + 1, error: "Vault ledger event contentHash does not match its content" });
        return;
      }
      records.push(parsed);
    } catch (error) {
      malformed.push({ line: index + 1, error: error instanceof Error ? error.message : String(error) });
    }
  });
  return { records, malformed };
}

async function missingArchiveRefsForLedger(
  context: CliContext,
  events: readonly VaultLedgerEvent[]
): Promise<readonly VaultMissingArchiveRef[]> {
  const missingRefs: VaultMissingArchiveRef[] = [];
  for (const event of events) {
    if (event.type !== "compact.applied") {
      continue;
    }
    const archivePath = stringPayloadValue(event.payload, "archivePath");
    if (!archivePath) {
      missingRefs.push({
        eventId: event.id,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        archivePath: ""
      });
      continue;
    }
    if (!existsSync(await resolveVaultDisplayPath(context, archivePath))) {
      missingRefs.push({
        eventId: event.id,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        archivePath
      });
    }
  }
  return missingRefs;
}

function missingMergeRefsForLedger(
  events: readonly VaultLedgerEvent[],
  rawSources: readonly RawSourceRecord[],
  pages: readonly WikiPageRecord[]
): readonly VaultMissingMergeRef[] {
  const rawIds = new Set(rawSources.map((record) => record.id));
  const wikiIds = new Set(pages.map((page) => page.id || page.path));
  return events.flatMap((event) => {
    if (event.type !== "merge.applied" || (event.subjectType !== "raw" && event.subjectType !== "wiki")) {
      return [];
    }
    const ids = [event.subjectId, ...stringArrayPayloadValue(event.payload, "duplicateIds")];
    const knownIds = event.subjectType === "raw" ? rawIds : wikiIds;
    const missingIds = ids.filter((id) => !knownIds.has(id));
    return missingIds.length > 0
      ? [
          {
            eventId: event.id,
            subjectType: event.subjectType,
            missingIds
          }
        ]
      : [];
  });
}

async function readWikiPages(context: CliContext): Promise<readonly WikiPageRecord[]> {
  const layout = await resolveVaultLayout(context);
  const wikiDir = vaultPath(layout, "wiki");
  const entries = await readdir(wikiDir, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => readWikiPage(layout, entry.name))
  );
}

async function readWikiPage(layout: VaultLayout, fileName: string): Promise<WikiPageRecord> {
  const relativePath = `wiki/${fileName}`;
  const displayPath = vaultDisplayPath(layout, relativePath);
  const text = await readFile(vaultPath(layout, relativePath), "utf8");
  const frontmatter = parseFrontmatter(text);
  const slug = normalizeWikiSlug(frontmatter.slug ?? basename(fileName, ".md"));
  return {
    id: frontmatter.id ?? "",
    slug,
    title: frontmatter.title ?? titleFromSlug(slug),
    path: displayPath,
    sourceRefs: frontmatter.source_refs ?? [],
    links: extractWikiLinks(text),
    claimStatus: frontmatter.claim_status,
    compactionPlan: frontmatter.compaction_plan,
    compactionArchive: frontmatter.compaction_archive
  };
}

function parseFrontmatter(text: string): {
  readonly id?: string;
  readonly slug?: string;
  readonly title?: string;
  readonly source_refs?: readonly string[];
  readonly claim_status?: string;
  readonly compaction_plan?: string;
  readonly compaction_archive?: string;
} {
  if (!text.startsWith("---\n")) {
    return {};
  }
  const end = text.indexOf("\n---", 4);
  if (end < 0) {
    return {};
  }
  const lines = text.slice(4, end).split(/\r?\n/u);
  const result: {
    id?: string;
    slug?: string;
    title?: string;
    source_refs?: string[];
    claim_status?: string;
    compaction_plan?: string;
    compaction_archive?: string;
  } = {};
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const scalar = /^([A-Za-z0-9_-]+):\s*(.*)$/u.exec(line);
    if (!scalar) {
      continue;
    }
    const [, key, value = ""] = scalar;
    if (key === "source_refs" || key === "tags") {
      const values: string[] = [];
      for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex += 1) {
        const item = /^\s*-\s+(.+)$/u.exec(lines[nextIndex] ?? "");
        if (!item) {
          break;
        }
        values.push(item[1] ?? "");
        index = nextIndex;
      }
      if (key === "source_refs") {
        result.source_refs = values;
      }
      continue;
    }
    if (
      key === "id" ||
      key === "slug" ||
      key === "title" ||
      key === "claim_status" ||
      key === "compaction_plan" ||
      key === "compaction_archive"
    ) {
      result[key] = unquoteYamlScalar(value);
    }
  }
  return result;
}

function extractWikiLinks(text: string): readonly string[] {
  const links: string[] = [];
  const pattern = /\[\[([^\]]+)\]\]/gu;
  for (const match of text.matchAll(pattern)) {
    const rawTarget = (match[1] ?? "").split("|")[0]?.split("#")[0]?.trim();
    if (rawTarget) {
      links.push(rawTarget);
    }
  }
  return links;
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

function normalizeRawKind(value: string | undefined): string {
  const kind = normalizeMachineString(value ?? "raw", "raw source kind", { lowerCase: true });
  if (kind === "raw" || kind === "document" || kind === "chat" || kind === "code" || kind === "artifact") {
    return kind;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--kind must be raw, document, chat, code, or artifact");
}

function normalizeWikiSlug(value: string): string {
  const normalized = normalizeMachineString(value, "wiki slug", { lowerCase: true })
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  if (!normalized) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Wiki slug cannot be empty");
  }
  return normalized;
}

function wikiPageMarkdown(input: {
  readonly page: WikiPageRecord;
  readonly summary?: string;
  readonly tags: readonly string[];
}): string {
  return [
    "---",
    "kind: boreal-wiki-page",
    `schemaVersion: ${VAULT_SCHEMA_VERSION}`,
    `id: ${input.page.id}`,
    `slug: ${input.page.slug}`,
    `title: ${yamlScalar(input.page.title)}`,
    `created_at: ${nowIso()}`,
    `updated_at: ${nowIso()}`,
    "source_refs:",
    ...input.page.sourceRefs.map((sourceRef) => `  - ${sourceRef}`),
    "tags:",
    ...input.tags.map((tag) => `  - ${tag}`),
    "---",
    "",
    `# ${input.page.title}`,
    "",
    input.summary ?? "",
    ""
  ].join("\n");
}

function emptyVaultHealth(): VaultHealthResult {
  return {
    ok: false,
    hasWarnings: false,
    rawSourceCount: 0,
    wikiPageCount: 0,
    ledgerEventCount: 0,
    brokenLinks: [],
    orphanPages: [],
    missingSourceRefs: [],
    staleClaims: [],
    malformedRawRecords: [],
    malformedLedgerEvents: [],
    missingArchiveRefs: [],
    missingMergeRefs: []
  };
}

function isRawSourceRecord(value: unknown): value is RawSourceRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as { schemaVersion?: unknown }).schemaVersion === VAULT_SCHEMA_VERSION &&
    typeof (value as { id?: unknown }).id === "string" &&
    typeof (value as { title?: unknown }).title === "string" &&
    typeof (value as { kind?: unknown }).kind === "string" &&
    Array.isArray((value as { tags?: unknown }).tags) &&
    typeof (value as { addedAt?: unknown }).addedAt === "string" &&
    typeof (value as { actorId?: unknown }).actorId === "string" &&
    typeof (value as { contentHash?: unknown }).contentHash === "string"
  );
}

function isVaultLedgerEvent(value: unknown): value is VaultLedgerEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as {
    schemaVersion?: unknown;
    id?: unknown;
    type?: unknown;
    subjectType?: unknown;
    subjectId?: unknown;
    createdAt?: unknown;
    actorId?: unknown;
    payload?: unknown;
    contentHash?: unknown;
  };
  return (
    record.schemaVersion === VAULT_SCHEMA_VERSION &&
    typeof record.id === "string" &&
    record.id.startsWith("bw_event_") &&
    typeof record.type === "string" &&
    typeof record.subjectType === "string" &&
    typeof record.subjectId === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.actorId === "string" &&
    typeof record.payload === "object" &&
    record.payload !== null &&
    !Array.isArray(record.payload) &&
    typeof record.contentHash === "string"
  );
}

function hashVaultLedgerEvent(record: VaultLedgerEvent): string {
  const { contentHash: _contentHash, ...content } = record;
  return hashContent(content);
}

function stringPayloadValue(payload: Record<string, unknown>, key: string): string | undefined {
  const value = payload[key];
  return typeof value === "string" ? value : undefined;
}

function stringArrayPayloadValue(payload: Record<string, unknown>, key: string): readonly string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toLocaleUpperCase("en-US")}${part.slice(1)}`)
    .join(" ");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function unquoteYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = safeParseJson(trimmed, { schemaName: "boreal.vault.frontmatter.scalar" });
      return typeof parsed === "string" ? parsed : trimmed.slice(1, -1);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function vaultDisplayRoot(workspaceRoot: string, rootDir: string): string {
  const relation = relative(workspaceRoot, rootDir);
  if (relation === "") {
    return basename(rootDir);
  }
  if (!relation.startsWith("..") && !isAbsolute(relation)) {
    return relation;
  }
  return rootDir;
}
