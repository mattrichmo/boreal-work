import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Box, Text, useApp, useInput, useStdin, useStdout, useWindowSize, type Key } from "ink";
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";

import type { OpenRepoTarget, TuiCommandDescriptor, TuiEnvelope, TuiEntityKind, TuiEntityRef, TuiFilterState } from "@boreal/ui-model";
import { CommandConfirmPanel, commandPanelMaxScroll } from "./command-panel.js";
import { DEFAULT_TUI_REFRESH_MS, normalizeRefreshInterval } from "./head-poll.js";
import { createRefreshScheduler, type RefreshScheduler } from "./refresh-scheduler.js";
import { buildPaletteItems, searchPalette, type PaletteItem } from "./palette.js";
import { activeRowIds, loadForFrame, selectedRowCursor, type RouteBody } from "./route-model.js";
import { FreshnessLine, HelpView, Palette } from "./shell-chrome.js";
export { selectedRowCursor } from "./route-model.js";
import { invalidateGlobalDashboardCache, loadRepoRollup } from "./loaders.js";
import { bindingsForRoute, resolveRouteAction, routeFooterHints } from "./route-bindings.js";
import { atRoot, breadcrumbs, initialRouteNavState, reduceRouteNav, rootFrame, topFrame } from "./route-nav.js";
import { GlobalOverviewRoute, type GlobalRouteState } from "./routes/global-overview.js";
import { GlobalProjectsRoute } from "./routes/global-projects.js";
import { GlobalQueuesRoute, queueFilterLabel, queueRowAt, QUEUE_FILTER_CYCLE } from "./routes/global-queues.js";
import {
  defaultRollupDisclosure,
  rollupFilterLabel,
  rollupRowAt,
  RepoRollupRoute,
  ROLLUP_FILTER_CYCLE,
  ROLLUP_READY_FILTER,
  toggleRollupDisclosure,
  type RollupDisclosureState
} from "./routes/rollup.js";
import { SprintBoardRoute, SPRINT_FILTERS, sprintFilterLabel, visibleSprintRows } from "./routes/sprint-board.js";
import { RepoMilestonesRoute, RepoNowRoute, RepoOpsRoute, RepoSprintsRoute, RepoWorkRoute, nowScopeFilterLabel, visibleMilestoneRows, visibleNowRows, visibleWorkRows, WORK_FILTERS, workFilterLabel } from "./routes/repo-sections.js";
import {
  defaultTaskDetailDisclosure,
  TaskDetailRoute,
  taskActionDisplay,
  taskDetailHasHierarchy,
  taskDetailLayout,
  taskDetailMaxScroll,
  taskDetailXrayRows,
  filterTaskDetailRows,
  visibleTaskDetailRows,
  type TaskDetailFocus,
  type TaskDetailLayoutMode,
  type TaskDetailMaximizedPane,
  type TaskDetailPanel,
  type TaskDetailTreeRow
} from "./routes/task-detail.js";
import { railFor, routeById, routeByNumberKey, REPO_TASK_DETAIL_ROUTE, type RouteSpec } from "./routes.js";
import { mouseFromInput, useAltScreen, wheelFromInput } from "./runtime.js";
import { colorModeLabel, currentColorMode, cycleColorMode, COLOR, setColorMode, type ColorMode } from "./theme.js";
import { EmptyState, KeyHints, SectionRail, sectionRailLayout, TopBar } from "./ui.js";
import type { RepoRollupView } from "@boreal/ui-model";

const execFileAsync = promisify(execFile);


// Per-route status-facet cycles (decision #6: "f cycles simple enumerated
// filters per route (status facets only in v1)"). Routes not listed here
// have no facet, and `filter` is not offered in their binding specs.
const FILTER_CYCLES: Readonly<Record<string, readonly (TuiFilterState | undefined)[]>> = {
  "repo.rollup": ROLLUP_FILTER_CYCLE,
  "global.queues": QUEUE_FILTER_CYCLE
};

function rollupParentRowId(body: { readonly flatRows: readonly { readonly id: string; readonly childIds: readonly string[] }[] }, nodeId: string): string | undefined {
  return body.flatRows.find((candidate) => candidate.childIds.includes(nodeId))?.id;
}

function nextFilter(routeId: string, current: TuiFilterState | undefined): TuiFilterState | undefined {
  if (routeId === "repo.sprintBoard") {
    const index = SPRINT_FILTERS.findIndex((filter) => filter === sprintFilterLabel(current));
    return { clauses: current?.clauses ?? [], sort: [], query: SPRINT_FILTERS[(index + 1) % SPRINT_FILTERS.length] };
  }
  if (routeId === "repo.work") {
    const index = WORK_FILTERS.findIndex((filter) => filter === workFilterLabel(current));
    return { clauses: [], sort: [], query: WORK_FILTERS[(index + 1) % WORK_FILTERS.length] };
  }
  const cycle = FILTER_CYCLES[routeId];
  if (!cycle) return current;
  const index = cycle.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(current));
  return cycle[(Math.max(0, index) + 1) % cycle.length];
}

function filterLabel(routeId: string, filters: TuiFilterState | undefined): string | undefined {
  if (routeId === "repo.rollup") return rollupFilterLabel(filters);
  if (routeId === "global.queues") return queueFilterLabel(filters);
  if (routeId === "repo.sprintBoard") return sprintFilterLabel(filters);
  if (routeId === "repo.work") return workFilterLabel(filters);
  return undefined;
}

export interface RefreshRequestIdentity {
  readonly surface: "global" | "repo";
  readonly workspaceRoot: string;
  readonly routeId: string;
  readonly entityId?: string;
  readonly entityKind?: TuiEntityKind;
  readonly registryRoot?: string;
}

export function routeRequestKey(identity: RefreshRequestIdentity): string {
  return JSON.stringify([
    identity.surface,
    identity.workspaceRoot,
    identity.routeId,
    identity.entityId ?? "",
    identity.entityKind ?? "",
    identity.registryRoot ?? ""
  ]);
}

export function isRefreshCurrent(generation: number, currentGeneration: number, signal: AbortSignal): boolean {
  return generation === currentGeneration && !signal.aborted;
}

function abortError(): Error {
  const error = new Error("refresh aborted");
  error.name = "AbortError";
  return error;
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw abortError();
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export function formatCommandFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = error as Error & {
    readonly code?: string | number;
    readonly signal?: string;
    readonly stderr?: string | Buffer;
    readonly stdout?: string | Buffer;
  };
  const lines = [details.message];
  if (details.code !== undefined) lines.push(`exit: ${String(details.code)}`);
  if (details.signal) lines.push(`signal: ${details.signal}`);
  const stderr = details.stderr ? String(details.stderr).trimEnd() : "";
  const stdout = details.stdout ? String(details.stdout).trimEnd() : "";
  if (stderr) lines.push(`stderr:\n${stderr}`);
  if (stdout) lines.push(`stdout:\n${stdout}`);
  return lines.filter((line) => line.length > 0).join("\n");
}


