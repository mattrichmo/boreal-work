import type { GraphEdge, WorkItem, WorkKind, WorkPriority, WorkStatus } from "@boreal/core";

import type { ProjectHealthState } from "./registry-view.js";
import type { WorkReservationView } from "./work-view.js";

// ---------------------------------------------------------------------------
// Shared shell contract (TUI_SURFACE_CONTRACTS.md "Shared Shell Contract").
// ---------------------------------------------------------------------------

export type TuiSurfaceKind = "global" | "repo";

export interface TuiLimits {
  readonly projects?: number;
  readonly workPerProject?: number;
  readonly rowsPerPage?: number;
  readonly searchResults?: number;
  readonly activityRows?: number;
  readonly treeNodes?: number;
}

export interface TuiTruncation {
  readonly projects?: boolean;
  readonly work?: boolean;
  readonly search?: boolean;
  readonly activity?: boolean;
  readonly tree?: boolean;
}

export interface TuiEnvelope<TBody> {
  readonly schemaVersion: string;
  readonly generatedAt: string;
  readonly surface: TuiSurfaceKind;
  readonly workspaceRoot: string;
  readonly stale: boolean;
  readonly warnings: readonly string[];
  readonly limits: TuiLimits;
  readonly truncated: TuiTruncation;
  readonly body: TBody;
}

export const TUI_ROUTE_ENVELOPE_SCHEMA_VERSION = "boreal.tui.route.v1";

export function buildTuiEnvelope<TBody>(input: {
  readonly surface: TuiSurfaceKind;
  readonly workspaceRoot: string;
  readonly generatedAt: string;
  readonly body: TBody;
  readonly stale?: boolean;
  readonly warnings?: readonly string[];
  readonly limits?: TuiLimits;
  readonly truncated?: TuiTruncation;
  readonly schemaVersion?: string;
}): TuiEnvelope<TBody> {
  return {
    schemaVersion: input.schemaVersion ?? TUI_ROUTE_ENVELOPE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    surface: input.surface,
    workspaceRoot: input.workspaceRoot,
    stale: input.stale ?? false,
    warnings: input.warnings ?? [],
    limits: input.limits ?? {},
    truncated: input.truncated ?? {},
    body: input.body
  };
}

// ---------------------------------------------------------------------------
// Shared navigation.
// ---------------------------------------------------------------------------

export type TuiEntityKind =
  | "project"
  | "workspace"
  | "milestone"
  | "sprint"
  | "task"
  | "issue"
  | "work"
  | "evidence"
  | "verification"
  | "agentSummary"
  | "event"
  | "operation"
  | "healthFinding"
  | "rawSource"
  | "wikiPage"
  | "claim"
  | "decision"
  | "report";

export interface TuiEntityRef {
  readonly kind: TuiEntityKind;
  readonly id: string;
  readonly projectId?: string;
  readonly projectName?: string;
  readonly projectRoot?: string;
  readonly workspaceRoot: string;
  readonly label: string;
}

export interface TuiNavFrame {
  readonly routeId: string;
  readonly title: string;
  readonly cursor: number;
  readonly entity?: TuiEntityRef;
  readonly filters?: TuiFilterState;
}

// ---------------------------------------------------------------------------
// Shared filtering.
// ---------------------------------------------------------------------------

export type TuiFilterOperator = "is" | "isNot" | "contains" | "before" | "after" | "empty" | "notEmpty";

export interface TuiFilterClause {
  readonly field: string;
  readonly operator: TuiFilterOperator;
  readonly value?: string;
}

export interface TuiSortSpec {
  readonly field: string;
  readonly direction: "asc" | "desc";
}

export interface TuiFilterState {
  readonly query?: string;
  readonly clauses: readonly TuiFilterClause[];
  readonly sort: readonly TuiSortSpec[];
  readonly showClosed?: boolean;
  readonly showCancelled?: boolean;
}

export function emptyFilterState(): TuiFilterState {
  return { clauses: [], sort: [] };
}

// ---------------------------------------------------------------------------
// Shared actions / command descriptors.
// ---------------------------------------------------------------------------

export type TuiActionEffect = "read" | "write" | "danger";

export interface TuiCommandDescriptor {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly workspaceRoot: string;
  readonly projectId?: string;
  readonly subject?: TuiEntityRef;
  readonly argv: readonly string[];
  readonly displayCommand: string;
  readonly effect: TuiActionEffect;
  readonly mutatesState: boolean;
  readonly requiresConfirmation: boolean;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly expectedSchemaVersion?: string;
}

