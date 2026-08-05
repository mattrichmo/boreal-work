import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  compileAgentRuntimeDirectiveObligations,
  type AgentRuntimeDirectiveContext,
  type AgentRuntimeDirectiveObligations,
  type AgentRuntimeDirectiveObligationsInput
} from "@boreal/agent-runtime";
import {
  AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
  BorealError,
  bindMcpProjectBoundary,
  createAgentDirectiveSnapshot,
  hashContent,
  nowIso,
  safeParseJson,
  resolveProjectRegistryPaths,
  resolveWorkspacePaths,
  type AgentDirectiveBundle,
  type AgentDirectiveDiagnosticSnapshot,
  type AgentDirectiveSnapshot,
  type AgentReservation,
  type ContentHash,
  type IsoTimestamp,
  type McpProjectBoundary,
  type ProjectRegistryMemoryLayout,
  type ProjectRollupDocument,
  type ProjectRollupWorkIndexEntry,
  type WorkId
} from "@boreal/core";
import { createBorealRuntime, type ExternalDependencyResolution } from "@boreal/engine";
import {
  FileBorealStore,
  ObjectDirBorealStore,
  inspectFileLock,
  objectIndexPath,
  writeTextFileAtomic,
  type BorealStore,
  type FileLockInspection
} from "@boreal/storage";

import { emptyGlobalRollupCacheResult, refreshGlobalRollupCache, type GlobalRollupCacheResult } from "./global-rollup-cache.js";

export const DAEMON_STATUS_SCHEMA_VERSION = "boreal.daemon.status.v1";
export const DAEMON_WATCH_SCHEMA_VERSION = "boreal.daemon.watch.v1";
const DAEMON_WATCH_INTERVAL_MS = 30_000;
const DAEMON_RESERVATION_RENEWAL_WINDOW_MS = DAEMON_WATCH_INTERVAL_MS * 2;
const DAEMON_RESERVATION_LEASE_MS = 30 * 60_000;
const MAX_DAEMON_DIAGNOSTIC_DEPTH = 4;
const MAX_DAEMON_DIAGNOSTIC_ITEMS = 24;
const MAX_DAEMON_DIAGNOSTIC_STRING_LENGTH = 1_000;
const SENSITIVE_DAEMON_DIAGNOSTIC_KEY = /(authorization|api[-_]?key|cookie|credential|password|private[-_]?key|secret|token)/iu;

export type DaemonState = "missing" | "stopped" | "running" | "stale" | "drift";
export type DaemonWatchAction = "observed" | "skipped";

export interface DaemonFinding {
  readonly code: string;
  readonly severity: "info" | "warning" | "error";
  readonly message: string;
  readonly repairCommand?: string;
  readonly details?: unknown;
}

export interface DaemonStatusFile {
  readonly schemaVersion: typeof DAEMON_STATUS_SCHEMA_VERSION;
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: ProjectRegistryMemoryLayout;
  readonly pid: number;
  readonly state: "running" | "stopped";
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stoppedAt?: string;
}

export interface DaemonStatusResult {
  readonly schemaVersion: typeof DAEMON_STATUS_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly projectRoot?: string;
  readonly memoryRoot?: string;
  readonly memoryLayout?: ProjectRegistryMemoryLayout;
  readonly statusPath: string;
  readonly state: DaemonState;
  readonly pid?: number;
  readonly processAlive?: boolean;
  readonly locks: {
    readonly runtime: DaemonLockStatus;
    readonly searchIndex: DaemonLockStatus;
  };
  readonly watch: {
    readonly paths: readonly string[];
    readonly writesTruth: false;
    readonly repairsAreCommandMediated: true;
  };
  readonly findings: readonly DaemonFinding[];
  readonly recommendedActions: readonly string[];
  readonly agentDirectives: readonly AgentDirectiveBundle[];
  readonly directiveObligations: AgentRuntimeDirectiveObligations;
}

export interface DaemonWatchResult {
  readonly schemaVersion: typeof DAEMON_WATCH_SCHEMA_VERSION;
  readonly globalReadiness: DaemonGlobalReadinessSummary;
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly action: DaemonWatchAction;
  readonly reason?: string;
  readonly status: DaemonStatusResult;
  readonly globalRollups: GlobalRollupCacheResult;
  readonly reservationRenewals: DaemonReservationRenewalSummary;
  readonly executionRuns: DaemonExecutionRunSummary;
  readonly observedPaths: readonly string[];
  readonly recommendedActions: readonly string[];
}

export interface DaemonExecutionRunSummary {
  readonly enabled: true;
  readonly expired: readonly string[];
  readonly requeued: readonly string[];
}

export interface DaemonGlobalReadinessSummary {
  readonly enabled: true;
  readonly evaluated: number;
  readonly changed: number;
  readonly blocked: number;
  readonly skippedReason?: string;
}

