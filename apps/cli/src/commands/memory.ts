import { basename } from "node:path";

import { BorealError } from "@boreal/core";

import { flagValue, flagValues, requiredFlag, type ParsedArgs } from "../args.js";
import type { CliContext } from "../context.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import {
  addRawSource,
  createWikiPage,
  getRawSourceDetail,
  inspectVault,
  listRawSourceRows,
  listVaultWikiPages,
  type RawSourceRow,
  type WikiPageRecord
} from "../vault.js";
import type { CommandResult } from "./shared.js";

const DEFAULT_RAW_PREVIEW_BYTES = 4_096;
const MAX_RAW_PREVIEW_BYTES = 65_536;

type MemoryCommandGroup = "raw" | "wiki";

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
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown raw command: ${action ?? ""}`);
  }
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
