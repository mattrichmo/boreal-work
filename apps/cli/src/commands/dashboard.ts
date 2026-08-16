import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";

import {
  assembleAgentDirectiveBundleFromGaps,
  BorealError,
  deriveProjectRegistryIdentity,
  isIsoTimestamp,
  nowIso,
  resolveProjectRegistryPaths,
  projectRegistryEntryIdFromIdentity,
  type AgentDirectiveBundle,
  type AgentReservation,
  type EnforcementGap,
  type ProjectRegistryEntry as CoreProjectRegistryEntry,
  type ProjectRollupDocument,
  type ProjectRollupNextWork,
  type RuntimeOperation,
  type WorkItem,
  type WorkStatus,
  type WorkPriority
} from "@boreal/core";
import { inspectDaemonStatus, refreshGlobalRollupCache, type DaemonStatusResult, type GlobalRollupCacheProject } from "@boreal/daemon";
import { FileBorealStore, ObjectDirBorealStore, type BorealStore } from "@boreal/storage";
import {
  buildGlobalActivityView,
  buildGlobalHealthView,
  buildGlobalSearchView,
  buildGlobalSettingsView,
  buildGlobalWorkQueuesView,
  buildProjectRegistryView,
  toWorkItemView,
  type DashboardFinding,
  type GlobalActivitySourceRow,
  type GlobalSearchSourceRow,
  type GlobalSettingsProjectInput,
  type LockDashboardView,
  type ProjectRegistryEntry as DashboardProjectRegistryEntry,
  type ProjectSyncFreshness,
  type SyncDashboardView,
  type WorkItemView
} from "@boreal/ui-model";

import { flagValue, flagValues, hasFlag, type ParsedArgs } from "../args.js";
import { assertInitialized, createCliContext, isGlobalContext, type CliContext } from "../context.js";
import { runDoctor, type Diagnostic } from "../doctor.js";
import { formatRecord, table, type CliOutput } from "../output.js";
import { readProjectSetupConfig, readProjectStorage, type ProjectStorageKind } from "../project-setup.js";
import {
  addProjectRegistryEntry,
  doctorProjectRegistry,
  initProjectRegistry,
  listProjectRegistry,
  removeProjectRegistryEntry,
  type RegistryDoctorResult
} from "../registry.js";
import { runSearch } from "../search-cli.js";
import { listRawSourceRows, type RawSourceRow } from "../vault.js";
import { initCommand } from "./install.js";
import { formatRegistryAdd, formatRegistryRemove } from "./registry.js";
import type { CommandResult } from "./shared.js";
import { buildSyncStatus, type SyncStatusResult } from "./sync.js";

const DEFAULT_DASHBOARD_PROJECT_LIMIT = 100;
const DEFAULT_DASHBOARD_WORK_LIMIT = 250;
const DEFAULT_DASHBOARD_QUEUE_LIMIT = 200;
const DEFAULT_DASHBOARD_SEARCH_LIMIT = 10;
const DEFAULT_DASHBOARD_ACTIVITY_LIMIT = 20;
const DEFAULT_GLOBAL_NEXT_LIMIT = 10;
const DEFAULT_GLOBAL_INBOX_LIMIT = 50;
const DEFAULT_GLOBAL_INBOX_AGING_THRESHOLD_DAYS = 7;

const MAX_DASHBOARD_PROJECT_LIMIT = 100;
const MAX_GLOBAL_NEXT_LIMIT = 100;
const MAX_GLOBAL_INBOX_AGING_THRESHOLD_DAYS = 365;
const MAX_LIST_LIMIT = 1_000;
export const GLOBAL_STATUS_PROJECT_CONCURRENCY = 8;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function mapWithConcurrencyLimit<T, U>(
  values: readonly T[],
  limit: number,
  mapper: (value: T, index: number) => Promise<U>
): Promise<readonly U[]> {
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.floor(limit)) : 1;
  const results = new Array<U>(values.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= values.length) {
        return;
      }
      results[index] = await mapper(values[index] as T, index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(boundedLimit, values.length) }, () => worker()));
  return results;
}

interface GlobalDashboardProjectOverview {
  readonly entry: DashboardProjectRegistryEntry;
  readonly settings: GlobalSettingsProjectInput;
  readonly work: readonly WorkItemView[];
  readonly searchResults: readonly GlobalSearchSourceRow[];
  readonly searchError?: string;
  readonly activityRows: readonly GlobalActivitySourceRow[];
  readonly sync: SyncDashboardView;
  readonly locks: LockDashboardView;
  readonly daemon: DaemonStatusResult;
}

export interface GlobalStatusProjectRow {
  readonly projectId: string;
  readonly rootDir: string;
  readonly storage?: ProjectStorageKind;
  readonly workOpen?: number;
  readonly workReady?: number;
  readonly workBlocked?: number;
  readonly activeReservations?: number;
  readonly lastEventAt?: string;
  readonly ok: boolean;
  readonly error?: string;
}

export interface GlobalStatusResult {
  readonly schemaVersion: "boreal.cli.global.status.v1";
  readonly generatedAt: string;
  readonly registryRoot: string;
  readonly registryFile: string;
  readonly projectCount: number;
  readonly okCount: number;
  readonly errorCount: number;
  readonly projects: readonly GlobalStatusProjectRow[];
}

export interface GlobalInboxDashboardRow {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly status: RawSourceRow["processingStatus"];
  readonly addedAt: string;
  readonly ageDays: number;
  readonly retrievalCommand: string;
  readonly triageCommand: string;
}

export interface GlobalInboxDashboardSummary {
  readonly total: number;
  readonly queued: number;
  readonly linked: number;
  readonly routed: number;
  readonly keptGlobal: number;
  readonly dropped: number;
  readonly oldestQueuedAt?: string;
  readonly oldestQueuedAgeDays: number | null;
  readonly agingQueuedCount: number;
}

export interface GlobalInboxDashboardPolicy {
  readonly agingThresholdDays: number;
  readonly source: "flag" | "env" | "default";
}

export interface GlobalInboxDashboardResult {
  readonly schemaVersion: "boreal.cli.global.inbox.v1";
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly policy: GlobalInboxDashboardPolicy;
  readonly summary: GlobalInboxDashboardSummary;
  readonly rows: readonly GlobalInboxDashboardRow[];
  readonly advisoryGap?: EnforcementGap;
  readonly triageCommandTemplate: string;
}

export interface GlobalInitResult {
  readonly schemaVersion: "boreal.cli.global.init.v1";
  readonly initialized: true;
  readonly created: boolean;
  readonly registryRoot: string;
  readonly registryFile: string;
  readonly workspaceRoot: string;
  readonly initCommand: string;
}

export interface GlobalNextScoreBreakdown {
  readonly severity: number;
  readonly priority: number;
  readonly aging: number;
}

export interface GlobalNextDirectiveRow {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly workId: string;
  readonly subjectId: string;
  readonly title: string;
  readonly kind: string;
  readonly priority: WorkPriority;
  readonly status: WorkStatus;
  readonly updatedAt: string;
  readonly ageDays: number;
  readonly stale: boolean;
  readonly projectStatus: GlobalRollupCacheProject["status"];
  readonly command: string;
  readonly score: number;
  readonly scoreBreakdown: GlobalNextScoreBreakdown;
  readonly selectionKey: string;
}

export interface GlobalNextProjectRow {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly lifecycle: CoreProjectRegistryEntry["lifecycle"];
  readonly status: GlobalRollupCacheProject["status"] | "excluded";
  readonly stale: boolean;
  readonly winner: GlobalNextDirectiveRow | null;
  readonly candidateCount: number;
  readonly note?: string;
  readonly error?: string;
}

export interface GlobalNextExcludedProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly lifecycle: CoreProjectRegistryEntry["lifecycle"];
  readonly reason: string;
}

export interface GlobalNextResult {
  readonly schemaVersion: "boreal.cli.global.next.v1";
  readonly generatedAt: string;
  readonly registryRoot: string;
  readonly registryFile: string;
  readonly limit: number;
  readonly agentId?: string;
  readonly projectCount: number;
  readonly rankedProjectCount: number;
  readonly staleProjectCount: number;
  readonly degradedProjectCount: number;
  readonly excludedProjectCount: number;
  readonly overall: GlobalNextDirectiveRow | null;
  readonly projects: readonly GlobalNextProjectRow[];
  readonly excludedProjects: readonly GlobalNextExcludedProject[];
}

export async function dashboardCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const scope: "repo" | "global" = hasFlag(args, "global") ? "global" : "repo";
  switch (action) {
    case undefined:
      // --json emits the cross-repo data payload (same as `dashboard global`).
      if (json) {
        return emitGlobalDashboardData(context, args, output, true);
      }
      // Terminal dashboard is the default; --web opts into the browser console.
      if (hasFlag(args, "web")) {
        return serveDashboardCommand(context, args, output, scope);
      }
      return launchTuiCommand(context, args, scope);
    case "global":
      // Retained data command; equivalent to `dashboard --global --json`.
      return emitGlobalDashboardData(context, args, output, json);
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown dashboard command: ${action ?? ""}`);
  }
}

// `bwrk global` is an ergonomic alias for `bwrk dashboard --global`, and also
// hosts the `link` / `unlink` project-registry verbs.
export async function globalCommand(
  action: string | undefined,
  rest: readonly string[],
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  if (action === "init") {
    return globalInitCommand(context, args, output, json);
  }
  if (action === "next") {
    return globalNextCommand(args, output, json);
  }
  if (action === "link") {
    return linkCommand(rest[0], context, args, output, json);
  }
  if (action === "unlink") {
    return unlinkCommand(rest[0], args, output, json);
  }
  if (action === "status") {
    return globalStatusCommand(args, output, json);
  }
  if (action !== undefined) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Unknown global command: ${action}`);
  }
  if (json) {
    return emitGlobalDashboardData(context, args, output, true);
  }
  if (hasFlag(args, "web")) {
    return serveDashboardCommand(context, args, output, "global");
  }
  return launchTuiCommand(context, args, "global");
}

