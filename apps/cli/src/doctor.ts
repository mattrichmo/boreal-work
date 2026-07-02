import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";

import {
  AGENT_DIRECTIVE_REGISTRY,
  AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
  BorealError,
  agentDirectiveHealthReport,
  assembleAgentDirectiveBundle,
  bindMcpProjectBoundary,
  createAgentDirectiveSnapshot,
  detectSuspiciousUnicode,
  deterministicId,
  normalizeActorId,
  normalizeLabel,
  nowIso,
  readJsonFile,
  runtimeSnapshotSchemaIssues,
  type AgentDirectiveBundle,
  type AgentDirectiveBundleAssemblyIssue,
  type AgentDirectiveHealthIssue,
  type AgentReservation,
  type AgentSummaryRecord,
  type AgentId,
  type ClaimRecord,
  type ContentHash,
  type ContextPack,
  type DecisionRecord,
  type DirectiveAcknowledgementRecord,
  type EvidenceId,
  type EvidenceRecord,
  type GraphEdge,
  type KnowledgeSource,
  type ProjectRegistryMemoryLayout,
  type ProjectionId,
  type ProjectionRecord,
  type RuntimeOperation,
  type VerificationRecord,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import { inspectDaemonStatus, type DaemonStatusResult } from "@boreal/daemon";
import { buildContextPack, buildContextProjection } from "@boreal/search";
import { breakStaleFileLock, inspectFileLock, inspectSQLiteCache } from "@boreal/storage";
import { deriveReadinessStatus } from "@boreal/work-engine";

import type { CliContext } from "./context.js";
import { resolveEnvironmentManifest } from "./environment-manifest.js";
import { inspectGitWorktree } from "./git-worktree.js";
import { inspectBorealInstallStatus, installStatusHealthy, installStatusSummary } from "./install-status.js";
import { buildExportDocument, exportDriftDiagnostics, ledgerStatus, readGeneratedLedgerTombstones } from "./import-export.js";
import { inspectProjectSetupDrift, type ProjectSetupDriftInspection } from "./project-setup.js";
import { inspectSearchIndex, searchIndexLockDir, writeSearchIndex } from "./search-cli.js";
import { dirtyPathNotesHaveReasonCode } from "./summary-policy.js";
import { inspectVault, listVaultRawSources, listVaultWikiPages, type RawSourceRecord, type WikiPageRecord } from "./vault.js";

export type DiagnosticSeverity = "ok" | "warning" | "error" | "fixed";

export interface Diagnostic {
  readonly code: string;
  readonly severity: DiagnosticSeverity;
  readonly message: string;
  readonly details?: unknown;
}

export interface DoctorResult {
  readonly ok: boolean;
  readonly strict: boolean;
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}

const STATE_SECTIONS = [
  "workItems",
  "agentSummaries",
  "evidence",
  "verifications",
  "directiveAcknowledgements",
  "knowledgeSources",
  "claims",
  "decisions",
  "graphEdges",
  "reservations",
  "events",
  "operations",
  "projections",
  "contextPacks"
] as const;

export const OPERATION_LOG_RECOMMENDED_KEEP = 1_000;
const OPERATION_LOG_WARNING_GRACE = 25;
const OPERATION_LOG_WARNING_THRESHOLD = OPERATION_LOG_RECOMMENDED_KEEP + OPERATION_LOG_WARNING_GRACE;
const AGENT_SUMMARY_POLICY_ENFORCED_AT = "2026-06-30T00:00:00.000Z";
const AGENT_DIRECTIVE_ACKNOWLEDGEMENT_POLICY_ENFORCED_AT = "2026-07-01T00:00:00.000Z";
const MCP_CONFIG_SCHEMA_VERSION = "boreal.mcp-config.v1";

export async function runDoctor(context: CliContext, fix: boolean, strict = false): Promise<DoctorResult> {
  const diagnostics: Diagnostic[] = [];
  let fixed = false;

  diagnostics.push({
    code: "workspace.root",
    severity: "ok",
    message: `Workspace root: ${context.workspaceRoot}`
  });

  if (!existsSync(context.paths.borealDir)) {
    diagnostics.push({
      code: "workspace.missing",
      severity: "error",
      message: "Missing .boreal directory; run `bwrk init`"
    });
    return finalize(diagnostics, fixed, strict);
  }

  const lockDiagnostics = await validateRuntimeLocks(context, fix);
  diagnostics.push(...lockDiagnostics.diagnostics);
  fixed = fixed || lockDiagnostics.fixed;

  diagnostics.push(await validateGitWorktree(context));
  const projectSetupDiagnostics = await validateProjectSetup(context, fix);
  diagnostics.push(...projectSetupDiagnostics.diagnostics);
  fixed = fixed || projectSetupDiagnostics.fixed;
  diagnostics.push(await validateEnvironmentManifest(context));
  diagnostics.push(await validateInstallStatus(context));
  diagnostics.push(await validateMcpConfig(context));
  diagnostics.push(await validateDaemonStatus(context));
  diagnostics.push(await validateVaultStructure(context));
  diagnostics.push(await validateVaultHealth(context));

  const state = await readStateDocument(context, diagnostics);
  if (!state) {
    return finalize(diagnostics, fixed, strict);
  }

  validateStateSections(state, diagnostics);
  validateMissingIds(state, diagnostics);
  validateDuplicateIds(state, diagnostics);
  const schemaIssues = validateSchemaConformance(state, diagnostics);
  diagnostics.push(...validateAgentDirectiveHealth(context));

  const storeDiagnostics = await validateStoreRecords(context, fix, state);
  diagnostics.push(...storeDiagnostics.diagnostics);
  fixed = fixed || storeDiagnostics.fixed;
  const hasStoreErrors = storeDiagnostics.diagnostics.some(
    (diagnostic) => diagnostic.severity === "error" && diagnostic.code !== "work.readiness"
  );

  if (schemaIssues.length === 0 && !hasStoreErrors) {
    try {
      const exportDocument = await buildExportDocument(context);
      const drift = await exportDriftDiagnostics(context);
      diagnostics.push({
        code: "snapshot.export_drift",
        severity: drift.drift ? "warning" : "ok",
        message: drift.drift
          ? "Latest snapshot content hash differs from current export state"
          : "Latest snapshot matches current export state or no snapshots exist",
        details: drift.drift
          ? {
              ...drift,
              repairCommand: "bwrk snapshot create --json",
              repairNote: "Create a new explicit snapshot baseline when the current state should replace the previous baseline."
            }
          : drift
      });
      const ledgers = await ledgerStatus(context, undefined);
      diagnostics.push({
        code: "ledger.export_drift",
        severity: ledgers.exists && !ledgers.ok ? "warning" : "ok",
        message: ledgerDriftMessage(ledgers),
        details:
          ledgers.exists && !ledgers.ok
            ? {
                ...ledgers,
                repairCommand: "bwrk sync refresh --json"
              }
            : ledgers
      });
      const sqliteCache = await inspectSQLiteCache({
        rootDir: context.workspaceRoot,
        expectedSnapshot: exportDocument.state,
        expectedSourceContentHash: exportDocument.contentHash
      });
      diagnostics.push({
        code: "cache.sqlite",
        severity: sqliteCache.exists && !sqliteCache.ok ? "warning" : "ok",
        message: sqliteCacheMessage(sqliteCache),
        details:
          sqliteCache.exists && !sqliteCache.ok
            ? {
                ...sqliteCache,
                repairCommand: "bwrk sync refresh --json"
              }
            : sqliteCache
      });
    } catch (error) {
      diagnostics.push({
        code: "snapshot.export_drift",
        severity: "error",
        message: "Snapshot drift check failed because current runtime state is not exportable",
        details: diagnosticErrorDetails(error)
      });
      diagnostics.push({
        code: "ledger.export_drift",
        severity: "warning",
        message: "Skipped ledger drift check because current runtime state is not exportable"
      });
      diagnostics.push({
        code: "cache.sqlite",
        severity: "warning",
        message: "Skipped SQLite cache check because current runtime state is not exportable"
      });
    }
  } else {
    const skipReason =
      schemaIssues.length > 0
        ? "because runtime state failed schema validation"
        : "because runtime state failed store consistency validation";
    diagnostics.push({
      code: "snapshot.export_drift",
      severity: "warning",
      message: `Skipped snapshot drift check ${skipReason}`
    });
    diagnostics.push({
      code: "ledger.export_drift",
      severity: "warning",
      message: `Skipped ledger drift check ${skipReason}`
    });
    diagnostics.push({
      code: "cache.sqlite",
      severity: "warning",
      message: `Skipped SQLite cache check ${skipReason}`
    });
  }

  const searchDiagnostics = await validateSearchIndex(context, fix);
  diagnostics.push(...searchDiagnostics.diagnostics);
  fixed = fixed || searchDiagnostics.fixed;

  return finalize(diagnostics, fixed, strict);
}

async function validateRuntimeLocks(
  context: CliContext,
  fix: boolean
): Promise<{
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];
  let fixed = false;

  for (const target of [
    {
      codePrefix: "lock",
      path: context.paths.stateLockDir,
      label: "runtime state",
      breakHint: " or `bwrk lock break --stale-only`"
    },
    {
      codePrefix: "lock.search_index",
      path: searchIndexLockDir(context),
      label: "search index",
      breakHint: ""
    }
  ]) {
    const lockInspection = await inspectFileLock(target.path);
    if (lockInspection.exists) {
      if (lockInspection.stale) {
        if (fix) {
          await breakStaleFileLock(target.path);
          diagnostics.push({
            code: `${target.codePrefix}.stale`,
            severity: "fixed",
            message: `Removed stale ${target.label} lock`,
            details: lockInspection
          });
          fixed = true;
        } else {
          diagnostics.push({
            code: `${target.codePrefix}.stale`,
            severity: "error",
            message: `${capitalize(target.label)} lock is stale; run \`bwrk doctor --fix\`${target.breakHint}`,
            details: lockInspection
          });
        }
      } else {
        diagnostics.push({
          code: `${target.codePrefix}.active`,
          severity: "warning",
          message: `${capitalize(target.label)} lock is currently active`,
          details: lockInspection
        });
      }
    } else {
      diagnostics.push({
        code: `${target.codePrefix}.absent`,
        severity: "ok",
        message: `No ${target.label} lock present`
      });
    }
  }

  return { fixed, diagnostics };
}

async function validateGitWorktree(context: CliContext): Promise<Diagnostic> {
  const manifest = await resolveEnvironmentManifest(context).catch(() => undefined);
  if (!manifest) {
    const inspection = await inspectGitWorktree(context);
    return {
      code: "git.worktree",
      severity: inspection.ok ? "ok" : "warning",
      message: gitWorktreeDiagnosticMessage(inspection),
      details: inspection
    };
  }
  const project = await inspectGitWorktree(context, {
    rootDir: manifest.projectRoot,
    checkedPaths: projectGitCheckedPaths(manifest),
    generatedArtifactPaths: projectGeneratedArtifactPaths(manifest)
  });
  const memory =
    manifest.memoryGitMode === "shared"
      ? undefined
      : await inspectGitWorktree(context, {
          rootDir: manifest.memoryRoot,
          checkedPaths: memoryGitCheckedPaths(),
          generatedArtifactPaths: memoryGeneratedArtifactPaths()
        });
  const ok = project.ok && (memory?.ok ?? true);
  return {
    code: "git.worktree",
    severity: ok ? "ok" : "warning",
    message: gitTopologyDiagnosticMessage(project, memory, manifest.memoryGitMode),
    details: {
      topology: {
        projectRoot: manifest.projectRoot,
        memoryRoot: manifest.memoryRoot,
        memoryLayout: manifest.memoryLayout,
        memoryGitMode: manifest.memoryGitMode
      },
      project,
      memory
    }
  };
}

function projectGitCheckedPaths(manifest: Awaited<ReturnType<typeof resolveEnvironmentManifest>>): readonly string[] {
  const paths = [".boreal/ledgers", ".boreal/runtime", ".agents", ".claude", "dump"];
  if (manifest.memoryGitMode === "shared") {
    paths.push("memory/raw/index.jsonl", "memory");
  }
  if (manifest.memoryGitMode === "submodule" && manifest.memoryLayout === "child") {
    paths.push(relative(manifest.projectRoot, manifest.memoryRoot).replaceAll("\\", "/"));
  }
  return paths;
}

function projectGeneratedArtifactPaths(manifest: Awaited<ReturnType<typeof resolveEnvironmentManifest>>): readonly string[] {
  const paths = [".boreal/ledgers", ".boreal/runtime", ".boreal/cache", ".boreal/tmp", ".boreal/results", ".agents", ".claude", "dump"];
  if (manifest.memoryGitMode === "shared") {
    paths.push("memory/.boreal/db", "memory/.boreal/cache", "memory/.boreal/locks", "memory/.boreal/tmp", "memory/.boreal/results");
  }
  return paths;
}

function memoryGitCheckedPaths(): readonly string[] {
  return ["raw/index.jsonl", "graph/relationships.jsonl", "ledgers/events.jsonl", "ledgers/deletions.jsonl", ".boreal"];
}

function memoryGeneratedArtifactPaths(): readonly string[] {
  return [".boreal/db", ".boreal/cache", ".boreal/locks", ".boreal/tmp", ".boreal/results"];
}

async function validateEnvironmentManifest(context: CliContext): Promise<Diagnostic> {
  try {
    const manifest = await resolveEnvironmentManifest(context);
    return {
      code: "environment.manifest",
      severity: "ok",
      message: "Resolved environment manifest for project, memory, skills, Git mode, and workflow assets",
      details: manifest
    };
  } catch (error) {
    return {
      code: "environment.manifest",
      severity: "error",
      message: "Could not resolve environment manifest",
      details: error instanceof BorealError ? { code: error.code, message: error.message, details: error.details } : String(error)
    };
  }
}

async function validateProjectSetup(
  context: CliContext,
  fix: boolean
): Promise<{
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}> {
  const inspection = await inspectProjectSetupDrift(context, fix);
  const diagnostics: Diagnostic[] = [];
  const repairedKinds = new Set(inspection.repairs.map((repair) => repair.kind));

  if (!inspection.configured) {
    diagnostics.push({
      code: "project_setup.config",
      severity: "ok",
      message: "No project setup config is present; default repo-local memory resolution is active",
      details: { configPath: inspection.configPath }
    });
    return { fixed: false, diagnostics };
  }

  if (!inspection.configValid || !inspection.config) {
    diagnostics.push({
      code: "project_setup.config",
      severity: "error",
      message: projectSetupConfigDiagnosticMessage(inspection),
      details: inspection
    });
    return { fixed: inspection.fixed, diagnostics };
  }

  diagnostics.push({
    code: "project_setup.config",
    severity: "ok",
    message: "Project setup config matches this workspace root",
    details: {
      configPath: inspection.configPath,
      projectRoot: inspection.config.projectRoot,
      memoryRoot: inspection.config.memoryRoot,
      memoryLayout: inspection.config.memoryLayout,
      memoryGitMode: inspection.config.memoryGitMode
    }
  });

  diagnostics.push(projectSetupMemoryRootDiagnostic(inspection));
  diagnostics.push(projectSetupMemoryRepoDiagnostic(inspection, repairedKinds));
  diagnostics.push(projectSetupGitignoreDiagnostic(inspection, repairedKinds));
  diagnostics.push(projectSetupChildTrackingDiagnostic(inspection));
  diagnostics.push(projectSetupGitmodulesDiagnostic(inspection, repairedKinds));

  return { fixed: inspection.fixed, diagnostics };
}

async function validateInstallStatus(context: CliContext): Promise<Diagnostic> {
  const status = await inspectBorealInstallStatus({
    workspaceRoot: context.workspaceRoot,
    checkedAt: nowIso()
  });
  return {
    code: "install.status",
    severity: installStatusHealthy(status) ? "ok" : "warning",
    message: installStatusSummary(status),
    details: status
  };
}

