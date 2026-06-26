import {
  BorealError,
  createRecordMeta,
  hashContent,
  normalizeMachineString,
  nowIso,
  randomId,
  touchRecord,
  withContentHash,
  type EventId,
  type IsoTimestamp,
  type RuntimeEvent,
  type SourceRef,
  type WorkId,
  type WorkItem
} from "@boreal/core";

import type { CliContext } from "./context.js";
import {
  appendVaultLedgerEvent,
  inspectVault,
  listVaultLedgerEvents,
  listVaultRawSources,
  listVaultWikiPages,
  type RawSourceRecord,
  type VaultLedgerEvent,
  type WikiPageRecord
} from "./vault.js";

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

export interface DuplicateMergeApplyOptions {
  readonly domain: Exclude<DuplicateDomain, "all">;
  readonly survivorId: string;
  readonly duplicateIds: readonly string[];
  readonly planId: string;
  readonly confirm: boolean;
}

export interface DuplicateMergeApplyResult {
  readonly applied: true;
  readonly domain: Exclude<DuplicateDomain, "all">;
  readonly planId: string;
  readonly survivorId: string;
  readonly duplicateIds: readonly string[];
  readonly mode: "state_archive" | "vault_event";
  readonly changedWorkIds: readonly string[];
  readonly vaultEvent?: VaultLedgerEvent;
  readonly event?: RuntimeEvent;
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

export async function applyManualMerge(
  context: CliContext,
  options: DuplicateMergeApplyOptions
): Promise<DuplicateMergeApplyResult> {
  const duplicateIds = uniqueStrings(options.duplicateIds);
  const plan = buildManualMergePlan(options.domain, options.survivorId, duplicateIds);
  assertApplyGate("merge apply", options.confirm, options.planId, plan.id);
  if (duplicateIds.length === 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "merge apply requires at least one --duplicate");
  }
  if (duplicateIds.includes(options.survivorId)) {
    throw new BorealError("BOREAL_INVALID_INPUT", "merge survivor cannot also be a duplicate", {
      survivorId: options.survivorId
    });
  }

  switch (options.domain) {
    case "work":
      return applyWorkMerge(context, plan);
    case "raw":
    case "wiki":
      return applyVaultMerge(context, plan);
  }
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
  const ledgerEvents = vault.initialized && (includeRaw || includeWiki) ? await listVaultLedgerEvents(context) : [];
  if (!vault.initialized && includeRaw) {
    skipped.push({ domain: "raw", reason: "memory vault is not initialized" });
  }
  if (!vault.initialized && includeWiki) {
    skipped.push({ domain: "wiki", reason: "memory vault is not initialized" });
  }

  groups.push(...rawDuplicateGroups(rawSources, mergedVaultDuplicateIds(ledgerEvents, "raw")));
  groups.push(...wikiDuplicateGroups(wikiPages, mergedVaultDuplicateIds(ledgerEvents, "wiki")));
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
    workItems.filter((work) => !isArchivedMergeWork(work) && !isCompactedWork(work)),
    (work) => `title:${duplicateKey(work.title)}`,
    (work) => ({
      id: work.meta.id,
      title: work.title,
      status: work.status
    }),
    "work items share the same normalized title"
  );
}

