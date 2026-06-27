import type { WorkItem } from "@boreal/core";

import type { DashboardFinding } from "./health-view.js";

export type ProjectMemoryLayout = "in-repo" | "child" | "sibling";
export type ProjectMemoryGitMode = "shared" | "separate" | "submodule";
export type ProjectHealthState = "ok" | "warning" | "error" | "missing";

export interface ProjectRegistryEntry {
  readonly id: string;
  readonly name: string;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: ProjectMemoryLayout;
  readonly memoryGitMode: ProjectMemoryGitMode;
  readonly installRoot?: string;
  readonly health: ProjectHealthState;
  readonly openWorkCount: number;
  readonly readyWorkCount: number;
  readonly blockedWorkCount: number;
  readonly activeReservationCount: number;
  readonly findings: readonly DashboardFinding[];
  readonly lastSeenAt?: string;
}

export interface ProjectRegistrySummary {
  readonly totalProjects: number;
  readonly healthyProjects: number;
  readonly warningProjects: number;
  readonly errorProjects: number;
  readonly missingProjects: number;
  readonly readyWorkCount: number;
  readonly blockedWorkCount: number;
  readonly activeReservationCount: number;
}

export interface ProjectRegistryView {
  readonly generatedAt?: string;
  readonly entries: readonly ProjectRegistryEntry[];
  readonly summary: ProjectRegistrySummary;
}

export function buildProjectRegistryView(input: {
  readonly entries: readonly ProjectRegistryEntry[];
  readonly generatedAt?: string;
}): ProjectRegistryView {
  const entries = [...input.entries].sort((left, right) => left.name.localeCompare(right.name));
  return {
    generatedAt: input.generatedAt,
    entries,
    summary: {
      totalProjects: entries.length,
      healthyProjects: countHealth(entries, "ok"),
      warningProjects: countHealth(entries, "warning"),
      errorProjects: countHealth(entries, "error"),
      missingProjects: countHealth(entries, "missing"),
      readyWorkCount: sum(entries, (entry) => entry.readyWorkCount),
      blockedWorkCount: sum(entries, (entry) => entry.blockedWorkCount),
      activeReservationCount: sum(entries, (entry) => entry.activeReservationCount)
    }
  };
}

export function summarizeWorkForRegistry(work: readonly Pick<WorkItem, "status">[]): {
  readonly openWorkCount: number;
  readonly readyWorkCount: number;
  readonly blockedWorkCount: number;
} {
  return {
    openWorkCount: work.filter((item) => !TERMINAL_WORK_STATUSES.has(item.status)).length,
    readyWorkCount: work.filter((item) => item.status === "ready").length,
    blockedWorkCount: work.filter((item) => item.status === "blocked").length
  };
}

function countHealth(entries: readonly ProjectRegistryEntry[], health: ProjectHealthState): number {
  return entries.filter((entry) => entry.health === health).length;
}

function sum(entries: readonly ProjectRegistryEntry[], value: (entry: ProjectRegistryEntry) => number): number {
  return entries.reduce((total, entry) => total + value(entry), 0);
}

const TERMINAL_WORK_STATUSES = new Set<WorkItem["status"]>(["closed", "cancelled", "verified"]);
