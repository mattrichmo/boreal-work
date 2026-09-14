// Per-route loaders: `TuiRouteRequest -> Promise<TuiEnvelope<TBody>>`. No
// composite payload (see the v1 plan) -- each route fetches only what it
// needs, and Task Detail is fetched on demand (never preloaded for a whole
// list).

import { execFile } from "node:child_process";
import { basename } from "node:path";
import { promisify } from "node:util";

import {
  buildCommandDescriptor,
  buildRepoRollupView,
  buildSprintBoardView,
  buildTuiEnvelope,
  toWorkItemView,
  computeScopeIds,
  computeScopeProvenance,
  type GlobalWorkQueuesView,
  type ProjectRegistryView,
  type ProjectRegistryEntry,
  type RepoRollupSummary,
  type RepoRollupView,
  type RollupNodeView,
  type SprintBoardView,
  type TuiCommandDescriptor,
  type TuiEnvelope,
  type TuiEntityKind,
  type TuiLimits,
  type TuiRouteRequest,
  type TuiTruncation,
  type WorkItemView,
  type WorkReservationView
} from "@boreal/ui-model";
import type { AgentSummaryRecord, GraphEdge, WorkItem } from "@boreal/core";

import { activeReservationViewsByWorkId, invalidateRepoReadCache, readRepoTaskCloseoutRecords, readRepoWorkGraph, reservationViewFrom } from "./repo-store.js";
import { displayStatusForNode } from "./status-display.js";

export { invalidateRepoReadCache };

const execFileAsync = promisify(execFile);
const DASHBOARD_GLOBAL_SCHEMA_VERSION = "boreal.cli.dashboard.global.v1";
const GLOBAL_PAYLOAD_CACHE_TTL_MS = 1_500;
const globalPayloadCache = new Map<string, {
  readonly loadedAt: number;
  readonly payload?: DashboardGlobalPayload;
  readonly pending?: Promise<{ readonly payload?: DashboardGlobalPayload; readonly error?: string }>;
}>();

function tuiActorId(): string {
  return process.env.BOREAL_ACTOR ?? process.env.USER ?? "tui";
}

const TUI_CLAIM_PURPOSE = "Claim from Boreal TUI";

interface CliJsonOptions<T> {
  readonly expectedSchemaVersion?: string;
  readonly validate?: (value: unknown) => value is T;
  readonly signal?: AbortSignal;
}

async function runCliJson<T>(
  args: readonly string[],
  options: CliJsonOptions<T> = {}
): Promise<{ readonly data?: T; readonly error?: string }> {
  try {
    const { stdout } = await execFileAsync(process.env.BOREAL_TUI_CLI ?? "bwrk", [...args, "--json"], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
      killSignal: "SIGTERM",
      signal: options.signal
    });
    if (stdout.trim().length === 0) return { error: "CLI returned empty JSON output" };
    const parsed: unknown = JSON.parse(stdout);
    if (!isRecord(parsed)) return { error: "CLI returned a non-object JSON payload" };
    // `bwrk --json` emits the standard CLI envelope. Keep accepting the
    // unwrapped shape as well because fixture runners and older standalone
    // TUI shims used the inner payload directly.
    const payload: unknown = parsed.ok === true && "data" in parsed ? parsed.data : parsed;
    if (!isRecord(payload)) return { error: "CLI returned no JSON data payload" };
    if (options.expectedSchemaVersion && payload.schemaVersion !== options.expectedSchemaVersion) {
      return {
        error: `CLI schema mismatch: expected ${options.expectedSchemaVersion}, received ${typeof payload.schemaVersion === "string" ? payload.schemaVersion : "missing"}`
      };
    }
    if (options.validate && !options.validate(payload)) return { error: "CLI returned an invalid JSON payload" };
    return { data: payload as T };
  } catch (error) {
    if (!(error instanceof Error)) return { error: String(error) };
    const details = error as Error & { readonly code?: string | number; readonly signal?: string; readonly stderr?: string | Buffer };
    const suffix = [
      details.code !== undefined ? `exit: ${String(details.code)}` : undefined,
      details.signal ? `signal: ${details.signal}` : undefined,
      details.stderr ? `stderr: ${String(details.stderr).trimEnd()}` : undefined
    ].filter((value): value is string => Boolean(value));
    return { error: [details.message, ...suffix].join("\n") };
  }
}

// ---------------------------------------------------------------------------
// Global routes: spawn the CLI, same pattern as the legacy load.ts.
// ---------------------------------------------------------------------------

export interface DashboardGlobalPayload {
  readonly schemaVersion?: string;
  readonly generatedAt: string;
  readonly registry: ProjectRegistryView;
  readonly globalQueues: GlobalWorkQueuesView;
  readonly limits?: DashboardGlobalLimits;
  readonly truncated?: DashboardGlobalTruncation;
}

/** The CLI has a few global-only limit fields that the shared envelope does
 * not name yet. Keeping this extension preserves them at runtime without
 * breaking existing TUI envelope consumers. */
export interface DashboardGlobalLimits extends TuiLimits {
  readonly queueRowsPerQueue?: number;
  readonly searchPerProject?: number;
  readonly activityPerProject?: number;
  readonly rollupCacheTtlMs?: number;
}

export interface DashboardGlobalTruncation extends TuiTruncation {
  readonly queues?: boolean;
}

export class TuiCliLoadError extends Error {
  readonly code = "TUI_CLI_LOAD_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "TuiCliLoadError";
  }
}

function globalPayloadCacheKey(workspaceRoot: string): string {
  return `${process.env.BOREAL_TUI_CLI ?? "bwrk"}\u0000${process.env.BOREAL_PROJECT_REGISTRY_ROOT ?? ""}\u0000${workspaceRoot}`;
}

