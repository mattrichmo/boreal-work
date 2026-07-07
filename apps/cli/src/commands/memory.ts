import { existsSync } from "node:fs";
import { basename } from "node:path";

import {
  BorealError,
  type ClaimRecord,
  type DecisionRecord,
  type KnowledgeSource,
  type KnowledgeSourceKind,
  type ProjectRegistryEntry,
  type SourceRef,
  type WorkItem,
  type WorkKind
} from "@boreal/core";

import { flagValue, flagValues, hasFlag, requiredFlag, type ParsedArgs } from "../args.js";
import { createCliContext, type CliContext } from "../context.js";
import { analyzeCompaction, applyCompaction, type CompactDomain } from "../compact.js";
import { applyManualMerge, buildManualMergePlan, scanDuplicates, type DuplicateDomain } from "../duplicates.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import { listProjectRegistry } from "../registry.js";
import {
  addRawSource,
  appendRawTriageEvent,
  createWikiPage,
  getRawSourceDetail,
  inspectVault,
  listRawSourceRows,
  listVaultRawSources,
  listVaultWikiPages,
  rawSourceProvenanceUri,
  type RawSourceRecord,
  type RawSourceRow,
  type WikiPageRecord
} from "../vault.js";
import type { CommandResult } from "./shared.js";

const DEFAULT_RAW_PREVIEW_BYTES = 4_096;
const MAX_RAW_PREVIEW_BYTES = 65_536;

type MemoryCommandGroup = "raw" | "wiki" | "duplicate" | "merge" | "compact";
type RawTriageAction = "promote" | "keep-global" | "drop";
type RawTriageTargetKind = "work" | "source" | "claim" | "decision";
type RawTriageTargetRecord = WorkItem | KnowledgeSource | ClaimRecord | DecisionRecord;

interface RawTriageTargetProject {
  readonly id: string;
  readonly name: string;
  readonly context: CliContext;
}

interface RawTriageResult {
  readonly schemaVersion: "boreal.cli.raw.triage.v1";
  readonly action: RawTriageAction;
  readonly rawSource: RawSourceRecord;
  readonly provenanceUri: string;
  readonly targetProject?: {
    readonly id: string;
    readonly name: string;
    readonly root: string;
  };
  readonly targetRecord?: RawTriageTargetRecord;
  readonly targetRecordKind?: RawTriageTargetKind;
  readonly targetRecordUri?: string;
  readonly triageEvent: unknown;
}

export interface MemoryCommandDependencies {
  readonly defaultListLimit: number;
  readonly parseLimit: (value: string | undefined) => number | undefined;
  readonly requiredPositional: (values: readonly string[], index: number, label: string) => string;
}

export async function memoryCommand(
  group: MemoryCommandGroup,
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: MemoryCommandDependencies
): Promise<CommandResult> {
  switch (group) {
    case "raw":
      return rawCommand(action, rest, context, args, output, json, dependencies);
    case "wiki":
      return wikiCommand(action, rest, context, args, output, json, dependencies);
    case "duplicate":
      return duplicateCommand(action, context, args, output, json);
    case "merge":
      return mergeCommand(action, context, args, output, json);
    case "compact":
      return compactCommand(action, context, args, output, json);
  }
}