export async function bootstrapGlobalFirstRunIfNeeded(
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  cwd: string
): Promise<void> {
  if (!requiresGlobalFirstRunBootstrap(args) || globalRegistryExists(args)) {
    return;
  }
  const command = globalInitCommandString(args);
  const storage = globalRegistryStorage(args);
  const details = {
    registryRoot: storage.rootDir,
    registryFile: storage.registryFile,
    initCommand: command
  };
  if (json) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Global workspace is not initialized; run \`${command}\``, details);
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Global workspace is not initialized; run \`${command}\``, details);
  }
  const accepted = await promptGlobalFirstRunInit(storage.rootDir, command);
  if (!accepted) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Global workspace initialization cancelled", details);
  }
  const initArgs = globalInitArgs(args);
  const initContext = await createCliContext(initArgs, cwd);
  const result = await initializeGlobalWorkspace(initContext, initArgs);
  output.write(formatGlobalInit(result));
}

async function globalInitCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const result = await initializeGlobalWorkspace(context, args);
  output.write(json ? formatRecord(result, true) : formatGlobalInit(result));
  return { exitCode: 0 };
}

async function initializeGlobalWorkspace(context: CliContext, args: ParsedArgs): Promise<GlobalInitResult> {
  const registry = await initProjectRegistry({ registryRoot: flagValue(args, "registry-root") });
  await context.runtime.ensureWorkspaceInitialized();
  return {
    schemaVersion: "boreal.cli.global.init.v1",
    initialized: true,
    created: registry.created,
    registryRoot: registry.storage.rootDir,
    registryFile: registry.storage.registryFile,
    workspaceRoot: context.workspaceRoot,
    initCommand: globalInitCommandString(args)
  };
}

function requiresGlobalFirstRunBootstrap(args: ParsedArgs): boolean {
  if (args.command[0] === "global" && args.command[1] === "init") {
    return false;
  }
  return isGlobalContext(args);
}

function globalRegistryExists(args: ParsedArgs): boolean {
  return existsSync(globalRegistryStorage(args).registryFile);
}

function globalRegistryStorage(args: ParsedArgs) {
  return resolveProjectRegistryPaths({ rootDir: flagValue(args, "registry-root"), env: process.env });
}

function globalInitCommandString(args: ParsedArgs): string {
  const registryRoot = flagValue(args, "registry-root");
  return registryRoot ? `bwrk global init --registry-root ${registryRoot}` : "bwrk global init";
}

function globalInitArgs(args: ParsedArgs): ParsedArgs {
  const flags = new Map<string, string[]>();
  for (const name of ["actor", "actor-kind", "session", "registry-root"]) {
    const values = args.flags.get(name);
    if (values) {
      flags.set(name, [...values]);
    }
  }
  return { command: ["global", "init"], flags };
}

async function promptGlobalFirstRunInit(registryRoot: string, command: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`Run \`${command}\` to initialize Boreal global workspace at ${registryRoot}? [Y/n] `);
    const normalized = answer.trim().toLowerCase();
    if (!normalized) {
      return true;
    }
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

function formatGlobalInit(result: GlobalInitResult): string {
  return [
    result.created ? "OK Global workspace initialized" : "OK Global workspace already initialized",
    `registryRoot  ${result.registryRoot}`,
    `registryFile  ${result.registryFile}`,
    `workspaceRoot ${result.workspaceRoot}`,
    `initCommand   ${result.initCommand}`
  ].join("\n") + "\n";
}

async function globalNextCommand(args: ParsedArgs, output: CliOutput, json: boolean): Promise<CommandResult> {
  const result = await buildGlobalNextResult(args);
  output.write(json ? formatRecord(result, true) : formatGlobalNext(result));
  return { exitCode: 0 };
}

async function buildGlobalNextResult(args: ParsedArgs): Promise<GlobalNextResult> {
  const generatedAt = nowIso();
  const limit = parseLimit(flagValue(args, "limit"), { max: MAX_GLOBAL_NEXT_LIMIT }) ?? DEFAULT_GLOBAL_NEXT_LIMIT;
  const registryRoot = flagValue(args, "registry-root");
  const liveCacheTtlMs = parseNonNegativeInteger(flagValue(args, "live-cache-ttl-ms"), "--live-cache-ttl-ms") ?? 60_000;
  const agentId = flagValue(args, "agent");
  const [registry, rollups] = await Promise.all([
    listProjectRegistry({ registryRoot }),
    refreshGlobalRollupCache({
      registryRoot,
      ttlMs: liveCacheTtlMs,
      source: "lazy",
      now: () => generatedAt
    })
  ]);
  const excludedProjects = registry.entries
    .filter((entry) => entry.lifecycle !== "linked")
    .map(globalNextExcludedProject)
    .sort((left, right) => left.projectId.localeCompare(right.projectId));
  const allProjects = rollups.projects
    .map((project) => globalNextProjectRow(project, agentId, generatedAt))
    .sort(compareGlobalNextProjects);
  const winners = allProjects
    .map((project) => project.winner)
    .filter((winner): winner is GlobalNextDirectiveRow => winner !== null)
    .sort(compareGlobalNextDirectives);
  const projects = allProjects.slice(0, limit);
  return {
    schemaVersion: "boreal.cli.global.next.v1",
    generatedAt,
    registryRoot: rollups.registryRoot,
    registryFile: rollups.registryFile,
    limit,
    ...(agentId ? { agentId } : {}),
    projectCount: rollups.projectCount,
    rankedProjectCount: winners.length,
    staleProjectCount: rollups.staleCount,
    degradedProjectCount: rollups.degradedCount,
    excludedProjectCount: excludedProjects.length,
    overall: winners[0] ?? null,
    projects,
    excludedProjects
  };
}

function globalNextProjectRow(
  project: GlobalRollupCacheProject,
  agentId: string | undefined,
  generatedAt: string
): GlobalNextProjectRow {
  if (!project.rollup) {
    return {
      projectId: project.projectId,
      projectName: project.projectName,
      projectRoot: project.projectRoot,
      lifecycle: project.lifecycle,
      status: project.status,
      stale: project.stale,
      winner: null,
      candidateCount: 0,
      note: project.status === "degraded" ? "Project rollup unavailable; no candidate ranked." : "No project rollup candidate is available.",
      ...(project.error ? { error: project.error } : {})
    };
  }
  const candidates = project.rollup.next.work
    .map((work) => globalNextDirectiveRow(project, project.rollup as ProjectRollupDocument, work, agentId, generatedAt))
    .sort(compareGlobalNextDirectives);
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectRoot: project.projectRoot,
    lifecycle: project.lifecycle,
    status: project.status,
    stale: project.stale,
    winner: candidates[0] ?? null,
    candidateCount: candidates.length,
    ...(candidates.length === 0 ? { note: "No ready work in project rollup." } : {}),
    ...(project.error ? { error: project.error } : {})
  };
}

function globalNextDirectiveRow(
  project: GlobalRollupCacheProject,
  rollup: ProjectRollupDocument,
  work: ProjectRollupNextWork,
  agentId: string | undefined,
  generatedAt: string
): GlobalNextDirectiveRow {
  const ageDays = globalNextWorkAgeDays(rollup, work, generatedAt);
  const scoreBreakdown = {
    severity: globalNextProjectSeverityScore(project, rollup),
    priority: globalNextPriorityScore(work.priority),
    aging: Math.min(ageDays, 365)
  };
  const score = scoreBreakdown.severity + scoreBreakdown.priority + scoreBreakdown.aging;
  return {
    projectId: project.projectId,
    projectName: project.projectName,
    projectRoot: project.projectRoot,
    workId: work.workId,
    subjectId: work.workId,
    title: work.title,
    kind: work.kind,
    priority: work.priority,
    status: work.status,
    updatedAt: work.updatedAt,
    ageDays,
    stale: project.stale || project.status === "stale",
    projectStatus: project.status,
    command: globalNextExecutableCommand(project.projectRoot, work.workId, agentId),
    score,
    scoreBreakdown,
    selectionKey: [
      score.toString().padStart(4, "0"),
      project.projectId,
      work.workId
    ].join(":")
  };
}

function globalNextExcludedProject(entry: CoreProjectRegistryEntry): GlobalNextExcludedProject {
  return {
    projectId: entry.id,
    projectName: entry.display.name,
    projectRoot: entry.projectRoot,
    lifecycle: entry.lifecycle,
    reason: `Project lifecycle is ${entry.lifecycle}; global next ranks only linked projects.`
  };
}

function globalNextProjectSeverityScore(project: GlobalRollupCacheProject, rollup: ProjectRollupDocument): number {
  return (
    (project.status === "stale" || project.stale ? 25 : 0) +
    (rollup.health.doctorOk === false ? 50 : 0) +
    (rollup.health.syncOk === false ? 50 : 0)
  );
}

function globalNextPriorityScore(priority: WorkPriority): number {
  switch (priority) {
    case "critical":
      return 400;
    case "high":
      return 300;
    case "normal":
      return 200;
    case "low":
      return 100;
  }
}

function globalNextWorkAgeDays(rollup: ProjectRollupDocument, work: ProjectRollupNextWork, generatedAt: string): number {
  const agingEntry = rollup.aging.ready.items.find((entry) => entry.workId === work.workId);
  if (agingEntry) {
    return agingEntry.ageDays;
  }
  const generatedMs = Date.parse(rollup.generatedAt || generatedAt);
  const updatedMs = Date.parse(work.updatedAt);
  if (!Number.isFinite(generatedMs) || !Number.isFinite(updatedMs)) {
    return 0;
  }
  return Math.floor(Math.max(0, generatedMs - updatedMs) / DAY_MS);
}

function globalNextExecutableCommand(projectRoot: string, workId: string, agentId: string | undefined): string {
  const agent = agentId ? ` --agent ${shellArg(agentId)}` : "";
  return `bwrk --workspace ${shellArg(projectRoot)} agent start ${shellArg(workId)}${agent} --json`;
}

function compareGlobalNextProjects(left: GlobalNextProjectRow, right: GlobalNextProjectRow): number {
  if (left.winner && right.winner) {
    return compareGlobalNextDirectives(left.winner, right.winner);
  }
  if (left.winner) {
    return -1;
  }
  if (right.winner) {
    return 1;
  }
  return globalNextProjectStatusRank(left.status) - globalNextProjectStatusRank(right.status) ||
    left.projectId.localeCompare(right.projectId);
}