export interface DaemonRuntimeOptions {
  readonly workspaceRoot: string;
  readonly registryRoot?: string;
  readonly liveCacheTtlMs?: number;
  readonly pidExists?: (pid: number) => boolean;
  readonly now?: () => string;
}

export interface DaemonDirectiveObligationsResult extends AgentRuntimeDirectiveObligations {
  readonly workspaceRoot: string;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: ProjectRegistryMemoryLayout;
}

export interface DaemonDirectiveObligationsInput extends AgentRuntimeDirectiveObligationsInput {
  readonly workspaceRoot: string;
}

interface DaemonProjectBinding {
  readonly boundary?: McpProjectBoundary;
  readonly findings: readonly DaemonFinding[];
}

interface DaemonLockStatus {
  readonly path: string;
  readonly exists: boolean;
  readonly stale: boolean;
  readonly status: "clear" | "active" | "stale";
  readonly ownerPid?: number;
  readonly ageMs?: number;
}

interface ProjectSetupLike {
  readonly projectRoot?: string;
  readonly memoryRoot?: string;
  readonly memoryLayout?: ProjectRegistryMemoryLayout;
  readonly storage?: DaemonProjectStorageKind;
  readonly setupError?: DaemonSetupError;
}

interface DaemonSetupError {
  readonly code: string;
  readonly message: string;
  readonly details: unknown;
}

type DaemonProjectStorageKind = "file-v2" | "objects-v1";

interface DaemonReservationRenewalRow {
  readonly workId: WorkId;
  readonly reservationId: string;
  readonly agentId: string;
  readonly previousExpiresAt?: string;
  readonly expiresAt: string;
}

interface DaemonReservationRenewalSkippedRow {
  readonly workId: WorkId;
  readonly reservationId: string;
  readonly agentId: string;
  readonly reason: string;
}

export interface DaemonReservationRenewalSummary {
  readonly enabled: true;
  readonly windowMs: number;
  readonly leaseMs: number;
  readonly renewed: readonly DaemonReservationRenewalRow[];
  readonly skipped: readonly DaemonReservationRenewalSkippedRow[];
}

export async function inspectDaemonStatus(options: DaemonRuntimeOptions): Promise<DaemonStatusResult> {
  const generatedAt = (options.now?.() ?? nowIso()) as IsoTimestamp;
  const workspaceRoot = resolve(options.workspaceRoot);
  const statusPath = daemonStatusPath(workspaceRoot);
  const binding = await bindDaemonProject(workspaceRoot);
  const locks = await inspectDaemonLocks(workspaceRoot);
  const watchPaths = daemonWatchPaths(workspaceRoot);
  const recommendedActions = new Set<string>();
  const findings: DaemonFinding[] = [...binding.findings, ...lockFindings(locks)];
  for (const finding of findings) {
    if (finding.repairCommand) {
      recommendedActions.add(finding.repairCommand);
    }
  }

  if (!binding.boundary) {
    return withDaemonDirectiveObligations(daemonStatusResult({
      generatedAt,
      workspaceRoot,
      statusPath,
      state: existsSync(workspaceRoot) ? "drift" : "missing",
      locks,
      watchPaths,
      findings,
      recommendedActions: [...recommendedActions]
    }));
  }

  const statusFile = await readDaemonStatusFile(statusPath);
  if (!statusFile) {
    return withDaemonDirectiveObligations(daemonStatusResult({
      generatedAt,
      workspaceRoot,
      projectRoot: binding.boundary.projectRoot,
      memoryRoot: binding.boundary.memoryRoot,
      memoryLayout: binding.boundary.memoryLayout,
      statusPath,
      state: "stopped",
      locks,
      watchPaths,
      findings,
      recommendedActions: [...recommendedActions]
    }));
  }

  findings.push(...statusFileFindings(statusFile, binding.boundary));
  const processAlive = statusFile.pid > 0 ? (options.pidExists ?? defaultPidExists)(statusFile.pid) : false;
  if (statusFile.state === "running" && !processAlive) {
    findings.push({
      code: "daemon.pid_stale",
      severity: "warning",
      message: "Daemon status file points at a non-running process",
      repairCommand: "bwrk daemon status --json"
    });
    recommendedActions.add("Remove .boreal/daemon/status.json or restart the daemon");
  }
  for (const finding of findings) {
    if (finding.repairCommand) {
      recommendedActions.add(finding.repairCommand);
    }
  }

  const drift = findings.some((finding) => finding.code === "daemon.status_drift");
  const state: DaemonState = drift
    ? "drift"
    : statusFile.state === "stopped"
      ? "stopped"
      : processAlive
        ? "running"
        : "stale";

  return withDaemonDirectiveObligations(daemonStatusResult({
    generatedAt,
    workspaceRoot,
    projectRoot: binding.boundary.projectRoot,
    memoryRoot: binding.boundary.memoryRoot,
    memoryLayout: binding.boundary.memoryLayout,
    statusPath,
    state,
    pid: statusFile.pid,
    processAlive,
    locks,
    watchPaths,
    findings,
    recommendedActions: [...recommendedActions]
  }));
}

