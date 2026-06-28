import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from "ink";
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";

import type { WorkItemView } from "@boreal/ui-model";
import { loadGlobalTuiData, loadTuiData, type GlobalTuiData, type TuiData } from "./load.js";
import {
  initialNavState,
  jumpTo,
  reduceNav,
  topFrame,
  SECTIONS,
  type NavFrame,
  type TuiSection
} from "./nav.js";
import { bindingsForScreen, footerHints as buildFooterHints, resolveAction } from "./bindings.js";
import { useAltScreen, wheelFromInput } from "./runtime.js";
import { searchItems, type SearchItem } from "./search.js";
import { COLOR, fit, healthColor, statusColor, statusLabel } from "./theme.js";
import {
  EmptyState,
  Field,
  KeyHints,
  Metric,
  Pane,
  SectionRail,
  Table,
  TopBar,
  windowList,
  type TableColumn,
  type TableRow
} from "./ui.js";

type InkInputHandler = (input: string, key: Key) => void;

function KeyBindings({ onKey, active }: { readonly onKey: InkInputHandler; readonly active: boolean }) {
  useInput(onKey, { isActive: active });
  return null;
}

function sectionFromView(view: string | undefined): TuiSection {
  if (view === "sprint" || view === "sprints") return "sprints";
  if (view === "work") return "work";
  if (view === "activity") return "activity";
  return "overview";
}

type SprintData = TuiData["sprints"][number];

function sprintTasks(sprint: SprintData): readonly WorkItemView[] {
  return sprint.board.lanes.flatMap((lane) => lane.items);
}

const OPEN_STATUSES = new Set(["draft", "ready", "in_progress", "reserved", "blocked", "needs_verification"]);

function allWorkItems(data: TuiData): readonly WorkItemView[] {
  return data.work.queues.flatMap((queue) => queue.items);
}

function workListItems(data: TuiData, showAll: boolean): readonly WorkItemView[] {
  const all = allWorkItems(data);
  return showAll ? all : all.filter((item) => OPEN_STATUSES.has(item.status));
}

function searchIndex(data: TuiData): readonly SearchItem[] {
  const sprints: SearchItem[] = data.sprints.map((sprint) => ({
    kind: "sprint",
    id: sprint.view.id,
    label: sprint.view.title,
    hint: sprint.view.status
  }));
  const tasks: SearchItem[] = allWorkItems(data)
    .filter((item) => item.kind !== "sprint")
    .map((item) => ({ kind: "task", id: item.id, label: item.title, hint: item.status }));
  const events: SearchItem[] = data.timeline.map((event) => ({
    kind: "event",
    id: event.id,
    label: `${event.type} ${event.subjectType}`,
    hint: new Date(event.at).toLocaleTimeString()
  }));
  return [...sprints, ...tasks, ...events];
}

// The list backing the active screen: drives cursor length, selection and drill.
function activeList(data: TuiData, frame: NavFrame, showAllWork: boolean): readonly { readonly id: string }[] {
  if (frame.screen === "sprintList") return data.sprints.map((sprint) => ({ id: sprint.view.id }));
  if (frame.screen === "workList") return workListItems(data, showAllWork);
  if (frame.screen === "activityList") return data.timeline;
  if (frame.screen === "sprintDetail") {
    const sprint = data.sprints.find((entry) => entry.view.id === frame.sprintId);
    return sprint ? sprintTasks(sprint) : [];
  }
  return [];
}

function crumbLabel(data: TuiData, frame: NavFrame): string {
  switch (frame.screen) {
    case "overview":
      return "Overview";
    case "sprintList":
      return "Sprints";
    case "workList":
      return "Work";
    case "activityList":
      return "Activity";
    case "sprintDetail":
      return data.sprints.find((entry) => entry.view.id === frame.sprintId)?.view.title ?? "Sprint";
    case "taskDetail":
      return findTask(data, frame.taskId)?.title ?? "Task";
    case "activityDetail":
      return findEvent(data, frame.eventId)?.type ?? "Event";
    default:
      return "";
  }
}

function findTask(data: TuiData, taskId: string | undefined): WorkItemView | undefined {
  if (!taskId) return undefined;
  return data.work.queues.flatMap((queue) => queue.items).find((item) => item.id === taskId);
}

function findEvent(data: TuiData, eventId: string | undefined) {
  if (!eventId) return undefined;
  return data.timeline.find((entry) => entry.id === eventId);
}