function compareGlobalNextDirectives(left: GlobalNextDirectiveRow, right: GlobalNextDirectiveRow): number {
  return right.score - left.score ||
    left.projectId.localeCompare(right.projectId) ||
    left.subjectId.localeCompare(right.subjectId);
}

function globalNextProjectStatusRank(status: GlobalNextProjectRow["status"]): number {
  switch (status) {
    case "fresh":
      return 0;
    case "stale":
      return 1;
    case "degraded":
      return 2;
    case "excluded":
      return 3;
  }
}

function formatGlobalNext(result: GlobalNextResult): string {
  const lines = [
    `[${result.overall ? "ok" : "empty"}] global next: ${result.rankedProjectCount}/${result.projectCount} linked project(s) ranked`
  ];
  if (result.projects.length > 0) {
    lines.push(table(result.projects.map((project) => ({
      project: project.projectName,
      status: project.status,
      stale: project.stale ? "yes" : "no",
      priority: project.winner?.priority ?? "-",
      ageDays: project.winner?.ageDays ?? "-",
      score: project.winner?.score ?? "-",
      work: project.winner?.title ?? project.note ?? "-",
      command: project.winner?.command ?? ""
    }))));
  }
  if (result.excludedProjects.length > 0) {
    lines.push(`Excluded: ${result.excludedProjects.map((project) => `${project.projectName} (${project.lifecycle})`).join(", ")}`);
  }
  if (!result.overall) {
    lines.push("No global next command available.");
    return lines.join("\n") + "\n";
  }
  lines.push(result.overall.command);
  return lines.join("\n") + "\n";
}

async function globalStatusCommand(args: ParsedArgs, output: CliOutput, json: boolean): Promise<CommandResult> {
  const result = await buildGlobalStatusResult(args);
  output.write(json ? formatRecord(result, true) : formatGlobalStatus(result));
  return { exitCode: result.errorCount > 0 && hasFlag(args, "strict") ? 1 : 0 };
}

async function buildGlobalStatusResult(args: ParsedArgs): Promise<GlobalStatusResult> {
  const generatedAt = nowIso();
  const registry = await listProjectRegistry({ registryRoot: flagValue(args, "registry-root") });
  const projects = await mapWithConcurrencyLimit(
    registry.entries.filter((entry) => entry.lifecycle !== "archived"),
    GLOBAL_STATUS_PROJECT_CONCURRENCY,
    (entry) => globalStatusProjectRow(entry)
  );
  const errorCount = projects.filter((project) => !project.ok).length;
  return {
    schemaVersion: "boreal.cli.global.status.v1",
    generatedAt,
    registryRoot: registry.storage.rootDir,
    registryFile: registry.storage.registryFile,
    projectCount: projects.length,
    okCount: projects.length - errorCount,
    errorCount,
    projects
  };
}

async function globalStatusProjectRow(entry: CoreProjectRegistryEntry): Promise<GlobalStatusProjectRow> {
  const rootDir = entry.projectRoot;
  try {
    assertReadableRegisteredProject(entry);
    const storage = await readProjectStorage(rootDir) ?? "file-v2";
    const store = openRegisteredProjectStore(rootDir, storage);
    const [workItems, reservations, events] = await store.read((reader) =>
      Promise.all([
        reader.listWorkItems(),
        reader.listReservations(),
        reader.listEvents()
      ])
    );
    return {
      projectId: entry.id,
      rootDir,
      storage,
      workOpen: workItems.filter(isOpenGlobalStatusWork).length,
      workReady: workItems.filter((work) => work.status === "ready").length,
      workBlocked: workItems.filter((work) => work.status === "blocked").length,
      activeReservations: reservations.filter(isActiveReservation).length,
      lastEventAt: latestEventTimestamp(events),
      ok: true
    };
  } catch (error) {
    return {
      projectId: entry.id,
      rootDir,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function assertReadableRegisteredProject(entry: CoreProjectRegistryEntry): void {
  if (!existsSync(entry.projectRoot)) {
    throw new BorealError("BOREAL_NOT_FOUND", "Registered project root is missing", {
      projectId: entry.id,
      projectRoot: entry.projectRoot
    });
  }
  if (!existsSync(entry.projectConfigPath)) {
    throw new BorealError("BOREAL_NOT_FOUND", "Registered project setup metadata is missing", {
      projectId: entry.id,
      projectConfigPath: entry.projectConfigPath
    });
  }
}

function openRegisteredProjectStore(rootDir: string, storage: ProjectStorageKind): BorealStore {
  return storage === "objects-v1" ? new ObjectDirBorealStore({ rootDir }) : new FileBorealStore({ rootDir });
}

function isOpenGlobalStatusWork(work: WorkItem): boolean {
  return !isTerminalWorkStatus(work.status);
}

function isTerminalWorkStatus(status: WorkStatus): boolean {
  return status === "closed" || status === "verified" || status === "cancelled";
}

function isActiveReservation(reservation: AgentReservation): boolean {
  return reservation.status === "active";
}

function latestEventTimestamp(events: readonly { readonly meta: { readonly createdAt: string; readonly updatedAt: string } }[]): string | undefined {
  return events
    .map((event) => event.meta.updatedAt || event.meta.createdAt)
    .filter(isIsoTimestamp)
    .sort()
    .at(-1);
}

// Link a project into the global workspace (registry add, reframed). With no
// path, links the current repo; inside the global context a path is required.
export async function linkCommand(
  pathArg: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const target = pathArg ? resolve(pathArg) : isGlobalContext(args) ? undefined : context.workspaceRoot;
  if (!target) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Provide a project path to link: bwrk global link <path>");
  }
  const registryOptions = {
    registryRoot: flagValue(args, "registry-root"),
    workspaceRoot: target,
    name: flagValue(args, "name"),
    labels: flagValues(args, "label")
  };
  let result: Awaited<ReturnType<typeof addProjectRegistryEntry>>;
  try {
    result = await addProjectRegistryEntry(registryOptions);
  } catch (error) {
    if (!hasFlag(args, "init") || !isLinkInitCandidate(error)) {
      if (isLinkInitCandidate(error)) {
        throw new BorealError("BOREAL_INVALID_INPUT", "Link target is not an initialized Boreal project; rerun with --init to initialize and link it", {
          workspaceRoot: target,
          recommendedCommand: `bwrk link ${target} --init`
        });
      }
      throw error;
    }
    await initializeLinkTarget(target, args);
    result = await addProjectRegistryEntry(registryOptions);
  }
  output.write(json ? formatRecord(result, true) : formatRegistryAdd(result));
  return { exitCode: 0 };
}

export async function unlinkCommand(
  idArg: string | undefined,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const id = idArg ?? "";
  if (!id) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Provide the project id to unlink: bwrk unlink <project-id>");
  }
  if (hasFlag(args, "purge") && !hasFlag(args, "yes")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Purge removes the registry row permanently; pass --yes to confirm", {
      projectId: id,
      recommendedCommand: `bwrk unlink ${id} --purge --yes`
    });
  }
  const result = await removeProjectRegistryEntry(id, {
    registryRoot: flagValue(args, "registry-root"),
    purge: hasFlag(args, "purge")
  });
  output.write(json ? formatRecord(result, true) : formatRegistryRemove(result));
  return { exitCode: 0 };
}

async function initializeLinkTarget(target: string, args: ParsedArgs): Promise<void> {
  const initArgs = linkInitArgs(args);
  const context = await createCliContext(initArgs, target);
  await initCommand(context, initArgs, silentOutput, true);
}

function linkInitArgs(args: ParsedArgs): ParsedArgs {
  const flags = new Map<string, string[]>();
  for (const name of ["actor", "actor-kind", "session", "storage", "memory-root", "memory-layout", "memory-git-mode", "memory-remote", "install-root", "skill-target", "folder-scoped", "separate-git"]) {
    const values = args.flags.get(name);
    if (values) {
      flags.set(name, [...values]);
    }
  }
  if (!flags.has("setup-memory")) {
    flags.set("setup-memory", ["true"]);
  }
  return { command: ["init"], flags };
}

const silentOutput: CliOutput = {
  write() {},
  error() {}
};

function isLinkInitCandidate(error: unknown): error is BorealError {
  return error instanceof BorealError
    && error.code === "BOREAL_INVALID_INPUT"
    && error.message.startsWith("Registry add requires");
}

async function emitGlobalDashboardData(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean
): Promise<CommandResult> {
  const result = await buildGlobalDashboardResult(context, args);
  const agentDirectives = globalDashboardAgentDirectives(result);
  output.write(json ? formatRecord(result, true, { agentDirectives }) : formatGlobalDashboardSummary(result));
  return { exitCode: 0 };
}

async function serveDashboardCommand(
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  scope: "repo" | "global"
): Promise<CommandResult> {
  const host = flagValue(args, "host") ?? "127.0.0.1";
  const port = parsePort(flagValue(args, "port")) ?? 4318;
  const mode = flagValue(args, "mode") === "fixture" ? "fixture" : "live";
  const liveCacheTtlMs = parseNonNegativeInteger(flagValue(args, "live-cache-ttl-ms"), "--live-cache-ttl-ms") ?? 60_000;
  const allowFixtureFallback = hasFlag(args, "allow-fixture-fallback");
  const url = `http://${host}:${port}`;
  const child = spawnDashboardServer({
    workspaceRoot: context.workspaceRoot,
    host,
    port,
    mode,
    scope,
    liveCacheTtlMs,
    allowFixtureFallback,
    registryRoot: scope === "global" ? flagValue(args, "registry-root") : undefined
  });
  output.write(`Boreal ${scope === "global" ? "global console" : "dashboard"} starting at ${url}\n`);
  output.write("Press Ctrl+C to stop.\n");
  if (!hasFlag(args, "no-open")) {
    setTimeout(() => openBrowser(url), 750);
  }
  return {
    exitCode: await waitForDashboardProcess(child)
  };
}

