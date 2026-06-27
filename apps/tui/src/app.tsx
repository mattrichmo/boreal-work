import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from "ink";
import { useCallback, useEffect, useReducer, useState } from "react";

import type { WorkItemView } from "@boreal/ui-model";
import { loadGlobalTuiData, loadTuiData, type GlobalTuiData, type TuiData } from "./load.js";
import {
  initialNavState,
  reduceNav,
  topFrame,
  SECTIONS,
  type NavFrame,
  type TuiSection
} from "./nav.js";
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
  return "overview";
}

type SprintData = TuiData["sprints"][number];

function sprintTasks(sprint: SprintData): readonly WorkItemView[] {
  return sprint.board.lanes.flatMap((lane) => lane.items);
}

// The list backing the active screen: drives cursor length, selection and drill.
function activeList(data: TuiData, frame: NavFrame): readonly { readonly id: string }[] {
  if (frame.screen === "sprintList") return data.sprints.map((sprint) => ({ id: sprint.view.id }));
  if (frame.screen === "workList") return data.work.queues.flatMap((queue) => queue.items);
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
    case "sprintDetail":
      return data.sprints.find((entry) => entry.view.id === frame.sprintId)?.view.title ?? "Sprint";
    case "taskDetail":
      return findTask(data, frame.taskId)?.title ?? "Task";
    default:
      return "";
  }
}

function findTask(data: TuiData, taskId: string | undefined): WorkItemView | undefined {
  if (!taskId) return undefined;
  return data.work.queues.flatMap((queue) => queue.items).find((item) => item.id === taskId);
}

export function App({
  workspaceRoot,
  refreshMs,
  initialView
}: {
  readonly workspaceRoot: string;
  readonly refreshMs: number;
  readonly initialView?: string;
}) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const [data, setData] = useState<TuiData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [refreshing, setRefreshing] = useState(false);
  const [nav, dispatch] = useReducer(reduceNav, sectionFromView(initialView), initialNavState);

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
    const timer = setInterval(() => void refresh(), refreshMs);
    return () => clearInterval(timer);
  }, [refresh, refreshMs]);

  const frame = topFrame(nav);
  const list = data ? activeList(data, frame) : [];
  const selectedId = list[frame.cursor]?.id;

  const handleKey = useCallback<InkInputHandler>(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      if (input === "r") {
        void refresh();
        return;
      }
      const section = SECTIONS.find((entry) => entry.key === input);
      if (section) {
        dispatch({ type: "section", section: section.id });
        return;
      }
      if (key.escape || key.backspace || key.delete || key.leftArrow || input === "h") {
        dispatch({ type: "back" });
        return;
      }
      if (key.return || key.rightArrow || input === "l") {
        dispatch({ type: "drill", id: selectedId });
        return;
      }
      if (key.downArrow || input === "j") {
        dispatch({ type: "move", delta: 1, length: list.length });
        return;
      }
      if (key.upArrow || input === "k") {
        dispatch({ type: "move", delta: -1, length: list.length });
      }
    },
    [exit, refresh, selectedId, list.length]
  );

  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 100;
  const bodyHeight = Math.max(6, rows - 4);
  const crumbs = data ? nav.stack.map((entry) => crumbLabel(data, entry)) : ["…"];
  const clock = data ? new Date(data.generatedAt).toLocaleTimeString() : "";

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
          ) : (
            <Screen data={data} frame={frame} height={bodyHeight} width={columns - 16} />
          )}
        </Box>
      </Box>
      <KeyHints hints={hintsFor(frame.screen, isRawModeSupported)} />
    </Box>
  );
}

function hintsFor(screen: NavFrame["screen"], inputEnabled: boolean): readonly { readonly keys: string; readonly label: string }[] {
  if (!inputEnabled) return [{ keys: "no TTY", label: "keyboard disabled — Ctrl+C to exit" }];
  const move = { keys: "↑↓/jk", label: "move" };
  const sections = { keys: "o/s/w", label: "sections" };
  const refresh = { keys: "r", label: "refresh" };
  const quit = { keys: "q", label: "quit" };
  if (screen === "overview") return [sections, refresh, quit];
  if (screen === "taskDetail") return [{ keys: "⌫/esc", label: "back" }, sections, refresh, quit];
  if (screen === "sprintDetail") {
    return [move, { keys: "⏎", label: "open task" }, { keys: "⌫/esc", label: "back" }, refresh, quit];
  }
  return [move, { keys: "⏎", label: "open" }, sections, refresh, quit];
}

