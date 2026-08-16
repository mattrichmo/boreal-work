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
  type GlobalWorkQueuesView,
  type ProjectRegistryView,
  type ProjectRegistryEntry,
  type RepoRollupView,
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
import type { WorkItem } from "@boreal/core";

import { activeReservationViewsByWorkId, readRepoWorkGraph, reservationViewFrom } from "./repo-store.js";

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
}

async function runCliJson<T>(
  args: readonly string[],
  options: CliJsonOptions<T> = {}
): Promise<{ readonly data?: T; readonly error?: string }> {
  try {
    const { stdout } = await execFileAsync(process.env.BOREAL_TUI_CLI ?? "bwrk", [...args, "--json"], {
      maxBuffer: 32 * 1024 * 1024,
      timeout: 30_000,
      killSignal: "SIGTERM"
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

async function loadDashboardGlobal(workspaceRoot: string): Promise<{ readonly payload?: DashboardGlobalPayload; readonly error?: string }> {
  const key = globalPayloadCacheKey(workspaceRoot);
  const cached = globalPayloadCache.get(key);
  if (cached?.payload && Date.now() - cached.loadedAt < GLOBAL_PAYLOAD_CACHE_TTL_MS) return { payload: cached.payload };
  if (cached?.pending) return cached.pending;

  const pending = (async () => {
    const result = await runCliJson<DashboardGlobalPayload>(["dashboard", "global", "--workspace", workspaceRoot, "--no-cache-write"], {
      expectedSchemaVersion: DASHBOARD_GLOBAL_SCHEMA_VERSION,
      validate: isDashboardGlobalPayload
    });
    if (result.error) return { error: result.error };
    if (!result.data) return { error: "CLI returned no global dashboard payload" };
    globalPayloadCache.set(key, { loadedAt: Date.now(), payload: result.data });
    return { payload: result.data };
  })();
  globalPayloadCache.set(key, { loadedAt: Date.now(), pending });
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

async function requireDashboardGlobal(workspaceRoot: string): Promise<DashboardGlobalPayload> {
  const { payload, error } = await loadDashboardGlobal(workspaceRoot);
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

export async function loadGlobalOverview(workspaceRoot: string): Promise<TuiEnvelope<GlobalOverviewBody>> {
  const payload = await requireDashboardGlobal(workspaceRoot);
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

export async function loadGlobalProjects(workspaceRoot: string): Promise<TuiEnvelope<ProjectRegistryView>> {
  const payload = await requireDashboardGlobal(workspaceRoot);
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

export async function loadGlobalQueues(workspaceRoot: string): Promise<TuiEnvelope<GlobalWorkQueuesView>> {
  const payload = await requireDashboardGlobal(workspaceRoot);
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
  return buildTuiEnvelope({ surface: "repo", workspaceRoot, generatedAt, body });
}

export interface RepoSprintRow {
  readonly view: WorkItemView;
  readonly scopeCount: number;
  readonly active: boolean;
}

export interface RepoSprintBoardBody {
  readonly sprints: readonly RepoSprintRow[];
  readonly activeSprintId?: string;
  readonly selectedSprintId?: string;
  readonly board?: SprintBoardView;
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
  const views = graph.items.map((work) => toWorkItemView({
    work,
    dependencies: graph.items,
    graphEdges: graph.graphEdges,
    reservation: reservationsByWorkId.get(work.meta.id)
  }));
  const viewById = new Map(views.map((view) => [view.id, view]));
  const activeProjectionSprintId = graph.activeSprintId;
  const sprintItems = graph.items.filter((item) => item.kind === "sprint");
  if (selectedSprintId && !sprintItems.some((sprint) => sprint.meta.id === selectedSprintId)) {
    throw new Error(`selected sprint ${selectedSprintId} was not found in this workspace`);
  }
  const sprints: RepoSprintRow[] = sprintItems
    .map((sprintItem) => {
      const view = viewById.get(sprintItem.meta.id) ?? toWorkItemView({ work: sprintItem });
      const scope = computeScopeIds(sprintItem.meta.id, byId, graph.graphEdges);
      return { view, scopeCount: scope.size, active: sprintItem.meta.id === activeProjectionSprintId };
    })
    .sort((a, b) => Number(b.active) - Number(a.active) || a.view.title.localeCompare(b.view.title));

  // A workspace may contain sprints before it has an active-sprint
  // projection. Keep the section useful in that state by selecting the first
  // deterministic row rather than rendering an unreachable empty board.
  const target = selectedSprintId ?? activeProjectionSprintId ?? sprints[0]?.view.id;
  let board: SprintBoardView | undefined;
  if (target) {
    const sprintItem = byId.get(target);
    const sprintView = viewById.get(target);
    if (sprintItem && sprintView) {
      const scope = computeScopeIds(target, byId, graph.graphEdges);
      const scopedViews = views.filter((view) => scope.has(view.id));
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
    body: { sprints, activeSprintId: activeProjectionSprintId, selectedSprintId: target, board }
  });
}

export interface RepoTaskDetailBody {
  readonly work: WorkItemView;
  readonly dependencyTitles: readonly string[];
  readonly blockerTitles?: readonly string[];
  readonly actions: readonly TuiCommandDescriptor[];
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
  const reservation = reservationsByWorkId.get(target.meta.id);
  const view = toWorkItemView({
    work: target,
    dependencies: graph.items,
    graphEdges: graph.graphEdges,
    reservation
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
  return buildTuiEnvelope({ surface: "repo", workspaceRoot, generatedAt, body: { work: view, dependencyTitles, blockerTitles, actions } });
}

// ---------------------------------------------------------------------------
// Dispatch.
// ---------------------------------------------------------------------------

export async function loadRoute(request: TuiRouteRequest): Promise<TuiEnvelope<unknown>> {
  validateRouteRequest(request);
  switch (request.routeId) {
    case "global.overview":
      return loadGlobalOverview(request.workspaceRoot);
    case "global.projects":
      return loadGlobalProjects(request.workspaceRoot);
    case "global.queues":
      return loadGlobalQueues(request.workspaceRoot);
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