export async function runDaemonWatchOnce(options: DaemonRuntimeOptions): Promise<DaemonWatchResult> {
  const status = await inspectDaemonStatus(options);
  const lockConflict = status.locks.runtime.status !== "clear" || status.locks.searchIndex.status !== "clear";
  const action: DaemonWatchAction = status.state === "missing" || status.state === "drift" || lockConflict ? "skipped" : "observed";
  const reason = status.state === "missing" || status.state === "drift"
    ? "project_boundary_unhealthy"
    : lockConflict
      ? "lock_conflict"
      : undefined;
  const generatedAt = (options.now?.() ?? nowIso()) as IsoTimestamp;
  const reservationRenewals = action === "observed"
    ? await renewDaemonReservations(status.workspaceRoot, generatedAt)
    : emptyDaemonReservationRenewals();
  const executionRuns = action === "observed"
    ? await reconcileDaemonRuns(status.workspaceRoot, generatedAt)
    : emptyDaemonExecutionRuns();
  const globalRollups = action === "observed"
    ? await refreshGlobalRollupCache({
        registryRoot: options.registryRoot,
        ttlMs: options.liveCacheTtlMs,
        source: "daemon",
        now: () => generatedAt
      })
    : emptyGlobalRollupCacheResult({
        registryRoot: options.registryRoot,
        ttlMs: options.liveCacheTtlMs,
        source: "daemon",
        now: () => generatedAt
      });
  const globalReadiness = action === "observed"
    ? await recomputeGlobalReadinessFromRollups({
        registryRoot: options.registryRoot,
        globalRollups
      })
    : emptyGlobalReadiness("watch skipped");

  return {
    schemaVersion: DAEMON_WATCH_SCHEMA_VERSION,
    globalReadiness,
    generatedAt,
    workspaceRoot: status.workspaceRoot,
    action,
    reason,
    status,
    globalRollups,
    reservationRenewals,
    executionRuns,
    observedPaths: action === "observed" ? status.watch.paths : [],
    recommendedActions: status.recommendedActions
  };
}

async function reconcileDaemonRuns(workspaceRoot: string, generatedAt: IsoTimestamp): Promise<DaemonExecutionRunSummary> {
  const setup = await readProjectSetup(workspaceRoot);
  const runtime = createBorealRuntime({
    store: daemonStore(workspaceRoot, setup.storage),
    actor: { id: "boreal-daemon", kind: "system", displayName: "Boreal daemon" },
    clock: () => new Date(Date.parse(generatedAt)),
    workspaceRoot
  });
  const result = await runtime.runs.reconcile();
  return { enabled: true, expired: result.expired, requeued: result.requeued };
}

function emptyDaemonExecutionRuns(): DaemonExecutionRunSummary {
  return { enabled: true, expired: [], requeued: [] };
}

async function recomputeGlobalReadinessFromRollups(input: {
  readonly registryRoot?: string;
  readonly globalRollups: GlobalRollupCacheResult;
}): Promise<DaemonGlobalReadinessSummary> {
  const globalRoot = resolveProjectRegistryPaths({ rootDir: input.registryRoot }).rootDir;
  const paths = resolveWorkspacePaths(globalRoot);
  if (!existsSync(paths.borealDir)) {
    return emptyGlobalReadiness("global workspace not initialized");
  }
  const runtime = createBorealRuntime({ store: new FileBorealStore({ rootDir: globalRoot }) });
  const result = await runtime.recomputeExternalReadiness({
    resolveExternalDependency: (edge) => externalDependencyResolutionFromRollups(edge, input.globalRollups)
  });
  return {
    enabled: true,
    evaluated: result.evaluated,
    changed: result.changed,
    blocked: result.blocked
  };
}

function emptyGlobalReadiness(skippedReason: string): DaemonGlobalReadinessSummary {
  return {
    enabled: true,
    evaluated: 0,
    changed: 0,
    blocked: 0,
    skippedReason
  };
}