export function App({
  workspaceRoot,
  refreshMs,
  initialView,
  initialQuery
}: {
  readonly workspaceRoot: string;
  readonly refreshMs: number;
  readonly initialView?: string;
  readonly initialQuery?: string;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  useAltScreen();
  const [data, setData] = useState<TuiData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [showAllWork, setShowAllWork] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(initialQuery !== undefined);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [paletteCursor, setPaletteCursor] = useState(0);
  const [quitArmed, setQuitArmed] = useState(false);
  const [nav, dispatch] = useReducer(reduceNav, sectionFromView(initialView), initialNavState);

  // Skip auto-refresh while searching or right after a keypress, so a refresh
  // tick never competes with input (cause of multi-hundred-ms frame gaps).
  const lastActivityRef = useRef(0);
  const paletteOpenRef = useRef(paletteOpen);
  paletteOpenRef.current = paletteOpen;

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await loadTuiData(workspaceRoot));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => {
      if (paletteOpenRef.current) return;
      if (Date.now() - lastActivityRef.current < 1200) return;
      void refresh();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [refresh, refreshMs]);

  const frame = topFrame(nav);
  const list = data ? activeList(data, frame, showAllWork) : [];
  const selectedId = list[frame.cursor]?.id;
  const specs = useMemo(() => bindingsForScreen(frame.screen), [frame.screen]);

  const index = useMemo(() => (data ? searchIndex(data) : []), [data]);
  const results = useMemo(() => (paletteOpen ? searchItems(index, query, 40) : []), [paletteOpen, index, query]);

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    setQuery("");
    setPaletteCursor(0);
  }, []);

  // Double-press q / ctrl+c to quit (a single accidental press just arms it).
  const quitArmedAtRef = useRef(0);
  const requestQuit = useCallback(() => {
    const now = Date.now();
    if (now - quitArmedAtRef.current < 1500) {
      exit();
      return;
    }
    quitArmedAtRef.current = now;
    setQuitArmed(true);
    setTimeout(() => setQuitArmed(false), 1500);
  }, [exit]);

  const handleKey = useCallback<InkInputHandler>(
    (input, key) => {
      lastActivityRef.current = Date.now();
      if (key.ctrl && input === "c") {
        requestQuit();
        return;
      }
      if (paletteOpen) {
        if (key.escape) {
          closePalette();
          return;
        }
        if (key.return) {
          const result = results[paletteCursor];
          if (result) {
            const target = jumpTo(result.kind, result.id);
            dispatch({ type: "jump", section: target.section, stack: target.stack });
          }
          closePalette();
          return;
        }
        if (key.backspace || key.delete) {
          setQuery((current) => current.slice(0, -1));
          setPaletteCursor(0);
          return;
        }
        if (key.downArrow) {
          setPaletteCursor((current) => Math.min(current + 1, Math.max(0, results.length - 1)));
          return;
        }
        if (key.upArrow) {
          setPaletteCursor((current) => Math.max(current - 1, 0));
          return;
        }
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setQuery((current) => current + input);
          setPaletteCursor(0);
        }
        return;
      }
      const wheel = wheelFromInput(input);
      if (wheel) {
        dispatch({ type: "move", delta: wheel === "down" ? 1 : -1, length: list.length });
        return;
      }
      const action = resolveAction(specs, input, key);
      switch (action) {
        case "move":
          dispatch({ type: "move", delta: key.downArrow || input === "j" ? 1 : -1, length: list.length });
          return;
        case "drill":
          dispatch({ type: "drill", id: selectedId });
          return;
        case "back":
          dispatch({ type: "back" });
          return;
        case "search":
          setPaletteOpen(true);
          setQuery("");
          setPaletteCursor(0);
          return;
        case "refresh":
          void refresh();
          return;
        case "filter":
          setShowAllWork((current) => !current);
          dispatch({ type: "move", delta: 0, length: 0 });
          return;
        case "quit":
          requestQuit();
          return;
        case "section:overview":
          dispatch({ type: "section", section: "overview" });
          return;
        case "section:sprints":
          dispatch({ type: "section", section: "sprints" });
          return;
        case "section:work":
          dispatch({ type: "section", section: "work" });
          return;
        case "section:activity":
          dispatch({ type: "section", section: "activity" });
          return;
        default:
          return;
      }
    },
    [requestQuit, refresh, selectedId, list.length, specs, paletteOpen, results, paletteCursor, closePalette]
  );

  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 100;
  const bodyHeight = Math.max(6, rows - 4);
  const crumbs = paletteOpen ? ["Search"] : data ? nav.stack.map((entry) => crumbLabel(data, entry)) : ["…"];
  const clock = data ? new Date(data.generatedAt).toLocaleTimeString() : "";
  const footerHints = !isRawModeSupported
    ? [{ keys: "no TTY", label: "keyboard disabled — Ctrl+C to exit" }]
    : quitArmed
      ? [{ keys: "q/^c", label: "press again to quit" }]
      : paletteOpen
        ? [{ keys: "type", label: "filter" }, { keys: "↑↓", label: "move" }, { keys: "⏎", label: "go" }, { keys: "esc", label: "close" }]
        : buildFooterHints(specs);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {isRawModeSupported ? <KeyBindings onKey={handleKey} active /> : null}
      <TopBar crumbs={crumbs} right={`${refreshing ? "↻ " : ""}${clock}`} />
      <Box flexGrow={1} paddingX={1} paddingY={1}>
        <SectionRail sections={SECTIONS} active={nav.section} />
        <Box flexDirection="column" flexGrow={1}>
          {error ? <Text color={COLOR.danger}>! {error}</Text> : null}
          {!data ? (
            <Text color={COLOR.muted}>Loading workspace…</Text>
          ) : !data.initialized ? (
            <EmptyState title="Not initialized" lines={[data.warnings[0] ?? "Run `bwrk init` here."]} />
          ) : paletteOpen ? (
            <Palette query={query} results={results} cursor={paletteCursor} height={bodyHeight} width={columns - 16} />
          ) : (
            <Screen data={data} frame={frame} height={bodyHeight} width={columns - 16} showAllWork={showAllWork} />
          )}
        </Box>
      </Box>
      <KeyHints hints={footerHints} />
    </Box>
  );
}

