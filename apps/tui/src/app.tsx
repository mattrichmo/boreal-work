import { Box, Text, useApp, useInput, useStdin, useStdout, type Key } from "ink";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import type { WorkItemView } from "@boreal/ui-model";
import { loadGlobalTuiData, loadTuiData, type GlobalTuiData, type TuiData } from "./load.js";

const ACCENT = "#71d48b";
const MUTED = "#94a39b";
const WARN = "#d7b969";
const DANGER = "#df7c7c";

type ViewId = "overview" | "sprint" | "work";

type InkInputHandler = (input: string, key: Key) => void;

function KeyBindings({ onKey }: { readonly onKey: InkInputHandler }) {
  useInput(onKey);
  return null;
}

const VIEWS: readonly { readonly id: ViewId; readonly label: string; readonly key: string }[] = [
  { id: "overview", label: "Overview", key: "o" },
  { id: "sprint", label: "Sprint", key: "s" },
  { id: "work", label: "Work", key: "w" }
];

function statusColor(status: string): string {
  if (status === "ready") return ACCENT;
  if (status === "in_progress" || status === "reserved") return "#8be9a5";
  if (status === "verified" || status === "closed") return ACCENT;
  if (status === "blocked" || status === "needs_verification") return WARN;
  if (status === "cancelled") return DANGER;
  return MUTED;
}

function selectableLength(view: ViewId, data: TuiData | undefined): number {
  if (!data) return 0;
  if (view === "work") return data.work.queues.reduce((total, queue) => total + queue.items.length, 0);
  if (view === "sprint") return data.sprints.length;
  return 0;
}

interface Windowed<T> {
  readonly rows: readonly { readonly item: T; readonly index: number }[];
  readonly above: number;
  readonly below: number;
}

// Show only the rows that fit, windowed around the cursor, so long lists never
// overflow the terminal (which corrupts Ink's frame diff and ghosts the border).
function windowList<T>(items: readonly T[], cursor: number, size: number): Windowed<T> {
  if (items.length <= size) {
    return { rows: items.map((item, index) => ({ item, index })), above: 0, below: 0 };
  }
  const start = Math.max(0, Math.min(cursor - Math.floor(size / 2), items.length - size));
  const end = start + size;
  return {
    rows: items.slice(start, end).map((item, offset) => ({ item, index: start + offset })),
    above: start,
    below: items.length - end
  };
}

function isViewId(value: string | undefined): value is ViewId {
  return value === "overview" || value === "sprint" || value === "work";
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
  const [view, setView] = useState<ViewId>(isViewId(initialView) ? initialView : "overview");
  const [cursor, setCursor] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

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

  const selLen = useMemo(() => selectableLength(view, data), [view, data]);

  useEffect(() => {
    setCursor((current) => Math.min(current, Math.max(0, selLen - 1)));
  }, [selLen]);

  const handleKey = useCallback<InkInputHandler>(
    (input, key) => {
      if (input === "q" || key.escape || (key.ctrl && input === "c")) {
        exit();
        return;
      }
      const matchedView = VIEWS.find((entry) => entry.key === input);
      if (matchedView) {
        setView(matchedView.id);
        setCursor(0);
        return;
      }
      if (input === "r") {
        void refresh();
        return;
      }
      if (key.downArrow || input === "j") {
        setCursor((current) => Math.min(current + 1, Math.max(0, selLen - 1)));
        return;
      }
      if (key.upArrow || input === "k") {
        setCursor((current) => Math.max(current - 1, 0));
      }
    },
    [exit, refresh, selLen]
  );

  const rows = stdout?.rows ?? 24;
  const columns = stdout?.columns ?? 100;
  const listHeight = Math.max(6, rows - 9);

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {isRawModeSupported ? <KeyBindings onKey={handleKey} /> : null}
      <Header data={data} view={view} refreshing={refreshing} error={error} />
      <Box flexGrow={1} marginTop={1}>
        <NavRail view={view} />
        <Box flexDirection="column" flexGrow={1} paddingX={1}>
          {!data ? (
            <Text color={MUTED}>Loading workspace…</Text>
          ) : !data.initialized ? (
            <Panel title="Not initialized" tone={WARN}>
              <Text>{data.warnings[0] ?? "Run `bwrk init` in this directory."}</Text>
            </Panel>
          ) : view === "overview" ? (
            <OverviewView data={data} />
          ) : view === "sprint" ? (
            <SprintView data={data} cursor={cursor} height={listHeight} />
          ) : (
            <WorkView data={data} cursor={cursor} height={listHeight} />
          )}
        </Box>
      </Box>
      <Footer inputEnabled={isRawModeSupported} />
    </Box>
  );
}

