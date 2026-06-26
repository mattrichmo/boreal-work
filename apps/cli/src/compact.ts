import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

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
import { writeTextFileAtomic } from "@boreal/storage";

import type { CliContext } from "./context.js";
import {
  VAULT_SCHEMA_VERSION,
  appendVaultLedgerEvent,
  inspectVault,
  listVaultWikiPages,
  resolveVaultDisplayPath,
  resolveVaultLayout,
  vaultDisplayPath,
  type VaultLedgerEvent,
  type WikiPageRecord
} from "./vault.js";

export type CompactDomain = "all" | "work" | "wiki";

export interface CompactAnalyzeOptions {
  readonly domain?: CompactDomain;
  readonly olderThanDays?: number;
}

export interface CompactAnalyzeResult {
  readonly ok: true;
  readonly domain: CompactDomain;
  readonly olderThanDays: number;
  readonly scanned: {
    readonly work: number;
    readonly wiki: number;
  };
  readonly skipped: readonly CompactSkippedDomain[];
  readonly candidates: readonly CompactCandidate[];
  readonly plans: readonly CompactPlan[];
}

export interface CompactSkippedDomain {
  readonly domain: "wiki";
  readonly reason: string;
}

export interface CompactCandidate {
  readonly domain: Exclude<CompactDomain, "all">;
  readonly id: string;
  readonly title: string;
  readonly reason: string;
  readonly path?: string;
  readonly closedAt?: string;
}

export interface CompactPlan {
  readonly id: string;
  readonly domain: Exclude<CompactDomain, "all">;
  readonly destructive: false;
  readonly strategy: "summarize_preserve_sources";
  readonly targetId: string;
  readonly targetTitle: string;
  readonly reason: string;
  readonly preserves: CompactPreservationGuarantees;
  readonly reviewChecklist: readonly string[];
}

export interface CompactApplyOptions {
  readonly domain: Exclude<CompactDomain, "all">;
  readonly targetId: string;
  readonly planId: string;
  readonly summary: string;
  readonly confirm: boolean;
  readonly olderThanDays?: number;
}

export interface CompactApplyResult {
  readonly applied: true;
  readonly domain: Exclude<CompactDomain, "all">;
  readonly planId: string;
  readonly targetId: string;
  readonly archivePath: string;
  readonly summary: string;
  readonly preserves: CompactPreservationGuarantees;
  readonly vaultEvent: VaultLedgerEvent;
  readonly event?: RuntimeEvent;
}

export interface CompactPreservationGuarantees {
  readonly evidenceIds: readonly string[];
  readonly verificationIds: readonly string[];
  readonly sourceRefs: readonly string[];
  readonly wikiLinks: readonly string[];
  readonly originalPaths: readonly string[];
}

const DEFAULT_OLDER_THAN_DAYS = 30;

export async function analyzeCompaction(
  context: CliContext,
  options: CompactAnalyzeOptions = {}
): Promise<CompactAnalyzeResult> {
  const domain = options.domain ?? "all";
  const olderThanDays = options.olderThanDays ?? DEFAULT_OLDER_THAN_DAYS;
  const includeWork = domain === "all" || domain === "work";
  const includeWiki = domain === "all" || domain === "wiki";
  const skipped: CompactSkippedDomain[] = [];

  const workItems = includeWork ? await context.store.read((reader) => reader.listWorkItems()) : [];
  const workCandidates = includeWork ? oldClosedWorkCandidates(workItems, olderThanDays) : [];

  const vault = await inspectVault(context);
  const wikiPages = includeWiki && vault.initialized ? await listVaultWikiPages(context) : [];
  if (includeWiki && !vault.initialized) {
    skipped.push({ domain: "wiki", reason: "memory vault is not initialized" });
  }
  const wikiCandidates = includeWiki && vault.initialized ? vaultPageCandidates(wikiPages, vault.health) : [];
  const candidates = [...workCandidates, ...wikiCandidates].sort(compareCompactCandidates);

  return {
    ok: true,
    domain,
    olderThanDays,
    scanned: {
      work: workItems.length,
      wiki: wikiPages.filter((page) => page.slug !== "index").length
    },
    skipped,
    candidates,
    plans: candidates.map((candidate) => planForCandidate(candidate, workItems, wikiPages))
  };
}

