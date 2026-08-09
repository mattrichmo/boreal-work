import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from "ink";
import { useCallback, useEffect, useMemo, useReducer, useState } from "react";

import type { OpenRepoTarget, TuiCommandDescriptor, TuiEnvelope, TuiFilterState } from "@boreal/ui-model";
import { CommandConfirmPanel } from "./command-panel.js";
import { watchHead } from "./head-poll.js";
import {
  loadGlobalOverview,
  loadGlobalProjects,
  loadGlobalQueues,
  loadRepoRollup,
  loadRepoSprintBoard,
  loadRepoTaskDetail,
  type GlobalOverviewBody,
  type RepoSprintBoardBody,
  type RepoTaskDetailBody
} from "./loaders.js";
import { bindingsForRoute, resolveRouteAction, routeFooterHints } from "./route-bindings.js";
import { atRoot, breadcrumbs, initialRouteNavState, reduceRouteNav, rootFrame, topFrame } from "./route-nav.js";
import { GlobalOverviewRoute } from "./routes/global-overview.js";
import { GlobalProjectsRoute } from "./routes/global-projects.js";
import { filteredQueueItems, GlobalQueuesRoute, queueFilterLabel, queueRowAt, QUEUE_FILTER_CYCLE } from "./routes/global-queues.js";
import { rollupFilterLabel, rollupRowAt, visibleRollupRows, RepoRollupRoute, ROLLUP_FILTER_CYCLE } from "./routes/rollup.js";
import { SprintBoardRoute } from "./routes/sprint-board.js";
import { TaskDetailRoute } from "./routes/task-detail.js";
import { railFor, routeById, routeByNumberKey, REPO_TASK_DETAIL_ROUTE, type RouteSpec } from "./routes.js";
import { useAltScreen } from "./runtime.js";
import { COLOR } from "./theme.js";
import { EmptyState, KeyHints, SectionRail, Table, TopBar, type TableColumn, type TableRow } from "./ui.js";
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

async function loadForFrame(
  workspaceRoot: string,
  routeId: string,
  entityId: string | undefined
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
      const envelope = await loadRepoTaskDetail(workspaceRoot, entityId);
      if (!envelope) return undefined;
      return { envelope, body: { kind: "repo.taskDetail", value: envelope.body } };
    }
    default:
      return undefined;
  }
}

function activeListLength(body: RouteBody | undefined, filters: TuiFilterState | undefined): number {
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
      return visibleRollupRows(body.value, filters).length;
    case "repo.sprintBoard":
      return body.value.board?.lanes.flatMap((lane) => lane.items).length ?? 0;
    case "repo.taskDetail":
      return body.value.actions.length;
    default:
      return 0;
  }
}