async function launchTuiCommand(context: CliContext, args: ParsedArgs, scope: "repo" | "global"): Promise<CommandResult> {
  const refreshMs = parseNonNegativeInteger(flagValue(args, "refresh-ms"), "--refresh-ms");
  const child = spawnAppProcess({
    appDir: "tui",
    distEntry: "index.js",
    srcEntry: "index.tsx",
    args: [
      "--workspace",
      context.workspaceRoot,
      ...(scope === "global" ? ["--global"] : []),
      ...(scope === "global" && flagValue(args, "registry-root")
        ? ["--registry-root", flagValue(args, "registry-root") as string]
        : []),
      ...(hasFlag(args, "mouse") ? ["--mouse"] : []),
      ...(refreshMs !== undefined ? ["--refresh-ms", String(refreshMs)] : [])
    ]
  });
  return { exitCode: await waitForDashboardProcess(child) };
}

function spawnDashboardServer(input: {
  readonly workspaceRoot: string;
  readonly host: string;
  readonly port: number;
  readonly mode: "live" | "fixture";
  readonly scope: "repo" | "global";
  readonly liveCacheTtlMs: number;
  readonly allowFixtureFallback: boolean;
  readonly registryRoot?: string;
}) {
  const fallbackArgs = input.allowFixtureFallback ? ["--allow-fixture-fallback"] : [];
  return spawnAppProcess({
    appDir: "console",
    distEntry: "server.js",
    srcEntry: "server.ts",
    args: [
      "--workspace",
      input.workspaceRoot,
      "--host",
      input.host,
      "--port",
      String(input.port),
      "--mode",
      input.mode,
      "--scope",
      input.scope,
      "--live-cache-ttl-ms",
      String(input.liveCacheTtlMs),
      ...fallbackArgs
    ],
    env: input.registryRoot ? { BOREAL_PROJECT_REGISTRY_ROOT: input.registryRoot } : undefined
  });
}

// App entrypoint resolution, in preference order:
// 1. A bundled sibling app next to the CLI entry itself
//    (<install>/dist/<appDir>/index.js) -- what the standalone install.sh /
//    npm artifact ships (built by tools/build-cli-dist.mjs).
// 2. The compiled in-repo app output (apps/<appDir>/dist/<distEntry>).
// 3. The TypeScript source via tsx for in-repo dev checkouts.
// When none exist, fail loudly with the alternatives instead of spawning a
// doomed process -- previously `bwrk dashboard` exited code 1 with zero
// output in the standalone layout (bw_work_67f67c5afd2decc5).
function spawnAppProcess(input: {
  readonly appDir: string;
  readonly distEntry: string;
  readonly srcEntry: string;
  readonly args: readonly string[];
  readonly env?: NodeJS.ProcessEnv;
}) {
  const spawnOptions = {
    stdio: "inherit" as const,
    ...(input.env ? { env: { ...process.env, ...input.env } } : {})
  };
  const cliDir = dirname(import.meta.url.replace(/^file:\/\//u, ""));
  const bundledEntrypoint = join(cliDir, input.appDir, "index.js");
  if (existsSync(bundledEntrypoint)) {
    return spawn(process.execPath, [bundledEntrypoint, ...input.args], { ...spawnOptions, cwd: cliDir });
  }
  const sourceRoot = resolve(cliDir, "..", "..", "..", "..");
  const distEntrypoint = join(sourceRoot, "apps", input.appDir, "dist", input.distEntry);
  if (existsSync(distEntrypoint)) {
    return spawn(process.execPath, [distEntrypoint, ...input.args], { ...spawnOptions, cwd: sourceRoot });
  }
  const tsxBin = join(sourceRoot, "node_modules", ".bin", process.platform === "win32" ? "tsx.cmd" : "tsx");
  const srcEntrypoint = join(sourceRoot, "apps", input.appDir, "src", input.srcEntry);
  if (!existsSync(tsxBin) || !existsSync(srcEntrypoint)) {
    throw new BorealError(
      "BOREAL_INVALID_INPUT",
      `The ${input.appDir === "tui" ? "terminal dashboard" : "browser console"} app is not bundled with this bwrk installation. ` +
        "Use `bwrk dashboard --json` for the data payload, reinstall bwrk (`bwrk upgrade --machine`), or run from a source checkout (`pnpm bwrk view`).",
      { lookedFor: [bundledEntrypoint, distEntrypoint, srcEntrypoint], sourceRoot }
    );
  }
  const tsconfig = join(sourceRoot, "apps", input.appDir, "tsconfig.json");
  return spawn(tsxBin, ["--tsconfig", tsconfig, srcEntrypoint, ...input.args], {
    ...spawnOptions,
    cwd: sourceRoot
  });
}

function openBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd" : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    const child = spawn(command, args, { detached: true, stdio: "ignore" });
    child.unref();
  } catch {
    // Serving the dashboard is the primary contract; the URL is printed if browser launch fails.
  }
}

function waitForDashboardProcess(child: ReturnType<typeof spawn>): Promise<number> {
  return new Promise((resolvePromise) => {
    const done = () => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      child.kill("SIGTERM");
    };
    process.once("SIGINT", done);
    process.once("SIGTERM", done);
    child.once("exit", (code, signal) => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      resolvePromise(signal ? 0 : code ?? 0);
    });
    child.once("error", (error) => {
      process.off("SIGINT", done);
      process.off("SIGTERM", done);
      // Surface the spawn failure (ENOENT etc.) -- swallowing it here made
      // `bwrk dashboard` exit 1 with no output when the app was missing.
      process.stderr.write(`Failed to launch dashboard process: ${error.message}\n`);
      resolvePromise(1);
    });
  });
}

function parsePort(value: string | undefined): number | undefined {
  const parsed = parseNonNegativeInteger(value, "--port");
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed < 1 || parsed > 65_535) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--port must be between 1 and 65535", { value });
  }
  return parsed;
}

async function buildGlobalDashboardResult(context: CliContext, args: ParsedArgs) {
  const generatedAt = nowIso();
  const projectLimit = parseLimit(flagValue(args, "limit"), { max: MAX_DASHBOARD_PROJECT_LIMIT }) ?? DEFAULT_DASHBOARD_PROJECT_LIMIT;
  const liveCacheTtlMs = parseNonNegativeInteger(flagValue(args, "live-cache-ttl-ms"), "--live-cache-ttl-ms") ?? 60_000;
  const writeCache = !hasFlag(args, "no-cache-write");
  const registryOptions = { registryRoot: flagValue(args, "registry-root") };
  const [registryList, registryDoctor, rollups] = await Promise.all([
    listProjectRegistry(registryOptions),
    doctorProjectRegistry(registryOptions),
    refreshGlobalRollupCache({
      registryRoot: registryOptions.registryRoot,
      ttlMs: liveCacheTtlMs,
      source: "lazy",
      writeCache,
      now: () => generatedAt
    })
  ]);
  const activeRegistryEntries = registryList.entries.filter((entry) => entry.lifecycle !== "archived" && entry.lifecycle !== "paused");
  const registryEntries = activeRegistryEntries.length > 0
    ? activeRegistryEntries
    : [await currentWorkspaceDashboardRegistryEntry(context, generatedAt)];
  const limitedRegistryEntries = registryEntries.slice(0, projectLimit);
  const registryFindings = dashboardRegistryFindingsByProject(registryDoctor);
  const searchQuery = "v1-remainder global dashboard registry";
  const rollupsByProject = new Map(rollups.projects.map((project) => [project.projectId, project]));
  const overviews = activeRegistryEntries.length > 0
    ? limitedRegistryEntries.map((entry) =>
        buildGlobalDashboardRollupOverview({
          entry,
          rollupProject: rollupsByProject.get(entry.id),
          registryFindings: registryFindings.get(entry.id) ?? [],
          generatedAt
        })
      )
    : await Promise.all(
        limitedRegistryEntries.map((entry) =>
          buildGlobalDashboardProjectOverview({
            parentContext: context,
            entry,
            registryFindings: registryFindings.get(entry.id) ?? [],
            generatedAt,
            searchQuery
          })
        )
  );
  const globalInbox = await buildGlobalInboxDashboardResult(context, args, generatedAt);
  const globalQueues = buildGlobalWorkQueuesView({
    generatedAt,
    limit: DEFAULT_DASHBOARD_QUEUE_LIMIT,
    projects: overviews.map((project) => ({
      projectId: project.entry.id,
      projectName: project.entry.name,
      projectRoot: project.entry.projectRoot,
      work: project.work
    }))
  });
  const workTruncated = overviews.some((project) => project.work.length >= DEFAULT_DASHBOARD_WORK_LIMIT)
    || globalQueues.queues.some((queue) => queue.truncated === true);

  return {
    schemaVersion: "boreal.cli.dashboard.global.v1",
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    searchQuery,
    limits: {
      projects: projectLimit,
      workPerProject: DEFAULT_DASHBOARD_WORK_LIMIT,
      queueRowsPerQueue: DEFAULT_DASHBOARD_QUEUE_LIMIT,
      searchPerProject: DEFAULT_DASHBOARD_SEARCH_LIMIT,
      activityPerProject: DEFAULT_DASHBOARD_ACTIVITY_LIMIT,
      rollupCacheTtlMs: liveCacheTtlMs
    },
    truncated: {
      projects: registryEntries.length > limitedRegistryEntries.length,
      work: workTruncated,
      queues: globalQueues.queues.some((queue) => queue.truncated === true)
    },
    registry: buildProjectRegistryView({
      generatedAt,
      entries: overviews.map((project) => project.entry)
    }),
    globalQueues,
    globalSearch: buildGlobalSearchView({
      generatedAt,
      query: searchQuery,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        results: project.searchResults,
        error: project.searchError
      }))
    }),
    globalActivity: buildGlobalActivityView({
      generatedAt,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        operations: project.activityRows
      }))
    }),
    globalInbox,
    globalHealth: buildGlobalHealthView({
      generatedAt,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        memoryRoot: project.entry.memoryRoot,
        health: project.entry.health,
        stale: project.entry.stale,
        syncFreshness: project.entry.syncFreshness,
        syncOk: project.sync.ok,
        vaultOk: project.sync.vaultOk,
        ledgersOk: project.sync.ledgersOk,
        searchIndexOk: project.sync.searchIndexOk,
        gitOk: project.sync.gitOk,
        findings: project.entry.findings,
        locks: project.locks.locks
      }))
    }),
    daemonStatus: {
      generatedAt,
      projects: overviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        state: project.daemon.state,
        pid: project.daemon.pid,
        processAlive: project.daemon.processAlive,
        statusPath: project.daemon.statusPath,
        findings: project.daemon.findings,
        recommendedActions: project.daemon.recommendedActions
      }))
    },
    rollups,
    globalSettings: buildGlobalSettingsView({
      generatedAt,
      projects: overviews.map((project) => project.settings)
    })
  };
}

