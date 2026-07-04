import { join } from "node:path";

import { BorealError, isBorealError, nowIso, type IsoTimestamp } from "@boreal/core";
import { rebuildSQLiteCache, type SQLiteCacheRebuildResult } from "@boreal/storage";
import type { WorkItemView } from "@boreal/ui-model";

import { hasFlag, type ParsedArgs } from "../args.js";
import { keyValueRows, resultSummary, section } from "../cli-ui.js";
import type { CliContext } from "../context.js";
import { inspectGitWorktree, type GitWorktreeInspection } from "../git-worktree.js";
import {
  buildExportDocument,
  exportLedgers,
  ledgerStatus,
  readGeneratedLedgerTombstones,
  type LedgerStatusResult
} from "../import-export.js";
import { formatRecord, type CliOutput } from "../output.js";
import { inspectSearchIndex, writeSearchIndex, type SearchIndexInspection } from "../search-cli.js";
import { inspectVault, VAULT_SCHEMA_VERSION, type VaultStatusResult } from "../vault.js";
import {
  assertCircuitBreakerAllows,
  recordCircuitBreakerFailure,
  recordCircuitBreakerSuccess,
  type CommandResult
} from "./shared.js";

export interface SyncStatusResult {
  readonly ok: boolean;
  readonly workspaceRoot: string;
  readonly checkedAt: IsoTimestamp;
  readonly vault: VaultStatusResult;
  readonly ledgers: LedgerStatusResult;
  readonly searchIndex: SearchIndexInspection & { readonly ok: boolean };
  readonly git: GitWorktreeInspection;
  readonly recommendedActions: readonly string[];
}

export interface SyncRefreshResult {
  readonly refreshed: true;
  readonly refreshOk: true;
  readonly postRefreshStatusOk: boolean;
  readonly exitReason: "ok" | "post_refresh_status_unhealthy";
  readonly contextViews: number;
  readonly searchIndex: Awaited<ReturnType<typeof writeSearchIndex>>;
  readonly ledgers: Awaited<ReturnType<typeof exportLedgers>>;
  readonly sqliteCache: SQLiteCacheRebuildResult;
  readonly status: SyncStatusResult;
}

export interface SyncCommandDependencies {
  readonly dashboardView: (args: ParsedArgs) => boolean;
  readonly formatRecordWithAgentDirectives: (
    input: {
      readonly context: CliContext;
      readonly args: ParsedArgs;
      readonly result: object;
      readonly json: boolean;
      readonly options: {
        readonly syncStatus?: SyncStatusResult;
        readonly syncRefreshed?: boolean;
        readonly subject?: { readonly type: "workspace"; readonly id: string; readonly title: string };
      };
    }
  ) => Promise<string>;
}

export async function syncCommand(
  action: string | undefined,
  context: CliContext,
  args: ParsedArgs,
  output: CliOutput,
  json: boolean,
  dependencies: SyncCommandDependencies
): Promise<CommandResult> {
  switch (action) {
    case "status": {
      const status = await buildSyncStatus(context);
      output.write(json ? await dependencies.formatRecordWithAgentDirectives({
        context,
        args,
        result: status,
        json: true,
        options: {
          syncStatus: status,
          subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
        }
      }) : dependencies.dashboardView(args) ? formatSyncDashboard(status) : formatRecord(status, false));
      return { exitCode: status.ok ? 0 : 1 };
    }
    case "refresh": {
      await assertCircuitBreakerAllows(context, "sync refresh");
      let result: SyncRefreshResult;
      try {
        result = await buildSyncRefreshResult(context);
        await recordCircuitBreakerSuccess(context, "sync refresh");
      } catch (error) {
        await recordCircuitBreakerFailure(context, "sync refresh", error);
        throw error;
      }
      output.write(await dependencies.formatRecordWithAgentDirectives({
        context,
        args,
        result,
        json,
        options: {
          syncStatus: result.status,
          syncRefreshed: true,
          subject: { type: "workspace", id: context.workspaceRoot, title: "Workspace" }
        }
      }));
      return { exitCode: hasFlag(args, "strict") && !result.postRefreshStatusOk ? 1 : 0 };
    }
    default:
      throw new BorealError("BOREAL_INVALID_INPUT", `Unknown sync command: ${action ?? ""}`);
  }
}

export async function buildSyncRefreshResult(context: CliContext): Promise<SyncRefreshResult> {
  const { views, searchIndex, ledgers, sqliteCache } = await refreshGeneratedArtifactsInline(context);
  const status = await buildSyncStatus(context);
  return {
    refreshed: true,
    refreshOk: true,
    postRefreshStatusOk: status.ok,
    exitReason: status.ok ? "ok" : "post_refresh_status_unhealthy",
    contextViews: views.length,
    searchIndex,
    ledgers,
    sqliteCache,
    status
  };
}

