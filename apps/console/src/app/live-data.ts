import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";

import { runBoundedProcess } from "@boreal/core";
import {
  buildDashboardHealthView,
  buildGlobalActivityView,
  buildGlobalHealthView,
  buildGlobalSearchView,
  buildGlobalSettingsView,
  buildGlobalWorkQueuesView,
  buildProjectRegistryView,
  buildSprintBoardView,
  buildWorkDashboardView,
  type DashboardFinding,
  type GlobalSettingsProjectInput,
  type LockDashboardView,
  type ProjectRegistryEntry as DashboardProjectRegistryEntry,
  type ProjectHealthState,
  type ProjectMemoryGitMode,
  type ProjectMemoryLayout,
  type ProjectSyncFreshness,
  type SyncDashboardView,
  type WorkDirectiveAcknowledgementView,
  type WorkDirectiveConflictView,
  type WorkDirectiveItemView,
  type WorkDirectiveLane,
  type WorkDirectiveMissingRequiredView,
  type WorkDirectiveNextStepView,
  type WorkDirectiveSeverity,
  type WorkDirectiveSummaryView,
  type WorkItemView
} from "@boreal/ui-model";

import { getSafeConsoleCommand, SAFE_CONSOLE_COMMANDS, type SafeConsoleCommandId } from "./commands.js";
import {
  ConsoleCliContractError,
  validateConsoleCliContract
} from "./cli-contracts.js";
import { createMemoryDashboardActions, memoryWorkflowShowCommand } from "./memory-actions.js";
import { routesForScope } from "./routes.js";
import type {
  ConsoleDataSet,
  ConsoleScope,
  ConsoleSelection,
  RawContradictionReviewView,
  RawIngestFindingSeverity,
  RawIngestMutationView,
  RawIngestPlanView,
  RawInboxView,
  RawLinkedPageView,
  RawPreviewMediaType,
  RawPreviewStatus,
  RawProcessingStatus,
  RawSourceDetailView,
  RawSourcePreviewView,
  RawSourceRowView,
  ReportArtifactKind,
  ReportArtifactView,
  ReportsView,
  WikiClaimView,
  WikiDecisionView,
  WikiExplorerView,
  WikiHealthFindingView,
  WikiKnowledgeSourceView,
  WikiLinkedPageView,
  ObsidianCompatibilityView,
  ObsidianFrontmatterStatus,
  ObsidianLinkHealthStatus,
  VaultDashboardLinkView,
  VaultInvalidPathFindingView,
  WikiPageDetailView,
  WikiPageRowView,
  WikiSourceCoverageStatus,
  WikiSourceCoverageView,
  WikiTruthStatus
} from "./types.js";

export interface ConsoleCliRunner {
  run(args: readonly string[]): Promise<unknown>;
}

export interface ConsoleCommandParams {
  get(name: string): string | null;
}

export class ConsoleCommandError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
    this.name = "ConsoleCommandError";
  }
}

export interface LoadLiveConsoleDataOptions {
  readonly workspaceRoot: string;
  readonly runner?: ConsoleCliRunner;
  readonly sprintLabel?: string;
  readonly globalSearchQuery?: string;
  readonly selection?: ConsoleSelection;
  readonly scope?: ConsoleScope;
}

export function createNodeCliRunner(input: { readonly workspaceRoot: string; readonly cliPath?: string; readonly cliCommand?: string }): ConsoleCliRunner {
  const workspaceRoot = resolve(input.workspaceRoot);
  const cliCommand = input.cliCommand ?? process.env.BOREAL_CONSOLE_CLI ?? "bwrk";
  return {
    async run(args) {
      const output = await runNodeCli({ workspaceRoot, cliPath: input.cliPath, cliCommand, args });
      return resolveCliData(output, workspaceRoot);
    }
  };
}