async function validateMcpConfig(context: CliContext): Promise<Diagnostic> {
  const configPath = join(context.paths.borealDir, "mcp.json");
  if (!existsSync(configPath)) {
    return {
      code: "mcp.config",
      severity: "ok",
      message: "No project-scoped MCP config is present",
      details: { configPath, exists: false }
    };
  }

  let parsed: unknown;
  try {
    parsed = await readJsonFile(configPath, {
      schemaName: MCP_CONFIG_SCHEMA_VERSION,
      expectedObject: true,
      maxBytes: 64 * 1024
    });
  } catch (error) {
    return {
      code: "mcp.config",
      severity: "warning",
      message: "MCP config could not be parsed",
      details: {
        configPath,
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }

  if (!isRecord(parsed)) {
    return {
      code: "mcp.config",
      severity: "warning",
      message: "MCP config must be a JSON object",
      details: { configPath }
    };
  }

  const manifest = await resolveEnvironmentManifest(context).catch(() => undefined);
  const issues: string[] = [];
  const workspaceRoot = configRoot(context.workspaceRoot, parsed.workspaceRoot);
  const projectRoot = configRoot(context.workspaceRoot, parsed.projectRoot) ?? manifest?.projectRoot ?? workspaceRoot ?? context.workspaceRoot;
  const memoryRoot = configRoot(context.workspaceRoot, parsed.memoryRoot) ?? manifest?.memoryRoot ?? join(projectRoot, "memory");
  const memoryLayout = mcpMemoryLayout(parsed.memoryLayout) ?? manifest?.memoryLayout ?? "in-repo";

  if (parsed.schemaVersion !== MCP_CONFIG_SCHEMA_VERSION) {
    issues.push(`schemaVersion must be ${MCP_CONFIG_SCHEMA_VERSION}`);
  }
  if (!workspaceRoot) {
    issues.push("workspaceRoot is required");
  } else if (workspaceRoot !== context.workspaceRoot) {
    issues.push("workspaceRoot does not match this Boreal workspace");
  }
  if (projectRoot !== context.workspaceRoot) {
    issues.push("projectRoot must match this Boreal workspace");
  }

  const args = Array.isArray(parsed.args) ? parsed.args.filter((arg): arg is string => typeof arg === "string") : [];
  const scopedWorkspace = scopedWorkspaceFromMcpArgs(context.workspaceRoot, args);
  if (!scopedWorkspace) {
    issues.push("args must include --workspace <project-root>");
  } else if (scopedWorkspace !== context.workspaceRoot) {
    issues.push("args --workspace does not resolve to this Boreal workspace");
  }
  if (typeof parsed.command !== "string" || parsed.command.trim().length === 0) {
    issues.push("command is required");
  }

  try {
    bindMcpProjectBoundary({
      workspaceRoot: workspaceRoot ?? context.workspaceRoot,
      projectRoot,
      memoryRoot,
      memoryLayout
    });
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error));
  }

  return {
    code: "mcp.config",
    severity: issues.length === 0 ? "ok" : "warning",
    message: issues.length === 0 ? "MCP config is scoped to this project" : "MCP config drift detected",
    details: {
      configPath,
      exists: true,
      workspaceRoot,
      projectRoot,
      memoryRoot,
      memoryLayout,
      scopedWorkspace,
      issues,
      repairCommand: "Review docs/architecture/MCP_SERVER.md and update .boreal/mcp.json"
    }
  };
}

function configRoot(base: string, value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }
  return resolve(base, value);
}

function scopedWorkspaceFromMcpArgs(base: string, args: readonly string[]): string | undefined {
  const index = args.findIndex((arg) => arg === "--workspace" || arg === "--project-root");
  const value = index >= 0 ? args[index + 1] : undefined;
  return value ? resolve(base, value) : undefined;
}

function mcpMemoryLayout(value: unknown): ProjectRegistryMemoryLayout | undefined {
  return value === "in-repo" || value === "child" || value === "sibling" ? value : undefined;
}

async function validateDaemonStatus(context: CliContext): Promise<Diagnostic> {
  const status = await inspectDaemonStatus({ workspaceRoot: context.workspaceRoot });
  const unhealthy = status.state === "missing" || status.state === "stale" || status.state === "drift";
  return {
    code: "daemon.status",
    severity: unhealthy ? "warning" : "ok",
    message: daemonStatusMessage(status),
    details: status
  };
}

function daemonStatusMessage(status: DaemonStatusResult): string {
  switch (status.state) {
    case "running":
      return "Daemon status file points at a running process";
    case "stopped":
      return "Daemon is not running; this is healthy for command-driven workflows";
    case "stale":
      return "Daemon status file points at a stale process";
    case "drift":
      return "Daemon status file or project boundary drift detected";
    case "missing":
      return "Daemon workspace is missing or unreadable";
  }
}

async function validateVaultStructure(context: CliContext): Promise<Diagnostic> {
  try {
    const inspection = await inspectVault(context);
    const structureOk = inspection.initialized && inspection.invalidPaths.length === 0;
    return {
      code: "vault.structure",
      severity: structureOk ? "ok" : "warning",
      message: vaultStructureDiagnosticMessage(inspection),
      details: inspection
    };
  } catch (error) {
    if (error instanceof BorealError) {
      return {
        code: "vault.structure",
        severity: "warning",
        message: "Skipped vault structure checks because the memory vault could not be resolved",
        details: { code: error.code, message: error.message, details: error.details }
      };
    }
    throw error;
  }
}

async function validateVaultHealth(context: CliContext): Promise<Diagnostic> {
  let inspection: Awaited<ReturnType<typeof inspectVault>>;
  try {
    inspection = await inspectVault(context);
  } catch (error) {
    if (error instanceof BorealError) {
      return {
        code: "vault.health",
        severity: "warning",
        message: "Skipped vault health checks because the memory vault could not be resolved",
        details: { code: error.code, message: error.message, details: error.details }
      };
    }
    throw error;
  }
  if (!inspection.initialized) {
    return {
      code: "vault.health",
      severity: "warning",
      message: "Skipped vault health checks because the memory vault is not initialized",
      details: inspection
    };
  }
  const unhealthy = !inspection.health.ok || inspection.health.hasWarnings;
  return {
    code: "vault.health",
    severity: unhealthy ? "warning" : "ok",
    message: unhealthy ? "Boreal memory vault has health warnings" : "Boreal memory vault health checks passed",
    details: inspection.health
  };
}

function projectSetupConfigDiagnosticMessage(inspection: ProjectSetupDriftInspection): string {
  if (inspection.configError) {
    return "Project setup config is invalid";
  }
  if (inspection.projectRootMatches === false) {
    return "Project setup config belongs to a different project root";
  }
  if (inspection.validationError) {
    return "Project setup config failed validation";
  }
  return "Project setup config is invalid";
}

function projectSetupMemoryRootDiagnostic(inspection: ProjectSetupDriftInspection): Diagnostic {
  const memoryRoot = inspection.memoryRoot;
  if (!memoryRoot) {
    return {
      code: "project_setup.memory_root",
      severity: "warning",
      message: "Skipped memory root checks because project setup config is invalid"
    };
  }
  if (!memoryRoot.exists) {
    return {
      code: "project_setup.memory_root",
      severity: "error",
      message: "Configured memory root is missing; rerun `bwrk init --setup-memory` or repair the path",
      details: memoryRoot
    };
  }
  if (!memoryRoot.isDirectory) {
    return {
      code: "project_setup.memory_root",
      severity: "error",
      message: "Configured memory root is not a directory",
      details: memoryRoot
    };
  }
  return {
    code: "project_setup.memory_root",
    severity: "ok",
    message: "Configured memory root exists",
    details: memoryRoot
  };
}

function projectSetupMemoryRepoDiagnostic(
  inspection: ProjectSetupDriftInspection,
  repairedKinds: ReadonlySet<ProjectSetupRepairKind>
): Diagnostic {
  if (!inspection.memoryRepoExpected) {
    return {
      code: "project_setup.memory_repo",
      severity: "ok",
      message: "Shared memory mode does not require a separate memory Git repository"
    };
  }
  if (!inspection.memoryRoot?.isDirectory) {
    return {
      code: "project_setup.memory_repo",
      severity: "warning",
      message: "Skipped memory Git repository check because the memory root is missing or invalid"
    };
  }
  if (repairedKinds.has("memory_repo")) {
    return {
      code: "project_setup.memory_repo",
      severity: "fixed",
      message: "Initialized missing memory Git repository",
      details: projectSetupRepairs(inspection, "memory_repo")
    };
  }
  if (!inspection.memoryRepoExists) {
    return {
      code: "project_setup.memory_repo",
      severity: "error",
      message: "Configured memory Git mode requires a memory repository, but `.git` is missing",
      details: {
        memoryRoot: inspection.config?.memoryRoot,
        memoryGitMode: inspection.config?.memoryGitMode,
        repairCommand: "bwrk doctor --fix --json"
      }
    };
  }
  return {
    code: "project_setup.memory_repo",
    severity: "ok",
    message: "Memory Git repository boundary exists"
  };
}

function projectSetupGitignoreDiagnostic(
  inspection: ProjectSetupDriftInspection,
  repairedKinds: ReadonlySet<ProjectSetupRepairKind>
): Diagnostic {
  if (repairedKinds.has("project_gitignore") || repairedKinds.has("memory_gitignore")) {
    return {
      code: "project_setup.gitignore",
      severity: "fixed",
      message: "Restored project setup `.gitignore` guards",
      details: projectSetupRepairs(inspection, "project_gitignore", "memory_gitignore")
    };
  }
  const missing = {
    project: {
      path: inspection.projectGitignorePath,
      missingPatterns: inspection.projectGitignoreMissingPatterns
    },
    memory: {
      path: inspection.memoryGitignorePath,
      missingPatterns: inspection.memoryGitignoreMissingPatterns
    }
  };
  const missingCount = inspection.projectGitignoreMissingPatterns.length + inspection.memoryGitignoreMissingPatterns.length;
  return {
    code: "project_setup.gitignore",
    severity: missingCount > 0 ? "error" : "ok",
    message: missingCount > 0 ? "Project setup `.gitignore` guards are missing" : "Project setup `.gitignore` guards are present",
    details: missingCount > 0 ? { ...missing, repairCommand: "bwrk doctor --fix --json" } : missing
  };
}

function projectSetupChildTrackingDiagnostic(inspection: ProjectSetupDriftInspection): Diagnostic {
  const config = inspection.config;
  const tracking = inspection.childTracking;
  if (!config || config.memoryLayout !== "child" || config.memoryGitMode === "shared") {
    return {
      code: "project_setup.child_tracking",
      severity: "ok",
      message: "Child memory tracking guard is not required for this setup mode"
    };
  }
  if (!tracking?.checked) {
    return {
      code: "project_setup.child_tracking",
      severity: "warning",
      message: "Skipped child memory Git tracking check because the project Git index could not be inspected",
      details: tracking
    };
  }

  const violatingPaths = config.memoryGitMode === "submodule" ? tracking.plainTrackedPaths : tracking.trackedPaths;
  if (violatingPaths.length > 0) {
    return {
      code: "project_setup.child_tracking",
      severity: "error",
      message:
        config.memoryGitMode === "submodule"
          ? "Child memory contains project-tracked files instead of only a submodule gitlink"
          : "Child memory is tracked by the project Git index despite separate memory mode",
      details: {
        expectedPath: tracking.expectedPath,
        trackedPaths: violatingPaths,
        repairCommand: `git rm -r --cached -- ${tracking.expectedPath ?? "memory"}`
      }
    };
  }

  if (config.memoryGitMode === "submodule" && tracking.gitlinkPaths.length === 0) {
    return {
      code: "project_setup.child_tracking",
      severity: "error",
      message: "Child submodule mode requires a real Git gitlink; `.gitmodules` metadata alone is not enough",
      details: {
        expectedPath: tracking.expectedPath,
        trackedPaths: tracking.trackedPaths,
        gitlinkPaths: tracking.gitlinkPaths,
        repairCommand: `git submodule add ${config.memoryRemote ?? "<memory-remote>"} ${tracking.expectedPath ?? "memory"}`
      }
    };
  }

  return {
    code: "project_setup.child_tracking",
    severity: "ok",
    message:
      config.memoryGitMode === "submodule"
        ? "Child memory is tracked by a real Git submodule gitlink and has no project-tracked files"
        : "Child memory is not tracked by the project Git index",
    details: tracking
  };
}

function projectSetupGitmodulesDiagnostic(
  inspection: ProjectSetupDriftInspection,
  repairedKinds: ReadonlySet<ProjectSetupRepairKind>
): Diagnostic {
  const gitmodules = inspection.gitmodules;
  const config = inspection.config;
  if (!gitmodules || !config) {
    return {
      code: "project_setup.gitmodules",
      severity: "warning",
      message: "Skipped `.gitmodules` checks because project setup config is invalid"
    };
  }
  if (repairedKinds.has("gitmodules")) {
    return {
      code: "project_setup.gitmodules",
      severity: "fixed",
      message: "Repaired child memory `.gitmodules` metadata",
      details: { gitmodules, repairs: projectSetupRepairs(inspection, "gitmodules") }
    };
  }
  if (gitmodules.error) {
    return {
      code: "project_setup.gitmodules",
      severity: config.memoryGitMode === "submodule" ? "error" : "warning",
      message: "Could not inspect `.gitmodules`",
      details: gitmodules
    };
  }
  if (config.memoryGitMode === "submodule" && !gitmodules.ok) {
    return {
      code: "project_setup.gitmodules",
      severity: "error",
      message: "Child submodule setup has missing or stale `.gitmodules` metadata",
      details: { ...gitmodules, repairCommand: "bwrk doctor --fix --json" }
    };
  }
  if (gitmodules.unexpected) {
    return {
      code: "project_setup.gitmodules",
      severity: "warning",
      message: "Stale `.gitmodules` metadata references memory, but setup mode is not submodule",
      details: gitmodules
    };
  }
  return {
    code: "project_setup.gitmodules",
    severity: "ok",
    message:
      config.memoryGitMode === "submodule"
        ? "Child memory `.gitmodules` metadata is current"
        : "No stale child memory `.gitmodules` metadata found",
    details: gitmodules
  };
}

type ProjectSetupRepairKind = ProjectSetupDriftInspection["repairs"][number]["kind"];

function projectSetupRepairs(
  inspection: ProjectSetupDriftInspection,
  ...kinds: readonly ProjectSetupRepairKind[]
): readonly ProjectSetupDriftInspection["repairs"][number][] {
  const allowed = new Set(kinds);
  return inspection.repairs.filter((repair) => allowed.has(repair.kind));
}

async function validateSearchIndex(
  context: CliContext,
  fix: boolean
): Promise<{
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}> {
  try {
    const inspection = await inspectSearchIndex(context);
    if (!inspection.exists || inspection.stale || inspection.error) {
      if (fix) {
        const rebuilt = await writeSearchIndex(context);
        return {
          fixed: true,
          diagnostics: [
            {
              code: "search.index",
              severity: "fixed",
              message: "Rebuilt local search index",
              details: { inspection, rebuilt }
            }
          ]
        };
      }
      return {
        fixed: false,
        diagnostics: [
          {
            code: "search.index",
            severity: "warning",
            message: searchIndexDiagnosticMessage(inspection),
            details: inspection
          }
        ]
      };
    }

    return {
      fixed: false,
      diagnostics: [
        {
          code: "search.index",
          severity: "ok",
          message: "Local search index is fresh",
          details: inspection
        }
      ]
    };
  } catch (error) {
    return {
      fixed: false,
      diagnostics: [
        {
          code: "search.index",
          severity: "warning",
          message: "Local search index could not be inspected",
          details: error instanceof Error ? error.message : error
        }
      ]
    };
  }
}

async function readStateDocument(
  context: CliContext,
  diagnostics: Diagnostic[]
): Promise<Record<string, unknown> | undefined> {
  if (!existsSync(context.paths.stateFile)) {
    diagnostics.push({
      code: "state.missing",
      severity: "error",
      message: "Missing runtime state file; run `bwrk init`"
    });
    return undefined;
  }

  try {
    const parsed = await readJsonFile(context.paths.stateFile, {
      schemaName: "boreal.file-store.v1",
      expectedObject: true,
      maxBytes: 50 * 1024 * 1024
    });
    if (!isRecord(parsed)) {
      diagnostics.push({
        code: "state.shape",
        severity: "error",
        message: "Runtime state must be a JSON object"
      });
      return undefined;
    }
    if (parsed.schemaVersion !== "boreal.file-store.v1") {
      diagnostics.push({
        code: "state.schema",
        severity: "error",
        message: "Unsupported runtime state schema version",
        details: { schemaVersion: parsed.schemaVersion }
      });
      return undefined;
    }
    diagnostics.push({
      code: "state.parse",
      severity: "ok",
      message: "Runtime state JSON parses and schema version is supported"
    });
    return parsed;
  } catch (error) {
    diagnostics.push({
      code: "state.parse",
      severity: "error",
      message: "Runtime state JSON is invalid",
      details: error instanceof Error ? error.message : error
    });
    return undefined;
  }
}