export function RouteApp({ workspaceRoot, global }: { readonly workspaceRoot: string; readonly global?: boolean }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  useAltScreen(false);

  const surface = global ? "global" : "repo";
  const initialRoute = global ? "global.overview" : "repo.rollup";
  const initialTitle = global ? "Overview" : "Roll-Up";
  const [nav, dispatch] = useReducer(reduceRouteNav, undefined, () =>
    initialRouteNavState(surface, workspaceRoot, initialRoute, initialTitle)
  );

  const [body, setBody] = useState<RouteBody | undefined>();
  const [envelope, setEnvelope] = useState<TuiEnvelope<unknown> | undefined>();
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

  const frame = topFrame(nav);
  const routeSpec = routeById(frame.routeId);
  const unsupportedRoute = frame.routeId !== REPO_TASK_DETAIL_ROUTE && (!routeSpec || routeSpec.isStub === true);
  const listLength = activeListLength(body, frame.filters);
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

  const refresh = useCallback(async () => {
    setLoading(true);
    // Never leave the previous route payload mounted while a new payload is
    // being read. A failed refresh must not leave old rows/actions available.
    setBody(undefined);
    setEnvelope(undefined);
    setError(undefined);
    setConfirming(undefined);
    setCommandError(undefined);
    try {
      const result = await loadForFrame(nav.current.workspaceRoot, frame.routeId, frame.entity?.id);
      if (result) {
        setEnvelope(result.envelope);
        setBody(result.body);
        setError(undefined);
      } else {
        setError(unsupportedRoute ? `Route ${frame.routeId} is unsupported.` : `No data is available for ${frame.routeId}.`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, [nav.current.surface, nav.current.workspaceRoot, frame.routeId, frame.entity?.id, unsupportedRoute]);

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nav.current.surface, nav.current.workspaceRoot, frame.routeId, frame.entity?.id]);

  // Refresh contract: watch the event-log head for the current workspace;
  // an advanced seq refetches only the current route payload.
  useEffect(() => {
    if (nav.current.surface !== "repo") return undefined;
    return watchHead(nav.current.workspaceRoot, () => void refresh());
  }, [nav.current.surface, nav.current.workspaceRoot, refresh]);

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
      if (actionsBlocked(unsupportedRoute, loading, error, envelope)) {
        setCommandError("This route is read-only until its data is fresh and warning-free.");
        return;
      }
      setCommandRunning(true);
      setCommandError(undefined);
      try {
        await execFileAsync(process.env.BOREAL_TUI_CLI ?? "bwrk", [...descriptor.argv, "--json"], {
          cwd: descriptor.workspaceRoot,
          maxBuffer: 16 * 1024 * 1024
        });
        setConfirming(undefined);
        await refresh();
      } catch (caught) {
        setCommandError(caught instanceof Error ? caught.message : String(caught));
      } finally {
        setCommandRunning(false);
      }
    },
    [refresh, unsupportedRoute, loading, error, envelope]
  );

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setPaletteQuery("");
    setPaletteCursor(0);
  }, []);

  function jumpToRoute(route: RouteSpec): void {
    dispatch({
      type: "jump",
      session: { surface: nav.current.surface, workspaceRoot: nav.current.workspaceRoot, stack: [rootFrame(route.id, route.label)] }
    });
  }

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
        void refresh();
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
    [confirming, commandRunning, paletteOpen, paletteResults, paletteCursor, nav, frame.cursor, frame.routeId, frame.filters, listLength, specs, requestQuit, refresh, closePalette]
  );

  function handleDrill(): void {
    if (!body) return;
    if (body.kind === "repo.rollup") {
      const node = rollupRowAt(body.value, effectiveCursor, frame.filters);
      if (!node) return;
      if (node.kind === "sprint") {
        dispatch({ type: "push", frame: { routeId: "repo.sprintBoard", title: node.title, cursor: 0, entity: node.entity } });
      } else if (node.kind === "task" || node.kind === "issue") {
        dispatch({ type: "push", frame: { routeId: "repo.taskDetail", title: node.title, cursor: 0, entity: node.entity } });
      }
      return;
    }
    if (body.kind === "repo.sprintBoard") {
      const task = body.value.board?.lanes.flatMap((lane) => lane.items)[effectiveCursor];
      if (!task) return;
      dispatch({
        type: "push",
        frame: {
          routeId: "repo.taskDetail",
          title: task.title,
          cursor: 0,
          entity: { kind: "task", id: task.id, workspaceRoot: nav.current.workspaceRoot, label: task.title }
        }
      });
      return;
    }
    if (body.kind === "repo.taskDetail") {
      if (actionsBlocked(unsupportedRoute, loading, error, envelope)) return;
      const action = body.value.actions[effectiveCursor];
      if (action) setConfirming(action);
      return;
    }
    if (body.kind === "global.projects") {
      const entry = body.value.entries[effectiveCursor];
      if (!entry) return;
      const target: OpenRepoTarget = {
        projectId: entry.id,
        projectName: entry.name,
        projectRoot: entry.projectRoot,
        returnToGlobalFrame: { ...frame }
      };
      dispatch({ type: "openRepo", target });
      return;
    }
    if (body.kind === "global.queues") {
      const item = queueRowAt(body.value, effectiveCursor, frame.filters);
      if (!item) return;
      const target: OpenRepoTarget = {
        projectId: item.projectId,
        projectName: item.projectName,
        projectRoot: item.projectRoot,
        initialRoute: "repo.taskDetail",
        initialEntity: { kind: "task", id: item.work.id, workspaceRoot: item.projectRoot, label: item.work.title },
        returnToGlobalFrame: { ...frame }
      };
      dispatch({ type: "openRepo", target });
      return;
    }
  }

  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 100;
  const bodyHeight = Math.max(6, rows - 6);
  const bodyWidth = Math.max(40, columns - 16);
  const ageSec = envelope ? Math.max(0, Math.round((now - new Date(envelope.generatedAt).getTime()) / 1000)) : undefined;
  const stale = envelope?.stale ?? false;
  const warningCount = envelope?.warnings.length ?? 0;
  const blocked = actionsBlocked(unsupportedRoute, loading, error, envelope);
  const currentFilterLabel = filterLabel(frame.routeId, frame.filters);

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
        : routeFooterHints(specs);

  const rail = railFor(nav.current.surface).map((route) => ({ id: route.id, label: route.isStub ? `${route.label} ·` : route.label, key: String(route.numberKey) }));

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {isRawModeSupported ? <KeyBindings onKey={handleKey} /> : null}
      <TopBar crumbs={breadcrumbs(nav)} right={loading ? "↻" : ""} />
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
        <SectionRail sections={rail} active={frame.routeId} />
        <Box flexDirection="column" flexGrow={1}>
          {error ? <Text color={COLOR.danger}>{`! ${error}`}</Text> : null}
          {envelope?.warnings.map((warning) => <Text key={warning} color={COLOR.warn} wrap="truncate">{`⚠ ${warning}`}</Text>)}
          {blocked && !loading && !error && !unsupportedRoute ? (
            <Text color={COLOR.warn}>Read-only: refresh and resolve warnings before running state-changing actions.</Text>
          ) : null}
          {confirming ? (
            <CommandConfirmPanel descriptor={confirming} running={commandRunning} error={commandError} />
          ) : paletteOpen ? (
            <Palette query={paletteQuery} results={paletteResults} cursor={paletteCursor} height={bodyHeight} width={bodyWidth} />
          ) : error ? (
            <EmptyState title={unsupportedRoute ? "Unsupported route" : "Data unavailable"} lines={[error, "Press r to retry or esc to return."]} />
          ) : !body ? (
            <Text color={COLOR.muted}>Loading…</Text>
          ) : (
            <RouteBodyView body={body} cursor={effectiveCursor} height={bodyHeight} width={bodyWidth} filters={frame.filters} />
          )}
        </Box>
      </Box>
      <KeyHints hints={footerHints} />
    </Box>
  );
}