function externalDependencyResolutionFromRollups(
  edge: { readonly fromProjectId?: string; readonly fromId: string },
  rollups: GlobalRollupCacheResult
): ExternalDependencyResolution {
  const projectId = edge.fromProjectId ?? "unknown";
  const workId = edge.fromId as WorkId;
  const referenceUri = `boreal://${projectId}/${workId}`;
  const project = rollups.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) {
    return unresolvedExternalDependency(referenceUri, projectId, workId, rollups.registryError ?? "project not found in global rollup cache");
  }
  if (project.stale || project.status === "stale") {
    return {
      referenceUri,
      projectId,
      workId,
      terminal: false,
      reason: "stale",
      message: project.error ?? `project rollup cache is stale after ${project.cacheAgeMs ?? 0}ms`
    };
  }
  if (!project.rollup || project.status === "degraded") {
    return unresolvedExternalDependency(referenceUri, projectId, workId, project.error ?? "project rollup unavailable");
  }
  const work = projectRollupWorkIndexEntry(project.rollup, workId);
  if (!work) {
    return unresolvedExternalDependency(
      referenceUri,
      projectId,
      workId,
      project.rollup.workIndex ? "work record not present in project rollup workIndex" : "project rollup does not include workIndex"
    );
  }
  const terminal = isTerminalWorkStatus(work.status);
  return {
    referenceUri,
    projectId,
    workId,
    terminal,
    status: work.status,
    title: work.title,
    ...(terminal ? {} : { reason: "open" as const, message: `referenced work is ${work.status}` })
  };
}

function unresolvedExternalDependency(
  referenceUri: string,
  projectId: string,
  workId: WorkId,
  message: string
): ExternalDependencyResolution {
  return {
    referenceUri,
    projectId,
    workId,
    terminal: false,
    reason: "unresolved",
    message
  };
}

function projectRollupWorkIndexEntry(
  rollup: ProjectRollupDocument,
  workId: WorkId
): ProjectRollupWorkIndexEntry | undefined {
  return rollup.workIndex?.work.find((entry) => entry.workId === workId);
}

function isTerminalWorkStatus(status: ProjectRollupWorkIndexEntry["status"]): boolean {
  return status === "closed" || status === "cancelled" || status === "verified";
}

export async function compileDaemonDirectiveObligations(
  input: DaemonDirectiveObligationsInput
): Promise<DaemonDirectiveObligationsResult> {
  const workspaceRoot = resolve(input.workspaceRoot);
  const binding = await bindDaemonProject(workspaceRoot);
  if (!binding.boundary) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Cannot compile daemon directive obligations for an unhealthy project boundary", {
      workspaceRoot,
      findings: binding.findings
    });
  }
  return {
    workspaceRoot,
    projectRoot: binding.boundary.projectRoot,
    memoryRoot: binding.boundary.memoryRoot,
    memoryLayout: binding.boundary.memoryLayout,
    ...compileAgentRuntimeDirectiveObligations(input)
  };
}

export async function writeDaemonRunningStatus(options: DaemonRuntimeOptions): Promise<DaemonStatusFile> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const binding = await bindDaemonProject(workspaceRoot);
  if (!binding.boundary) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Cannot write daemon status for an unhealthy project boundary", {
      workspaceRoot,
      findings: binding.findings
    });
  }
  const now = options.now?.() ?? nowIso();
  const status: DaemonStatusFile = {
    schemaVersion: DAEMON_STATUS_SCHEMA_VERSION,
    workspaceRoot,
    projectRoot: binding.boundary.projectRoot,
    memoryRoot: binding.boundary.memoryRoot,
    memoryLayout: binding.boundary.memoryLayout,
    pid: process.pid,
    state: "running",
    startedAt: now,
    updatedAt: now
  };
  await writeDaemonStatusFile(workspaceRoot, status);
  return status;
}

export async function writeDaemonStoppedStatus(options: DaemonRuntimeOptions): Promise<DaemonStatusFile> {
  const running = await writeDaemonRunningStatus(options);
  const now = options.now?.() ?? nowIso();
  const stopped: DaemonStatusFile = {
    ...running,
    state: "stopped",
    updatedAt: now,
    stoppedAt: now
  };
  await writeDaemonStatusFile(resolve(options.workspaceRoot), stopped);
  return stopped;
}

export async function clearDaemonStatus(options: Pick<DaemonRuntimeOptions, "workspaceRoot">): Promise<void> {
  await rm(daemonStatusPath(options.workspaceRoot), { force: true });
}

export function daemonStatusPath(workspaceRoot: string): string {
  return join(resolve(workspaceRoot), ".boreal", "daemon", "status.json");
}

async function bindDaemonProject(workspaceRoot: string): Promise<DaemonProjectBinding> {
  if (!existsSync(workspaceRoot)) {
    return {
      findings: [
        {
          code: "daemon.project_missing",
          severity: "error",
          message: "Daemon workspace root does not exist",
          details: { workspaceRoot }
        }
      ]
    };
  }
  const setup = await readProjectSetup(workspaceRoot);
  if (setup.setupError) {
    return {
      findings: [
        {
          code: "daemon.setup_invalid",
          severity: "error",
          message: setup.setupError.message,
          details: setup.setupError.details
        }
      ]
    };
  }
  const projectRoot = setup.projectRoot ?? workspaceRoot;
  const memoryRoot = setup.memoryRoot ?? join(projectRoot, "memory");
  try {
    return {
      boundary: bindMcpProjectBoundary({
        workspaceRoot,
        projectRoot,
        memoryRoot,
        memoryLayout: setup.memoryLayout
      }),
      findings: []
    };
  } catch (error) {
    return {
      findings: [
        {
          code: "daemon.boundary",
          severity: "error",
          message: boundedDaemonMessage(error instanceof Error ? error.message : String(error)),
          details: boundedDaemonDiagnostic(error instanceof BorealError ? error.details : undefined)
        }
      ]
    };
  }
}