function validateStateSections(state: Record<string, unknown>, diagnostics: Diagnostic[]): void {
  for (const section of STATE_SECTIONS) {
    const value = state[section];
    if (value === undefined && section === "operations") {
      continue;
    }
    if (!Array.isArray(value)) {
      diagnostics.push({
        code: "state.section",
        severity: "error",
        message: `Runtime state section ${section} must be an array`
      });
    }
  }
}

function validateMissingIds(state: Record<string, unknown>, diagnostics: Diagnostic[]): void {
  const missing: Array<{ section: string; index: number }> = [];

  for (const section of STATE_SECTIONS) {
    const values = state[section];
    if (!Array.isArray(values)) {
      continue;
    }
    values.forEach((value, index) => {
      if (!readRecordId(value, section)) {
        missing.push({ section, index });
      }
    });
  }

  diagnostics.push({
    code: "state.missing_ids",
    severity: missing.length > 0 ? "error" : "ok",
    message: missing.length > 0 ? "Records missing IDs found" : "All records expose IDs",
    details: missing.length > 0 ? missing : undefined
  });
}

function validateDuplicateIds(state: Record<string, unknown>, diagnostics: Diagnostic[]): void {
  const duplicates: Array<{ section: string; id: string }> = [];

  for (const section of STATE_SECTIONS) {
    const values = state[section];
    if (!Array.isArray(values)) {
      continue;
    }
    const seen = new Set<string>();
    for (const value of values) {
      const id = readRecordId(value, section);
      if (!id) {
        continue;
      }
      if (seen.has(id)) {
        duplicates.push({ section, id });
      } else {
        seen.add(id);
      }
    }
  }

  diagnostics.push({
    code: "state.duplicate_ids",
    severity: duplicates.length > 0 ? "error" : "ok",
    message: duplicates.length > 0 ? "Duplicate record IDs found" : "No duplicate record IDs found",
    details: duplicates.length > 0 ? duplicates : undefined
  });
}

function validateSchemaConformance(
  state: Record<string, unknown>,
  diagnostics: Diagnostic[]
): ReturnType<typeof runtimeSnapshotSchemaIssues> {
  const issues = runtimeSnapshotSchemaIssues({
    workItems: stateSection(state, "workItems"),
    agentSummaries: stateSection(state, "agentSummaries"),
    evidence: stateSection(state, "evidence"),
    verifications: stateSection(state, "verifications"),
    directiveAcknowledgements: stateSection(state, "directiveAcknowledgements"),
    knowledgeSources: stateSection(state, "knowledgeSources"),
    claims: stateSection(state, "claims"),
    decisions: stateSection(state, "decisions"),
    graphEdges: stateSection(state, "graphEdges"),
    reservations: stateSection(state, "reservations"),
    events: stateSection(state, "events"),
    operations: stateSection(state, "operations"),
    projections: stateSection(state, "projections"),
    contextPacks: stateSection(state, "contextPacks")
  });

  diagnostics.push({
    code: "state.schema_validation",
    severity: issues.length > 0 ? "error" : "ok",
    message: issues.length > 0 ? "Runtime state failed schema validation" : "Runtime state matches integrated schemas",
    details: issues.length > 0 ? { issues: issues.slice(0, 50), issueCount: issues.length } : undefined
  });
  return issues;
}