export async function applyCompaction(context: CliContext, options: CompactApplyOptions): Promise<CompactApplyResult> {
  const summary = normalizeMachineString(options.summary, "compact summary");
  const plan = await resolveCompactApplyPlan(context, options);
  assertCompactApplyGate(options.confirm, options.planId, plan.id);
  switch (options.domain) {
    case "work":
      return applyWorkCompaction(context, plan, summary);
    case "wiki":
      return applyWikiCompaction(context, plan, summary);
  }
}

async function resolveCompactApplyPlan(context: CliContext, options: CompactApplyOptions): Promise<CompactPlan> {
  const analyzed = await analyzeCompaction(context, {
    domain: options.domain,
    olderThanDays: options.olderThanDays
  });
  const plan = analyzed.plans.find((candidate) => candidate.targetId === options.targetId && candidate.domain === options.domain);
  if (!plan) {
    throw new BorealError("BOREAL_NOT_FOUND", "Compaction target is not currently eligible", {
      domain: options.domain,
      targetId: options.targetId,
      olderThanDays: analyzed.olderThanDays
    });
  }
  return plan;
}

async function applyWorkCompaction(context: CliContext, plan: CompactPlan, summary: string): Promise<CompactApplyResult> {
  const status = await inspectVault(context);
  if (!status.initialized) {
    throw new BorealError("BOREAL_INVALID_INPUT", "compact apply requires an initialized memory vault; run `bwrk vault init`", {
      status
    });
  }
  const now = nowIso();
  const layout = await resolveVaultLayout(context);
  const archivePath = vaultDisplayPath(layout, `work/compacted/${plan.targetId}.md`);
  const currentWork = await context.store.read((reader) => reader.getWorkItem(plan.targetId as WorkId));
  if (!currentWork) {
    throw new BorealError("BOREAL_NOT_FOUND", "Compaction work target not found", { targetId: plan.targetId });
  }
  await writeWorkArchive(context, archivePath, currentWork, plan, summary, now);
  const { event } = await context.store.write(async (writer) => {
    const work = await writer.getWorkItem(plan.targetId as WorkId);
    if (!work) {
      throw new BorealError("BOREAL_NOT_FOUND", "Compaction work target not found", { targetId: plan.targetId });
    }
    const nextWork = touchRecord(
      {
        ...work,
        description: compactedWorkDescription(summary, archivePath, plan),
        labels: uniqueStrings([...work.labels, "compacted"]),
        meta: {
          ...work.meta,
          tags: uniqueStrings([...work.meta.tags, "compacted"])
        }
      },
      now,
      context.actor
    );
    await writer.putWorkItem(nextWork);
    const event = compactionAppliedEvent(context, plan, now, archivePath);
    await writer.putEvent(event);
    return { event };
  });
  const vaultEvent = await appendVaultLedgerEvent(context, {
    type: "compact.applied",
    subjectType: "work",
    subjectId: plan.targetId,
    payload: compactVaultPayload(plan, archivePath, summary)
  });
  return {
    applied: true,
    domain: "work",
    planId: plan.id,
    targetId: plan.targetId,
    archivePath,
    summary,
    preserves: plan.preserves,
    vaultEvent,
    event
  };
}

async function applyWikiCompaction(context: CliContext, plan: CompactPlan, summary: string): Promise<CompactApplyResult> {
  const pages = await listVaultWikiPages(context);
  const page = pages.find((entry) => (entry.id || entry.path) === plan.targetId);
  if (!page) {
    throw new BorealError("BOREAL_NOT_FOUND", "Compaction wiki target not found", { targetId: plan.targetId });
  }
  const now = nowIso();
  const layout = await resolveVaultLayout(context);
  const archivePath = vaultDisplayPath(layout, `wiki/archive/${page.slug}-${safeTimestamp(now)}.md`);
  const original = await readFile(await resolveVaultDisplayPath(context, page.path), "utf8");
  await writeArchiveFile(context, archivePath, original);
  await writeTextFileAtomic(
    await resolveVaultDisplayPath(context, page.path),
    compactedWikiMarkdown(page, plan, summary, archivePath, now)
  );
  const vaultEvent = await appendVaultLedgerEvent(context, {
    type: "compact.applied",
    subjectType: "wiki",
    subjectId: plan.targetId,
    payload: compactVaultPayload(plan, archivePath, summary)
  });
  return {
    applied: true,
    domain: "wiki",
    planId: plan.id,
    targetId: plan.targetId,
    archivePath,
    summary,
    preserves: plan.preserves,
    vaultEvent
  };
}

