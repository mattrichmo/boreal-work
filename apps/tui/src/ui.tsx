import { Box, Text, useStdout } from "ink";
import type { ReactNode } from "react";

import { cellWidth, COLOR, fit } from "./theme.js";

export interface Windowed<T> {
  readonly rows: readonly { readonly item: T; readonly index: number }[];
  readonly above: number;
  readonly below: number;
}

// Window a list around the cursor. A zero-sized window is useful to callers
// that have no body row available (for example, a one-line table below its
// header); the selected index remains represented by the overflow counts.
export function windowList<T>(items: readonly T[], cursor: number, size: number): Windowed<T> {
  const capped = Math.max(0, Math.floor(size));
  const anchor = items.length === 0 ? 0 : Math.max(0, Math.min(Math.floor(cursor), items.length - 1));
  if (capped === 0) return { rows: [], above: anchor, below: Math.max(0, items.length - anchor) };
  if (items.length <= capped) {
    return { rows: items.map((item, index) => ({ item, index })), above: 0, below: 0 };
  }
  const start = Math.max(0, Math.min(anchor - Math.floor(capped / 2), items.length - capped));
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
  /** The smallest useful width before this column is hidden as a fallback. */
  readonly minWidth?: number;
  /** Larger values are hidden first when readable minimums cannot fit. */
  readonly priority?: number;
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

/**
 * Fit requested column widths into a terminal row, including the selection
 * gutter. Columns are compressed before the right-most columns are hidden;
 * this keeps the title/identity columns useful on narrow terminals without
 * ever allowing the row to exceed the available cell budget.
 */
export function fitTableColumnWidths(
  columns: readonly TableColumn[],
  availableWidth: number,
  gutterWidth = 2,
  gapWidth = 1
): readonly number[] {
  const available = Math.max(0, Math.floor(availableWidth) - Math.max(0, Math.floor(gutterWidth)));
  const gap = Math.max(0, Math.floor(gapWidth));
  const widths = columns.map((column) => Math.max(1, Math.floor(column.width)));
  const minimums = columns.map((column, index) => Math.min(widths[index] ?? 1, Math.max(1, Math.floor(column.minWidth ?? 1))));
  const visible = new Set(columns.map((_, index) => index));
  const gapBudget = (): number => Math.max(0, visible.size - 1) * gap;
  // Remove a secondary column completely before violating its readable minimum.
  while (visible.size > 1 && [...visible].reduce((sum, index) => sum + (minimums[index] ?? 1), 0) + gapBudget() > available) {
    const remove = [...visible].sort((a, b) => (columns[b]?.priority ?? b) - (columns[a]?.priority ?? a) || b - a)[0];
    if (remove === undefined) break;
    visible.delete(remove);
    widths[remove] = 0;
  }
  const budget = Math.max(0, available - gapBudget());
  let total = widths.reduce((sum, width) => sum + width, 0);
  while (total > budget) {
    const candidate = [...visible].sort((a, b) => ((widths[b] ?? 0) - (minimums[b] ?? 1)) - ((widths[a] ?? 0) - (minimums[a] ?? 1)))[0];
    if (candidate === undefined) break;
    if ((widths[candidate] ?? 0) <= (minimums[candidate] ?? 1)) {
      // A terminal smaller than one useful column still gets a bounded identity.
      widths[candidate] = Math.max(0, (widths[candidate] ?? 0) - (total - budget));
      break;
    }
    widths[candidate] = (widths[candidate] ?? 0) - 1;
    total -= 1;
  }
  return widths;
}

/** Number of body rows available after a one-line table header and indicators. */
export function tableRowCapacity(itemCount: number, height: number): number {
  const bodyHeight = Math.max(0, Math.floor(height) - 1);
  if (itemCount > bodyHeight && bodyHeight >= 3) return bodyHeight - 2;
  return bodyHeight;
}

/** Number of overflow-indicator lines that can safely accompany a table. */
export function tableIndicatorLines(itemCount: number, height: number): number {
  const bodyHeight = Math.max(0, Math.floor(height) - 1);
  return itemCount > bodyHeight && bodyHeight >= 3 ? 2 : 0;
}

function terminalWidth(columns: number | undefined, fallback = 100): number {
  return Math.max(1, Math.floor(columns && columns > 0 ? columns : fallback));
}

export function Table({
  columns,
  rows,
  cursor,
  height,
  width,
  emptyLabel = "Nothing here yet."
}: {
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  readonly cursor: number;
  readonly height: number;
  /** Total terminal width available to the table, including the gutter. */
  readonly width?: number;
  readonly emptyLabel?: string;
}) {
  const { stdout } = useStdout();
  const tableHeight = Math.max(0, Math.floor(height));
  const tableWidth = terminalWidth(width ?? stdout?.columns, 100);
  const gutterWidth = Math.min(2, tableWidth);
  const columnGap = 1;
  const columnWidths = fitTableColumnWidths(columns, tableWidth, gutterWidth, columnGap);
  const visibleColumns = columns.flatMap((column, index) => {
    const fittedWidth = columnWidths[index] ?? 0;
    return fittedWidth > 0 ? [{ column, index, width: fittedWidth }] : [];
  });
  const rowCapacity = tableRowCapacity(rows.length, tableHeight);
  const indicatorLines = tableIndicatorLines(rows.length, tableHeight);
  const win = rowCapacity > 0 ? windowList(rows, cursor, rowCapacity) : windowList(rows, cursor, 0);

  if (tableHeight === 0) return <Box />;

  return (
    <Box flexDirection="column" width={tableWidth} height={tableHeight}>
      <Box width={tableWidth}>
        <Box width={gutterWidth}>
          <Text>{fit("", gutterWidth)}</Text>
        </Box>
        {visibleColumns.map(({ column, index, width: fittedWidth }) => (
          <Box key={index} width={fittedWidth} marginLeft={index === visibleColumns[0]?.index ? 0 : columnGap}>
            <Text color={COLOR.faint}>{fit(column.header.toUpperCase(), fittedWidth, column.align)}</Text>
          </Box>
        ))}
      </Box>
      {indicatorLines > 0 && win.above > 0 ? <Text color={COLOR.faint}>{fit(`↑ ${win.above} more`, tableWidth)}</Text> : null}
      {rows.length === 0 && tableHeight > 1 ? <Text color={COLOR.muted}>{fit(emptyLabel, tableWidth)}</Text> : null}
      {win.rows.map(({ item, index }) => {
        const selected = index === cursor;
        return (
          <Box key={item.key} width={tableWidth} backgroundColor={selected ? COLOR.selectionBg : undefined}>
            <Box width={gutterWidth}>
              <Text color={COLOR.accent} bold>
                {fit(selected ? "▸ " : "  ", gutterWidth)}
              </Text>
            </Box>
            {visibleColumns.map(({ column, index: columnIndex, width: fittedWidth }) => {
              const cell = item.cells[columnIndex];
              return (
                <Box key={columnIndex} width={fittedWidth} marginLeft={columnIndex === visibleColumns[0]?.index ? 0 : columnGap}>
                  <Text color={cell?.color ?? COLOR.text} bold={cell?.bold ?? selected}>
                    {fit(cell?.text ?? "", fittedWidth, column.align)}
                  </Text>
                </Box>
              );
            })}
          </Box>
        );
      })}
      {indicatorLines > 0 && win.below > 0 ? <Text color={COLOR.faint}>{fit(`↓ ${win.below} more`, tableWidth)}</Text> : null}
      {rows.length > 0 && rowCapacity === 0 && tableHeight > 1 ? <Text color={COLOR.faint}>{fit("Resize terminal to view rows", tableWidth)}</Text> : null}
    </Box>
  );
}

export function TopBar({ crumbs, right, width }: { readonly crumbs: readonly string[]; readonly right?: string; readonly width?: number }) {
  const { stdout } = useStdout();
  const totalWidth = terminalWidth(width ?? stdout?.columns);
  const contentWidth = Math.max(0, totalWidth - 2);
  const rightWidth = right ? Math.min(cellWidth(right), contentWidth) : 0;
  const leftWidth = Math.max(0, contentWidth - rightWidth - (right ? 1 : 0));
  const leftText = ["❄ boreal", ...crumbs.map((crumb, index) => `${index === 0 ? "  " : "  › "}${crumb}`)].join("");
  const leftFits = cellWidth(leftText) <= leftWidth;
  // Keep the current entity visible when a deep route competes with the
  // refresh indicator. Truncating the left side hides the context the user
  // actually navigated to (especially task titles), so collapse the middle
  // breadcrumb segments first.
  const compactLeftText = crumbs.length > 1
    ? [`❄ boreal`, "  …  › ", crumbs.at(-1)].join("")
    : leftText;

  return (
    <Box backgroundColor={COLOR.barBg} paddingX={1} width={totalWidth}>
      <Box width={leftWidth}>
        {leftFits ? (
          <>
            <Text color={COLOR.accent} bold>
              ❄ boreal
            </Text>
            {crumbs.map((crumb, index) => (
              <Text key={index} color={index === crumbs.length - 1 ? COLOR.text : COLOR.muted}>
                {`${index === 0 ? "  " : "  › "}${crumb}`}
              </Text>
            ))}
          </>
        ) : (
          <Text color={COLOR.text}>{fit(cellWidth(compactLeftText) <= leftWidth ? compactLeftText : leftText, leftWidth)}</Text>
        )}
      </Box>
      {right ? <Text color={COLOR.faint}>{fit(right, rightWidth)}</Text> : null}
    </Box>
  );
}

export interface SectionRailLayout {
  readonly width: number;
  readonly compact: boolean;
}

export function sectionRailLayout(availableWidth: number): SectionRailLayout {
  const width = Math.max(1, Math.floor(availableWidth));
  if (width >= 80) return { width: 16, compact: false };
  if (width >= 56) return { width: 9, compact: true };
  if (width >= 48) return { width: 5, compact: true };
  return { width: 0, compact: true };
}

export function SectionRail({
  sections,
  active,
  width
}: {
  readonly sections: readonly { readonly id: string; readonly label: string; readonly key: string }[];
  readonly active: string;
  /** Total terminal width used to select full, compact, or key-only rail mode. */
  readonly width?: number;
}) {
  const { stdout } = useStdout();
  const layout = sectionRailLayout(width ?? stdout?.columns ?? 100);
  if (layout.width === 0) return <Box />;
  return (
    <Box flexDirection="column" width={layout.width} marginRight={1}>
      {sections.map((section) => {
        const isActive = section.id === active;
        const marker = isActive ? "▍ " : "  ";
        const name = section.label === "Sprint Board" ? "Sprints" : section.label;
        const label = layout.width < 8 ? `${marker}${section.key}` : layout.compact ? `${marker}${section.key} ${name}` : `${marker}${name} ${section.key}`;
        return (
          <Text key={section.id} color={isActive ? COLOR.accent : COLOR.muted} bold={isActive}>
            {fit(label, layout.width)}
          </Text>
        );
      })}
    </Box>
  );
}

export function Pane({ title, tone = COLOR.accent, width, height, children }: { readonly title?: string; readonly tone?: string; readonly width?: number; readonly height?: number; readonly children: ReactNode }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor={tone} paddingX={1} width={width} height={height}>
      {title ? (
        <Text color={tone} bold wrap="truncate">
          {title}
        </Text>
      ) : null}
      {children}
    </Box>
  );
}

