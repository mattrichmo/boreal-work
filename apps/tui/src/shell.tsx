import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from "ink";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { OpenRepoTarget, TuiCommandDescriptor, TuiEnvelope, TuiEntityKind, TuiFilterState } from "@boreal/ui-model";
import { CommandConfirmPanel } from "./command-panel.js";
import { DEFAULT_TUI_REFRESH_MS, normalizeRefreshInterval, watchHead } from "./head-poll.js";
import {
  loadGlobalOverview,
  loadGlobalProjects,
  loadGlobalQueues,
  loadRepoRollup,
  loadRepoSprintBoard,
  loadRepoTaskDetail,
  invalidateGlobalDashboardCache,
  type GlobalOverviewBody,
  type RepoSprintBoardBody,
  type RepoTaskDetailBody
} from "./loaders.js";
import { bindingsForRoute, resolveRouteAction, routeFooterHints } from "./route-bindings.js";
import { atRoot, breadcrumbs, initialRouteNavState, reduceRouteNav, rootFrame, topFrame } from "./route-nav.js";
import { GlobalOverviewRoute, type GlobalRouteState } from "./routes/global-overview.js";
import { GlobalProjectsRoute } from "./routes/global-projects.js";
import { filteredQueueItems, GlobalQueuesRoute, queueFilterLabel, queueRowAt, QUEUE_FILTER_CYCLE } from "./routes/global-queues.js";
import {
  defaultRollupDisclosure,
  rollupFilterLabel,
  rollupRowAt,
  visibleRollupRows,
  RepoRollupRoute,
  ROLLUP_FILTER_CYCLE,
  toggleRollupDisclosure,
  type RollupDisclosureState
} from "./routes/rollup.js";
import { SprintBoardRoute } from "./routes/sprint-board.js";
import { TaskDetailRoute, taskActionDisplay } from "./routes/task-detail.js";
import { railFor, routeById, routeByNumberKey, REPO_TASK_DETAIL_ROUTE, type RouteSpec } from "./routes.js";
import { useAltScreen, wheelFromInput } from "./runtime.js";
import { COLOR } from "./theme.js";
import { EmptyState, KeyHints, SectionRail, sectionRailLayout, Table, TopBar, type TableColumn, type TableRow } from "./ui.js";
import type { ProjectRegistryView, GlobalWorkQueuesView, RepoRollupView } from "@boreal/ui-model";

const execFileAsync = promisify(execFile);

type RouteBody =
  | { readonly kind: "global.overview"; readonly value: GlobalOverviewBody }
  | { readonly kind: "global.projects"; readonly value: ProjectRegistryView }
  | { readonly kind: "global.queues"; readonly value: GlobalWorkQueuesView }
  | { readonly kind: "repo.rollup"; readonly value: RepoRollupView }
  | { readonly kind: "repo.sprintBoard"; readonly value: RepoSprintBoardBody }
  | { readonly kind: "repo.taskDetail"; readonly value: RepoTaskDetailBody };

// Per-route status-facet cycles (decision #6: "f cycles simple enumerated
// filters per route (status facets only in v1)"). Routes not listed here
// have no facet, and `filter` is not offered in their binding specs.
const FILTER_CYCLES: Readonly<Record<string, readonly (TuiFilterState | undefined)[]>> = {
  "repo.rollup": ROLLUP_FILTER_CYCLE,
  "global.queues": QUEUE_FILTER_CYCLE
};

function nextFilter(routeId: string, current: TuiFilterState | undefined): TuiFilterState | undefined {
  const cycle = FILTER_CYCLES[routeId];
  if (!cycle) return current;
  const index = cycle.findIndex((candidate) => JSON.stringify(candidate) === JSON.stringify(current));
  return cycle[(Math.max(0, index) + 1) % cycle.length];
}

