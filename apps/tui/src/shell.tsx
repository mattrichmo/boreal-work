import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from "ink";
import { useCallback, useEffect, useReducer, useState } from "react";

import type { OpenRepoTarget, TuiCommandDescriptor, TuiEnvelope } from "@boreal/ui-model";
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
import { atRoot, breadcrumbs, initialRouteNavState, reduceRouteNav, rootFrame, topFrame } from "./route-nav.js";
import { GlobalOverviewRoute } from "./routes/global-overview.js";
import { GlobalProjectsRoute } from "./routes/global-projects.js";
import { GlobalQueuesRoute } from "./routes/global-queues.js";
import { rollupRowAt, RepoRollupRoute } from "./routes/rollup.js";
import { SprintBoardRoute } from "./routes/sprint-board.js";
import { TaskDetailRoute } from "./routes/task-detail.js";
import { railFor, routeByNumberKey } from "./routes.js";
import { useAltScreen } from "./runtime.js";
import { COLOR } from "./theme.js";
import { EmptyState, KeyHints, SectionRail, TopBar } from "./ui.js";
import type { ProjectRegistryView, GlobalWorkQueuesView, RepoRollupView } from "@boreal/ui-model";

const execFileAsync = promisify(execFile);

type RouteBody =
  | { readonly kind: "global.overview"; readonly value: GlobalOverviewBody }
  | { readonly kind: "global.projects"; readonly value: ProjectRegistryView }
  | { readonly kind: "global.queues"; readonly value: GlobalWorkQueuesView }
  | { readonly kind: "repo.rollup"; readonly value: RepoRollupView }
  | { readonly kind: "repo.sprintBoard"; readonly value: RepoSprintBoardBody }
  | { readonly kind: "repo.taskDetail"; readonly value: RepoTaskDetailBody };

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

function activeListLength(body: RouteBody | undefined): number {
  if (!body) return 0;
  switch (body.kind) {
    case "global.overview":
      return body.value.attention.length;
    case "global.projects":
      return body.value.entries.length;
    case "global.queues":
      return body.value.queues.flatMap((queue) => queue.items).length;
    case "repo.rollup":
      return Math.max(1, body.value.flatRows.length - 1); // exclude synthetic root
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

  const frame = topFrame(nav);
  const listLength = activeListLength(body);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const result = await loadForFrame(nav.current.workspaceRoot, frame.routeId, frame.entity?.id);
      if (result) {
        setEnvelope(result.envelope);
        setBody(result.body);
        setError(undefined);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setLoading(false);
      setNow(Date.now());
    }
  }, [nav.current.surface, nav.current.workspaceRoot, frame.routeId, frame.entity?.id]);

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
    [refresh]
  );

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
      if (key.escape || input === "h") {
        if (atRoot(nav) && !nav.returnTo) {
          requestQuit();
          return;
        }
        dispatch({ type: "pop" });
        return;
      }
      if (input === "r") {
        void refresh();
        return;
      }
      if (input === "q") {
        requestQuit();
        return;
      }
      if (/^[1-9]$/u.test(input)) {
        const route = routeByNumberKey(nav.current.surface, Number(input));
        if (route && atRoot(nav)) {
          dispatch({ type: "jump", session: { surface: nav.current.surface, workspaceRoot: nav.current.workspaceRoot, stack: [rootFrame(route.id, route.label)] } });
        }
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({ type: "setCursor", cursor: Math.min(frame.cursor + 1, Math.max(0, listLength - 1)) });
        return;
      }
      if (key.upArrow || input === "k") {
        dispatch({ type: "setCursor", cursor: Math.max(frame.cursor - 1, 0) });
        return;
      }
      if (key.return || input === "l") {
        handleDrill();
        return;
      }
    },
    [confirming, commandRunning, nav, frame.cursor, listLength, requestQuit, refresh]
  );

  function handleDrill(): void {
    if (!body) return;
    if (body.kind === "repo.rollup") {
      const node = rollupRowAt(body.value, frame.cursor);
      if (!node) return;
      if (node.kind === "sprint") {
        dispatch({ type: "push", frame: { routeId: "repo.sprintBoard", title: node.title, cursor: 0, entity: node.entity } });
      } else if (node.kind === "task" || node.kind === "issue") {
        dispatch({ type: "push", frame: { routeId: "repo.taskDetail", title: node.title, cursor: 0, entity: node.entity } });
      }
      return;
    }
    if (body.kind === "repo.sprintBoard") {
      const task = body.value.board?.lanes.flatMap((lane) => lane.items)[frame.cursor];
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
      const action = body.value.actions[frame.cursor];
      if (action) setConfirming(action);
      return;
    }
    if (body.kind === "global.projects") {
      const entry = body.value.entries[frame.cursor];
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
      const item = body.value.queues.flatMap((queue) => queue.items)[frame.cursor];
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

  const footerHints = confirming
    ? [
        { keys: "enter", label: "run" },
        { keys: "esc", label: "cancel" }
      ]
    : quitArmed
      ? [{ keys: "q/^c", label: "press again to quit" }]
      : [
          { keys: "1-9", label: "sections" },
          { keys: "↑↓/jk", label: "move" },
          { keys: "⏎", label: "open" },
          { keys: "esc", label: "back" },
          { keys: "r", label: "refresh" },
          { keys: "q", label: "quit" }
        ];

  const rail = railFor(nav.current.surface).map((route) => ({ id: route.id, label: route.isStub ? `${route.label} ·` : route.label, key: String(route.numberKey) }));

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {isRawModeSupported ? <KeyBindings onKey={handleKey} /> : null}
      <TopBar crumbs={breadcrumbs(nav)} right={loading ? "↻" : ""} />
      <Box paddingX={1}>
        <Text color={COLOR.faint} wrap="truncate">
          {`${nav.current.surface} · ${nav.current.workspaceRoot}${stale ? "  ·  STALE" : ""}${ageSec !== undefined ? `  ·  data: ${ageSec}s old` : ""}`}
        </Text>
      </Box>
      <Box flexGrow={1} paddingX={1} paddingY={1}>
        <SectionRail sections={rail} active={frame.routeId} />
        <Box flexDirection="column" flexGrow={1}>
          {error ? <Text color={COLOR.danger}>{`! ${error}`}</Text> : null}
          {confirming ? (
            <CommandConfirmPanel descriptor={confirming} running={commandRunning} error={commandError} />
          ) : !body ? (
            <Text color={COLOR.muted}>Loading…</Text>
          ) : (
            <RouteBodyView body={body} cursor={frame.cursor} height={bodyHeight} width={bodyWidth} />
          )}
        </Box>
      </Box>
      <KeyHints hints={footerHints} />
    </Box>
  );
}

function KeyBindings({ onKey }: { readonly onKey: (input: string, key: Key) => void }) {
  useInput(onKey, { isActive: true });
  return null;
}

function RouteBodyView({
  body,
  cursor,
  height,
  width
}: {
  readonly body: RouteBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  switch (body.kind) {
    case "global.overview":
      return <GlobalOverviewRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "global.projects":
      return <GlobalProjectsRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "global.queues":
      return <GlobalQueuesRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "repo.rollup":
      return <RepoRollupRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "repo.sprintBoard":
      return <SprintBoardRoute body={body.value} cursor={cursor} height={height} width={width} />;
    case "repo.taskDetail":
      return <TaskDetailRoute body={body.value} width={width} selectedActionIndex={cursor} />;
    default:
      return <EmptyState title="Planned" lines={["This route is out of v1 scope.", "See docs/architecture/TUI_SURFACE_CONTRACTS.md."]} />;
  }
}
