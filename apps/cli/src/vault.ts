import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";

import { BorealError, hashContent, normalizeLabels, normalizeMachineString, nowIso, randomId, safeParseJson } from "@boreal/core";
import { normalizeFileLockOptions, withFileLock, writeTextFileAtomic } from "@boreal/storage";

import type { CliContext } from "./context.js";

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

export interface RawAddResult {
  readonly added: true;
  readonly indexPath: string;
  readonly record: RawSourceRecord;
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

const REQUIRED_DIRECTORIES = [
  "memory",
  "memory/raw",
  "memory/wiki",
  "memory/work",
  "memory/graph",
  "memory/ledgers",
  "memory/dashboards",
  "memory/.boreal",
  "memory/.boreal/db",
  "memory/.boreal/cache",
  "memory/.boreal/locks",
  "memory/.boreal/tmp",
  "memory/.boreal/results"
] as const;

const REQUIRED_FILES = [
  {
    path: "memory/index.md",
    content: `---\nkind: boreal-vault-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Boreal Memory Vault\n\nThis directory is canonical project memory for Boreal.\n\n`
  },
  {
    path: "memory/wiki/index.md",
    content: `---\nkind: boreal-wiki-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Wiki\n\nStable project knowledge pages live here.\n\n`
  },
  {
    path: "memory/work/index.md",
    content: `---\nkind: boreal-work-index\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Work Memory\n\nDurable work summaries and sprint notes live here.\n\n`
  },
  {
    path: "memory/dashboards/Work Queue.md",
    content: `---\nkind: boreal-dashboard\nschemaVersion: ${VAULT_SCHEMA_VERSION}\n---\n\n# Work Queue\n\nThis page is reserved for generated or curated work queue summaries.\n\n`
  },
  {
    path: "memory/.boreal/README.md",
    content: "# Boreal Local Memory Runtime\n\nGenerated local memory cache, lock, and result files live under this directory. Most subdirectories are ignored by Git.\n"
  },
  {
    path: "memory/raw/index.jsonl",
    content: ""
  },
  {
    path: "memory/graph/relationships.jsonl",
    content: ""
  },
  {
    path: "memory/ledgers/events.jsonl",
    content: ""
  },
  {
    path: "memory/ledgers/deletions.jsonl",
    content: ""
  }
] as const;

export async function initVault(context: CliContext): Promise<VaultInitResult> {
  const before = await inspectVault(context);
  if (before.invalidPaths.length > 0) {
    throw new BorealError("BOREAL_CONFLICT", "Cannot initialize Boreal vault over paths with the wrong type", {
      invalidPaths: before.invalidPaths
    });
  }

  const createdDirectories: string[] = [];
  const existingDirectories: string[] = [];
  for (const relativePath of REQUIRED_DIRECTORIES) {
    const absolutePath = join(context.workspaceRoot, relativePath);
    if (existsSync(absolutePath)) {
      existingDirectories.push(relativePath);
      continue;
    }
    await mkdir(absolutePath, { recursive: true });
    createdDirectories.push(relativePath);
  }

  const createdFiles: string[] = [];
  const existingFiles: string[] = [];
  for (const file of REQUIRED_FILES) {
    const absolutePath = join(context.workspaceRoot, file.path);
    if (existsSync(absolutePath)) {
      existingFiles.push(file.path);
      continue;
    }
    await writeTextFileAtomic(absolutePath, file.content);
    createdFiles.push(file.path);
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
  const indexPath = await appendVaultJsonlRecord(context, "memory/raw/index.jsonl", "raw-index", record);
  return {
    added: true,
    indexPath,
    record
  };
}

export async function createWikiPage(context: CliContext, input: WikiCreateInput): Promise<WikiCreateResult> {
  await requireInitializedVault(context);
  const title = normalizeMachineString(input.title, "wiki title");
  const slug = normalizeWikiSlug(input.slug ?? title);
  const summary = input.summary ? normalizeMachineString(input.summary, "wiki summary") : undefined;
  const sourceRefs = [...new Set((input.sourceRefs ?? []).map((sourceRef) => normalizeMachineString(sourceRef, "source ref")))];
  const tags = normalizeLabels(input.tags ?? []);
  const path = join(context.workspaceRoot, "memory/wiki", `${slug}.md`);
  if (existsSync(path)) {
    throw new BorealError("BOREAL_CONFLICT", "Wiki page already exists", { path: `memory/wiki/${slug}.md`, slug });
  }
  const page = {
    id: randomId("page"),
    slug,
    title,
    path: `memory/wiki/${slug}.md`,
    sourceRefs,
    links: [] as readonly string[],
    claimStatus: undefined
  } satisfies WikiPageRecord;
  await writeTextFileAtomic(path, wikiPageMarkdown({ page, summary, tags }));
  return {
    created: true,
    path,
    page
  };
}

export async function inspectVault(context: CliContext): Promise<VaultStatusResult> {
  const requiredDirectories = await Promise.all(
    REQUIRED_DIRECTORIES.map((relativePath) => pathStatus(context, relativePath, "directory"))
  );
  const requiredFiles = await Promise.all(REQUIRED_FILES.map((file) => pathStatus(context, file.path, "file")));
  const missingDirectories = requiredDirectories.filter((entry) => !entry.exists).map((entry) => entry.path);
  const missingFiles = requiredFiles.filter((entry) => !entry.exists).map((entry) => entry.path);
  const invalidPaths = [...requiredDirectories, ...requiredFiles].filter((entry) => entry.exists && !entry.valid);
  const initialized = missingDirectories.length === 0 && missingFiles.length === 0 && invalidPaths.length === 0;
  const health = initialized ? await inspectVaultHealth(context) : emptyVaultHealth();
  return {
    ok: initialized && health.ok,
    initialized,
    rootDir: join(context.workspaceRoot, "memory"),
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
  await appendVaultJsonlRecord(context, "memory/ledgers/events.jsonl", "ledger-events", record);
  return record;
}

async function appendVaultJsonlRecord(
  context: CliContext,
  relativePath: string,
  lockName: string,
  record: unknown
): Promise<string> {
  const path = join(context.workspaceRoot, relativePath);
  const lockDir = join(context.workspaceRoot, "memory/.boreal/locks", `${lockName}.lock`);
  await withFileLock(lockDir, VAULT_JSONL_LOCK_OPTIONS, async () => {
    const existing = await readTextIfExists(path);
    const prefix = existing && !existing.endsWith("\n") ? `${existing}\n` : existing;
    await writeTextFileAtomic(path, `${prefix}${JSON.stringify(record)}\n`);
  });
  return path;
}

async function pathStatus(
  context: CliContext,
  relativePath: string,
  kind: "directory" | "file"
): Promise<VaultPathStatus> {
  const absolutePath = join(context.workspaceRoot, relativePath);
  try {
    const info = await stat(absolutePath);
    return {
      path: relativePath,
      kind,
      exists: true,
      valid: kind === "directory" ? info.isDirectory() : info.isFile()
    };
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        path: relativePath,
        kind,
        exists: false,
        valid: false
      };
    }
    if (isNodeError(error) && error.code === "ENOTDIR") {
      return {
        path: relativePath,
        kind,
        exists: true,
        valid: false
      };
    }
    throw error;
  }
}

async function requireInitializedVault(context: CliContext): Promise<void> {
  const status = await inspectVault(context);
  if (!status.initialized || status.invalidPaths.length > 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Boreal memory vault is not initialized; run `bwrk vault init`", {
      status
    });
  }
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
  const orphanPages = pages
    .filter((page) => page.slug !== "index")
    .filter((page) => page.claimStatus !== "compacted")
    .filter((page) => !incoming.has(page.slug))
    .map((page) => page.path);
  const staleClaims = pages.filter((page) => page.claimStatus === "stale").map((page) => page.path);
  const missingArchiveRefs = missingArchiveRefsForLedger(context, ledger.records);
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