async function validateStoreRecords(
  context: CliContext,
  fix: boolean,
  state: Record<string, unknown>
): Promise<{
  readonly fixed: boolean;
  readonly diagnostics: readonly Diagnostic[];
}> {
  const diagnostics: Diagnostic[] = [];
  let fixed = false;
  let workStateChanged = false;

  try {
    const generatedTombstones = await readGeneratedLedgerTombstones(context);
    const wikiCoverage = await inspectDoctorWikiCoverage(context);
    const summary = (() => {
      const rawWorkItems = stateSection<WorkItem>(state, "workItems");
      const rawAgentSummaries = stateSection<AgentSummaryRecord>(state, "agentSummaries");
      const rawEvidence = stateSection<EvidenceRecord>(state, "evidence");
      const rawVerifications = stateSection<VerificationRecord>(state, "verifications");
      const rawDirectiveAcknowledgements = stateSection<DirectiveAcknowledgementRecord>(state, "directiveAcknowledgements");
      const rawKnowledgeSources = stateSection<KnowledgeSource>(state, "knowledgeSources");
      const rawClaims = stateSection<ClaimRecord>(state, "claims");
      const rawDecisions = stateSection<DecisionRecord>(state, "decisions");
      const rawContextPacks = stateSection<ContextPack>(state, "contextPacks");
      const rawGraphEdges = stateSection<GraphEdge>(state, "graphEdges");
      const rawReservations = stateSection<AgentReservation>(state, "reservations");
      const rawEvents = stateSection<Record<string, unknown>>(state, "events");
      const rawOperations = stateSection<RuntimeOperation>(state, "operations");
      const rawProjections = stateSection<ProjectionRecord>(state, "projections");
      const malformedRecords = [
        ...malformedIndexes(rawWorkItems, isDoctorWorkItem, "workItems"),
        ...malformedIndexes(rawAgentSummaries, isDoctorAgentSummary, "agentSummaries"),
        ...malformedIndexes(rawEvidence, isDoctorEvidence, "evidence"),
        ...malformedIndexes(rawVerifications, isDoctorVerification, "verifications"),
        ...malformedIndexes(rawDirectiveAcknowledgements, isDoctorDirectiveAcknowledgement, "directiveAcknowledgements"),
        ...malformedIndexes(rawKnowledgeSources, isDoctorKnowledgeSource, "knowledgeSources"),
        ...malformedIndexes(rawClaims, isDoctorClaim, "claims"),
        ...malformedIndexes(rawDecisions, isDoctorDecision, "decisions"),
        ...malformedIndexes(rawContextPacks, isDoctorContextPack, "contextPacks"),
        ...malformedIndexes(rawGraphEdges, isDoctorGraphEdge, "graphEdges"),
        ...malformedIndexes(rawReservations, isDoctorReservation, "reservations"),
        ...malformedIndexes(rawOperations, isDoctorOperation, "operations"),
        ...malformedIndexes(rawProjections, isDoctorProjection, "projections")
      ];
      const workItems = rawWorkItems.filter(isDoctorWorkItem);
      const agentSummaries = rawAgentSummaries.filter(isDoctorAgentSummary);
      const evidence = rawEvidence.filter(isDoctorEvidence);
      const verifications = rawVerifications.filter(isDoctorVerification);
      const directiveAcknowledgements = rawDirectiveAcknowledgements.filter(isDoctorDirectiveAcknowledgement);
      const knowledgeSources = rawKnowledgeSources.filter(isDoctorKnowledgeSource);
      const claims = rawClaims.filter(isDoctorClaim);
      const decisions = rawDecisions.filter(isDoctorDecision);
      const graphEdges = rawGraphEdges.filter(isDoctorGraphEdge);
      const reservations = rawReservations.filter(isDoctorReservation);
      const operations = rawOperations.filter(isDoctorOperation);
      const projections = rawProjections.filter(isDoctorProjection);
      const evidenceById = new Map(evidence.map((record) => [record.meta.id, record]));
      const sourceById = new Map(knowledgeSources.map((record) => [record.meta.id, record]));
      const verificationsById = new Map(verifications.map((record) => [record.meta.id, record]));
      const workById = new Map(workItems.map((work) => [work.meta.id, work]));
      const summariesById = new Map(agentSummaries.map((record) => [record.meta.id, record]));
      const summaryArtifactUris = new Set(agentSummaries.flatMap((summary) => (summary.artifactUri ? [summary.artifactUri] : [])));
      const operationById = new Map<string, RuntimeOperation>(operations.map((operation) => [operation.meta.id, operation]));
      const eventById = new Map<string, Record<string, unknown>>();
      for (const event of rawEvents) {
        const eventId = readRecordId(event, "events");
        if (eventId) {
          eventById.set(eventId, event);
        }
      }
      const eventIds = new Set(eventById.keys());
      const danglingDependencies = workItems.flatMap((work) =>
        work.dependencyIds
          .filter((dependencyId) => !workById.has(dependencyId))
          .map((dependencyId) => ({ workId: work.meta.id, dependencyId }))
      );
      const danglingEvidence = workItems.flatMap((work) =>
        work.evidenceIds
          .filter((evidenceId) => !evidenceById.has(evidenceId))
          .map((evidenceId) => ({ workId: work.meta.id, evidenceId }))
      );
      const danglingVerifications = workItems.flatMap((work) =>
        work.verificationIds
          .filter((verificationId) => !verificationsById.has(verificationId))
          .map((verificationId) => ({ workId: work.meta.id, verificationId }))
      );
      const danglingSummaryEvidence = agentSummaries.flatMap((summary) =>
        summary.evidenceIds
          .filter((evidenceId) => !evidenceById.has(evidenceId))
          .map((evidenceId) => ({ summaryId: summary.meta.id, evidenceId }))
      );
      const danglingSummaryVerifications = agentSummaries.flatMap((summary) =>
        summary.verificationIds
          .filter((verificationId) => !verificationsById.has(verificationId))
          .map((verificationId) => ({ summaryId: summary.meta.id, verificationId }))
      );
      const danglingSummaryChildren = agentSummaries.flatMap((summary) =>
        summary.childSummaryIds
          .filter((summaryId) => !summariesById.has(summaryId))
          .map((childSummaryId) => ({ summaryId: summary.meta.id, childSummaryId }))
      );
      const danglingSummaryParents = agentSummaries
        .filter((summary) => summary.parentSummaryId !== undefined && !summariesById.has(summary.parentSummaryId))
        .map((summary) => ({ summaryId: summary.meta.id, parentSummaryId: summary.parentSummaryId }));
      const danglingSummarySubjects = agentSummaries
        .filter((summary) => ["work", "sprint", "milestone"].includes(summary.subjectType) && !workById.has(summary.subjectId as WorkId))
        .map((summary) => ({ summaryId: summary.meta.id, subjectId: summary.subjectId, subjectType: summary.subjectType }));
      const danglingDirectiveAcknowledgementEvidence = directiveAcknowledgements.flatMap((acknowledgement) =>
        acknowledgement.evidenceIds
          .filter((evidenceId) => !evidenceById.has(evidenceId))
          .map((evidenceId) => ({ acknowledgementId: acknowledgement.meta.id, evidenceId }))
      );
      const danglingDirectiveAcknowledgementSummaries = directiveAcknowledgements.flatMap((acknowledgement) =>
        acknowledgement.agentSummaryIds
          .filter((summaryId) => !summariesById.has(summaryId))
          .map((summaryId) => ({ acknowledgementId: acknowledgement.meta.id, summaryId }))
      );
      const danglingDirectiveAcknowledgementVerifications = directiveAcknowledgements.flatMap((acknowledgement) =>
        (acknowledgement.verificationIds ?? [])
          .filter((verificationId) => !verificationsById.has(verificationId))
          .map((verificationId) => ({ acknowledgementId: acknowledgement.meta.id, verificationId }))
      );
      const danglingDirectiveAcknowledgementArtifacts = directiveAcknowledgements.flatMap((acknowledgement) =>
        (acknowledgement.artifactUris ?? [])
          .filter((artifactUri) => isAgentSummaryArtifactUri(artifactUri) && !summaryArtifactUris.has(artifactUri))
          .map((artifactUri) => ({ acknowledgementId: acknowledgement.meta.id, artifactUri }))
      );
      const danglingDirectiveAcknowledgementHandoffs = directiveAcknowledgements.flatMap((acknowledgement) =>
        acknowledgement.handoffIds
          .filter((handoffId) =>
            isOperationReference(handoffId)
              ? !operationById.has(handoffId)
              : isAgentSummaryReference(handoffId)
                ? !summariesById.has(handoffId as AgentSummaryRecord["meta"]["id"])
                : false
          )
          .map((handoffId) => ({ acknowledgementId: acknowledgement.meta.id, handoffId }))
      );
      const danglingDirectiveAcknowledgementSubjects = directiveAcknowledgements
        .filter(
          (acknowledgement) =>
            acknowledgement.subjectId !== undefined &&
            ["work", "sprint", "phase", "milestone"].includes(acknowledgement.subjectType) &&
            !workById.has(acknowledgement.subjectId as WorkId)
        )
        .map((acknowledgement) => ({
          acknowledgementId: acknowledgement.meta.id,
          subjectId: acknowledgement.subjectId,
          subjectType: acknowledgement.subjectType
        }));
      const terminalWorkItems = workItems.filter(isTerminalCloseoutWork);
      const terminalWorkSubjectKeys = new Set(
        terminalWorkItems.map((work) => closeoutSummarySubjectKey(doctorSummarySubjectTypeForWork(work), work.meta.id))
      );
      const closeoutSummaries = agentSummaries.filter(isFinalOrForcedAgentSummary);
      const closeoutSummaryKeys = new Set(
        closeoutSummaries.map((summary) => closeoutSummarySubjectKey(summary.subjectType, summary.subjectId))
      );
      const closeoutSummariesForTerminalWork = closeoutSummaries.filter((summary) =>
        terminalWorkSubjectKeys.has(closeoutSummarySubjectKey(summary.subjectType, summary.subjectId))
      );
      const missingCloseoutSummaryCandidates = terminalWorkItems
        .filter((work) => !closeoutSummaryKeys.has(closeoutSummarySubjectKey(doctorSummarySubjectTypeForWork(work), work.meta.id)))
        .map((work) => ({
          workId: work.meta.id,
          title: work.title,
          status: work.status,
          kind: work.kind,
          expectedSubjectType: doctorSummarySubjectTypeForWork(work),
          closedAt: work.closedAt
        }));
      const missingCloseoutSummaries = missingCloseoutSummaryCandidates.filter((entry) =>
        isAgentSummaryPolicyEnforcedAt(entry.closedAt)
      );
      const legacyMissingCloseoutSummaries = missingCloseoutSummaryCandidates.filter((entry) =>
        !isAgentSummaryPolicyEnforcedAt(entry.closedAt)
      );
      const legacyDirectiveCompatibleSummaries = closeoutSummariesForTerminalWork.flatMap((summary) =>
        doctorLegacyDirectiveCompatibility(summary)
      );
      const directiveCoverageGaps = closeoutSummariesForTerminalWork
        .filter((summary) => isAgentDirectiveAcknowledgementPolicyEnforcedAt(summary.generatedAt))
        .filter((summary) => doctorLegacyDirectiveCompatibility(summary).length === 0)
        .filter((summary) => !doctorSummaryHasDirectiveAcknowledgementCoverage(summary, directiveAcknowledgements))
        .map((summary) => ({
          summaryId: summary.meta.id,
          subjectId: summary.subjectId,
          subjectType: summary.subjectType,
          generatedAt: summary.generatedAt,
          artifactUri: summary.artifactUri,
          issue: "missing_directive_acknowledgement_coverage"
        }));
      const summaryCheckpointGapCandidates = closeoutSummariesForTerminalWork
        .filter((summary) => summary.commitShas.length === 0 && !dirtyPathNotesHaveReasonCode(summary.dirtyPathNotes))
        .map((summary) => ({
          summaryId: summary.meta.id,
          subjectId: summary.subjectId,
          subjectType: summary.subjectType,
          status: summary.status,
          generatedAt: summary.generatedAt,
          issue: "missing_commit_or_dirty_path_reason"
        }));
      const summaryCheckpointGaps = summaryCheckpointGapCandidates.filter((entry) =>
        isAgentSummaryPolicyEnforcedAt(entry.generatedAt)
      );
      const legacySummaryCheckpointGaps = summaryCheckpointGapCandidates.filter((entry) =>
        !isAgentSummaryPolicyEnforcedAt(entry.generatedAt)
      );
      const summaryArtifactGapCandidates = closeoutSummariesForTerminalWork
        .filter((summary) => !summary.artifactUri)
        .map((summary) => ({
          summaryId: summary.meta.id,
          subjectId: summary.subjectId,
          subjectType: summary.subjectType,
          status: summary.status,
          generatedAt: summary.generatedAt,
          issue: "missing_artifact_uri"
        }));
      const summaryArtifactGaps = summaryArtifactGapCandidates.filter((entry) =>
        isAgentSummaryPolicyEnforcedAt(entry.generatedAt)
      );
      const legacySummaryArtifactGaps = summaryArtifactGapCandidates.filter((entry) =>
        !isAgentSummaryPolicyEnforcedAt(entry.generatedAt)
      );
      const forcedSummaryReasonGaps = agentSummaries
        .filter((summary) => summary.status === "forced" && (!summary.forceReasonCode || !summary.forceComment?.trim()))
        .map((summary) => ({
          summaryId: summary.meta.id,
          subjectId: summary.subjectId,
          subjectType: summary.subjectType,
          forceReasonCode: summary.forceReasonCode,
          hasForceComment: Boolean(summary.forceComment?.trim())
        }));
      const blockEdges = graphEdges.filter(
        (edge) => edge.kind === "blocks" && edge.fromType === "work" && edge.toType === "work"
      );
      const expectedDependencyIds = dependencyIdsByWorkFromGraph(workItems, blockEdges);
      const reviewGateCounts = doctorReviewGateCounts(workItems, evidence, expectedDependencyIds);
      const requiredGateCoverageGaps = doctorRequiredCloseoutGateCoverageGaps(
        workItems,
        evidence,
        verifications,
        agentSummaries,
        expectedDependencyIds
      );
      const staleReadiness = workItems.flatMap((work) => {
        const dependencyIds = expectedDependencyIds.get(work.meta.id) ?? [];
        const dependencies = dependencyIds.map((dependencyId) => workById.get(dependencyId)).filter(isWorkItem);
        const expected = deriveReadinessStatus({ ...work, dependencyIds }, dependencies);
        return expected === work.status ? [] : [{ workId: work.meta.id, actual: work.status, expected }];
      });
      const contextPackSubjects = new Set(rawContextPacks.filter(isDoctorContextPack).map((pack) => pack.subjectId));
      const missingContextPacks = workItems
        .filter((work) => !contextPackSubjects.has(work.meta.id))
        .filter((work) => !generatedTombstones.contextPackIds.has(expectedContextProjectionId(work.meta.id)))
        .map((work) => work.meta.id);
      const contextPackBySubject = new Map(
        rawContextPacks.filter(isDoctorContextPack).map((pack) => [pack.subjectId, pack])
      );
      const contextProjectionBySubject = new Map(
        projections.filter((projection) => projection.kind === "context-pack").map((projection) => [projection.subjectId, projection])
      );
      const missingContextProjections = workItems
        .filter((work) => !contextProjectionBySubject.has(work.meta.id))
        .filter((work) => !generatedTombstones.projectionIds.has(expectedContextProjectionId(work.meta.id)))
        .map((work) => work.meta.id);
      const contextPackDrift = workItems.flatMap((work) => {
        const pack = contextPackBySubject.get(work.meta.id);
        if (!pack) {
          return [];
        }
        if (generatedTombstones.contextPackIds.has(pack.id)) {
          return [];
        }
        const graphWork = { ...work, dependencyIds: expectedDependencyIds.get(work.meta.id) ?? [] };
        const expected = buildContextPack({
          work: graphWork,
          evidence: evidence.filter((record) => record.subjectId === work.meta.id),
          sources: knowledgeSources,
          claims,
          decisions,
          actor: context.actor,
          now: pack.generatedAt
        });
        return contextPackMatches(pack, expected)
          ? []
          : [{ workId: work.meta.id, contextPackId: pack.id, issue: "context_pack_drift" }];
      });
      const contextProjectionDrift = workItems.flatMap((work) => {
        const projection = contextProjectionBySubject.get(work.meta.id);
        if (!projection) {
          return [];
        }
        if (generatedTombstones.projectionIds.has(projection.meta.id)) {
          return [];
        }
        const graphWork = { ...work, dependencyIds: expectedDependencyIds.get(work.meta.id) ?? [] };
        const expected = buildContextProjection({
          work: graphWork,
          evidence: evidence.filter((record) => record.subjectId === work.meta.id),
          sources: knowledgeSources,
          claims,
          decisions,
          actor: context.actor,
          now: projection.meta.updatedAt
        });
        return contextProjectionMatches(projection, expected)
          ? []
          : [{ workId: work.meta.id, projectionId: projection.meta.id, issue: "context_projection_drift" }];
      });
      const danglingClaimSources = claims.flatMap((claim) =>
        claim.sourceIds
          .filter((sourceId) => !sourceById.has(sourceId))
          .map((sourceId) => ({ claimId: claim.meta.id, sourceId }))
      );
      const danglingClaimEvidence = claims.flatMap((claim) =>
        claim.evidenceIds
          .filter((evidenceId) => !evidenceById.has(evidenceId))
          .map((evidenceId) => ({ claimId: claim.meta.id, evidenceId }))
      );
      const danglingDecisionSources = decisions.flatMap((decision) =>
        decision.sourceIds
          .filter((sourceId) => !sourceById.has(sourceId))
          .map((sourceId) => ({ decisionId: decision.meta.id, sourceId }))
      );
      const wikiReferenceCount = [...claims, ...decisions].reduce(
        (count, record) => count + knowledgeRecordWikiPageIds(record).length,
        0
      );
      const danglingClaimWikiPages = wikiCoverage.available
        ? claims.flatMap((claim) =>
            knowledgeRecordWikiPageIds(claim)
              .filter((wikiPageId) => !wikiCoverage.pageIds.has(wikiPageId))
              .map((wikiPageId) => ({ claimId: claim.meta.id, wikiPageId }))
          )
        : [];
      const danglingDecisionWikiPages = wikiCoverage.available
        ? decisions.flatMap((decision) =>
            knowledgeRecordWikiPageIds(decision)
              .filter((wikiPageId) => !wikiCoverage.pageIds.has(wikiPageId))
              .map((wikiPageId) => ({ decisionId: decision.meta.id, wikiPageId }))
          )
        : [];
      const missingWikiCoverage = [
        ...claims
          .filter((claim) => claim.status !== "rejected" && claim.sourceIds.length > 0 && knowledgeRecordWikiPageIds(claim).length === 0)
          .map((claim) => ({ kind: "claim", claimId: claim.meta.id, status: claim.status, sourceIds: claim.sourceIds })),
        ...decisions
          .filter(
            (decision) =>
              decision.status !== "rejected" &&
              decision.status !== "superseded" &&
              decision.sourceIds.length > 0 &&
              knowledgeRecordWikiPageIds(decision).length === 0
          )
          .map((decision) => ({ kind: "decision", decisionId: decision.meta.id, status: decision.status, sourceIds: decision.sourceIds }))
      ];
      const staleSourceBackedAssertions = claims
        .filter((claim) => claim.status === "stale" && claim.sourceIds.length > 0)
        .map((claim) => ({
          claimId: claim.meta.id,
          sourceIds: claim.sourceIds,
          wikiPageIds: knowledgeRecordWikiPageIds(claim)
        }));
      const claimContradictions = claimContradictionFindings(claims);
      const supersededDecisionReviews = supersededDecisionReviewFindings(decisions);
      const rawSourceReconciliation = rawSourceReconciliationFindings(wikiCoverage.rawSources, wikiCoverage.wikiPages);
      const duplicateGraphEdges = duplicateGraphEdgeKeys(graphEdges);
      const danglingWorkGraphEdges = graphEdges.flatMap((edge) => {
        const issues: Array<{ edgeId: string; side: "from" | "to"; workId: string }> = [];
        if (edge.fromType === "work" && !workById.has(edge.fromId as WorkId)) {
          issues.push({ edgeId: edge.meta.id, side: "from", workId: edge.fromId });
        }
        if (edge.toType === "work" && !workById.has(edge.toId as WorkId)) {
          issues.push({ edgeId: edge.meta.id, side: "to", workId: edge.toId });
        }
        return issues;
      });
      const blockEdgeKeys = new Set(blockEdges.map((edge) => `${edge.fromId}->${edge.toId}`));
      const blockConsistency = [
        ...blockEdges.flatMap((edge) => {
          const blockedWork = workById.get(edge.toId as WorkId);
          if (!blockedWork || blockedWork.dependencyIds.includes(edge.fromId as WorkId)) {
            return [];
          }
          return [
            {
              issue: "edge_missing_dependency",
              edgeId: edge.meta.id,
              workId: edge.toId,
              dependencyId: edge.fromId
            }
          ];
        }),
        ...workItems.flatMap((work) =>
          work.dependencyIds
            .filter((dependencyId) => workById.has(dependencyId) && !blockEdgeKeys.has(`${dependencyId}->${work.meta.id}`))
            .map((dependencyId) => ({
              issue: "dependency_missing_edge",
              workId: work.meta.id,
              dependencyId
            }))
        )
      ];
      const dependencyCycles = findDependencyCycles(blockEdges);
      const reservationConsistency = reservationPolicyIssues(workItems, reservations);
      const expiredActiveReservations = reservations
        .filter((reservation) => reservation.status === "active")
        .filter((reservation) => reservation.expiresAt !== undefined && Date.parse(reservation.expiresAt) <= Date.now())
        .map((reservation) => ({
          reservationId: reservation.meta.id,
          workId: reservation.workId,
          agentId: reservation.agentId,
          expiresAt: reservation.expiresAt
        }));
      const verificationPolicy = verificationPolicyIssues(workItems, verifications, evidenceById);
      const closedWithoutReason = workItems
        .filter((work) => work.status === "closed" && !work.closedReason?.trim())
        .map((work) => work.meta.id);
      const danglingOperationEvents = operations.flatMap((operation) =>
        operation.eventIds
          .filter((eventId) => !eventIds.has(eventId))
          .map((eventId) => ({ operationId: operation.meta.id, eventId }))
      );
      const operationIdsByEvent = operationIdsByEventId(operations);
      const legacyOperationEvents = rawEvents.flatMap((event) => {
        const eventId = readRecordId(event, "events");
        if (!eventId) {
          return [];
        }
        if (event.operationLink === "legacy") {
          return [{ issue: "legacy_operation_link", eventId }];
        }
        const operationIds = operationIdsByEvent.get(eventId) ?? [];
        if (event.operationId === undefined && operationIds.length > 0) {
          return [{ issue: "unmarked_legacy_operation_link", eventId, operationIds }];
        }
        return [];
      });
      const operationEventCausality = [
        ...operations.flatMap((operation) =>
          operation.eventIds.flatMap((eventId) => {
            const event = eventById.get(eventId);
            if (!event || event.operationId === undefined || event.operationId === operation.meta.id) {
              return [];
            }
            return [
              {
                issue: "event_points_to_different_operation",
                operationId: operation.meta.id,
                eventId,
                eventOperationId: event.operationId
              }
            ];
          })
        ),
        ...rawEvents.flatMap((event) => {
          const eventId = readRecordId(event, "events");
          const operationId = event.operationId;
          if (!eventId || typeof operationId !== "string") {
            return [];
          }
          const operation = operationById.get(operationId);
          if (!operation || operation.eventIds.some((id) => id === eventId)) {
            return [];
          }
          return [{ issue: "operation_missing_event_id", operationId, eventId }];
        })
      ];
      const stringSafety = stringSafetyIssues({
        workItems,
        agentSummaries,
        evidence,
        verifications,
        directiveAcknowledgements,
        knowledgeSources,
        claims,
        decisions,
        graphEdges,
        reservations,
        operations,
        contextPacks: rawContextPacks.filter(isDoctorContextPack)
      });
      const labelCollisions = labelNormalizationCollisions(workItems);
      const actorCollisions = actorNormalizationCollisions({
        workItems,
        agentSummaries,
        evidence,
        verifications,
        directiveAcknowledgements,
        knowledgeSources,
        claims,
        decisions,
        graphEdges,
        reservations,
        operations
      });

      return {
        workCount: workItems.length,
        operationCount: operations.length,
        malformedRecords,
        danglingDependencies,
        danglingEvidence,
        danglingVerifications,
        staleReadiness,
        missingContextPacks,
        contextPackDrift,
        missingContextProjections,
        contextProjectionDrift,
        danglingClaimSources,
        danglingClaimEvidence,
        danglingDecisionSources,
        wikiCoverage,
        wikiReferenceCount,
        danglingClaimWikiPages,
        danglingDecisionWikiPages,
        missingWikiCoverage,
        staleSourceBackedAssertions,
        claimContradictions,
        supersededDecisionReviews,
        rawSourceReconciliation,
        duplicateGraphEdges,
        danglingWorkGraphEdges,
        blockConsistency,
        dependencyCycles,
        reservationConsistency,
        expiredActiveReservations,
        verificationPolicy,
        closedWithoutReason,
        missingCloseoutSummaries,
        legacyMissingCloseoutSummaries,
        directiveCoverageGaps,
        legacyDirectiveCompatibleSummaries,
        summaryCheckpointGaps,
        legacySummaryCheckpointGaps,
        summaryArtifactGaps,
        legacySummaryArtifactGaps,
        forcedSummaryReasonGaps,
        reviewGateCounts,
        requiredGateCoverageGaps,
        danglingSummaryEvidence,
        danglingSummaryVerifications,
        danglingSummaryChildren,
        danglingSummaryParents,
        danglingSummarySubjects,
        danglingDirectiveAcknowledgementEvidence,
        danglingDirectiveAcknowledgementSummaries,
        danglingDirectiveAcknowledgementVerifications,
        danglingDirectiveAcknowledgementArtifacts,
        danglingDirectiveAcknowledgementHandoffs,
        danglingDirectiveAcknowledgementSubjects,
        danglingOperationEvents,
        legacyOperationEvents,
        operationEventCausality,
        stringSafety,
        labelCollisions,
        actorCollisions
      };
    })();

    diagnostics.push({
      code: "work.count",
      severity: "ok",
      message: `${summary.workCount} work item(s) loaded`
    });
    diagnostics.push({
      code: "operation.count",
      severity: "ok",
      message: `${summary.operationCount} operation(s) loaded`
    });
    const operationVolumeExceeded = summary.operationCount > OPERATION_LOG_WARNING_THRESHOLD;
    diagnostics.push({
      code: "operation.volume",
      severity: operationVolumeExceeded ? "warning" : "ok",
      message:
        operationVolumeExceeded
          ? `Operation log has ${summary.operationCount} records; run \`bwrk operation prune --keep ${OPERATION_LOG_RECOMMENDED_KEEP} --json\``
          : summary.operationCount > OPERATION_LOG_RECOMMENDED_KEEP
            ? "Operation log volume is above the prune target but within maintenance grace"
            : "Operation log volume is within the recommended bound",
      details:
        summary.operationCount > OPERATION_LOG_RECOMMENDED_KEEP
          ? {
              operationCount: summary.operationCount,
              recommendedKeep: OPERATION_LOG_RECOMMENDED_KEEP,
              warningThreshold: OPERATION_LOG_WARNING_THRESHOLD
            }
          : undefined
    });
    diagnostics.push(diagnosticFromList("state.record_shape", "Malformed runtime records", summary.malformedRecords));
    diagnostics.push(diagnosticFromList("work.dangling_dependencies", "Dangling work dependencies", summary.danglingDependencies));
    diagnostics.push(diagnosticFromList("work.dangling_evidence", "Dangling work evidence references", summary.danglingEvidence));
    diagnostics.push(
      diagnosticFromList("work.dangling_verifications", "Dangling work verification references", summary.danglingVerifications)
    );
    diagnostics.push(
      diagnosticFromList("summary.dangling_evidence", "Dangling agent summary evidence references", summary.danglingSummaryEvidence)
    );
    diagnostics.push(
      diagnosticFromList(
        "summary.dangling_verifications",
        "Dangling agent summary verification references",
        summary.danglingSummaryVerifications
      )
    );
    diagnostics.push(
      diagnosticFromList("summary.dangling_children", "Dangling agent summary child references", summary.danglingSummaryChildren)
    );
    diagnostics.push(
      diagnosticFromList("summary.dangling_parent", "Dangling agent summary parent references", summary.danglingSummaryParents)
    );
    diagnostics.push(
      diagnosticFromList("summary.dangling_subject", "Dangling agent summary subject references", summary.danglingSummarySubjects)
    );
    diagnostics.push(
      diagnosticFromList(
        "directive_acknowledgement.dangling_evidence",
        "Dangling directive acknowledgement evidence references",
        summary.danglingDirectiveAcknowledgementEvidence
      )
    );
    diagnostics.push(
      diagnosticFromList(
        "directive_acknowledgement.dangling_summary",
        "Dangling directive acknowledgement summary references",
        summary.danglingDirectiveAcknowledgementSummaries
      )
    );
    diagnostics.push(
      diagnosticFromList(
        "directive_acknowledgement.dangling_verification",
        "Dangling directive acknowledgement verification references",
        summary.danglingDirectiveAcknowledgementVerifications
      )
    );
    diagnostics.push(
      diagnosticFromList(
        "directive_acknowledgement.dangling_artifact",
        "Dangling directive acknowledgement artifact references",
        summary.danglingDirectiveAcknowledgementArtifacts
      )
    );
    diagnostics.push(
      diagnosticFromList(
        "directive_acknowledgement.dangling_handoff",
        "Dangling directive acknowledgement handoff references",
        summary.danglingDirectiveAcknowledgementHandoffs
      )
    );
    diagnostics.push(
      diagnosticFromList(
        "directive_acknowledgement.dangling_subject",
        "Dangling directive acknowledgement subject references",
        summary.danglingDirectiveAcknowledgementSubjects
      )
    );
    diagnostics.push(diagnosticFromList("knowledge.dangling_sources", "Dangling knowledge source references", [
      ...summary.danglingClaimSources,
      ...summary.danglingDecisionSources
    ]));
    diagnostics.push(diagnosticFromList("knowledge.dangling_evidence", "Dangling claim evidence references", summary.danglingClaimEvidence));
    if (summary.wikiCoverage.available) {
      diagnostics.push(diagnosticFromList("knowledge.dangling_wiki_pages", "Dangling wiki page references", [
        ...summary.danglingClaimWikiPages,
        ...summary.danglingDecisionWikiPages
      ]));
    } else if (summary.wikiReferenceCount > 0) {
      diagnostics.push({
        code: "knowledge.dangling_wiki_pages",
        severity: "warning",
        message: "Skipped wiki page reference validation because the Boreal memory vault is unavailable",
        details: { reason: summary.wikiCoverage.unavailableReason, wikiReferenceCount: summary.wikiReferenceCount }
      });
    } else {
      diagnostics.push({
        code: "knowledge.dangling_wiki_pages",
        severity: "ok",
        message: "Dangling wiki page references: none"
      });
    }
    diagnostics.push(
      warningDiagnosticFromList("knowledge.missing_wiki_coverage", "Source-backed claims and decisions missing wiki coverage", summary.missingWikiCoverage)
    );
    diagnostics.push(
      warningDiagnosticFromList("knowledge.stale_source_assertions", "Stale source-backed assertions", summary.staleSourceBackedAssertions)
    );
    diagnostics.push(
      warningDiagnosticFromList("knowledge.claim_contradictions", "Accepted claims with conflicting stale or rejected claim records", summary.claimContradictions)
    );
    diagnostics.push(
      warningDiagnosticFromList(
        "knowledge.superseded_decision_review",
        "Superseded decisions missing an accepted replacement decision",
        summary.supersededDecisionReviews
      )
    );
    diagnostics.push(
      warningDiagnosticFromList("knowledge.raw_source_reconciliation", "Raw sources waiting for memory reconciliation", summary.rawSourceReconciliation)
    );
    diagnostics.push(diagnosticFromList("graph.duplicate_edges", "Duplicate graph edges", summary.duplicateGraphEdges));
    diagnostics.push(diagnosticFromList("graph.dangling_work_edges", "Dangling graph work edges", summary.danglingWorkGraphEdges));
    if (summary.blockConsistency.length > 0) {
      if (fix) {
        const repaired = await context.runtime.repairDependencyProjection();
        workStateChanged = workStateChanged || repaired.dependencyChanged > 0 || repaired.readinessChanged > 0;
        diagnostics.push({
          code: "graph.block_consistency",
          severity: "fixed",
          message: "Repaired work dependency projection from block graph",
          details: { issues: summary.blockConsistency, repaired }
        });
        fixed = true;
      } else {
        diagnostics.push(diagnosticFromList("graph.block_consistency", "Block graph and dependency refs disagree", summary.blockConsistency));
      }
    } else {
      diagnostics.push({
        code: "graph.block_consistency",
        severity: "ok",
        message: "Block graph and dependency refs agree"
      });
    }
    diagnostics.push(diagnosticFromList("graph.dependency_cycles", "Dependency cycles found", summary.dependencyCycles));
    diagnostics.push(diagnosticFromList("reservation.consistency", "Reservation consistency issues", summary.reservationConsistency));
    if (summary.expiredActiveReservations.length > 0) {
      if (fix) {
        const repair = await context.runtime.expireStaleReservations();
        workStateChanged = workStateChanged || repair.expired.length > 0;
        diagnostics.push({
          code: "reservation.expired",
          severity: "fixed",
          message: `Expired ${repair.expired.length} stale active reservation(s)`,
          details: summary.expiredActiveReservations
        });
        fixed = true;
      } else {
        diagnostics.push({
          code: "reservation.expired",
          severity: "error",
          message: "Expired active reservations found",
          details: summary.expiredActiveReservations
        });
      }
    } else {
      diagnostics.push({
        code: "reservation.expired",
        severity: "ok",
        message: "No expired active reservations"
      });
    }
    diagnostics.push(diagnosticFromList("verification.policy", "Verification policy issues", summary.verificationPolicy));
    diagnostics.push(diagnosticFromList("work.closed_reason", "Closed work items missing a close reason", summary.closedWithoutReason));
    diagnostics.push(diagnosticFromList("summary.force_reason", "Forced agent summaries missing reason code or comment", summary.forcedSummaryReasonGaps));
    diagnostics.push(
      diagnosticFromList("summary.closeout_coverage", "Terminal work missing final or forced agent summaries", summary.missingCloseoutSummaries)
    );
    diagnostics.push(
      warningDiagnosticFromList(
        "summary.legacy_closeout_coverage",
        "Legacy terminal work missing final or forced agent summaries",
        summary.legacyMissingCloseoutSummaries
      )
    );
    diagnostics.push(
      warningDiagnosticFromList(
        "summary.directive_coverage",
        "Current-policy closeout summaries missing directive acknowledgement coverage",
        summary.directiveCoverageGaps
      )
    );
    diagnostics.push(legacyDirectiveCompatibilityDiagnostic(summary.legacyDirectiveCompatibleSummaries));
    diagnostics.push(
      diagnosticFromList("summary.checkpoint_coverage", "Closeout summaries missing commit SHA or dirty-path reason code", summary.summaryCheckpointGaps)
    );
    diagnostics.push(
      warningDiagnosticFromList(
        "summary.legacy_checkpoint_coverage",
        "Legacy closeout summaries missing commit SHA or dirty-path reason code",
        summary.legacySummaryCheckpointGaps
      )
    );
    diagnostics.push(
      diagnosticFromList("summary.artifact_coverage", "Closeout summaries missing Markdown artifact URI", summary.summaryArtifactGaps)
    );
    diagnostics.push({
      code: "closeout.review_gate_counts",
      severity: "ok",
      message:
        `Review gates pending ${summary.reviewGateCounts.review.pending}, passed ${summary.reviewGateCounts.review.passed}, forced bypass ${summary.reviewGateCounts.review.forced}; ` +
        `audit gates pending ${summary.reviewGateCounts.audit.pending}, passed ${summary.reviewGateCounts.audit.passed}, forced bypass ${summary.reviewGateCounts.audit.forced}`,
      details: summary.reviewGateCounts
    });
    diagnostics.push(
      warningDiagnosticFromList(
        "closeout.required_gate_coverage",
        "Current-policy terminal work has unsatisfied required closeout gates",
        summary.requiredGateCoverageGaps
      )
    );
    diagnostics.push(
      warningDiagnosticFromList(
        "summary.legacy_artifact_coverage",
        "Legacy closeout summaries missing Markdown artifact URI",
        summary.legacySummaryArtifactGaps
      )
    );
    diagnostics.push(diagnosticFromList("operation.dangling_events", "Operation event references missing runtime events", summary.danglingOperationEvents));
    diagnostics.push(warningDiagnosticFromList("operation.legacy_events", "Legacy operation/event links", summary.legacyOperationEvents));
    diagnostics.push(diagnosticFromList("operation.event_causality", "Operation and event causality links disagree", summary.operationEventCausality));
    diagnostics.push(diagnosticFromList("string.suspicious_unicode", "Unsafe Unicode in machine-facing strings", summary.stringSafety));
    diagnostics.push(warningDiagnosticFromList("label.normalization_collision", "Label normalization collisions", summary.labelCollisions));
    diagnostics.push(warningDiagnosticFromList("actor.normalization_collision", "Actor normalization collisions", summary.actorCollisions));

    if (summary.staleReadiness.length > 0) {
      if (fix) {
        const repair = await context.runtime.recomputeReadiness();
        workStateChanged = workStateChanged || repair.changed > 0;
        diagnostics.push({
          code: "work.readiness",
          severity: "fixed",
          message: `Recomputed derived readiness for ${repair.changed} item(s)`,
          details: summary.staleReadiness
        });
        fixed = true;
      } else {
        diagnostics.push({
          code: "work.readiness",
          severity: "error",
          message: "Derived readiness is stale",
          details: summary.staleReadiness
        });
      }
    } else {
      diagnostics.push({
        code: "work.readiness",
        severity: "ok",
        message: "Derived readiness is consistent"
      });
    }

    const contextPackIssues = [...summary.missingContextPacks.map((workId) => ({ workId, issue: "missing_context_pack" })), ...summary.contextPackDrift];
    const contextProjectionIssues = [
      ...summary.missingContextProjections.map((workId) => ({ workId, issue: "missing_context_projection" })),
      ...summary.contextProjectionDrift
    ];
    if (contextPackIssues.length > 0 || contextProjectionIssues.length > 0 || (fix && workStateChanged)) {
      if (fix) {
        await context.runtime.rebuildProjections({
          skipContextPackIds: generatedTombstones.contextPackIds,
          skipProjectionIds: generatedTombstones.projectionIds
        });
        diagnostics.push({
          code: "projection.context_pack",
          severity: "fixed",
          message: "Rebuilt context pack projections",
          details: { contextPackIssues, contextProjectionIssues, workStateChanged }
        });
        fixed = true;
      } else {
        diagnostics.push({
          code: "projection.context_pack",
          severity: "warning",
          message: "Some context pack projections are missing or stale",
          details: { contextPackIssues, contextProjectionIssues }
        });
      }
    } else {
      diagnostics.push({
        code: "projection.context_pack",
        severity: "ok",
        message: "Context pack projections are present"
      });
    }
  } catch (error) {
    if (error instanceof BorealError) {
      diagnostics.push({
        code: "store.load",
        severity: "error",
        message: error.message,
        details: error.details
      });
    } else {
      throw error;
    }
  }

  return { fixed, diagnostics };
}