export function RouteApp({
  workspaceRoot,
  global,
  mouse = false,
  refreshMs = DEFAULT_TUI_REFRESH_MS,
  registryRoot
}: {
  readonly workspaceRoot: string;
  readonly global?: boolean;
  readonly mouse?: boolean;
  readonly refreshMs?: number;
  readonly registryRoot?: string;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const terminalSize = useWindowSize();
  const { isRawModeSupported } = useStdin();
  const interactiveTerminal = process.stdin.isTTY === true && stdout?.isTTY === true;

  const surface = global ? "global" : "repo";
  const initialRoute = global ? "global.overview" : "repo.now";
  const initialTitle = global ? "Overview" : "Now";
  const [nav, dispatch] = useReducer(reduceRouteNav, undefined, () =>
    initialRouteNavState(surface, workspaceRoot, initialRoute, initialTitle)
  );

  const [body, setBody] = useState<RouteBody | undefined>();
  const [envelope, setEnvelope] = useState<TuiEnvelope<unknown> | undefined>();
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpScroll, setHelpScroll] = useState(0);
  const [sprintPickerOpen, setSprintPickerOpen] = useState(false);
  const [searchRollup, setSearchRollup] = useState<{ readonly workspace: string; readonly value: RepoRollupView }>();
  const [searchError, setSearchError] = useState<string>();
  const [confirming, setConfirming] = useState<TuiCommandDescriptor | undefined>();
  const [commandRunning, setCommandRunning] = useState(false);
  const [commandError, setCommandError] = useState<string | undefined>();
  const [commandScroll, setCommandScroll] = useState(0);
  const [batchDescriptors, setBatchDescriptors] = useState<readonly TuiCommandDescriptor[]>([]);
  const [quitArmed, setQuitArmed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteCursor, setPaletteCursor] = useState(0);
  const [paletteMode, setPaletteMode] = useState<"search" | "command" | "batch" | "sprint" | "now-scope">("search");
  const [scopeFilterOpen, setScopeFilterOpen] = useState(false);
  const [scopeFilterQuery, setScopeFilterQuery] = useState("");
  const [livePaused, setLivePaused] = useState(false);
  const [colorMode, setActiveColorMode] = useState<ColorMode>(currentColorMode());
  const [railFocused, setRailFocused] = useState(false);
  const [railCursor, setRailCursor] = useState(0);
  const [rollupDisclosure, setRollupDisclosure] = useState<{
    readonly key?: string;
    readonly ids: RollupDisclosureState;
    readonly knownIds: ReadonlySet<string>;
  }>({ ids: new Set<string>(), knownIds: new Set<string>() });
  const [taskDetailTree, setTaskDetailTree] = useState<{
    readonly key?: string;
    readonly cursor: number;
    readonly expandedIds: ReadonlySet<string>;
    readonly focus: TaskDetailFocus;
    readonly paneVisible: boolean;
    readonly maximized?: TaskDetailMaximizedPane;
    readonly layoutMode: TaskDetailLayoutMode;
    readonly panel: TaskDetailPanel;
    readonly selectedIds: ReadonlySet<string>;
  }>({ cursor: 0, expandedIds: new Set<string>(), focus: "actions", paneVisible: true, layoutMode: "right", panel: "tree", selectedIds: new Set<string>() });
  const [milestoneDisclosure, setMilestoneDisclosure] = useState<{
    readonly key?: string;
    readonly ids: ReadonlySet<string>;
  }>({ ids: new Set<string>() });
  const refreshGenerationRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | undefined>(undefined);
  const activeRequestKeyRef = useRef<string | undefined>(undefined);
  const loadingRef = useRef(false);
  const schedulerRef = useRef<RefreshScheduler | undefined>(undefined);
  const forceNextRefreshRef = useRef(true);
  const interactionBusyRef = useRef(false);
  interactionBusyRef.current = paletteOpen || Boolean(confirming) || helpOpen || commandRunning || scopeFilterOpen;

  const requestRefresh = useCallback(() => {
    forceNextRefreshRef.current = true;
    schedulerRef.current?.request({ immediate: true });
  }, []);

  const frame = topFrame(nav);
  const routeSpec = routeById(frame.routeId);
  const unsupportedRoute = frame.routeId !== REPO_TASK_DETAIL_ROUTE && (!routeSpec || routeSpec.isStub === true);
  const requestIdentity: RefreshRequestIdentity = {
    surface: nav.current.surface,
    workspaceRoot: nav.current.workspaceRoot,
    routeId: frame.routeId,
    entityId: frame.entity?.id,
    entityKind: frame.entity?.kind,
    registryRoot
  };
  const currentFrameKey = routeRequestKey(requestIdentity);
  const sectionRoutes = useMemo(() => railFor(nav.current.surface), [nav.current.surface]);
  useEffect(() => {
    const activeIndex = sectionRoutes.findIndex((route) => route.id === frame.routeId);
    if (activeIndex >= 0) setRailCursor(activeIndex);
  }, [frame.routeId, sectionRoutes]);
  const currentBody = loadedFrameKey === currentFrameKey ? body : undefined;
  const currentEnvelope = loadedFrameKey === currentFrameKey ? envelope : undefined;
  // The stored frame cursor can point past the end right after a filter
  // cycle or a refresh returns fewer rows (nothing clamps it until the next
  // arrow key) -- so render and drill lookups both use this effective,
  // always-in-bounds cursor rather than frame.cursor directly.
  const rowIds = activeRowIds(
    currentBody,
    frame.filters,
    rollupDisclosure.key === currentFrameKey ? rollupDisclosure.ids : undefined,
    milestoneDisclosure.key === currentFrameKey ? milestoneDisclosure.ids : undefined
  );
  const listLength = rowIds.length;
  const effectiveCursor = selectedRowCursor(rowIds, frame.selectedRowId, frame.cursor);
  const taskDetailHierarchy = currentBody?.kind === "repo.taskDetail" && taskDetailHasHierarchy(currentBody.value)
    ? currentBody.value.hierarchy
    : undefined;
  const taskDetailRouteWidth = Math.max(1, terminalSize.columns - 2 - (sectionRailLayout(terminalSize.columns).width ? sectionRailLayout(terminalSize.columns).width + 1 : 0));
  const taskDetailScopeHierarchy = taskDetailHierarchy && taskDetailLayout(taskDetailRouteWidth, true, Math.max(1, terminalSize.rows - 6), taskDetailTree.key === currentFrameKey ? taskDetailTree.layoutMode : "right").split
    ? taskDetailHierarchy
    : undefined;
  const taskDetailExpandedIds = taskDetailTree.key === currentFrameKey
    ? taskDetailTree.expandedIds
    : taskDetailScopeHierarchy
      ? defaultTaskDetailDisclosure(taskDetailScopeHierarchy)
      : new Set<string>();
  const taskDetailAllRows: readonly TaskDetailTreeRow[] = taskDetailScopeHierarchy
    ? visibleTaskDetailRows(taskDetailScopeHierarchy, taskDetailExpandedIds)
    : [];
  const taskDetailRows: readonly TaskDetailTreeRow[] = filterTaskDetailRows(taskDetailAllRows, scopeFilterQuery);
  const taskDetailFocus: TaskDetailFocus = taskDetailTree.key === currentFrameKey
    ? taskDetailTree.focus
    : taskDetailScopeHierarchy
      ? "scope"
      : "actions";
  const taskDetailPanel: TaskDetailPanel = taskDetailTree.key === currentFrameKey ? taskDetailTree.panel : "tree";
  const taskDetailPaneVisible = taskDetailTree.key === currentFrameKey ? taskDetailTree.paneVisible : true;
  const taskDetailMaximized = taskDetailTree.key === currentFrameKey ? taskDetailTree.maximized : undefined;
  const taskDetailLayoutMode: TaskDetailLayoutMode = taskDetailTree.key === currentFrameKey ? taskDetailTree.layoutMode : "right";
  const taskDetailSelectedIds = taskDetailTree.key === currentFrameKey ? taskDetailTree.selectedIds : new Set<string>();
  const taskDetailXrayRowList = taskDetailScopeHierarchy && taskDetailPanel === "xray" ? taskDetailXrayRows(taskDetailScopeHierarchy) : [];
  const taskDetailRowCount = taskDetailPanel === "xray" ? taskDetailXrayRowList.length : taskDetailRows.length;
  const taskDetailCursor = Math.max(0, Math.min(taskDetailTree.cursor, Math.max(0, taskDetailRowCount - 1)));
  const selectCursor = useCallback((index: number) => {
    const cursor = Math.max(0, Math.min(index, rowIds.length - 1));
    dispatch({ type: "setCursor", cursor, selectedRowId: rowIds[cursor] });
  }, [rowIds.join("\u0000")]);
  const selectTaskDetailCursor = useCallback((index: number) => {
    setTaskDetailTree((current) => ({
      ...current,
      key: currentFrameKey,
      cursor: Math.max(0, Math.min(index, Math.max(0, taskDetailRowCount - 1)))
    }));
  }, [currentFrameKey, taskDetailRowCount]);
  useLayoutEffect(() => {
    if (!currentBody) return;
    const selectedRowId = rowIds[effectiveCursor];
    if (frame.cursor !== effectiveCursor || frame.selectedRowId !== selectedRowId) {
      dispatch({ type: "setCursor", cursor: effectiveCursor, selectedRowId });
    }
  }, [currentBody, effectiveCursor, frame.cursor, frame.selectedRowId, rowIds.join("\u0000")]);
  const specs = useMemo(() => bindingsForRoute(frame.routeId), [frame.routeId]);

  useEffect(() => {
    if (!paletteOpen || sprintPickerOpen || nav.current.surface !== "repo") return;
    let active = true;
    setSearchError(undefined);
    void loadRepoRollup(nav.current.workspaceRoot).then((result) => {
      if (active) setSearchRollup({ workspace: nav.current.workspaceRoot, value: result.body });
    }).catch((caught: unknown) => { if (active) setSearchError(String(caught)); });
    return () => { active = false; };
  }, [paletteOpen, sprintPickerOpen, nav.current.surface, nav.current.workspaceRoot]);

  const taskDetailBatchOptions = useMemo(() => {
    if (!taskDetailScopeHierarchy || taskDetailSelectedIds.size === 0) return [] as readonly { readonly id: string; readonly label: string; readonly hint: string; readonly workspaceRoot: string; readonly descriptors: readonly TuiCommandDescriptor[] }[];
    const selected = taskDetailAllRows.filter((row) => taskDetailSelectedIds.has(row.node.id));
    if (selected.length === 0) return [] as readonly { readonly id: string; readonly label: string; readonly hint: string; readonly workspaceRoot: string; readonly descriptors: readonly TuiCommandDescriptor[] }[];
    const labels = [...new Set(selected.flatMap((row) => row.node.actions.map((action) => action.label)))];
    return labels.flatMap((label, index) => {
      const descriptors = selected.map((row) => row.node.actions.find((action) => action.label === label)).filter((action): action is TuiCommandDescriptor => Boolean(action && !action.disabled));
      if (descriptors.length !== selected.length) return [];
      return [{ id: `batch:${index}`, label: `${label} · ${selected.length} selected`, hint: "batch action", workspaceRoot: nav.current.workspaceRoot, descriptors }];
    });
  }, [taskDetailAllRows, taskDetailSelectedIds, taskDetailScopeHierarchy]);

  const nowScopeItems = useMemo(() => {
    if (currentBody?.kind !== "repo.now") return [];
    return [
      { id: "now-scope:all", label: "Now · all milestones and sprints", hint: `${currentBody.value.rows.length} surfaced`, workspaceRoot: nav.current.workspaceRoot },
      ...(currentBody.value.scopes ?? []).map((scope) => ({
        id: `now-scope:${scope.kind}:${scope.id}`,
        label: `Now · ${scope.kind} · ${scope.title}`,
        hint: `${scope.count} surfaced`,
        workspaceRoot: nav.current.workspaceRoot
      }))
    ];
  }, [currentBody, nav.current.workspaceRoot]);

  const commandItems = useMemo(() => [
    { id: "command:refresh", label: "Refresh current view", hint: "r", workspaceRoot: nav.current.workspaceRoot },
    { id: "command:help", label: "Open contextual help", hint: "?", workspaceRoot: nav.current.workspaceRoot },
    ...(taskDetailScopeHierarchy ? [
      { id: "command:preview", label: "Toggle child-work preview", hint: "p", workspaceRoot: nav.current.workspaceRoot },
      { id: "command:maximize", label: "Maximize focused pane", hint: "e", workspaceRoot: nav.current.workspaceRoot },
      { id: "command:layout", label: "Switch right/bottom layout", hint: "P", workspaceRoot: nav.current.workspaceRoot },
      { id: "command:xray", label: "Open dependency XRay", hint: "x", workspaceRoot: nav.current.workspaceRoot },
      ...(taskDetailSelectedIds.size > 0 ? [{ id: "command:batch", label: `Batch action · ${taskDetailSelectedIds.size} selected`, hint: "b", workspaceRoot: nav.current.workspaceRoot }] : [])
    ] : []),
    ...(currentBody?.kind === "repo.now" ? nowScopeItems : []),
    { id: "command:live", label: livePaused ? "Resume live updates" : "Freeze live updates", hint: "F", workspaceRoot: nav.current.workspaceRoot },
    { id: "command:theme", label: `Cycle theme · ${colorModeLabel(colorMode)}`, hint: "T", workspaceRoot: nav.current.workspaceRoot }
  ], [colorMode, currentBody, livePaused, nav.current.workspaceRoot, nowScopeItems, taskDetailScopeHierarchy, taskDetailSelectedIds.size]);

  const paletteResults = useMemo(() => {
    if (!paletteOpen) return [];
    const commandMode = paletteMode === "command";
    const batchMode = paletteMode === "batch";
    const nowScopeMode = paletteMode === "now-scope";
    const items = buildPaletteItems({
      workspaceRoot: nav.current.workspaceRoot,
      commands: commandMode ? commandItems : batchMode ? taskDetailBatchOptions : nowScopeMode ? nowScopeItems : undefined,
      routes: sprintPickerOpen || commandMode || batchMode || nowScopeMode ? [] : railFor(nav.current.surface),
      rollup: sprintPickerOpen || commandMode || batchMode || nowScopeMode ? undefined : currentBody?.kind === "repo.rollup" ? currentBody.value : searchRollup?.workspace === nav.current.workspaceRoot ? searchRollup.value : undefined,
      sprintBody: commandMode || batchMode || nowScopeMode ? undefined : currentBody?.kind === "repo.sprintBoard" ? currentBody.value : undefined,
      projects: commandMode || batchMode || nowScopeMode ? undefined : currentBody?.kind === "global.projects" ? currentBody.value : undefined,
      queues: commandMode || batchMode || nowScopeMode ? undefined : currentBody?.kind === "global.queues" ? currentBody.value : undefined
    });
    return searchPalette(sprintPickerOpen ? items.filter((item) => item.kind === "sprint") : items, paletteQuery);
  }, [commandItems, currentBody, nav.current.surface, nav.current.workspaceRoot, nowScopeItems, paletteMode, paletteOpen, paletteQuery, searchRollup, sprintPickerOpen, taskDetailBatchOptions]);

  const refresh = useCallback(async ({ force = false }: { readonly force?: boolean } = {}) => {
    const identity: RefreshRequestIdentity = {
      surface: nav.current.surface,
      workspaceRoot: nav.current.workspaceRoot,
      routeId: frame.routeId,
      entityId: frame.entity?.id,
      entityKind: frame.entity?.kind,
      registryRoot
    };
    const requestKey = routeRequestKey(identity);
    if (!force && loadingRef.current && activeRequestKeyRef.current === requestKey) return;

    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const generation = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = generation;
    activeRequestKeyRef.current = requestKey;
    loadingRef.current = true;
    setLoading(true);
    if (force && identity.surface === "global") invalidateGlobalDashboardCache(identity.workspaceRoot);
    // Keep the last successful body/envelope mounted while this request is
    // in flight. The route key prevents an old route from being displayed
    // under a newly selected breadcrumb.
    setError(undefined);
    try {
      const result = await abortable(loadForFrame(identity.workspaceRoot, identity.routeId, identity.entityId, frame.entity?.kind, controller.signal), controller.signal);
      if (!isRefreshCurrent(generation, refreshGenerationRef.current, controller.signal)) return;
      if (result) {
        setEnvelope(result.envelope);
        setBody(result.body);
        setLoadedFrameKey(requestKey);
        setError(result.envelope.error ?? (result.envelope.stale && result.envelope.warnings.length > 0 ? result.envelope.warnings.join(" · ") : undefined));
      } else {
        setError(unsupportedRoute ? `Route ${frame.routeId} is unsupported.` : `No data is available for ${frame.routeId}.`);
      }
    } catch (caught) {
      if (!isRefreshCurrent(generation, refreshGenerationRef.current, controller.signal)) return;
      if (caught instanceof Error && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : String(caught));
      throw caught;
    } finally {
      if (isRefreshCurrent(generation, refreshGenerationRef.current, controller.signal)) {
        loadingRef.current = false;
        activeRequestKeyRef.current = undefined;
        setLoading(false);
      }
    }
  }, [frame.entity?.id, frame.entity?.kind, frame.routeId, nav.current.surface, nav.current.workspaceRoot, registryRoot, unsupportedRoute]);

  useEffect(() => {
    if (!global || !registryRoot) return undefined;
    const previous = process.env.BOREAL_PROJECT_REGISTRY_ROOT;
    process.env.BOREAL_PROJECT_REGISTRY_ROOT = registryRoot;
    return () => {
      if (previous === undefined) delete process.env.BOREAL_PROJECT_REGISTRY_ROOT;
      else process.env.BOREAL_PROJECT_REGISTRY_ROOT = previous;
    };
  }, [global, registryRoot]);

  useEffect(() => {
    setConfirming(undefined);
    setBatchDescriptors([]);
    setCommandError(undefined);
    setHelpOpen(false);
    setSprintPickerOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.current.surface, nav.current.workspaceRoot, frame.routeId, frame.entity?.id, frame.entity?.kind, registryRoot]);

  useEffect(() => {
    if (currentBody?.kind !== "repo.rollup") return;
    const defaults = defaultRollupDisclosure(currentBody.value);
    const knownIds = new Set(currentBody.value.flatRows.map((node) => node.id));
    setRollupDisclosure((current) => {
      const sameFrame = current.key === currentFrameKey;
      const next = new Set<string>(sameFrame ? current.ids : defaults);
      for (const id of next) {
        if (!knownIds.has(id)) next.delete(id);
      }
      // Preserve an operator's explicit collapse, but expand only nodes that
      // arrived after the previous payload according to the default policy.
      if (sameFrame) {
        for (const node of currentBody.value.flatRows) {
          if (!current.knownIds.has(node.id) && node.expandedByDefault) next.add(node.id);
        }
      }
      return { key: currentFrameKey, ids: next, knownIds };
    });
  }, [currentBody, currentFrameKey, rollupDisclosure.key]);

  useEffect(() => {
    if (currentBody?.kind !== "repo.taskDetail" || !taskDetailScopeHierarchy) return;
    setTaskDetailTree((current) => {
      const sameFrame = current.key === currentFrameKey;
      const expandedIds = sameFrame ? current.expandedIds : defaultTaskDetailDisclosure(taskDetailScopeHierarchy);
      const rows = visibleTaskDetailRows(taskDetailScopeHierarchy, expandedIds);
      return {
        key: currentFrameKey,
        cursor: Math.max(0, Math.min(sameFrame ? current.cursor : 0, Math.max(0, rows.length - 1))),
        expandedIds,
        focus: sameFrame ? current.focus : "scope",
        paneVisible: sameFrame ? current.paneVisible : true,
        maximized: sameFrame ? current.maximized : undefined,
        layoutMode: sameFrame ? current.layoutMode : "right",
        panel: sameFrame ? current.panel : "tree",
        selectedIds: sameFrame ? new Set([...current.selectedIds].filter((id) => rows.some((row) => row.node.id === id))) : new Set<string>()
      };
    });
  }, [currentBody, currentFrameKey, taskDetailScopeHierarchy]);

  useEffect(() => {
    if (currentBody?.kind !== "repo.taskDetail") {
      setScopeFilterOpen(false);
      setScopeFilterQuery("");
      return;
    }
    setScopeFilterOpen(false);
    setScopeFilterQuery("");
  }, [currentFrameKey]);

  useEffect(() => {
    if (currentBody?.kind !== "global.projects" || frame.entity?.kind !== "project") return;
    const targetIndex = currentBody.value.entries.findIndex((entry) => entry.id === frame.entity?.id);
    if (targetIndex >= 0 && frame.cursor !== targetIndex) {
      dispatch({ type: "setCursor", cursor: targetIndex });
    }
  }, [currentBody, frame.cursor, frame.entity?.id, frame.entity?.kind]);

  // Time-based revalidation also updates reservation expiry when no event is written.
  // One scheduler owns initial, manual and automatic refreshes for this route.
  useEffect(() => {
    const scheduler = createRefreshScheduler({
      intervalMs: normalizeRefreshInterval(refreshMs),
      failureRetryMs: 500,
      maxBackoffMs: 5_000,
      onRefresh: () => {
        if (livePaused) return;
        if (!forceNextRefreshRef.current && interactionBusyRef.current) return;
        forceNextRefreshRef.current = false;
        return refresh({ force: true });
      }
    });
    schedulerRef.current = scheduler;
    forceNextRefreshRef.current = true;
    scheduler.start();
    scheduler.request({ immediate: true });
    return () => {
      scheduler.stop();
      refreshAbortRef.current?.abort();
      if (schedulerRef.current === scheduler) schedulerRef.current = undefined;
    };
  }, [livePaused, refresh, refreshMs]);

  useEffect(() => {
    return () => {
      refreshGenerationRef.current += 1;
      refreshAbortRef.current?.abort();
      loadingRef.current = false;
      activeRequestKeyRef.current = undefined;
    };
  }, []);

  const requestQuit = useCallback(() => {
    if (quitArmed) {
      exit();
      return;
    }
    setQuitArmed(true);
    setTimeout(() => setQuitArmed(false), 1500);
  }, [exit, quitArmed]);

  const runDescriptor = useCallback(
    async (descriptor: TuiCommandDescriptor) => {
      if (actionsBlocked(unsupportedRoute, loading, error, currentEnvelope)) {
        setCommandError("This route is read-only until its data is fresh and warning-free.");
        return;
      }
      if (descriptor.disabled) {
        setCommandError(descriptor.disabledReason ?? `${descriptor.label} is unavailable.`);
        return;
      }
      setCommandRunning(true);
      setCommandError(undefined);
      try {
        const descriptors = batchDescriptors.length > 0 ? batchDescriptors : [descriptor];
        for (const command of descriptors) {
          await execFileAsync(process.env.BOREAL_TUI_CLI ?? "bwrk", [...command.argv, "--json"], {
            cwd: command.workspaceRoot,
            maxBuffer: 16 * 1024 * 1024,
            timeout: 30_000,
            killSignal: "SIGTERM"
          });
        }
        setBatchDescriptors([]);
        setConfirming(undefined);
        requestRefresh();
      } catch (caught) {
        setCommandError(formatCommandFailure(caught));
      } finally {
        setCommandRunning(false);
      }
    },
    [batchDescriptors, currentEnvelope, error, loading, requestRefresh, unsupportedRoute]
  );

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setSprintPickerOpen(false);
    setPaletteMode("search");
    setPaletteQuery("");
    setPaletteCursor(0);
  }, []);

  function jumpToRoute(route: RouteSpec): void {
    dispatch({
      type: "jump",
      session: {
        surface: nav.current.surface,
        workspaceRoot: nav.current.workspaceRoot,
        projectId: nav.current.projectId,
        projectName: nav.current.projectName,
        stack: [rootFrame(route.id, route.label)]
      }
    });
  }

  function openPaletteItem(item: PaletteItem): void {
    if (paletteMode === "batch") {
      const option = taskDetailBatchOptions.find((candidate) => candidate.id === item.id);
      if (option) {
        setBatchDescriptors(option.descriptors);
        setConfirming({
          id: `batch:${option.id}`,
          label: option.label,
          description: "Run this action for every selected child-work item.",
          workspaceRoot: nav.current.workspaceRoot,
          argv: [],
          displayCommand: `${option.descriptors.length} commands · confirmation required`,
          effect: "write",
          mutatesState: true,
          requiresConfirmation: true
        });
      }
      closePalette();
    } else if (item.kind === "command") {
      if (item.id.startsWith("now-scope:") && currentBody?.kind === "repo.now") {
        const value = item.id.slice("now-scope:".length);
        dispatch({ type: "setFilters", filters: value === "all" ? undefined : { clauses: [{ field: "nowScope", operator: "is", value }], sort: [] } });
      } else if (item.id === "command:refresh") requestRefresh();
      else if (item.id === "command:help") setHelpOpen(true);
      else if (item.id === "command:preview") setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, paneVisible: !taskDetailPaneVisible, focus: taskDetailPaneVisible && current.focus === "scope" ? "actions" : current.focus }));
      else if (item.id === "command:maximize") setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, maximized: current.maximized ? undefined : current.focus === "scope" ? "scope" : "detail" }));
      else if (item.id === "command:layout") setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, layoutMode: current.layoutMode === "right" ? "bottom" : "right" }));
      else if (item.id === "command:xray") setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, panel: current.panel === "tree" ? "xray" : "tree", focus: "scope", paneVisible: true, maximized: undefined }));
      else if (item.id === "command:batch") { setPaletteMode("batch"); setPaletteQuery(""); setPaletteCursor(0); return; }
      else if (item.id === "command:live") setLivePaused((current) => !current);
      else if (item.id === "command:theme") {
        const next = cycleColorMode(colorMode);
        setColorMode(next);
        setActiveColorMode(next);
      }
      closePalette();
    } else if (item.kind === "route") {
      const route = routeById(item.routeId);
      if (route) jumpToRoute(route);
    } else if (nav.current.surface === "global") {
      dispatch({ type: "openRepo", target: {
        projectId: item.projectId ?? item.entity?.projectId ?? item.workspaceRoot,
        projectName: item.entity?.projectName ?? item.label,
        projectRoot: item.workspaceRoot,
        initialRoute: item.kind === "project" ? "repo.now" : item.routeId,
        initialEntity: item.kind === "project" ? undefined : item.entity,
        returnToGlobalFrame: frame
      } });
    } else {
      const target = { routeId: item.routeId, title: item.label, entity: item.entity, cursor: 0 };
      if (sprintPickerOpen) dispatch({ type: "jump", session: { ...nav.current, stack: [...nav.current.stack.slice(0, -1), target] } });
      else dispatch({ type: "push", frame: target });
    }
  }

  const handleDrill = useCallback((): void => {
    if (!currentBody) return;
    const openEntity = (entity: TuiEntityRef): void => {
      dispatch({
        type: "push",
        frame: {
          routeId: entity.kind === "sprint" ? "repo.sprintBoard" : "repo.taskDetail",
          title: entity.label,
          cursor: 0,
          entity
        }
      });
    };
    if (currentBody.kind === "repo.now") {
      const row = visibleNowRows(currentBody.value, frame.filters)[effectiveCursor];
      if (row) openEntity(row.node.entity);
      return;
    }
    if (currentBody.kind === "repo.milestones") {
      const row = visibleMilestoneRows(currentBody.value, milestoneDisclosure.key === currentFrameKey ? milestoneDisclosure.ids : undefined)[effectiveCursor];
      if (row) openEntity(row.node.entity);
      return;
    }
    if (currentBody.kind === "repo.sprints") {
      const row = currentBody.value.sprints[effectiveCursor];
      if (!row) return;
      openEntity({ kind: "sprint", id: row.view.id, workspaceRoot: nav.current.workspaceRoot, label: row.view.title });
      return;
    }
    if (currentBody.kind === "repo.work") {
      const row = visibleWorkRows(currentBody.value, frame.filters)[effectiveCursor];
      if (row) openEntity(row.entity);
      return;
    }
    if (currentBody.kind === "repo.ops") {
      const row = currentBody.value.reservations[effectiveCursor];
      if (row?.entity) openEntity(row.entity);
      return;
    }
    if (currentBody.kind === "repo.rollup") {
      const expandedIds = rollupDisclosure.key === currentFrameKey ? rollupDisclosure.ids : undefined;
      const node = rollupRowAt(currentBody.value, effectiveCursor, frame.filters, expandedIds);
      if (!node) return;
      if (node.kind === "milestone") {
        // Enter opens the milestone overview. Disclosure is deliberately a
        // separate Space/arrow action so opening a populated milestone never
        // unexpectedly floods the roll-up table.
        dispatch({ type: "push", frame: { routeId: "repo.taskDetail", title: node.title, cursor: 0, entity: node.entity } });
        return;
      }
      if (node.kind === "sprint") {
        dispatch({ type: "push", frame: { routeId: "repo.sprintBoard", title: node.title, cursor: 0, entity: node.entity } });
      } else if (node.kind === "task" || node.kind === "issue") {
        dispatch({ type: "push", frame: { routeId: "repo.taskDetail", title: node.title, cursor: 0, entity: node.entity } });
      } else {
        setError(`${node.kind} rows are visible but do not have a detail route yet.`);
      }
      return;
    }
    if (currentBody.kind === "repo.sprintBoard") {
      const task = visibleSprintRows(currentBody.value, frame.filters)[effectiveCursor];
      if (!task) return;
      const entityKind: TuiEntityKind = task.kind === "issue"
        ? "issue"
        : task.kind === "milestone"
          ? "milestone"
          : task.kind === "sprint"
            ? "sprint"
            : "task";
      dispatch({
        type: "push",
        frame: {
          routeId: "repo.taskDetail",
          title: task.title,
          cursor: 0,
          entity: {
            kind: entityKind,
            id: task.id,
            workspaceRoot: nav.current.workspaceRoot,
            label: task.title
          }
        }
      });
      return;
    }
    if (currentBody.kind === "repo.taskDetail") {
      if (taskDetailScopeHierarchy && taskDetailFocus === "scope") {
        const node = taskDetailPanel === "xray"
          ? (taskDetailXrayRowList[taskDetailCursor]?.nodeId === taskDetailScopeHierarchy.root.id
            ? taskDetailScopeHierarchy.root
            : taskDetailScopeHierarchy.nodes.find((candidate) => candidate.id === taskDetailXrayRowList[taskDetailCursor]?.nodeId))
          : taskDetailRows[taskDetailCursor]?.node;
        if (!node) return;
        dispatch({
          type: "push",
          frame: {
            routeId: node.kind === "sprint" ? "repo.sprintBoard" : "repo.taskDetail",
            title: node.title,
            cursor: 0,
            entity: node.entity
          }
        });
        return;
      }
      if (actionsBlocked(unsupportedRoute, loading, error, currentEnvelope)) return;
      const action = currentBody.value.actions[effectiveCursor];
      if (action) {
        const display = taskActionDisplay(action, currentBody.value.work);
        if (display.disabled) {
          setCommandError(display.reason ?? "This action is unavailable.");
        } else {
          setCommandError(undefined);
        }
        setCommandScroll(0);
        setConfirming(display.disabled ? { ...action, disabled: true, disabledReason: display.reason } : action);
      }
      return;
    }
    if (currentBody.kind === "global.overview") {
      const row = currentBody.value.attention[effectiveCursor];
      if (!row) return;
      if (row.projectMissing) {
        setError(`Project path is missing: ${row.projectRoot}. Re-link it with bwrk global link ${JSON.stringify(row.projectRoot)}${registryRoot ? ` --registry-root ${JSON.stringify(registryRoot)}` : ""}.`);
        return;
      }
      dispatch({
        type: "openRepo",
        target: {
          projectId: row.projectId,
          projectName: row.projectName,
          projectRoot: row.projectRoot,
          returnToGlobalFrame: { ...frame }
        }
      });
      return;
    }
    if (currentBody.kind === "global.projects") {
      const entry = currentBody.value.entries[effectiveCursor];
      if (!entry) return;
      if (entry.health === "missing" || entry.lifecycle === "missing") {
        setError(`Project path is missing: ${entry.projectRoot}. Re-link it with bwrk global link ${JSON.stringify(entry.projectRoot)}${registryRoot ? ` --registry-root ${JSON.stringify(registryRoot)}` : ""}.`);
        return;
      }
      const target: OpenRepoTarget = {
        projectId: entry.id,
        projectName: entry.name,
        projectRoot: entry.projectRoot,
        returnToGlobalFrame: { ...frame }
      };
      dispatch({ type: "openRepo", target });
      return;
    }
    if (currentBody.kind === "global.queues") {
      const item = queueRowAt(currentBody.value, effectiveCursor, frame.filters);
      if (!item) return;
      const target: OpenRepoTarget = {
        projectId: item.projectId,
        projectName: item.projectName,
        projectRoot: item.projectRoot,
        initialRoute: "repo.taskDetail",
        initialEntity: {
          kind: item.work.kind === "issue" ? "issue" : "task",
          id: item.work.id,
          workspaceRoot: item.projectRoot,
          label: item.work.title
        },
        returnToGlobalFrame: { ...frame }
      };
      dispatch({ type: "openRepo", target });
    }
  }, [currentBody, currentEnvelope, currentFrameKey, effectiveCursor, error, frame, loading, milestoneDisclosure, nav.current.workspaceRoot, registryRoot, rollupDisclosure, taskDetailCursor, taskDetailFocus, taskDetailPanel, taskDetailRows, taskDetailScopeHierarchy, taskDetailXrayRowList, unsupportedRoute]);

  const handleKey = useCallback(
    (input: string, key: Key) => {
      if (key.ctrl && input === "c") {
        requestQuit();
        return;
      }
      if (helpOpen) {
        if (key.escape || input === "?") setHelpOpen(false);
        else if (key.downArrow || key.pageDown || input === "j") setHelpScroll((current) => current + 1);
        else if (key.upArrow || key.pageUp || input === "k") setHelpScroll((current) => Math.max(0, current - 1));
        return;
      }
      if (scopeFilterOpen) {
        if (key.escape) {
          setScopeFilterOpen(false);
          setScopeFilterQuery("");
        } else if (key.return) {
          setScopeFilterOpen(false);
        } else if (key.backspace || key.delete) {
          setScopeFilterQuery((current) => current.slice(0, -1));
        } else if (input.length > 0 && /^[^\u0000-\u001f\u007f]+$/u.test(input) && !key.ctrl && !key.meta) {
          setScopeFilterQuery((current) => current + input);
          selectTaskDetailCursor(0);
        }
        return;
      }
      if (confirming) {
        if (key.escape) {
          setConfirming(undefined);
          setCommandError(undefined);
          setBatchDescriptors([]);
          return;
        }
        if (key.pageUp || key.pageDown || key.upArrow || key.downArrow || input === "g" || input === "G") {
          const columns = stdout?.columns ?? 100;
          const railWidth = sectionRailLayout(columns).width;
          const width = Math.max(1, columns - 2 - (railWidth ? railWidth + 1 : 0));
          const max = commandPanelMaxScroll(confirming, width, Math.max(0, (stdout?.rows ?? 24) - 5), commandError);
          const delta = key.pageUp || key.upArrow ? -1 : 1;
          setCommandScroll((current) => input === "g" ? 0 : input === "G" ? max : Math.max(0, Math.min(max, current + delta)));
          return;
        }
        if (key.return && !commandRunning) {
          void runDescriptor(confirming);
        }
        return;
      }
      if (paletteOpen) {
        if (key.escape) {
          closePalette();
          return;
        }
        if (key.return) {
          const item = paletteResults[paletteCursor];
          if (item) openPaletteItem(item);
          if (item?.id !== "command:batch") closePalette();
          return;
        }
        if (key.backspace || key.delete) {
          setPaletteQuery((current) => current.slice(0, -1));
          setPaletteCursor(0);
          return;
        }
        if (key.downArrow) {
          setPaletteCursor((current) => Math.min(current + 1, Math.max(0, paletteResults.length - 1)));
          return;
        }
        if (key.upArrow) {
          setPaletteCursor((current) => Math.max(current - 1, 0));
          return;
        }
        if (/^[^\u0000-\u001f\u007f]+$/u.test(input) && !key.ctrl && !key.meta) {
          setPaletteQuery((current) => current + input);
          setPaletteCursor(0);
        }
        return;
      }
      const mouseEvent = mouse ? mouseFromInput(input) : undefined;
      if (mouseEvent?.action === "press" && mouseEvent.button === "left" && currentBody?.kind === "repo.taskDetail" && taskDetailScopeHierarchy) {
        const columns = stdout?.columns ?? 100;
        const rows = stdout?.rows ?? 24;
        const railWidth = sectionRailLayout(columns).width;
        const routeWidth = Math.max(1, columns - 2 - (railWidth ? railWidth + 1 : 0));
        const bodyTop = 4;
        const contentTop = bodyTop + 1; // the milestone health strip occupies the first route row
        const layout = taskDetailLayout(routeWidth, true, Math.max(1, rows - 6), taskDetailLayoutMode);
        const routeLeft = 2 + (railWidth ? railWidth + 1 : 0);
        const bodyBottom = Math.max(bodyTop, rows - 2);
        if (mouseEvent.row >= contentTop && mouseEvent.row <= bodyBottom) {
          const scopeHit = !taskDetailPaneVisible
            ? false
            : taskDetailMaximized === "scope"
            ? true
            : taskDetailMaximized === "detail"
              ? false
              : layout.direction === "bottom"
                ? mouseEvent.row >= contentTop + layout.detailHeight + 1
                : mouseEvent.column >= routeLeft + layout.detailWidth + 1;
          setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, focus: scopeHit ? "scope" : "actions" }));
          return;
        }
      }
      const wheel = mouse ? wheelFromInput(input) : undefined;
      if (wheel) {
        if (taskDetailScopeHierarchy && taskDetailFocus === "scope") {
          selectTaskDetailCursor(taskDetailCursor + (wheel === "up" ? -1 : 1));
        } else if (currentBody?.kind === "repo.taskDetail") {
          const columns = stdout?.columns ?? 100;
          const rows = stdout?.rows ?? 24;
          const routeWidth = Math.max(1, columns - 2 - (sectionRailLayout(columns).width ? sectionRailLayout(columns).width + 1 : 0));
          const split = Boolean(taskDetailScopeHierarchy && taskDetailPaneVisible && taskDetailMaximized !== "detail");
          const layout = taskDetailLayout(routeWidth, split, Math.max(1, rows - 5), taskDetailLayoutMode);
          const detailWidth = taskDetailMaximized === "detail" || !layout.split ? routeWidth : layout.detailWidth;
          const max = taskDetailMaxScroll(currentBody.value, detailWidth, Math.max(0, rows - 5));
          const next = Math.max(0, Math.min(max, (frame.scrollOffset ?? 0) + (wheel === "up" ? -2 : 2)));
          dispatch({ type: "setScroll", offset: next });
        } else {
          selectCursor(effectiveCursor + (wheel === "up" ? -1 : 1));
        }
        return;
      }
      if (railFocused) {
        if (key.upArrow || input === "k") {
          setRailCursor((current) => Math.max(0, current - 1));
          return;
        }
        if (key.downArrow || input === "j") {
          setRailCursor((current) => Math.min(sectionRoutes.length - 1, current + 1));
          return;
        }
        if (key.leftArrow) return;
        if (key.rightArrow || input === "l" || key.escape) {
          setRailFocused(false);
          return;
        }
        if (key.return) {
          const selected = sectionRoutes[railCursor];
          if (selected && !selected.isStub) jumpToRoute(selected);
          setRailFocused(false);
          return;
        }
        if (input === "h") {
          setRailFocused(false);
          return;
        }
        if (input !== "?" && input !== "q") setRailFocused(false);
      }
      if (input === "?") { setHelpScroll(0); setHelpOpen(true); return; }
      if (input === "s" && currentBody?.kind === "repo.sprintBoard") {
        setSprintPickerOpen(true); setPaletteMode("sprint"); setPaletteOpen(true); setPaletteQuery(""); setPaletteCursor(0); return;
      }
      if (input === "d" && currentBody?.kind === "repo.sprintBoard") {
        const scopes = ["all", "assigned", "dependencies"];
        const scope = frame.filters?.clauses.find((clause) => clause.field === "scope")?.value ?? "all";
        dispatch({ type: "setFilters", filters: { query: sprintFilterLabel(frame.filters), sort: [], clauses: [{ field: "scope", operator: "is", value: scopes[(scopes.indexOf(scope) + 1) % scopes.length] }] } });
        return;
      }
      if (key.pageUp || key.pageDown || input === "g" || input === "G") {
        const step = Math.max(1, (stdout?.rows ?? 24) - 14);
        if (currentBody?.kind === "repo.taskDetail") {
          if (taskDetailScopeHierarchy && taskDetailFocus === "scope") {
            const treeStep = Math.max(1, (stdout?.rows ?? 24) - 10);
            selectTaskDetailCursor(
              input === "g"
                ? 0
                : input === "G"
                  ? taskDetailRowCount - 1
                  : taskDetailCursor + (key.pageUp ? -treeStep : treeStep)
            );
            return;
          }
          const routeWidth = Math.max(1, (stdout?.columns ?? 100) - 2 - (sectionRailLayout(stdout?.columns ?? 100).width ? sectionRailLayout(stdout?.columns ?? 100).width + 1 : 0));
          const layout = taskDetailLayout(
            routeWidth,
            Boolean(taskDetailScopeHierarchy && taskDetailPaneVisible && taskDetailMaximized !== "detail"),
            Math.max(1, (stdout?.rows ?? 24) - 5),
            taskDetailLayoutMode
          );
          const width = taskDetailMaximized === "detail" || !layout.split ? routeWidth : layout.detailWidth;
          const max = taskDetailMaxScroll(currentBody.value, width, Math.max(0, (stdout?.rows ?? 24) - 5));
          dispatch({ type: "setScroll", offset: input === "g" ? 0 : input === "G" ? max : Math.min(max, (frame.scrollOffset ?? 0) + (key.pageUp ? -step : step)) });
        } else {
          const cursor = input === "g" ? 0 : input === "G" ? listLength - 1 : effectiveCursor + (key.pageUp ? -step : step);
          selectCursor(cursor);
        }
        return;
      }
      const action = resolveRouteAction(specs, input, key);
      if (!action) return;
      if (action === "focusRail") {
        setRailFocused(true);
        const activeIndex = sectionRoutes.findIndex((route) => route.id === frame.routeId);
        if (activeIndex >= 0) setRailCursor(activeIndex);
        return;
      }
      if (action === "quit") {
        requestQuit();
        return;
      }
      if (action === "back") {
        if (atRoot(nav) && !nav.returnTo) {
          requestQuit();
          return;
        }
        dispatch({ type: "pop" });
        return;
      }
      if (action === "refresh") {
        requestRefresh();
        return;
      }
      if (action === "search") {
        if (currentBody?.kind === "repo.taskDetail" && taskDetailScopeHierarchy && taskDetailFocus === "scope") {
          setScopeFilterOpen(true);
          return;
        }
        setPaletteMode("search");
        setPaletteOpen(true);
        return;
      }
      if (action === "commandPalette") {
        setPaletteMode("command");
        setPaletteQuery("");
        setPaletteCursor(0);
        setPaletteOpen(true);
        return;
      }
      if (action === "toggleLive") {
        setLivePaused((current) => !current);
        return;
      }
      if (action === "theme") {
        const next = cycleColorMode(colorMode);
        setColorMode(next);
        setActiveColorMode(next);
        return;
      }
      if (action === "togglePreview" || action === "toggleMaximize" || action === "toggleLayout" || action === "toggleXray" || action === "toggleSelect" || action === "selectAll" || action === "batch") {
        if (currentBody?.kind !== "repo.taskDetail" || !taskDetailScopeHierarchy) return;
        if (action === "togglePreview") {
          setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, paneVisible: !taskDetailPaneVisible, maximized: undefined, focus: taskDetailPaneVisible && current.focus === "scope" ? "actions" : current.focus }));
          return;
        }
        if (action === "toggleMaximize") {
          setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, maximized: current.maximized ? undefined : current.focus === "scope" ? "scope" : "detail", paneVisible: true }));
          return;
        }
        if (action === "toggleLayout") {
          setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, layoutMode: current.layoutMode === "right" ? "bottom" : "right", maximized: undefined, paneVisible: true }));
          return;
        }
        if (action === "toggleXray") {
          setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, panel: current.panel === "tree" ? "xray" : "tree", focus: "scope", paneVisible: true, maximized: undefined }));
          return;
        }
        if (action === "toggleSelect") {
          const nodeId = taskDetailPanel === "xray"
            ? taskDetailXrayRowList[taskDetailCursor]?.nodeId
            : taskDetailRows[taskDetailCursor]?.node.id;
          if (!nodeId) return;
          setTaskDetailTree((current) => {
            const next = new Set(current.selectedIds);
            if (next.has(nodeId)) next.delete(nodeId);
            else next.add(nodeId);
            return { ...current, key: currentFrameKey, selectedIds: next, focus: "scope" };
          });
          return;
        }
        if (action === "selectAll") {
          setTaskDetailTree((current) => ({ ...current, key: currentFrameKey, selectedIds: new Set(taskDetailRows.map((row) => row.node.id)), focus: "scope" }));
          return;
        }
        if (action === "batch") {
          if (taskDetailBatchOptions.length === 0) return;
          setPaletteMode("batch");
          setPaletteQuery("");
          setPaletteCursor(0);
          setPaletteOpen(true);
        }
        return;
      }
      if (action === "filter") {
        if (currentBody?.kind === "repo.now") {
          setPaletteMode("now-scope");
          setPaletteQuery("");
          setPaletteCursor(0);
          setPaletteOpen(true);
          return;
        }
        dispatch({ type: "setFilters", filters: nextFilter(frame.routeId, frame.filters) });
        return;
      }
      if (action === "ready") {
        if (frame.routeId !== "repo.rollup") return;
        dispatch({ type: "setFilters", filters: ROLLUP_READY_FILTER });
        return;
      }
      if (action === "toggleFocus") {
        if (!taskDetailScopeHierarchy || currentBody?.kind !== "repo.taskDetail") return;
        setTaskDetailTree((current) => ({
          ...current,
          key: currentFrameKey,
          focus: taskDetailFocus === "scope" ? "actions" : "scope"
        }));
        return;
      }
      if (action === "toggleDisclosure" || action === "expand" || action === "collapse") {
        if (currentBody?.kind === "repo.taskDetail" && !taskDetailScopeHierarchy) {
          if (action === "collapse") {
            if (atRoot(nav) && !nav.returnTo) requestQuit();
            else dispatch({ type: "pop" });
          }
          return;
        }
        if (currentBody?.kind === "repo.taskDetail" && taskDetailScopeHierarchy) {
          if (taskDetailFocus !== "scope") {
            if (action === "collapse") dispatch({ type: "pop" });
            return;
          }
          if (taskDetailPanel === "xray") return;
          const row = taskDetailRows[taskDetailCursor];
          if (!row) return;
          if (row.node.childIds.length === 0) {
            if (action === "expand") handleDrill();
            return;
          }
          const expanded = taskDetailExpandedIds.has(row.node.id);
          if ((action === "expand" && expanded) || (action === "collapse" && !expanded)) {
            if (action === "collapse") {
              const parentIndex = taskDetailRows.findIndex((candidate) => candidate.node.id === row.node.parentId);
              if (parentIndex >= 0) selectTaskDetailCursor(parentIndex);
            }
            return;
          }
          setTaskDetailTree((current) => ({
            ...current,
            key: currentFrameKey,
            expandedIds: action === "collapse"
              ? new Set([...taskDetailExpandedIds].filter((id) => id !== row.node.id))
              : action === "expand"
                ? new Set([...taskDetailExpandedIds, row.node.id])
                : new Set(taskDetailExpandedIds.has(row.node.id)
                  ? [...taskDetailExpandedIds].filter((id) => id !== row.node.id)
                  : [...taskDetailExpandedIds, row.node.id])
          }));
          return;
        }
        if (currentBody?.kind === "repo.milestones") {
          const expandedIds = milestoneDisclosure.key === currentFrameKey ? milestoneDisclosure.ids : new Set<string>();
          const rows = visibleMilestoneRows(currentBody.value, expandedIds);
          const row = rows[effectiveCursor];
          if (!row) return;
          if (row.node.childIds.length === 0) {
            if (action === "expand") handleDrill();
            return;
          }
          const expanded = expandedIds.has(row.node.id);
          if ((action === "expand" && expanded) || (action === "collapse" && !expanded)) {
            if (action === "collapse") {
              const parentIndex = rows.findIndex((candidate) => candidate.node.id === row.node.parentId);
              if (parentIndex >= 0) selectCursor(parentIndex);
            }
            return;
          }
          setMilestoneDisclosure({
            key: currentFrameKey,
            ids: action === "collapse"
              ? new Set([...expandedIds].filter((id) => id !== row.node.id))
              : action === "expand"
                ? new Set([...expandedIds, row.node.id])
                : new Set(expandedIds.has(row.node.id)
                  ? [...expandedIds].filter((id) => id !== row.node.id)
                  : [...expandedIds, row.node.id])
          });
          return;
        }
        if (currentBody?.kind !== "repo.rollup") return;
        const expandedIds = rollupDisclosure.key === currentFrameKey
          ? rollupDisclosure.ids
          : defaultRollupDisclosure(currentBody.value);
        const node = rollupRowAt(currentBody.value, effectiveCursor, frame.filters, expandedIds);
        if (!node || node.childIds.length === 0) {
          // Preserve the former l/Right affordance for leaf work while using
          // the same keys as disclosure controls for actual tree containers.
          if (node && action === "expand") {
            handleDrill();
            return;
          }
          if (action === "collapse") {
            const parentId = node ? rollupParentRowId(currentBody.value, node.id) : undefined;
            const parentIndex = parentId ? rowIds.indexOf(parentId) : -1;
            if (parentIndex >= 0) selectCursor(parentIndex);
          }
          return;
        }
        const expanded = expandedIds.has(node.id);
        if ((action === "expand" && expanded) || (action === "collapse" && !expanded)) {
          if (action === "collapse") {
            const parentId = rollupParentRowId(currentBody.value, node.id);
            const parentIndex = parentId ? rowIds.indexOf(parentId) : -1;
            if (parentIndex >= 0) selectCursor(parentIndex);
          }
          return;
        }
        setRollupDisclosure((current) => ({
          key: currentFrameKey,
          ids: action === "toggleDisclosure"
            ? toggleRollupDisclosure(expandedIds, node.id)
            : action === "expand"
              ? new Set([...expandedIds, node.id])
              : new Set([...expandedIds].filter((id) => id !== node.id)),
          knownIds: current.key === currentFrameKey
            ? current.knownIds
            : new Set(currentBody.value.flatRows.map((candidate) => candidate.id))
        }));
        return;
      }
      const actionName = action as string;
      if (actionName === "previousSprint" || actionName === "nextSprint") {
        if (currentBody?.kind !== "repo.sprintBoard" || currentBody.value.sprints.length === 0) return;
        const currentIndex = Math.max(0, currentBody.value.sprints.findIndex((sprint) => sprint.view.id === currentBody.value.selectedSprintId));
        const delta = actionName === "previousSprint" ? -1 : 1;
        const nextIndex = (currentIndex + delta + currentBody.value.sprints.length) % currentBody.value.sprints.length;
        const selected = currentBody.value.sprints[nextIndex];
        if (!selected) return;
        dispatch({
          type: "jump",
          session: {
            ...nav.current,
            stack: [
              ...nav.current.stack.slice(0, -1),
              { ...frame, title: selected.view.title, cursor: 0, entity: selected.view.kind === "sprint" ? { kind: "sprint", id: selected.view.id, workspaceRoot: nav.current.workspaceRoot, label: selected.view.title } : frame.entity }
            ]
          }
        });
        return;
      }
      if (action.startsWith("numberKey:")) {
        const route = routeByNumberKey(nav.current.surface, Number(action.slice("numberKey:".length)));
        if (route && !route.isStub && atRoot(nav)) jumpToRoute(route);
        return;
      }
      if (action === "move") {
        const delta = key.upArrow || input === "k" ? -1 : 1;
        if (taskDetailScopeHierarchy && taskDetailFocus === "scope") selectTaskDetailCursor(taskDetailCursor + delta);
        else selectCursor(effectiveCursor + delta);
        return;
      }
      if (action === "drill") {
        handleDrill();
      }
    },
    [colorMode, closePalette, commandError, commandRunning, confirming, currentBody, currentFrameKey, effectiveCursor, frame, handleDrill, helpOpen, listLength, livePaused, milestoneDisclosure, mouse, nav, paletteCursor, paletteOpen, paletteResults, railCursor, railFocused, requestRefresh, requestQuit, runDescriptor, scopeFilterOpen, sectionRoutes, selectCursor, selectTaskDetailCursor, specs, sprintPickerOpen, stdout, taskDetailBatchOptions, taskDetailCursor, taskDetailExpandedIds, taskDetailFocus, taskDetailLayoutMode, taskDetailMaximized, taskDetailPanel, taskDetailPaneVisible, taskDetailRowCount, taskDetailRows, taskDetailScopeHierarchy, taskDetailXrayRowList]
  );

  const { rows, columns } = terminalSize;
  const bodyHeight = Math.max(0, rows - 5);
  const railLayout = sectionRailLayout(columns);
  const bodyWidth = Math.max(1, columns - 2 - (railLayout.width > 0 ? railLayout.width + 1 : 0));
  const stale = currentEnvelope?.stale ?? false;
  const warningCount = currentEnvelope?.warnings.length ?? 0;
  const blocked = actionsBlocked(unsupportedRoute, loading, error, currentEnvelope);
  const currentFilterLabel = frame.routeId === "repo.now" && currentBody?.kind === "repo.now"
    ? nowScopeFilterLabel(currentBody.value, frame.filters)
    : filterLabel(frame.routeId, frame.filters);
  const rail = railFor(nav.current.surface).map((route) => ({ id: route.id, label: route.label, key: String(route.numberKey) }));
  const selectedRailId = sectionRoutes[railCursor]?.id ?? frame.routeId;
  const sectionHint = rail.length > 1 ? `1-${rail.length}` : undefined;
  const routeHints = routeFooterHints(specs)
    .filter((hint) => !unsupportedRoute || !["open", "refresh", "filter"].includes(hint.label))
    .filter((hint) => hint.label !== "sections" || sectionHint !== undefined)
    .filter((hint) => !(frame.routeId === REPO_TASK_DETAIL_ROUTE && !taskDetailScopeHierarchy && ["fold", "expand", "collapse", "focus", "preview", "maximize", "right/bottom", "xray", "mark", "mark all", "batch"].includes(hint.label)))
    .map((hint) => {
      if (hint.label === "sections" && sectionHint) return { ...hint, keys: sectionHint };
      if (frame.routeId === "repo.now" && hint.label === "filter") return { ...hint, label: "scope" };
      if (frame.routeId === REPO_TASK_DETAIL_ROUTE && (hint.label === "open" || hint.label === "run action")) return { ...hint, label: "action" };
      if (frame.routeId === REPO_TASK_DETAIL_ROUTE && hint.label === "jump" && taskDetailFocus === "scope") return { ...hint, label: "filter" };
      return hint;
    });

  const footerHints = confirming
    ? [
        { keys: "enter", label: "run" },
        { keys: "esc", label: "cancel" }
      ]
    : paletteOpen
      ? [
          { keys: "type", label: "filter" },
          { keys: "↑↓", label: "move" },
          { keys: "⏎", label: "go" },
          { keys: "esc", label: "close" }
        ]
      : scopeFilterOpen
        ? [{ keys: "type", label: "filter child work" }, { keys: "enter", label: "keep" }, { keys: "esc", label: "clear" }]
      : railFocused
        ? [
            { keys: "↑↓/jk", label: "sections" },
            { keys: "enter", label: "open section" },
            { keys: "→/l", label: "content" },
            { keys: "?", label: "help" },
            { keys: "q", label: "quit" }
          ]
      : quitArmed
        ? [{ keys: "q/^c", label: "press again to quit" }]
        : [
            { keys: "?", label: "help" },
            ...routeHints,
            ...(frame.routeId === "repo.sprintBoard" ? [{ keys: "s", label: "sprint" }, { keys: "d", label: "scope" }] : []),
            ...(frame.routeId === REPO_TASK_DETAIL_ROUTE
              ? taskDetailScopeHierarchy && taskDetailFocus === "scope"
                ? [{ keys: "PgUp/PgDn", label: "tree page" }, { keys: "g/G", label: "tree top/end" }, { keys: "click", label: "focus pane" }]
                : [{ keys: "PgUp/PgDn", label: "scroll" }, { keys: "g/G", label: "top/bottom" }]
              : [])
          ];

  if (rows < 8 || columns < 24) return <Box width={columns} height={rows} overflow="hidden"><Text wrap="truncate">Resize terminal (24×8 minimum). q quits.</Text>{isRawModeSupported ? <KeyBindings onKey={handleKey} /> : null}</Box>;

  return (
    <Box flexDirection="column" width={columns} height={rows} overflow="hidden">
      {interactiveTerminal ? <AltScreenLifecycle enableMouse={mouse && isRawModeSupported} /> : null}
      {isRawModeSupported ? <KeyBindings onKey={handleKey} /> : null}
      <TopBar crumbs={breadcrumbs(nav)} right={`${livePaused ? "PAUSED" : "LIVE"} · ${colorModeLabel(colorMode)} · ${Math.round(normalizeRefreshInterval(refreshMs) / 1000)}s${loading ? " ↻" : ""}`} width={columns} />
      <Box paddingX={1}>
        <FreshnessLine generatedAt={currentEnvelope?.generatedAt} label={nav.current.projectName ?? nav.current.workspaceRoot.split("/").filter(Boolean).at(-1) ?? nav.current.surface} filter={currentFilterLabel} error={error} stale={stale} frozen={livePaused} warnings={warningCount} blocked={blocked && !loading} width={columns - 2} />
      </Box>
      <Box height={bodyHeight + 2} paddingX={1} paddingY={1} overflow="hidden">
        <SectionRail sections={rail} active={railFocused ? selectedRailId : frame.routeId} focused={railFocused} width={columns} />
        <Box flexDirection="column" width={bodyWidth} height={bodyHeight} overflow="hidden">
          {helpOpen ? (
            <HelpView width={bodyWidth} height={bodyHeight} hints={routeHints} workspace={nav.current.workspaceRoot} scrollOffset={helpScroll} diagnostics={[...(error ? [error] : []), ...(currentEnvelope?.warnings ?? [])]} />
          ) : confirming ? (
            <CommandConfirmPanel descriptor={confirming} running={commandRunning} error={commandError} width={bodyWidth} height={bodyHeight} scrollOffset={commandScroll} />
          ) : paletteOpen ? (
            <Palette query={paletteQuery} results={paletteResults} cursor={paletteCursor} height={bodyHeight} width={bodyWidth} title={sprintPickerOpen ? "Choose sprint" : paletteMode === "command" ? "Command palette" : paletteMode === "batch" ? "Batch actions" : paletteMode === "now-scope" ? "Filter Now by milestone or sprint" : searchError ? "Search unavailable; showing loaded items" : "Search work and routes"} />
          ) : error && !currentBody ? (
            <EmptyState title={unsupportedRoute ? "Unsupported route" : error.includes("locked by another writer") ? "Workspace busy" : "Data unavailable"} lines={[error, "Retrying automatically; press r to retry or esc to return."]} width={bodyWidth} />
          ) : !currentBody ? (
            <Text color={COLOR.muted}>Loading…</Text>
          ) : (
            <Box flexDirection="column" height={bodyHeight} overflow="hidden">
              <RouteBodyView
                body={currentBody}
                cursor={effectiveCursor}
                height={bodyHeight}
                width={bodyWidth}
                filters={frame.filters}
                envelope={currentEnvelope}
                expandedIds={rollupDisclosure.key === currentFrameKey ? rollupDisclosure.ids : undefined}
                milestoneExpandedIds={milestoneDisclosure.key === currentFrameKey ? milestoneDisclosure.ids : undefined}
                scrollOffset={frame.scrollOffset ?? 0}
                taskDetailTreeCursor={taskDetailCursor}
                taskDetailExpandedIds={taskDetailExpandedIds}
                taskDetailFocus={taskDetailFocus}
                taskDetailPaneVisible={taskDetailPaneVisible}
                taskDetailMaximized={taskDetailMaximized}
                taskDetailLayoutMode={taskDetailLayoutMode}
                taskDetailPanel={taskDetailPanel}
                taskDetailSelectedIds={taskDetailSelectedIds}
                taskDetailFilterQuery={scopeFilterQuery}
                taskDetailFilterOpen={scopeFilterOpen}
              />
            </Box>
          )}
        </Box>
      </Box>
      <KeyHints hints={footerHints} width={columns} />
    </Box>
  );
}

