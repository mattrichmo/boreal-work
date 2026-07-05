import { Box, Text } from "ink";

import type { GlobalWorkQueuesView } from "@boreal/ui-model";
import { COLOR, statusColor } from "../theme.js";
import { Table, type TableColumn, type TableRow } from "../ui.js";

export function GlobalQueuesRoute({
  body,
  cursor,
  height,
  width
}: {
  readonly body: GlobalWorkQueuesView;
  readonly cursor: number;
  readonly height: number;
  readonly width: number;
}) {
  const items = body.queues.flatMap((queue) => queue.items);
  const nameWidth = Math.max(16, width - 8 - Math.floor(width * 0.22) - 8);
  const columns: readonly TableColumn[] = [
    { header: "queue", width: 8 },
    { header: "project", width: Math.floor(width * 0.22) },
    { header: "title", width: nameWidth },
    { header: "prio", width: 8 }
  ];
  const rows: readonly TableRow[] = items.map((item) => ({
    key: item.id,
    cells: [
      { text: item.work.status, color: statusColor(item.work.status) },
      { text: item.projectName, color: COLOR.muted },
      { text: item.work.title, color: COLOR.text },
      { text: item.work.priority, color: COLOR.faint }
    ]
  }));
  return (
    <Box flexDirection="column">
      <Text color={COLOR.faint}>
        {`READY ${body.summary.ready}  ·  BLOCKED ${body.summary.blocked}  ·  VERIFY ${body.summary.needsVerification}`}
      </Text>
      <Table columns={columns} rows={rows} cursor={cursor} height={height - 2} emptyLabel="No actionable work across linked projects." />
    </Box>
  );
}