function diagnosticFromList(code: string, label: string, values: readonly unknown[]): Diagnostic {
  return {
    code,
    severity: values.length > 0 ? "error" : "ok",
    message: values.length > 0 ? label : `${label}: none`,
    details: values.length > 0 ? values : undefined
  };
}

function diagnosticErrorDetails(error: unknown): Record<string, unknown> {
  if (error instanceof BorealError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  return {
    message: error instanceof Error ? error.message : String(error)
  };
}

function isAgentSummaryArtifactUri(value: string): boolean {
  return value.startsWith("memory://agent-summaries/");
}

function isOperationReference(value: string): boolean {
  return /^bw_operation_[a-f0-9]{12,64}$/u.test(value);
}

function isAgentSummaryReference(value: string): boolean {
  return /^bw_summary_[a-f0-9]{12,64}$/u.test(value);
}

function warningDiagnosticFromList(code: string, label: string, values: readonly unknown[]): Diagnostic {
  return {
    code,
    severity: values.length > 0 ? "warning" : "ok",
    message: values.length > 0 ? label : `${label}: none`,
    details: values.length > 0 ? values : undefined
  };
}

function legacyDirectiveCompatibilityDiagnostic(values: readonly unknown[]): Diagnostic {
  return {
    code: "summary.legacy_directive_compatibility",
    severity: "ok",
    message:
      values.length > 0
        ? `${values.length} legacy-compatible closeout summary record(s)`
        : "Legacy-compatible closeout summary records: none",
    details: values.length > 0 ? values : undefined
  };
}

function validateAgentDirectiveHealth(context: CliContext): readonly Diagnostic[] {
  const probes = buildAgentDirectiveHealthProbeBundles(context);
  const report = agentDirectiveHealthReport({
    registry: AGENT_DIRECTIVE_REGISTRY,
    bundles: probes.bundles
  });
  const registryIssues = report.issues.filter((issue) => issue.source === "registry");
  const emittedIssues = report.issues.filter((issue) => issue.source === "bundle");
  const assemblyIssues = probes.assemblyIssues.map(agentDirectiveAssemblyHealthIssue);

  return [
    {
      code: "agent_directives.registry",
      severity: diagnosticSeverityForAgentDirectiveIssues(registryIssues),
      message:
        registryIssues.length > 0
          ? "Agent directive registry health issues found"
          : "Agent directive registry health checks passed",
      details: {
        registryVersion: report.registryVersion,
        issueCounts: report.issueCounts,
        issues: registryIssues
      }
    },
    {
      code: "agent_directives.emitted_bundles",
      severity: diagnosticSeverityForAgentDirectiveIssues([...emittedIssues, ...assemblyIssues]),
      message:
        emittedIssues.length > 0 || assemblyIssues.length > 0
          ? "Agent directive emitted bundle health issues found"
          : "Agent directive emitted bundle health checks passed",
      details: {
        registryVersion: report.registryVersion,
        checkedBundles: report.checkedBundles,
        probeBundles: probes.probeBundles,
        issueCounts: report.issueCounts,
        issues: emittedIssues,
        assemblyIssues
      }
    }
  ];
}

function buildAgentDirectiveHealthProbeBundles(context: CliContext): {
  readonly bundles: readonly AgentDirectiveBundle[];
  readonly assemblyIssues: readonly AgentDirectiveBundleAssemblyIssue[];
  readonly probeBundles: ReadonlyArray<{
    readonly commandPath: string;
    readonly selectedRegistryIds: readonly string[];
    readonly emittedRegistryIds: readonly string[];
    readonly issueCount: number;
    readonly missingRequiredCount: number;
  }>;
} {
  const dataByRegistryId = {
    "workflow_next.canonical-next-step": {
      workflowRef: "workflows/40-work/claim-and-finish-work.md",
      commandPath: "bwrk work list --ready --json",
      requiredInputs: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS],
      subjectId: context.workspaceRoot,
      gitRoot: context.workspaceRoot
    },
    "memory.reconcile-source": {
      sourceIds: ["raw.directive-health-probe"],
      memoryRoot: join(context.workspaceRoot, "memory"),
      requiredRecordTypes: ["wiki", "claim"]
    }
  };
  const results = [
    assembleAgentDirectiveBundle({
      snapshot: agentDirectiveHealthProbeSnapshot(context, "sync refresh", "boreal.cli.sync.refresh.v1"),
      dataByRegistryId
    })
  ];

  return {
    bundles: results.flatMap((result) => (result.bundle === undefined ? [] : [result.bundle])),
    assemblyIssues: results.flatMap((result) => result.issues),
    probeBundles: results.map((result) => ({
      commandPath: result.bundle?.meta.commandPath ?? "sync refresh",
      selectedRegistryIds: result.selectedRegistryIds,
      emittedRegistryIds: result.bundle?.directives.map((directive) => directive.registryId) ?? [],
      issueCount: result.issues.length,
      missingRequiredCount: result.missingRequired.length
    }))
  };
}

function agentDirectiveHealthProbeSnapshot(context: CliContext, commandPath: string, envelopeSchema: string) {
  const capturedAt = nowIso();
  return createAgentDirectiveSnapshot({
    capturedAt,
    work: {
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
          root: context.workspaceRoot,
          branchName: "main",
          detached: false,
          protectedBranch: true,
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
      workflowRefs: ["workflows/40-work/claim-and-finish-work.md"],
      skillRefs: ["boreal-work-execution"],
      requiredInputNames: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS],
      nextWorkflowRef: "workflows/40-work/claim-and-finish-work.md",
      recommendedCommandPath: "bwrk work list --ready --json",
      assetManifestHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as ContentHash
    },
    doctor: {
      ok: true,
      strict: true,
      diagnostics: []
    },
    sync: {
      ok: true,
      refreshed: true,
      ledgersFresh: true,
      searchIndexFresh: true,
      sqliteCacheFresh: true
    },
    command: {
      path: commandPath,
      argv: [...commandPath.split(" "), "--json"],
      envelopeSchema,
      json: true,
      mutatesState: true,
      resultOk: true
    },
    actor: {
      actor: {
        id: "doctor" as AgentId,
        kind: "agent",
        displayName: "doctor"
      },
      activeAgentId: "doctor" as AgentId,
      activeReservationIds: [],
      purpose: "Validate agent directive registry and emitted bundle health"
    }
  });
}

function agentDirectiveAssemblyHealthIssue(issue: AgentDirectiveBundleAssemblyIssue): AgentDirectiveHealthIssue {
  return {
    kind: issue.phase === "data" ? "invalid_data" : "bundle_invalid",
    severity: "error",
    source: issue.phase === "registry" ? "registry" : "bundle",
    path: issue.path,
    message: issue.message,
    registryId: issue.registryId
  };
}