export function invalidateGlobalDashboardCache(workspaceRoot?: string): void {
  if (!workspaceRoot) {
    globalPayloadCache.clear();
    return;
  }
  const suffix = `\u0000${workspaceRoot}`;
  for (const key of globalPayloadCache.keys()) {
    if (key.endsWith(suffix)) globalPayloadCache.delete(key);
  }
}

async function loadDashboardGlobal(workspaceRoot: string, signal?: AbortSignal): Promise<{ readonly payload?: DashboardGlobalPayload; readonly error?: string }> {
  signal?.throwIfAborted();
  const key = globalPayloadCacheKey(workspaceRoot);
  const cached = globalPayloadCache.get(key);
  if (cached?.payload && Date.now() - cached.loadedAt < GLOBAL_PAYLOAD_CACHE_TTL_MS) return { payload: cached.payload };
  // A request tied to a route refresh must not join a shared pending request:
  // aborting that request would otherwise hand an AbortError to a successor
  // refresh that arrived just after navigation.
  if (cached?.pending && !signal) return cached.pending;

  const pending = (async () => {
    const result = await runCliJson<DashboardGlobalPayload>(["dashboard", "global", "--workspace", workspaceRoot, "--no-cache-write"], {
      expectedSchemaVersion: DASHBOARD_GLOBAL_SCHEMA_VERSION,
      validate: isDashboardGlobalPayload,
      signal
    });
    if (result.error) return { error: result.error };
    if (!result.data) return { error: "CLI returned no global dashboard payload" };
    if (!signal?.aborted) globalPayloadCache.set(key, { loadedAt: Date.now(), payload: result.data });
    return { payload: result.data };
  })();
  if (!signal) globalPayloadCache.set(key, { loadedAt: Date.now(), pending });
  try {
    return await pending;
  } finally {
    const current = globalPayloadCache.get(key);
    if (current?.pending === pending && !current.payload) globalPayloadCache.delete(key);
  }
}