export async function loadLiveConsoleData(options: LoadLiveConsoleDataOptions): Promise<ConsoleDataSet> {
  const workspaceRoot = resolve(options.workspaceRoot);
  const generatedAt = new Date().toISOString();
  const runner = options.runner ?? createNodeCliRunner({ workspaceRoot });
  const scope: ConsoleScope = options.scope ?? "repo";
  const sprintLabel = options.sprintLabel ?? "sprint-04";
  const globalSearchQuery = options.globalSearchQuery ?? "v1-remainder global dashboard registry";
  const [
    sprintRows,
    readyRows,
    allRows,
    syncStatus,
    doctorResult,
    activeReservations,
    projectSetup
  ] = await Promise.all([
    cliArray<WorkListRow>(runner, ["work", "list", "--label", sprintLabel, "--limit", "100", "--json"]),
    cliArray<WorkListRow>(runner, ["work", "list", "--ready", "--label", "v1-remainder", "--limit", "20", "--json"]),
    cliArray<WorkListRow>(runner, ["work", "list", "--limit", "250", "--json"]),
    cliData<unknown>(runner, ["sync", "status", "--json"]),
    cliData<unknown>(runner, ["doctor", "--json"]),
    cliArray<ReservationListRow>(runner, ["reservation", "list", "--status", "active", "--json"]),
    readProjectSetup(workspaceRoot)
  ]);
  // The cross-repo registry is only loaded in global scope; repo scope never
  // reaches across projects (and skips these calls entirely).
  const [registryList, registryDoctor] =
    scope === "global"
      ? await Promise.all([
          cliData<unknown>(runner, ["registry", "list", "--json"]),
          cliData<unknown>(runner, ["registry", "doctor", "--json"])
        ])
      : [undefined, undefined];
  const sprintWork = await Promise.all(sprintRows.map((row) => loadWorkView(runner, row)));
  const readyWork = readyRows.map((row) => workViewFromRow(row));
  const listedWork = allRows.map((row) => workViewFromRow(row));
  const sprint = sprintWork.find((item) => item.kind === "sprint") ?? sprintWork[0] ?? workViewFromRow({
    id: "sprint-missing",
    title: `${sprintLabel} sprint`,
    status: "blocked",
    priority: "high",
    labels: [sprintLabel]
  });
  const boardWork = sprintWork.filter((item) => item.id !== sprint.id);
  const projectFindings = dashboardFindingsFromDoctor(doctorResult);
  const sync = syncViewFromCli(syncStatus, workspaceRoot, generatedAt);
  const memoryRoot = projectSetup.memoryRoot ?? memoryRootFromSync(syncStatus);
  const health = buildDashboardHealthView({
    title: "Doctor",
    generatedAt,
    findings: projectFindings
  });
  const allWork = mergeWork(mergeWork(listedWork, readyWork), sprintWork);
  const [currentSearchResults, currentActivityRows] = await Promise.all([
    loadProjectSearchResults(runner, [], globalSearchQuery),
    loadProjectActivityRows(runner, [])
  ]);
  const staleWarnings = [
    ...(!sync.ok ? ["Sync status reports stale or unhealthy generated state."] : []),
    ...projectFindings.filter((finding) => finding.severity !== "info").map((finding) => finding.message)
  ];
  const workspaceStale = !sync.ok || health.summary.errors > 0 || health.summary.warnings > 0;
  const projectOverviews =
    scope === "global"
      ? await buildConsoleProjectOverviews({
          runner,
          workspaceRoot,
          generatedAt,
          registryList,
          registryDoctor,
          projectSetup,
          currentWork: allWork,
          currentSync: sync,
          currentFindings: projectFindings,
          currentReservations: activeReservations,
          currentSearchResults,
          currentActivityRows,
          globalSearchQuery,
          includeCurrentFallback: false
        })
      : [];
  const registryEntries = projectOverviews.map((project) => project.entry);
  const rawInbox = await loadRawInbox(runner, generatedAt, options.selection?.rawSource);
  const wikiExplorer = await loadWikiExplorer(runner, generatedAt, rawInbox, {
    workspaceRoot,
    memoryRoot,
    doctorResult
  }, options.selection?.wikiPage);
  const reports = await loadReportsView({
    workspaceRoot,
    generatedAt,
    stale: workspaceStale,
    rawInbox,
    wikiExplorer
  });

  return {
    workspace: {
      projectName: basename(workspaceRoot),
      workspaceRoot: projectSetup.projectRoot ?? workspaceRoot,
      memoryRoot,
      mode: "live",
      scope,
      generatedAt,
      stale: workspaceStale,
      warnings: staleWarnings
    },
    routes: routesForScope(scope),
    registry: buildProjectRegistryView({
      generatedAt,
      entries: registryEntries
    }),
    globalQueues: buildGlobalWorkQueuesView({
      generatedAt,
      projects: projectOverviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        work: project.work
      }))
    }),
    globalSearch: buildGlobalSearchView({
      generatedAt,
      query: globalSearchQuery,
      projects: projectOverviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        results: project.searchResults
      }))
    }),
    globalActivity: buildGlobalActivityView({
      generatedAt,
      projects: projectOverviews.map((project) => ({
        projectId: project.entry.id,
        projectName: project.entry.name,
        projectRoot: project.entry.projectRoot,
        operations: project.activityRows
      }))
    }),
    globalHealth: buildGlobalHealthView({
      generatedAt,
      projects: projectOverviews.map((project) => ({
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
    globalSettings: buildGlobalSettingsView({
      generatedAt,
      projects: projectOverviews.map((project) => project.settings)
    }),
    work: buildWorkDashboardView({
      generatedAt,
      labels: ["v1-remainder", sprintLabel],
      work: allWork,
      reservations: activeReservations
    }),
    sprint: buildSprintBoardView({
      generatedAt,
      sprint,
      work: boardWork,
      reservations: activeReservations
    }),
    health,
    sync,
    locks: lockViewFromDoctor(doctorResult, workspaceRoot, generatedAt),
    rawInbox,
    wikiExplorer,
    memoryActions: createMemoryDashboardActions(generatedAt),
    reports,
    safeCommands: SAFE_CONSOLE_COMMANDS
  };
}

export async function runSafeConsoleCommand(input: {
  readonly id: string;
  readonly workspaceRoot: string;
  readonly runner?: ConsoleCliRunner;
  readonly params?: ConsoleCommandParams;
}): Promise<unknown> {
  const command = getSafeConsoleCommand(input.id);
  if (!command) {
    throw new ConsoleCommandError("CONSOLE_COMMAND_NOT_ALLOWED", "Unsafe or unknown console command", { commandId: input.id });
  }
  const args = targetedCommandArgs(input.id, input.params) ?? (command.executable ? command.args : undefined);
  if (!args) {
    throw new ConsoleCommandError("CONSOLE_COMMAND_NEEDS_INPUT", "Console command requires target input before execution", {
      commandId: command.id,
      command: command.command
    });
  }
  const runner = input.runner ?? createNodeCliRunner({ workspaceRoot: input.workspaceRoot });
  return runner.run(args);
}

function targetedCommandArgs(id: string, params?: ConsoleCommandParams): readonly string[] | undefined {
  if (!params) {
    return undefined;
  }
  switch (id) {
    case "work.reserve": {
      const workId = requiredCommandParam(params, "workId", id);
      const agentId = requiredCommandParam(params, "agentId", id);
      const purpose = optionalCommandParam(params, "purpose");
      const ttl = optionalCommandParam(params, "ttl");
      const expiresAt = optionalCommandParam(params, "expiresAt");
      return [
        "work",
        "reserve",
        workId,
        "--agent",
        agentId,
        ...(purpose ? ["--purpose", purpose] : []),
        ...reservationExpiryArgs(ttl, expiresAt, id),
        "--json"
      ];
    }
    case "work.release":
      return ["work", "release", requiredCommandParam(params, "workId", id), "--json"];
    case "work.renew": {
      const workId = requiredCommandParam(params, "workId", id);
      const ttl = optionalCommandParam(params, "ttl");
      const expiresAt = optionalCommandParam(params, "expiresAt");
      return ["work", "renew", workId, ...reservationExpiryArgs(ttl, expiresAt, id), "--json"];
    }
    case "work.verify": {
      const workId = requiredCommandParam(params, "workId", id);
      const evidenceId = requiredCommandParam(params, "evidenceId", id);
      const verdict = optionalCommandParam(params, "verdict") ?? "passed";
      const notes = optionalCommandParam(params, "notes");
      if (verdict !== "passed" && verdict !== "failed") {
        throw new ConsoleCommandError("CONSOLE_COMMAND_INVALID_INPUT", "Verification verdict must be passed or failed", {
          commandId: id,
          field: "verdict",
          value: verdict
        });
      }
      return [
        "work",
        "verify",
        workId,
        "--evidence",
        evidenceId,
        "--verdict",
        verdict,
        ...(notes ? ["--notes", notes] : []),
        "--json"
      ];
    }
    case "work.close":
      return [
        "work",
        "close",
        requiredCommandParam(params, "workId", id),
        "--reason",
        requiredCommandParam(params, "reason", id),
        "--json"
      ];
    case "work.create": {
      const title = requiredCommandParam(params, "title", id);
      const sourceRef = requiredCommandParam(params, "sourceRef", id);
      const description = optionalCommandParam(params, "description");
      const priority = optionalCommandParam(params, "priority") ?? "normal";
      const kind = optionalCommandParam(params, "kind") ?? "task";
      const label = optionalCommandParam(params, "label");
      const acceptance = optionalCommandParam(params, "acceptance");
      const ready = optionalCommandParam(params, "ready") === "yes";
      if (!["issue", "task", "sprint", "milestone"].includes(kind)) {
        throw new ConsoleCommandError("CONSOLE_COMMAND_INVALID_INPUT", "Work kind is invalid", { commandId: id, field: "kind", value: kind });
      }
      if (!["low", "normal", "high", "critical"].includes(priority)) {
        throw new ConsoleCommandError("CONSOLE_COMMAND_INVALID_INPUT", "Work priority is invalid", { commandId: id, field: "priority", value: priority });
      }
      return [
        "work",
        "create",
        title,
        "--kind",
        kind,
        "--priority",
        priority,
        ...(description ? ["--description", description] : []),
        ...(label ? ["--label", label] : []),
        ...(acceptance ? ["--acceptance", acceptance] : []),
        "--source",
        sourceRef,
        ...(ready ? ["--ready"] : []),
        "--json"
      ];
    }
    case "sync.refresh":
      return ["sync", "refresh", "--json"];
    default:
      return undefined;
  }
}

function reservationExpiryArgs(ttl: string | undefined, expiresAt: string | undefined, commandId: string): readonly string[] {
  if (ttl && expiresAt) {
    throw new ConsoleCommandError("CONSOLE_COMMAND_INVALID_INPUT", "Use either ttl or expiresAt, not both", {
      commandId,
      fields: ["ttl", "expiresAt"]
    });
  }
  if (ttl) {
    return ["--ttl", ttl];
  }
  if (expiresAt) {
    return ["--expires-at", expiresAt];
  }
  return [];
}

function requiredCommandParam(params: ConsoleCommandParams, name: string, commandId: string): string {
  const value = optionalCommandParam(params, name);
  if (!value) {
    throw new ConsoleCommandError("CONSOLE_COMMAND_INVALID_INPUT", `Missing ${name}`, { commandId, field: name });
  }
  return value;
}

function optionalCommandParam(params: ConsoleCommandParams, name: string): string | undefined {
  const value = params.get(name)?.trim() ?? "";
  return value.length > 0 ? value : undefined;
}

async function loadWorkView(runner: ConsoleCliRunner, row: WorkListRow): Promise<WorkItemView> {
  try {
    return workViewFromRecord(await cliData<unknown>(runner, ["work", "show", row.id, "--json"]));
  } catch (error) {
    if (error instanceof ConsoleCliContractError) {
      throw error;
    }
    return workViewFromRow(row);
  }
}

async function loadProjectSearchResults(
  runner: ConsoleCliRunner,
  workspaceArg: readonly string[],
  query: string
): Promise<readonly SearchResultRow[]> {
  try {
    return await cliArray<SearchResultRow>(runner, [...workspaceArg, "search", "query", query, "--limit", "10", "--json"]);
  } catch (error) {
    if (error instanceof ConsoleCliContractError) {
      throw error;
    }
    return [];
  }
}

async function loadProjectActivityRows(
  runner: ConsoleCliRunner,
  workspaceArg: readonly string[]
): Promise<readonly OperationListRow[]> {
  try {
    return await cliArray<OperationListRow>(runner, [...workspaceArg, "operation", "list", "--limit", "20", "--json"]);
  } catch (error) {
    if (error instanceof ConsoleCliContractError) {
      throw error;
    }
    return [];
  }
}

async function loadRawInbox(runner: ConsoleCliRunner, generatedAt: string, requestedId?: string): Promise<RawInboxView> {
  const warnings: string[] = [];
  let rows: readonly RawSourceRowView[] = [];
  try {
    rows = (await cliArray<RawSourceListRow>(runner, ["raw", "list", "--limit", "50", "--json"])).map(rawSourceRowView);
  } catch (error) {
    if (error instanceof ConsoleCliContractError) {
      throw error;
    }
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  let selected: RawSourceDetailView | undefined;
  const target = (requestedId ? rows.find((row) => row.id === requestedId) : undefined) ?? rows[0];
  if (target) {
    try {
      selected = rawSourceDetailView(
        await cliData<RawSourceDetailRow>(runner, ["raw", "show", target.id, "--preview-bytes", "4096", "--json"])
      );
    } catch (error) {
      if (error instanceof ConsoleCliContractError) {
        throw error;
      }
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    generatedAt,
    rows,
    selected,
    ingestPlan: selected ? buildRawIngestPlan(selected, generatedAt) : undefined,
    contradictionReview: selected ? buildRawContradictionReview(selected, generatedAt) : undefined,
    summary: {
      total: rows.length,
      queued: rows.filter((row) => row.processingStatus === "queued").length,
      linked: rows.filter((row) => row.processingStatus === "linked").length,
      missingPreview: selected?.preview.status === "missing" ? 1 : 0,
      unsupportedPreview: selected?.preview.status === "unsupported" || selected?.preview.status === "outside_workspace" ? 1 : 0
    },
    warnings
  };
}

async function loadWikiExplorer(
  runner: ConsoleCliRunner,
  generatedAt: string,
  rawInbox: RawInboxView,
  context: {
    readonly workspaceRoot: string;
    readonly memoryRoot?: string;
    readonly doctorResult?: unknown;
  },
  requestedId?: string
): Promise<WikiExplorerView> {
  const warnings: string[] = [];
  let pageRows: readonly WikiPageListRow[] = [];
  let sources: readonly WikiKnowledgeSourceView[] = [];
  let claims: readonly WikiClaimView[] = [];
  let decisions: readonly WikiDecisionView[] = [];

  try {
    pageRows = await cliArray<WikiPageListRow>(runner, ["wiki", "list", "--limit", "100", "--json"]);
  } catch (error) {
    if (error instanceof ConsoleCliContractError) {
      throw error;
    }
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  try {
    sources = (await cliArray<KnowledgeSourceListRow>(runner, ["source", "list", "--limit", "100", "--json"])).map(wikiKnowledgeSourceView);
  } catch (error) {
    if (error instanceof ConsoleCliContractError) {
      throw error;
    }
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  try {
    claims = (await cliArray<ClaimListRow>(runner, ["claim", "list", "--limit", "100", "--json"])).map(wikiClaimView);
  } catch (error) {
    if (error instanceof ConsoleCliContractError) {
      throw error;
    }
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  try {
    decisions = (await cliArray<DecisionListRow>(runner, ["decision", "list", "--limit", "100", "--json"])).map(wikiDecisionView);
  } catch (error) {
    if (error instanceof ConsoleCliContractError) {
      throw error;
    }
    warnings.push(error instanceof Error ? error.message : String(error));
  }

  let selected: WikiPageDetailView | undefined;
  const target = (requestedId ? pageRows.find((row) => row.id === requestedId || row.slug === requestedId) : undefined) ?? pageRows[0];
  if (target) {
    try {
      selected = wikiPageDetailView(
        await cliData<WikiPageDetailRow>(runner, ["wiki", "show", target.id || target.slug, "--json"]),
        rawInbox.rows,
        sources,
        claims,
        decisions
      );
    } catch (error) {
      if (error instanceof ConsoleCliContractError) {
        throw error;
      }
      warnings.push(error instanceof Error ? error.message : String(error));
    }
  }

  const rows = pageRows.map((row) => wikiPageRowView(row, rawInbox.rows, sources, claims, decisions));
  const healthFindings = buildWikiHealthFindings({
    pageRows,
    rows,
    rawRows: rawInbox.rows,
    runtimeSources: sources,
    claims,
    decisions
  });
  const obsidian = buildObsidianCompatibility({
    generatedAt,
    workspaceRoot: context.workspaceRoot,
    memoryRoot: context.memoryRoot,
    rows,
    selected,
    healthFindings,
    doctorResult: context.doctorResult
  });
  return {
    generatedAt,
    rows,
    selected,
    importantPages: rows.slice(0, 5),
    claims,
    decisionTimeline: [...decisions].sort(compareDecisionsForTimeline),
    filters: {
      claimStatuses: uniqueStrings(claims.map((claim) => claim.status)),
      decisionStatuses: uniqueStrings(decisions.map((decision) => decision.status)),
      sourceIds: uniqueStrings([
        ...pageRows.flatMap((page) => stringArray(page.sourceRefs)),
        ...sources.map((source) => source.id),
        ...claims.flatMap((claim) => claim.sourceIds),
        ...decisions.flatMap((decision) => decision.sourceIds)
      ])
    },
    healthFindings,
    obsidian,
    summary: {
      total: rows.length,
      accepted: rows.filter((row) => row.truthStatus === "accepted").length,
      draft: rows.filter((row) => row.truthStatus === "draft").length,
      proposed: rows.filter((row) => row.truthStatus === "proposed").length,
      stale: rows.filter((row) => row.truthStatus === "stale").length,
      unbacked: rows.filter((row) => row.sourceCoverageStatus === "unbacked").length,
      missingSources: rows.filter((row) => row.sourceCoverageStatus === "missing" || row.sourceCoverageStatus === "partial").length
    },
    reviewSummary: {
      claims: claims.length,
      acceptedClaims: claims.filter((claim) => claim.status === "accepted").length,
      proposedClaims: claims.filter((claim) => claim.status === "proposed").length,
      rejectedClaims: claims.filter((claim) => claim.status === "rejected").length,
      staleClaims: claims.filter((claim) => claim.status === "stale").length,
      decisions: decisions.length,
      acceptedDecisions: decisions.filter((decision) => decision.status === "accepted").length,
      proposedDecisions: decisions.filter((decision) => decision.status === "proposed").length,
      rejectedDecisions: decisions.filter((decision) => decision.status === "rejected").length,
      supersededDecisions: decisions.filter((decision) => decision.status === "superseded").length
    },
    healthSummary: {
      findings: healthFindings.length,
      warnings: healthFindings.filter((finding) => finding.severity === "warning").length,
      dangers: healthFindings.filter((finding) => finding.severity === "danger").length,
      staleClaims: healthFindings.filter((finding) => finding.code === "vault.health.stale_assertion" && finding.targetKind === "claim").length,
      orphanSources: healthFindings.filter((finding) => finding.code === "vault.health.orphan_source").length,
      missingPageCoverage: healthFindings.filter((finding) => finding.code === "vault.health.missing_page_coverage").length
    },
    warnings
  };
}

function buildWikiHealthFindings(input: {
  readonly pageRows: readonly WikiPageListRow[];
  readonly rows: readonly WikiPageRowView[];
  readonly rawRows: readonly RawSourceRowView[];
  readonly runtimeSources: readonly WikiKnowledgeSourceView[];
  readonly claims: readonly WikiClaimView[];
  readonly decisions: readonly WikiDecisionView[];
}): readonly WikiHealthFindingView[] {
  const findings: WikiHealthFindingView[] = [];
  for (const claim of input.claims.filter((item) => item.status === "stale")) {
    findings.push({
      id: `vault.health.stale_assertion:${claim.id}`,
      code: "vault.health.stale_assertion",
      doctorCode: "vault.health",
      severity: "warning",
      title: "Stale claim",
      detail: `Claim ${claim.id} is stale: ${claim.statement}`,
      targetKind: "claim",
      targetId: claim.id,
      href: knowledgeHealthHref({ claimStatus: "stale", source: claim.sourceIds[0] }),
      command: `bwrk claim show ${claim.id} --json`
    });
  }

  for (const row of input.rows.filter((item) => item.truthStatus === "stale")) {
    findings.push({
      id: `vault.health.stale_assertion:${row.id || row.slug}`,
      code: "vault.health.stale_assertion",
      doctorCode: "vault.health",
      severity: "warning",
      title: "Stale wiki page",
      detail: `${row.title} is marked stale in wiki truth metadata.`,
      targetKind: "page",
      targetId: row.id || row.slug,
      href: knowledgeHealthHref({ page: row.id || row.slug }),
      command: row.showCommand
    });
  }

  const attachedSourceIds = wikiAttachedSourceIds(input.pageRows, input.rawRows, input.runtimeSources, input.claims, input.decisions);
  for (const source of input.runtimeSources.filter((item) => !attachedSourceIds.has(item.id))) {
    findings.push({
      id: `vault.health.orphan_source:${source.id}`,
      code: "vault.health.orphan_source",
      doctorCode: "vault.health",
      severity: "warning",
      title: "Orphan source",
      detail: `${source.title || source.id} is not referenced by wiki pages, claims, or decisions.`,
      targetKind: "source",
      targetId: source.id,
      href: knowledgeHealthHref({ source: source.id }),
      command: `bwrk source show ${source.id} --json`
    });
  }

  for (const row of input.rows.filter((item) => item.sourceCoverageStatus !== "covered")) {
    findings.push({
      id: `vault.health.missing_page_coverage:${row.id || row.slug}`,
      code: "vault.health.missing_page_coverage",
      doctorCode: "vault.health",
      severity: row.sourceCoverageStatus === "unbacked" ? "warning" : "danger",
      title: "Missing page coverage",
      detail: `${row.title} has ${row.sourceCoverageStatus} source coverage.`,
      targetKind: "page",
      targetId: row.id || row.slug,
      href: knowledgeHealthHref({ page: row.id || row.slug }),
      command: row.showCommand
    });
  }
  return findings;
}

function wikiAttachedSourceIds(
  pageRows: readonly WikiPageListRow[],
  rawRows: readonly RawSourceRowView[],
  runtimeSources: readonly WikiKnowledgeSourceView[],
  claims: readonly WikiClaimView[],
  decisions: readonly WikiDecisionView[]
): ReadonlySet<string> {
  const sourceIds = new Set<string>();
  for (const pageRow of pageRows) {
    const sourceRefs = stringArray(pageRow.sourceRefs);
    const coverage = wikiSourceCoverage(sourceRefs, rawRows, runtimeSources);
    for (const sourceRef of sourceRefs) {
      sourceIds.add(sourceRef);
    }
    for (const source of coverage.rawSources) {
      sourceIds.add(source.id);
    }
    for (const source of coverage.runtimeSources) {
      sourceIds.add(source.id);
    }
  }
  for (const sourceId of claims.flatMap((claim) => claim.sourceIds)) {
    sourceIds.add(sourceId);
  }
  for (const sourceId of decisions.flatMap((decision) => decision.sourceIds)) {
    sourceIds.add(sourceId);
  }
  return sourceIds;
}

function knowledgeHealthHref(input: {
  readonly page?: string;
  readonly source?: string;
  readonly claimStatus?: string;
}): string {
  const params = new URLSearchParams();
  if (input.page) {
    params.set("page", input.page);
  }
  if (input.claimStatus) {
    params.set("claimStatus", input.claimStatus);
  }
  if (input.source) {
    params.set("source", input.source);
  }
  const query = params.toString();
  return query ? `/knowledge?${query}` : "/knowledge";
}

function buildObsidianCompatibility(input: {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly memoryRoot?: string;
  readonly rows: readonly WikiPageRowView[];
  readonly selected?: WikiPageDetailView;
  readonly healthFindings: readonly WikiHealthFindingView[];
  readonly doctorResult?: unknown;
}): ObsidianCompatibilityView {
  const invalidPathFindings = vaultInvalidPathFindingsFromDoctor(input.doctorResult);
  const vaultName = input.memoryRoot ? basename(input.memoryRoot) : "memory";
  const pages = input.rows.map((row) => obsidianPageLinkView({
    row,
    selected: input.selected,
    memoryRoot: input.memoryRoot,
    vaultName,
    healthFindings: input.healthFindings
  }));
  const dashboardLinks = vaultDashboardLinks({
    workspaceRoot: input.workspaceRoot,
    memoryRoot: input.memoryRoot,
    vaultName,
    invalidPathFindings
  });
  const warnings = [
    ...(!input.memoryRoot ? ["No memory root is available, so Obsidian URIs are omitted. Local dashboard links remain available."] : []),
    ...(
      invalidPathFindings.length > 0
        ? ["Doctor reports invalid vault scaffold paths. Resolve those paths before relying on Obsidian vault navigation."]
        : []
    )
  ];
  return {
    generatedAt: input.generatedAt,
    memoryRoot: input.memoryRoot,
    vaultName,
    obsidianUriAvailable: pages.some((page) => page.obsidianUri) || dashboardLinks.some((link) => link.obsidianUri),
    pages,
    dashboardLinks,
    invalidPathFindings,
    summary: {
      pages: pages.length,
      obsidianUris: pages.filter((page) => page.obsidianUri).length + dashboardLinks.filter((link) => link.obsidianUri).length,
      frontmatterComplete: pages.filter((page) => page.frontmatterStatus === "complete").length,
      frontmatterPartial: pages.filter((page) => page.frontmatterStatus === "partial").length,
      frontmatterMissing: pages.filter((page) => page.frontmatterStatus === "missing").length,
      linkWarnings: pages.filter((page) => page.linkHealthStatus !== "ok").length + dashboardLinks.filter((link) => link.status !== "ok").length,
      invalidPaths: invalidPathFindings.length
    },
    warnings
  };
}

function obsidianPageLinkView(input: {
  readonly row: WikiPageRowView;
  readonly selected?: WikiPageDetailView;
  readonly memoryRoot?: string;
  readonly vaultName: string;
  readonly healthFindings: readonly WikiHealthFindingView[];
}): ObsidianCompatibilityView["pages"][number] {
  const frontmatter = obsidianFrontmatterStatus(input.row);
  const pageFindings = input.healthFindings.filter((finding) =>
    finding.targetKind === "page" &&
    (finding.targetId === input.row.id || finding.targetId === input.row.slug)
  );
  const selectedMissingLinks = input.selected && (input.selected.id === input.row.id || input.selected.slug === input.row.slug)
    ? input.selected.missingOutboundLinks
    : [];
  const linkHealthStatus = obsidianPageLinkHealthStatus(input.row, pageFindings, selectedMissingLinks);
  return {
    id: input.row.id || input.row.slug,
    title: input.row.title,
    path: input.row.path,
    href: knowledgeHealthHref({ page: input.row.id || input.row.slug }),
    obsidianUri: obsidianOpenUri({
      memoryRoot: input.memoryRoot,
      vaultName: input.vaultName,
      path: input.row.path
    }),
    frontmatterStatus: frontmatter.status,
    frontmatterKeys: frontmatter.keys,
    linkHealthStatus,
    linkHealthDetail: obsidianPageLinkHealthDetail(input.row, pageFindings, selectedMissingLinks),
    sourceCoverageStatus: input.row.sourceCoverageStatus,
    showCommand: input.row.showCommand
  };
}

function obsidianFrontmatterStatus(row: WikiPageRowView): {
  readonly status: ObsidianFrontmatterStatus;
  readonly keys: readonly string[];
} {
  const keys = [
    ...(row.id ? ["id"] : []),
    ...(row.slug ? ["slug"] : []),
    ...(row.title ? ["title"] : []),
    ...(row.claimStatus ? ["claim_status"] : []),
    ...(row.sourceRefCount > 0 ? ["source_refs"] : [])
  ];
  if (!row.id && !row.slug) {
    return { status: "missing", keys };
  }
  if (row.id && row.slug && row.title && row.claimStatus && row.sourceRefCount > 0) {
    return { status: "complete", keys };
  }
  return { status: "partial", keys };
}

function obsidianPageLinkHealthStatus(
  row: WikiPageRowView,
  pageFindings: readonly WikiHealthFindingView[],
  missingOutboundLinks: readonly string[]
): ObsidianLinkHealthStatus {
  if (pageFindings.some((finding) => finding.severity === "danger") || row.sourceCoverageStatus === "missing") {
    return "danger";
  }
  if (pageFindings.length > 0 || missingOutboundLinks.length > 0 || row.sourceCoverageStatus !== "covered") {
    return "warning";
  }
  return "ok";
}

function obsidianPageLinkHealthDetail(
  row: WikiPageRowView,
  pageFindings: readonly WikiHealthFindingView[],
  missingOutboundLinks: readonly string[]
): string {
  const details = [
    ...pageFindings.map((finding) => finding.title),
    ...(missingOutboundLinks.length > 0 ? [`Missing wikilinks: ${missingOutboundLinks.join(", ")}`] : []),
    ...(row.sourceCoverageStatus !== "covered" ? [`Source coverage is ${row.sourceCoverageStatus}`] : [])
  ];
  return details.length > 0 ? details.join(". ") : "Wiki links, source coverage, and dashboard navigation are healthy.";
}

function vaultDashboardLinks(input: {
  readonly workspaceRoot: string;
  readonly memoryRoot?: string;
  readonly vaultName: string;
  readonly invalidPathFindings: readonly VaultInvalidPathFindingView[];
}): readonly VaultDashboardLinkView[] {
  const links: readonly Omit<VaultDashboardLinkView, "obsidianUri" | "status" | "detail">[] = [
    {
      id: "vault-index",
      title: "Vault index",
      kind: "dashboard",
      path: memoryDisplayPath(input.workspaceRoot, input.memoryRoot, "index.md"),
      href: "/repo"
    },
    {
      id: "wiki-index",
      title: "Wiki index",
      kind: "wiki",
      path: memoryDisplayPath(input.workspaceRoot, input.memoryRoot, "wiki/index.md"),
      href: "/knowledge"
    },
    {
      id: "raw-index",
      title: "Raw source index",
      kind: "raw",
      path: memoryDisplayPath(input.workspaceRoot, input.memoryRoot, "raw/index.jsonl"),
      href: "/knowledge"
    },
    {
      id: "work-queue",
      title: "Work queue dashboard",
      kind: "dashboard",
      path: memoryDisplayPath(input.workspaceRoot, input.memoryRoot, "dashboards/Work Queue.md"),
      href: "/work"
    },
    {
      id: "report-artifacts",
      title: "Static report artifacts",
      kind: "reports",
      path: ".boreal/results",
      href: "/reports"
    }
  ];
  const invalidPaths = new Set(input.invalidPathFindings.map((finding) => finding.path));
  return links.map((link) => {
    const invalid = invalidPaths.has(link.path) || invalidPaths.has(vaultPathWithoutMemoryPrefix(link.path));
    const obsidianUri = link.path.startsWith(".boreal/")
      ? undefined
      : obsidianOpenUri({ memoryRoot: input.memoryRoot, vaultName: input.vaultName, path: link.path });
    return {
      ...link,
      obsidianUri,
      status: invalid ? "danger" : "ok",
      detail: invalid ? "Doctor reports this vault path has the wrong type." : "Local dashboard link remains available without Obsidian."
    };
  });
}

function vaultInvalidPathFindingsFromDoctor(data: unknown): readonly VaultInvalidPathFindingView[] {
  const diagnostics = isRecord(data) && Array.isArray(data.diagnostics) ? data.diagnostics : [];
  return diagnostics.flatMap((diagnostic): readonly VaultInvalidPathFindingView[] => {
    if (!isRecord(diagnostic) || stringField(diagnostic, "code", "") !== "vault.structure") {
      return [];
    }
    const details = diagnostic.details;
    if (!isRecord(details) || !Array.isArray(details.invalidPaths)) {
      return [];
    }
    return details.invalidPaths.flatMap((entry): readonly VaultInvalidPathFindingView[] => {
      if (!isRecord(entry)) {
        return [];
      }
      const path = stringField(entry, "path", "");
      const kind = stringField(entry, "kind", "directory") === "file" ? "file" : "directory";
      if (!path) {
        return [];
      }
      return [{
        id: `vault.structure.invalid_path:${path}`,
        path,
        expectedKind: kind,
        doctorCode: "vault.structure",
        severity: "danger",
        detail: `Expected ${kind} at ${path}, but doctor reports that path has the wrong type.`,
        command: "bwrk doctor --json"
      }];
    });
  });
}

function memoryDisplayPath(workspaceRoot: string, memoryRoot: string | undefined, relativePath: string): string {
  if (!memoryRoot) {
    return `memory/${relativePath}`;
  }
  return relative(workspaceRoot, join(memoryRoot, relativePath)) || relativePath;
}

function obsidianOpenUri(input: {
  readonly memoryRoot?: string;
  readonly vaultName: string;
  readonly path: string;
}): string | undefined {
  if (!input.memoryRoot) {
    return undefined;
  }
  const file = vaultPathForObsidian(input.memoryRoot, input.path);
  return `obsidian://open?vault=${encodeURIComponent(input.vaultName)}&file=${encodeURIComponent(file)}`;
}

function vaultPathForObsidian(memoryRoot: string, path: string): string {
  const prefix = `${memoryRoot}/`;
  if (path.startsWith(prefix)) {
    return relative(memoryRoot, path);
  }
  if (path.startsWith("./memory/")) {
    return path.slice("./memory/".length);
  }
  return vaultPathWithoutMemoryPrefix(path);
}

function vaultPathWithoutMemoryPrefix(path: string): string {
  return path.startsWith("memory/") ? path.slice("memory/".length) : path;
}

async function loadReportsView(input: {
  readonly workspaceRoot: string;
  readonly generatedAt: string;
  readonly stale: boolean;
  readonly rawInbox: RawInboxView;
  readonly wikiExplorer: WikiExplorerView;
}): Promise<ReportsView> {
  const { artifacts, warnings } = await reportArtifacts(input.workspaceRoot, input.generatedAt);
  const staticExports = staticReportExports(input.stale);
  const knowledgeReport = staticKnowledgeReport({
    generatedAt: input.generatedAt,
    stale: input.stale,
    rawInbox: input.rawInbox,
    wikiExplorer: input.wikiExplorer,
    staticExports
  });
  return {
    generatedAt: input.generatedAt,
    artifacts,
    staticExports,
    knowledgeReport,
    summary: {
      artifactCount: artifacts.length,
      staleArtifacts: artifacts.filter((artifact) => artifact.stale).length,
      staticExportCount: staticExports.length,
      markdownArtifacts: artifacts.filter((artifact) => artifact.kind === "markdown").length,
      htmlArtifacts: artifacts.filter((artifact) => artifact.kind === "html").length
    },
    warnings
  };
}

async function reportArtifacts(workspaceRoot: string, generatedAt: string): Promise<{
  readonly artifacts: readonly ReportArtifactView[];
  readonly warnings: readonly string[];
}> {
  const resultsRoot = join(workspaceRoot, ".boreal", "results");
  try {
    const artifacts = await walkReportArtifacts({ workspaceRoot, resultsRoot, dir: resultsRoot, generatedAt, depth: 0 });
    return { artifacts: artifacts.slice(0, 50), warnings: [] };
  } catch (error) {
    if (isNodeErrorCode(error, "ENOENT")) {
      return { artifacts: [], warnings: ["No .boreal/results directory exists yet. Static exports will appear here after generation."] };
    }
    return { artifacts: [], warnings: [error instanceof Error ? error.message : String(error)] };
  }
}

async function walkReportArtifacts(input: {
  readonly workspaceRoot: string;
  readonly resultsRoot: string;
  readonly dir: string;
  readonly generatedAt: string;
  readonly depth: number;
}): Promise<readonly ReportArtifactView[]> {
  if (input.depth > 3) {
    return [];
  }
  const entries = await readdir(input.dir, { withFileTypes: true });
  const artifacts: ReportArtifactView[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name.startsWith(".")) {
      continue;
    }
    const absolutePath = join(input.dir, entry.name);
    if (entry.isDirectory()) {
      const stats = await stat(absolutePath);
      artifacts.push(reportArtifactView({
        workspaceRoot: input.workspaceRoot,
        absolutePath,
        kind: "directory",
        stats,
        generatedAt: input.generatedAt
      }));
      artifacts.push(...await walkReportArtifacts({
        ...input,
        dir: absolutePath,
        depth: input.depth + 1
      }));
      continue;
    }
    if (entry.isFile()) {
      const stats = await stat(absolutePath);
      artifacts.push(reportArtifactView({
        workspaceRoot: input.workspaceRoot,
        absolutePath,
        kind: reportArtifactKind(absolutePath),
        stats,
        generatedAt: input.generatedAt,
        preview: await reportArtifactPreview(absolutePath)
      }));
    }
  }
  return artifacts;
}

function reportArtifactView(input: {
  readonly workspaceRoot: string;
  readonly absolutePath: string;
  readonly kind: ReportArtifactKind;
  readonly stats: { readonly size: number; readonly mtime: Date; readonly mtimeMs: number };
  readonly generatedAt: string;
  readonly preview?: string;
}): ReportArtifactView {
  const displayPath = relative(input.workspaceRoot, input.absolutePath);
  const updatedAt = input.stats.mtime.toISOString();
  const generatedAtMs = Date.parse(input.generatedAt);
  return {
    id: `report:${displayPath.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "results"}`,
    title: basename(input.absolutePath),
    path: displayPath,
    kind: input.kind,
    bytes: input.kind === "directory" ? 0 : input.stats.size,
    updatedAt,
    stale: Number.isFinite(generatedAtMs) ? input.stats.mtimeMs < generatedAtMs - 1000 : false,
    preview: input.preview,
    openCommand: `open ${displayPath}`
  };
}

function reportArtifactKind(path: string): ReportArtifactKind {
  const extension = extname(path).toLowerCase();
  if (extension === ".html" || extension === ".htm") return "html";
  if (extension === ".md" || extension === ".markdown") return "markdown";
  if (extension === ".json" || extension === ".jsonl") return "json";
  if (extension === ".png" || extension === ".jpg" || extension === ".jpeg" || extension === ".gif" || extension === ".webp") return "image";
  if (extension === ".txt" || extension === ".log") return "text";
  return "other";
}

async function reportArtifactPreview(path: string): Promise<string | undefined> {
  const kind = reportArtifactKind(path);
  if (kind !== "html" && kind !== "markdown" && kind !== "json" && kind !== "text") {
    return undefined;
  }
  try {
    const body = await readFile(path, "utf8");
    return body.length > 1800 ? `${body.slice(0, 1800)}\n...` : body;
  } catch {
    return undefined;
  }
}

function staticReportExports(stale: boolean): readonly ReportsView["staticExports"][number][] {
  return [
    {
      id: "console-project",
      title: "Project dashboard HTML",
      route: "/",
      outFile: ".boreal/results/console-project.html",
      format: "html",
      command: "pnpm console:render -- --route / --mode live --out .boreal/results/console-project.html",
      stale,
      summary: "Static read-only project dashboard export generated from current runtime state."
    },
    {
      id: "console-knowledge",
      title: "Knowledge dashboard HTML",
      route: "/knowledge",
      outFile: ".boreal/results/console-knowledge.html",
      format: "html",
      command: "pnpm console:render -- --route /knowledge --mode live --out .boreal/results/console-knowledge.html",
      stale,
      summary: "Static read-only knowledge dashboard export with raw inbox, wiki, claims, decisions, and health findings."
    },
    {
      id: "console-reports",
      title: "Reports dashboard HTML",
      route: "/reports",
      outFile: ".boreal/results/console-reports.html",
      format: "html",
      command: "pnpm console:render -- --route /reports --mode live --out .boreal/results/console-reports.html",
      stale,
      summary: "Static read-only reports browser export with artifact freshness and reproduction commands."
    },
    {
      id: "project-markdown",
      title: "Project memory Markdown",
      route: "/reports",
      outFile: ".boreal/results/markdown-export",
      format: "markdown",
      command: "pnpm bwrk export markdown --out .boreal/results/markdown-export --json",
      stale,
      summary: "Markdown export command for reproducible project, work, and knowledge records."
    }
  ];
}

function staticKnowledgeReport(input: {
  readonly generatedAt: string;
  readonly stale: boolean;
  readonly rawInbox: RawInboxView;
  readonly wikiExplorer: WikiExplorerView;
  readonly staticExports: readonly ReportsView["staticExports"][number][];
}): ReportsView["knowledgeReport"] {
  const summary = {
    rawSources: input.rawInbox.summary.total,
    wikiPages: input.wikiExplorer.summary.total,
    claims: input.wikiExplorer.reviewSummary.claims,
    decisions: input.wikiExplorer.reviewSummary.decisions,
    healthFindings: input.wikiExplorer.healthSummary.findings
  };
  const commands = input.staticExports.map((item) => item.command);
  const markdown = [
    "# Knowledge Dashboard Static Report",
    "",
    `Generated: ${input.generatedAt}`,
    `State: ${input.stale ? "stale" : "fresh"}`,
    "",
    "## Summary",
    "",
    `- Raw sources: ${summary.rawSources}`,
    `- Wiki pages: ${summary.wikiPages}`,
    `- Claims: ${summary.claims}`,
    `- Decisions: ${summary.decisions}`,
    `- Health findings: ${summary.healthFindings}`,
    "",
    "## Health Findings",
    "",
    ...(
      input.wikiExplorer.healthFindings.length > 0
        ? input.wikiExplorer.healthFindings.map((finding) => `- ${finding.severity}: ${finding.code} (${finding.targetKind} ${finding.targetId}) - ${finding.detail}`)
        : ["- none"]
    ),
    "",
    "## Important Pages",
    "",
    ...(
      input.wikiExplorer.importantPages.length > 0
        ? input.wikiExplorer.importantPages.map((page) => `- ${page.title} (${page.truthStatus}, ${page.sourceCoverageStatus})`)
        : ["- none"]
    ),
    "",
    "## Reproduce",
    "",
    ...commands.map((command) => `- ${command}`)
  ].join("\n");
  return {
    title: "Knowledge Dashboard Static Report",
    generatedAt: input.generatedAt,
    stale: input.stale,
    markdown,
    commands,
    summary
  };
}

function buildRawContradictionReview(source: RawSourceDetailView, generatedAt: string): RawContradictionReviewView {
  const plan = buildRawIngestPlan(source, generatedAt);
  const runtimeSourcePlaceholder = "<source-id-from-source-add>";
  const conflictInputs = [
    ...plan.findings.filter((finding) => finding.severity !== "info").map((finding) => ({
      id: finding.id,
      severity: finding.severity === "danger" ? "high" as const : "medium" as const,
      title: finding.title,
      currentAssertion: "Existing memory or source state may already cover this raw material.",
      incomingAssertion: finding.detail,
      sourceRefs: finding.sourceRefs
    })),
    ...plan.mutations.flatMap((mutation) =>
      mutation.contradictions.map((contradiction, index) => ({
        id: `${mutation.id}:contradiction-${index + 1}`,
        severity: mutation.status === "blocked" ? "high" as const : "medium" as const,
        title: `${mutation.kind} review flag`,
        currentAssertion: mutation.summary,
        incomingAssertion: contradiction,
        sourceRefs: mutation.sourceRefs
      }))
    )
  ];
  const conflicts = conflictInputs.length > 0 ? conflictInputs : [
    {
      id: `${source.id}:no-conflict`,
      severity: "low" as const,
      title: "No contradiction detected",
      currentAssertion: "No existing conflict was detected from the available source metadata.",
      incomingAssertion: "Reviewer can still accept, reject, or supersede after source inspection.",
      sourceRefs: [source.id]
    }
  ];
  return {
    generatedAt,
    sourceId: source.id,
    conflicts: conflicts.map((conflict) => ({
      ...conflict,
      evidenceLinks: [
        { label: "Raw vault source", ref: source.id, command: source.retrievalCommand },
        { label: "Runtime source placeholder", ref: runtimeSourcePlaceholder }
      ],
      resolutionCommands: contradictionResolutionCommands(conflict.title, conflict.sourceRefs, runtimeSourcePlaceholder)
    })),
    summary: {
      total: conflicts.length,
      high: conflicts.filter((conflict) => conflict.severity === "high").length,
      medium: conflicts.filter((conflict) => conflict.severity === "medium").length,
      low: conflicts.filter((conflict) => conflict.severity === "low").length
    }
  };
}

function contradictionResolutionCommands(
  title: string,
  sourceRefs: readonly string[],
  runtimeSourceId: string
): RawContradictionReviewView["conflicts"][number]["resolutionCommands"] {
  void runtimeSourceId;
  const subject = title.trim() || "raw source contradiction";
  const workflowCommand = memoryWorkflowShowCommand("20-memory/contradiction-resolution.md");
  return [
    {
      action: "accept",
      label: "Accept incoming assertion",
      command: workflowCommand,
      auditTrail: `Routes accepted assertion review for ${sourceRefs.join(", ")} through ${subject}.`
    },
    {
      action: "reject",
      label: "Reject incoming assertion",
      command: workflowCommand,
      auditTrail: `Routes rejected assertion review for ${sourceRefs.join(", ")} through ${subject}.`
    },
    {
      action: "supersede",
      label: "Supersede with decision",
      command: workflowCommand,
      auditTrail: `Routes supersession review for ${sourceRefs.join(", ")} through ${subject}.`
    }
  ];
}

function buildRawIngestPlan(source: RawSourceDetailView, generatedAt: string): RawIngestPlanView {
  const runtimeSourcePlaceholder = "<source-id-from-source-add>";
  const sourceWorkflowCommand = memoryWorkflowShowCommand("20-memory/add-raw-source.md");
  const wikiWorkflowCommand = memoryWorkflowShowCommand("30-knowledge/create-wiki-page.md");
  const claimWorkflowCommand = memoryWorkflowShowCommand("30-knowledge/create-claim.md");
  const decisionWorkflowCommand = memoryWorkflowShowCommand("30-knowledge/capture-decision.md");
  const workWorkflowCommand = memoryWorkflowShowCommand("40-work/discovery-to-work.md");
  const findings = rawIngestFindings(source);
  const reviewNeeded = findings.some((finding) => finding.severity !== "info");
  const mutations: readonly RawIngestMutationView[] = [
    {
      id: `${source.id}:source`,
      kind: "source",
      title: "Create runtime knowledge source",
      summary: "Mirror the immutable raw vault source into runtime knowledge so claims and decisions can carry source refs.",
      status: source.uri ? "planned" : "needs_input",
      command: sourceWorkflowCommand,
      workflowPath: "20-memory/add-raw-source.md",
      workflowCommand: sourceWorkflowCommand,
      skillRef: "$boreal-raw-inbox",
      sourceRefs: [source.id],
      additions: ["runtime knowledge source", source.uri ?? source.id],
      contradictions: source.uri ? [] : ["Raw source has no URI; runtime source command uses the raw ID as a placeholder URI."]
    },
    {
      id: `${source.id}:wiki`,
      kind: "wiki",
      title: "Create source-backed wiki page",
      summary: "Draft a wiki entry linked directly to the raw source.",
      status: source.linkedPageCount > 0 ? "needs_input" : "planned",
      command: wikiWorkflowCommand,
      workflowPath: "30-knowledge/create-wiki-page.md",
      workflowCommand: wikiWorkflowCommand,
      skillRef: "$boreal-wiki-claim-decision",
      sourceRefs: [source.id],
      additions: ["wiki page", "source_refs entry"],
      contradictions: source.linkedPageCount > 0 ? [`Source is already linked to ${source.linkedPageCount} wiki page(s).`] : []
    },
    {
      id: `${source.id}:claim`,
      kind: "claim",
      title: "Create proposed claim",
      summary: "Capture the source summary as a proposed claim after runtime source creation.",
      status: "needs_input",
      command: claimWorkflowCommand,
      workflowPath: "30-knowledge/create-claim.md",
      workflowCommand: claimWorkflowCommand,
      skillRef: "$boreal-wiki-claim-decision",
      sourceRefs: [source.id, runtimeSourcePlaceholder],
      additions: ["proposed claim"],
      contradictions: ["Claim statement requires human wording before apply."]
    },
    {
      id: `${source.id}:decision`,
      kind: "decision",
      title: "Capture reviewed decision",
      summary: "Record any decision discovered during reconciliation.",
      status: "needs_input",
      command: decisionWorkflowCommand,
      workflowPath: "30-knowledge/capture-decision.md",
      workflowCommand: decisionWorkflowCommand,
      skillRef: "$boreal-wiki-claim-decision",
      sourceRefs: [source.id, runtimeSourcePlaceholder],
      additions: ["proposed decision"],
      contradictions: ["Decision text requires human review before apply."]
    },
    {
      id: `${source.id}:work`,
      kind: "work",
      title: "Create follow-up work",
      summary: "Promote unresolved source questions into tracked work.",
      status: reviewNeeded ? "needs_input" : "planned",
      command: workWorkflowCommand,
      workflowPath: "40-work/discovery-to-work.md",
      workflowCommand: workWorkflowCommand,
      skillRef: "$boreal-work-planning",
      sourceRefs: [`raw:${source.id}`],
      additions: ["ready work item"],
      contradictions: reviewNeeded ? ["Review findings should be resolved before creating follow-up work."] : []
    }
  ];
  return {
    sourceId: source.id,
    sourceTitle: source.title,
    generatedAt,
    mutations,
    findings,
    sourceLinks: [
      { label: "Raw vault source", ref: source.id, command: source.retrievalCommand },
      { label: "Runtime source placeholder", ref: runtimeSourcePlaceholder }
    ],
    applyCommands: uniqueStrings(mutations
      .filter((mutation) => mutation.status === "planned")
      .map((mutation) => mutation.workflowCommand ?? mutation.command))
  };
}

function rawIngestFindings(source: RawSourceDetailView): RawIngestPlanView["findings"] {
  const findings: RawIngestPlanView["findings"][number][] = [];
  if (source.linkedPageCount > 0) {
    findings.push(rawIngestFinding(source.id, "warning", "Existing wiki link", `This raw source is already linked to ${source.linkedPageCount} wiki page(s).`));
  }
  if (source.preview.status === "missing" || source.preview.status === "outside_workspace") {
    findings.push(rawIngestFinding(source.id, "danger", "Preview unavailable", source.preview.message));
  } else if (source.preview.status === "unsupported" || source.preview.status === "external") {
    findings.push(rawIngestFinding(source.id, "warning", "Manual source review needed", source.preview.message));
  } else if (source.preview.status === "truncated") {
    findings.push(rawIngestFinding(source.id, "warning", "Preview is partial", source.preview.message));
  }
  if (!source.summary) {
    findings.push(rawIngestFinding(source.id, "warning", "Missing source summary", "Claim and decision proposals need human wording before apply."));
  }
  if (findings.length === 0) {
    findings.push(rawIngestFinding(source.id, "info", "No review blockers", "No contradictions were detected from the available source metadata."));
  }
  return findings;
}

function rawIngestFinding(
  sourceId: string,
  severity: RawIngestFindingSeverity,
  title: string,
  detail: string
): RawIngestPlanView["findings"][number] {
  return {
    id: `${sourceId}:${title.toLowerCase().replace(/[^a-z0-9]+/gu, "-").replace(/^-+|-+$/gu, "")}`,
    severity,
    title,
    detail,
    sourceRefs: [sourceId]
  };
}

async function runNodeCli(input: {
  readonly workspaceRoot: string;
  readonly cliPath?: string;
  readonly cliCommand: string;
  readonly args: readonly string[];
}): Promise<string> {
  const executable = input.cliPath ? process.execPath : input.cliCommand;
  const args = input.cliPath ? [input.cliPath, ...input.args] : input.args;
  const result = await runBoundedProcess({
    command: executable,
    args,
    cwd: input.workspaceRoot,
    timeoutMs: 60_000,
    stdoutMaxBytes: 4 * 1024 * 1024,
    stderrMaxBytes: 1024 * 1024
  });
  const out = result.stdout.text;
  const err = result.stderr.text;
  if (result.exitCode === 0) {
    return out;
  }
  const jsonPayload = firstJsonPayload(out, err);
  if (jsonPayload) {
    return jsonPayload;
  }
  throw new Error(err.trim() || out.trim() || `bwrk exited with ${result.exitCode ?? "unknown"}`);
}

function firstJsonPayload(...candidates: readonly string[]): string | undefined {
  for (const candidate of candidates) {
    const payload = firstCompleteJsonObject(candidate);
    if (payload) {
      return payload;
    }
  }
  return undefined;
}

function firstCompleteJsonObject(text: string): string | undefined {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (start < 0) {
      if (char === "{") {
        start = index;
        depth = 1;
      }
      continue;
    }
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = inString;
      continue;
    }
    if (char === "\"") {
      inString = !inString;
      continue;
    }
    if (inString) {
      continue;
    }
    if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        const payload = text.slice(start, index + 1);
        try {
          JSON.parse(payload);
          return payload;
        } catch {
          start = -1;
          depth = 0;
        }
      }
    }
  }
  return undefined;
}

async function resolveCliData(output: string, workspaceRoot: string): Promise<unknown> {
  const parsed = parseJsonObject(output, "boreal CLI response");
  if (parsed.ok !== true) {
    throw new ConsoleCommandError(
      typeof parsed.code === "string" ? parsed.code : "BOREAL_COMMAND_FAILED",
      typeof parsed.message === "string" ? parsed.message : "Boreal CLI response was not ok",
      isRecord(parsed.details) ? parsed.details : {}
    );
  }
  const data = parsed.data;
  if (isRecord(data) && data.truncated === true && typeof data.fullResultPath === "string") {
    const fullResultPath = resolve(workspaceRoot, data.fullResultPath);
    const resultsRoot = resolve(workspaceRoot, ".boreal", "results");
    if (!fullResultPath.startsWith(`${resultsRoot}/`)) {
      throw new ConsoleCommandError("CONSOLE_RESULT_PATH_OUT_OF_BOUNDS", "Spooled CLI result path is outside .boreal/results", {
        fullResultPath: data.fullResultPath
      });
    }
    const full = parseJsonObject(await readFile(fullResultPath, "utf8"), "boreal full result");
    if (full.ok !== true) {
      throw new Error("Boreal full result was not ok");
    }
    return withCliAgentDirectives(full.data, full);
  }
  return withCliAgentDirectives(data, parsed);
}

function withCliAgentDirectives(data: unknown, envelope: Record<string, unknown>): unknown {
  const bundles = envelope.agentDirectives;
  if (!Array.isArray(bundles) || !isRecord(data)) {
    return data;
  }
  return { ...data, agentDirectives: bundles };
}

async function cliArray<T>(runner: ConsoleCliRunner, args: readonly string[]): Promise<readonly T[]> {
  return cliData<readonly T[]>(runner, args);
}

async function cliData<T>(runner: ConsoleCliRunner, args: readonly string[]): Promise<T> {
  const data = await runner.run(args);
  validateConsoleCliContract(args, data);
  return data as T;
}

function parseJsonObject(text: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`${label} was not an object`);
  }
  return parsed;
}

interface WorkListRow {
  readonly id: string;
  readonly title: string;
  readonly status: string;
  readonly priority: string;
  readonly labels?: readonly string[];
}

interface ReservationListRow {
  readonly id: string;
  readonly status: string;
  readonly expired?: boolean;
  readonly agentId?: string;
  readonly workId: string;
  readonly reservedAt?: string;
  readonly expiresAt?: string;
  readonly purpose?: string;
}

interface SearchResultRow {
  readonly id: string;
  readonly type: string;
  readonly recordId: string;
  readonly title: string;
  readonly summary?: string;
  readonly score: number;
}

interface OperationListRow {
  readonly id: string;
  readonly sessionId: string;
  readonly commandPath: string;
  readonly status: string;
  readonly exitCode: number;
  readonly stateChanged: boolean;
  readonly generatedArtifactsChanged: boolean;
  readonly actorId: string;
  readonly actorKind?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly eventCount: number;
}

interface RawSourceListRow {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly tags?: readonly string[];
  readonly addedAt?: string;
  readonly actorId?: string;
  readonly contentHash?: string;
  readonly sourceBacked?: boolean;
  readonly immutable?: boolean;
  readonly processingStatus?: string;
  readonly linkedPageCount?: number;
  readonly retrievalCommand?: string;
  readonly previewCommand?: string;
}

interface RawSourceDetailRow extends RawSourceListRow {
  readonly linkedPages?: readonly unknown[];
  readonly preview?: unknown;
}

interface WikiPageListRow {
  readonly id: string;
  readonly slug: string;
  readonly title: string;
  readonly path: string;
  readonly sourceRefs?: readonly string[];
  readonly links?: readonly string[];
  readonly claimStatus?: string;
  readonly truthStatus?: string;
  readonly sourceRefCount?: number;
  readonly outboundLinkCount?: number;
  readonly backlinkCount?: number;
  readonly showCommand?: string;
}

interface WikiPageDetailRow extends WikiPageListRow {
  readonly backlinks?: readonly unknown[];
  readonly outboundPages?: readonly unknown[];
  readonly missingOutboundLinks?: readonly string[];
}

interface KnowledgeSourceListRow {
  readonly id: string;
  readonly kind: string;
  readonly title: string;
  readonly uri?: string;
}

interface ClaimListRow {
  readonly id: string;
  readonly status: string;
  readonly statement: string;
  readonly sources?: string | readonly string[];
  readonly sourceIds?: readonly string[];
  readonly evidence?: string | readonly string[];
  readonly evidenceIds?: readonly string[];
  readonly evidenceCount?: number;
  readonly reviewState?: string;
  readonly updatedAt?: string;
}

interface DecisionListRow {
  readonly id: string;
  readonly status: string;
  readonly title: string;
  readonly context?: string;
  readonly decision: string;
  readonly consequences?: readonly string[];
  readonly sources?: string | readonly string[];
  readonly sourceIds?: readonly string[];
  readonly reviewState?: string;
  readonly supersessionStatus?: string;
  readonly updatedAt?: string;
}

interface RegistryProjectRow {
  readonly id: string;
  readonly name: string;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: ProjectMemoryLayout;
  readonly memoryGitMode: ProjectMemoryGitMode;
  readonly memoryRemote?: string;
  readonly installRoot?: string;
  readonly source?: string;
  readonly lifecycle?: string;
  readonly lastSeenAt?: string;
}

interface ConsoleProjectOverview {
  readonly entry: DashboardProjectRegistryEntry;
  readonly settings: GlobalSettingsProjectInput;
  readonly work: readonly WorkItemView[];
  readonly searchResults: readonly SearchResultRow[];
  readonly activityRows: readonly OperationListRow[];
  readonly sync: SyncDashboardView;
  readonly locks: LockDashboardView;
}

function workViewFromRecord(data: unknown): WorkItemView {
  if (!isRecord(data)) {
    throw new Error("work show result was not an object");
  }
  return {
    id: stringField(data, "id", "unknown"),
    title: stringField(data, "title", "Untitled work"),
    kind: workKind(stringField(data, "kind", "task"), stringArrayField(data, "labels")),
    status: workStatus(stringField(data, "status", "blocked")),
    priority: workPriority(stringField(data, "priority", "normal")),
    labels: stringArrayField(data, "labels"),
    dependencyIds: stringArrayField(data, "dependencyIds"),
    activeBlockerIds: stringArrayField(data, "activeBlockerIds"),
    blockedBy: stringArrayField(data, "blockedBy"),
    evidenceCount: numberField(data, "evidenceCount"),
    verificationCount: numberField(data, "verificationCount"),
    requiredCloseoutGates: requiredCloseoutGatesView(data.requiredCloseoutGates),
    activeReservationId: typeof data.activeReservationId === "string" ? data.activeReservationId : undefined,
    contextSummary: typeof data.contextSummary === "string" ? data.contextSummary : undefined,
    directiveSummary: directiveSummaryFromBundles(data.agentDirectives)
  };
}

function workViewFromRow(row: WorkListRow): WorkItemView {
  const labels = Array.isArray(row.labels) ? row.labels.filter((label): label is string => typeof label === "string") : [];
  return {
    id: row.id,
    title: row.title,
    kind: workKind("", labels),
    status: workStatus(row.status),
    priority: workPriority(row.priority),
    labels,
    dependencyIds: [],
    activeBlockerIds: row.status === "blocked" ? ["unknown"] : [],
    blockedBy: row.status === "blocked" ? ["unknown"] : [],
    evidenceCount: 0,
    verificationCount: 0,
    requiredCloseoutGates: []
  };
}

function requiredCloseoutGatesView(value: unknown): WorkItemView["requiredCloseoutGates"] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter(isRecord) as unknown as NonNullable<WorkItemView["requiredCloseoutGates"]>;
}