async function buildGlobalInboxDashboardResult(
  context: CliContext,
  args: ParsedArgs,
  generatedAt: string
): Promise<GlobalInboxDashboardResult> {
  const policy = globalInboxDashboardPolicy(args);
  const globalContext = await globalDashboardContext(context, args);
  const rows = await globalDashboardRawRows(globalContext);
  const queuedRows = rows.filter((row) => row.processingStatus === "queued");
  const agingRows = queuedRows.filter((row) => rawSourceAgeDays(row, generatedAt) >= policy.agingThresholdDays);
  const oldestQueued = queuedRows
    .map((row) => ({ row, ageDays: rawSourceAgeDays(row, generatedAt) }))
    .sort((left, right) => right.ageDays - left.ageDays || left.row.id.localeCompare(right.row.id))[0];
  const dashboardRows = rows
    .map((row): GlobalInboxDashboardRow => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      status: row.processingStatus,
      addedAt: row.addedAt,
      ageDays: rawSourceAgeDays(row, generatedAt),
      retrievalCommand: row.retrievalCommand,
      triageCommand: globalRawTriageCommand(row.id)
    }))
    .sort(compareGlobalInboxRows);
  const advisoryGap = oldestQueued && agingRows.length > 0
    ? globalInboxAgingGap(globalContext, policy.agingThresholdDays, oldestQueued.row, oldestQueued.ageDays, agingRows)
    : undefined;

  return {
    schemaVersion: "boreal.cli.global.inbox.v1",
    generatedAt,
    workspaceRoot: globalContext.workspaceRoot,
    policy,
    summary: {
      total: rows.length,
      queued: queuedRows.length,
      linked: rows.filter((row) => row.processingStatus === "linked").length,
      routed: rows.filter((row) => row.processingStatus === "routed").length,
      keptGlobal: rows.filter((row) => row.processingStatus === "kept_global").length,
      dropped: rows.filter((row) => row.processingStatus === "dropped").length,
      oldestQueuedAt: oldestQueued?.row.addedAt,
      oldestQueuedAgeDays: oldestQueued?.ageDays ?? null,
      agingQueuedCount: agingRows.length
    },
    rows: dashboardRows,
    ...(advisoryGap ? { advisoryGap } : {}),
    triageCommandTemplate: "bwrk global raw triage <action> <raw-id> --json"
  };
}

async function globalDashboardContext(context: CliContext, args: ParsedArgs): Promise<CliContext> {
  const flags = new Map<string, string[]>();
  for (const name of ["actor", "actor-kind", "session", "registry-root"]) {
    const values = args.flags.get(name);
    if (values) {
      flags.set(name, [...values]);
    }
  }
  const registryRoot = flagValue(args, "registry-root");
  const expectedGlobalRoot = resolveProjectRegistryPaths({ rootDir: registryRoot, env: process.env }).rootDir;
  if (resolve(context.workspaceRoot) === resolve(expectedGlobalRoot)) {
    return context;
  }
  return createCliContext({ command: ["global"], flags }, context.cwd, {
    sessionId: context.sessionId,
    operationId: context.operationId
  });
}

async function globalDashboardRawRows(context: CliContext): Promise<readonly RawSourceRow[]> {
  try {
    return await listRawSourceRows(context, { limit: DEFAULT_GLOBAL_INBOX_LIMIT });
  } catch (error) {
    if (error instanceof BorealError && error.code === "BOREAL_INVALID_INPUT" && error.message.includes("memory vault")) {
      return [];
    }
    throw error;
  }
}

function globalInboxDashboardPolicy(args: ParsedArgs): GlobalInboxDashboardPolicy {
  const flag = parseBoundedNonNegativeInteger(
    flagValue(args, "inbox-aging-days"),
    "--inbox-aging-days",
    MAX_GLOBAL_INBOX_AGING_THRESHOLD_DAYS
  );
  if (flag !== undefined) {
    return { agingThresholdDays: flag, source: "flag" };
  }
  const env = parseBoundedNonNegativeInteger(
    process.env.BOREAL_GLOBAL_INBOX_AGING_DAYS,
    "BOREAL_GLOBAL_INBOX_AGING_DAYS",
    MAX_GLOBAL_INBOX_AGING_THRESHOLD_DAYS
  );
  if (env !== undefined) {
    return { agingThresholdDays: env, source: "env" };
  }
  return { agingThresholdDays: DEFAULT_GLOBAL_INBOX_AGING_THRESHOLD_DAYS, source: "default" };
}

function rawSourceAgeDays(row: RawSourceRow, generatedAt: string): number {
  const generatedMs = Date.parse(generatedAt);
  const addedMs = Date.parse(row.addedAt);
  if (!Number.isFinite(generatedMs) || !Number.isFinite(addedMs)) {
    return 0;
  }
  return Math.floor(Math.max(0, generatedMs - addedMs) / DAY_MS);
}

function compareGlobalInboxRows(left: GlobalInboxDashboardRow, right: GlobalInboxDashboardRow): number {
  const leftQueued = left.status === "queued" ? 0 : 1;
  const rightQueued = right.status === "queued" ? 0 : 1;
  return leftQueued - rightQueued ||
    right.ageDays - left.ageDays ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id);
}

function globalInboxAgingGap(
  context: CliContext,
  thresholdDays: number,
  oldestRow: RawSourceRow,
  oldestAgeDays: number,
  agingRows: readonly RawSourceRow[]
): EnforcementGap {
  const rawSourceIds = agingRows.map((row) => row.id);
  const command = globalRawTriageCommand(oldestRow.id);
  return {
    code: "inbox.triage.aging",
    subjectType: "workspace",
    subjectId: context.workspaceRoot,
    targetId: oldestRow.id,
    data: {
      rawSourceIds,
      rawSourceCount: rawSourceIds.length,
      oldestRawSourceId: oldestRow.id,
      oldestAgeDays,
      thresholdDays,
      command,
      recommendedCommands: agingRows.slice(0, 5).map((row) => globalRawTriageCommand(row.id))
    }
  };
}

function globalDashboardAgentDirectives(
  result: Awaited<ReturnType<typeof buildGlobalDashboardResult>>
): readonly AgentDirectiveBundle[] {
  const gap = result.globalInbox.advisoryGap;
  if (!gap) {
    return [];
  }
  const data = gap.data ?? {};
  const bundleResult = assembleAgentDirectiveBundleFromGaps({
    gaps: [gap],
    dataByRegistryId: {
      "inbox.triage-aging": {
        rawSourceIds: data.rawSourceIds ?? [],
        rawSourceCount: data.rawSourceCount ?? 0,
        oldestRawSourceId: data.oldestRawSourceId ?? String(gap.targetId ?? ""),
        oldestAgeDays: data.oldestAgeDays ?? 0,
        thresholdDays: data.thresholdDays ?? result.globalInbox.policy.agingThresholdDays,
        command: data.command ?? result.globalInbox.triageCommandTemplate,
        recommendedCommands: data.recommendedCommands ?? []
      }
    },
    commandPath: "dashboard global",
    capturedAt: isIsoTimestamp(result.generatedAt) ? result.generatedAt : nowIso(),
    envelopeSchema: result.schemaVersion,
    subject: {
      type: "workspace",
      id: result.globalInbox.workspaceRoot,
      title: "Global workspace"
    },
    generatedAt: isIsoTimestamp(result.generatedAt) ? result.generatedAt : nowIso()
  });
  return bundleResult.bundle && bundleResult.bundle.directives.length > 0 ? [bundleResult.bundle] : [];
}

function globalRawTriageCommand(rawSourceId: string): string {
  return `bwrk global raw triage <action> ${shellArg(rawSourceId)} --json`;
}

function buildGlobalDashboardRollupOverview(input: {
  readonly entry: CoreProjectRegistryEntry;
  readonly rollupProject?: GlobalRollupCacheProject;
  readonly registryFindings: readonly DashboardFinding[];
  readonly generatedAt: string;
}): GlobalDashboardProjectOverview {
  const rollup = input.rollupProject?.rollup;
  const findings = [
    ...input.registryFindings,
    ...dashboardFindingsFromRollupProject(input.entry, input.rollupProject)
  ];
  const entry = dashboardEntryFromRollup({
    entry: input.entry,
    generatedAt: input.generatedAt,
    rollupProject: input.rollupProject,
    findings
  });
  const sync = syncDashboardViewFromRollupProject(input.entry, input.rollupProject, input.generatedAt);
  return {
    entry,
    settings: dashboardSettingsFromEntry(input.entry, entry),
    work: rollup ? dashboardWorkFromRollup(rollup) : [],
    searchResults: rollup ? dashboardSearchFromRollup(rollup) : [],
    activityRows: rollup ? dashboardActivityFromRollup(rollup) : [],
    sync,
    locks: { generatedAt: input.generatedAt, ok: true, workspaceRoot: input.entry.projectRoot, locks: [] },
    daemon: daemonStatusFromRollupProject(input.entry, input.rollupProject, input.generatedAt)
  };
}