function diagnosticSeverityForAgentDirectiveIssues(issues: readonly AgentDirectiveHealthIssue[]): DiagnosticSeverity {
  if (issues.some((issue) => issue.severity === "error")) {
    return "error";
  }
  return issues.length > 0 ? "warning" : "ok";
}

function isTerminalCloseoutWork(work: WorkItem): boolean {
  return work.status === "closed" || work.status === "cancelled";
}

function isFinalOrForcedAgentSummary(summary: AgentSummaryRecord): boolean {
  return summary.status === "final" || summary.status === "forced";
}

function doctorSummarySubjectTypeForWork(work: WorkItem): AgentSummaryRecord["subjectType"] {
  return work.kind === "sprint" ? "sprint" : work.kind === "milestone" ? "milestone" : "work";
}

function closeoutSummarySubjectKey(subjectType: AgentSummaryRecord["subjectType"], subjectId: string): string {
  return `${subjectType}:${subjectId}`;
}

interface DoctorLegacyDirectiveCompatibleSummary {
  readonly summaryId: string;
  readonly subjectId: string;
  readonly subjectType: AgentSummaryRecord["subjectType"];
  readonly generatedAt: string;
  readonly reasonCodes: readonly string[];
  readonly artifactUri?: string;
}

function doctorLegacyDirectiveCompatibility(summary: AgentSummaryRecord): readonly DoctorLegacyDirectiveCompatibleSummary[] {
  const reasonCodes = [
    ...(!isAgentDirectiveAcknowledgementPolicyEnforcedAt(summary.generatedAt) ? ["pre_directive_acknowledgement_policy"] : []),
    ...(summary.summaryKind === "legacy_backfill" ? ["legacy_backfill_summary"] : []),
    ...(summary.forceReasonCode === "legacy_backfill" ? ["legacy_backfill_force"] : []),
    ...(summary.dirtyPathNotes.some((note) => note.trim().startsWith("legacy_backfill:")) ? ["legacy_backfill_dirty_path"] : [])
  ];
  if (reasonCodes.length === 0) {
    return [];
  }
  return [
    {
      summaryId: summary.meta.id,
      subjectId: summary.subjectId,
      subjectType: summary.subjectType,
      generatedAt: summary.generatedAt,
      reasonCodes: [...new Set(reasonCodes)].sort(),
      artifactUri: summary.artifactUri
    }
  ];
}

function doctorSummaryHasDirectiveAcknowledgementCoverage(
  summary: AgentSummaryRecord,
  acknowledgements: readonly DirectiveAcknowledgementRecord[]
): boolean {
  return acknowledgements.some((acknowledgement) => doctorAcknowledgementCoversSummary(summary, acknowledgement));
}

function doctorAcknowledgementCoversSummary(summary: AgentSummaryRecord, acknowledgement: DirectiveAcknowledgementRecord): boolean {
  if (acknowledgement.agentSummaryIds.includes(summary.meta.id)) {
    return true;
  }
  if (summary.artifactUri && (acknowledgement.artifactUris ?? []).includes(summary.artifactUri)) {
    return true;
  }
  if (acknowledgement.handoffIds.includes(summary.meta.id)) {
    return true;
  }
  return (
    stringArraysIntersect(acknowledgement.evidenceIds, summary.evidenceIds) ||
    stringArraysIntersect(acknowledgement.verificationIds ?? [], summary.verificationIds)
  );
}

function stringArraysIntersect(left: readonly string[], right: readonly string[]): boolean {
  const rightValues = new Set(right);
  return left.some((value) => rightValues.has(value));
}

interface DoctorWikiCoverage {
  readonly available: boolean;
  readonly pageIds: ReadonlySet<string>;
  readonly wikiPages: readonly WikiPageRecord[];
  readonly rawSources: readonly RawSourceRecord[];
  readonly pageCount: number;
  readonly unavailableReason?: string;
}

async function inspectDoctorWikiCoverage(context: CliContext): Promise<DoctorWikiCoverage> {
  const status = await inspectVault(context);
  if (!status.initialized) {
    return {
      available: false,
      pageIds: new Set(),
      wikiPages: [],
      rawSources: [],
      pageCount: 0,
      unavailableReason: "vault_uninitialized"
    };
  }
  const [pages, rawSources] = await Promise.all([listVaultWikiPages(context), listVaultRawSources(context)]);
  return {
    available: true,
    pageIds: new Set(pages.map((page) => page.id || page.slug)),
    wikiPages: pages,
    rawSources,
    pageCount: pages.length
  };
}

function knowledgeRecordWikiPageIds(record: Pick<ClaimRecord | DecisionRecord, "wikiPageIds">): readonly string[] {
  return Array.isArray(record.wikiPageIds) ? record.wikiPageIds.filter((wikiPageId) => typeof wikiPageId === "string") : [];
}

interface WorkflowReference {
  readonly id: string;
  readonly path: string;
  readonly title: string;
}

const TRUTH_WORKFLOWS = {
  contradictionResolution: {
    id: "boreal.workflow.contradiction-resolution.v1",
    path: "workflows/20-memory/contradiction-resolution.md",
    title: "Contradiction Resolution"
  },
  staleTruthAudit: {
    id: "boreal.workflow.stale-truth-audit.v1",
    path: "workflows/20-memory/stale-truth-audit.md",
    title: "Stale Truth Audit"
  },
  rawReconciliation: {
    id: "boreal.workflow.reconcile-raw-to-memory.v1",
    path: "workflows/20-memory/reconcile-raw-to-memory.md",
    title: "Reconcile Raw To Memory"
  },
  supersedeDecision: {
    id: "boreal.workflow.supersede-decision.v1",
    path: "workflows/30-knowledge/supersede-decision.md",
    title: "Supersede Decision"
  }
} as const satisfies Record<string, WorkflowReference>;

const SAFE_TRUTH_RECHECK_COMMANDS = ["bwrk sync refresh --json", "bwrk doctor --strict --json"] as const;

function claimContradictionFindings(claims: readonly ClaimRecord[]): readonly Record<string, unknown>[] {
  const groups = new Map<string, ClaimRecord[]>();
  for (const claim of claims) {
    if (claim.status !== "accepted" && claim.status !== "rejected" && claim.status !== "stale") {
      continue;
    }
    const key = truthKey(claim.statement);
    groups.set(key, [...(groups.get(key) ?? []), claim]);
  }

  return [...groups.entries()].flatMap(([statementKey, records]) => {
    const accepted = records.filter((claim) => claim.status === "accepted");
    const conflicting = records.filter((claim) => claim.status === "rejected" || claim.status === "stale");
    if (accepted.length === 0 || conflicting.length === 0) {
      return [];
    }
    const claimIds = [...accepted, ...conflicting].map((claim) => claim.meta.id);
    return [
      {
        statementKey,
        acceptedClaimIds: accepted.map((claim) => claim.meta.id),
        conflictingClaimIds: conflicting.map((claim) => claim.meta.id),
        workflow: TRUTH_WORKFLOWS.contradictionResolution,
        safeFixCommands: SAFE_TRUTH_RECHECK_COMMANDS,
        manualReviewCommands: [
          ...claimIds.map((claimId) => `bwrk claim show ${claimId} --json`),
          `bwrk work create ${shellArg(`Review contradictory claim: ${accepted[0]?.statement ?? statementKey}`)} --kind task --label truth-review --json`
        ]
      }
    ];
  });
}

function supersededDecisionReviewFindings(decisions: readonly DecisionRecord[]): readonly Record<string, unknown>[] {
  const acceptedTitleKeys = new Set(decisions.filter((decision) => decision.status === "accepted").map((decision) => truthKey(decision.title)));
  return decisions
    .filter((decision) => decision.status === "superseded")
    .filter((decision) => !acceptedTitleKeys.has(truthKey(decision.title)))
    .map((decision) => ({
      decisionId: decision.meta.id,
      title: decision.title,
      workflow: TRUTH_WORKFLOWS.supersedeDecision,
      safeFixCommands: SAFE_TRUTH_RECHECK_COMMANDS,
      manualReviewCommands: [
        `bwrk decision show ${decision.meta.id} --json`,
        `bwrk decision list --status accepted --json`,
        `bwrk work create ${shellArg(`Review superseded decision: ${decision.title}`)} --kind task --label truth-review --json`
      ]
    }));
}

function rawSourceReconciliationFindings(
  rawSources: readonly RawSourceRecord[],
  wikiPages: readonly WikiPageRecord[]
): readonly Record<string, unknown>[] {
  const linkedSourceRefs = new Set(wikiPages.flatMap((page) => page.sourceRefs));
  return rawSources
    .filter((source) => !linkedSourceRefs.has(source.id))
    .map((source) => ({
      sourceId: source.id,
      title: source.title,
      kind: source.kind,
      workflow: TRUTH_WORKFLOWS.rawReconciliation,
      safeFixCommands: SAFE_TRUTH_RECHECK_COMMANDS,
      manualReviewCommands: [
        `bwrk raw show ${source.id} --json`,
        `bwrk wiki create ${shellArg(source.title)} --source ${source.id} --json`
      ]
    }));
}

function truthKey(value: string): string {
  return normalizeLabel(value);
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/u.test(value) ? value : `'${value.replace(/'/gu, "'\\''")}'`;
}

function ledgerDriftMessage(status: Awaited<ReturnType<typeof ledgerStatus>>): string {
  if (!status.exists) {
    return "No JSONL ledger export exists yet";
  }
  if (status.error) {
    return "JSONL ledger export is invalid";
  }
  if (status.stale) {
    return "JSONL ledger export differs from current runtime state";
  }
  return "JSONL ledger export matches current runtime state";
}

function sqliteCacheMessage(status: Awaited<ReturnType<typeof inspectSQLiteCache>>): string {
  if (!status.exists) {
    return "SQLite generated cache is not built yet";
  }
  if (!status.sqliteAvailable) {
    return "SQLite generated cache exists but sqlite3 is unavailable";
  }
  if (status.error) {
    return "SQLite generated cache is invalid";
  }
  if (status.stale) {
    return "SQLite generated cache differs from current runtime state";
  }
  return "SQLite generated cache matches current runtime state";
}

function gitWorktreeDiagnosticMessage(status: Awaited<ReturnType<typeof inspectGitWorktree>>): string {
  if (!status.insideWorktree) {
    return "Workspace is not inside a Git worktree";
  }
  if (!status.ok && status.detached) {
    return "Blocking collaboration path changes are present on a detached Git HEAD";
  }
  if (!status.ok && status.protectedBranch) {
    return "Blocking collaboration path changes are present on a protected Git branch";
  }
  if (!status.ok) {
    return "Blocking Git collaboration findings are present";
  }
  if (status.findings.some((finding) => finding.category !== "protected_branch")) {
    return "Git worktree has non-blocking collaboration caveats";
  }
  if (status.protectedBranch) {
    return "Git worktree is on a protected branch with no blocking git findings";
  }
  return "Git worktree collaboration paths are safe";
}

function gitTopologyDiagnosticMessage(
  project: Awaited<ReturnType<typeof inspectGitWorktree>>,
  memory: Awaited<ReturnType<typeof inspectGitWorktree>> | undefined,
  memoryGitMode: string
): string {
  if (!memory) {
    return `${gitWorktreeDiagnosticMessage(project)}; memory uses shared ${memoryGitMode} topology`;
  }
  if (project.ok && memory.ok) {
    return "Git topology checks passed for project and memory repositories";
  }
  if (!project.ok && !memory.ok) {
    return "Blocking Git findings are present in both project and memory repositories";
  }
  return project.ok ? "Blocking Git findings are present in the memory repository" : "Blocking Git findings are present in the project repository";
}

function vaultStructureDiagnosticMessage(status: Awaited<ReturnType<typeof inspectVault>>): string {
  if (status.invalidPaths.length > 0) {
    return "Boreal memory vault has paths with the wrong type";
  }
  if (!status.initialized) {
    return "Boreal memory vault is missing or incomplete; run `bwrk vault init`";
  }
  return "Boreal memory vault structure is initialized";
}

interface MachineStringField {
  readonly section: string;
  readonly id: string;
  readonly field: string;
  readonly value: string;
}

interface StringSafetyInput {
  readonly workItems: readonly WorkItem[];
  readonly agentSummaries: readonly AgentSummaryRecord[];
  readonly evidence: readonly EvidenceRecord[];
  readonly verifications: readonly VerificationRecord[];
  readonly directiveAcknowledgements: readonly DirectiveAcknowledgementRecord[];
  readonly knowledgeSources: readonly KnowledgeSource[];
  readonly claims: readonly ClaimRecord[];
  readonly decisions: readonly DecisionRecord[];
  readonly graphEdges: readonly GraphEdge[];
  readonly reservations: readonly AgentReservation[];
  readonly operations: readonly RuntimeOperation[];
  readonly contextPacks: readonly ContextPack[];
}

function stringSafetyIssues(input: StringSafetyInput): Array<Record<string, unknown>> {
  const fields: MachineStringField[] = [
    ...input.workItems.flatMap((work) => [
      ...metaStringFields("workItems", work.meta.id, work),
      stringField("workItems", work.meta.id, "title", work.title),
      ...work.labels.map((label, index) => stringField("workItems", work.meta.id, `labels[${index}]`, label))
    ]),
    ...input.agentSummaries.flatMap((summary) => [
      ...metaStringFields("agentSummaries", summary.meta.id, summary),
      stringField("agentSummaries", summary.meta.id, "title", summary.title),
      stringField("agentSummaries", summary.meta.id, "subjectId", summary.subjectId),
      ...(summary.artifactUri ? [stringField("agentSummaries", summary.meta.id, "artifactUri", summary.artifactUri)] : []),
      ...(summary.duplicateOf ? [stringField("agentSummaries", summary.meta.id, "duplicateOf", summary.duplicateOf)] : [])
    ]),
    ...input.evidence.flatMap((evidence) => [
      ...metaStringFields("evidence", evidence.meta.id, evidence),
      ...(evidence.uri ? [stringField("evidence", evidence.meta.id, "uri", evidence.uri)] : [])
    ]),
    ...input.verifications.flatMap((verification) => metaStringFields("verifications", verification.meta.id, verification)),
    ...input.directiveAcknowledgements.flatMap((acknowledgement) => [
      ...metaStringFields("directiveAcknowledgements", acknowledgement.meta.id, acknowledgement),
      stringField("directiveAcknowledgements", acknowledgement.meta.id, "directiveId", acknowledgement.directiveId),
      ...(acknowledgement.directiveRegistryId
        ? [
            stringField(
              "directiveAcknowledgements",
              acknowledgement.meta.id,
              "directiveRegistryId",
              acknowledgement.directiveRegistryId
            )
          ]
        : []),
      ...(acknowledgement.bundleSource.bundleId
        ? [stringField("directiveAcknowledgements", acknowledgement.meta.id, "bundleSource.bundleId", acknowledgement.bundleSource.bundleId)]
        : []),
      stringField(
        "directiveAcknowledgements",
        acknowledgement.meta.id,
        "bundleSource.commandPath",
        acknowledgement.bundleSource.commandPath
      ),
      stringField("directiveAcknowledgements", acknowledgement.meta.id, "commandPath", acknowledgement.commandPath),
      ...acknowledgement.evidenceIds.map((evidenceId, index) =>
        stringField("directiveAcknowledgements", acknowledgement.meta.id, `evidenceIds[${index}]`, evidenceId)
      ),
      ...acknowledgement.agentSummaryIds.map((summaryId, index) =>
        stringField("directiveAcknowledgements", acknowledgement.meta.id, `agentSummaryIds[${index}]`, summaryId)
      ),
      ...(acknowledgement.verificationIds ?? []).map((verificationId, index) =>
        stringField("directiveAcknowledgements", acknowledgement.meta.id, `verificationIds[${index}]`, verificationId)
      ),
      ...(acknowledgement.artifactUris ?? []).map((artifactUri, index) =>
        stringField("directiveAcknowledgements", acknowledgement.meta.id, `artifactUris[${index}]`, artifactUri)
      ),
      ...acknowledgement.handoffIds.map((handoffId, index) =>
        stringField("directiveAcknowledgements", acknowledgement.meta.id, `handoffIds[${index}]`, handoffId)
      ),
      ...(acknowledgement.subjectId
        ? [stringField("directiveAcknowledgements", acknowledgement.meta.id, "subjectId", acknowledgement.subjectId)]
        : []),
      ...(acknowledgement.subjectTitle
        ? [stringField("directiveAcknowledgements", acknowledgement.meta.id, "subjectTitle", acknowledgement.subjectTitle)]
        : []),
      ...(acknowledgement.reasonCode
        ? [stringField("directiveAcknowledgements", acknowledgement.meta.id, "reasonCode", acknowledgement.reasonCode)]
        : [])
    ]),
    ...input.knowledgeSources.flatMap((source) => [
      ...metaStringFields("knowledgeSources", source.meta.id, source),
      stringField("knowledgeSources", source.meta.id, "title", source.title),
      stringField("knowledgeSources", source.meta.id, "uri", source.uri)
    ]),
    ...input.claims.flatMap((claim) => metaStringFields("claims", claim.meta.id, claim)),
    ...input.decisions.flatMap((decision) => [
      ...metaStringFields("decisions", decision.meta.id, decision),
      stringField("decisions", decision.meta.id, "title", decision.title)
    ]),
    ...input.graphEdges.flatMap((edge) => metaStringFields("graphEdges", edge.meta.id, edge)),
    ...input.reservations.flatMap((reservation) => [
      ...metaStringFields("reservations", reservation.meta.id, reservation),
      stringField("reservations", reservation.meta.id, "agentId", String(reservation.agentId))
    ]),
    ...input.operations.flatMap((operation) => [
      ...metaStringFields("operations", operation.meta.id, operation),
      stringField("operations", operation.meta.id, "sessionId", operation.sessionId),
      stringField("operations", operation.meta.id, "commandPath", operation.commandPath),
      stringField("operations", operation.meta.id, "actorId", operation.actorId),
      ...operation.argv.map((entry, index) => stringField("operations", operation.meta.id, `argv[${index}]`, entry))
    ]),
    ...input.contextPacks.map((pack) => stringField("contextPacks", pack.id, "title", pack.title))
  ];

  return fields.flatMap((field) => {
    const findings = detectSuspiciousUnicode(field.value);
    return findings.length > 0
      ? [
          {
            section: field.section,
            id: field.id,
            field: field.field,
            findings
          }
        ]
      : [];
  });
}