function directiveSummaryFromBundles(value: unknown): WorkDirectiveSummaryView | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const items: WorkDirectiveItemView[] = [];
  const conflicts: WorkDirectiveConflictView[] = [];
  const missingRequired: WorkDirectiveMissingRequiredView[] = [];
  const blockerIds = new Set<string>();
  const sourceCommands = new Set<string>();
  for (const bundle of value) {
    if (!isRecord(bundle)) {
      continue;
    }
    const meta = isRecord(bundle.meta) ? bundle.meta : {};
    const bundleCommand = sourceCommandFromPath(stringField(meta, "commandPath", ""));
    const conflictReasons = directiveConflictReasons(bundle.conflicts);
    conflicts.push(...directiveConflictsFromBundle(bundle.conflicts));
    missingRequired.push(...directiveMissingRequiredFromBundle(bundle.missingRequired));
    const directives = Array.isArray(bundle.directives) ? bundle.directives : [];
    for (const directive of directives) {
      const item = directiveItemFromRecord(directive, bundleCommand, conflictReasons);
      if (!item) {
        continue;
      }
      items.push(item);
      if (item.sourceCommand) {
        sourceCommands.add(item.sourceCommand);
      }
      if (item.nextCommand) {
        sourceCommands.add(item.nextCommand);
      }
      for (const blockerId of blockerIdsFromDirective(directive)) {
        blockerIds.add(blockerId);
      }
    }
  }
  if (items.length === 0 && conflicts.length === 0 && missingRequired.length === 0) {
    return undefined;
  }
  const nextSteps = nextStepsFromDirectiveItems(items);
  const safeCommands = new Set(sourceCommands);
  for (const step of nextSteps) {
    if (step.command) {
      safeCommands.add(step.command);
    }
  }
  return {
    total: items.length,
    advisory: items.filter((item) => item.lane === "advisory").length,
    required: items.filter((item) => item.lane === "required").length,
    blocking: items.filter((item) => item.lane === "blocking").length,
    conflictCount: conflicts.length,
    missingRequiredCount: missingRequired.length,
    acknowledgementCount: items.filter((item) => item.acknowledgement).length,
    blockerIds: [...blockerIds],
    sourceCommands: [...sourceCommands],
    safeCommands: [...safeCommands],
    nextSteps,
    conflicts,
    missingRequired,
    items
  };
}