async function buildGlobalDashboardProjectOverview(input: {
  readonly parentContext: CliContext;
  readonly entry: CoreProjectRegistryEntry;
  readonly registryFindings: readonly DashboardFinding[];
  readonly generatedAt: string;
  readonly searchQuery: string;
}): Promise<GlobalDashboardProjectOverview> {
  try {
    const projectContext = await dashboardProjectContext(input.parentContext, input.entry.projectRoot);
    assertInitialized(projectContext);
    const [work, reservations, sync, doctor, operations, search, daemon] = await Promise.all([
      dashboardWork(projectContext),
      projectContext.store.read((reader) => reader.listReservations()),
      buildSyncStatus(projectContext),
      runDoctor(projectContext, false, false),
      dashboardOperations(projectContext),
      dashboardSearch(projectContext, input.searchQuery),
      inspectDaemonStatus({ workspaceRoot: projectContext.workspaceRoot })
    ]);
    const syncView = syncDashboardViewFromStatus(sync, input.generatedAt);
    const findings = [
      ...input.registryFindings,
      ...dashboardFindingsFromDiagnostics(doctor.diagnostics)
    ];
    const entry = dashboardEntryFromMetrics({
      entry: input.entry,
      generatedAt: input.generatedAt,
      work,
      sync: syncView,
      findings,
      activeReservationCount: reservations.filter((reservation) => reservation.status === "active").length
    });
    return {
      entry,
      settings: dashboardSettingsFromEntry(input.entry, entry),
      work,
      searchResults: search.results,
      searchError: search.error,
      activityRows: operations,
      sync: syncView,
      locks: lockDashboardViewFromDiagnostics(doctor.diagnostics, input.entry.projectRoot, input.generatedAt),
      daemon
    };
  } catch (error) {
    const sync = syncDashboardViewFromFailure(input.entry.projectRoot, input.generatedAt);
    const findings = [
      ...input.registryFindings,
      {
        code: "dashboard.project_unreadable",
        title: "dashboard.project_unreadable",
        severity: "error" as const,
        status: "failed" as const,
        message: error instanceof Error ? error.message : String(error),
        source: input.entry.projectRoot,
        actions: []
      }
    ];
    const entry = dashboardEntryFromMetrics({
      entry: input.entry,
      generatedAt: input.generatedAt,
      work: [],
      sync,
      findings,
      activeReservationCount: 0
    });
    return {
      entry,
      settings: dashboardSettingsFromEntry(input.entry, entry),
      work: [],
      searchResults: [],
      searchError: error instanceof Error ? error.message : String(error),
      activityRows: [],
      sync,
      locks: { generatedAt: input.generatedAt, ok: true, workspaceRoot: input.entry.projectRoot, locks: [] },
      daemon: daemonStatusUnavailable(input.entry.projectRoot, input.generatedAt, error)
    };
  }
}

function dashboardEntryFromRollup(input: {
  readonly entry: CoreProjectRegistryEntry;
  readonly generatedAt: string;
  readonly rollupProject?: GlobalRollupCacheProject;
  readonly findings: readonly DashboardFinding[];
}): DashboardProjectRegistryEntry {
  const rollup = input.rollupProject?.rollup;
  const syncFreshness = rollupSyncFreshness(input.entry, input.rollupProject);
  const stale = syncFreshness === "stale" || input.rollupProject?.stale === true || input.findings.some((finding) => finding.severity !== "info");
  return {
    id: input.entry.id,
    name: input.entry.display.name,
    lifecycle: input.entry.lifecycle,
    projectRoot: input.entry.projectRoot,
    memoryRoot: input.entry.memoryRoot,
    memoryLayout: input.entry.memoryLayout,
    memoryGitMode: input.entry.memoryGitMode,
    installRoot: input.entry.installRoot,
    bwrkPin: input.entry.bwrkPin,
    health: rollupProjectHealthState(input.entry, input.rollupProject, input.findings),
    stale,
    syncFreshness,
    openWorkCount: rollup ? openWorkCountFromRollup(rollup) : 0,
    readyWorkCount: rollup?.counts.work.byStatus.ready ?? 0,
    blockedWorkCount: rollup?.counts.work.byStatus.blocked ?? 0,
    activeReservationCount: rollup?.counts.reservations.active ?? 0,
    findings: input.findings,
    lastSeenAt: input.rollupProject?.generatedAt ?? input.rollupProject?.fetchedAt ?? input.entry.lastSeenAt ?? input.generatedAt
  };
}

function dashboardWorkFromRollup(rollup: ProjectRollupDocument): readonly WorkItemView[] {
  const byId = new Map<string, WorkItemView>();
  for (const work of rollup.next.work) {
    mergeWorkView(byId, {
      id: work.workId,
      title: work.title,
      kind: work.kind,
      status: work.status,
      priority: work.priority,
      labels: ["rollup"],
      dependencyIds: [],
      activeBlockerIds: [],
      blockedBy: [],
      evidenceCount: 0,
      verificationCount: 0,
      requiredCloseoutGates: [],
      contextSummary: `Rollup next-work sample updated at ${work.updatedAt}`
    });
  }
  for (const work of [...rollup.limbo.needsVerification, ...rollup.limbo.verified]) {
    mergeWorkView(byId, {
      id: work.workId,
      title: work.title,
      kind: "task",
      status: work.status,
      priority: "normal",
      labels: ["rollup", "limbo"],
      dependencyIds: [],
      activeBlockerIds: [],
      blockedBy: [],
      evidenceCount: 0,
      verificationCount: 0,
      requiredCloseoutGates: [],
      contextSummary: `Rollup limbo age ${work.ageDays.toFixed(1)} day(s)`
    });
  }
  for (const sample of rollup.enforcement.blockingGaps.samples) {
    mergeWorkView(byId, {
      id: sample.workId,
      title: sample.title,
      kind: "task",
      status: "blocked",
      priority: "normal",
      labels: ["rollup", "blocking-gap"],
      dependencyIds: sample.blockerIds,
      activeBlockerIds: sample.blockerIds,
      blockedBy: sample.blockerIds,
      evidenceCount: 0,
      verificationCount: 0,
      requiredCloseoutGates: [],
      contextSummary: `${sample.blockerIds.length} active blocker(s) from rollup sample`
    });
  }
  return [...byId.values()].sort(compareWorkViews).slice(0, DEFAULT_DASHBOARD_WORK_LIMIT);
}

function dashboardSearchFromRollup(rollup: ProjectRollupDocument): readonly GlobalSearchSourceRow[] {
  return rollup.next.work.slice(0, DEFAULT_DASHBOARD_SEARCH_LIMIT).map((work, index) => ({
    id: `rollup-next:${work.workId}`,
    type: "work",
    recordId: work.workId,
    title: work.title,
    summary: `${work.kind} ${work.status} from project rollup`,
    score: DEFAULT_DASHBOARD_SEARCH_LIMIT - index
  }));
}

function dashboardActivityFromRollup(rollup: ProjectRollupDocument): readonly GlobalActivitySourceRow[] {
  if (rollup.lastOperation) {
    return [{
      id: rollup.lastOperation.id,
      sessionId: "rollup",
      commandPath: rollup.lastOperation.commandPath,
      status: rollup.lastOperation.status,
      exitCode: rollup.lastOperation.status === "failed" ? 1 : 0,
      stateChanged: false,
      generatedArtifactsChanged: false,
      actorId: "rollup",
      actorKind: "system",
      startedAt: rollup.lastOperation.finishedAt,
      finishedAt: rollup.lastOperation.finishedAt,
      eventCount: 0
    }];
  }
  if (rollup.lastEvent) {
    return [{
      id: rollup.lastEvent.id,
      sessionId: "rollup",
      commandPath: rollup.lastEvent.type,
      status: "observed",
      exitCode: 0,
      stateChanged: true,
      generatedArtifactsChanged: false,
      actorId: "rollup",
      actorKind: "system",
      startedAt: rollup.lastEvent.at,
      finishedAt: rollup.lastEvent.at,
      eventCount: 1
    }];
  }
  return [];
}

function mergeWorkView(byId: Map<string, WorkItemView>, next: WorkItemView): void {
  const current = byId.get(next.id);
  if (!current) {
    byId.set(next.id, next);
    return;
  }
  const activeBlockerIds = uniqueStrings([...current.activeBlockerIds, ...next.activeBlockerIds]);
  byId.set(next.id, {
    ...current,
    labels: uniqueStrings([...current.labels, ...next.labels]),
    dependencyIds: uniqueStrings([...current.dependencyIds, ...next.dependencyIds]),
    activeBlockerIds,
    blockedBy: activeBlockerIds,
    contextSummary: current.contextSummary ?? next.contextSummary
  });
}

function syncDashboardViewFromRollupProject(
  entry: CoreProjectRegistryEntry,
  rollupProject: GlobalRollupCacheProject | undefined,
  generatedAt: string
): SyncDashboardView {
  const ok = Boolean(rollupProject?.rollup) &&
    !rollupProjectMissing(entry) &&
    rollupProject?.status === "fresh" &&
    rollupProject.rollup?.health.syncOk !== false &&
    rollupProject.rollup?.health.doctorOk !== false;
  return {
    generatedAt,
    ok,
    workspaceRoot: entry.projectRoot,
    vaultOk: ok,
    ledgersOk: ok,
    searchIndexOk: ok,
    gitOk: ok,
    recommendedActions: [],
    findings: []
  };
}

function daemonStatusFromRollupProject(
  entry: CoreProjectRegistryEntry,
  rollupProject: GlobalRollupCacheProject | undefined,
  generatedAt: string
): DaemonStatusResult {
  if (rollupProjectMissing(entry) || rollupProject?.status === "degraded") {
    return daemonStatusUnavailable(entry.projectRoot, generatedAt, new Error(rollupProject?.error ?? "Project rollup unavailable"));
  }
  return {
    schemaVersion: "boreal.daemon.status.v1",
    generatedAt,
    workspaceRoot: entry.projectRoot,
    statusPath: join(resolve(entry.projectRoot), ".boreal", "daemon", "status.json"),
    state: "stopped",
    locks: {
      runtime: {
        path: join(resolve(entry.projectRoot), ".boreal", "runtime", "state.lock"),
        exists: false,
        stale: false,
        status: "clear"
      },
      searchIndex: {
        path: join(resolve(entry.projectRoot), ".boreal", "runtime", "search-index.lock"),
        exists: false,
        stale: false,
        status: "clear"
      }
    },
    watch: {
      paths: [],
      writesTruth: false,
      repairsAreCommandMediated: true
    },
    findings: [],
    recommendedActions: [],
    agentDirectives: [],
    directiveObligations: unavailableDaemonDirectiveObligations(generatedAt)
  };
}