/**
 * The one place a `TuiCommandDescriptor` gets constructed. `workspaceRoot` is
 * always required (never optional/derived at render time), and any `write`
 * or `danger` effect always requires confirmation regardless of caller input
 * -- callers cannot opt a mutating action out of the confirmation panel.
 */
export function buildCommandDescriptor(input: {
  readonly id: string;
  readonly label: string;
  readonly description?: string;
  readonly workspaceRoot: string;
  readonly projectId?: string;
  readonly subject?: TuiEntityRef;
  readonly argv: readonly string[];
  readonly bin?: string;
  readonly effect: TuiActionEffect;
  readonly disabled?: boolean;
  readonly disabledReason?: string;
  readonly expectedSchemaVersion?: string;
}): TuiCommandDescriptor {
  const bin = input.bin ?? "bwrk";
  const mutatesState = input.effect !== "read";
  return {
    id: input.id,
    label: input.label,
    description: input.description,
    workspaceRoot: input.workspaceRoot,
    projectId: input.projectId,
    subject: input.subject,
    argv: input.argv,
    displayCommand: [bin, ...input.argv].join(" "),
    effect: input.effect,
    mutatesState,
    requiresConfirmation: mutatesState,
    disabled: input.disabled,
    disabledReason: input.disabledReason,
    expectedSchemaVersion: input.expectedSchemaVersion
  };
}

// ---------------------------------------------------------------------------
// Route requests.
// ---------------------------------------------------------------------------

export interface TuiRouteRequest {
  readonly surface: TuiSurfaceKind;
  readonly workspaceRoot: string;
  readonly routeId: string;
  readonly entity?: TuiEntityRef;
  readonly filters?: TuiFilterState;
  readonly cursor?: string;
  readonly limit?: number;
}

// ---------------------------------------------------------------------------
// Global -> repo drill target.
// ---------------------------------------------------------------------------

export interface OpenRepoTarget {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly initialRoute?: string;
  readonly initialEntity?: TuiEntityRef;
  readonly returnToGlobalFrame: TuiNavFrame;
}

// ---------------------------------------------------------------------------
// Roll-up hierarchy (Repo Roll-Up page).
//
// `RollupNodeView.status` is split into `workStatus`/`health` fields per the
// v1 design decision (a WorkStatus | ProjectHealthState union loses type
// safety at the root/project node, which reports health, not work status).
// ---------------------------------------------------------------------------

export type RollupNodeKind = "project" | "milestone" | "sprint" | "task" | "issue";

export interface RollupProgressView {
  readonly total: number;
  readonly done: number;
  readonly open: number;
  readonly cancelled: number;
  readonly percentDone: number;
}

export interface RollupBlockerSummary {
  readonly activeBlockerCount: number;
  readonly blockedDescendantCount: number;
  readonly blockerIds: readonly string[];
}

export interface RollupNodeView {
  readonly id: string;
  readonly entity: TuiEntityRef;
  readonly kind: RollupNodeKind;
  readonly title: string;
  readonly workStatus?: WorkStatus;
  readonly health?: ProjectHealthState;
  readonly priority?: WorkPriority;
  readonly depth: number;
  readonly parentId?: string;
  readonly childIds: readonly string[];
  readonly expandedByDefault: boolean;
  readonly progress: RollupProgressView;
  readonly blockerSummary: RollupBlockerSummary;
  readonly reservation?: WorkReservationView;
  readonly labels: readonly string[];
  readonly stale: boolean;
  readonly actions: readonly TuiCommandDescriptor[];
}

export interface RepoRollupSummary {
  readonly totalNodes: number;
  readonly milestones: number;
  readonly sprints: number;
  readonly tasks: number;
  readonly open: number;
  readonly blocked: number;
  readonly needsVerification: number;
  readonly closed: number;
  readonly cancelled: number;
  readonly activeReservations: number;
}

export interface RepoRollupView {
  readonly generatedAt: string;
  readonly workspaceRoot: string;
  readonly root: RollupNodeView;
  readonly flatRows: readonly RollupNodeView[];
  readonly summary: RepoRollupSummary;
}

const TERMINAL_STATUSES = new Set<WorkStatus>(["verified", "closed", "cancelled"]);