function labelNormalizationCollisions(workItems: readonly WorkItem[]): Array<Record<string, unknown>> {
  const entries = workItems.flatMap((work) => [
    ...work.labels.map((value, index) => ({
      value,
      section: "workItems",
      id: work.meta.id,
      field: `labels[${index}]`
    })),
    ...work.meta.tags.map((value, index) => ({
      value,
      section: "workItems",
      id: work.meta.id,
      field: `meta.tags[${index}]`
    }))
  ]);
  return normalizationCollisions(entries, normalizeLabel);
}

function actorNormalizationCollisions(input: Omit<StringSafetyInput, "contextPacks">): Array<Record<string, unknown>> {
  const records = [
    ...input.workItems.map((record) => ({ section: "workItems", id: record.meta.id, record })),
    ...input.agentSummaries.map((record) => ({ section: "agentSummaries", id: record.meta.id, record })),
    ...input.evidence.map((record) => ({ section: "evidence", id: record.meta.id, record })),
    ...input.verifications.map((record) => ({ section: "verifications", id: record.meta.id, record })),
    ...input.knowledgeSources.map((record) => ({ section: "knowledgeSources", id: record.meta.id, record })),
    ...input.claims.map((record) => ({ section: "claims", id: record.meta.id, record })),
    ...input.decisions.map((record) => ({ section: "decisions", id: record.meta.id, record })),
    ...input.graphEdges.map((record) => ({ section: "graphEdges", id: record.meta.id, record })),
    ...input.reservations.map((record) => ({ section: "reservations", id: record.meta.id, record })),
    ...input.operations.map((record) => ({ section: "operations", id: record.meta.id, record }))
  ];
  const actorEntries = records.flatMap(({ section, id, record }) => [
    {
      value: String(record.meta.createdBy.id),
      section,
      id,
      field: "meta.createdBy.id"
    },
    {
      value: String(record.meta.updatedBy.id),
      section,
      id,
      field: "meta.updatedBy.id"
    }
  ]);
  const reservationEntries = input.reservations.map((reservation) => ({
    value: String(reservation.agentId),
    section: "reservations",
    id: reservation.meta.id,
    field: "agentId"
  }));
  const operationEntries = input.operations.map((operation) => ({
    value: operation.actorId,
    section: "operations",
    id: operation.meta.id,
    field: "actorId"
  }));
  return normalizationCollisions([...actorEntries, ...reservationEntries, ...operationEntries], normalizeActorId);
}

function metaStringFields(
  section: string,
  id: string,
  record: { readonly meta: { readonly createdBy: { readonly id: unknown }; readonly updatedBy: { readonly id: unknown }; readonly tags: readonly string[] } }
): readonly MachineStringField[] {
  return [
    stringField(section, id, "meta.createdBy.id", String(record.meta.createdBy.id)),
    stringField(section, id, "meta.updatedBy.id", String(record.meta.updatedBy.id)),
    ...record.meta.tags.map((tag, index) => stringField(section, id, `meta.tags[${index}]`, tag))
  ];
}

function stringField(section: string, id: string, field: string, value: string): MachineStringField {
  return { section, id, field, value };
}

function normalizationCollisions(
  entries: readonly MachineStringField[],
  normalize: (value: string) => string
): Array<Record<string, unknown>> {
  const byNormalized = new Map<string, MachineStringField[]>();
  for (const entry of entries) {
    const normalized = tryNormalize(entry.value, normalize);
    if (!normalized) {
      continue;
    }
    byNormalized.set(normalized, [...(byNormalized.get(normalized) ?? []), entry]);
  }

  return [...byNormalized.entries()].flatMap(([normalized, values]) => {
    const rawValues = [...new Set(values.map((entry) => entry.value))].sort();
    return rawValues.length > 1
      ? [
          {
            normalized,
            rawValues,
            fields: values.map(({ section, id, field, value }) => ({ section, id, field, value }))
          }
        ]
      : [];
  });
}

function tryNormalize(value: string, normalize: (value: string) => string): string | undefined {
  try {
    return normalize(value);
  } catch {
    return undefined;
  }
}

function searchIndexDiagnosticMessage(inspection: {
  readonly exists: boolean;
  readonly stale: boolean;
  readonly error?: string;
}): string {
  if (!inspection.exists) {
    return "Local search index is missing; run `bwrk search index` or `bwrk doctor --fix`";
  }
  if (inspection.error) {
    return "Local search index is invalid; run `bwrk search index` or `bwrk doctor --fix`";
  }
  if (inspection.stale) {
    return "Local search index is stale; run `bwrk search index` or `bwrk doctor --fix`";
  }
  return "Local search index is fresh";
}

function stateSection<T>(state: Record<string, unknown>, section: (typeof STATE_SECTIONS)[number]): readonly T[] {
  const values = state[section];
  return Array.isArray(values) ? (values as readonly T[]) : [];
}

function malformedIndexes<T>(
  values: readonly T[],
  predicate: (value: T) => boolean,
  section: string
): Array<{ section: string; index: number }> {
  return values.flatMap((value, index) => (predicate(value) ? [] : [{ section, index }]));
}

function contextPackMatches(actual: ContextPack, expected: ContextPack): boolean {
  return (
    actual.subjectId === expected.subjectId &&
    actual.title === expected.title &&
    actual.summary === expected.summary &&
    arraysEqual(actual.facts, expected.facts) &&
    arraysEqual(actual.evidence, expected.evidence)
  );
}

function contextProjectionMatches(actual: ProjectionRecord, expected: ProjectionRecord): boolean {
  const actualFacts = stringArrayValue(actual.value.facts);
  const actualEvidence = stringArrayValue(actual.value.evidence);
  const expectedFacts = stringArrayValue(expected.value.facts);
  const expectedEvidence = stringArrayValue(expected.value.evidence);
  return (
    actual.subjectId === expected.subjectId &&
    actual.kind === expected.kind &&
    actual.value.title === expected.value.title &&
    actual.value.summary === expected.value.summary &&
    actualFacts !== undefined &&
    actualEvidence !== undefined &&
    expectedFacts !== undefined &&
    expectedEvidence !== undefined &&
    arraysEqual(actualFacts, expectedFacts) &&
    arraysEqual(actualEvidence, expectedEvidence)
  );
}

function stringArrayValue(value: unknown): readonly string[] | undefined {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string") ? value : undefined;
}