function Header({
  data,
  view,
  refreshing,
  error
}: {
  readonly data: TuiData | undefined;
  readonly view: ViewId;
  readonly refreshing: boolean;
  readonly error: string | undefined;
}) {
  const label = VIEWS.find((entry) => entry.id === view)?.label ?? "Global";
  return (
    <Box flexDirection="column">
      <Box justifyContent="space-between">
        <Text>
          <Text color={ACCENT} bold>
            ❄ Boreal
          </Text>
          <Text color={MUTED}> · {label}</Text>
        </Text>
        <Text color={MUTED}>
          {refreshing ? "refreshing… " : ""}
          {data ? new Date(data.generatedAt).toLocaleTimeString() : ""}
        </Text>
      </Box>
      <Text color={MUTED} wrap="truncate">
        {data?.workspaceRoot ?? ""}
      </Text>
      {error ? <Text color={DANGER}>! {error}</Text> : null}
      {data && data.warnings.length > 0 && data.initialized ? (
        <Text color={WARN} wrap="truncate">
          ⚠ {data.warnings.join(" ")}
        </Text>
      ) : null}
    </Box>
  );
}

function NavRail({ view }: { readonly view: ViewId }) {
  return (
    <Box flexDirection="column" width={14} marginRight={1}>
      {VIEWS.map((entry) => {
        const active = entry.id === view;
        return (
          <Text key={entry.id} color={active ? ACCENT : MUTED} bold={active}>
            {active ? "▍" : " "} {entry.label}
            <Text color={MUTED}> ({entry.key})</Text>
          </Text>
        );
      })}
    </Box>
  );
}

function Footer({ inputEnabled }: { readonly inputEnabled: boolean }) {
  return (
    <Box marginTop={1}>
      {inputEnabled ? (
        <Text color={MUTED}>o/s/w views · j/k move · r refresh · q quit</Text>
      ) : (
        <Text color={WARN}>input unavailable (no raw-mode TTY) — keyboard disabled; Ctrl+C to exit</Text>
      )}
    </Box>
  );
}

function Panel({
  title,
  tone = ACCENT,
  children
}: {
  readonly title: string;
  readonly tone?: string;
  readonly children: ReactNode;
}) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1} marginBottom={1}>
      <Text color={tone} bold>
        {title}
      </Text>
      {children}
    </Box>
  );
}

function Metric({ label, value, tone = ACCENT }: { readonly label: string; readonly value: number; readonly tone?: string }) {
  return (
    <Box flexDirection="column" marginRight={3}>
      <Text color={tone} bold>
        {value}
      </Text>
      <Text color={MUTED}>{label}</Text>
    </Box>
  );
}

function OverviewView({ data }: { readonly data: TuiData }) {
  const summary = data.work.summary;
  const readyQueue = data.work.queues.find((queue) => queue.id === "ready");
  const inProgressQueue = data.work.queues.find((queue) => queue.id === "in_progress");
  return (
    <Box flexDirection="column">
      <Panel title="Overview">
        <Box>
          <Metric label="total" value={summary.total} tone={MUTED} />
          <Metric label="ready" value={summary.ready} />
          <Metric label="in progress" value={summary.inProgress} tone="#8be9a5" />
          <Metric label="blocked" value={summary.blocked} tone={WARN} />
          <Metric label="needs verify" value={summary.needsVerification} tone={WARN} />
          <Metric label="verified" value={summary.verified} />
          <Metric label="reserved" value={summary.activeReservations} tone={MUTED} />
        </Box>
      </Panel>
      <Box>
        <Box width="50%" flexDirection="column" marginRight={1}>
          <Panel title={`Ready to claim (${readyQueue?.count ?? 0})`}>
            <WorkLines items={readyQueue?.items ?? []} empty="Nothing ready." />
          </Panel>
          <Panel title={`In progress (${inProgressQueue?.count ?? 0})`} tone="#8be9a5">
            <WorkLines items={inProgressQueue?.items ?? []} empty="No active work." />
          </Panel>
        </Box>
        <Box width="50%" flexDirection="column">
          <Panel title="Recent activity" tone={MUTED}>
            {data.activity.length === 0 ? (
              <Text color={MUTED}>No recent events.</Text>
            ) : (
              data.activity.slice(0, 8).map((entry) => (
                <Text key={entry.id} wrap="truncate">
                  <Text color={MUTED}>{new Date(entry.at).toLocaleTimeString()} </Text>
                  <Text color={ACCENT}>{entry.type}</Text>
                  <Text color={MUTED}> {entry.subjectType}</Text>
                </Text>
              ))
            )}
          </Panel>
        </Box>
      </Box>
    </Box>
  );
}