async function readProjectSetup(workspaceRoot: string): Promise<ProjectSetupLike> {
  const path = join(workspaceRoot, ".boreal", "project.json");
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed = safeParseJson(await readFile(path, "utf8"), {
      path,
      schemaName: "boreal.project-setup.v1",
      expectedObject: true
    });
    if (!isRecord(parsed)) {
      return {
        setupError: daemonSetupError(path, "Project setup must be a JSON object")
      };
    }
    const shapeIssue = projectSetupShapeIssue(parsed);
    if (shapeIssue) {
      return {
        setupError: daemonSetupError(path, shapeIssue)
      };
    }
    return {
      projectRoot: typeof parsed.projectRoot === "string" ? parsed.projectRoot : undefined,
      memoryRoot: typeof parsed.memoryRoot === "string" ? parsed.memoryRoot : undefined,
      memoryLayout: memoryLayout(parsed.memoryLayout),
      storage: projectStorageKind(parsed.storage)
    };
  } catch (error) {
    return {
      setupError: daemonSetupError(path, error)
    };
  }
}

async function renewDaemonReservations(workspaceRoot: string, now: IsoTimestamp): Promise<DaemonReservationRenewalSummary> {
  const setup = await readProjectSetup(workspaceRoot);
  const store = daemonStore(workspaceRoot, setup.storage);
  const nowMs = Date.parse(now);
  const expiresAt = new Date(nowMs + DAEMON_RESERVATION_LEASE_MS).toISOString() as IsoTimestamp;
  const runtime = createBorealRuntime({
    store,
    actor: {
      id: "boreal-daemon",
      kind: "system",
      displayName: "Boreal daemon"
    },
    clock: () => new Date(nowMs)
  });
  const candidates = await store.read(async (reader) => {
    const reservations = await reader.listReservations();
    return reservations
      .filter((reservation) => reservation.status === "active")
      .filter((reservation) => daemonReservationNeedsRenewal(reservation, nowMs))
      .slice()
      .sort((left, right) => left.agentId.localeCompare(right.agentId) || left.workId.localeCompare(right.workId) || left.meta.id.localeCompare(right.meta.id));
  });
  const renewed: DaemonReservationRenewalRow[] = [];
  const skipped: DaemonReservationRenewalSkippedRow[] = [];
  for (const reservation of candidates) {
    try {
      const result = await runtime.renewWorkReservation({
        workId: reservation.workId,
        expiresAt
      });
      renewed.push({
        workId: result.work.meta.id,
        reservationId: result.reservation.meta.id,
        agentId: String(result.reservation.agentId),
        previousExpiresAt: reservation.expiresAt,
        expiresAt: result.reservation.expiresAt ?? expiresAt
      });
    } catch (error) {
      skipped.push({
        workId: reservation.workId,
        reservationId: reservation.meta.id,
        agentId: String(reservation.agentId),
        reason: error instanceof BorealError ? error.code : "renew_failed"
      });
    }
  }
  return {
    ...emptyDaemonReservationRenewals(),
    renewed,
    skipped
  };
}

function daemonReservationNeedsRenewal(reservation: AgentReservation, nowMs: number): boolean {
  if (!reservation.expiresAt) {
    return false;
  }
  const expiresAtMs = Date.parse(reservation.expiresAt);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    return false;
  }
  return expiresAtMs - nowMs <= DAEMON_RESERVATION_RENEWAL_WINDOW_MS;
}

function emptyDaemonReservationRenewals(): DaemonReservationRenewalSummary {
  return {
    enabled: true,
    windowMs: DAEMON_RESERVATION_RENEWAL_WINDOW_MS,
    leaseMs: DAEMON_RESERVATION_LEASE_MS,
    renewed: [],
    skipped: []
  };
}

function daemonStore(workspaceRoot: string, configuredStorage: DaemonProjectStorageKind | undefined): BorealStore {
  const storage = configuredStorage ?? (existsSync(join(resolve(workspaceRoot), ".boreal", "objects")) ? "objects-v1" : "file-v2");
  return storage === "objects-v1" ? new ObjectDirBorealStore({ rootDir: workspaceRoot }) : new FileBorealStore({ rootDir: workspaceRoot });
}