function dashboardFindingsFromRollupProject(
  entry: CoreProjectRegistryEntry,
  rollupProject: GlobalRollupCacheProject | undefined
): readonly DashboardFinding[] {
  const findings: DashboardFinding[] = [];
  if (rollupProjectMissing(entry)) {
    findings.push({
      code: "dashboard.project_missing",
      title: "dashboard.project_missing",
      severity: "error",
      status: "failed",
      message: "Registered project root is missing",
      source: entry.projectRoot,
      actions: []
    });
  }
  if (!rollupProject) {
    findings.push({
      code: "dashboard.project_rollup_unavailable",
      title: "dashboard.project_rollup_unavailable",
      severity: "error",
      status: "failed",
      message: "No rollup cache row exists for this registry entry",
      source: entry.projectRoot,
      actions: []
    });
    return findings;
  }
  if (rollupProject.error) {
    const severity = rollupProject.rollup ? "warning" : "error";
    findings.push({
      code: "dashboard.project_rollup_unavailable",
      title: "dashboard.project_rollup_unavailable",
      severity,
      status: severity === "error" ? "failed" : "warning",
      message: rollupProject.error,
      source: rollupProject.sourceRollupPath,
      actions: []
    });
  }
  if (rollupProject.stale || rollupProject.status === "stale") {
    findings.push({
      code: "dashboard.project_rollup_stale",
      title: "dashboard.project_rollup_stale",
      severity: "warning",
      status: "warning",
      message: `Project rollup cache is stale after ${rollupProject.cacheAgeMs ?? 0}ms`,
      source: rollupProject.cachePath,
      actions: []
    });
  }
  if (rollupProject.rollup?.health.doctorOk === false) {
    findings.push({
      code: "dashboard.project_doctor_not_ok",
      title: "dashboard.project_doctor_not_ok",
      severity: "warning",
      status: "warning",
      message: "Project rollup reports doctor not ok",
      source: rollupProject.sourceRollupPath,
      actions: []
    });
  }
  if (rollupProject.rollup?.health.syncOk === false) {
    findings.push({
      code: "dashboard.project_sync_not_ok",
      title: "dashboard.project_sync_not_ok",
      severity: "warning",
      status: "warning",
      message: "Project rollup reports sync not ok",
      source: rollupProject.sourceRollupPath,
      actions: []
    });
  }
  return findings;
}

function rollupProjectHealthState(
  entry: CoreProjectRegistryEntry,
  rollupProject: GlobalRollupCacheProject | undefined,
  findings: readonly DashboardFinding[]
): DashboardProjectRegistryEntry["health"] {
  if (rollupProjectMissing(entry)) {
    return "missing";
  }
  if (findings.some((finding) => finding.severity === "error")) {
    return "error";
  }
  if (!rollupProject?.rollup || rollupProject.status === "degraded") {
    return "error";
  }
  if (rollupProject.stale || rollupProject.status === "stale" || rollupProject.rollup.health.doctorOk === false || rollupProject.rollup.health.syncOk === false) {
    return "warning";
  }
  return "ok";
}

function rollupSyncFreshness(
  entry: CoreProjectRegistryEntry,
  rollupProject: GlobalRollupCacheProject | undefined
): ProjectSyncFreshness {
  if (rollupProjectMissing(entry) || !rollupProject?.rollup) {
    return "unknown";
  }
  if (rollupProject.stale || rollupProject.status === "stale" || rollupProject.rollup.health.syncOk === false) {
    return "stale";
  }
  return "fresh";
}

function rollupProjectMissing(entry: CoreProjectRegistryEntry): boolean {
  return !existsSync(entry.projectRoot);
}

function openWorkCountFromRollup(rollup: ProjectRollupDocument): number {
  return rollup.counts.work.total -
    rollup.counts.work.byStatus.closed -
    rollup.counts.work.byStatus.cancelled -
    rollup.counts.work.byStatus.verified;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function daemonStatusUnavailable(workspaceRoot: string, generatedAt: string, error: unknown): DaemonStatusResult {
  return {
    schemaVersion: "boreal.daemon.status.v1",
    generatedAt,
    workspaceRoot,
    statusPath: join(resolve(workspaceRoot), ".boreal", "daemon", "status.json"),
    state: "missing",
    locks: {
      runtime: {
        path: join(resolve(workspaceRoot), ".boreal", "runtime", "state.lock"),
        exists: false,
        stale: false,
        status: "clear"
      },
      searchIndex: {
        path: join(resolve(workspaceRoot), ".boreal", "runtime", "search-index.lock"),
        exists: false,
        stale: false,
        status: "clear"
      }
    },
    watch: {
      paths: [],
      writesTruth: false,
      repairsAreCommandMediated: true
    },
    findings: [
      {
        code: "daemon.project_unreadable",
        severity: "error",
        message: error instanceof Error ? error.message : String(error)
      }
    ],
    recommendedActions: [],
    agentDirectives: [],
    directiveObligations: unavailableDaemonDirectiveObligations(generatedAt)
  };
}

function unavailableDaemonDirectiveObligations(generatedAt: string): DaemonStatusResult["directiveObligations"] {
  const obligationGeneratedAt = isIsoTimestamp(generatedAt) ? generatedAt : nowIso();
  return {
    schemaVersion: "boreal.agent-runtime.directive-obligations.v1",
    generatedAt: obligationGeneratedAt,
    context: "health",
    ok: true,
    agentDirectives: [],
    summary: {
      context: "health",
      bundleCount: 0,
      directiveCount: 0,
      selectedRegistryIds: [],
      emittedRegistryIds: [],
      advisoryRegistryIds: [],
      requiredRegistryIds: [],
      blockingRegistryIds: [],
      closeoutBlockingRegistryIds: [],
      advisoryCount: 0,
      requiredCount: 0,
      blockingCount: 0,
      closeoutBlockingCount: 0,
      conflictCount: 0,
      deprecationCount: 0,
      missingRequiredCount: 0
    },
    selectedRegistryIds: [],
    dataByRegistryId: {},
    issues: [],
    missingRequired: []
  };
}

async function dashboardProjectContext(parentContext: CliContext, workspaceRoot: string): Promise<CliContext> {
  if (resolve(workspaceRoot) === parentContext.workspaceRoot) {
    return parentContext;
  }
  return createCliContext({
    command: [],
    flags: new Map<string, readonly string[]>([
      ["workspace", [workspaceRoot]],
      ["session", [parentContext.sessionId]],
      ["actor", [parentContext.actor.id]],
      ["actor-kind", [parentContext.actor.kind]]
    ])
  }, parentContext.cwd, { sessionId: parentContext.sessionId });
}

async function dashboardWork(context: CliContext): Promise<readonly WorkItemView[]> {
  const work = await context.store.read((reader) => reader.listWorkItems());
  return work.map((item) => toWorkItemView({ work: item })).sort(compareWorkViews).slice(0, DEFAULT_DASHBOARD_WORK_LIMIT);
}

async function dashboardOperations(context: CliContext): Promise<readonly GlobalActivitySourceRow[]> {
  return context.store.read(async (reader) => {
    const operations = await reader.listOperations();
    return [...operations]
      .sort(compareOperationsNewestFirst)
      .slice(0, DEFAULT_DASHBOARD_ACTIVITY_LIMIT)
      .map(operationListRow);
  });
}

async function dashboardSearch(
  context: CliContext,
  query: string
): Promise<{ readonly results: readonly GlobalSearchSourceRow[]; readonly error?: string }> {
  try {
    return {
      results: (await runSearch(context, query, { limit: DEFAULT_DASHBOARD_SEARCH_LIMIT })).map((result) => ({
        id: result.id,
        type: result.type,
        recordId: result.recordId,
        title: result.title,
        summary: result.summary,
        score: result.score
      }))
    };
  } catch (error) {
    return { results: [], error: error instanceof Error ? error.message : String(error) };
  }
}

function dashboardEntryFromMetrics(input: {
  readonly entry: CoreProjectRegistryEntry;
  readonly generatedAt: string;
  readonly work: readonly WorkItemView[];
  readonly sync: SyncDashboardView;
  readonly findings: readonly DashboardFinding[];
  readonly activeReservationCount: number;
}): DashboardProjectRegistryEntry {
  const openWorkCount = input.work.filter((item) => isOpenWorkStatus(item.status)).length;
  const readyWorkCount = input.work.filter((item) => item.status === "ready").length;
  const blockedWorkCount = input.work.filter((item) => item.status === "blocked").length;
  const syncFreshness: ProjectSyncFreshness = input.sync.ok ? "fresh" : "stale";
  const stale = syncFreshness === "stale" || input.findings.some((finding) => finding.severity !== "info");
  return {
    id: input.entry.id,
    name: input.entry.display.name,
    lifecycle: input.entry.lifecycle,
    projectRoot: input.entry.projectRoot,
    memoryRoot: input.entry.memoryRoot,
    memoryLayout: input.entry.memoryLayout,
    memoryGitMode: input.entry.memoryGitMode,
    installRoot: input.entry.installRoot,
    bwrkPin: input.entry.bwrkPin,
    health: projectHealthState(input.sync.ok, input.findings),
    stale,
    syncFreshness,
    openWorkCount,
    readyWorkCount,
    blockedWorkCount,
    activeReservationCount: input.activeReservationCount,
    findings: input.findings,
    lastSeenAt: input.entry.lastSeenAt ?? input.generatedAt
  };
}

function dashboardSettingsFromEntry(
  entry: CoreProjectRegistryEntry,
  dashboardEntry: DashboardProjectRegistryEntry
): GlobalSettingsProjectInput {
  return {
    projectId: dashboardEntry.id,
    projectName: dashboardEntry.name,
    projectRoot: dashboardEntry.projectRoot,
    memoryRoot: dashboardEntry.memoryRoot,
    memoryLayout: dashboardEntry.memoryLayout,
    memoryGitMode: dashboardEntry.memoryGitMode,
    memoryRemote: entry.memoryRemote,
    installRoot: dashboardEntry.installRoot,
    source: entry.source,
    health: dashboardEntry.health,
    stale: dashboardEntry.stale
  };
}

function syncDashboardViewFromStatus(sync: SyncStatusResult, generatedAt: string): SyncDashboardView {
  return {
    generatedAt,
    ok: sync.ok,
    workspaceRoot: sync.workspaceRoot,
    vaultOk: sync.vault.ok,
    ledgersOk: sync.ledgers.ok,
    searchIndexOk: sync.searchIndex.ok,
    gitOk: sync.git.ok,
    recommendedActions: sync.recommendedActions.map((command) => ({ label: command, command })),
    findings: []
  };
}

function syncDashboardViewFromFailure(workspaceRoot: string, generatedAt: string): SyncDashboardView {
  return {
    generatedAt,
    ok: false,
    workspaceRoot,
    vaultOk: false,
    ledgersOk: false,
    searchIndexOk: false,
    gitOk: false,
    recommendedActions: [],
    findings: []
  };
}

function dashboardFindingsFromDiagnostics(diagnostics: readonly Diagnostic[]): readonly DashboardFinding[] {
  return diagnostics.flatMap((diagnostic): readonly DashboardFinding[] => {
    const severity = dashboardDiagnosticSeverity(diagnostic.severity);
    if (severity === "info") {
      return [];
    }
    return [{
      code: diagnostic.code,
      title: diagnostic.code,
      severity,
      status: severity === "error" ? "failed" : severity === "warning" ? "warning" : "ok",
      message: diagnostic.message,
      source: diagnosticSourcePath(diagnostic),
      actions: diagnosticRepairCommand(diagnostic) ? [{ label: "Repair", command: diagnosticRepairCommand(diagnostic) }] : []
    }];
  });
}

function dashboardRegistryFindingsByProject(result: RegistryDoctorResult): ReadonlyMap<string, readonly DashboardFinding[]> {
  const byProject = new Map<string, DashboardFinding[]>();
  for (const finding of result.findings) {
    if (finding.severity === "ok") {
      continue;
    }
    const projectId = finding.projectId ?? "registry";
    byProject.set(projectId, [
      ...(byProject.get(projectId) ?? []),
      {
        code: finding.code,
        title: finding.code,
        severity: dashboardDiagnosticSeverity(finding.severity),
        status: finding.severity === "error" ? "failed" : "warning",
        message: finding.message,
        source: finding.path,
        actions: diagnosticRepairCommand(finding) ? [{ label: "Repair", command: diagnosticRepairCommand(finding) }] : []
      }
    ]);
  }
  return byProject;
}

function lockDashboardViewFromDiagnostics(
  diagnostics: readonly Diagnostic[],
  workspaceRoot: string,
  generatedAt: string
): LockDashboardView {
  const locks = diagnostics.flatMap((diagnostic) => {
    if (!diagnostic.code.startsWith("lock.")) {
      return [];
    }
    return [{
      domain: diagnostic.code,
      path: ".boreal/locks",
      status: diagnostic.severity === "ok" ? "clear" as const : "stale" as const,
      repairCommand: diagnostic.severity === "ok" ? undefined : "bwrk doctor --fix --json"
    }];
  });
  return {
    generatedAt,
    ok: locks.every((lock) => lock.status === "clear"),
    workspaceRoot,
    locks
  };
}

function dashboardDiagnosticSeverity(value: string): DashboardFinding["severity"] {
  if (value === "error" || value === "warning") {
    return value;
  }
  return "info";
}

function diagnosticSourcePath(diagnostic: { readonly details?: unknown; readonly path?: string }): string | undefined {
  if (typeof diagnostic.path === "string") {
    return diagnostic.path;
  }
  const details = diagnostic.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const record = details as Record<string, unknown>;
    for (const key of ["path", "configPath", "projectRoot", "workspaceRoot", "memoryRoot", "gitRoot", "rootDir", "statePath", "indexPath", "file"]) {
      const value = record[key];
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }
  }
  return undefined;
}