export function isDashboardGlobalPayload(value: unknown): value is DashboardGlobalPayload {
  if (!isRecord(value) || typeof value.generatedAt !== "string") return false;
  const registry = value.registry;
  const queues = value.globalQueues;
  return isRecord(registry) && Array.isArray(registry.entries) && isRecord(registry.summary) &&
    isRecord(queues) && Array.isArray(queues.queues) && isRecord(queues.summary);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function requireDashboardGlobal(workspaceRoot: string, signal?: AbortSignal): Promise<DashboardGlobalPayload> {
  signal?.throwIfAborted();
  const { payload, error } = await loadDashboardGlobal(workspaceRoot, signal);
  signal?.throwIfAborted();
  if (!payload) throw new TuiCliLoadError(error ?? "CLI returned no dashboard payload");
  return payload;
}

function globalEnvelopeMetadata(payload: DashboardGlobalPayload): {
  readonly limits: DashboardGlobalLimits;
  readonly truncated: DashboardGlobalTruncation;
} {
  return { limits: payload.limits ?? {}, truncated: payload.truncated ?? {} };
}

export interface GlobalAttentionRow {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly projectMissing: boolean;
  readonly findingCode: string;
  readonly action?: {
    readonly label: string;
    readonly command?: string;
  };
  readonly severity: "info" | "warning" | "error";
  readonly title: string;
  readonly message: string;
}

export interface GlobalOverviewBody {
  readonly registrySummary: ProjectRegistryView["summary"];
  readonly queueSummary: GlobalWorkQueuesView["summary"];
  readonly attention: readonly GlobalAttentionRow[];
}

export function attentionRowsFrom(entries: readonly ProjectRegistryEntry[]): readonly GlobalAttentionRow[] {
  return entries.flatMap((entry) =>
    entry.findings
      .filter((finding) => finding.severity !== "info")
      .map((finding): GlobalAttentionRow => ({
        id: `${entry.id}:${finding.code}`,
        projectId: entry.id,
        projectName: entry.name,
        projectRoot: entry.projectRoot,
        projectMissing: entry.health === "missing" || entry.lifecycle === "missing",
        findingCode: finding.code,
        action: attentionAction(entry.projectRoot, finding.actions.find((action) => action.command || action.label)),
        severity: finding.severity,
        title: finding.title,
        message: finding.message
      }))
  ).sort((left, right) =>
    attentionSeverityRank(right.severity) - attentionSeverityRank(left.severity) ||
    left.projectName.localeCompare(right.projectName) ||
    left.title.localeCompare(right.title) ||
    left.id.localeCompare(right.id)
  );
}

function attentionSeverityRank(severity: GlobalAttentionRow["severity"]): number {
  return severity === "error" ? 3 : severity === "warning" ? 2 : 1;
}

function attentionAction(
  projectRoot: string,
  action: ProjectRegistryEntry["findings"][number]["actions"][number] | undefined
): GlobalAttentionRow["action"] {
  if (!action) return undefined;
  if (!action.command || action.command.startsWith("bwrk --workspace ")) return { label: action.label, command: action.command };
  if (action.command.startsWith("bwrk ")) {
    return { label: action.label, command: `bwrk --workspace ${JSON.stringify(projectRoot)} ${action.command.slice("bwrk ".length)}` };
  }
  return { label: action.label, command: action.command };
}

/** Pure transform from the `dashboard global --json` payload shape to the
 * Overview route body -- kept separate from the CLI spawn so fixture JSON
 * can be parsed and asserted on without shelling out in tests. */
export function globalOverviewBodyFromPayload(payload: DashboardGlobalPayload): GlobalOverviewBody {
  return {
    registrySummary: payload.registry.summary,
    queueSummary: payload.globalQueues.summary,
    attention: attentionRowsFrom(payload.registry.entries)
  };
}

export async function loadGlobalOverview(workspaceRoot: string, signal?: AbortSignal): Promise<TuiEnvelope<GlobalOverviewBody>> {
  const payload = await requireDashboardGlobal(workspaceRoot, signal);
  const metadata = globalEnvelopeMetadata(payload);
  return buildTuiEnvelope({
    surface: "global",
    workspaceRoot,
    generatedAt: payload.generatedAt,
    limits: metadata.limits,
    truncated: metadata.truncated,
    body: globalOverviewBodyFromPayload(payload)
  });
}

export async function loadGlobalProjects(workspaceRoot: string, signal?: AbortSignal): Promise<TuiEnvelope<ProjectRegistryView>> {
  const payload = await requireDashboardGlobal(workspaceRoot, signal);
  const metadata = globalEnvelopeMetadata(payload);
  return buildTuiEnvelope({
    surface: "global",
    workspaceRoot,
    generatedAt: payload.generatedAt,
    limits: metadata.limits,
    truncated: metadata.truncated,
    body: payload.registry
  });
}

export async function loadGlobalQueues(workspaceRoot: string, signal?: AbortSignal): Promise<TuiEnvelope<GlobalWorkQueuesView>> {
  const payload = await requireDashboardGlobal(workspaceRoot, signal);
  const metadata = globalEnvelopeMetadata(payload);
  return buildTuiEnvelope({
    surface: "global",
    workspaceRoot,
    generatedAt: payload.generatedAt,
    limits: metadata.limits,
    truncated: metadata.truncated,
    body: payload.globalQueues
  });
}

// ---------------------------------------------------------------------------
// Repo routes: direct store read (see repo-store.ts for why).
// ---------------------------------------------------------------------------

function rollupActionsForWork(
  workspaceRoot: string,
  work: WorkItem,
  reservation?: WorkReservationView
): readonly TuiCommandDescriptor[] {
  const subject = { kind: work.kind, id: work.meta.id, workspaceRoot, label: work.title };
  // The engine treats persisted active reservations as conflicts even after
  // their timestamp has passed, until the reservation lifecycle is repaired.
  if (work.status === "ready" && !reservation && !work.reservationId) {
    return [
      buildCommandDescriptor({
        id: `work.reserve:${work.meta.id}`,
        label: "Claim",
        workspaceRoot,
        subject,
        argv: ["--workspace", workspaceRoot, "work", "reserve", work.meta.id, "--agent", tuiActorId(), "--purpose", TUI_CLAIM_PURPOSE],
        effect: "write"
      })
    ];
  }
  return [];
}

function preferredReservationIds(items: readonly WorkItem[]): ReadonlyMap<string, string> {
  return new Map(
    items
      .filter((item): item is WorkItem & { readonly reservationId: string } => item.reservationId !== undefined)
      .map((item) => [item.meta.id, item.reservationId])
  );
}

export async function loadRepoRollup(workspaceRoot: string): Promise<TuiEnvelope<RepoRollupView>> {
  const generatedAt = new Date().toISOString();
  const graph = await readRepoWorkGraph(workspaceRoot);
  if (!graph.initialized) {
    return buildTuiEnvelope({
      surface: "repo",
      workspaceRoot,
      generatedAt,
      stale: true,
      warnings: ["Workspace is not set up. Run `bwrk install` in this directory."],
      body: buildRepoRollupView({ workspaceRoot, generatedAt, projectName: "(uninitialized)", work: [], graphEdges: [] })
    });
  }
  const reservationsByWorkId = activeReservationViewsByWorkId(graph.reservations, new Date(generatedAt), preferredReservationIds(graph.items));
  const body = buildRepoRollupView({
    workspaceRoot,
    generatedAt,
    projectName: basename(workspaceRoot) || workspaceRoot,
    work: graph.items,
    graphEdges: graph.graphEdges,
    reservationsByWorkId,
    actionsForWork: (work) => rollupActionsForWork(workspaceRoot, work, reservationsByWorkId.get(work.meta.id))
  });
  const warnings = [
    ...(body.warnings.length > 0
      ? [
        `Roll-up has ${body.warnings.length} unparented work item(s) matching multiple sprint scopes. Set an explicit parent with 'bwrk work edit <work-ref> --parent <sprint-ref>'.`
      ]
      : []),
    ...(graph.warning ? [graph.warning] : [])
  ];
  return buildTuiEnvelope({ surface: "repo", workspaceRoot, generatedAt, stale: graph.stale, body, warnings });
}

export type RepoNowLane = "in flight" | "attention" | "next";

export interface RepoNowRow {
  readonly id: string;
  readonly lane: RepoNowLane;
  readonly node: RollupNodeView;
  readonly milestoneId?: string;
  readonly milestoneTitle?: string;
  readonly sprintId?: string;
  readonly sprintTitle?: string;
}

export interface RepoNowScope {
  readonly kind: "milestone" | "sprint";
  readonly id: string;
  readonly title: string;
  readonly count: number;
}

export interface RepoNowBody {
  readonly currentSprint?: RepoSprintRow;
  readonly rows: readonly RepoNowRow[];
  readonly allRows?: readonly RepoNowRow[];
  readonly overflowCount: number;
  readonly workingCount: number;
  readonly attentionCount: number;
  readonly nextCount: number;
  readonly summary: RepoRollupSummary;
  readonly scopes?: readonly RepoNowScope[];
}

function leafWorkNodes(body: RepoRollupView): readonly RollupNodeView[] {
  return body.flatRows.filter((node) => node.childIds.length === 0 && (node.kind === "task" || node.kind === "issue"));
}

function nodeStatus(node: RollupNodeView): string {
  return node.workStatus ?? "draft";
}

function nowScopeForNode(node: RollupNodeView, byId: ReadonlyMap<string, RollupNodeView>): {
  readonly milestone?: RollupNodeView;
  readonly sprint?: RollupNodeView;
} {
  let parentId = node.parentId;
  const seen = new Set<string>();
  let milestone: RollupNodeView | undefined;
  let sprint: RollupNodeView | undefined;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (!parent) break;
    if (parent.kind === "milestone" && !milestone) milestone = parent;
    if (parent.kind === "sprint" && !sprint) sprint = parent;
    parentId = parent.parentId;
  }
  return { milestone, sprint };
}

