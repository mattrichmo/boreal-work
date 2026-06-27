import { Box, Text } from "ink";
import type { ReactNode } from "react";

import { COLOR, fit } from "./theme.js";

export interface Windowed<T> {
  readonly rows: readonly { readonly item: T; readonly index: number }[];
  readonly above: number;
  readonly below: number;
}

// Window a list around the cursor so it never overflows the terminal (overflow
// corrupts Ink's frame diff). Always keeps the cursor row visible.
export function windowList<T>(items: readonly T[], cursor: number, size: number): Windowed<T> {
  const capped = Math.max(1, size);
  if (items.length <= capped) {
    return { rows: items.map((item, index) => ({ item, index })), above: 0, below: 0 };
  }
  const start = Math.max(0, Math.min(cursor - Math.floor(capped / 2), items.length - capped));
  const end = start + capped;
  return {
    rows: items.slice(start, end).map((item, offset) => ({ item, index: start + offset })),
    above: start,
    below: items.length - end
  };
}

export interface TableColumn {
  readonly header: string;
  readonly width: number;
  readonly align?: "left" | "right";
}

export interface TableCell {
  readonly text: string;
  readonly color?: string;
  readonly bold?: boolean;
}

export interface TableRow {
  readonly key: string;
  readonly cells: readonly TableCell[];
}

export function Table({
  columns,
  rows,
  cursor,
  height,
  emptyLabel = "Nothing here yet."
}: {
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly cursor: number;
  readonly height: number;
  readonly emptyLabel?: string;
}) {
  const win = windowList(rows, cursor, height);
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={2}>
          <Text> </Text>
        </Box>
        {columns.map((column, index) => (
          <Box key={index} width={column.width} justifyContent={column.align === "right" ? "flex-end" : "flex-start"}>
            <Text color={COLOR.faint}>{fit(column.header.toUpperCase(), column.width)}</Text>
          </Box>
        ))}
      </Box>
      {win.above > 0 ? <Text color={COLOR.faint}>{`  ↑ ${win.above} more`}</Text> : null}
      {rows.length === 0 ? <Text color={COLOR.muted}>{`  ${emptyLabel}`}</Text> : null}
      {win.rows.map(({ item, index }) => {
        const selected = index === cursor;
        return (
          <Box key={item.key} backgroundColor={selected ? COLOR.selectionBg : undefined}>
            <Box width={2}>
              <Text color={COLOR.accent} bold>
                {selected ? "▸ " : "  "}
              </Text>
            </Box>
            {columns.map((column, columnIndex) => {
              const cell = item.cells[columnIndex];
              return (
                <Box key={columnIndex} width={column.width} justifyContent={column.align === "right" ? "flex-end" : "flex-start"}>
                  <Text color={cell?.color ?? COLOR.text} bold={cell?.bold || selected}>
                    {fit(cell?.text ?? "", column.width)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
      {win.below > 0 ? <Text color={COLOR.faint}>{`  ↓ ${win.below} more`}</Text> : null}
    </Box>
  );
}

export function TopBar({ crumbs, right }: { readonly crumbs: readonly string[]; readonly right?: string }) {
  return (
    <Box backgroundColor={COLOR.barBg} paddingX={1} justifyContent="space-between">
      <Box>
        <Text color={COLOR.accent} bold>
          ❄ boreal
        </Text>
        {crumbs.map((crumb, index) => (
          <Text key={index} color={index === crumbs.length - 1 ? COLOR.text : COLOR.muted}>
            {`  ${index === 0 ? "" : "› "}${crumb}`}
          </Text>
        ))}
      </Box>
      {right ? <Text color={COLOR.faint}>{right}</Text> : null}
    </Box>
  );
}

export function SectionRail({
  sections,
  active
}: {
  readonly sections: readonly { readonly id: string; readonly label: string; readonly key: string }[];
  readonly active: string;
}) {
  return (
    <Box flexDirection="column" width={13} marginRight={1}>
      {sections.map((section) => {
        const isActive = section.id === active;
        return (
          <Text key={section.id} color={isActive ? COLOR.accent : COLOR.muted} bold={isActive}>
            {isActive ? "▍ " : "  "}
            {section.label}
            <Text color={COLOR.faint}>{` ${section.key}`}</Text>
          </Text>
        );
      })}
    </Box>
  );
}

export function Pane({ title, tone = COLOR.accent, children }: { readonly title?: string; readonly tone?: string; readonly children: ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1}>
      {title ? (
        <Text color={tone} bold wrap="truncate">
          {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}

export function Field({ label, value, color }: { readonly label: string; readonly value: string; readonly color?: string }) {
  return (
    <Text wrap="truncate">
      <Text color={COLOR.faint}>{fit(label, 11)}</Text>
      <Text color={color ?? COLOR.text}>{value}</Text>
    </Text>
  );
}

export function Metric({ label, value, tone = COLOR.accent }: { readonly label: string; readonly value: number | string; readonly tone?: string }) {
  return (
    <Box flexDirection="column" marginRight={3}>
      <Text color={tone} bold>
        {String(value)}
      </Text>
      <Text color={COLOR.faint}>{label}</Text>
    </Box>
  );
}

export function KeyHints({ hints }: { readonly hints: readonly { readonly keys: string; readonly label: string }[] }) {
  return (
    <Box paddingX={1}>
      <Text>
        {hints.map((hint, index) => (
          <Text key={index}>
            {index > 0 ? <Text color={COLOR.faint}>{"  ·  "}</Text> : null}
            <Text color={COLOR.muted} bold>
              {hint.keys}
            </Text>
            <Text color={COLOR.faint}>{` ${hint.label}`}</Text>
          </Text>
        ))}
      </Text>
    </Box>
  );
}

export function EmptyState({ title, lines }: { readonly title: string; readonly lines: readonly string[] }) {
  return (
    <Pane title={title} tone={COLOR.warn}>
      {lines.map((line, index) => (
        <Text key={index} color={index === 0 ? COLOR.text : COLOR.muted}>
          {line}
        </Text>
      ))}
    </Pane>
  );
}