function directiveItemFromRecord(
  value: unknown,
  bundleCommand: string | undefined,
  conflicts: ReadonlyMap<string, string>
): WorkDirectiveItemView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = stringField(value, "id", "");
  const registryId = stringField(value, "registryId", "");
  if (!id || !registryId) {
    return undefined;
  }
  const data = isRecord(value.data) ? value.data : {};
  const severity = directiveSeverity(value.severity);
  const lane = directiveLane(severity);
  const commandPath = firstStringField(data, ["commandPath", "sourceCommand"]);
  const nextCommand = sourceCommandFromPath(firstStringField(data, ["nextCommandPath", "commandPath", "sourceCommand"]));
  const sourceCommand = sourceCommandFromPath(commandPath) ?? bundleCommand;
  const reason = directiveReason(value, data, conflicts.get(id));
  return {
    id,
    registryId,
    family: nonEmptyString(value.family),
    kind: nonEmptyString(value.kind),
    title: stringField(value, "title", registryId),
    severity,
    lane,
    reason,
    sourceCommand,
    nextCommand,
    workflowRef: firstStringField(data, ["workflowRef"]),
    recoveryWorkflow: firstStringField(data, ["recoveryWorkflow"]),
    blocksCloseout: value.blocksCloseout === true,
    acknowledgement: directiveAcknowledgementFromRecord(value.acknowledgement),
    requiredInputs: stringArray(data.requiredInputs),
    relatedIds: relatedIdsFromDirective(value).slice(0, 12)
  };
}