function filterLabel(routeId: string, filters: TuiFilterState | undefined): string | undefined {
  if (routeId === "repo.rollup") return rollupFilterLabel(filters);
  if (routeId === "global.queues") return queueFilterLabel(filters);
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

async function loadForFrame(
  workspaceRoot: string,
  routeId: string,
  entityId: string | undefined,
  entityKind?: TuiEntityKind
): Promise<{ readonly envelope: TuiEnvelope<unknown>; readonly body: RouteBody } | undefined> {
  switch (routeId) {
    case "global.overview": {
      const envelope = await loadGlobalOverview(workspaceRoot);
      return { envelope, body: { kind: "global.overview", value: envelope.body } };
    }
    case "global.projects": {
      const envelope = await loadGlobalProjects(workspaceRoot);
      return { envelope, body: { kind: "global.projects", value: envelope.body } };
    }
    case "global.queues": {
      const envelope = await loadGlobalQueues(workspaceRoot);
      return { envelope, body: { kind: "global.queues", value: envelope.body } };
    }
    case "repo.rollup": {
      const envelope = await loadRepoRollup(workspaceRoot);
      return { envelope, body: { kind: "repo.rollup", value: envelope.body } };
    }
    case "repo.sprintBoard": {
      const envelope = await loadRepoSprintBoard(workspaceRoot, entityId);
      return { envelope, body: { kind: "repo.sprintBoard", value: envelope.body } };
    }
    case "repo.taskDetail": {
      if (!entityId) return undefined;
      const envelope = await loadRepoTaskDetail(workspaceRoot, entityId, entityKind);
      if (!envelope) return undefined;
      return { envelope, body: { kind: "repo.taskDetail", value: envelope.body } };
    }
    default:
      return undefined;
  }
}

function activeListLength(
  body: RouteBody | undefined,
  filters: TuiFilterState | undefined,
  rollupExpandedIds?: RollupDisclosureState
): number {
  if (!body) return 0;
  switch (body.kind) {
    case "global.overview":
      return body.value.attention.length;
    case "global.projects":
      return body.value.entries.length;
    case "global.queues":
      return filteredQueueItems(body.value, filters).length;
    case "repo.rollup":
      // Must match the exact row list the table renders (visibleRollupRows),
      // not flatRows -- collapsed subtrees are shorter than the full tree,
      // and the status facet can hide leaves further.
      return visibleRollupRows(body.value, filters, rollupExpandedIds).length;
    case "repo.sprintBoard":
      return body.value.board?.lanes.flatMap((lane) => lane.items).length ?? 0;
    case "repo.taskDetail":
      return body.value.actions.length;
    default:
      return 0;
  }
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
  const { isRawModeSupported } = useStdin();
  const interactiveTerminal = process.stdin.isTTY === true && stdout?.isTTY === true;

  const surface = global ? "global" : "repo";
  const initialRoute = global ? "global.overview" : "repo.rollup";
  const initialTitle = global ? "Overview" : "Roll-Up";
  const [nav, dispatch] = useReducer(reduceRouteNav, undefined, () =>
    initialRouteNavState(surface, workspaceRoot, initialRoute, initialTitle)
  );

  const [body, setBody] = useState<RouteBody | undefined>();
  const [envelope, setEnvelope] = useState<TuiEnvelope<unknown> | undefined>();
  const [loadedFrameKey, setLoadedFrameKey] = useState<string | undefined>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState<TuiCommandDescriptor | undefined>();
  const [commandRunning, setCommandRunning] = useState(false);
  const [commandError, setCommandError] = useState<string | undefined>();
  const [quitArmed, setQuitArmed] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteCursor, setPaletteCursor] = useState(0);
  const [rollupDisclosure, setRollupDisclosure] = useState<{
    readonly key?: string;
    readonly ids: RollupDisclosureState;
    readonly knownIds: ReadonlySet<string>;
  }>({ ids: new Set<string>(), knownIds: new Set<string>() });
  const refreshGenerationRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | undefined>(undefined);
  const activeRequestKeyRef = useRef<string | undefined>(undefined);
  const loadingRef = useRef(false);

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
  const currentBody = loadedFrameKey === currentFrameKey ? body : undefined;
  const currentEnvelope = loadedFrameKey === currentFrameKey ? envelope : undefined;
  const listLength = activeListLength(currentBody, frame.filters, rollupDisclosure.key === currentFrameKey ? rollupDisclosure.ids : undefined);
  // The stored frame cursor can point past the end right after a filter
  // cycle or a refresh returns fewer rows (nothing clamps it until the next
  // arrow key) -- so render and drill lookups both use this effective,
  // always-in-bounds cursor rather than frame.cursor directly.
  const effectiveCursor = Math.min(frame.cursor, Math.max(0, listLength - 1));
  const specs = useMemo(() => bindingsForRoute(frame.routeId), [frame.routeId]);

  const paletteResults = useMemo(() => {
    if (!paletteOpen) return [];
    const query = paletteQuery.trim().toLowerCase();
    return railFor(nav.current.surface).filter(
      (route) => !route.isStub && (query === "" || route.label.toLowerCase().includes(query))
    );
  }, [paletteOpen, paletteQuery, nav.current.surface]);

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
      const result = await abortable(loadForFrame(identity.workspaceRoot, identity.routeId, identity.entityId, frame.entity?.kind), controller.signal);
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
    } finally {
      if (isRefreshCurrent(generation, refreshGenerationRef.current, controller.signal)) {
        loadingRef.current = false;
        activeRequestKeyRef.current = undefined;
        setLoading(false);
        setNow(Date.now());
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
    setCommandError(undefined);
    void refresh({ force: true });
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
    if (currentBody?.kind !== "global.projects" || frame.entity?.kind !== "project") return;
    const targetIndex = currentBody.value.entries.findIndex((entry) => entry.id === frame.entity?.id);
    if (targetIndex >= 0 && frame.cursor !== targetIndex) {
      dispatch({ type: "setCursor", cursor: targetIndex });
    }
  }, [currentBody, frame.cursor, frame.entity?.id, frame.entity?.kind]);

  // Refresh contract: watch the event-log head for the current workspace;
  // an advanced seq refetches only the current route payload.
  useEffect(() => {
    const intervalMs = normalizeRefreshInterval(refreshMs);
    if (nav.current.surface === "repo") {
      return watchHead(nav.current.workspaceRoot, () => void refresh({ force: true }), intervalMs);
    }
    const timer = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(timer);
  }, [nav.current.surface, nav.current.workspaceRoot, refresh, refreshMs]);

  useEffect(() => {
    return () => {
      refreshGenerationRef.current += 1;
      refreshAbortRef.current?.abort();
      loadingRef.current = false;
      activeRequestKeyRef.current = undefined;
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
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
        await execFileAsync(process.env.BOREAL_TUI_CLI ?? "bwrk", [...descriptor.argv, "--json"], {
          cwd: descriptor.workspaceRoot,
          maxBuffer: 16 * 1024 * 1024,
          timeout: 30_000,
          killSignal: "SIGTERM"
        });
        setConfirming(undefined);
        await refresh({ force: true });
      } catch (caught) {
        setCommandError(formatCommandFailure(caught));
      } finally {
        setCommandRunning(false);
      }
    },
    [currentEnvelope, error, loading, refresh, unsupportedRoute]
  );

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
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

  const handleDrill = useCallback((): void => {
    if (!currentBody) return;
    if (currentBody.kind === "repo.rollup") {
      const expandedIds = rollupDisclosure.key === currentFrameKey ? rollupDisclosure.ids : undefined;
      const node = rollupRowAt(currentBody.value, effectiveCursor, frame.filters, expandedIds);
      if (!node) return;
      if (node.kind === "milestone") {
        if (node.childIds.length > 0) {
          setRollupDisclosure((current) => ({
            key: currentFrameKey,
            ids: toggleRollupDisclosure(current.key === currentFrameKey ? current.ids : defaultRollupDisclosure(currentBody.value), node.id),
            knownIds: current.key === currentFrameKey ? current.knownIds : new Set(currentBody.value.flatRows.map((candidate) => candidate.id))
          }));
        } else {
          dispatch({ type: "push", frame: { routeId: "repo.taskDetail", title: node.title, cursor: 0, entity: node.entity } });
        }
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
      const task = currentBody.value.board?.lanes.flatMap((lane) => lane.items)[effectiveCursor];
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
      if (actionsBlocked(unsupportedRoute, loading, error, currentEnvelope)) return;
      const action = currentBody.value.actions[effectiveCursor];
      if (action) {
        const display = taskActionDisplay(action, currentBody.value.work);
        if (display.disabled) {
          setCommandError(display.reason ?? "This action is unavailable.");
        } else {
          setCommandError(undefined);
        }
        setConfirming(action);
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
  }, [currentBody, currentEnvelope, currentFrameKey, effectiveCursor, error, frame, loading, nav.current.workspaceRoot, registryRoot, rollupDisclosure, unsupportedRoute]);

  const handleKey = useCallback(
    (input: string, key: Key) => {
      if (key.ctrl && input === "c") {
        requestQuit();
        return;
      }
      if (confirming) {
        if (key.escape) {
          setConfirming(undefined);
          setCommandError(undefined);
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
          const route = paletteResults[paletteCursor];
          if (route) jumpToRoute(route);
          closePalette();
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
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setPaletteQuery((current) => current + input);
          setPaletteCursor(0);
        }
        return;
      }
      const wheel = mouse ? wheelFromInput(input) : undefined;
      if (wheel) {
        dispatch({
          type: "setCursor",
          cursor: Math.max(0, Math.min(frame.cursor + (wheel === "up" ? -1 : 1), Math.max(0, listLength - 1)))
        });
        return;
      }
      const action = resolveRouteAction(specs, input, key);
      if (!action) return;
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
        void refresh({ force: true });
        return;
      }
      if (action === "search") {
        setPaletteOpen(true);
        return;
      }
      if (action === "filter") {
        dispatch({ type: "setFilters", filters: nextFilter(frame.routeId, frame.filters) });
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
        dispatch({ type: "setCursor", cursor: Math.max(0, Math.min(frame.cursor + delta, Math.max(0, listLength - 1))) });
        return;
      }
      if (action === "drill") {
        handleDrill();
      }
    },
    [closePalette, commandRunning, confirming, currentBody, frame, handleDrill, listLength, mouse, nav, paletteCursor, paletteOpen, paletteResults, refresh, requestQuit, specs]
  );

  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 100;
  const bodyHeight = Math.max(6, rows - 6);
  const railLayout = sectionRailLayout(columns);
  const bodyWidth = Math.max(12, columns - 2 - (railLayout.width > 0 ? railLayout.width + 1 : 0));
  const ageSec = currentEnvelope ? Math.max(0, Math.round((now - new Date(currentEnvelope.generatedAt).getTime()) / 1000)) : undefined;
  const stale = currentEnvelope?.stale ?? false;
  const warningCount = currentEnvelope?.warnings.length ?? 0;
  const blocked = actionsBlocked(unsupportedRoute, loading, error, currentEnvelope);
  const currentFilterLabel = filterLabel(frame.routeId, frame.filters);
  const rail = railFor(nav.current.surface).map((route) => ({ id: route.id, label: route.label, key: String(route.numberKey) }));
  const sectionHint = rail.length > 1 ? `1-${rail.length}` : undefined;
  const routeHints = routeFooterHints(specs)
    .filter((hint) => !unsupportedRoute || !["open", "refresh", "filter"].includes(hint.label))
    .filter((hint) => hint.label !== "sections" || sectionHint !== undefined)
    .map((hint) => {
      if (hint.label === "sections" && sectionHint) return { ...hint, keys: sectionHint };
      if (frame.routeId === REPO_TASK_DETAIL_ROUTE && hint.label === "open") return { ...hint, label: "run" };
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
      : quitArmed
        ? [{ keys: "q/^c", label: "press again to quit" }]
        : routeHints;

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {interactiveTerminal ? <AltScreenLifecycle enableMouse={mouse && isRawModeSupported} /> : null}
      {isRawModeSupported ? <KeyBindings onKey={handleKey} /> : null}
      <TopBar crumbs={breadcrumbs(nav)} right={loading ? "↻" : ""} width={columns} />
      <Box paddingX={1}>
        <Text color={COLOR.faint} wrap="truncate">
          {`${nav.current.surface} · ${nav.current.workspaceRoot}`}
          {currentFilterLabel ? `  ·  filter: ${currentFilterLabel}` : ""}
          {stale ? "  ·  STALE" : ""}
          {warningCount > 0 ? `  ·  ${warningCount} warning${warningCount === 1 ? "" : "s"}` : ""}
          {ageSec !== undefined ? `  ·  data: ${ageSec}s old` : ""}
        </Text>
      </Box>
      <Box flexGrow={1} paddingX={1} paddingY={1}>
        <SectionRail sections={rail} active={frame.routeId} width={columns} />
        <Box flexDirection="column" flexGrow={1}>
          {error ? <Text color={COLOR.danger}>{`! ${error}`}</Text> : null}
          {currentEnvelope?.warnings.map((warning) => <Text key={warning} color={COLOR.warn} wrap="truncate">{`⚠ ${warning}`}</Text>)}
          {blocked && !loading && !error && !unsupportedRoute ? (
            <Text color={COLOR.warn}>Read-only: refresh and resolve warnings before running state-changing actions.</Text>
          ) : null}
          {confirming ? (
            <CommandConfirmPanel descriptor={confirming} running={commandRunning} error={commandError} width={bodyWidth} />
          ) : paletteOpen ? (
            <Palette query={paletteQuery} results={paletteResults} cursor={paletteCursor} height={bodyHeight} width={bodyWidth} />
          ) : error && !currentBody ? (
            <EmptyState title={unsupportedRoute ? "Unsupported route" : "Data unavailable"} lines={[error, "Press r to retry or esc to return."]} width={bodyWidth} />
          ) : !currentBody ? (
            <Text color={COLOR.muted}>Loading…</Text>
          ) : (
            <Box flexDirection="column">
              {loading ? <Text color={COLOR.muted}>Revalidating…</Text> : null}
              <RouteBodyView
                body={currentBody}
                cursor={effectiveCursor}
                height={bodyHeight}
                width={bodyWidth}
                filters={frame.filters}
                envelope={currentEnvelope}
                expandedIds={rollupDisclosure.key === currentFrameKey ? rollupDisclosure.ids : undefined}
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
  useInput(onKey, { isActive: true });
  return null;
}

function Palette({
  query,
  results,
  cursor,
  height,
  width
}: {
  readonly query: string;
  readonly results: readonly RouteSpec[];
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const columns: readonly TableColumn[] = [{ header: "route", width: Math.max(20, width - 4) }];
  const rows: readonly TableRow[] = results.map((route) => ({ key: route.id, cells: [{ text: route.label, color: COLOR.text }] }));
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={COLOR.accent} bold>
          {"❯ "}
        </Text>
        <Text color={COLOR.text}>{query}</Text>
        <Text color={COLOR.accent}>▌</Text>
      </Text>
      <Box marginTop={1}>
        <Table columns={columns} rows={rows} cursor={cursor} height={height - 3} width={width} emptyLabel="No matching routes." />
      </Box>
    </Box>
  );
}

function RouteBodyView({
  body,
  cursor,
  height,
  width,
  filters,
  envelope,
  expandedIds
}: {
  readonly body: RouteBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly filters?: TuiFilterState;
  readonly envelope?: TuiEnvelope<unknown>;
  readonly expandedIds?: RollupDisclosureState;
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
    case "repo.rollup":
      return <RepoRollupRoute body={body.value} cursor={cursor} height={height} width={width} filters={filters} expandedIds={expandedIds} />;
    case "repo.sprintBoard":
      return <SprintBoardRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "repo.taskDetail":
      return <TaskDetailRoute body={body.value} width={width} height={height} selectedActionIndex={cursor} />;
    default:
      return <EmptyState title="Planned" lines={["This route is out of v1 scope.", "See docs/architecture/TUI_SURFACE_CONTRACTS.md."]} />;
  }
}