function kindColor(kind: SearchItem["kind"]): string {
  if (kind === "sprint") return COLOR.accent;
  if (kind === "task") return COLOR.accentSoft;
  return COLOR.muted;
}

function Palette({
  query,
  results,
  cursor,
  height,
  width
}: {
  readonly query: string;
  readonly results: readonly (SearchItem & { readonly score: number })[];
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const hintWidth = 12;
  const labelWidth = Math.max(20, width - 8 - hintWidth);
  const columns: readonly TableColumn[] = [
    { header: "type", width: 8 },
    { header: "match", width: labelWidth },
    { header: "where", width: hintWidth }
  ];
  const rows: readonly TableRow[] = results.map((result) => ({
    key: `${result.kind}:${result.id}`,
    cells: [
      { text: result.kind, color: kindColor(result.kind) },
      { text: result.label, color: COLOR.text },
      { text: result.hint, color: COLOR.faint }
    ]
  }));
  return (
    <Box flexDirection="column">
      <Text>
        <Text color={COLOR.accent} bold>{"❯ "}</Text>
        <Text color={COLOR.text}>{query}</Text>
        <Text color={COLOR.accent}>▌</Text>
        <Text color={COLOR.faint}>{`   ${results.length} result${results.length === 1 ? "" : "s"}`}</Text>
      </Text>
      <Box marginTop={1}>
        <Table
          columns={columns}
          rows={rows}
          cursor={cursor}
          height={height - 3}
          emptyLabel={query ? "No matches." : "Type to search sprints, work, and events."}
        />
      </Box>
    </Box>
  );
}

function Screen({
  data,
  frame,
  height,
  width,
  showAllWork
}: {
  readonly data: TuiData;
  readonly frame: NavFrame;
  readonly height: number;
  readonly width: number;
  readonly showAllWork: boolean;
}) {
  switch (frame.screen) {
    case "overview":
      return <OverviewScreen data={data} height={height} />;
    case "sprintList":
      return <SprintListScreen data={data} cursor={frame.cursor} height={height} width={width} />;
    case "sprintDetail":
      return <SprintDetailScreen data={data} frame={frame} height={height} width={width} />;
    case "workList":
      return <WorkListScreen data={data} cursor={frame.cursor} height={height} width={width} showAll={showAllWork} />;
    case "taskDetail":
      return <TaskDetailScreen data={data} taskId={frame.taskId} width={width} />;
    case "activityList":
      return <ActivityListScreen data={data} cursor={frame.cursor} height={height} width={width} />;
    case "activityDetail":
      return <ActivityDetailScreen data={data} eventId={frame.eventId} width={width} />;
    default:
      return null;
  }
}

function OverviewScreen({ data, height }: { readonly data: TuiData; readonly height: number }) {
  const summary = data.work.summary;
  const active = data.sprints.find((sprint) => sprint.active);
  return (
    <Box flexDirection="column">
      {data.warnings.length > 0 ? <Text color={COLOR.warn} wrap="truncate">⚠ {data.warnings.join(" ")}</Text> : null}
      <Box marginTop={data.warnings.length > 0 ? 1 : 0}>
        <Metric label="total" value={summary.total} tone={COLOR.muted} />
        <Metric label="ready" value={summary.ready} />
        <Metric label="active" value={summary.inProgress} tone={COLOR.accentSoft} />
        <Metric label="blocked" value={summary.blocked} tone={COLOR.warn} />
        <Metric label="verify" value={summary.needsVerification} tone={COLOR.warn} />
        <Metric label="reserved" value={summary.activeReservations} tone={COLOR.muted} />
        <Metric label="sprints" value={data.sprints.length} tone={COLOR.muted} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={COLOR.faint}>ACTIVE SPRINT</Text>
        {active ? (
          (() => {
            const done = active.board.summary.verified + active.board.summary.closed;
            const pct = active.scopeCount > 0 ? Math.round((done / active.scopeCount) * 100) : 0;
            return (
              <Box flexDirection="column">
                <Text wrap="truncate">
                  <Text color={statusColor(active.view.status)}>● </Text>
                  <Text color={COLOR.text} bold>{active.view.title}</Text>
                </Text>
                <Text>
                  <Text color={COLOR.accent}>{progressBar(done, active.scopeCount, 24)}</Text>
                  <Text color={COLOR.muted}>{`  ${done}/${active.scopeCount} · ${pct}%`}</Text>
                </Text>
              </Box>
            );
          })()
        ) : (
          <Text color={COLOR.muted}> none active — press s to browse sprints</Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={COLOR.faint}>RECENT ACTIVITY</Text>
        {data.timeline.length === 0 ? (
          <Text color={COLOR.muted}> no recent events</Text>
        ) : (
          windowList(data.timeline, 0, Math.max(3, height - 8)).rows.map(({ item }) => (
            <Text key={item.id} wrap="truncate">
              <Text color={COLOR.faint}>{new Date(item.at).toLocaleTimeString()} </Text>
              <Text color={COLOR.accent}>{item.type}</Text>
              <Text color={COLOR.muted}>{` ${item.subjectType}`}</Text>
            </Text>
          ))
        )}
      </Box>
    </Box>
  );
}

function sprintRow(sprint: SprintData): TableRow {
  const done = sprint.board.summary.verified + sprint.board.summary.closed;
  return {
    key: sprint.view.id,
    cells: [
      { text: statusLabel(sprint.view.status), color: statusColor(sprint.view.status) },
      { text: `${sprint.active ? "★ " : ""}${sprint.view.title}`, color: COLOR.text },
      { text: `${done}/${sprint.scopeCount}`, color: COLOR.muted },
      { text: String(sprint.board.summary.taskCount), color: COLOR.muted },
      { text: String(sprint.board.summary.activeBlockerCount), color: sprint.board.summary.activeBlockerCount > 0 ? COLOR.warn : COLOR.faint }
    ]
  };
}

function SprintListScreen({ data, cursor, height, width }: { readonly data: TuiData; readonly cursor: number; readonly height: number; readonly width: number }) {
  const nameWidth = Math.max(20, width - 8 - 9 - 7 - 9);
  const columns: readonly TableColumn[] = [
    { header: "status", width: 8 },
    { header: "sprint", width: nameWidth },
    { header: "done", width: 9, align: "right" },
    { header: "tasks", width: 7, align: "right" },
    { header: "block", width: 9, align: "right" }
  ];
  return <Table columns={columns} rows={data.sprints.map(sprintRow)} cursor={cursor} height={height - 1} emptyLabel="No sprints. Create one with bwrk work create … --kind sprint" />;
}

function taskRow(task: WorkItemView): TableRow {
  return {
    key: task.id,
    cells: [
      { text: statusLabel(task.status), color: statusColor(task.status) },
      { text: task.title, color: COLOR.text },
      { text: task.priority, color: COLOR.muted },
      { text: task.activeReservation ? task.activeReservation.agentId : "—", color: COLOR.faint }
    ]
  };
}

function SprintDetailScreen({ data, frame, height, width }: { readonly data: TuiData; readonly frame: NavFrame; readonly height: number; readonly width: number }) {
  const sprint = data.sprints.find((entry) => entry.view.id === frame.sprintId);
  if (!sprint) return <EmptyState title="Sprint" lines={["This sprint is no longer available.", "Press ⌫ to go back."]} />;
  const { view, board, scopeCount, active } = sprint;
  const activeLanes = board.lanes.filter((lane) => lane.count > 0);
  const nameWidth = Math.max(20, width - 8 - 10 - 12);
  const columns: readonly TableColumn[] = [
    { header: "status", width: 8 },
    { header: "task", width: nameWidth },
    { header: "priority", width: 10 },
    { header: "reserved", width: 12 }
  ];
  const tasks = sprintTasks(sprint);
  return (
    <Box flexDirection="column">
      <Box flexDirection="column" marginBottom={1}>
        <Field label="status" value={active ? `${view.status} (active)` : view.status} color={statusColor(view.status)} />
        <Field label="priority" value={view.priority} />
        <Field label="scope" value={`${scopeCount} items · ${board.summary.taskCount} tasks · ${board.summary.phaseCount} phases · ${board.summary.activeBlockerCount} blockers`} />
        <Box>
          <Text color={COLOR.faint}>{fit("lanes", 11)}</Text>
          {activeLanes.length === 0 ? (
            <Text color={COLOR.muted}>no work yet</Text>
          ) : (
            activeLanes.map((lane, index) => (
              <Text key={lane.id} color={statusColor(lane.id)}>
                {`${index > 0 ? "  " : ""}${statusLabel(lane.id)} ${lane.count}`}
              </Text>
            ))
          )}
        </Box>
      </Box>
      <Text color={COLOR.faint}>{`TASKS (${tasks.length})`}</Text>
      <Table columns={columns} rows={tasks.map(taskRow)} cursor={frame.cursor} height={height - 7} emptyLabel="No work in this sprint yet." />
    </Box>
  );
}

function workRow(task: WorkItemView): TableRow {
  return {
    key: task.id,
    cells: [
      { text: statusLabel(task.status), color: statusColor(task.status) },
      { text: task.title, color: COLOR.text },
      { text: task.priority, color: COLOR.muted },
      { text: task.labels.length > 0 ? task.labels.join(", ") : "—", color: COLOR.faint }
    ]
  };
}

function WorkListScreen({ data, cursor, height, width, showAll }: { readonly data: TuiData; readonly cursor: number; readonly height: number; readonly width: number; readonly showAll: boolean }) {
  const items = workListItems(data, showAll);
  const total = allWorkItems(data).length;
  const nameWidth = Math.max(20, Math.floor((width - 8 - 10) * 0.62));
  const labelWidth = Math.max(10, width - 8 - 10 - nameWidth);
  const columns: readonly TableColumn[] = [
    { header: "status", width: 8 },
    { header: "title", width: nameWidth },
    { header: "priority", width: 10 },
    { header: "labels", width: labelWidth }
  ];
  return (
    <Box flexDirection="column">
      <Text wrap="truncate">
        <Text color={COLOR.faint}>{showAll ? "ALL WORK " : "OPEN WORK "}</Text>
        <Text color={COLOR.text} bold>{items.length}</Text>
        <Text color={COLOR.faint}>{` of ${total}`}</Text>
        <Text color={COLOR.faint}>{showAll ? "  ·  f: open only" : "  ·  f: show all"}</Text>
      </Text>
      <Table
        columns={columns}
        rows={items.map(workRow)}
        cursor={cursor}
        height={height - 2}
        emptyLabel={showAll ? "No work items." : "No open work — press f to show all."}
      />
    </Box>
  );
}

function shortId(id: string): string {
  return id.length > 16 ? `…${id.slice(-12)}` : id;
}

function ActivityListScreen({ data, cursor, height, width }: { readonly data: TuiData; readonly cursor: number; readonly height: number; readonly width: number }) {
  const typeWidth = Math.max(16, Math.floor((width - 12) * 0.42));
  const subjectWidth = Math.max(16, width - 12 - typeWidth);
  const columns: readonly TableColumn[] = [
    { header: "time", width: 12 },
    { header: "event", width: typeWidth },
    { header: "subject", width: subjectWidth }
  ];
  const rows: readonly TableRow[] = data.timeline.map((event) => ({
    key: event.id,
    cells: [
      { text: new Date(event.at).toLocaleTimeString(), color: COLOR.faint },
      { text: event.type, color: COLOR.accent },
      { text: `${event.subjectType} ${shortId(event.subjectId)}`, color: COLOR.muted }
    ]
  }));
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint}>{`TIMELINE (${data.timeline.length})`}</Text>
      <Table columns={columns} rows={rows} cursor={cursor} height={height - 2} emptyLabel="No recent events." />
    </Box>
  );
}

function ActivityDetailScreen({ data, eventId, width }: { readonly data: TuiData; readonly eventId: string | undefined; readonly width: number }) {
  const event = findEvent(data, eventId);
  if (!event) return <EmptyState title="Event" lines={["This event is no longer available.", "Press ⌫ to go back."]} />;
  return (
    <Pane title={event.type} tone={COLOR.accent}>
      <Field label="time" value={new Date(event.at).toLocaleString()} />
      <Field label="subject" value={`${event.subjectType} · ${event.subjectId}`} color={COLOR.muted} />
      <Box marginTop={1} flexDirection="column">
        <Text color={COLOR.faint}>PAYLOAD</Text>
        {event.payload.length === 0 ? (
          <Text color={COLOR.muted}> none</Text>
        ) : (
          event.payload.map((entry, index) => (
            <Text key={index} wrap="truncate">
              <Text color={COLOR.faint}>{fit(entry.key, 18)}</Text>
              <Text color={COLOR.text}>{fit(entry.value, Math.max(20, width - 20))}</Text>
            </Text>
          ))
        )}
      </Box>
    </Pane>
  );
}

function TaskDetailScreen({ data, taskId, width }: { readonly data: TuiData; readonly taskId: string | undefined; readonly width: number }) {
  const task = findTask(data, taskId);
  if (!task) return <EmptyState title="Task" lines={["This item is no longer available.", "Press ⌫ to go back."]} />;
  const detail = taskId ? data.details[taskId] : undefined;
  return (
    <Pane title={task.title} tone={statusColor(task.status)}>
      <Text>
        <Text color={statusColor(task.status)} bold>{statusLabel(task.status)}</Text>
        <Text color={COLOR.faint}>{"  ·  "}</Text>
        <Text color={COLOR.muted}>{task.kind}</Text>
        <Text color={COLOR.faint}>{"  ·  "}</Text>
        <Text color={COLOR.muted}>{`${task.priority} priority`}</Text>
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Field label="id" value={task.id} color={COLOR.muted} />
        <Field label="labels" value={task.labels.length > 0 ? task.labels.join(", ") : "none"} />
        <Field label="blockers" value={task.activeBlockerIds.length > 0 ? task.activeBlockerIds.join(", ") : "none"} color={task.activeBlockerIds.length > 0 ? COLOR.warn : undefined} />
        <Field
          label="reserved"
          value={task.activeReservation ? `${task.activeReservation.agentId}${task.activeReservation.expired ? " (expired)" : ""}` : "no"}
        />
        <Field label="evidence" value={`${task.evidenceCount} · verifications ${task.verificationCount}`} />
        {detail && detail.dependencyTitles.length > 0 ? (
          <Field label="depends on" value={detail.dependencyTitles.join(", ")} color={COLOR.muted} />
        ) : null}
      </Box>
      {detail && detail.description ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.faint}>DESCRIPTION</Text>
          <Text color={COLOR.text} wrap="wrap">{clamp(detail.description, 600)}</Text>
        </Box>
      ) : null}
      {detail && detail.acceptanceCriteria.length > 0 ? (
        <Box marginTop={1} flexDirection="column">
          <Text color={COLOR.faint}>ACCEPTANCE</Text>
          {detail.acceptanceCriteria.slice(0, 8).map((criterion, index) => (
            <Text key={index} color={COLOR.text} wrap="truncate">
              <Text color={COLOR.accent}>• </Text>
              {fit(criterion, Math.max(20, width - 4))}
            </Text>
          ))}
        </Box>
      ) : null}
    </Pane>
  );
}