function Screen({ data, frame, height, width }: { readonly data: TuiData; readonly frame: NavFrame; readonly height: number; readonly width: number }) {
  switch (frame.screen) {
    case "overview":
      return <OverviewScreen data={data} height={height} />;
    case "sprintList":
      return <SprintListScreen data={data} cursor={frame.cursor} height={height} width={width} />;
    case "sprintDetail":
      return <SprintDetailScreen data={data} frame={frame} height={height} width={width} />;
    case "workList":
      return <WorkListScreen data={data} cursor={frame.cursor} height={height} width={width} />;
    case "taskDetail":
      return <TaskDetailScreen data={data} taskId={frame.taskId} width={width} />;
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
          <Text wrap="truncate">
            <Text color={statusColor(active.view.status)}>● </Text>
            <Text color={COLOR.text} bold>{active.view.title}</Text>
            <Text color={COLOR.muted}>{`  ${active.board.summary.verified + active.board.summary.closed}/${active.scopeCount} done`}</Text>
          </Text>
        ) : (
          <Text color={COLOR.muted}> none active — press s to browse sprints</Text>
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={COLOR.faint}>RECENT ACTIVITY</Text>
        {data.activity.length === 0 ? (
          <Text color={COLOR.muted}> no recent events</Text>
        ) : (
          windowList(data.activity, 0, Math.max(3, height - 8)).rows.map(({ item }) => (
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
  const lanes = board.lanes.filter((lane) => lane.count > 0).map((lane) => `${statusLabel(lane.id)} ${lane.count}`);
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
        <Field label="lanes" value={lanes.length > 0 ? lanes.join("  ") : "no work yet"} color={COLOR.muted} />
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

function WorkListScreen({ data, cursor, height, width }: { readonly data: TuiData; readonly cursor: number; readonly height: number; readonly width: number }) {
  const items = data.work.queues.flatMap((queue) => queue.items);
  const nameWidth = Math.max(20, Math.floor((width - 8 - 10) * 0.6));
  const labelWidth = Math.max(10, width - 8 - 10 - nameWidth);
  const columns: readonly TableColumn[] = [
    { header: "status", width: 8 },
    { header: "title", width: nameWidth },
    { header: "priority", width: 10 },
    { header: "labels", width: labelWidth }
  ];
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint}>{`WORK (${items.length})`}</Text>
      <Table columns={columns} rows={items.map(workRow)} cursor={cursor} height={height - 2} emptyLabel="No work items." />
    </Box>
  );
}

function TaskDetailScreen({ data, taskId, width }: { readonly data: TuiData; readonly taskId: string | undefined; readonly width: number }) {
  const task = findTask(data, taskId);
  if (!task) return <EmptyState title="Task" lines={["This item is no longer available.", "Press ⌫ to go back."]} />;
  const detail = taskId ? data.details[taskId] : undefined;
  return (
    <Pane title={task.title} tone={statusColor(task.status)}>
      <Field label="id" value={task.id} color={COLOR.muted} />
      <Field label="kind" value={task.kind} />
      <Field label="status" value={task.status} color={statusColor(task.status)} />
      <Field label="priority" value={task.priority} />
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

export function GlobalApp({ workspaceRoot, refreshMs }: { readonly workspaceRoot: string; readonly refreshMs: number }) {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const { isRawModeSupported } = useStdin();
  const [data, setData] = useState<GlobalTuiData | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [cursor, setCursor] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

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
      if (input === "q" || key.escape || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      if (input === "r") {
        void refresh();
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
    [exit, refresh, projects.length]
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
          isRawModeSupported
            ? [{ keys: "↑↓/jk", label: "move" }, { keys: "r", label: "refresh" }, { keys: "q", label: "quit" }]
            : [{ keys: "no TTY", label: "keyboard disabled — Ctrl+C to exit" }]
        }
      />
    </Box>
  );
}
