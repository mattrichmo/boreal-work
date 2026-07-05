import { Box, Text } from "ink";

import { COLOR } from "../theme.js";
import { Metric, Table, type TableColumn, type TableRow } from "../ui.js";
import type { GlobalOverviewBody } from "../loaders.js";

export function GlobalOverviewRoute({
  body,
  cursor,
  height,
  width
}: {
  readonly body: GlobalOverviewBody;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const columns: readonly TableColumn[] = [
    { header: "severity", width: 9 },
    { header: "project", width: Math.max(14, Math.floor(width * 0.25)) },
    { header: "title", width: Math.max(20, width - 9 - Math.floor(width * 0.25) - 2) }
  ];
  const rows: readonly TableRow[] = body.attention.map((row) => ({
    key: row.id,
    cells: [
      { text: row.severity, color: row.severity === "error" ? COLOR.danger : COLOR.warn },
      { text: row.projectName, color: COLOR.text },
      { text: row.title, color: COLOR.muted }
    ]
  }));
  return (
    <Box flexDirection="column">
      <Box>
        <Metric label="projects" value={body.registrySummary.totalProjects} tone={COLOR.muted} />
        <Metric label="ok" value={body.registrySummary.healthyProjects} />
        <Metric label="warn" value={body.registrySummary.warningProjects} tone={COLOR.warn} />
        <Metric label="error" value={body.registrySummary.errorProjects} tone={COLOR.danger} />
        <Metric label="stale" value={body.registrySummary.staleProjects} tone={COLOR.warn} />
        <Metric label="ready" value={body.queueSummary.ready} />
        <Metric label="blocked" value={body.queueSummary.blocked} tone={COLOR.warn} />
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text color={COLOR.faint}>{`ATTENTION QUEUE (${body.attention.length})`}</Text>
        <Table columns={columns} rows={rows} cursor={cursor} height={height - 4} emptyLabel="Nothing needs attention." />
      </Box>
    </Box>
  );
}