/** The repo landing view is deliberately a bounded operational queue, not a
 * second hierarchy. It reuses the roll-up projection so all sections agree on
 * status, blockers, progress, and entity identity. */
export async function loadRepoNow(workspaceRoot: string): Promise<TuiEnvelope<RepoNowBody>> {
  const [rollup, sprintSummary] = await Promise.all([
    loadRepoRollup(workspaceRoot),
    loadRepoCurrentSprint(workspaceRoot)
  ]);
  const nodes = leafWorkNodes(rollup.body);
  const byId = new Map(rollup.body.flatRows.map((node) => [node.id, node]));
  const addScope = (node: RollupNodeView, lane: RepoNowLane): RepoNowRow => {
    const scope = nowScopeForNode(node, byId);
    return {
      id: `${lane}:${node.id}`,
      lane,
      node,
      ...(scope.milestone ? { milestoneId: scope.milestone.id, milestoneTitle: scope.milestone.title } : {}),
      ...(scope.sprint ? { sprintId: scope.sprint.id, sprintTitle: scope.sprint.title } : {})
    };
  };
  const inFlight = nodes.filter((node) => nodeStatus(node) === "in_progress" || nodeStatus(node) === "reserved");
  const attention = nodes.filter((node) =>
    !inFlight.includes(node) && (nodeStatus(node) === "blocked" || nodeStatus(node) === "needs_verification" || node.blockerSummary.activeBlockerCount > 0)
  );
  const next = nodes.filter((node) => nodeStatus(node) === "ready" && node.blockerSummary.activeBlockerCount === 0);
  const allRows: RepoNowRow[] = [
    ...inFlight.map((node) => addScope(node, "in flight")),
    ...attention.map((node) => addScope(node, "attention")),
    ...next.map((node) => addScope(node, "next"))
  ];
  // Keep Now useful as a triage screen. Work remains the exhaustive flat
  // queue, while Now reserves space for each operational lane.
  const rows: RepoNowRow[] = [
    ...allRows.filter((row) => row.lane === "in flight").slice(0, 8),
    ...allRows.filter((row) => row.lane === "attention").slice(0, 10),
    ...allRows.filter((row) => row.lane === "next").slice(0, 8)
  ];
  const currentSprint = sprintSummary.currentSprint;
  const scopeByKey = new Map<string, RepoNowScope>();
  for (const row of allRows) {
    for (const scope of [
      row.milestoneId && row.milestoneTitle ? { kind: "milestone" as const, id: row.milestoneId, title: row.milestoneTitle } : undefined,
      row.sprintId && row.sprintTitle ? { kind: "sprint" as const, id: row.sprintId, title: row.sprintTitle } : undefined
    ]) {
      if (!scope) continue;
      const key = `${scope.kind}:${scope.id}`;
      const existing = scopeByKey.get(key);
      scopeByKey.set(key, { ...scope, count: (existing?.count ?? 0) + 1 });
    }
  }
  const scopes = [...scopeByKey.values()].sort((left, right) => left.kind.localeCompare(right.kind) || left.title.localeCompare(right.title) || left.id.localeCompare(right.id));
  const warnings = [...new Set([...rollup.warnings, ...sprintSummary.warnings])];
  return buildTuiEnvelope({
    surface: "repo",
    workspaceRoot,
    generatedAt: rollup.generatedAt,
    stale: rollup.stale || sprintSummary.stale,
    warnings,
    body: {
      currentSprint,
      rows,
      allRows,
      overflowCount: allRows.length - rows.length,
      workingCount: inFlight.length,
      attentionCount: attention.length,
      nextCount: next.length,
      summary: rollup.body.summary,
      scopes
    }
  });
}

export interface RepoMilestoneTree {
  readonly root: RollupNodeView;
  readonly nodes: readonly RollupNodeView[];
}

export interface RepoMilestonesBody {
  readonly milestones: readonly RollupNodeView[];
  readonly summary: RepoRollupSummary;
  readonly warnings?: readonly string[];
  readonly trees?: readonly RepoMilestoneTree[];
}

