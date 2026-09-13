import { Box, Text } from "ink";

import type { PaletteItem } from "./palette.js";
import { boundedTextLines } from "./routes/task-detail.js";
import { COLOR, fit } from "./theme.js";
import { Table, type TableColumn, type TableRow } from "./ui.js";

export function FreshnessLine({ generatedAt, label, filter, error, stale, frozen = false, warnings, blocked, width }: {
  readonly generatedAt?: string; readonly label: string; readonly filter?: string; readonly error?: string; readonly stale: boolean; readonly frozen?: boolean; readonly warnings: number; readonly blocked: boolean; readonly width: number;
}) {
  // A ticking age label forces Ink to repaint even when the data is unchanged.
  const updatedAt = generatedAt && Number.isFinite(Date.parse(generatedAt))
    ? new Date(generatedAt).toLocaleTimeString([], { hour12: false }) : undefined;
  const text = error ? `${generatedAt ? "Last known data · " : ""}${frozen ? "FROZEN · " : ""}${error.replaceAll("\n", " ")} · r retry`
    : [label, filter ? `view: ${filter}` : "", frozen ? "FROZEN" : "", stale ? "STALE" : "", warnings ? `${warnings} warnings · ? details` : "", blocked ? "read-only" : "", updatedAt === undefined ? "Loading" : `updated ${updatedAt}`].filter(Boolean).join(" · ");
  return <Text color={error ? COLOR.danger : frozen || stale || warnings ? COLOR.warn : COLOR.faint} wrap="truncate">{fit(text, width)}</Text>;
}

export function HelpView({ width, height, hints, workspace, scrollOffset, diagnostics }: { readonly width: number; readonly height: number; readonly hints: readonly { readonly keys: string; readonly label: string }[]; readonly workspace: string; readonly scrollOffset: number; readonly diagnostics: readonly string[] }) {
  const lines = [
    "↑↓/jk move · Enter open or confirm · Space expand/collapse",
    "← focus section rail · →/l expand or open · h fold/back",
    "Tab focus panes · p preview · e maximize · P layout · x XRay · v/V mark",
    ": commands · F live/freeze · T theme · click focuses a pane",
    "f filters · / search · r refresh · q or Ctrl-C twice quits",
    ...hints.map((hint) => `${hint.keys}  ${hint.label}`),
    `Workspace: ${workspace}`,
    ...diagnostics.map((message) => `Diagnostic: ${message}`)
  ].flatMap((line) => boundedTextLines(line, width, Number.MAX_SAFE_INTEGER));
  const offset = Math.min(scrollOffset, Math.max(0, lines.length - Math.max(1, height - 1)));
  return <Box flexDirection="column" width={width} height={height} overflow="hidden"><Text color={COLOR.text} wrap="truncate">{fit("Help · ↑↓ scroll · Esc closes", width)}</Text>{lines.slice(offset, offset + height - 1).map((line, index) => <Text key={index} color={COLOR.muted} wrap="truncate">{fit(line, width)}</Text>)}</Box>;
}

export function Palette({ query, results, cursor, height, width, title }: { readonly query: string; readonly results: readonly PaletteItem[]; readonly cursor: number; readonly height: number; readonly width: number; readonly title: string }) {
  const columns: readonly TableColumn[] = [{ header: "kind", width: 8 }, { header: "name", width: Math.max(1, width - 11) }];
  const rows: readonly TableRow[] = results.map((item) => ({ key: `${item.workspaceRoot}:${item.kind}:${item.id}`, cells: [{ text: item.kind, color: COLOR.muted }, { text: `${item.label} · ${item.hint}`, color: COLOR.text }] }));
  return <Box flexDirection="column" height={height} width={width} overflow="hidden"><Text color={COLOR.muted} wrap="truncate">{fit(title, width)}</Text><Text wrap="truncate"><Text color={COLOR.accent} bold>{"❯ "}</Text><Text color={COLOR.text}>{fit(query, Math.max(1, width - 3))}</Text><Text color={COLOR.accent}>▌</Text></Text><Table columns={columns} rows={rows} cursor={cursor} height={Math.max(0, height - 2)} width={width} emptyLabel="No matching work or routes." /></Box>;
}