async function readDaemonStatusFile(path: string): Promise<DaemonStatusFile | undefined> {
  if (!existsSync(path)) {
    return undefined;
  }
  try {
    const parsed = safeParseJson(await readFile(path, "utf8"), {
      path,
      schemaName: DAEMON_STATUS_SCHEMA_VERSION,
      expectedObject: true
    });
    if (!isRecord(parsed)) {
      throw new BorealError("BOREAL_INVALID_INPUT", "Daemon status file must be a JSON object");
    }
    return {
      schemaVersion: DAEMON_STATUS_SCHEMA_VERSION,
      workspaceRoot: typeof parsed.workspaceRoot === "string" ? parsed.workspaceRoot : "",
      projectRoot: typeof parsed.projectRoot === "string" ? parsed.projectRoot : "",
      memoryRoot: typeof parsed.memoryRoot === "string" ? parsed.memoryRoot : "",
      memoryLayout: memoryLayout(parsed.memoryLayout) ?? "in-repo",
      pid: typeof parsed.pid === "number" ? parsed.pid : 0,
      state: parsed.state === "stopped" ? "stopped" : "running",
      startedAt: typeof parsed.startedAt === "string" ? parsed.startedAt : "",
      updatedAt: typeof parsed.updatedAt === "string" ? parsed.updatedAt : "",
      stoppedAt: typeof parsed.stoppedAt === "string" ? parsed.stoppedAt : undefined
    };
  } catch (error) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Daemon status file is unreadable", {
      path,
      causeCode: error instanceof BorealError ? error.code : "BOREAL_UNEXPECTED"
    });
  }
}

async function writeDaemonStatusFile(workspaceRoot: string, status: DaemonStatusFile): Promise<void> {
  const path = daemonStatusPath(workspaceRoot);
  await mkdir(join(resolve(workspaceRoot), ".boreal", "daemon"), { recursive: true });
  await writeTextFileAtomic(path, `${JSON.stringify(status, null, 2)}\n`);
}

async function inspectDaemonLocks(workspaceRoot: string): Promise<DaemonStatusResult["locks"]> {
  const root = resolve(workspaceRoot);
  const [runtime, searchIndex] = await Promise.all([
    inspectFileLock(join(root, ".boreal", "runtime", "state.lock")),
    inspectFileLock(join(root, ".boreal", "runtime", "search-index.lock"))
  ]);
  return {
    runtime: lockStatus(runtime),
    searchIndex: lockStatus(searchIndex)
  };
}

function lockStatus(lock: FileLockInspection): DaemonLockStatus {
  return {
    path: lock.lockDir,
    exists: lock.exists,
    stale: lock.stale,
    status: !lock.exists ? "clear" : lock.stale ? "stale" : "active",
    ownerPid: lock.owner?.pid,
    ageMs: lock.ageMs
  };
}

function lockFindings(locks: DaemonStatusResult["locks"]): readonly DaemonFinding[] {
  return Object.entries(locks).flatMap(([domain, lock]): readonly DaemonFinding[] => {
    if (lock.status === "clear") {
      return [];
    }
    return [
      {
        code: `daemon.lock.${domain}`,
        severity: lock.status === "stale" ? "warning" : "info",
        message: `Daemon watch observed a ${lock.status} ${domain} lock and will not repair it directly`,
        repairCommand: lock.status === "stale" ? "bwrk doctor --fix --json" : undefined,
        details: lock
      }
    ];
  });
}

function statusFileFindings(status: DaemonStatusFile, boundary: McpProjectBoundary): readonly DaemonFinding[] {
  const issues = [
    ...(resolve(status.workspaceRoot) !== boundary.workspaceRoot ? ["workspaceRoot"] : []),
    ...(resolve(status.projectRoot) !== boundary.projectRoot ? ["projectRoot"] : []),
    ...(resolve(status.memoryRoot) !== boundary.memoryRoot ? ["memoryRoot"] : [])
  ];
  if (status.schemaVersion !== DAEMON_STATUS_SCHEMA_VERSION) {
    issues.push("schemaVersion");
  }
  return issues.length === 0
    ? []
    : [
        {
          code: "daemon.status_drift",
          severity: "warning",
          message: "Daemon status file does not match the selected project boundary",
          repairCommand: "Restart the daemon from the selected project root",
          details: { issues }
        }
      ];
}

function daemonStatusResult(input: {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly projectRoot?: string;
  readonly memoryRoot?: string;
  readonly memoryLayout?: ProjectRegistryMemoryLayout;
  readonly statusPath: string;
  readonly state: DaemonState;
  readonly pid?: number;
  readonly processAlive?: boolean;
  readonly locks: DaemonStatusResult["locks"];
  readonly watchPaths: readonly string[];
  readonly findings: readonly DaemonFinding[];
  readonly recommendedActions: readonly string[];
}): Omit<DaemonStatusResult, "agentDirectives" | "directiveObligations"> {
  return {
    schemaVersion: DAEMON_STATUS_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    workspaceRoot: input.workspaceRoot,
    projectRoot: input.projectRoot,
    memoryRoot: input.memoryRoot,
    memoryLayout: input.memoryLayout,
    statusPath: input.statusPath,
    state: input.state,
    pid: input.pid,
    processAlive: input.processAlive,
    locks: input.locks,
    watch: {
      paths: input.watchPaths,
      writesTruth: false,
      repairsAreCommandMediated: true
    },
    findings: input.findings,
    recommendedActions: [...new Set(input.recommendedActions)]
  };
}