async function rawCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: MemoryCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
      const rows = await listRawSourceRows(context, { limit });
      output.write(json ? formatRecord(rows, true) : table(rows.map(textRawSourceRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const detail = await getRawSourceDetail(context, dependencies.requiredPositional(rest, 0, "raw source id"), {
        previewBytes: parsePreviewBytes(flagValue(args, "preview-bytes"))
      });
      output.write(formatRecord(detail, json));
      return { exitCode: 0 };
    }
    case "add": {
      output.write(
        formatRecord(
          await addRawSource(context, {
            title: requiredFlag(args, "title"),
            kind: flagValue(args, "kind"),
            uri: flagValue(args, "uri"),
            summary: flagValue(args, "summary"),
            tags: flagValues(args, "tag")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    case "triage": {
      output.write(formatRecord(await rawTriageCommand(rest, context, args, dependencies), json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown raw command: ${action ?? ""}`);
  }
}

async function rawTriageCommand(
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  dependencies: MemoryCommandDependencies
): Promise<RawTriageResult> {
  const action = parseRawTriageAction(dependencies.requiredPositional(rest, 0, "triage action"));
  const rawSourceId = dependencies.requiredPositional(rest, 1, "raw source id");
  const rawSource = await requireUntriagedRawSource(context, rawSourceId);
  const provenanceUri = rawSourceProvenanceUri(rawSource.id);

  if (action === "drop") {
    const reason = requiredFlag(args, "reason");
    const triageEvent = await appendRawTriageEvent(context, {
      rawSourceId: rawSource.id,
      outcome: "dropped",
      provenanceUri,
      reason
    });
    return {
      schemaVersion: "boreal.cli.raw.triage.v1",
      action,
      rawSource,
      provenanceUri,
      triageEvent
    };
  }

  const targetKind = parseRawTriageTargetKind(requiredFlag(args, "as"));
  const targetProject = action === "promote"
    ? await resolveRawTriageTargetProject(context, args, requiredFlag(args, "to"))
    : {
        id: "global",
        name: "Global workspace",
        context
      };
  const targetRecord = await createRawTriageTargetRecord(targetProject.context, targetKind, rawSource, provenanceUri, args);
  const targetRecordId = recordId(targetRecord);
  const targetRecordUri = `boreal://${targetProject.id}/${targetRecordId}`;
  const triageEvent = await appendRawTriageEvent(context, {
    rawSourceId: rawSource.id,
    outcome: action === "promote" ? "promoted" : "kept_global",
    provenanceUri,
    targetProjectId: targetProject.id,
    targetProjectName: targetProject.name,
    targetRecordKind: targetKind,
    targetRecordId,
    targetRecordUri
  });

  return {
    schemaVersion: "boreal.cli.raw.triage.v1",
    action,
    rawSource,
    provenanceUri,
    targetProject: {
      id: targetProject.id,
      name: targetProject.name,
      root: targetProject.context.workspaceRoot
    },
    targetRecord,
    targetRecordKind: targetKind,
    targetRecordUri,
    triageEvent
  };
}

async function requireUntriagedRawSource(context: CliContext, rawSourceId: string): Promise<RawSourceRecord> {
  const [records, rows] = await Promise.all([listVaultRawSources(context), listRawSourceRows(context)]);
  const row = rows.find((candidate) => candidate.id === rawSourceId);
  if (!row) {
    throw new BorealError("BOREAL_NOT_FOUND", "Raw source not found", { rawSourceId, domain: "raw" });
  }
  if (row.triage) {
    throw new BorealError("BOREAL_CONFLICT", "Raw source has already been triaged", {
      rawSourceId,
      triage: row.triage
    });
  }
  const record = records.find((candidate) => candidate.id === rawSourceId);
  if (!record) {
    throw new BorealError("BOREAL_NOT_FOUND", "Raw source not found", { rawSourceId, domain: "raw" });
  }
  return record;
}

async function resolveRawTriageTargetProject(
  context: CliContext,
  args: ParsedArgs,
  projectId: string
): Promise<RawTriageTargetProject> {
  const registry = await listProjectRegistry({ registryRoot: flagValue(args, "registry-root") });
  const entry = registry.entries.find((candidate) => candidate.id === projectId);
  if (!entry) {
    throw new BorealError("BOREAL_NOT_FOUND", "Registry entry not found", { projectId, domain: "registry" });
  }
  assertRoutableProject(entry);
  const targetContext = await createCliContext(projectWorkspaceArgs(args, entry.projectRoot), entry.projectRoot, {
    sessionId: context.sessionId
  });
  return {
    id: entry.id,
    name: entry.display.name,
    context: targetContext
  };
}

function assertRoutableProject(entry: ProjectRegistryEntry): void {
  if (entry.lifecycle !== "linked") {
    throw new BorealError("BOREAL_POLICY_VIOLATION", `Cannot route raw source to ${entry.lifecycle} project`, {
      projectId: entry.id,
      lifecycle: entry.lifecycle
    });
  }
  if (!existsSync(entry.projectRoot) || !existsSync(entry.projectConfigPath)) {
    throw new BorealError("BOREAL_POLICY_VIOLATION", "Cannot route raw source to missing project", {
      projectId: entry.id,
      lifecycle: "missing",
      projectRoot: entry.projectRoot
    });
  }
}

function projectWorkspaceArgs(args: ParsedArgs, workspaceRoot: string): ParsedArgs {
  const flags = new Map<string, string[]>();
  for (const name of ["actor", "actor-kind", "session"]) {
    const values = args.flags.get(name);
    if (values) {
      flags.set(name, [...values]);
    }
  }
  flags.set("workspace", [workspaceRoot]);
  return { command: ["work"], flags };
}

async function createRawTriageTargetRecord(
  context: CliContext,
  targetKind: RawTriageTargetKind,
  rawSource: RawSourceRecord,
  provenanceUri: string,
  args: ParsedArgs
): Promise<RawTriageTargetRecord> {
  switch (targetKind) {
    case "work":
      return context.runtime.createWork({
        title: flagValue(args, "title") ?? rawSource.title,
        description: flagValue(args, "description") ?? rawSource.summary,
        kind: parseWorkKind(flagValue(args, "work-kind")),
        labels: flagValues(args, "label"),
        sourceRefs: provenanceSourceRefs(provenanceUri),
        ready: hasFlag(args, "ready")
      });
    case "source":
      return context.runtime.createKnowledgeSource({
        kind: knowledgeSourceKind(rawSource.kind),
        title: flagValue(args, "title") ?? rawSource.title,
        uri: provenanceUri,
        summary: flagValue(args, "summary") ?? rawSource.summary
      });
    case "claim": {
      const source = await context.runtime.createKnowledgeSource({
        kind: knowledgeSourceKind(rawSource.kind),
        title: flagValue(args, "title") ?? rawSource.title,
        uri: provenanceUri,
        summary: flagValue(args, "summary") ?? rawSource.summary
      });
      return context.runtime.createClaim({
        statement: flagValue(args, "statement") ?? rawSource.summary ?? rawSource.title,
        sourceIds: [source.meta.id]
      });
    }
    case "decision": {
      const source = await context.runtime.createKnowledgeSource({
        kind: knowledgeSourceKind(rawSource.kind),
        title: flagValue(args, "title") ?? rawSource.title,
        uri: provenanceUri,
        summary: flagValue(args, "summary") ?? rawSource.summary
      });
      return context.runtime.createDecision({
        title: flagValue(args, "title") ?? rawSource.title,
        context: flagValue(args, "context") ?? rawSource.summary ?? "",
        decision: flagValue(args, "decision") ?? rawSource.title,
        sourceIds: [source.meta.id]
      });
    }
  }
}

function provenanceSourceRefs(provenanceUri: string): readonly SourceRef[] {
  return [{ uri: provenanceUri, label: "global raw capture" }];
}

function parseRawTriageAction(value: string): RawTriageAction {
  if (value === "promote" || value === "keep-global" || value === "drop") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "raw triage action must be promote, keep-global, or drop", {
    value
  });
}

function parseRawTriageTargetKind(value: string): RawTriageTargetKind {
  if (value === "work" || value === "source" || value === "claim" || value === "decision") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--as must be work, source, claim, or decision", { value });
}

function parseWorkKind(value: string | undefined): WorkKind | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "issue" || value === "task" || value === "sprint" || value === "milestone") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--work-kind must be issue, task, sprint, or milestone", { value });
}

function knowledgeSourceKind(value: string): KnowledgeSourceKind {
  if (value === "raw" || value === "document" || value === "chat" || value === "code" || value === "artifact") {
    return value;
  }
  return "raw";
}

function recordId(record: RawTriageTargetRecord): string {
  return record.meta.id;
}

async function wikiCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: MemoryCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "list": {
      const limit = dependencies.parseLimit(flagValue(args, "limit")) ?? dependencies.defaultListLimit;
      const pages = await listVaultWikiPages(context);
      const rows = wikiPageRows(pages).slice(0, limit);
      output.write(json ? formatRecord(rows, true) : table(rows.map(textWikiPageRow)));
      return { exitCode: 0 };
    }
    case "show": {
      const pages = await listVaultWikiPages(context);
      const page = resolveWikiPage(pages, dependencies.requiredPositional(rest, 0, "wiki page reference"));
      const detail = wikiPageDetail(page, pages);
      output.write(formatRecord(detail, json));
      return { exitCode: 0 };
    }
    case "create": {
      output.write(
        formatRecord(
          await createWikiPage(context, {
            title: rest.join(" ").trim(),
            slug: flagValue(args, "slug"),
            summary: flagValue(args, "summary"),
            sourceRefs: flagValues(args, "source"),
            tags: flagValues(args, "tag")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown wiki command: ${action ?? ""}`);
  }
}

async function duplicateCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "scan": {
      const result = await scanDuplicates(context, { domain: parseDuplicateDomain(flagValue(args, "domain") ?? "all") });
      output.write(formatRecord(result, json));
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown duplicate command: ${action ?? ""}`);
  }
}

async function mergeCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "plan": {
      const duplicateIds = flagValues(args, "duplicate");
      if (duplicateIds.length === 0) {
        throw new BorealError("BOREAL_INVALID_INPUT", "merge plan requires at least one --duplicate");
      }
      output.write(
        formatRecord(
          buildManualMergePlan(parseMergeDomain(requiredFlag(args, "domain")), requiredFlag(args, "survivor"), duplicateIds),
          json
        )
      );
      return { exitCode: 0 };
    }
    case "apply": {
      const duplicateIds = flagValues(args, "duplicate");
      output.write(
        formatRecord(
          await applyManualMerge(context, {
            domain: parseMergeDomain(requiredFlag(args, "domain")),
            survivorId: requiredFlag(args, "survivor"),
            duplicateIds,
            planId: requiredFlag(args, "plan"),
            confirm: hasFlag(args, "confirm")
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown merge command: ${action ?? ""}`);
  }
}

async function compactCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  switch (action) {
    case "analyze": {
      output.write(
        formatRecord(
          await analyzeCompaction(context, {
            domain: parseCompactDomain(flagValue(args, "domain") ?? "all"),
            olderThanDays: parseOlderThanDays(flagValue(args, "older-than-days"))
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    case "apply": {
      output.write(
        formatRecord(
          await applyCompaction(context, {
            domain: parseCompactApplyDomain(requiredFlag(args, "domain")),
            targetId: requiredFlag(args, "target"),
            planId: requiredFlag(args, "plan"),
            summary: requiredFlag(args, "summary"),
            confirm: hasFlag(args, "confirm"),
            olderThanDays: parseOlderThanDays(flagValue(args, "older-than-days"))
          }),
          json
        )
      );
      return { exitCode: 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown compact command: ${action ?? ""}`);
  }
}

export async function resolveWikiPageIds(
  context: CliContext,
  references: readonly string[]
): Promise<readonly string[]> {
  if (references.length === 0) {
    return [];
  }
  const vaultStatus = await inspectVault(context);
  if (!vaultStatus.initialized) {
    throw new BorealError("BOREAL_NOT_FOUND", "Wiki page references require an initialized Boreal memory vault", {
      references,
      missingDirectories: vaultStatus.missingDirectories,
      missingFiles: vaultStatus.missingFiles,
      domain: "summary"
    });
  }
  const pages = await listVaultWikiPages(context);
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const reference of references) {
    const pageId = wikiPageRuntimeId(resolveWikiPage(pages, reference));
    if (!seen.has(pageId)) {
      ids.push(pageId);
      seen.add(pageId);
    }
  }
  return ids;
}

function parsePreviewBytes(value: string | undefined): number {
  if (!value) {
    return DEFAULT_RAW_PREVIEW_BYTES;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--preview-bytes must be a positive integer");
  }
  if (parsed > MAX_RAW_PREVIEW_BYTES) {
    throw new BorealError("BOREAL_INVALID_INPUT", `--preview-bytes must be at most ${MAX_RAW_PREVIEW_BYTES}`);
  }
  return parsed;
}

function parseDuplicateDomain(value: string): DuplicateDomain {
  if (value === "all" || value === "work" || value === "raw" || value === "wiki") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--domain must be all, work, raw, or wiki");
}

function parseMergeDomain(value: string): Exclude<DuplicateDomain, "all"> {
  if (value === "work" || value === "raw" || value === "wiki") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--domain must be work, raw, or wiki");
}

function parseCompactDomain(value: string): CompactDomain {
  if (value === "all" || value === "work" || value === "wiki") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--domain must be all, work, or wiki");
}

function parseCompactApplyDomain(value: string): Exclude<CompactDomain, "all"> {
  if (value === "work" || value === "wiki") {
    return value;
  }
  throw new BorealError("BOREAL_INVALID_INPUT", "--domain must be work or wiki");
}

function parseOlderThanDays(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--older-than-days must be a non-negative integer");
  }
  return parsed;
}

function textRawSourceRow(row: RawSourceRow): Record<string, string> {
  return {
    id: row.id,
    status: row.processingStatus,
    kind: row.kind,
    title: row.title,
    uri: row.uri ?? "",
    linked: String(row.linkedPageCount),
    addedAt: row.addedAt
  };
}

interface WikiPageRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly sourceRefs: readonly string[];
  readonly links: readonly string[];
  readonly claimStatus?: string;
  readonly truthStatus: string;
  readonly sourceRefCount: number;
  readonly outboundLinkCount: number;
  readonly backlinkCount: number;
  readonly showCommand: string;
}

interface WikiPageDetail extends WikiPageRow {
  readonly backlinks: readonly WikiLinkedPage[];
  readonly outboundPages: readonly WikiLinkedPage[];
  readonly missingOutboundLinks: readonly string[];
}

interface WikiLinkedPage {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly truthStatus: string;
}

function wikiPageRows(pages: readonly WikiPageRecord[]): readonly WikiPageRow[] {
  return pages.map((page) => wikiPageRow(page, pages)).sort(compareWikiPageRows);
}

function wikiPageDetail(page: WikiPageRecord, pages: readonly WikiPageRecord[]): WikiPageDetail {
  const row = wikiPageRow(page, pages);
  const outbound = page.links.map((link) => ({ link, page: findWikiPageByLink(pages, link) }));
  return {
    ...row,
    backlinks: wikiBacklinks(page, pages).map(wikiLinkedPage),
    outboundPages: outbound.map((entry) => entry.page).filter(isWikiPageRecord).map(wikiLinkedPage),
    missingOutboundLinks: outbound.filter((entry) => !entry.page).map((entry) => entry.link)
  };
}

function wikiPageRow(page: WikiPageRecord, pages: readonly WikiPageRecord[]): WikiPageRow {
  return {
    id: wikiPageRuntimeId(page),
    slug: page.slug,
    title: page.title,
    path: page.path,
    sourceRefs: page.sourceRefs,
    links: page.links,
    claimStatus: page.claimStatus,
    truthStatus: wikiTruthStatus(page),
    sourceRefCount: page.sourceRefs.length,
    outboundLinkCount: page.links.length,
    backlinkCount: wikiBacklinks(page, pages).length,
    showCommand: `bwrk wiki show ${wikiPageRuntimeId(page)} --json`
  };
}

function wikiBacklinks(page: WikiPageRecord, pages: readonly WikiPageRecord[]): readonly WikiPageRecord[] {
  return pages.filter((candidate) =>
    candidate.path !== page.path && candidate.links.some((link) => wikiLinkTargetsPage(link, page))
  );
}

function resolveWikiPage(pages: readonly WikiPageRecord[], reference: string): WikiPageRecord {
  const normalized = normalizeWikiReference(reference);
  const page = pages.find((candidate) =>
    candidate.id === reference ||
    candidate.slug === reference ||
    normalizeWikiReference(candidate.title) === normalized ||
    normalizeWikiReference(candidate.path) === normalized
  );
  if (!page) {
    throw new BorealError("BOREAL_NOT_FOUND", "Wiki page not found", { reference, domain: "summary" });
  }
  return page;
}

function findWikiPageByLink(pages: readonly WikiPageRecord[], link: string): WikiPageRecord | undefined {
  const normalized = normalizeWikiReference(link);
  return pages.find((page) =>
    normalizeWikiReference(page.slug) === normalized ||
    normalizeWikiReference(page.title) === normalized ||
    normalizeWikiReference(page.path) === normalized ||
    page.id === link
  );
}

function wikiLinkTargetsPage(link: string, page: WikiPageRecord): boolean {
  const normalized = normalizeWikiReference(link);
  return (
    normalized === normalizeWikiReference(page.slug) ||
    normalized === normalizeWikiReference(page.title) ||
    normalized === normalizeWikiReference(page.path) ||
    link === page.id
  );
}

function wikiTruthStatus(page: WikiPageRecord): string {
  if (page.claimStatus === "accepted") return "accepted";
  if (page.claimStatus === "proposed") return "proposed";
  if (page.claimStatus === "stale") return "stale";
  if (page.claimStatus === "rejected") return "rejected";
  return "draft";
}

function wikiLinkedPage(page: WikiPageRecord): WikiLinkedPage {
  return {
    id: wikiPageRuntimeId(page),
    slug: page.slug,
    title: page.title,
    path: page.path,
    truthStatus: wikiTruthStatus(page)
  };
}

function compareWikiPageRows(left: WikiPageRow, right: WikiPageRow): number {
  return (
    wikiTruthRank(left.truthStatus) - wikiTruthRank(right.truthStatus) ||
    right.backlinkCount - left.backlinkCount ||
    right.sourceRefCount - left.sourceRefCount ||
    left.title.localeCompare(right.title) ||
    left.slug.localeCompare(right.slug)
  );
}

function wikiTruthRank(status: string): number {
  if (status === "accepted") return 0;
  if (status === "proposed") return 1;
  if (status === "draft") return 2;
  if (status === "stale") return 3;
  return 4;
}

function normalizeWikiReference(value: string): string {
  const fileName = basename(value.trim().replace(/\\/gu, "/"), ".md");
  return fileName
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function wikiPageRuntimeId(page: WikiPageRecord): string {
  return page.id || page.slug;
}

function isWikiPageRecord(value: WikiPageRecord | undefined): value is WikiPageRecord {
  return Boolean(value);
}

function textWikiPageRow(row: WikiPageRow): Record<string, string> {
  return {
    id: row.id,
    status: row.truthStatus,
    title: row.title,
    path: row.path,
    sources: String(row.sourceRefCount),
    backlinks: String(row.backlinkCount),
    outbound: String(row.outboundLinkCount)
  };
}