async function applyWorkMerge(context: CliContext, plan: DuplicateMergePlan): Promise<DuplicateMergeApplyResult> {
  return context.store.write(async (writer) => {
    const survivor = await writer.getWorkItem(plan.survivorId as WorkId);
    const duplicates = await Promise.all(plan.duplicateIds.map((duplicateId) => writer.getWorkItem(duplicateId as WorkId)));
    if (!survivor) {
      throw new BorealError("BOREAL_NOT_FOUND", "Merge survivor work item not found", { survivorId: plan.survivorId });
    }
    const missing = plan.duplicateIds.filter((_, index) => duplicates[index] === undefined);
    if (missing.length > 0) {
      throw new BorealError("BOREAL_NOT_FOUND", "Merge duplicate work item not found", { duplicateIds: missing });
    }
    const duplicateWork = duplicates.filter(isWorkItem);
    const active = duplicateWork.filter((work) => work.reservationId || work.status === "reserved" || work.status === "in_progress");
    if (active.length > 0) {
      throw new BorealError("BOREAL_CONFLICT", "Cannot merge work with active reservations or in-progress duplicates", {
        workIds: active.map((work) => work.meta.id)
      });
    }

    const now = nowIso();
    const nextSurvivor = touchRecord(
      {
        ...survivor,
        description: mergedDescription(survivor, duplicateWork, plan.id),
        acceptanceCriteria: uniqueStrings([...survivor.acceptanceCriteria, ...duplicateWork.flatMap((work) => work.acceptanceCriteria)]),
        labels: uniqueStrings([...survivor.labels, ...duplicateWork.flatMap((work) => work.labels), "merged-survivor"]),
        evidenceIds: uniqueStrings([...survivor.evidenceIds, ...duplicateWork.flatMap((work) => work.evidenceIds)]),
        verificationIds: uniqueStrings([...survivor.verificationIds, ...duplicateWork.flatMap((work) => work.verificationIds)]),
        meta: {
          ...survivor.meta,
          sourceRefs: uniqueSourceRefs([...survivor.meta.sourceRefs, ...duplicateWork.flatMap((work) => work.meta.sourceRefs)]),
          tags: uniqueStrings([...survivor.meta.tags, "merged-survivor"])
        }
      },
      now,
      context.actor
    );
    await writer.putWorkItem(nextSurvivor);

    const changedWorkIds = [nextSurvivor.meta.id];
    for (const duplicate of duplicateWork) {
      const archived = touchRecord(
        {
          ...duplicate,
          status: "cancelled" as const,
          labels: uniqueStrings([...duplicate.labels, "merged-duplicate"]),
          closedAt: duplicate.closedAt ?? now,
          closedReason: `Merged into ${survivor.meta.id} by ${plan.id}`,
          meta: {
            ...duplicate.meta,
            tags: uniqueStrings([...duplicate.meta.tags, "merged-duplicate"])
          }
        },
        now,
        context.actor
      );
      await writer.putWorkItem(archived);
      changedWorkIds.push(archived.meta.id);
    }

    const event = mergeAppliedEvent(context, plan, now, "work");
    await writer.putEvent(event);
    return {
      applied: true,
      domain: plan.domain,
      planId: plan.id,
      survivorId: plan.survivorId,
      duplicateIds: plan.duplicateIds,
      mode: "state_archive",
      changedWorkIds,
      event
    };
  });
}

async function applyVaultMerge(context: CliContext, plan: DuplicateMergePlan): Promise<DuplicateMergeApplyResult> {
  await assertVaultRecordsExist(context, plan);
  const vaultEvent = await appendVaultLedgerEvent(context, {
    type: "merge.applied",
    subjectType: plan.domain,
    subjectId: plan.survivorId,
    payload: {
      planId: plan.id,
      survivorId: plan.survivorId,
      duplicateIds: plan.duplicateIds,
      strategy: plan.strategy,
      destructive: false,
      preservation: "source records retained; merge relation recorded in memory/ledgers/events.jsonl"
    }
  });
  return {
    applied: true,
    domain: plan.domain,
    planId: plan.id,
    survivorId: plan.survivorId,
    duplicateIds: plan.duplicateIds,
    mode: "vault_event",
    changedWorkIds: [],
    vaultEvent
  };
}

async function assertVaultRecordsExist(context: CliContext, plan: DuplicateMergePlan): Promise<void> {
  const records = plan.domain === "raw" ? await listVaultRawSources(context) : await listVaultWikiPages(context);
  const ids = new Set(records.map((record) => (plan.domain === "wiki" ? (record as WikiPageRecord).id || (record as WikiPageRecord).path : record.id)));
  const missing = [plan.survivorId, ...plan.duplicateIds].filter((id) => !ids.has(id));
  if (missing.length > 0) {
    throw new BorealError("BOREAL_NOT_FOUND", "Merge records were not found in the memory vault", {
      domain: plan.domain,
      missing
    });
  }
}