/**
 * Same derivation the CLI's sprint scope traversal uses
 * (`apps/cli/src/commands/shared.ts#dependencyIdsForWork` /
 * `apps/tui/src/load.ts#childWorkIds`): a work item's scope children are its
 * `dependencyIds` plus anything that `blocks` it via a graph edge. Kept as a
 * single shared implementation so the roll-up tree, sprint board, and CLI
 * scope commands can't drift into two different membership definitions.
 */
export function childWorkIds(work: WorkItem, graphEdges: readonly GraphEdge[]): readonly string[] {
  const ids = new Set<string>(work.dependencyIds);
  for (const edge of graphEdges) {
    if (edge.kind === "blocks" && edge.fromType === "work" && edge.toType === "work" && edge.toId === work.meta.id) {
      ids.add(edge.fromId);
    }
  }
  return [...ids];
}

export function computeScopeIds(
  rootId: string,
  byId: ReadonlyMap<string, WorkItem>,
  graphEdges: readonly GraphEdge[]
): ReadonlySet<string> {
  const visited = new Set<string>();
  const visit = (workId: string): void => {
    if (visited.has(workId) || !byId.has(workId)) return;
    visited.add(workId);
    const work = byId.get(workId);
    if (work) {
      for (const childId of childWorkIds(work, graphEdges)) visit(childId);
    }
  };
  const root = byId.get(rootId);
  if (root) {
    for (const childId of childWorkIds(root, graphEdges)) visit(childId);
  }
  return visited;
}

function rollupKind(kind: WorkKind): RollupNodeKind {
  return kind;
}

/**
 * Build the repo roll-up tree: a synthetic project root, then work items
 * hung off `parentId` where present. Sprints additionally pull in
 * dependency/`blocks`-scope work that has no explicit `parentId` (mirroring
 * `sprint show`/`sprint board` scope), so a sprint's scoped tasks show up as
 * roll-up children even when they were never explicitly parented to it.
 * Each work item appears exactly once: parentId wins over sprint-scope
 * attachment, which wins over falling back to the root.
 */