function AltScreenLifecycle({ enableMouse }: { readonly enableMouse: boolean }): null {
  useAltScreen(enableMouse);
  return null;
}


function actionsBlocked(
  unsupportedRoute: boolean,
  loading: boolean,
  error: string | undefined,
  envelope: TuiEnvelope<unknown> | undefined
): boolean {
  return unsupportedRoute || loading || Boolean(error) || Boolean(envelope?.error) || Boolean(envelope?.stale) || (envelope?.warnings.length ?? 0) > 0 || hasTruncation(envelope?.truncated);
}

function hasTruncation(truncated: TuiEnvelope<unknown>["truncated"] | undefined): boolean {
  return Boolean(truncated && Object.values(truncated).some(Boolean));
}

function KeyBindings({ onKey }: { readonly onKey: (input: string, key: Key) => void }) {
  const latest = useRef(onKey);
  latest.current = onKey;
  const handleInput = useCallback((input: string, key: Key) => latest.current(input, key), []);
  useInput(handleInput, { isActive: true });
  return null;
}


function RouteBodyView({
  body,
  cursor,
  height,
  width,
  filters,
  envelope,
  expandedIds,
  milestoneExpandedIds,
  scrollOffset,
  taskDetailTreeCursor,
  taskDetailExpandedIds,
  taskDetailFocus,
  taskDetailPaneVisible,
  taskDetailMaximized,
  taskDetailLayoutMode,
  taskDetailPanel,
  taskDetailSelectedIds,
  taskDetailFilterQuery,
  taskDetailFilterOpen
}: {
  readonly body: RouteBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly filters?: TuiFilterState;
  readonly envelope?: TuiEnvelope<unknown>;
  readonly expandedIds?: RollupDisclosureState;
  readonly milestoneExpandedIds?: ReadonlySet<string>;
  readonly scrollOffset: number;
  readonly taskDetailTreeCursor: number;
  readonly taskDetailExpandedIds: ReadonlySet<string>;
  readonly taskDetailFocus: TaskDetailFocus;
  readonly taskDetailPaneVisible: boolean;
  readonly taskDetailMaximized?: TaskDetailMaximizedPane;
  readonly taskDetailLayoutMode: TaskDetailLayoutMode;
  readonly taskDetailPanel: TaskDetailPanel;
  readonly taskDetailSelectedIds: ReadonlySet<string>;
  readonly taskDetailFilterQuery: string;
  readonly taskDetailFilterOpen: boolean;
}) {
  const state: GlobalRouteState | undefined = envelope
    ? { stale: envelope.stale, truncated: hasTruncation(envelope.truncated), warnings: envelope.warnings }
    : undefined;
  switch (body.kind) {
    case "global.overview":
      return <GlobalOverviewRoute body={body.value} cursor={cursor} height={height} width={width} state={state} />;
    case "global.projects":
      return <GlobalProjectsRoute body={body.value} cursor={cursor} height={height} width={width} state={state} />;
    case "global.queues":
      return <GlobalQueuesRoute body={body.value} cursor={cursor} height={height} width={width} filters={filters} state={state} />;
    case "repo.now":
      return <RepoNowRoute body={body.value} cursor={cursor} height={height} width={width} filters={filters} />;
    case "repo.rollup":
      return <RepoRollupRoute body={body.value} cursor={cursor} height={height} width={width} filters={filters} expandedIds={expandedIds} />;
    case "repo.milestones":
      return <RepoMilestonesRoute body={body.value} cursor={cursor} height={height} width={width} expandedIds={milestoneExpandedIds} />;
    case "repo.sprints":
      return <RepoSprintsRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "repo.work":
      return <RepoWorkRoute body={body.value} cursor={cursor} height={height} width={width} filters={filters} />;
    case "repo.ops":
      return <RepoOpsRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "repo.sprintBoard":
      return <SprintBoardRoute body={body.value} cursor={cursor} height={height} width={width} filters={filters} />;
    case "repo.taskDetail":
      return <TaskDetailRoute body={body.value} width={width} height={height} selectedActionIndex={cursor} scrollOffset={scrollOffset} treeCursor={taskDetailTreeCursor} expandedIds={taskDetailExpandedIds} focus={taskDetailFocus} paneVisible={taskDetailPaneVisible} maximized={taskDetailMaximized} layoutMode={taskDetailLayoutMode} panel={taskDetailPanel} selectedIds={taskDetailSelectedIds} filterQuery={taskDetailFilterQuery} filterOpen={taskDetailFilterOpen} />;
    default:
      return <EmptyState title="Planned" lines={["This route is out of v1 scope.", "See docs/architecture/TUI_SURFACE_CONTRACTS.md."]} />;
  }
}