export function Field({ label, value, color, width }: { readonly label: string; readonly value: string; readonly color?: string; readonly width?: number }) {
  const valueWidth = width === undefined ? undefined : Math.max(1, Math.floor(width) - 12);
  return (
    <Text wrap="truncate">
      <Text color={COLOR.faint}>{fit(label, 11)} </Text>
      <Text color={color ?? COLOR.text}>{valueWidth === undefined ? value : fit(value, valueWidth)}</Text>
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

export function KeyHints({ hints, width }: { readonly hints: readonly { readonly keys: string; readonly label: string }[]; readonly width?: number }) {
  const { stdout } = useStdout();
  const totalWidth = terminalWidth(width ?? stdout?.columns);
  const contentWidth = Math.max(0, totalWidth - 2);
  const plain = hints.map((hint) => `${hint.keys} ${hint.label}`).join("  ·  ");
  const fits = cellWidth(plain) <= contentWidth;

  return (
    <Box width={totalWidth} paddingX={1}>
      {fits ? (
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
      ) : (
        <Text color={COLOR.muted}>{fit(plain, contentWidth)}</Text>
      )}
    </Box>
  );
}

export function EmptyState({ title, lines, width }: { readonly title: string; readonly lines: readonly string[]; readonly width?: number }) {
  return (
    <Pane title={title} tone={COLOR.warn} width={width}>
      {lines.map((line, index) => (
        <Text key={index} color={index === 0 ? COLOR.text : COLOR.muted} wrap="truncate">
          {line}
        </Text>
      ))}
    </Pane>
  );
}
