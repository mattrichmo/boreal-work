import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  BorealError,
  bindMcpProjectBoundary,
  nowIso,
  safeParseJson,
  type McpProjectBoundary,
  type ProjectRegistryMemoryLayout
} from "@boreal/core";
import { inspectFileLock, writeTextFileAtomic, type FileLockInspection } from "@boreal/storage";

export const DAEMON_STATUS_SCHEMA_VERSION = "boreal.daemon.status.v1";
export const DAEMON_WATCH_SCHEMA_VERSION = "boreal.daemon.watch.v1";

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
}

export interface DaemonWatchResult {
  readonly schemaVersion: typeof DAEMON_WATCH_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly action: DaemonWatchAction;
  readonly reason?: string;
  readonly status: DaemonStatusResult;
  readonly observedPaths: readonly string[];
  readonly recommendedActions: readonly string[];
}

export interface DaemonRuntimeOptions {
  readonly workspaceRoot: string;
  readonly pidExists?: (pid: number) => boolean;
  readonly now?: () => string;
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
}

export async function inspectDaemonStatus(options: DaemonRuntimeOptions): Promise<DaemonStatusResult> {
  const generatedAt = options.now?.() ?? nowIso();
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
    return daemonStatusResult({
      generatedAt,
      workspaceRoot,
      statusPath,
      state: existsSync(workspaceRoot) ? "drift" : "missing",
      locks,
      watchPaths,
      findings,
      recommendedActions: [...recommendedActions]
    });
  }

  const statusFile = await readDaemonStatusFile(statusPath);
  if (!statusFile) {
    return daemonStatusResult({
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
    });
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

  return daemonStatusResult({
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
  });
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

  return {
    schemaVersion: DAEMON_WATCH_SCHEMA_VERSION,
    generatedAt: options.now?.() ?? nowIso(),
    workspaceRoot: status.workspaceRoot,
    action,
    reason,
    status,
    observedPaths: action === "observed" ? status.watch.paths : [],
    recommendedActions: status.recommendedActions
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
          message: error instanceof Error ? error.message : String(error),
          details: error instanceof BorealError ? error.details : undefined
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
      return {};
    }
    return {
      projectRoot: typeof parsed.projectRoot === "string" ? parsed.projectRoot : undefined,
      memoryRoot: typeof parsed.memoryRoot === "string" ? parsed.memoryRoot : undefined,
      memoryLayout: memoryLayout(parsed.memoryLayout)
    };
  } catch {
    return {};
  }
}

async function readDaemonStatusFile(path: string): Promise<DaemonStatusFile | undefined> {
  if (!existsSync(path)) {
    return undefined;
  }
  const parsed = safeParseJson(await readFile(path, "utf8"), {
    path,
    schemaName: DAEMON_STATUS_SCHEMA_VERSION,
    expectedObject: true
  });
  if (!isRecord(parsed)) {
    return undefined;
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
}): DaemonStatusResult {
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

function daemonWatchPaths(workspaceRoot: string): readonly string[] {
  const root = resolve(workspaceRoot);
  return [
    join(root, ".boreal", "runtime", "state.json"),
    join(root, ".boreal", "runtime", "search-index.json"),
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