async function readRawSources(context: CliContext): Promise<{
  readonly records: readonly RawSourceRecord[];
  readonly malformed: readonly VaultMalformedRawRecord[];
}> {
  const indexPath = join(context.workspaceRoot, "memory/raw/index.jsonl");
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
        path: `memory/raw/index.jsonl:${index + 1}`,
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
  const ledgerPath = join(context.workspaceRoot, "memory/ledgers/events.jsonl");
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
        path: `memory/ledgers/events.jsonl:${index + 1}`,
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

function missingArchiveRefsForLedger(
  context: CliContext,
  events: readonly VaultLedgerEvent[]
): readonly VaultMissingArchiveRef[] {
  return events.flatMap((event) => {
    if (event.type !== "compact.applied") {
      return [];
    }
    const archivePath = stringPayloadValue(event.payload, "archivePath");
    if (!archivePath) {
      return [
        {
          eventId: event.id,
          subjectType: event.subjectType,
          subjectId: event.subjectId,
          archivePath: ""
        }
      ];
    }
    if (existsSync(join(context.workspaceRoot, archivePath))) {
      return [];
    }
    return [
      {
        eventId: event.id,
        subjectType: event.subjectType,
        subjectId: event.subjectId,
        archivePath
      }
    ];
  });
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
  const wikiDir = join(context.workspaceRoot, "memory/wiki");
  const entries = await readdir(wikiDir, { withFileTypes: true });
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .sort((left, right) => left.name.localeCompare(right.name))
      .map(async (entry) => readWikiPage(context, entry.name))
  );
}

async function readWikiPage(context: CliContext, fileName: string): Promise<WikiPageRecord> {
  const relativePath = `memory/wiki/${fileName}`;
  const text = await readFile(join(context.workspaceRoot, relativePath), "utf8");
  const frontmatter = parseFrontmatter(text);
  const slug = normalizeWikiSlug(frontmatter.slug ?? basename(fileName, ".md"));
  return {
    id: frontmatter.id ?? "",
    slug,
    title: frontmatter.title ?? titleFromSlug(slug),
    path: relativePath,
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
      return JSON.parse(trimmed) as string;
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