function directiveAcknowledgementFromRecord(value: unknown): WorkDirectiveAcknowledgementView | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const requiredBefore = firstStringField(value, ["requiredBefore", "required_before"]);
  const message = firstStringField(value, ["message", "reason", "detail"]);
  if (!requiredBefore && !message) {
    return undefined;
  }
  return {
    requiredBefore: requiredBefore ?? "close",
    evidenceKind: firstStringField(value, ["evidenceKind", "evidence_kind"]),
    message: message ?? "Directive acknowledgement is required."
  };
}

function directiveConflictsFromBundle(value: unknown): readonly WorkDirectiveConflictView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry, index): readonly WorkDirectiveConflictView[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const directiveIds = stringArray(entry.directiveIds);
    const reason = stringField(entry, "reason", "");
    const resolution = stringField(entry, "resolution", "unknown");
    if (directiveIds.length === 0 && !reason) {
      return [];
    }
    const severity = directiveSeverity(entry.severity);
    return [{
      id: `directive-conflict-${index}-${directiveIds.join("-") || resolution}`,
      directiveIds,
      reason: reason || "Directive conflict requires review.",
      resolution,
      resolvedDirectiveId: nonEmptyString(entry.resolvedDirectiveId),
      severity,
      lane: directiveLane(severity)
    }];
  });
}

