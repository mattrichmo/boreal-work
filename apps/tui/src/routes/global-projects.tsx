import { Box, Text } from "ink";

import type { ProjectRegistryView } from "@boreal/ui-model";
import { COLOR, healthColor } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

export function GlobalProjectsRoute({
  body,
  cursor,
  height,
  width
}: {
  readonly body: ProjectRegistryView;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const nameWidth = Math.max(16, width - 9 - 7 - 7 - 9 - 8);
  const columns: readonly TableColumn[] = [
    { header: "health", width: 9 },
    { header: "project", width: nameWidth },
    { header: "open", width: 7, align: "right" },
    { header: "ready", width: 7, align: "right" },
    { header: "blocked", width: 9, align: "right" },
    { header: "stale", width: 8 }
  ];
  const rows: readonly TableRow[] = body.entries.map((entry) => ({
    key: entry.id,
    cells: [
      { text: entry.health, color: healthColor(entry.health) },
      { text: entry.name, color: COLOR.text },
      { text: String(entry.openWorkCount), color: COLOR.muted },
      { text: String(entry.readyWorkCount), color: COLOR.accent },
      { text: String(entry.blockedWorkCount), color: entry.blockedWorkCount > 0 ? COLOR.warn : COLOR.faint },
      { text: entry.stale ? "yes" : "no", color: entry.stale ? COLOR.warn : COLOR.faint }
    ]
  }));
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint}>{`PROJECTS (${body.entries.length}) · enter opens repo surface`}</Text>
      <Table columns={columns} rows={rows} cursor={cursor} height={height - 2} emptyLabel="No linked projects — bwrk link <path>." />
    </Box>
  );
}
