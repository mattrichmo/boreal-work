import { hashContent, type SourceRef, type WorkItem } from "@boreal/core";

import type { CliContext } from "./context.js";
import { inspectVault, listVaultWikiPages, type WikiPageRecord } from "./vault.js";

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

function oldClosedWorkCandidates(workItems: readonly WorkItem[], olderThanDays: number): readonly CompactCandidate[] {
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  return workItems
    .filter((work) => work.status === "closed")
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

function compareCompactCandidates(left: CompactCandidate, right: CompactCandidate): number {
  return left.domain.localeCompare(right.domain) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id);
}