function directiveMissingRequiredFromBundle(value: unknown): readonly WorkDirectiveMissingRequiredView[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.flatMap((entry, index): readonly WorkDirectiveMissingRequiredView[] => {
    if (!isRecord(entry)) {
      return [];
    }
    const registryId = stringField(entry, "registryId", "");
    const requirement = stringField(entry, "requirement", "");
    const message = stringField(entry, "message", "");
    if (!registryId && !requirement && !message) {
      return [];
    }
    const subject = isRecord(entry.subject) ? entry.subject : {};
    return [{
      id: `directive-missing-${index}-${registryId || requirement || "required"}`,
      registryId: registryId || "unknown",
      family: nonEmptyString(entry.family),
      requirement: requirement || "unknown",
      message: message || "Required directive data is missing.",
      subjectId: nonEmptyString(subject.id),
      subjectType: nonEmptyString(subject.type)
    }];
  });
}

function nextStepsFromDirectiveItems(items: readonly WorkDirectiveItemView[]): readonly WorkDirectiveNextStepView[] {
  return items.flatMap((item): readonly WorkDirectiveNextStepView[] => {
    const workflowRef = item.workflowRef ?? item.recoveryWorkflow;
    if (!item.nextCommand && !workflowRef) {
      return [];
    }
    return [{
      id: `next-step-${item.id}`,
      title: item.title,
      lane: item.lane,
      command: item.nextCommand,
      workflowRef,
      reason: item.reason,
      relatedIds: item.relatedIds
    }];
  });
}

function directiveConflictReasons(value: unknown): ReadonlyMap<string, string> {
  const reasons = new Map<string, string>();
  if (!Array.isArray(value)) {
    return reasons;
  }
  for (const conflict of value) {
    if (!isRecord(conflict)) {
      continue;
    }
    const directiveId = firstStringField(conflict, ["directiveId", "id"]);
    const reason = firstStringField(conflict, ["reason", "message", "detail"]);
    if (directiveId && reason) {
      reasons.set(directiveId, reason);
    }
  }
  return reasons;
}

function directiveReason(
  directive: Record<string, unknown>,
  data: Record<string, unknown>,
  conflictReason: string | undefined
): string {
  if (conflictReason) {
    return conflictReason;
  }
  const acknowledgement = isRecord(directive.acknowledgement) ? directive.acknowledgement : {};
  return (
    firstStringField(acknowledgement, ["message", "reason", "detail"]) ??
    firstStringField(data, ["reason", "message", "detail", "summary"]) ??
    stringField(directive, "instruction", "Directive is active for this work item.")
  );
}

function directiveSeverity(value: unknown): WorkDirectiveSeverity {
  return value === "required" || value === "blocking" || value === "advisory" ? value : "advisory";
}

function directiveLane(severity: WorkDirectiveSeverity): WorkDirectiveLane {
  return severity;
}

function sourceCommandFromPath(commandPath: string | undefined): string | undefined {
  if (!commandPath) {
    return undefined;
  }
  if (commandPath.startsWith("bwrk ")) {
    return commandPath;
  }
  return commandPath.includes("--json") ? `bwrk ${commandPath}` : `bwrk ${commandPath} --json`;
}

function blockerIdsFromDirective(value: unknown): readonly string[] {
  if (!isRecord(value) || !isRecord(value.data)) {
    return [];
  }
  const ids = new Set<string>();
  for (const key of ["blockerIds", "blockedByIds", "openBlockerIds", "activeBlockerIds"]) {
    for (const id of stringArray(value.data[key])) {
      if (id.startsWith("bw_work_")) {
        ids.add(id);
      }
    }
  }
  return [...ids];
}

function relatedIdsFromDirective(value: Record<string, unknown>): readonly string[] {
  const ids = new Set<string>();
  const subject = isRecord(value.subject) ? value.subject : {};
  const subjectId = nonEmptyString(subject.id);
  if (subjectId && isBorealRecordId(subjectId)) {
    ids.add(subjectId);
  }
  collectRelatedIds(value.data, ids);
  return [...ids];
}

function collectRelatedIds(value: unknown, ids: Set<string>): void {
  if (typeof value === "string") {
    if (isBorealRecordId(value)) {
      ids.add(value);
    }
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectRelatedIds(entry, ids);
    }
    return;
  }
  if (!isRecord(value)) {
    return;
  }
  for (const entry of Object.values(value)) {
    collectRelatedIds(entry, ids);
  }
}

function isBorealRecordId(value: string): boolean {
  return /^bw_(work|gate|evidence|verification|summary|reservation)_[A-Za-z0-9]+$/.test(value);
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function rawSourceRowView(row: RawSourceListRow): RawSourceRowView {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    uri: row.uri,
    summary: row.summary,
    tags: Array.isArray(row.tags) ? row.tags.filter((tag): tag is string => typeof tag === "string") : [],
    addedAt: row.addedAt ?? "",
    actorId: row.actorId ?? "",
    contentHash: row.contentHash ?? "",
    sourceBacked: true,
    immutable: true,
    processingStatus: rawProcessingStatus(row.processingStatus),
    linkedPageCount: typeof row.linkedPageCount === "number" && Number.isFinite(row.linkedPageCount) ? row.linkedPageCount : 0,
    retrievalCommand: row.retrievalCommand ?? `bwrk raw show ${row.id} --json`,
    previewCommand: row.previewCommand ?? `bwrk raw show ${row.id} --preview-bytes 4096 --json`
  };
}

function rawSourceDetailView(row: RawSourceDetailRow): RawSourceDetailView {
  return {
    ...rawSourceRowView(row),
    linkedPages: Array.isArray(row.linkedPages) ? row.linkedPages.flatMap(rawLinkedPageView) : [],
    preview: rawSourcePreviewView(row.preview)
  };
}

function rawLinkedPageView(value: unknown): readonly RawLinkedPageView[] {
  if (!isRecord(value)) {
    return [];
  }
  const id = stringField(value, "id", "");
  const title = stringField(value, "title", "");
  const path = stringField(value, "path", "");
  if (!id && !title && !path) {
    return [];
  }
  return [{ id, title: title || path || id, path }];
}

function rawSourcePreviewView(value: unknown): RawSourcePreviewView {
  const record = isRecord(value) ? value : {};
  return {
    status: rawPreviewStatus(record.status),
    mediaType: rawPreviewMediaType(record.mediaType),
    message: stringField(record, "message", "No preview available."),
    uri: typeof record.uri === "string" ? record.uri : undefined,
    path: typeof record.path === "string" ? record.path : undefined,
    body: typeof record.body === "string" ? record.body : undefined,
    bytes: typeof record.bytes === "number" && Number.isFinite(record.bytes) ? record.bytes : undefined,
    totalBytes: typeof record.totalBytes === "number" && Number.isFinite(record.totalBytes) ? record.totalBytes : undefined,
    maxBytes: typeof record.maxBytes === "number" && Number.isFinite(record.maxBytes) ? record.maxBytes : 4096,
    truncated: record.truncated === true
  };
}

function wikiPageRowView(
  row: WikiPageListRow,
  rawRows: readonly RawSourceRowView[],
  runtimeSources: readonly WikiKnowledgeSourceView[],
  claims: readonly WikiClaimView[],
  decisions: readonly WikiDecisionView[]
): WikiPageRowView {
  const sourceRefs = stringArray(row.sourceRefs);
  const coverage = wikiSourceCoverage(sourceRefs, rawRows, runtimeSources);
  const sourceIds = wikiPageSourceIds(sourceRefs, coverage);
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    path: row.path,
    truthStatus: wikiTruthStatus(row.truthStatus ?? row.claimStatus),
    claimStatus: row.claimStatus,
    sourceRefCount: finiteNumber(row.sourceRefCount, sourceRefs.length),
    backlinkCount: finiteNumber(row.backlinkCount, 0),
    outboundLinkCount: finiteNumber(row.outboundLinkCount, stringArray(row.links).length),
    claimCount: claims.filter((claim) => sourceIdsOverlap(claim.sourceIds, sourceIds)).length,
    decisionCount: decisions.filter((decision) => sourceIdsOverlap(decision.sourceIds, sourceIds)).length,
    sourceCoverageStatus: coverage.status,
    showCommand: row.showCommand ?? `bwrk wiki show ${row.id || row.slug} --json`
  };
}