export async function refreshGeneratedArtifactsInline(context: CliContext) {
  const views = await rebuildProjectionsRespectingTombstones(context);
  const searchIndex = await writeSearchIndex(context);
  const ledgers = await exportLedgers(context, undefined);
  const cacheDocument = await buildExportDocument(context);
  const sqliteCache = await rebuildSQLiteCache({
    rootDir: context.workspaceRoot,
    snapshot: cacheDocument.state,
    sourceContentHash: cacheDocument.contentHash
  });
  return { views, searchIndex, ledgers, sqliteCache };
}

export async function rebuildProjectionsRespectingTombstones(context: CliContext): Promise<readonly WorkItemView[]> {
  const tombstones = await readGeneratedLedgerTombstones(context);
  return context.runtime.rebuildProjections({
    skipContextPackIds: tombstones.contextPackIds,
    skipProjectionIds: tombstones.projectionIds
  });
}

export async function buildSyncStatus(context: CliContext): Promise<SyncStatusResult> {
  const [vault, ledgers, searchIndex, git] = await Promise.all([
    inspectVaultForSyncStatus(context),
    safeLedgerStatus(context),
    inspectSearchIndex(context),
    inspectGitWorktree(context)
  ]);
  const searchIndexOk = searchIndex.exists && !searchIndex.stale && !searchIndex.error;
  const recommendedActions = syncRecommendedActions(vault, ledgers, searchIndexOk, git);
  return {
    ok: vault.ok && ledgers.ok && searchIndexOk && git.ok,
    workspaceRoot: context.workspaceRoot,
    checkedAt: nowIso(),
    vault,
    ledgers,
    searchIndex: {
      ...searchIndex,
      ok: searchIndexOk
    },
    git,
    recommendedActions
  };
}

async function inspectVaultForSyncStatus(context: CliContext): Promise<VaultStatusResult> {
  try {
    return await inspectVault(context);
  } catch (caught) {
    if (!isBorealError(caught)) {
      throw caught;
    }
    return unavailableVaultStatus(context);
  }
}

function unavailableVaultStatus(context: CliContext): VaultStatusResult {
  return {
    ok: false,
    initialized: false,
    rootDir: join(context.workspaceRoot, "memory"),
    schemaVersion: VAULT_SCHEMA_VERSION,
    health: {
      ok: false,
      hasWarnings: true,
      rawSourceCount: 0,
      wikiPageCount: 0,
      ledgerEventCount: 0,
      brokenLinks: [],
      orphanPages: [],
      missingSourceRefs: [],
      staleClaims: [],
      malformedRawRecords: [],
      malformedLedgerEvents: [],
      missingArchiveRefs: [],
      missingMergeRefs: []
    },
    requiredDirectories: [],
    requiredFiles: [],
    missingDirectories: [],
    missingFiles: [],
    invalidPaths: []
  };
}

async function safeLedgerStatus(context: CliContext): Promise<LedgerStatusResult> {
  try {
    return await ledgerStatus(context, undefined);
  } catch (error) {
    return {
      ok: false,
      path: join(context.workspaceRoot, ".boreal/ledgers/manifest.json"),
      exists: false,
      stale: true,
      expectedContentHash: "unavailable",
      reconstructable: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

function syncRecommendedActions(
  vault: VaultStatusResult,
  ledgers: LedgerStatusResult,
  searchIndexOk: boolean,
  git: GitWorktreeInspection
): readonly string[] {
  const actions: string[] = [];
  if (!vault.ok) {
    actions.push("bwrk vault init --json");
  }
  if (!ledgers.ok || !searchIndexOk) {
    actions.push("bwrk sync refresh --json");
  }
  return [...actions, ...git.recommendedActions];
}

function formatSyncDashboard(status: SyncStatusResult): string {
  return [
    resultSummary({
      status: status.ok ? "success" : "warning",
      title: "Sync status",
      detail: status.workspaceRoot
    }),
    section(
      "Checks",
      keyValueRows([
        { key: "vault", value: status.vault.ok },
        { key: "ledgers", value: status.ledgers.ok },
        { key: "searchIndex", value: status.searchIndex.ok },
        { key: "git", value: status.git.ok }
      ]).split("\n")
    ),
    section("Recommended actions", status.recommendedActions.length > 0 ? status.recommendedActions : ["none"])
  ].join("\n\n") + "\n";
}