function expectedContextProjectionId(workId: string): ProjectionId {
  return deterministicId<ProjectionId>("projection", {
    kind: "context-pack",
    subjectId: workId
  });
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function duplicateGraphEdgeKeys(graphEdges: readonly GraphEdge[]): Array<{ key: string; edgeIds: readonly string[] }> {
  const edgeIdsByKey = new Map<string, string[]>();
  for (const edge of graphEdges) {
    const key = `${edge.kind}:${edge.fromType}:${edge.fromId}:${edge.toType}:${edge.toId}:${edge.directed}`;
    edgeIdsByKey.set(key, [...(edgeIdsByKey.get(key) ?? []), edge.meta.id]);
  }
  return [...edgeIdsByKey.entries()]
    .filter(([, edgeIds]) => edgeIds.length > 1)
    .map(([key, edgeIds]) => ({ key, edgeIds }));
}

function operationIdsByEventId(operations: readonly RuntimeOperation[]): ReadonlyMap<string, readonly string[]> {
  const result = new Map<string, string[]>();
  for (const operation of operations) {
    for (const eventId of operation.eventIds) {
      result.set(eventId, [...(result.get(eventId) ?? []), operation.meta.id]);
    }
  }
  return result;
}

function dependencyIdsByWorkFromGraph(
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): ReadonlyMap<WorkId, readonly WorkId[]> {
  const workIds = new Set(workItems.map((work) => work.meta.id));
  const dependencyIdsByWork = new Map<WorkId, WorkId[]>();
  for (const work of workItems) {
    dependencyIdsByWork.set(work.meta.id, []);
  }
  for (const edge of graphEdges) {
    if (
      edge.kind !== "blocks" ||
      edge.fromType !== "work" ||
      edge.toType !== "work" ||
      !workIds.has(edge.fromId as WorkId) ||
      !workIds.has(edge.toId as WorkId)
    ) {
      continue;
    }
    const workId = edge.toId as WorkId;
    dependencyIdsByWork.set(workId, [...(dependencyIdsByWork.get(workId) ?? []), edge.fromId as WorkId]);
  }
  return new Map(
    [...dependencyIdsByWork.entries()].map(([workId, dependencyIds]) => [
      workId,
      [...new Set(dependencyIds)].sort((left, right) => left.localeCompare(right))
    ])
  );
}

interface DoctorReviewGateKindCounts {
  total: number;
  pending: number;
  passed: number;
  forced: number;
}

interface DoctorReviewGateCounts extends DoctorReviewGateKindCounts {
  review: DoctorReviewGateKindCounts;
  audit: DoctorReviewGateKindCounts;
}

type DoctorRequiredCloseoutGate = NonNullable<WorkItem["requiredCloseoutGates"]>[number];

interface DoctorRequiredCloseoutGateCoverageGap {
  readonly workId: WorkId;
  readonly title: string;
  readonly gateId: string;
  readonly gateKind: DoctorRequiredCloseoutGate["kind"];
  readonly gateScope: DoctorRequiredCloseoutGate["scope"];
  readonly gateStatus: DoctorRequiredCloseoutGate["status"];
  readonly targetId: WorkId;
  readonly targetStatus?: WorkItem["status"];
  readonly reason: string;
}

function doctorReviewGateCounts(
  workItems: readonly WorkItem[],
  evidence: readonly EvidenceRecord[],
  dependencyIdsByWork: ReadonlyMap<WorkId, readonly WorkId[]>
): DoctorReviewGateCounts {
  const review = doctorEmptyReviewGateKindCounts();
  const audit = doctorEmptyReviewGateKindCounts();
  for (const work of workItems) {
    for (const gate of work.requiredCloseoutGates ?? []) {
      if (gate.kind !== "review" && gate.kind !== "audit") {
        continue;
      }
      const bucket = gate.kind === "review" ? review : audit;
      doctorIncrementReviewGateCounts(bucket, doctorReviewGateStatus(work, gate, evidence, dependencyIdsByWork));
    }
  }
  return {
    total: review.total + audit.total,
    pending: review.pending + audit.pending,
    passed: review.passed + audit.passed,
    forced: review.forced + audit.forced,
    review,
    audit
  };
}

function doctorRequiredCloseoutGateCoverageGaps(
  workItems: readonly WorkItem[],
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  agentSummaries: readonly AgentSummaryRecord[],
  dependencyIdsByWork: ReadonlyMap<WorkId, readonly WorkId[]>
): readonly DoctorRequiredCloseoutGateCoverageGap[] {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  return workItems
    .filter((work) => isTerminalCloseoutWork(work) && isAgentSummaryPolicyEnforcedAt(work.closedAt))
    .flatMap((work) =>
      (work.requiredCloseoutGates ?? []).flatMap((gate) => {
        if (gate.status === "forced") {
          return doctorForcedGateIsValid(gate)
            ? []
            : [doctorRequiredCloseoutGateCoverageGap(work, gate, work.meta.id, work.status, "forced gate is missing required bypass metadata")];
        }
        return doctorReviewGateTargetIds(work, gate.scope, dependencyIdsByWork).flatMap((targetId) => {
          const target = workById.get(targetId);
          if (!target) {
            return [doctorRequiredCloseoutGateCoverageGap(work, gate, targetId, undefined, "required gate target is missing")];
          }
          return doctorRequiredGateSatisfied(gate, target, evidence, verifications, agentSummaries)
            ? []
            : [doctorRequiredCloseoutGateCoverageGap(work, gate, target.meta.id, target.status, "required gate has no satisfying evidence")];
        });
      })
    );
}

function doctorRequiredCloseoutGateCoverageGap(
  work: WorkItem,
  gate: DoctorRequiredCloseoutGate,
  targetId: WorkId,
  targetStatus: WorkItem["status"] | undefined,
  reason: string
): DoctorRequiredCloseoutGateCoverageGap {
  return {
    workId: work.meta.id,
    title: work.title,
    gateId: gate.id,
    gateKind: gate.kind,
    gateScope: gate.scope,
    gateStatus: gate.status,
    targetId,
    targetStatus,
    reason
  };
}

function doctorForcedGateIsValid(gate: DoctorRequiredCloseoutGate): boolean {
  return Boolean(gate.force?.reason && gate.force.comment.trim() && gate.force.actor.id && gate.force.forcedAt);
}

function doctorRequiredGateSatisfied(
  gate: DoctorRequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[],
  agentSummaries: readonly AgentSummaryRecord[]
): boolean {
  switch (gate.kind) {
    case "verification":
      return doctorVerificationGateSatisfied(gate, target, evidence, verifications);
    case "checkpoint":
      return doctorCheckpointGateSatisfied(gate, target, agentSummaries);
    case "review":
    case "audit":
      return doctorEvidenceGateSatisfied(gate, target, evidence);
  }
}

function doctorVerificationGateSatisfied(
  gate: DoctorRequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[],
  verifications: readonly VerificationRecord[]
): boolean {
  const evidenceById = new Map(evidence.map((record) => [record.meta.id, record]));
  const evidenceIds = new Set<string>();
  for (const verification of verifications) {
    if (verification.subjectId !== target.meta.id || verification.verdict !== "passed") {
      continue;
    }
    for (const evidenceId of verification.evidenceIds) {
      const record = evidenceById.get(evidenceId);
      if (record?.subjectId === target.meta.id && (record.outcome === "passed" || record.outcome === "observed")) {
        evidenceIds.add(evidenceId);
      }
    }
  }
  return evidenceIds.size >= gate.minEvidenceCount;
}

function doctorCheckpointGateSatisfied(
  gate: DoctorRequiredCloseoutGate,
  target: WorkItem,
  agentSummaries: readonly AgentSummaryRecord[]
): boolean {
  return agentSummaries.filter(
    (summary) =>
      summary.subjectId === target.meta.id &&
      (summary.status === "final" || summary.status === "forced") &&
      (summary.commitShas.length > 0 || dirtyPathNotesHaveReasonCode(summary.dirtyPathNotes))
  ).length >= gate.minEvidenceCount;
}

function doctorEvidenceGateSatisfied(
  gate: DoctorRequiredCloseoutGate,
  target: WorkItem,
  evidence: readonly EvidenceRecord[]
): boolean {
  const allowedKinds = new Set(gate.requiredEvidenceKinds);
  return evidence.filter(
    (record) =>
      record.subjectType === "work" &&
      record.subjectId === target.meta.id &&
      record.outcome === gate.requiredOutcome &&
      allowedKinds.has(record.kind)
  ).length >= gate.minEvidenceCount;
}

function doctorEmptyReviewGateKindCounts(): DoctorReviewGateKindCounts {
  return {
    total: 0,
    pending: 0,
    passed: 0,
    forced: 0
  };
}

function doctorIncrementReviewGateCounts(counts: DoctorReviewGateKindCounts, status: "pending" | "passed" | "forced"): void {
  counts.total += 1;
  counts[status] += 1;
}

function doctorReviewGateStatus(
  owner: WorkItem,
  gate: NonNullable<WorkItem["requiredCloseoutGates"]>[number],
  evidence: readonly EvidenceRecord[],
  dependencyIdsByWork: ReadonlyMap<WorkId, readonly WorkId[]>
): "pending" | "passed" | "forced" {
  if (gate.status === "forced") {
    return "forced";
  }
  if (gate.status === "satisfied") {
    return "passed";
  }
  const targets = doctorReviewGateTargetIds(owner, gate.scope, dependencyIdsByWork);
  return targets.every((targetId) => doctorTargetHasReviewGateEvidence(gate, targetId, evidence)) ? "passed" : "pending";
}

function doctorReviewGateTargetIds(
  owner: WorkItem,
  scope: NonNullable<WorkItem["requiredCloseoutGates"]>[number]["scope"],
  dependencyIdsByWork: ReadonlyMap<WorkId, readonly WorkId[]>
): readonly WorkId[] {
  if (scope === "self") {
    return [owner.meta.id];
  }
  const direct = dependencyIdsByWork.get(owner.meta.id) ?? [];
  if (scope === "direct_children") {
    return direct;
  }
  const visited = new Set<WorkId>();
  const visit = (workId: WorkId): void => {
    for (const dependencyId of dependencyIdsByWork.get(workId) ?? []) {
      if (visited.has(dependencyId)) {
        continue;
      }
      visited.add(dependencyId);
      visit(dependencyId);
    }
  };
  visit(owner.meta.id);
  return [...visited];
}

function doctorTargetHasReviewGateEvidence(
  gate: NonNullable<WorkItem["requiredCloseoutGates"]>[number],
  targetId: WorkId,
  evidence: readonly EvidenceRecord[]
): boolean {
  const allowedKinds = new Set(gate.requiredEvidenceKinds);
  return evidence.some(
    (record) =>
      record.subjectType === "work" &&
      record.subjectId === targetId &&
      record.outcome === gate.requiredOutcome &&
      allowedKinds.has(record.kind)
  );
}

function findDependencyCycles(graphEdges: readonly GraphEdge[]): Array<{ cycle: readonly string[] }> {
  const adjacency = new Map<string, string[]>();
  for (const edge of graphEdges) {
    const values = adjacency.get(edge.fromId) ?? [];
    values.push(edge.toId);
    adjacency.set(edge.fromId, values);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const path: string[] = [];
  const seenCycles = new Set<string>();
  const cycles: Array<{ cycle: readonly string[] }> = [];

  const visit = (node: string): void => {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      const cycle = [...path.slice(start), node];
      const key = cycle.join("->");
      if (!seenCycles.has(key)) {
        seenCycles.add(key);
        cycles.push({ cycle });
      }
      return;
    }
    if (visited.has(node)) {
      return;
    }

    visiting.add(node);
    path.push(node);
    for (const next of adjacency.get(node) ?? []) {
      visit(next);
    }
    path.pop();
    visiting.delete(node);
    visited.add(node);
  };

  for (const node of adjacency.keys()) {
    visit(node);
  }

  return cycles;
}

function reservationPolicyIssues(
  workItems: readonly WorkItem[],
  reservations: readonly AgentReservation[]
): Array<Record<string, unknown>> {
  const workById = new Map(workItems.map((work) => [work.meta.id, work]));
  const activeReservations = reservations.filter((reservation) => reservation.status === "active");
  const activeReservationsById = new Map(activeReservations.map((reservation) => [reservation.meta.id, reservation]));
  const activeReservationsByWork = new Map<string, AgentReservation[]>();

  for (const reservation of activeReservations) {
    activeReservationsByWork.set(reservation.workId, [
      ...(activeReservationsByWork.get(reservation.workId) ?? []),
      reservation
    ]);
  }

  return [
    ...activeReservations.flatMap((reservation) => {
      const work = workById.get(reservation.workId);
      if (!work) {
        return [{ issue: "active_reservation_missing_work", reservationId: reservation.meta.id, workId: reservation.workId }];
      }
      if (work.status === "closed" || work.status === "cancelled") {
        return [
          {
            issue: "active_reservation_for_terminal_work",
            reservationId: reservation.meta.id,
            workId: reservation.workId,
            status: work.status
          }
        ];
      }
      if (!isReservationBackedWorkStatus(work.status) || work.reservationId !== reservation.meta.id) {
        return [
          {
            issue: "active_reservation_not_reflected_by_work",
            reservationId: reservation.meta.id,
            workId: reservation.workId,
            workStatus: work.status,
            workReservationId: work.reservationId
          }
        ];
      }
      return [];
    }),
    ...[...activeReservationsByWork.entries()]
      .filter(([, values]) => values.length > 1)
      .map(([workId, values]) => ({
        issue: "multiple_active_reservations_for_work",
        workId,
        reservationIds: values.map((reservation) => reservation.meta.id)
      })),
    ...workItems.flatMap((work) => {
      if (isReservationBackedWorkStatus(work.status) && work.reservationId && !activeReservationsById.has(work.reservationId)) {
        return [{ issue: "work_status_missing_active_reservation", workId: work.meta.id, status: work.status, reservationId: work.reservationId }];
      }
      if (work.status === "reserved" && !work.reservationId) {
        return [{ issue: "legacy_reserved_work_missing_reservation", workId: work.meta.id }];
      }
      if (work.reservationId && !reservations.some((reservation) => reservation.meta.id === work.reservationId)) {
        return [{ issue: "work_reservation_missing_record", workId: work.meta.id, reservationId: work.reservationId }];
      }
      return [];
    })
  ];
}

function isReservationBackedWorkStatus(status: WorkItem["status"]): boolean {
  return status === "in_progress" || status === "reserved";
}

function verificationPolicyIssues(
  workItems: readonly WorkItem[],
  verifications: readonly VerificationRecord[],
  evidenceById: ReadonlyMap<EvidenceId, EvidenceRecord>
): Array<Record<string, unknown>> {
  const verificationsById = new Map(verifications.map((verification) => [verification.meta.id, verification]));
  const passedVerificationHasPassedEvidence = (verification: VerificationRecord): boolean =>
    verification.verdict === "passed" &&
    verification.evidenceIds.some((evidenceId) => evidenceById.get(evidenceId)?.outcome === "passed");

  return [
    ...verifications
      .filter((verification) => verification.verdict === "passed" && !passedVerificationHasPassedEvidence(verification))
      .map((verification) => ({
        issue: "passed_verification_without_passed_evidence",
        verificationId: verification.meta.id,
        subjectId: verification.subjectId,
        evidenceIds: verification.evidenceIds
      })),
    ...workItems
      .filter((work) => work.status === "verified")
      .filter(
        (work) =>
          !work.verificationIds
            .map((verificationId) => verificationsById.get(verificationId))
            .filter((verification): verification is VerificationRecord => verification !== undefined)
            .some(passedVerificationHasPassedEvidence)
      )
      .map((work) => ({ issue: "verified_work_without_passed_evidence", workId: work.meta.id }))
  ];
}

function finalize(diagnostics: readonly Diagnostic[], fixed: boolean, strict: boolean): DoctorResult {
  const ok = diagnostics.every((diagnostic) => diagnostic.severity !== "error" && (!strict || !strictBlockingWarning(diagnostic)));
  return { ok, strict, fixed, diagnostics };
}

function isAgentSummaryPolicyEnforcedAt(timestamp: string | undefined): boolean {
  if (!timestamp) {
    return true;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) || parsed >= Date.parse(AGENT_SUMMARY_POLICY_ENFORCED_AT);
}

function isAgentDirectiveAcknowledgementPolicyEnforcedAt(timestamp: string | undefined): boolean {
  if (!timestamp) {
    return true;
  }
  const parsed = Date.parse(timestamp);
  return Number.isNaN(parsed) || parsed >= Date.parse(AGENT_DIRECTIVE_ACKNOWLEDGEMENT_POLICY_ENFORCED_AT);
}

const STRICT_ADVISORY_WARNING_CODES = new Set([
  "daemon.status",
  "install.status",
  "project_setup.child_tracking",
  "snapshot.export_drift",
  "ledger.export_drift",
  "cache.sqlite",
  "search.index",
  "summary.directive_coverage",
  "summary.legacy_closeout_coverage",
  "summary.legacy_checkpoint_coverage",
  "summary.legacy_artifact_coverage"
]);

export function strictBlockingWarning(diagnostic: Diagnostic): boolean {
  if (diagnostic.severity !== "warning") {
    return false;
  }
  if (diagnostic.code === "git.worktree") {
    return gitDetailsHaveBlockingFindings(diagnostic.details);
  }
  return !STRICT_ADVISORY_WARNING_CODES.has(diagnostic.code);
}

function gitDetailsHaveBlockingFindings(details: unknown): boolean {
  if (!isRecord(details)) {
    return true;
  }
  const inspections = [details.project, details.memory, details].filter(isRecord);
  return inspections.some((inspection) => {
    const findings = inspection.findings;
    return Array.isArray(findings) && findings.some((finding) => isRecord(finding) && finding.blocking === true);
  });
}

function readRecordId(value: unknown, section: string): string | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  if (section === "contextPacks") {
    return typeof value.id === "string" ? value.id : undefined;
  }
  const meta = value.meta;
  if (!isRecord(meta)) {
    return undefined;
  }
  return typeof meta.id === "string" ? meta.id : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWorkItem(value: WorkItem | undefined): value is WorkItem {
  return value !== undefined;
}

function isDoctorWorkItem(value: unknown): value is WorkItem {
  return (
    isRecord(value) &&
    readRecordId(value, "workItems") !== undefined &&
    isWorkStatus(value.status) &&
    Array.isArray(value.dependencyIds) &&
    Array.isArray(value.evidenceIds) &&
    Array.isArray(value.verificationIds)
  );
}

function isDoctorAgentSummary(value: unknown): value is AgentSummaryRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "agentSummaries") !== undefined &&
    typeof value.subjectId === "string" &&
    typeof value.subjectType === "string" &&
    typeof value.summaryKind === "string" &&
    typeof value.status === "string" &&
    typeof value.outcome === "string" &&
    typeof value.title === "string" &&
    typeof value.body === "string" &&
    Array.isArray(value.completedWork) &&
    Array.isArray(value.evidenceIds) &&
    Array.isArray(value.verificationIds) &&
    Array.isArray(value.commitShas) &&
    Array.isArray(value.dirtyPathNotes) &&
    Array.isArray(value.childSummaryIds) &&
    typeof value.generatedAt === "string"
  );
}

function isDoctorEvidence(value: unknown): value is EvidenceRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "evidence") !== undefined &&
    typeof value.subjectId === "string" &&
    isEvidenceOutcome(value.outcome)
  );
}

function isDoctorVerification(value: unknown): value is VerificationRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "verifications") !== undefined &&
    typeof value.subjectId === "string" &&
    Array.isArray(value.evidenceIds) &&
    isVerificationVerdict(value.verdict)
  );
}

function isDoctorDirectiveAcknowledgement(value: unknown): value is DirectiveAcknowledgementRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "directiveAcknowledgements") !== undefined &&
    typeof value.directiveId === "string" &&
    typeof value.directiveVersion === "string" &&
    isRecord(value.bundleSource) &&
    typeof value.commandPath === "string" &&
    typeof value.subjectType === "string" &&
    typeof value.outcome === "string" &&
    Array.isArray(value.evidenceIds) &&
    Array.isArray(value.agentSummaryIds) &&
    (value.verificationIds === undefined || Array.isArray(value.verificationIds)) &&
    (value.artifactUris === undefined || Array.isArray(value.artifactUris)) &&
    Array.isArray(value.handoffIds) &&
    typeof value.acknowledgedAt === "string"
  );
}

function isDoctorKnowledgeSource(value: unknown): value is KnowledgeSource {
  return (
    isRecord(value) &&
    readRecordId(value, "knowledgeSources") !== undefined &&
    isKnowledgeSourceKind(value.kind) &&
    typeof value.title === "string" &&
    typeof value.uri === "string" &&
    typeof value.summary === "string"
  );
}

function isDoctorClaim(value: unknown): value is ClaimRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "claims") !== undefined &&
    typeof value.statement === "string" &&
    isClaimStatus(value.status) &&
    Array.isArray(value.sourceIds) &&
    Array.isArray(value.evidenceIds)
  );
}

function isDoctorDecision(value: unknown): value is DecisionRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "decisions") !== undefined &&
    typeof value.title === "string" &&
    typeof value.context === "string" &&
    typeof value.decision === "string" &&
    isDecisionStatus(value.status) &&
    Array.isArray(value.consequences) &&
    Array.isArray(value.sourceIds)
  );
}

function isDoctorContextPack(value: unknown): value is ContextPack {
  return isRecord(value) && typeof value.id === "string" && typeof value.subjectId === "string";
}

function isDoctorProjection(value: unknown): value is ProjectionRecord {
  return (
    isRecord(value) &&
    readRecordId(value, "projections") !== undefined &&
    typeof value.kind === "string" &&
    typeof value.subjectId === "string" &&
    isRecord(value.value)
  );
}

function isDoctorGraphEdge(value: unknown): value is GraphEdge {
  return (
    isRecord(value) &&
    readRecordId(value, "graphEdges") !== undefined &&
    isEdgeKind(value.kind) &&
    typeof value.fromId === "string" &&
    typeof value.fromType === "string" &&
    typeof value.toId === "string" &&
    typeof value.toType === "string" &&
    typeof value.directed === "boolean"
  );
}

function isDoctorReservation(value: unknown): value is AgentReservation {
  return (
    isRecord(value) &&
    readRecordId(value, "reservations") !== undefined &&
    typeof value.workId === "string" &&
    typeof value.agentId === "string" &&
    isReservationStatus(value.status) &&
    typeof value.reservedAt === "string" &&
    (value.expiresAt === undefined || typeof value.expiresAt === "string")
  );
}

function isDoctorOperation(value: unknown): value is RuntimeOperation {
  return (
    isRecord(value) &&
    readRecordId(value, "operations") !== undefined &&
    typeof value.sessionId === "string" &&
    typeof value.commandPath === "string" &&
    Array.isArray(value.argv) &&
    typeof value.actorId === "string" &&
    typeof value.startedAt === "string" &&
    typeof value.finishedAt === "string" &&
    Number.isInteger(value.exitCode) &&
    (value.status === "succeeded" || value.status === "failed") &&
    typeof value.stateChanged === "boolean" &&
    typeof value.generatedArtifactsChanged === "boolean" &&
    Array.isArray(value.eventIds)
  );
}

function isWorkStatus(value: unknown): value is WorkItem["status"] {
  return (
    value === "draft" ||
    value === "ready" ||
    value === "reserved" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "needs_verification" ||
    value === "verified" ||
    value === "closed" ||
    value === "cancelled"
  );
}

function isEdgeKind(value: unknown): value is GraphEdge["kind"] {
  return (
    value === "blocks" ||
    value === "depends_on" ||
    value === "relates_to" ||
    value === "supports" ||
    value === "contradicts" ||
    value === "verifies" ||
    value === "references"
  );
}

function isReservationStatus(value: unknown): value is AgentReservation["status"] {
  return value === "active" || value === "released" || value === "expired";
}

function isEvidenceOutcome(value: unknown): value is EvidenceRecord["outcome"] {
  return value === "passed" || value === "failed" || value === "observed" || value === "unknown";
}

function isVerificationVerdict(value: unknown): value is VerificationRecord["verdict"] {
  return value === "passed" || value === "failed";
}

function isKnowledgeSourceKind(value: unknown): value is KnowledgeSource["kind"] {
  return value === "raw" || value === "document" || value === "chat" || value === "code" || value === "artifact";
}

function isClaimStatus(value: unknown): value is ClaimRecord["status"] {
  return value === "proposed" || value === "accepted" || value === "rejected" || value === "stale";
}

function isDecisionStatus(value: unknown): value is DecisionRecord["status"] {
  return value === "proposed" || value === "accepted" || value === "superseded" || value === "rejected";
}

function capitalize(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

export function asWorkId(value: string): WorkId {
  if (!value.startsWith("bw_work_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected a work id, got ${value}`);
  }
  return value as WorkId;
}

export function asEvidenceId(value: string): EvidenceId {
  if (!value.startsWith("bw_evidence_")) {
    throw new BorealError("BOREAL_INVALID_INPUT", `Expected an evidence id, got ${value}`);
  }
  return value as EvidenceId;
}