function wikiPageDetailView(
  row: WikiPageDetailRow,
  rawRows: readonly RawSourceRowView[],
  runtimeSources: readonly WikiKnowledgeSourceView[],
  claims: readonly WikiClaimView[],
  decisions: readonly WikiDecisionView[]
): WikiPageDetailView {
  const sourceRefs = stringArray(row.sourceRefs);
  const coverage = wikiSourceCoverage(sourceRefs, rawRows, runtimeSources);
  const sourceIds = wikiPageSourceIds(sourceRefs, coverage);
  return {
    ...wikiPageRowView(row, rawRows, runtimeSources, claims, decisions),
    sourceRefs,
    outboundLinks: stringArray(row.links),
    backlinks: Array.isArray(row.backlinks) ? row.backlinks.flatMap(wikiLinkedPageView) : [],
    outboundPages: Array.isArray(row.outboundPages) ? row.outboundPages.flatMap(wikiLinkedPageView) : [],
    missingOutboundLinks: stringArray(row.missingOutboundLinks),
    sourceCoverage: coverage,
    claims: claims.filter((claim) => sourceIdsOverlap(claim.sourceIds, sourceIds)),
    decisions: decisions.filter((decision) => sourceIdsOverlap(decision.sourceIds, sourceIds))
  };
}

function wikiSourceCoverage(
  sourceRefs: readonly string[],
  rawRows: readonly RawSourceRowView[],
  runtimeSources: readonly WikiKnowledgeSourceView[]
): WikiSourceCoverageView {
  const rawById = new Map(rawRows.map((row) => [row.id, row]));
  const runtimeById = new Map(runtimeSources.map((source) => [source.id, source]));
  const rawSources = sourceRefs.map((ref) => rawById.get(ref)).filter(isRawSourceRowView);
  const matchedRuntimeSources = uniqueById(
    sourceRefs.flatMap((ref) => {
      const exact = runtimeById.get(ref);
      const raw = rawById.get(ref);
      return [
        ...(exact ? [exact] : []),
        ...runtimeSources.filter((source) => raw?.uri && source.uri === raw.uri)
      ];
    })
  );
  const coveredRefs = sourceRefs.filter((ref) => rawById.has(ref) || runtimeById.has(ref) || matchedRuntimeSources.some((source) => source.id === ref));
  const missingRefs = sourceRefs.filter((ref) => !coveredRefs.includes(ref));
  return {
    status: wikiSourceCoverageStatus(sourceRefs, coveredRefs, missingRefs),
    sourceRefs,
    coveredRefs,
    missingRefs,
    rawSources,
    runtimeSources: matchedRuntimeSources
  };
}

function wikiSourceCoverageStatus(
  sourceRefs: readonly string[],
  coveredRefs: readonly string[],
  missingRefs: readonly string[]
): WikiSourceCoverageStatus {
  if (sourceRefs.length === 0) return "unbacked";
  if (missingRefs.length === 0) return "covered";
  if (coveredRefs.length > 0) return "partial";
  return "missing";
}

function wikiPageSourceIds(sourceRefs: readonly string[], coverage: WikiSourceCoverageView): ReadonlySet<string> {
  return new Set([...sourceRefs, ...coverage.runtimeSources.map((source) => source.id)]);
}

function wikiKnowledgeSourceView(row: KnowledgeSourceListRow): WikiKnowledgeSourceView {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    uri: row.uri
  };
}

function wikiClaimView(row: ClaimListRow): WikiClaimView {
  const evidenceIds = evidenceIdsFromRow(row);
  return {
    id: row.id,
    status: row.status,
    statement: row.statement,
    sourceIds: sourceIdsFromRow(row),
    evidenceIds,
    evidenceCount: finiteNumber(row.evidenceCount, evidenceIds.length),
    reviewState: row.reviewState ?? claimReviewState(row.status),
    updatedAt: row.updatedAt
  };
}

function wikiDecisionView(row: DecisionListRow): WikiDecisionView {
  return {
    id: row.id,
    status: row.status,
    title: row.title,
    context: row.context ?? "",
    decision: row.decision,
    consequences: stringArray(row.consequences),
    sourceIds: sourceIdsFromRow(row),
    reviewState: row.reviewState ?? decisionReviewState(row.status),
    supersessionStatus: row.supersessionStatus === "none" ? undefined : row.supersessionStatus,
    updatedAt: row.updatedAt
  };
}

function wikiLinkedPageView(value: unknown): readonly WikiLinkedPageView[] {
  if (!isRecord(value)) {
    return [];
  }
  const id = stringField(value, "id", "");
  const slug = stringField(value, "slug", "");
  const title = stringField(value, "title", "");
  const path = stringField(value, "path", "");
  if (!id && !slug && !title && !path) {
    return [];
  }
  return [{
    id,
    slug,
    title: title || slug || path || id,
    path,
    truthStatus: wikiTruthStatus(value.truthStatus)
  }];
}

function wikiTruthStatus(value: unknown): WikiTruthStatus {
  if (value === "accepted" || value === "proposed" || value === "rejected" || value === "stale") {
    return value;
  }
  return "draft";
}

function sourceIdsFromRow(row: { readonly sources?: string | readonly string[]; readonly sourceIds?: readonly string[] }): readonly string[] {
  if (Array.isArray(row.sourceIds)) {
    return row.sourceIds.filter((sourceId): sourceId is string => typeof sourceId === "string");
  }
  if (Array.isArray(row.sources)) {
    return row.sources.filter((sourceId): sourceId is string => typeof sourceId === "string");
  }
  if (typeof row.sources === "string") {
    return row.sources.split(",").map((source) => source.trim()).filter(Boolean);
  }
  return [];
}

function evidenceIdsFromRow(row: { readonly evidence?: string | readonly string[]; readonly evidenceIds?: readonly string[] }): readonly string[] {
  if (Array.isArray(row.evidenceIds)) {
    return row.evidenceIds.filter((evidenceId): evidenceId is string => typeof evidenceId === "string");
  }
  if (Array.isArray(row.evidence)) {
    return row.evidence.filter((evidenceId): evidenceId is string => typeof evidenceId === "string");
  }
  if (typeof row.evidence === "string") {
    return row.evidence.split(",").map((evidenceId) => evidenceId.trim()).filter(Boolean);
  }
  return [];
}

function claimReviewState(status: string): string {
  if (status === "proposed") return "needs_review";
  if (status === "stale") return "needs_refresh";
  return status;
}

function decisionReviewState(status: string): string {
  if (status === "proposed") return "needs_review";
  if (status === "superseded") return "superseded";
  return status;
}