function withDaemonDirectiveObligations(
  status: Omit<DaemonStatusResult, "agentDirectives" | "directiveObligations">,
  context: AgentRuntimeDirectiveContext = "health"
): DaemonStatusResult {
  const diagnostics = daemonDirectiveDiagnostics(status);
  const workflowRef = diagnostics.length > 0
    ? "workflows/60-health/sync-and-doctor.md"
    : "workflows/40-work/claim-and-finish-work.md";
  const nextCommandPath = diagnostics.length > 0
    ? status.recommendedActions[0] ?? "bwrk doctor --strict --json"
    : "bwrk work list --ready --json";
  const directiveObligations = compileAgentRuntimeDirectiveObligations({
    context,
    snapshot: daemonDirectiveSnapshot(status, diagnostics, workflowRef, nextCommandPath),
    recovery: {
      diagnostics,
      recommendedCommands: diagnostics.length > 0 ? daemonDirectiveRecommendedCommands(status) : [],
      nextWorkflowRef: workflowRef,
      nextCommandPath
    }
  });
  return {
    ...status,
    agentDirectives: directiveObligations.agentDirectives,
    directiveObligations
  };
}

function daemonDirectiveSnapshot(
  status: Omit<DaemonStatusResult, "agentDirectives" | "directiveObligations">,
  diagnostics: readonly AgentDirectiveDiagnosticSnapshot[],
  workflowRef: string,
  nextCommandPath: string
): AgentDirectiveSnapshot {
  const generatedAt = status.generatedAt as IsoTimestamp;
  const primaryRoot = status.projectRoot ?? status.workspaceRoot;
  const healthOk = diagnostics.length === 0 && status.state !== "missing" && status.state !== "drift" && status.state !== "stale";

  return createAgentDirectiveSnapshot({
    capturedAt: generatedAt,
    work: {
      subject: {
        type: "workspace",
        id: status.workspaceRoot,
        title: "Workspace"
      },
      labels: [],
      dependencyIds: [],
      activeBlockerIds: [],
      blockedByIds: [],
      childWorkIds: [],
      descendantWorkIds: [],
      openDescendantIds: []
    },
    summary: {
      summaryIds: [],
      finalSummaryIds: [],
      childSummaryIds: [],
      artifactUris: [],
      commitShas: [],
      dirtyPathNotes: []
    },
    gate: {
      requiredGates: [],
      openGateIds: [],
      satisfiedGateIds: [],
      forcedGateIds: []
    },
    evidence: {
      evidenceIds: [],
      verificationIds: [],
      evidence: [],
      verifications: []
    },
    git: {
      roots: [
        {
          root: primaryRoot,
          detached: false,
          protectedBranch: false,
          clean: true,
          scopedChangedPaths: [],
          collaborationDirtyPaths: [],
          blockingDirtyPaths: [],
          untrackedPaths: []
        }
      ],
      checkpointCommitShas: [],
      dirtyPathNotes: []
    },
    workflow: {
      workflowRefs: [workflowRef],
      skillRefs: diagnostics.length > 0 ? ["boreal-health-doctor"] : ["boreal-work-execution"],
      requiredInputNames: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS],
      nextWorkflowRef: workflowRef,
      recommendedCommandPath: nextCommandPath,
      assetManifestHash: hashContent({
        commandPath: "daemon status",
        workflowRef,
        state: status.state,
        findingCodes: status.findings.map((finding) => finding.code)
      }) as ContentHash
    },
    doctor: {
      ok: healthOk,
      strict: true,
      diagnostics
    },
    sync: {
      ok: healthOk,
      refreshed: false,
      ledgersFresh: healthOk,
      searchIndexFresh: healthOk,
      sqliteCacheFresh: healthOk
    },
    command: {
      path: "daemon status",
      argv: ["daemon", "status", "--json"],
      envelopeSchema: DAEMON_STATUS_SCHEMA_VERSION,
      json: true,
      mutatesState: false,
      resultOk: healthOk
    },
    actor: {
      actor: {
        id: "boreal-daemon",
        kind: "system",
        displayName: "Boreal daemon"
      },
      activeReservationIds: []
    }
  });
}

function daemonDirectiveDiagnostics(
  status: Omit<DaemonStatusResult, "agentDirectives" | "directiveObligations">
): readonly AgentDirectiveDiagnosticSnapshot[] {
  return status.findings.map((finding) => ({
    code: finding.code,
    severity: finding.severity,
    message: finding.message,
    blocking: finding.severity === "error" || status.state === "missing" || status.state === "drift",
    recommendedCommands: daemonFindingRecommendedCommands(finding)
  }));
}