export function buildRepoRollupView(input: {
  readonly workspaceRoot: string;
  readonly generatedAt: string;
  readonly projectName: string;
  readonly projectHealth?: ProjectHealthState;
  readonly work: readonly WorkItem[];
  readonly graphEdges: readonly GraphEdge[];
  readonly reservationsByWorkId?: ReadonlyMap<string, WorkReservationView>;
  readonly actionsForWork?: (work: WorkItem) => readonly TuiCommandDescriptor[];
}): RepoRollupView {
  const byId = new Map<string, WorkItem>(input.work.map((work) => [work.meta.id, work]));
  const explicitParentOf = new Map<string, string>();
  for (const work of input.work) {
    if (work.parentId && byId.has(work.parentId)) {
      explicitParentOf.set(work.meta.id, work.parentId);
    }
  }

  // Sprint-scope attachment for anything left unparented.
  const sprintOwnerOf = new Map<string, string>();
  for (const work of input.work) {
    if (work.kind !== "sprint") continue;
    const scope = computeScopeIds(work.meta.id, byId, input.graphEdges);
    for (const memberId of scope) {
      if (explicitParentOf.has(memberId) || sprintOwnerOf.has(memberId) || memberId === work.meta.id) continue;
      sprintOwnerOf.set(memberId, work.meta.id);
    }
  }

  const ROOT_ID = "__root__";
  const parentIdFor = (workId: string): string =>
    explicitParentOf.get(workId) ?? sprintOwnerOf.get(workId) ?? ROOT_ID;

  const childIdsByParent = new Map<string, string[]>();
  for (const work of input.work) {
    const parentId = parentIdFor(work.meta.id);
    const list = childIdsByParent.get(parentId) ?? [];
    list.push(work.meta.id);
    childIdsByParent.set(parentId, list);
  }

  const nodesById = new Map<string, RollupNodeView>();

  function progressFor(nodeId: string): RollupProgressView {
    const node = byId.get(nodeId);
    const childIds = childIdsByParent.get(nodeId) ?? [];
    if (childIds.length === 0) {
      const status = node?.status;
      const done = status ? (TERMINAL_STATUSES.has(status) && status !== "cancelled" ? 1 : 0) : 0;
      const cancelled = status === "cancelled" ? 1 : 0;
      const total = 1;
      const open = total - done - cancelled;
      return { total, done, open, cancelled, percentDone: total > 0 ? Math.round((done / total) * 100) : 0 };
    }
    let total = 0;
    let done = 0;
    let cancelled = 0;
    for (const childId of childIds) {
      const child = progressFor(childId);
      total += child.total;
      done += child.done;
      cancelled += child.cancelled;
    }
    const open = total - done - cancelled;
    return { total, done, open, cancelled, percentDone: total > 0 ? Math.round((done / total) * 100) : 0 };
  }

  function blockerSummaryFor(nodeId: string): RollupBlockerSummary {
    const node = byId.get(nodeId);
    const own = node ? childWorkIds(node, input.graphEdges).filter((id) => {
      const dep = byId.get(id);
      return dep ? !TERMINAL_STATUSES.has(dep.status) : true;
    }) : [];
    const childIds = childIdsByParent.get(nodeId) ?? [];
    let blockedDescendantCount = node?.status === "blocked" ? 1 : 0;
    for (const childId of childIds) {
      const childSummary = blockerSummaryFor(childId);
      blockedDescendantCount += childSummary.blockedDescendantCount;
    }
    return { activeBlockerCount: own.length, blockedDescendantCount, blockerIds: own };
  }

  function buildNode(id: string, depth: number, parentId: string | undefined): RollupNodeView {
    if (id === ROOT_ID) {
      const childIds = (childIdsByParent.get(ROOT_ID) ?? []).map((childId) => buildNode(childId, depth + 1, ROOT_ID).id);
      const progress = progressFor(ROOT_ID);
      const blockerSummary = blockerSummaryFor(ROOT_ID);
      const rootNode: RollupNodeView = {
        id: ROOT_ID,
        entity: {
          kind: "project",
          id: input.projectName,
          workspaceRoot: input.workspaceRoot,
          label: input.projectName
        },
        kind: "project",
        title: input.projectName,
        health: input.projectHealth,
        depth,
        parentId,
        childIds,
        expandedByDefault: true,
        progress,
        blockerSummary,
        labels: [],
        stale: false,
        actions: []
      };
      nodesById.set(ROOT_ID, rootNode);
      return rootNode;
    }
    const work = byId.get(id);
    if (!work) {
      throw new Error(`buildRepoRollupView: unknown work id ${id}`);
    }
    const childIds = (childIdsByParent.get(id) ?? [])
      .sort((a, b) => (byId.get(a)?.title ?? a).localeCompare(byId.get(b)?.title ?? b))
      .map((childId) => buildNode(childId, depth + 1, id).id);
    const node: RollupNodeView = {
      id,
      entity: {
        kind: work.kind === "milestone" ? "milestone" : work.kind === "sprint" ? "sprint" : work.kind === "issue" ? "issue" : "task",
        id,
        workspaceRoot: input.workspaceRoot,
        label: work.title
      },
      kind: rollupKind(work.kind),
      title: work.title,
      workStatus: work.status,
      priority: work.priority,
      depth,
      parentId,
      childIds,
      expandedByDefault: depth <= 1 && work.status !== "closed" && work.status !== "cancelled",
      progress: progressFor(id),
      blockerSummary: blockerSummaryFor(id),
      reservation: input.reservationsByWorkId?.get(id),
      labels: work.labels,
      stale: false,
      actions: input.actionsForWork?.(work) ?? []
    };
    nodesById.set(id, node);
    return node;
  }

  const root = buildNode(ROOT_ID, 0, undefined);
  const flatRows = [...nodesById.values()].sort((a, b) => a.depth - b.depth || a.title.localeCompare(b.title));

  const nonRoot = flatRows.filter((node) => node.id !== ROOT_ID);
  const summary: RepoRollupSummary = {
    totalNodes: nonRoot.length,
    milestones: nonRoot.filter((node) => node.kind === "milestone").length,
    sprints: nonRoot.filter((node) => node.kind === "sprint").length,
    tasks: nonRoot.filter((node) => node.kind === "task" || node.kind === "issue").length,
    open: nonRoot.filter((node) => node.workStatus && !TERMINAL_STATUSES.has(node.workStatus)).length,
    blocked: nonRoot.filter((node) => node.workStatus === "blocked").length,
    needsVerification: nonRoot.filter((node) => node.workStatus === "needs_verification").length,
    closed: nonRoot.filter((node) => node.workStatus === "closed" || node.workStatus === "verified").length,
    cancelled: nonRoot.filter((node) => node.workStatus === "cancelled").length,
    activeReservations: nonRoot.filter((node) => node.reservation && !node.reservation.expired).length
  };

  return {
    generatedAt: input.generatedAt,
    workspaceRoot: input.workspaceRoot,
    root,
    flatRows,
    summary
  };
}