export async function loadRepoMilestones(workspaceRoot: string): Promise<TuiEnvelope<RepoMilestonesBody>> {
  const envelope = await loadRepoRollup(workspaceRoot);
  const byId = new Map(envelope.body.flatRows.map((node) => [node.id, node]));
  const milestones = envelope.body.root.childIds
    .map((id) => byId.get(id))
    .filter((node): node is RollupNodeView => node?.kind === "milestone")
    .sort((left, right) => {
      const priority = (node: RollupNodeView): number => {
        const status = displayStatusForNode(node);
        return status === "blocked" ? 0 : status === "in_progress" || status === "needs_verification" || status === "reserved" ? 1 : status === "ready" ? 2 : status === "complete" ? 3 : 4;
      };
      return priority(left) - priority(right) || left.title.localeCompare(right.title);
    });
  const trees = milestones.map((root): RepoMilestoneTree => {
    const nodes: RollupNodeView[] = [];
    const seen = new Set<string>();
    const visit = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      const node = byId.get(id);
      if (!node) return;
      nodes.push(node);
      for (const childId of node.childIds) visit(childId);
    };
    for (const childId of root.childIds) visit(childId);
    return { root, nodes };
  });
  return buildTuiEnvelope({
    surface: "repo",
    workspaceRoot,
    generatedAt: envelope.generatedAt,
    stale: envelope.stale,
    warnings: envelope.warnings,
    body: { milestones, summary: envelope.body.summary, warnings: envelope.warnings, trees }
  });
}

export interface RepoWorkBody {
  readonly items: readonly RollupNodeView[];
  readonly summary: RepoRollupSummary;
}

export async function loadRepoWork(workspaceRoot: string): Promise<TuiEnvelope<RepoWorkBody>> {
  const envelope = await loadRepoRollup(workspaceRoot);
  return buildTuiEnvelope({
    surface: "repo",
    workspaceRoot,
    generatedAt: envelope.generatedAt,
    stale: envelope.stale,
    warnings: envelope.warnings,
    body: { items: leafWorkNodes(envelope.body), summary: envelope.body.summary }
  });
}

export interface RepoOpsReservationRow {
  readonly id: string;
  readonly workId: string;
  readonly title: string;
  readonly agentId: string;
  readonly status: string;
  readonly expiresAt?: string;
  readonly expired: boolean;
  readonly entity?: RollupNodeView["entity"];
}

export interface RepoOpsBody {
  readonly reservations: readonly RepoOpsReservationRow[];
  readonly historicalReservationCount: number;
  readonly warnings: readonly string[];
  readonly summary: RepoRollupSummary;
}

export async function loadRepoOps(workspaceRoot: string): Promise<TuiEnvelope<RepoOpsBody>> {
  const [rollup, graph] = await Promise.all([loadRepoRollup(workspaceRoot), readRepoWorkGraph(workspaceRoot)]);
  const byId = new Map(graph.items.map((item) => [item.meta.id, item]));
  const now = new Date(rollup.generatedAt);
  const allReservations = graph.reservations
    .map((reservation): RepoOpsReservationRow => {
      const view = reservationViewFrom(reservation, now);
      const work = byId.get(reservation.workId);
      return {
        id: reservation.meta.id,
        workId: reservation.workId,
        title: work?.title ?? reservation.workId,
        agentId: String(reservation.agentId),
        status: reservation.status === "active" && view.expired ? "expired" : reservation.status,
        expiresAt: reservation.expiresAt,
        expired: Boolean(view.expired),
        entity: work ? {
          kind: work.kind as RollupNodeView["entity"]["kind"],
          id: work.meta.id,
          workspaceRoot,
          label: work.title
        } : undefined
      };
    })
    .sort((left, right) => Number(right.status === "active") - Number(left.status === "active") || left.title.localeCompare(right.title));
  const reservations = allReservations.filter((reservation) => reservation.status === "active" || reservation.status === "expired");
  return buildTuiEnvelope({
    surface: "repo",
    workspaceRoot,
    generatedAt: rollup.generatedAt,
    stale: rollup.stale || graph.stale || !graph.initialized,
    warnings: [...rollup.warnings, ...(graph.warning ? [graph.warning] : [])],
    body: { reservations, historicalReservationCount: allReservations.length - reservations.length, warnings: rollup.warnings, summary: rollup.body.summary }
  });
}

export interface RepoSprintRow {
  readonly view: WorkItemView;
  readonly scopeCount: number;
  readonly doneCount?: number;
  readonly openCount?: number;
  readonly blockedCount?: number;
  readonly active: boolean;
}

export interface RepoSprintBoardBody {
  readonly sprints: readonly RepoSprintRow[];
  readonly activeSprintId?: string;
  readonly selectedSprintId?: string;
  readonly board?: SprintBoardView;
  readonly assignedWorkIds?: readonly string[];
  readonly dependencyWorkIds?: readonly string[];
}

interface RepoCurrentSprintSummary {
  readonly currentSprint?: RepoSprintRow;
  readonly stale?: boolean;
  readonly warnings: readonly string[];
}

/**
 * Now only needs the current sprint headline. Do not build every sprint board
 * and every scoped task just to render that one line; the full board remains
 * available when the operator opens Sprints or drills into a sprint.
 */
async function loadRepoCurrentSprint(workspaceRoot: string): Promise<RepoCurrentSprintSummary> {
  const graph = await readRepoWorkGraph(workspaceRoot);
  if (!graph.initialized) return { warnings: [] };
  const generatedAt = new Date().toISOString();
  const byId = new Map<string, WorkItem>(graph.items.map((item) => [item.meta.id, item]));
  const reservationsByWorkId = activeReservationViewsByWorkId(graph.reservations, new Date(generatedAt), preferredReservationIds(graph.items));
  const sprints = graph.items
    .filter((item) => item.kind === "sprint")
    .sort((left, right) => Number(right.meta.id === graph.activeSprintId) - Number(left.meta.id === graph.activeSprintId) || left.title.localeCompare(right.title));
  const sprint = sprints[0];
  if (!sprint) return { stale: graph.stale, warnings: graph.warning ? [graph.warning] : [] };
  const view = toWorkItemView({
    work: sprint,
    dependencies: graph.items,
    graphEdges: graph.graphEdges,
    reservation: reservationsByWorkId.get(sprint.meta.id)
  });
  const scope = computeScopeIds(sprint.meta.id, byId, graph.graphEdges);
  const scopedWork = graph.items.filter((work) => scope.has(work.meta.id) && work.meta.id !== sprint.meta.id);
  const doneCount = scopedWork.filter((work) => work.status === "closed" || work.status === "verified").length;
  return {
    currentSprint: {
      view,
      scopeCount: scope.size,
      doneCount,
      openCount: scopedWork.length - doneCount,
      blockedCount: scopedWork.filter((work) => work.status === "blocked").length,
      active: sprint.meta.id === graph.activeSprintId
    },
    stale: graph.stale,
    warnings: graph.warning ? [graph.warning] : []
  };
}