function oldClosedWorkCandidates(workItems: readonly WorkItem[], olderThanDays: number): readonly CompactCandidate[] {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  return workItems
    .filter((work) => work.status === "closed")
    .filter((work) => !isCompactedWork(work))
    .filter((work) => Boolean(work.closedAt) && Date.parse(work.closedAt ?? "") <= cutoff)
    .map((work) => ({
      domain: "work",
      id: work.meta.id,
      title: work.title,
      reason: `closed for at least ${olderThanDays} days`,
      closedAt: work.closedAt
    }));
}

function vaultPageCandidates(
  pages: readonly WikiPageRecord[],
  health: Awaited<ReturnType<typeof inspectVault>>["health"]
): readonly CompactCandidate[] {
  const orphanPaths = new Set(health.orphanPages);
  const staleClaimPaths = new Set(health.staleClaims);
  return pages
    .filter((page) => page.slug !== "index")
    .filter((page) => page.claimStatus !== "compacted")
    .filter((page) => orphanPaths.has(page.path) || staleClaimPaths.has(page.path))
    .map((page) => ({
      domain: "wiki",
      id: page.id || page.path,
      title: page.title,
      path: page.path,
      reason: staleClaimPaths.has(page.path) ? "wiki page is marked as a stale claim" : "wiki page has no inbound links"
    }));
}

function planForCandidate(
  candidate: CompactCandidate,
  workItems: readonly WorkItem[],
  wikiPages: readonly WikiPageRecord[]
): CompactPlan {
  const preserves = preservationForCandidate(candidate, workItems, wikiPages);
  return {
    id: `compact_plan_${hashContent({ candidate, preserves }).replace("sha256:", "").slice(0, 16)}`,
    domain: candidate.domain,
    destructive: false,
    strategy: "summarize_preserve_sources",
    targetId: candidate.id,
    targetTitle: candidate.title,
    reason: candidate.reason,
    preserves,
    reviewChecklist: [
      "Confirm the summary captures the current useful state before any future apply step.",
      "Preserve every evidence ID, verification ID, source reference, wiki link, and original path listed in this plan.",
      "Do not mutate raw sources; archive or summarize only derived work/wiki material."
    ]
  };
}

function preservationForCandidate(
  candidate: CompactCandidate,
  workItems: readonly WorkItem[],
  wikiPages: readonly WikiPageRecord[]
): CompactPreservationGuarantees {
  if (candidate.domain === "work") {
    const work = workItems.find((entry) => entry.meta.id === candidate.id);
    return {
      evidenceIds: work?.evidenceIds ?? [],
      verificationIds: work?.verificationIds ?? [],
      sourceRefs: (work?.meta.sourceRefs ?? []).map(sourceRefValue),
      wikiLinks: [],
      originalPaths: []
    };
  }
  const page = wikiPages.find((entry) => (entry.id || entry.path) === candidate.id);
  return {
    evidenceIds: [],
    verificationIds: [],
    sourceRefs: page?.sourceRefs ?? [],
    wikiLinks: page?.links ?? [],
    originalPaths: page?.path ? [page.path] : []
  };
}

function sourceRefValue(sourceRef: SourceRef): string {
  return sourceRef.label ? `${sourceRef.label}:${sourceRef.uri}` : sourceRef.uri;
}

function assertCompactApplyGate(confirmed: boolean, suppliedPlanId: string, expectedPlanId: string): void {
  if (!confirmed) {
    throw new BorealError("BOREAL_INVALID_INPUT", "compact apply requires --confirm");
  }
  if (!suppliedPlanId) {
    throw new BorealError("BOREAL_INVALID_INPUT", `compact apply requires --plan ${expectedPlanId}`, { expectedPlanId });
  }
  if (suppliedPlanId !== expectedPlanId) {
    throw new BorealError("BOREAL_CONFLICT", "compact apply plan id does not match the current target", {
      expectedPlanId,
      suppliedPlanId
    });
  }
}