function rawDuplicateGroups(records: readonly RawSourceRecord[], mergedIds: ReadonlySet<string>): readonly DuplicateGroup[] {
  const activeRecords = records.filter((record) => !mergedIds.has(record.id));
  return [
    ...duplicateGroups(
      "raw",
      activeRecords.filter((record) => record.uri),
      (record) => `uri:${duplicateKey(record.uri ?? "")}`,
      rawDuplicateRecord,
      "raw source records share the same normalized URI"
    ),
    ...duplicateGroups(
      "raw",
      activeRecords,
      (record) => `title:${duplicateKey(record.title)}`,
      rawDuplicateRecord,
      "raw source records share the same normalized title"
    )
  ];
}

function wikiDuplicateGroups(pages: readonly WikiPageRecord[], mergedIds: ReadonlySet<string>): readonly DuplicateGroup[] {
  return duplicateGroups(
    "wiki",
    pages.filter((page) => page.slug !== "index" && page.claimStatus !== "compacted" && !mergedIds.has(page.id || page.path)),
    (page) => `title:${duplicateKey(page.title)}`,
    (page) => ({
      id: page.id || page.path,
      title: page.title,
      path: page.path
    }),
    "wiki pages share the same normalized title"
  );
}

function mergedVaultDuplicateIds(events: readonly VaultLedgerEvent[], domain: "raw" | "wiki"): ReadonlySet<string> {
  const ids = events
    .filter((event) => event.type === "merge.applied" && event.subjectType === domain)
    .flatMap((event) => stringArrayPayloadValue(event.payload, "duplicateIds"));
  return new Set(ids);
}

function isArchivedMergeWork(work: WorkItem): boolean {
  return (
    work.labels.includes("merged-duplicate") ||
    work.meta.tags.includes("merged-duplicate") ||
    (work.status === "cancelled" && work.closedReason?.startsWith("Merged into ") === true)
  );
}

function isCompactedWork(work: WorkItem): boolean {
  return work.labels.includes("compacted") || work.meta.tags.includes("compacted");
}

function rawDuplicateRecord(record: RawSourceRecord): DuplicateRecord {
  return {
    id: record.id,
    title: record.title,
    uri: record.uri
  };
}

function assertApplyGate(command: string, confirmed: boolean, suppliedPlanId: string, expectedPlanId: string): void {
  if (!confirmed) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${command} requires --confirm`);
  }
  if (!suppliedPlanId) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${command} requires --plan ${expectedPlanId}`, { expectedPlanId });
  }
  if (suppliedPlanId !== expectedPlanId) {
    throw new BorealError("BOREAL_CONFLICT", `${command} plan id does not match the current inputs`, {
      expectedPlanId,
      suppliedPlanId
    });
  }
}

function mergedDescription(survivor: WorkItem, duplicates: readonly WorkItem[], planId: string): string {
  const duplicateSummary = duplicates.map((work) => `- ${work.meta.id}: ${work.title}`).join("\n");
  const duplicateDescriptions = duplicates
    .filter((work) => work.description.trim().length > 0)
    .map((work) => `### ${work.meta.id}\n\n${work.description}`)
    .join("\n\n");
  return [
    survivor.description.trim(),
    "",
    "## Merge Archive",
    "",
    `Plan: ${planId}`,
    "",
    duplicateSummary,
    duplicateDescriptions ? `\n${duplicateDescriptions}` : ""
  ]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n")
    .trim();
}

function mergeAppliedEvent(context: CliContext, plan: DuplicateMergePlan, now: IsoTimestamp, subjectType: string): RuntimeEvent {
  return withContentHash({
    meta: createRecordMeta({
      id: randomId<EventId>("event"),
      now,
      actor: context.actor,
      tags: ["merge"]
    }),
    type: "merge.applied",
    subjectId: plan.survivorId,
    subjectType,
    operationId: context.operationId,
    payload: {
      planId: plan.id,
      domain: plan.domain,
      survivorId: plan.survivorId,
      duplicateIds: plan.duplicateIds,
      destructive: false,
      strategy: plan.strategy
    }
  } satisfies RuntimeEvent);
}

function uniqueStrings<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function stringArrayPayloadValue(payload: Record<string, unknown>, key: string): readonly string[] {
  const value = payload[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function uniqueSourceRefs(values: readonly SourceRef[]): readonly SourceRef[] {
  const byKey = new Map<string, SourceRef>();
  for (const value of values) {
    byKey.set(JSON.stringify(value), value);
  }
  return [...byKey.values()];
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
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
