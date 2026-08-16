import { Box, Text } from "ink";

import { COLOR, fit } from "../theme.js";
import { Metric, Table, type TableColumn, type TableRow } from "../ui.js";
import type { GlobalOverviewBody } from "../loaders.js";

export interface GlobalRouteState {
  readonly stale?: boolean;
  readonly sampled?: boolean;
  readonly truncated?: boolean;
  readonly missing?: boolean;
  readonly warnings?: readonly string[];
}

/**
 * Reads optional envelope metadata if a future shell passes it through the
 * route body. RouteApp also passes envelope state so stale/sample warnings can
 * be shown without mutating the durable view model.
 */
export function globalRouteState(value: object, override?: GlobalRouteState): GlobalRouteState {
  const candidate = value as {
    readonly stale?: unknown;
    readonly sampled?: unknown;
    readonly truncated?: unknown;
    readonly missing?: unknown;
    readonly warnings?: unknown;
  };
  const truncated = typeof candidate.truncated === "boolean"
    ? candidate.truncated
    : typeof candidate.truncated === "object" && candidate.truncated !== null
      ? Object.values(candidate.truncated as Record<string, unknown>).some((entry) => entry === true)
      : undefined;
  return {
    stale: override?.stale ?? (typeof candidate.stale === "boolean" ? candidate.stale : undefined),
    sampled: override?.sampled ?? (typeof candidate.sampled === "boolean" ? candidate.sampled : undefined),
    truncated: override?.truncated ?? truncated,
    missing: override?.missing ?? (typeof candidate.missing === "boolean" ? candidate.missing : undefined),
    warnings: override?.warnings ?? (Array.isArray(candidate.warnings) ? candidate.warnings.filter((warning): warning is string => typeof warning === "string") : undefined)
  };
}

export function globalStatusLabels(state: GlobalRouteState): readonly string[] {
  const labels: string[] = [];
  if (state.stale) labels.push("stale");
  if (state.sampled || state.truncated) labels.push("sampled/truncated");
  if (state.missing) labels.push("missing projects");
  return labels;
}

function stateLine(state: GlobalRouteState): string | undefined {
  const labels = globalStatusLabels(state);
  return labels.length > 0 ? `DATA STATE · ${labels.join(" · ")}` : undefined;
}

function overviewColumnWidths(width: number): readonly [number, number, number, number] {
  const total = Math.max(1, width - 2);
  const severity = Math.max(1, Math.min(9, Math.floor(total * 0.18)));
  const project = Math.max(1, Math.min(16, Math.floor(total * 0.2)));
  const action = Math.max(1, Math.min(10, Math.floor(total * 0.16)));
  return [severity, project, action, Math.max(1, total - severity - project - action)];
}

export function GlobalOverviewRoute({
  body,
  cursor,
  height,
  width,
  state
}: {
  readonly body: GlobalOverviewBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
  readonly state?: GlobalRouteState;
}) {
  const embeddedState = globalRouteState(body, state);
  const derivedState: GlobalRouteState = {
    ...embeddedState,
    stale: embeddedState.stale ?? body.registrySummary.staleProjects > 0,
    missing: embeddedState.missing ?? body.registrySummary.missingProjects > 0
  };
  const [severityWidth, projectWidth, actionWidth, contextWidth] = overviewColumnWidths(width);
  const columns: readonly TableColumn[] = [
    { header: "severity", width: severityWidth },
    { header: "project", width: projectWidth },
    { header: "action", width: actionWidth },
    { header: "finding / message", width: contextWidth }
  ];
  const rows: readonly TableRow[] = body.attention.map((row) => ({
    key: row.id,
    cells: [
      { text: row.severity, color: row.severity === "error" ? COLOR.danger : COLOR.warn },
      { text: fit(row.projectName, projectWidth), color: COLOR.text },
        { text: row.action ? "repair" : "open project", color: COLOR.accent },
        { text: fit(`${row.title} · ${row.message}`, contextWidth), color: COLOR.muted }
    ]
  }));
  const notice = stateLine(derivedState);
  const selectedAttention = body.attention[cursor];
  return (
    <Box flexDirection="column">
      <Box width={Math.max(1, width - 2)} flexWrap="wrap">
        <Metric label="projects" value={body.registrySummary.totalProjects} tone={COLOR.muted} />
        <Metric label="ok" value={body.registrySummary.healthyProjects} />
        <Metric label="warn" value={body.registrySummary.warningProjects} tone={COLOR.warn} />
        <Metric label="error" value={body.registrySummary.errorProjects} tone={COLOR.danger} />
        <Metric label="missing" value={body.registrySummary.missingProjects} tone={body.registrySummary.missingProjects > 0 ? COLOR.warn : COLOR.faint} />
        <Metric label="stale" value={body.registrySummary.staleProjects} tone={body.registrySummary.staleProjects > 0 ? COLOR.warn : COLOR.faint} />
        <Metric label="ready" value={body.queueSummary.ready} />
        <Metric label="blocked" value={body.queueSummary.blocked} tone={COLOR.warn} />
      </Box>
      {notice ? <Text color={derivedState.stale || derivedState.missing ? COLOR.warn : COLOR.faint}>{notice}</Text> : null}
      {derivedState.warnings?.map((warning) => <Text key={warning} color={COLOR.warn} wrap="truncate">{`⚠ ${warning}`}</Text>)}
      <Box marginTop={1} flexDirection="column">
        <Text color={COLOR.faint}>{`ATTENTION QUEUE (${body.attention.length}) · ENTER opens the affected project`}</Text>
        <Table columns={columns} rows={rows} cursor={cursor} height={Math.max(1, height - 9)} width={width} emptyLabel="No linked-project findings. Use `bwrk global link <path>` to add a project." />
        {selectedAttention ? <Text color={COLOR.muted} wrap="truncate">{fit(`DETAIL · ${selectedAttention.projectName} · ${selectedAttention.message}${selectedAttention.action?.command ? ` · action: ${selectedAttention.action.command}` : ""}`, Math.max(1, width - 2))}</Text> : null}
      </Box>
    </Box>
  );
}
