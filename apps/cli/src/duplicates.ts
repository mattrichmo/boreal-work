import { hashContent, normalizeMachineString, type WorkItem } from "@boreal/core";

import type { CliContext } from "./context.js";
import { inspectVault, listVaultRawSources, listVaultWikiPages, type RawSourceRecord, type WikiPageRecord } from "./vault.js";

export type DuplicateDomain = "all" | "work" | "raw" | "wiki";

export interface DuplicateScanOptions {
  readonly domain?: DuplicateDomain;
}

export interface DuplicateScanResult {
  readonly ok: boolean;
  readonly domain: DuplicateDomain;
  readonly scanned: {
    readonly work: number;
    readonly raw: number;
    readonly wiki: number;
  };
  readonly skipped: readonly DuplicateSkippedDomain[];
  readonly duplicateGroups: readonly DuplicateGroup[];
  readonly mergePlans: readonly DuplicateMergePlan[];
}

export interface DuplicateSkippedDomain {
  readonly domain: "raw" | "wiki";
  readonly reason: string;
}

export interface DuplicateGroup {
  readonly id: string;
  readonly domain: Exclude<DuplicateDomain, "all">;
  readonly key: string;
  readonly reason: string;
  readonly records: readonly DuplicateRecord[];
}

export interface DuplicateRecord {
  readonly id: string;
  readonly title: string;
  readonly path?: string;
  readonly uri?: string;
  readonly status?: string;
}

export interface DuplicateMergePlan {
  readonly id: string;
  readonly domain: Exclude<DuplicateDomain, "all">;
  readonly destructive: false;
  readonly strategy: "manual_review";
  readonly survivorId: string;
  readonly duplicateIds: readonly string[];
  readonly commands: readonly string[];
}

export function buildManualMergePlan(
  domain: Exclude<DuplicateDomain, "all">,
  survivorId: string,
  duplicateIds: readonly string[]
): DuplicateMergePlan {
  return {
    id: `merge_plan_${hashContent({ domain, survivorId, duplicateIds }).replace("sha256:", "").slice(0, 16)}`,
    domain,
    destructive: false,
    strategy: "manual_review",
    survivorId,
    duplicateIds,
    commands: mergePlanCommands(domain, survivorId, duplicateIds)
  };
}

export async function scanDuplicates(context: CliContext, options: DuplicateScanOptions = {}): Promise<DuplicateScanResult> {
  const domain = options.domain ?? "all";
  const includeWork = domain === "all" || domain === "work";
  const includeRaw = domain === "all" || domain === "raw";
  const includeWiki = domain === "all" || domain === "wiki";
  const skipped: DuplicateSkippedDomain[] = [];
  const groups: DuplicateGroup[] = [];

  const workItems = includeWork ? await context.store.read((reader) => reader.listWorkItems()) : [];
  groups.push(...workDuplicateGroups(workItems));

  const vault = await inspectVault(context);
  const rawSources = includeRaw && vault.initialized ? await listVaultRawSources(context) : [];
  const wikiPages = includeWiki && vault.initialized ? await listVaultWikiPages(context) : [];
  if (!vault.initialized && includeRaw) {
    skipped.push({ domain: "raw", reason: "memory vault is not initialized" });
  }
  if (!vault.initialized && includeWiki) {
    skipped.push({ domain: "wiki", reason: "memory vault is not initialized" });
  }

  groups.push(...rawDuplicateGroups(rawSources));
  groups.push(...wikiDuplicateGroups(wikiPages));
  const sortedGroups = groups.sort(compareDuplicateGroups);
  return {
    ok: sortedGroups.length === 0,
    domain,
    scanned: {
      work: workItems.length,
      raw: rawSources.length,
      wiki: wikiPages.filter((page) => page.slug !== "index").length
    },
    skipped,
    duplicateGroups: sortedGroups,
    mergePlans: sortedGroups.map(mergePlanForGroup)
  };
}

function workDuplicateGroups(workItems: readonly WorkItem[]): readonly DuplicateGroup[] {
  return duplicateGroups(
    "work",
    workItems,
    (work) => `title:${duplicateKey(work.title)}`,
    (work) => ({
      id: work.meta.id,
      title: work.title,
      status: work.status
    }),
    "work items share the same normalized title"
  );
}

function rawDuplicateGroups(records: readonly RawSourceRecord[]): readonly DuplicateGroup[] {
  return [
    ...duplicateGroups(
      "raw",
      records.filter((record) => record.uri),
      (record) => `uri:${duplicateKey(record.uri ?? "")}`,
      rawDuplicateRecord,
      "raw source records share the same normalized URI"
    ),
    ...duplicateGroups(
      "raw",
      records,
      (record) => `title:${duplicateKey(record.title)}`,
      rawDuplicateRecord,
      "raw source records share the same normalized title"
    )
  ];
}

function wikiDuplicateGroups(pages: readonly WikiPageRecord[]): readonly DuplicateGroup[] {
  return duplicateGroups(
    "wiki",
    pages.filter((page) => page.slug !== "index"),
    (page) => `title:${duplicateKey(page.title)}`,
    (page) => ({
      id: page.id || page.path,
      title: page.title,
      path: page.path
    }),
    "wiki pages share the same normalized title"
  );
}

function rawDuplicateRecord(record: RawSourceRecord): DuplicateRecord {
  return {
    id: record.id,
    title: record.title,
    uri: record.uri
  };
}

function duplicateGroups<T>(
  domain: Exclude<DuplicateDomain, "all">,
  values: readonly T[],
  keyForValue: (value: T) => string,
  recordForValue: (value: T) => DuplicateRecord,
  reason: string
): readonly DuplicateGroup[] {
  const byKey = new Map<string, DuplicateRecord[]>();
  for (const value of values) {
    const key = keyForValue(value);
    const records = byKey.get(key) ?? [];
    records.push(recordForValue(value));
    byKey.set(key, records);
  }
  return [...byKey.entries()]
    .filter(([, records]) => records.length > 1)
    .map(([key, records]) => {
      const sortedRecords = [...records].sort(compareDuplicateRecords);
      return {
        id: groupId(domain, key, sortedRecords),
        domain,
        key,
        reason,
        records: sortedRecords
      };
    });
}

function mergePlanForGroup(group: DuplicateGroup): DuplicateMergePlan {
  const [survivor, ...duplicates] = group.records;
  return buildManualMergePlan(group.domain, survivor?.id ?? "", duplicates.map((record) => record.id));
}

function mergePlanCommands(
  domain: Exclude<DuplicateDomain, "all">,
  survivorId: string,
  duplicateIds: readonly string[]
): readonly string[] {
  if (duplicateIds.length === 0) {
    return [];
  }
  return [`bwrk merge plan --domain ${domain} --survivor ${survivorId} ${duplicateIds.map((id) => `--duplicate ${id}`).join(" ")}`];
}

function groupId(
  domain: Exclude<DuplicateDomain, "all">,
  key: string,
  records: readonly DuplicateRecord[]
): string {
  return `duplicate_${hashContent({ domain, key, ids: records.map((record) => record.id) }).replace("sha256:", "").slice(0, 16)}`;
}

function duplicateKey(value: string): string {
  return normalizeMachineString(value, "duplicate key", { lowerCase: true });
}

function compareDuplicateGroups(left: DuplicateGroup, right: DuplicateGroup): number {
  return left.domain.localeCompare(right.domain) || left.key.localeCompare(right.key) || left.id.localeCompare(right.id);
}

function compareDuplicateRecords(left: DuplicateRecord, right: DuplicateRecord): number {
  return left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