function WorkLines({ items, empty }: { readonly items: readonly WorkItemView[]; readonly empty: string }) {
  if (items.length === 0) return <Text color={MUTED}>{empty}</Text>;
  return (
    <>
      {items.slice(0, 6).map((item) => (
        <Text key={item.id} wrap="truncate">
          <Text color={statusColor(item.status)}>● </Text>
          {item.title}
        </Text>
      ))}
      {items.length > 6 ? <Text color={MUTED}>+{items.length - 6} more</Text> : null}
    </>
  );
}

function WorkView({ data, cursor, height }: { readonly data: TuiData; readonly cursor: number; readonly height: number }) {
  const items = data.work.queues.flatMap((queue) => queue.items);
  const selected = items[Math.min(cursor, Math.max(0, items.length - 1))];
  const win = windowList(items, cursor, height);
  return (
    <Box>
      <Box width="55%" flexDirection="column" marginRight={1}>
        <Text color={MUTED}>Work · {items.length} items</Text>
        {win.above > 0 ? <Text color={MUTED}>↑ {win.above} more</Text> : null}
        {items.length === 0 ? <Text color={MUTED}>No work items.</Text> : null}
        {win.rows.map(({ item, index }) => (
          <Text key={item.id} wrap="truncate" inverse={index === cursor}>
            <Text color={statusColor(item.status)}>● </Text>
            {item.title}
          </Text>
        ))}
        {win.below > 0 ? <Text color={MUTED}>↓ {win.below} more</Text> : null}
      </Box>
      <Box width="45%">
        <WorkDetail item={selected} />
      </Box>
    </Box>
  );
}

function SprintView({ data, cursor, height }: { readonly data: TuiData; readonly cursor: number; readonly height: number }) {
  if (data.sprints.length === 0) {
    return (
      <Panel title="Sprints" tone={WARN}>
        <Text color={MUTED}>No sprints found. Create one with `bwrk work create … --kind sprint`.</Text>
      </Panel>
    );
  }
  const selected = data.sprints[Math.min(cursor, data.sprints.length - 1)];
  const win = windowList(data.sprints, cursor, height);
  return (
    <Box>
      <Box width="44%" flexDirection="column" marginRight={1}>
        <Text color={MUTED}>Sprints · {data.sprints.length}</Text>
        {win.above > 0 ? <Text color={MUTED}>↑ {win.above} more</Text> : null}
        {win.rows.map(({ item, index }) => {
          const done = item.board.summary.verified + item.board.summary.closed;
          return (
            <Text key={item.view.id} wrap="truncate" inverse={index === cursor}>
              <Text color={statusColor(item.view.status)}>● </Text>
              {item.active ? <Text color={ACCENT}>★ </Text> : null}
              {item.view.title}
              <Text color={MUTED}> ({done}/{item.scopeCount})</Text>
            </Text>
          );
        })}
        {win.below > 0 ? <Text color={MUTED}>↓ {win.below} more</Text> : null}
      </Box>
      <Box width="56%">{selected ? <SprintDetail sprint={selected} /> : null}</Box>
    </Box>
  );
}

function SprintDetail({ sprint }: { readonly sprint: TuiData["sprints"][number] }) {
  const { view, board, scopeCount, active } = sprint;
  const lanes = board.lanes.filter((lane) => lane.count > 0);
  const tasks = board.lanes.flatMap((lane) => lane.items);
  return (
    <Panel title={view.title} tone={statusColor(view.status)}>
      <Detail label="status" value={active ? `${view.status} (active)` : view.status} valueColor={statusColor(view.status)} />
      <Detail label="priority" value={view.priority} />
      <Detail label="labels" value={view.labels.length > 0 ? view.labels.join(", ") : "none"} />
      <Detail label="scope" value={`${scopeCount} items · ${board.summary.taskCount} tasks · ${board.summary.phaseCount} phases`} />
      <Detail
        label="blockers"
        value={String(board.summary.activeBlockerCount)}
        valueColor={board.summary.activeBlockerCount > 0 ? WARN : undefined}
      />
      <Box marginTop={1} flexDirection="column">
        <Text color={MUTED}>lanes</Text>
        {lanes.length === 0 ? (
          <Text color={MUTED}> no work yet</Text>
        ) : (
          lanes.map((lane) => (
            <Text key={lane.id} wrap="truncate">
              <Text color={statusColor(lane.id)}>{lane.title}</Text>
              <Text color={MUTED}> {lane.count}</Text>
            </Text>
          ))
        )}
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={MUTED}>tasks</Text>
        {tasks.slice(0, 8).map((item) => (
          <Text key={item.id} wrap="truncate">
            <Text color={statusColor(item.status)}>● </Text>
            {item.title}
          </Text>
        ))}
        {tasks.length > 8 ? <Text color={MUTED}>+{tasks.length - 8} more</Text> : null}
      </Box>
    </Panel>
  );
}