function diagnosticRepairCommand(diagnostic: { readonly details?: unknown; readonly repairCommand?: string }): string | undefined {
  if (typeof diagnostic.repairCommand === "string") {
    return diagnostic.repairCommand;
  }
  const details = diagnostic.details;
  if (details && typeof details === "object" && !Array.isArray(details)) {
    const repairCommand = (details as Record<string, unknown>).repairCommand;
    return typeof repairCommand === "string" ? repairCommand : undefined;
  }
  return undefined;
}

async function currentWorkspaceDashboardRegistryEntry(
  context: CliContext,
  generatedAt: string
): Promise<CoreProjectRegistryEntry> {
  let config: Awaited<ReturnType<typeof readProjectSetupConfig>>;
  try {
    config = await readProjectSetupConfig(context.workspaceRoot);
  } catch {
    config = undefined;
  }
  const projectRoot = context.workspaceRoot;
  const memoryRoot = resolve(config?.memoryRoot ?? join(projectRoot, "memory"));
  const identity = deriveProjectRegistryIdentity({
    projectRoot,
    projectConfig: config as unknown as Readonly<Record<string, unknown>> | undefined
  });
  return {
    id: projectRegistryEntryIdFromIdentity(identity),
    identity,
    lifecycle: "linked",
    display: {
      name: basename(projectRoot),
      labels: []
    },
    projectRoot,
    borealDir: join(projectRoot, ".boreal"),
    runtimeDir: join(projectRoot, ".boreal", "runtime"),
    runtimeStateFile: join(projectRoot, ".boreal", "runtime", "state.json"),
    projectConfigPath: join(projectRoot, ".boreal", "project.json"),
    memoryRoot,
    memoryBorealDir: join(memoryRoot, ".boreal"),
    memoryLayout: config?.memoryLayout ?? "in-repo",
    memoryGitMode: config?.memoryGitMode ?? "separate",
    memoryRemote: config?.memoryRemote,
    installRoot: resolve(config?.installRoot ?? join(projectRoot, ".agents", "skills")),
    skillTargets: config?.skillTargets ?? [],
    folderScoped: config?.folderScoped ?? false,
    source: config ? "project-setup" : "explicit",
    addedAt: generatedAt,
    updatedAt: generatedAt,
    lastSeenAt: generatedAt
  };
}

function isOpenWorkStatus(status: WorkItemView["status"]): boolean {
  return status !== "closed" && status !== "cancelled" && status !== "verified";
}

function projectHealthState(syncOk: boolean, findings: readonly DashboardFinding[]): DashboardProjectRegistryEntry["health"] {
  if (findings.some((finding) => finding.severity === "error")) {
    return "error";
  }
  if (!syncOk || findings.some((finding) => finding.severity === "warning")) {
    return "warning";
  }
  return "ok";
}

function formatGlobalDashboardSummary(result: Awaited<ReturnType<typeof buildGlobalDashboardResult>>): string {
  const inbox = result.globalInbox.summary;
  const inboxLine = `Inbox queued ${inbox.queued}, oldest ${inbox.oldestQueuedAgeDays ?? "-"} day(s), threshold ${result.globalInbox.policy.agingThresholdDays} day(s), aging ${inbox.agingQueuedCount}`;
  return `${inboxLine}\n${table(
    result.registry.entries.map((entry) => ({
      project: entry.name,
      health: entry.health,
      open: entry.openWorkCount,
      ready: entry.readyWorkCount,
      blocked: entry.blockedWorkCount,
      stale: entry.stale ? "yes" : "no"
    }))
  )}`;
}

function formatGlobalStatus(result: GlobalStatusResult): string {
  const header = `[${result.errorCount === 0 ? "ok" : "warning"}] global status: ${result.okCount}/${result.projectCount} project(s) readable`;
  if (result.projects.length === 0) {
    return `${header}\nNo registered projects at ${result.registryFile}\n`;
  }
  const rows = result.projects.map((project) => ({
    project: project.projectId,
    ok: project.ok ? "yes" : "no",
    storage: project.storage ?? "unknown",
    open: project.workOpen ?? "-",
    ready: project.workReady ?? "-",
    blocked: project.workBlocked ?? "-",
    reservations: project.activeReservations ?? "-",
    lastEventAt: project.lastEventAt ?? "-",
    root: project.rootDir,
    error: project.error ?? ""
  }));
  return `${header}\n${table(rows)}`;
}

function operationListRow(operation: RuntimeOperation): GlobalActivitySourceRow {
  return {
    id: operation.meta.id,
    sessionId: operation.sessionId,
    commandPath: operation.commandPath,
    status: operation.status,
    exitCode: operation.exitCode,
    stateChanged: operation.stateChanged,
    generatedArtifactsChanged: operation.generatedArtifactsChanged,
    actorId: operation.actorId,
    actorKind: operation.meta.createdBy.kind,
    startedAt: operation.startedAt,
    finishedAt: operation.finishedAt,
    eventCount: operation.eventIds.length
  };
}

function compareOperationsNewestFirst(left: RuntimeOperation, right: RuntimeOperation): number {
  return (
    Date.parse(right.finishedAt) - Date.parse(left.finishedAt) ||
    Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
    right.meta.id.localeCompare(left.meta.id)
  );
}

function compareWorkViews(left: WorkItemView, right: WorkItemView): number {
  return (
    priorityRank(right.priority) - priorityRank(left.priority) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function priorityRank(priority: WorkPriority): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
  }
}

function parseLimit(value: string | undefined, options: { readonly max?: number } = {}): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", "--limit must be a positive integer");
  }
  const max = options.max ?? MAX_LIST_LIMIT;
  if (parsed > max) {
    throw new BorealError("BOREAL_INVALID_INPUT", `--limit must be at most ${max}`);
  }
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, label: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be a non-negative integer`);
  }
  return parsed;
}

function parseBoundedNonNegativeInteger(value: string | undefined, label: string, max: number): number | undefined {
  const parsed = parseNonNegativeInteger(value, label);
  if (parsed === undefined) {
    return undefined;
  }
  if (parsed > max) {
    throw new BorealError("BOREAL_INVALID_INPUT", `${label} must be at most ${max}`);
  }
  return parsed;
}

function shellArg(value: string): string {
  if (/^[A-Za-z0-9_./:@=-]+$/.test(value)) {
    return value;
  }
  return `'${value.replace(/'/g, "'\\''")}'`;
}