async function writeWorkArchive(
  context: CliContext,
  relativePath: string,
  work: WorkItem,
  plan: CompactPlan,
  summary: string,
  compactedAt: string
): Promise<void> {
  await writeArchiveFile(
    context,
    relativePath,
    [
      "---",
      "kind: boreal-compacted-work-archive",
      `schemaVersion: ${VAULT_SCHEMA_VERSION}`,
      `work_id: ${work.meta.id}`,
      `plan_id: ${plan.id}`,
      `compacted_at: ${compactedAt}`,
      "evidence_ids:",
      ...plan.preserves.evidenceIds.map((id) => `  - ${id}`),
      "verification_ids:",
      ...plan.preserves.verificationIds.map((id) => `  - ${id}`),
      "source_refs:",
      ...plan.preserves.sourceRefs.map((sourceRef) => `  - ${sourceRef}`),
      "---",
      "",
      `# ${work.title}`,
      "",
      "## Summary",
      "",
      summary,
      "",
      "## Original Description",
      "",
      work.description || "(empty)",
      "",
      "## Acceptance Criteria",
      "",
      ...work.acceptanceCriteria.map((criterion) => `- ${criterion}`),
      ""
    ].join("\n")
  );
}

async function writeArchiveFile(context: CliContext, relativePath: string, content: string): Promise<void> {
  const absolutePath = await resolveVaultDisplayPath(context, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeTextFileAtomic(absolutePath, content);
}

function compactedWorkDescription(summary: string, archivePath: string, plan: CompactPlan): string {
  return [
    summary,
    "",
    "Compaction archive:",
    archivePath,
    "",
    "Preserved evidence IDs:",
    ...plan.preserves.evidenceIds.map((id) => `- ${id}`),
    "",
    "Preserved verification IDs:",
    ...plan.preserves.verificationIds.map((id) => `- ${id}`),
    "",
    "Preserved source refs:",
    ...plan.preserves.sourceRefs.map((sourceRef) => `- ${sourceRef}`)
  ]
    .join("\n")
    .trim();
}

function compactedWikiMarkdown(
  page: WikiPageRecord,
  plan: CompactPlan,
  summary: string,
  archivePath: string,
  compactedAt: string
): string {
  return [
    "---",
    "kind: boreal-wiki-page",
    `schemaVersion: ${VAULT_SCHEMA_VERSION}`,
    `id: ${page.id}`,
    `slug: ${page.slug}`,
    `title: ${yamlScalar(page.title)}`,
    `updated_at: ${compactedAt}`,
    `claim_status: compacted`,
    `compaction_plan: ${plan.id}`,
    `compaction_archive: ${archivePath}`,
    "source_refs:",
    ...page.sourceRefs.map((sourceRef) => `  - ${sourceRef}`),
    "---",
    "",
    `# ${page.title}`,
    "",
    summary,
    "",
    "## Preserved Links",
    "",
    ...(page.links.length > 0 ? page.links.map((link) => `- [[${link}]]`) : ["(none)"]),
    "",
    "## Archive",
    "",
    archivePath,
    ""
  ].join("\n");
}

function compactionAppliedEvent(context: CliContext, plan: CompactPlan, now: IsoTimestamp, archivePath: string): RuntimeEvent {
  return withContentHash({
    meta: createRecordMeta({
      id: randomId<EventId>("event"),
      now,
      actor: context.actor,
      tags: ["compact"]
    }),
    type: "compact.applied",
    subjectId: plan.targetId,
    subjectType: plan.domain,
    operationId: context.operationId,
    payload: {
      planId: plan.id,
      targetId: plan.targetId,
      archivePath,
      destructive: false,
      strategy: plan.strategy,
      preserves: plan.preserves
    }
  } satisfies RuntimeEvent);
}

function compactVaultPayload(plan: CompactPlan, archivePath: string, summary: string): Record<string, unknown> {
  return {
    planId: plan.id,
    targetId: plan.targetId,
    targetTitle: plan.targetTitle,
    archivePath,
    summary,
    destructive: false,
    strategy: plan.strategy,
    preserves: plan.preserves
  };
}

function safeTimestamp(value: string): string {
  return value.replace(/[:.]/gu, "-");
}

function uniqueStrings<T extends string>(values: readonly T[]): readonly T[] {
  return [...new Set(values)];
}

function isCompactedWork(work: WorkItem): boolean {
  return work.labels.includes("compacted") || work.meta.tags.includes("compacted");
}

function yamlScalar(value: string): string {
  return JSON.stringify(value);
}

function compareCompactCandidates(left: CompactCandidate, right: CompactCandidate): number {
  return left.domain.localeCompare(right.domain) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