function WorkDetail({ item }: { readonly item: WorkItemView | undefined }) {
  if (!item) {
    return (
      <Panel title="Detail" tone={MUTED}>
        <Text color={MUTED}>Select an item with j/k.</Text>
      </Panel>
    );
  }
  return (
    <Panel title={item.title} tone={statusColor(item.status)}>
      <Detail label="id" value={item.id} />
      <Detail label="kind" value={item.kind} />
      <Detail label="status" value={item.status} valueColor={statusColor(item.status)} />
      <Detail label="priority" value={item.priority} />
      <Detail label="labels" value={item.labels.length > 0 ? item.labels.join(", ") : "none"} />
      <Detail label="blockers" value={item.activeBlockerIds.length > 0 ? item.activeBlockerIds.join(", ") : "none"} />
      <Detail
        label="reserved"
        value={item.activeReservation ? `${item.activeReservation.agentId}${item.activeReservation.expired ? " (expired)" : ""}` : "no"}
      />
      <Detail label="evidence" value={`${item.evidenceCount} · verifications ${item.verificationCount}`} />
      {item.contextSummary ? <Text color={MUTED} wrap="truncate">{item.contextSummary}</Text> : null}
    </Panel>
  );
}

function Detail({ label, value, valueColor }: { readonly label: string; readonly value: string; readonly valueColor?: string }) {
  return (
    <Text wrap="truncate">
      <Text color={MUTED}>{label.padEnd(9)}</Text>
      <Text color={valueColor}>{value}</Text>
    </Text>
  );
}

function healthColor(health: string): string {
  if (health === "ok") return ACCENT;
  if (health === "warning") return WARN;
  if (health === "error" || health === "critical") return DANGER;
  return MUTED;
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
  const selected = projects[cursor];

  return (
    <Box flexDirection="column" width={columns} height={rows}>
      {isRawModeSupported ? <KeyBindings onKey={handleKey} /> : null}
      <Box justifyContent="space-between">
        <Text>
          <Text color={ACCENT} bold>❄ Boreal Global</Text>
          <Text color={MUTED}> · {projects.length} registered project{projects.length === 1 ? "" : "s"}</Text>
        </Text>
        <Text color={MUTED}>
          {refreshing ? "refreshing… " : ""}
          {data ? new Date(data.generatedAt).toLocaleTimeString() : ""}
        </Text>
      </Box>
      {error ? <Text color={DANGER}>! {error}</Text> : null}
      {data && data.warnings.length > 0 ? <Text color={WARN} wrap="truncate">⚠ {data.warnings.join(" ")}</Text> : null}
      <Box marginTop={1} flexGrow={1}>
        {!data ? (
          <Text color={MUTED}>Loading registry…</Text>
        ) : projects.length === 0 ? (
          <Panel title="No projects registered" tone={WARN}>
            <Text>Global tracks every registered project. Register one with</Text>
            <Text color={ACCENT}>{"bwrk registry add --workspace <path>"}</Text>
            <Text color={MUTED}>then refresh with r.</Text>
          </Panel>
        ) : (
          <Box flexDirection="column">
            <Box>
              <Box width={30}><Text color={MUTED} bold>project</Text></Box>
              <Box width={10}><Text color={MUTED} bold>health</Text></Box>
              <Box width={7}><Text color={MUTED} bold>open</Text></Box>
              <Box width={7}><Text color={MUTED} bold>ready</Text></Box>
              <Box width={9}><Text color={MUTED} bold>blocked</Text></Box>
              <Box width={6}><Text color={MUTED} bold>resv</Text></Box>
            </Box>
            {projects.map((project, index) => (
              <Box key={project.id || index}>
                <Box width={30}><Text inverse={index === cursor} wrap="truncate">{project.name}</Text></Box>
                <Box width={10}><Text color={healthColor(project.health)}>{project.stale ? "stale" : project.health}</Text></Box>
                <Box width={7}><Text>{project.open}</Text></Box>
                <Box width={7}><Text color={ACCENT}>{project.ready}</Text></Box>
                <Box width={9}><Text color={project.blocked > 0 ? WARN : MUTED}>{project.blocked}</Text></Box>
                <Box width={6}><Text color={MUTED}>{project.reservations}</Text></Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
      {selected ? <Text color={MUTED} wrap="truncate">{selected.projectRoot}</Text> : null}
      <Box marginTop={1}>
        {isRawModeSupported ? (
          <Text color={MUTED}>j/k move · r refresh · q quit</Text>
        ) : (
          <Text color={WARN}>input unavailable (no raw-mode TTY) — keyboard disabled; Ctrl+C to exit</Text>
        )}
      </Box>
    </Box>
  );
}