function compareDecisionsForTimeline(left: WikiDecisionView, right: WikiDecisionView): number {
  return (
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
    decisionStatusRank(left.status) - decisionStatusRank(right.status) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function decisionStatusRank(status: string): number {
  if (status === "accepted") return 0;
  if (status === "proposed") return 1;
  if (status === "superseded") return 2;
  if (status === "rejected") return 3;
  return 4;
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function sourceIdsOverlap(left: readonly string[], right: ReadonlySet<string>): boolean {
  return left.some((sourceId) => right.has(sourceId));
}

function uniqueById<T extends { readonly id: string }>(rows: readonly T[]): readonly T[] {
  const byId = new Map<string, T>();
  for (const row of rows) {
    byId.set(row.id, row);
  }
  return [...byId.values()];
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function isRawSourceRowView(value: RawSourceRowView | undefined): value is RawSourceRowView {
  return Boolean(value);
}

function mergeWork(first: readonly WorkItemView[], second: readonly WorkItemView[]): readonly WorkItemView[] {
  const byId = new Map<string, WorkItemView>();
  for (const item of [...first, ...second]) {
    byId.set(item.id, item);
  }
  return [...byId.values()];
}

async function buildConsoleProjectOverviews(input: {
  readonly runner: ConsoleCliRunner;
  readonly workspaceRoot: string;
  readonly generatedAt: string;
  readonly registryList: unknown;
  readonly registryDoctor: unknown;
  readonly projectSetup: ProjectSetupMetadata;
  readonly currentWork: readonly WorkItemView[];
  readonly currentSync: SyncDashboardView;
  readonly currentFindings: readonly DashboardFinding[];
  readonly currentReservations: readonly ReservationListRow[];
  readonly currentSearchResults: readonly SearchResultRow[];
  readonly currentActivityRows: readonly OperationListRow[];
  readonly globalSearchQuery: string;
  readonly includeCurrentFallback?: boolean;
}): Promise<readonly ConsoleProjectOverview[]> {
  const registryRows = registryProjectRowsFromCli(input.registryList).filter((row) => row.lifecycle !== "archived" && row.lifecycle !== "paused");
  const registryFindings = registryFindingsByProject(input.registryDoctor);
  if (registryRows.length === 0 && input.includeCurrentFallback === false) {
    return [];
  }
  if (registryRows.length === 0) {
    return [
      currentProjectOverview({
        ...input,
        registryRow: undefined,
        registryFindings: []
      })
    ];
  }

  return Promise.all(
    registryRows.map(async (registryRow) => {
      const projectRoot = resolve(registryRow.projectRoot);
      const findings = registryFindings.get(registryRow.id) ?? [];
      if (projectRoot === input.workspaceRoot) {
        return currentProjectOverview({
          ...input,
          registryRow,
          registryFindings: findings
        });
      }
      return loadRegisteredProjectOverview(input.runner, registryRow, findings, input.generatedAt, input.globalSearchQuery);
    })
  );
}

async function loadRegisteredProjectOverview(
  runner: ConsoleCliRunner,
  registryRow: RegistryProjectRow,
  registryFindings: readonly DashboardFinding[],
  generatedAt: string,
  globalSearchQuery: string
): Promise<ConsoleProjectOverview> {
  const workspaceArg = ["--workspace", registryRow.projectRoot] as const;
  try {
    const [workRows, syncStatus, doctorResult, reservations, searchResults, activityRows] = await Promise.all([
      cliArray<WorkListRow>(runner, [...workspaceArg, "work", "list", "--limit", "250", "--json"]),
      cliData<unknown>(runner, [...workspaceArg, "sync", "status", "--json"]),
      cliData<unknown>(runner, [...workspaceArg, "doctor", "--json"]),
      cliArray<ReservationListRow>(runner, [...workspaceArg, "reservation", "list", "--status", "active", "--json"]),
      loadProjectSearchResults(runner, workspaceArg, globalSearchQuery),
      loadProjectActivityRows(runner, workspaceArg)
    ]);
    const sync = syncViewFromCli(syncStatus, registryRow.projectRoot, generatedAt);
    const findings = [...registryFindings, ...dashboardFindingsFromDoctor(doctorResult)];
    const work = workRows.map((row) => workViewFromRow(row));
    const locks = lockViewFromDoctor(doctorResult, registryRow.projectRoot, generatedAt);
    const entry = registryEntryFromMetrics({
        registryRow,
        generatedAt,
        work,
        sync,
        findings,
        activeReservationCount: reservations.length
    });
    return {
      entry,
      settings: settingsProjectFromRegistryRow(registryRow, entry),
      work,
      searchResults,
      activityRows,
      sync,
      locks
    };
  } catch (error) {
    const sync = syncViewFromFailure(registryRow.projectRoot, generatedAt);
    const entry = registryEntryFromMetrics({
        registryRow,
        generatedAt,
        work: [],
        sync,
        findings: [
          ...registryFindings,
          {
            code: "console.registry_project_unreadable",
            title: "console.registry_project_unreadable",
            severity: "error",
            status: "failed",
            message: error instanceof Error ? error.message : String(error),
            actions: []
          }
        ],
        activeReservationCount: 0
    });
    return {
      entry,
      settings: settingsProjectFromRegistryRow(registryRow, entry),
      work: [],
      searchResults: [],
      activityRows: [],
      sync,
      locks: { generatedAt, ok: true, workspaceRoot: registryRow.projectRoot, locks: [] }
    };
  }
}

function currentProjectOverview(input: {
  readonly workspaceRoot: string;
  readonly generatedAt: string;
  readonly projectSetup: ProjectSetupMetadata;
  readonly currentWork: readonly WorkItemView[];
  readonly currentSync: SyncDashboardView;
  readonly currentFindings: readonly DashboardFinding[];
  readonly currentReservations: readonly ReservationListRow[];
  readonly currentSearchResults: readonly SearchResultRow[];
  readonly currentActivityRows: readonly OperationListRow[];
  readonly registryRow?: RegistryProjectRow;
  readonly registryFindings: readonly DashboardFinding[];
}): ConsoleProjectOverview {
  const registryRow = input.registryRow ?? {
    id: basename(input.workspaceRoot),
    name: basename(input.workspaceRoot),
    projectRoot: input.projectSetup.projectRoot ?? input.workspaceRoot,
    memoryRoot: input.projectSetup.memoryRoot ?? join(input.workspaceRoot, "memory"),
    memoryLayout: input.projectSetup.memoryLayout,
    memoryGitMode: input.projectSetup.memoryGitMode,
    memoryRemote: input.projectSetup.memoryRemote,
    source: "project-setup",
    lastSeenAt: input.generatedAt
  };
  const entry = registryEntryFromMetrics({
    registryRow,
    generatedAt: input.generatedAt,
    work: input.currentWork,
    sync: input.currentSync,
    findings: [...input.registryFindings, ...input.currentFindings],
    activeReservationCount: input.currentReservations.length
  });
  return {
    entry,
    settings: settingsProjectFromRegistryRow(registryRow, entry),
    work: input.currentWork,
    searchResults: input.currentSearchResults,
    activityRows: input.currentActivityRows,
    sync: input.currentSync,
    locks: lockViewFromDoctor(
      { diagnostics: [...input.registryFindings, ...input.currentFindings] },
      registryRow.projectRoot,
      input.generatedAt
    )
  };
}

function registryEntryFromMetrics(input: {
  readonly registryRow: RegistryProjectRow;
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
    id: input.registryRow.id,
    name: input.registryRow.name,
    projectRoot: input.registryRow.projectRoot,
    memoryRoot: input.registryRow.memoryRoot,
    memoryLayout: input.registryRow.memoryLayout,
    memoryGitMode: input.registryRow.memoryGitMode,
    installRoot: input.registryRow.installRoot,
    health: projectHealthState(input.sync.ok, input.findings),
    stale,
    syncFreshness,
    openWorkCount,
    readyWorkCount,
    blockedWorkCount,
    activeReservationCount: input.activeReservationCount,
    findings: input.findings,
    lastSeenAt: input.registryRow.lastSeenAt ?? input.generatedAt
  };
}

function registryProjectRowsFromCli(data: unknown): readonly RegistryProjectRow[] {
  if (!isRecord(data) || !Array.isArray(data.entries)) {
    return [];
  }
  return data.entries.flatMap((entry): readonly RegistryProjectRow[] => {
    if (!isRecord(entry) || !isRecord(entry.display)) {
      return [];
    }
    const id = stringField(entry, "id", "");
    const name = stringField(entry.display, "name", "");
    const projectRoot = stringField(entry, "projectRoot", "");
    const memoryRoot = stringField(entry, "memoryRoot", "");
    if (!id || !name || !projectRoot || !memoryRoot) {
      return [];
    }
    return [
      {
        id,
        name,
        projectRoot,
        memoryRoot,
        memoryLayout: projectMemoryLayout(entry.memoryLayout),
        memoryGitMode: projectMemoryGitMode(entry.memoryGitMode),
        memoryRemote: typeof entry.memoryRemote === "string" ? entry.memoryRemote : undefined,
        installRoot: typeof entry.installRoot === "string" ? entry.installRoot : undefined,
        source: typeof entry.source === "string" ? entry.source : undefined,
        lifecycle: typeof entry.lifecycle === "string" ? entry.lifecycle : undefined,
        lastSeenAt: typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : undefined
      }
    ];
  });
}

function settingsProjectFromRegistryRow(
  registryRow: RegistryProjectRow,
  entry: DashboardProjectRegistryEntry
): GlobalSettingsProjectInput {
  return {
    projectId: entry.id,
    projectName: entry.name,
    projectRoot: entry.projectRoot,
    memoryRoot: entry.memoryRoot,
    memoryLayout: entry.memoryLayout,
    memoryGitMode: entry.memoryGitMode,
    memoryRemote: registryRow.memoryRemote,
    installRoot: entry.installRoot,
    source: registryRow.source,
    health: entry.health,
    stale: entry.stale
  };
}

function registryFindingsByProject(data: unknown): ReadonlyMap<string, readonly DashboardFinding[]> {
  const byProject = new Map<string, DashboardFinding[]>();
  if (!isRecord(data) || !Array.isArray(data.findings)) {
    return byProject;
  }
  for (const finding of data.findings) {
    if (!isRecord(finding) || stringField(finding, "severity", "ok") === "ok") {
      continue;
    }
    const projectId = stringField(finding, "projectId", "registry");
    byProject.set(projectId, [
      ...(byProject.get(projectId) ?? []),
      {
        code: stringField(finding, "code", "registry.finding"),
        title: stringField(finding, "code", "registry.finding"),
        severity: dashboardSeverity(stringField(finding, "severity", "warning")),
        status: stringField(finding, "severity", "warning") === "error" ? "failed" : "warning",
        message: stringField(finding, "message", ""),
        source: diagnosticSourcePath(finding),
        actions: diagnosticRepairCommand(finding)
          ? [{ label: "Repair", command: diagnosticRepairCommand(finding) }]
          : []
      }
    ]);
  }
  return byProject;
}

function syncViewFromFailure(workspaceRoot: string, generatedAt: string): SyncDashboardView {
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

function projectHealthState(syncOk: boolean, findings: readonly DashboardFinding[]): ProjectHealthState {
  if (findings.some((finding) => finding.severity === "error")) {
    return "error";
  }
  if (!syncOk || findings.some((finding) => finding.severity === "warning")) {
    return "warning";
  }
  return "ok";
}

function isOpenWorkStatus(status: WorkItemView["status"]): boolean {
  return status !== "closed" && status !== "cancelled" && status !== "verified";
}

function syncViewFromCli(data: unknown, workspaceRoot: string, generatedAt: string): SyncDashboardView {
  const record = isRecord(data) ? data : {};
  const vault = isRecord(record.vault) ? record.vault : {};
  const ledgers = isRecord(record.ledgers) ? record.ledgers : {};
  const searchIndex = isRecord(record.searchIndex) ? record.searchIndex : {};
  const git = isRecord(record.git) ? record.git : {};
  const ok = booleanField(record, "ok");
  return {
    generatedAt,
    ok,
    workspaceRoot: stringField(record, "workspaceRoot", workspaceRoot),
    vaultOk: booleanField(vault, "ok"),
    ledgersOk: booleanField(ledgers, "ok"),
    searchIndexOk: booleanField(searchIndex, "ok"),
    gitOk: booleanField(git, "ok"),
    recommendedActions: stringArrayField(record, "recommendedActions").map((command) => ({ label: command, command })),
    findings: []
  };
}

function dashboardFindingsFromDoctor(data: unknown): readonly DashboardFinding[] {
  const diagnostics = isRecord(data) && Array.isArray(data.diagnostics) ? data.diagnostics : [];
  return diagnostics.flatMap((diagnostic): readonly DashboardFinding[] => {
    if (!isRecord(diagnostic)) {
      return [];
    }
    const severity = dashboardSeverity(stringField(diagnostic, "severity", "info"));
    if (severity === "info" && stringField(diagnostic, "code", "").startsWith("workspace.")) {
      return [];
    }
    return [
      {
        code: stringField(diagnostic, "code", "diagnostic"),
        title: stringField(diagnostic, "code", "diagnostic"),
        severity,
        status: severity === "error" ? "failed" : severity === "warning" ? "warning" : "ok",
        message: stringField(diagnostic, "message", ""),
        source: diagnosticSourcePath(diagnostic),
        actions: diagnosticRepairCommand(diagnostic)
          ? [{ label: "Repair", command: diagnosticRepairCommand(diagnostic) }]
          : []
      }
    ];
  });
}

function diagnosticSourcePath(diagnostic: Record<string, unknown>): string | undefined {
  const direct = firstStringField(diagnostic, ["path", "source", "workspaceRoot", "projectRoot"]);
  if (direct) {
    return direct;
  }
  const details = diagnostic.details;
  if (isRecord(details)) {
    return firstStringField(details, [
      "path",
      "configPath",
      "projectRoot",
      "workspaceRoot",
      "memoryRoot",
      "gitRoot",
      "rootDir",
      "statePath",
      "indexPath",
      "file"
    ]);
  }
  return undefined;
}

function diagnosticRepairCommand(diagnostic: Record<string, unknown>): string | undefined {
  if (typeof diagnostic.repairCommand === "string") {
    return diagnostic.repairCommand;
  }
  const details = diagnostic.details;
  return isRecord(details) && typeof details.repairCommand === "string" ? details.repairCommand : undefined;
}

function lockViewFromDoctor(data: unknown, workspaceRoot: string, generatedAt: string): LockDashboardView {
  const diagnostics = isRecord(data) && Array.isArray(data.diagnostics) ? data.diagnostics : [];
  const locks = diagnostics.flatMap((diagnostic) => {
    if (!isRecord(diagnostic)) {
      return [];
    }
    const code = stringField(diagnostic, "code", "");
    if (!code.startsWith("lock.")) {
      return [];
    }
    return [{
      domain: code,
      path: ".boreal/locks",
      status: stringField(diagnostic, "severity", "ok") === "ok" ? "clear" as const : "stale" as const,
      repairCommand: stringField(diagnostic, "severity", "ok") === "ok" ? undefined : "bwrk doctor --fix --json"
    }];
  });
  return {
    generatedAt,
    ok: locks.every((lock) => lock.status === "clear"),
    workspaceRoot,
    locks
  };
}

function memoryRootFromSync(data: unknown): string | undefined {
  if (!isRecord(data) || !isRecord(data.vault)) {
    return undefined;
  }
  return typeof data.vault.rootDir === "string" ? data.vault.rootDir : undefined;
}

interface ProjectSetupMetadata {
  readonly projectRoot?: string;
  readonly memoryRoot?: string;
  readonly memoryLayout: "in-repo" | "child" | "sibling";
  readonly memoryGitMode: "shared" | "separate" | "submodule";
  readonly memoryRemote?: string;
}

async function readProjectSetup(workspaceRoot: string): Promise<ProjectSetupMetadata> {
  try {
    const parsed = parseJsonObject(await readFile(join(workspaceRoot, ".boreal", "project.json"), "utf8"), "project setup");
    return {
      projectRoot: typeof parsed.projectRoot === "string" ? parsed.projectRoot : undefined,
      memoryRoot: typeof parsed.memoryRoot === "string" ? parsed.memoryRoot : undefined,
      memoryLayout: projectMemoryLayout(parsed.memoryLayout),
      memoryGitMode: projectMemoryGitMode(parsed.memoryGitMode),
      memoryRemote: typeof parsed.memoryRemote === "string" ? parsed.memoryRemote : undefined
    };
  } catch {
    return { memoryLayout: "in-repo", memoryGitMode: "separate" };
  }
}

function projectMemoryLayout(value: unknown): ProjectSetupMetadata["memoryLayout"] {
  return value === "child" || value === "sibling" || value === "in-repo" ? value : "in-repo";
}

function projectMemoryGitMode(value: unknown): ProjectSetupMetadata["memoryGitMode"] {
  return value === "shared" || value === "submodule" || value === "separate" ? value : "separate";
}

function workKind(value: string, labels: readonly string[]): WorkItemView["kind"] {
  if (value === "sprint" || labels.includes("sprint")) {
    return "sprint";
  }
  if (value === "milestone" || labels.includes("phase")) {
    return "milestone";
  }
  if (value === "issue" || value === "task") {
    return value;
  }
  return "task";
}

function workStatus(value: string): WorkItemView["status"] {
  if (
    value === "draft" ||
    value === "ready" ||
    value === "reserved" ||
    value === "in_progress" ||
    value === "blocked" ||
    value === "needs_verification" ||
    value === "verified" ||
    value === "closed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return "blocked";
}

function workPriority(value: string): WorkItemView["priority"] {
  if (value === "critical" || value === "high" || value === "normal" || value === "low") {
    return value;
  }
  return "normal";
}

function rawProcessingStatus(value: unknown): RawProcessingStatus {
  return value === "linked" ? "linked" : "queued";
}

function rawPreviewStatus(value: unknown): RawPreviewStatus {
  if (
    value === "available" ||
    value === "empty" ||
    value === "external" ||
    value === "missing" ||
    value === "outside_workspace" ||
    value === "truncated" ||
    value === "unsupported"
  ) {
    return value;
  }
  return "unsupported";
}

function rawPreviewMediaType(value: unknown): RawPreviewMediaType {
  if (
    value === "binary" ||
    value === "directory" ||
    value === "external" ||
    value === "missing" ||
    value === "none" ||
    value === "text"
  ) {
    return value;
  }
  return "none";
}

function dashboardSeverity(value: string): DashboardFinding["severity"] {
  if (value === "error" || value === "warning") {
    return value;
  }
  return "info";
}

function stringField(record: Record<string, unknown>, key: string, fallback: string): string {
  return typeof record[key] === "string" ? record[key] : fallback;
}

function stringArrayField(record: Record<string, unknown>, key: string): readonly string[] {
  const value = record[key];
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

function firstStringField(record: Record<string, unknown>, keys: readonly string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanField(record: Record<string, unknown>, key: string): boolean {
  return record[key] === true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

export function safeConsoleCommandIds(): readonly SafeConsoleCommandId[] {
  return SAFE_CONSOLE_COMMANDS.map((command) => command.id);
}