/** Selects only board members before the comparatively expensive view build. */
export function selectScopedWorkItems(workItems: readonly WorkItem[], scopeIds: ReadonlySet<string>): readonly WorkItem[] {
  return workItems.filter((work) => scopeIds.has(work.meta.id));
}

export async function loadRepoSprintBoard(
  workspaceRoot: string,
  selectedSprintId?: string
): Promise<TuiEnvelope<RepoSprintBoardBody>> {
  const generatedAt = new Date().toISOString();
  const graph = await readRepoWorkGraph(workspaceRoot);
  if (!graph.initialized) {
    return buildTuiEnvelope({
      surface: "repo",
      workspaceRoot,
      generatedAt,
      stale: true,
      warnings: ["Workspace is not set up. Run `bwrk install` in this directory."],
      body: { sprints: [] }
    });
  }
  const now = new Date(generatedAt);
  const byId = new Map<string, WorkItem>(graph.items.map((item) => [item.meta.id, item]));
  const reservationsByWorkId = activeReservationViewsByWorkId(graph.reservations, now, preferredReservationIds(graph.items));
  const activeProjectionSprintId = graph.activeSprintId;
  const sprintItems = graph.items.filter((item) => item.kind === "sprint");
  if (selectedSprintId && !sprintItems.some((sprint) => sprint.meta.id === selectedSprintId)) {
    throw new Error(`selected sprint ${selectedSprintId} was not found in this workspace`);
  }
  const sprints: RepoSprintRow[] = sprintItems
    .map((sprintItem) => {
      const view = toWorkItemView({
        work: sprintItem,
        dependencies: graph.items,
        graphEdges: graph.graphEdges,
        reservation: reservationsByWorkId.get(sprintItem.meta.id)
      });
      const scope = computeScopeIds(sprintItem.meta.id, byId, graph.graphEdges);
      const scopedWork = graph.items.filter((work) => scope.has(work.meta.id) && work.meta.id !== sprintItem.meta.id);
      const doneCount = scopedWork.filter((work) => work.status === "closed" || work.status === "verified").length;
      const blockedCount = scopedWork.filter((work) => work.status === "blocked").length;
      return {
        view,
        scopeCount: scope.size,
        doneCount,
        openCount: scopedWork.length - doneCount,
        blockedCount,
        active: sprintItem.meta.id === activeProjectionSprintId
      };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.view.title.localeCompare(b.view.title));

  // A workspace may contain sprints before it has an active-sprint
  // projection. Keep the section useful in that state by selecting the first
  // deterministic row rather than rendering an unreachable empty board.
  const target = selectedSprintId ?? activeProjectionSprintId ?? sprints[0]?.view.id;
  let board: SprintBoardView | undefined;
  let provenance: ReturnType<typeof computeScopeProvenance> | undefined;
  if (target) {
    const sprintItem = byId.get(target);
    if (sprintItem) {
      const sprintView = toWorkItemView({
        work: sprintItem,
        dependencies: graph.items,
        graphEdges: graph.graphEdges,
        reservation: reservationsByWorkId.get(target)
      });
      const scope = computeScopeIds(target, byId, graph.graphEdges);
      provenance = computeScopeProvenance(target, byId, graph.graphEdges);
      const scopedViews = selectScopedWorkItems(graph.items, scope)
        .map((work) => toWorkItemView({
          work,
          dependencies: graph.items,
          graphEdges: graph.graphEdges,
          reservation: reservationsByWorkId.get(work.meta.id)
        }));
      board = buildSprintBoardView({
        sprint: sprintView,
        work: scopedViews,
        reservations: graph.reservations
          .filter((reservation) => scope.has(reservation.workId))
          .map((reservation) => {
            const view = reservationViewFrom(reservation, now);
            return {
              id: reservation.meta.id,
              workId: reservation.workId,
              status: reservation.status === "active" && view.expired ? "expired" : reservation.status,
              agentId: reservation.agentId,
              reservedAt: reservation.reservedAt,
              expiresAt: reservation.expiresAt,
              expired: view.expired
            };
          }),
        generatedAt
      });
    }
  }

  return buildTuiEnvelope({
    surface: "repo",
    workspaceRoot,
    generatedAt,
    stale: graph.stale,
    warnings: graph.warning ? [graph.warning] : [],
    body: {
      sprints,
      activeSprintId: activeProjectionSprintId,
      selectedSprintId: target,
      board,
      ...(provenance ? {
        assignedWorkIds: [...provenance.assignedWorkIds],
        dependencyWorkIds: [...provenance.dependencyWorkIds]
      } : {})
    }
  });
}

export interface RepoTaskDetailBody {
  readonly work: WorkItemView;
  readonly dependencyTitles: readonly string[];
  readonly blockerTitles?: readonly string[];
  readonly actions: readonly TuiCommandDescriptor[];
  /**
   * Container descendants are kept separate from the prose detail so the
   * detail route can present a navigable work tree without replacing the
   * milestone description.
   */
  readonly hierarchy?: RepoTaskDetailHierarchy;
}

export interface RepoTaskDetailHierarchy {
  readonly root: RollupNodeView;
  readonly nodes: readonly RollupNodeView[];
  /**
   * Relationship edges are kept separate from the display tree. Roll-up
   * childIds intentionally combine containment, dependency, and blocker scope
   * membership, so the X-Ray pane must use the source graph to label those
   * links accurately.
   */
  readonly relations?: readonly RepoTaskDetailRelation[];
}

export interface RepoTaskDetailRelation {
  readonly id: string;
  readonly kind: "contains" | GraphEdge["kind"];
  readonly fromId: string;
  readonly toId: string;
  readonly fromTitle: string;
  readonly toTitle: string;
  readonly directed: boolean;
}

function taskDetailRelations(
  root: RollupNodeView,
  nodes: readonly RollupNodeView[],
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): readonly RepoTaskDetailRelation[] {
  const rollupById = new Map<string, RollupNodeView>([
    [root.id, root],
    ...nodes.map((node) => [node.id, node] as const)
  ]);
  const workById = new Map<string, WorkItem>(workItems.map((work) => [work.meta.id, work] as const));
  const hierarchyIds = new Set(rollupById.keys());
  const relations: RepoTaskDetailRelation[] = [];
  const seen = new Set<string>();
  const titleFor = (id: string): string => rollupById.get(id)?.title ?? workById.get(id)?.title ?? id;
  const add = (input: Omit<RepoTaskDetailRelation, "id">): void => {
    if (input.fromId === input.toId) return;
    const id = `${input.kind}:${input.fromId}:${input.toId}`;
    if (seen.has(id)) return;
    seen.add(id);
    relations.push({ ...input, id });
  };

  // Preserve the hierarchy's display order for containment edges. These are
  // derived from the rendered tree, not from mixed roll-up scope childIds.
  for (const parent of rollupById.values()) {
    for (const childId of parent.childIds) {
      if (!hierarchyIds.has(childId)) continue;
      add({
        kind: "contains",
        fromId: parent.id,
        toId: childId,
        fromTitle: parent.title,
        toTitle: titleFor(childId),
        directed: true
      });
    }
  }

  // Work dependencyIds are authoritative even when a legacy store has not
  // materialized a matching graph edge yet. Keep external dependencies visible
  // in X-Ray rather than silently hiding them from the hierarchy pane.
  for (const node of rollupById.values()) {
    const work = workById.get(node.id);
    if (!work) continue;
    for (const dependencyId of work.dependencyIds) {
      add({
        kind: "depends_on",
        fromId: node.id,
        toId: dependencyId,
        fromTitle: node.title,
        toTitle: titleFor(dependencyId),
        directed: true
      });
    }
  }

  // Include actual graph edges touching this detail scope, including edges to
  // work outside the containment tree. That makes the pane a relationship
  // view, not a second copy of the tree.
  for (const edge of graphEdges) {
    if (edge.fromType !== "work" || edge.toType !== "work") continue;
    if (!hierarchyIds.has(edge.fromId) && !hierarchyIds.has(edge.toId)) continue;
    add({
      kind: edge.kind,
      fromId: edge.fromId,
      toId: edge.toId,
      fromTitle: titleFor(edge.fromId),
      toTitle: titleFor(edge.toId),
      directed: edge.directed
    });
  }

  return relations;
}

function taskDetailHierarchy(
  body: RepoRollupView,
  workId: string,
  workItems: readonly WorkItem[],
  graphEdges: readonly GraphEdge[]
): RepoTaskDetailHierarchy | undefined {
  const root = body.flatRows.find((node) => node.id === workId);
  if (!root || root.childIds.length === 0) return undefined;
  const byId = new Map(body.flatRows.map((node) => [node.id, node]));
  const nodes: RollupNodeView[] = [];
  const seen = new Set<string>();
  const visit = (id: string): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = byId.get(id);
    if (!node) return;
    nodes.push(node);
    for (const childId of node.childIds) visit(childId);
  };
  for (const childId of root.childIds) visit(childId);
  return { root, nodes, relations: taskDetailRelations(root, nodes, workItems, graphEdges) };
}