function daemonDirectiveRecommendedCommands(
  status: Omit<DaemonStatusResult, "agentDirectives" | "directiveObligations">
): readonly string[] {
  const commands = [
    ...status.recommendedActions,
    ...status.findings.flatMap((finding) => daemonFindingRecommendedCommands(finding))
  ];
  return [...new Set(commands.length > 0 ? commands : ["bwrk doctor --strict --json"])];
}

function daemonFindingRecommendedCommands(finding: DaemonFinding): readonly string[] {
  if (finding.repairCommand) {
    return [finding.repairCommand];
  }
  if (finding.code.startsWith("daemon.lock.")) {
    return ["bwrk lock inspect --json"];
  }
  if (finding.code === "daemon.project_missing" || finding.code === "daemon.boundary") {
    return ["bwrk prime --json"];
  }
  if (finding.code === "daemon.pid_stale" || finding.code === "daemon.status_drift") {
    return ["bwrk daemon status --json"];
  }
  return [];
}

function daemonWatchPaths(workspaceRoot: string): readonly string[] {
  const root = resolve(workspaceRoot);
  return [
    join(root, ".boreal", "runtime", "state.json"),
    objectIndexPath(root),
    join(root, ".boreal", "ledgers", "manifest.json"),
    join(root, "memory")
  ];
}

function defaultPidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function memoryLayout(value: unknown): ProjectRegistryMemoryLayout | undefined {
  return value === "in-repo" || value === "child" || value === "sibling" ? value : undefined;
}

function projectStorageKind(value: unknown): DaemonProjectStorageKind | undefined {
  return value === "file-v2" || value === "objects-v1" ? value : undefined;
}

function projectSetupShapeIssue(value: Record<string, unknown>): string | undefined {
  if (value.schemaVersion !== "boreal.project-setup.v1") {
    return "Project setup has an unsupported schema version";
  }
  if (typeof value.projectRoot !== "string" || typeof value.memoryRoot !== "string") {
    return "Project setup is missing projectRoot or memoryRoot";
  }
  if (memoryLayout(value.memoryLayout) === undefined) {
    return "Project setup has an invalid memoryLayout";
  }
  if (value.storage !== undefined && projectStorageKind(value.storage) === undefined) {
    return "Project setup has an invalid storage kind";
  }
  return undefined;
}

export function daemonErrorPayload(error: unknown): Record<string, unknown> {
  if (error instanceof BorealError) {
    return {
      ok: false,
      code: error.code,
      message: boundedDaemonMessage(error.message),
      details: boundedDaemonDiagnostic(error.details)
    };
  }
  return {
    ok: false,
    code: "BOREAL_UNEXPECTED",
    message: boundedDaemonMessage(error instanceof Error ? error.message : String(error))
  };
}

function daemonSetupError(path: string, error: unknown): DaemonSetupError {
  return {
    code: error instanceof BorealError ? error.code : "BOREAL_UNEXPECTED",
    message: "Daemon project setup is unreadable; refusing to watch or repair the workspace",
    details: {
      path,
      causeCode: error instanceof BorealError ? error.code : "BOREAL_UNEXPECTED",
      cause: boundedDaemonMessage(error instanceof Error ? error.message : String(error))
    }
  };
}

function boundedDaemonMessage(value: string): string {
  return redactDaemonText(value).slice(0, MAX_DAEMON_DIAGNOSTIC_STRING_LENGTH);
}

function boundedDaemonDiagnostic(value: unknown, depth = 0): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return redactDaemonText(value).slice(0, MAX_DAEMON_DIAGNOSTIC_STRING_LENGTH);
  }
  if (depth >= MAX_DAEMON_DIAGNOSTIC_DEPTH) {
    return "[diagnostic depth limited]";
  }
  if (Array.isArray(value)) {
    return value.slice(0, MAX_DAEMON_DIAGNOSTIC_ITEMS).map((entry) => boundedDaemonDiagnostic(entry, depth + 1));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).slice(0, MAX_DAEMON_DIAGNOSTIC_ITEMS).map(([key, entry]) => [
        key,
        SENSITIVE_DAEMON_DIAGNOSTIC_KEY.test(key) ? "[redacted]" : boundedDaemonDiagnostic(entry, depth + 1)
      ])
    );
  }
  return String(value).slice(0, MAX_DAEMON_DIAGNOSTIC_STRING_LENGTH);
}

function redactDaemonText(value: string): string {
  return value
    .replace(/((?:authorization|api[-_]?key|cookie|credential|password|private[-_]?key|secret|token)\s*[:=]\s*)[^\s,;]+/giu, "$1[redacted]")
    .replace(/([?&](?:api[-_]?key|password|secret|token)=)[^&\s]+/giu, "$1[redacted]");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