function actionsBlocked(
  unsupportedRoute: boolean,
  loading: boolean,
  error: string | undefined,
  envelope: TuiEnvelope<unknown> | undefined
): boolean {
  return unsupportedRoute || loading || Boolean(error) || Boolean(envelope?.stale) || (envelope?.warnings.length ?? 0) > 0 || hasTruncation(envelope?.truncated);
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
        <Table columns={columns} rows={rows} cursor={cursor} height={height - 3} emptyLabel="No matching routes." />
      </Box>
    </Box>
  );
}

function RouteBodyView({
  body,
  cursor,
  height,
  width,
  filters
}: {
  readonly body: RouteBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly filters?: TuiFilterState;
}) {
  switch (body.kind) {
    case "global.overview":
      return <GlobalOverviewRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "global.projects":
      return <GlobalProjectsRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "global.queues":
      return <GlobalQueuesRoute body={body.value} cursor={cursor} height={height} width={width} filters={filters} />;
    case "repo.rollup":
      return <RepoRollupRoute body={body.value} cursor={cursor} height={height} width={width} filters={filters} />;
    case "repo.sprintBoard":
      return <SprintBoardRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "repo.taskDetail":
      return <TaskDetailRoute body={body.value} width={width} selectedActionIndex={cursor} />;
    default:
      return <EmptyState title="Planned" lines={["This route is out of v1 scope.", "See docs/architecture/TUI_SURFACE_CONTRACTS.md."]} />;
  }
}