function latestCloseoutSummary(
  summaries: readonly AgentSummaryRecord[],
  target: WorkItem
): AgentSummaryRecord | undefined {
  return summaries
    .filter((summary) =>
      (summary.status === "final" || summary.status === "forced") &&
      (summary.subjectType === "work" || summary.subjectType === target.kind)
    )
    .sort((left, right) => {
      const generated = right.generatedAt.localeCompare(left.generatedAt);
      if (generated !== 0) return generated;
      const updated = right.meta.updatedAt.localeCompare(left.meta.updatedAt);
      return updated !== 0 ? updated : right.meta.id.localeCompare(left.meta.id);
    })[0];
}

export async function loadRepoTaskDetail(
  workspaceRoot: string,
  workId: string,
  entityKind?: TuiEntityKind
): Promise<TuiEnvelope<RepoTaskDetailBody> | undefined> {
  const generatedAt = new Date().toISOString();
  const graph = await readRepoWorkGraph(workspaceRoot);
  const target = graph.items.find((item) => item.meta.id === workId);
  if (!target) return undefined;
  if (entityKind && entityKind !== "work" && entityKind !== target.kind) {
    throw new Error(`entity kind ${entityKind} does not match ${target.kind} work item ${workId}`);
  }
  const byId = new Map<string, WorkItem>(graph.items.map((item) => [item.meta.id, item]));
  const reservationsByWorkId = activeReservationViewsByWorkId(graph.reservations, new Date(generatedAt), preferredReservationIds(graph.items));
  const rollup = buildRepoRollupView({
    workspaceRoot,
    generatedAt,
    projectName: basename(workspaceRoot) || workspaceRoot,
    work: graph.items,
    graphEdges: graph.graphEdges,
    reservationsByWorkId,
    actionsForWork: (work) => rollupActionsForWork(workspaceRoot, work, reservationsByWorkId.get(work.meta.id))
  });
  const reservation = reservationsByWorkId.get(target.meta.id);
  const closeout = await readRepoTaskCloseoutRecords(workspaceRoot, target.meta.id);
  const view = toWorkItemView({
    work: target,
    dependencies: graph.items,
    graphEdges: graph.graphEdges,
    reservation,
    evidence: closeout.evidence,
    verifications: closeout.verifications,
    agentSummary: latestCloseoutSummary(closeout.summaries, target)
  });
  const dependencyTitles = target.dependencyIds.map((id) => byId.get(id)?.title ?? id);
  const blockerTitles = graph.graphEdges
    .filter((edge) => edge.kind === "blocks" && edge.fromType === "work" && edge.toType === "work" && edge.toId === target.meta.id)
    .map((edge) => byId.get(edge.fromId)?.title ?? edge.fromId);
  const subject = { kind: target.kind, id: target.meta.id, workspaceRoot, label: target.title };
  const actions: TuiCommandDescriptor[] = [];
  if (target.status === "ready" && !reservation && !target.reservationId) {
    actions.push(
      buildCommandDescriptor({
        id: `work.reserve:${target.meta.id}`,
        label: "Claim work",
        workspaceRoot,
        subject,
        argv: ["--workspace", workspaceRoot, "work", "reserve", target.meta.id, "--agent", tuiActorId(), "--purpose", TUI_CLAIM_PURPOSE],
        effect: "write"
      })
    );
  }
  if (target.status === "in_progress" || target.status === "reserved") {
    const reservationStateBroken = target.status === "reserved" && !reservation;
    actions.push(
      buildCommandDescriptor({
        id: `work.close:${target.meta.id}`,
        label: "Close work",
        workspaceRoot,
        subject,
        argv: ["--workspace", workspaceRoot, "work", "close", target.meta.id, "--reason", "closed from TUI"],
        effect: "danger",
        disabled: true,
        disabledReason: reservation?.expired
          ? "reservation is expired; repair or release it before finishing work"
          : reservation
            ? "reserved work must finish or release through the owning agent evidence flow"
            : target.reservationId
              ? "reservation state needs repair; run `bwrk doctor --fix` before finishing"
              : reservationStateBroken
                ? "reserved status has no active reservation; run `bwrk doctor --fix` before finishing"
                : "finish through `bwrk agent finish` after recording verification and closeout evidence"
      })
    );
  }
  return buildTuiEnvelope({
    surface: "repo",
    workspaceRoot,
    generatedAt,
    stale: graph.stale,
    warnings: graph.warning ? [graph.warning] : [],
    body: {
      work: view,
      dependencyTitles,
      blockerTitles,
      actions,
      hierarchy: taskDetailHierarchy(rollup, target.meta.id, graph.items, graph.graphEdges)
    }
  });
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------

export async function loadRoute(request: TuiRouteRequest, signal?: AbortSignal): Promise<TuiEnvelope<unknown>> {
  validateRouteRequest(request);
  switch (request.routeId) {
    case "global.overview":
      return loadGlobalOverview(request.workspaceRoot, signal);
    case "global.projects":
      return loadGlobalProjects(request.workspaceRoot, signal);
    case "global.queues":
      return loadGlobalQueues(request.workspaceRoot, signal);
    case "repo.rollup":
      return loadRepoRollup(request.workspaceRoot);
    case "repo.sprintBoard":
      return loadRepoSprintBoard(request.workspaceRoot, request.entity?.id);
    case "repo.taskDetail": {
      if (!request.entity?.id) throw new Error("repo.taskDetail requires an entity id");
      const envelope = await loadRepoTaskDetail(request.workspaceRoot, request.entity.id, request.entity.kind);
      if (!envelope) throw new Error(`work item ${request.entity.id} not found`);
      return envelope;
    }
    default:
      throw new Error(`no loader registered for route ${request.routeId}`);
  }
}

function validateRouteRequest(request: TuiRouteRequest): void {
  const routeSurface = request.routeId.startsWith("global.")
    ? "global"
    : request.routeId.startsWith("repo.")
      ? "repo"
      : undefined;
  if (routeSurface && request.surface !== routeSurface) {
    throw new Error(`${request.routeId} requires surface ${routeSurface}, received ${request.surface}`);
  }
  if (request.entity && request.entity.workspaceRoot !== request.workspaceRoot) {
    throw new Error(`entity workspace ${request.entity.workspaceRoot} does not match request workspace ${request.workspaceRoot}`);
  }
  switch (request.routeId) {
    case "repo.rollup":
      if (request.entity) throw new Error("repo.rollup does not accept an entity target");
      return;
    case "repo.sprintBoard":
      if (request.entity && request.entity.kind !== "sprint" && request.entity.kind !== "work") {
        throw new Error(`repo.sprintBoard requires a sprint entity, received ${request.entity.kind}`);
      }
      return;
    case "repo.taskDetail":
      if (!request.entity || !["milestone", "sprint", "task", "issue", "work"].includes(request.entity.kind)) {
        throw new Error("repo.taskDetail requires a milestone, sprint, task, issue, or generic work entity");
      }
      return;
    default:
      return;
  }
}