function clamp(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function progressBar(done: number, total: number, width: number): string {
  if (total <= 0) return "░".repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((done / total) * width)));
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

export function GlobalApp({ workspaceRoot, refreshMs }: { readonly workspaceRoot: string; readonly refreshMs: number }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  useAltScreen();
  const [data, setData] = useState<GlobalTuiData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [cursor, setCursor] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [quitArmed, setQuitArmed] = useState(false);
  const quitArmedAtRef = useRef(0);
  const requestQuit = useCallback(() => {
    const now = Date.now();
    if (now - quitArmedAtRef.current < 1500) {
      exit();
      return;
    }
    quitArmedAtRef.current = now;
    setQuitArmed(true);
    setTimeout(() => setQuitArmed(false), 1500);
  }, [exit]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      setData(await loadGlobalTuiData(workspaceRoot));
      setError(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setRefreshing(false);
    }
  }, [workspaceRoot]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), refreshMs);
    return () => clearInterval(timer);
  }, [refresh, refreshMs]);

  const projects = data?.projects ?? [];

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, projects.length - 1)));
  }, [projects.length]);

  const handleKey = useCallback<InkInputHandler>(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        requestQuit();
        return;
      }
      if (input === "r") {
        void refresh();
        return;
      }
      const wheel = wheelFromInput(input);
      if (wheel) {
        setCursor((current) =>
          wheel === "down"
            ? Math.min(current + 1, Math.max(0, projects.length - 1))
            : Math.max(current - 1, 0)
        );
        return;
      }
      if (key.downArrow || input === "j") {
        setCursor((current) => Math.min(current + 1, Math.max(0, projects.length - 1)));
        return;
      }
      if (key.upArrow || input === "k") {
        setCursor((current) => Math.max(current - 1, 0));
      }
    },
    [requestQuit, refresh, projects.length]
  );

  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 100;
  const clock = data ? new Date(data.generatedAt).toLocaleTimeString() : "";
  const selected = projects[cursor];
  const nameWidth = Math.max(20, columns - 4 - 10 - 8 - 8 - 9 - 6);
  const tableColumns: readonly TableColumn[] = [
    { header: "health", width: 10 },
    { header: "project", width: nameWidth },
    { header: "open", width: 8, align: "right" },
    { header: "ready", width: 8, align: "right" },
    { header: "blocked", width: 9, align: "right" },
    { header: "resv", width: 6, align: "right" }
  ];
  const tableRows: readonly TableRow[] = projects.map((project) => ({
    key: project.id || project.name,
    cells: [
      { text: project.stale ? "stale" : project.health, color: healthColor(project.health) },
      { text: project.name, color: COLOR.text },
      { text: String(project.open), color: COLOR.muted },
      { text: String(project.ready), color: COLOR.accent },
      { text: String(project.blocked), color: project.blocked > 0 ? COLOR.warn : COLOR.faint },
      { text: String(project.reservations), color: COLOR.faint }
    ]
  }));

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {isRawModeSupported ? <KeyBindings onKey={handleKey} active /> : null}
      <TopBar crumbs={["Global", `${projects.length} project${projects.length === 1 ? "" : "s"}`]} right={`${refreshing ? "↻ " : ""}${clock}`} />
      <Box flexGrow={1} paddingX={1} paddingY={1} flexDirection="column">
        {error ? <Text color={COLOR.danger}>! {error}</Text> : null}
        {data && data.warnings.length > 0 ? <Text color={COLOR.warn} wrap="truncate">⚠ {data.warnings.join(" ")}</Text> : null}
        {!data ? (
          <Text color={COLOR.muted}>Loading registry…</Text>
        ) : projects.length === 0 ? (
          <EmptyState
            title="No projects registered"
            lines={["Global tracks every registered project.", "Register one with: bwrk registry add --workspace <path>", "then refresh with r."]}
          />
        ) : (
          <>
            <Table columns={tableColumns} rows={tableRows} cursor={cursor} height={rows - 7} />
            {selected ? <Text color={COLOR.faint} wrap="truncate">{`  ${selected.projectRoot}`}</Text> : null}
          </>
        )}
      </Box>
      <KeyHints
        hints={
          !isRawModeSupported
            ? [{ keys: "no TTY", label: "keyboard disabled — Ctrl+C to exit" }]
            : quitArmed
              ? [{ keys: "q/^c", label: "press again to quit" }]
              : [{ keys: "↑↓/jk", label: "move" }, { keys: "r", label: "refresh" }, { keys: "q", label: "quit" }]
        }
      />
    </Box>
  );
}
