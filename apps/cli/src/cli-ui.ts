import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

import { BorealError } from "@boreal/core";

export interface CliSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
}

export type CliStatus = "success" | "error" | "warning" | "info" | "pending" | "loading";

export interface CliUiRenderOptions {
  readonly unicode?: boolean;
}

export interface KeyValueRow {
  readonly key: string;
  readonly value: string | number | boolean;
}

export interface ResultSummaryInput {
  readonly status: CliStatus;
  readonly title: string;
  readonly detail?: string;
  readonly action?: string;
}

export interface StepperStep {
  readonly label: string;
  readonly status: "complete" | "current" | "pending" | "error";
}

export interface ChoiceListRenderInput<T extends string> {
  readonly label: string;
  readonly options: readonly CliSelectOption<T>[];
  readonly activeIndex: number;
  readonly selectedValues?: readonly T[];
  readonly multiple?: boolean;
  readonly windowSize?: number;
}

export interface CliPromptIO {
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
}

export function statusIcon(status: CliStatus, options: CliUiRenderOptions = {}): string {
  if (options.unicode === true) {
    switch (status) {
      case "success":
        return "✓";
      case "error":
        return "✕";
      case "warning":
        return "!";
      case "info":
        return "i";
      case "pending":
        return "…";
      case "loading":
        return "•";
    }
  }

  switch (status) {
    case "success":
      return "OK";
    case "error":
      return "ERR";
    case "warning":
      return "WARN";
    case "info":
      return "INFO";
    case "pending":
      return "PEND";
    case "loading":
      return "LOAD";
  }
}

export function shortcutHint(shortcut: string, action: string): string {
  return `[${shortcut}] ${action}`;
}

export function section(title: string, rows: readonly string[]): string {
  return [title, ...rows.map((row) => `  ${row}`)].join("\n");
}

export function keyValueRows(rows: readonly KeyValueRow[]): string {
  const width = rows.reduce((max, row) => Math.max(max, row.key.length), 0);
  return rows.map((row) => `${row.key.padEnd(width)}  ${String(row.value)}`).join("\n");
}

export function resultSummary(input: ResultSummaryInput, options: CliUiRenderOptions = {}): string {
  return [
    `${statusIcon(input.status, options)} ${input.title}`,
    input.detail ? `  ${input.detail}` : undefined,
    input.action ? `  next: ${input.action}` : undefined
  ]
    .filter(isString)
    .join("\n");
}

export function stepper(steps: readonly StepperStep[], options: CliUiRenderOptions = {}): string {
  return steps
    .map((step, index) => {
      const marker = step.status === "complete" ? statusIcon("success", options) : step.status === "error" ? statusIcon("error", options) : step.status === "current" ? ">" : " ";
      return `${String(index + 1).padStart(2, " ")} ${marker} ${step.label}`;
    })
    .join("\n");
}

export function choiceList<T extends string>(input: ChoiceListRenderInput<T>): string {
  const selected = new Set(input.selectedValues ?? []);
  const activeIndex = clamp(input.activeIndex, 0, Math.max(0, input.options.length - 1));
  const windowSize = Math.max(1, input.windowSize ?? input.options.length);
  const windowStart = clamp(activeIndex - Math.floor(windowSize / 2), 0, Math.max(0, input.options.length - windowSize));
  const windowedOptions = input.options.slice(windowStart, windowStart + windowSize);
  const active = input.options[activeIndex];
  return [
    `${input.label}:`,
    ...windowedOptions.map((option, offset) => {
      const optionIndex = windowStart + offset;
      const cursor = optionIndex === activeIndex ? ">" : " ";
      const marker =
        input.multiple === true ? (selected.has(option.value) ? "[x]" : "[ ]") : selected.has(option.value) ? "(*)" : "( )";
      return `${cursor} ${marker} ${option.label}`;
    }),
    "",
    active?.description ?? "",
    input.multiple === true
      ? `${shortcutHint("Space", "toggle")}  ${shortcutHint("Enter", "accept")}`
      : shortcutHint("Enter", "accept")
  ].join("\n");
}

export async function withPromptSession<T>(
  io: CliPromptIO,
  run: (session: CliPromptSession) => Promise<T>
): Promise<T> {
  const rl = createInterface({ input: io.input, output: io.output });
  const session = new CliPromptSession(io, rl);
  try {
    return await run(session);
  } finally {
    rl.close();
  }
}

export class CliPromptSession {
  constructor(
    private readonly io: CliPromptIO,
    private readonly rl: ReturnType<typeof createInterface>
  ) {}

  writeIntro(title: string, detail: string): void {
    this.io.output.write(`${promptBox([title, "", ...detail.split("\n")])}\n\n`);
  }

  async text(label: string, defaultValue: string): Promise<string> {
    const answer = await this.rl.question(`${label} [${defaultValue}]: `);
    return answer.trim() || defaultValue;
  }

  async select<T extends string>(
    label: string,
    options: readonly CliSelectOption<T>[],
    defaultValue: T
  ): Promise<T> {
    const selected = await this.selectValues(label, options, [defaultValue], { multiple: false });
    return selected[0] ?? defaultValue;
  }

  async multiselect<T extends string>(
    label: string,
    options: readonly CliSelectOption<T>[],
    defaultValues: readonly T[]
  ): Promise<readonly T[]> {
    return this.selectValues(label, options, defaultValues, { multiple: true });
  }

  private async selectValues<T extends string>(
    label: string,
    options: readonly CliSelectOption<T>[],
    defaultValues: readonly T[],
    input: { readonly multiple: boolean }
  ): Promise<readonly T[]> {
    if (options.length === 0) {
      return [];
    }

    const { input: stdin, output: stdout } = this.io;
    const defaultSet = new Set(defaultValues);
    const selected = new Set(options.filter((option) => defaultSet.has(option.value)).map((option) => option.value));
    if (selected.size === 0) {
      selected.add(options[0]?.value as T);
    }
    let index = Math.max(0, options.findIndex((option) => selected.has(option.value)));
    let renderedLines = 0;
    let cursorHidden = false;
    let terminalRestored = false;
    const restoreTerminal = () => {
      if (terminalRestored) {
        return;
      }
      stdin.setRawMode(false);
      if (cursorHidden) {
        stdout.write("\x1B[?25h\n");
        cursorHidden = false;
      }
      terminalRestored = true;
    };

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write("\x1B[?25l");
    cursorHidden = true;
    renderedLines = renderSelect(stdout, label, options, index, selected, input.multiple, renderedLines);

    try {
      return await new Promise<readonly T[]>((resolveSelection, rejectSelection) => {
        const onKeypress = (_text: string, key: { readonly name?: string; readonly ctrl?: boolean }) => {
          if (key.ctrl && key.name === "c") {
            stdin.off("keypress", onKeypress);
            restoreTerminal();
            rejectSelection(new BorealError("BOREAL_INVALID_INPUT", "Interactive prompt cancelled", { reason: "cancelled" }));
            return;
          }
          if (key.name === "up" || key.name === "k") {
            index = (index - 1 + options.length) % options.length;
            selectActiveOption(options, index, selected, input.multiple);
            renderedLines = renderSelect(stdout, label, options, index, selected, input.multiple, renderedLines);
            return;
          }
          if (key.name === "down" || key.name === "j") {
            index = (index + 1) % options.length;
            selectActiveOption(options, index, selected, input.multiple);
            renderedLines = renderSelect(stdout, label, options, index, selected, input.multiple, renderedLines);
            return;
          }
          if (input.multiple && key.name === "space") {
            const current = options[index];
            if (current) {
              if (selected.has(current.value) && selected.size > 1) {
                selected.delete(current.value);
              } else {
                selected.add(current.value);
              }
            }
            renderedLines = renderSelect(stdout, label, options, index, selected, input.multiple, renderedLines);
            return;
          }
          if (key.name === "return" || key.name === "enter") {
            stdin.off("keypress", onKeypress);
            restoreTerminal();
            resolveSelection(options.filter((option) => selected.has(option.value)).map((option) => option.value));
          }
        };
        stdin.on("keypress", onKeypress);
      });
    } finally {
      restoreTerminal();
    }
  }
}

function renderSelect<T extends string>(
  output: NodeJS.WriteStream,
  label: string,
  options: readonly CliSelectOption<T>[],
  index: number,
  selected: ReadonlySet<T>,
  multiple: boolean,
  previousLineCount: number
): number {
  const active = options[index];
  const columns = typeof output.columns === "number" ? output.columns : 92;
  const cardWidth = clamp(columns - 4, 44, 88);
  const hint = multiple ? "Space toggle   Enter accept   Up/Down move" : "Enter accept   Up/Down move";
  const lines = [
    label,
    "",
    ...options.map((option, optionIndex) => {
      const cursor = optionIndex === index ? "›" : " ";
      const marker = multiple ? (selected.has(option.value) ? "■" : "□") : selected.has(option.value) ? "●" : "○";
      return truncateLine(`${cursor} ${marker} ${option.label}`, cardWidth);
    }),
    "",
    ...wrapText(active ? active.description : "", cardWidth),
    "",
    hint
  ];
  const prefix = previousLineCount > 0 ? `\x1B[${previousLineCount}F\x1B[J` : "";
  const rendered = promptBox(lines, cardWidth);
  output.write(`${prefix}${rendered}\n`);
  return rendered.split("\n").length;
}

function selectActiveOption<T extends string>(
  options: readonly CliSelectOption<T>[],
  index: number,
  selected: Set<T>,
  multiple: boolean
): void {
  if (multiple) {
    return;
  }
  const active = options[index];
  if (active) {
    selected.clear();
    selected.add(active.value);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function promptBox(lines: readonly string[], width?: number): string {
  const contentWidth = width ?? lines.reduce((max, line) => Math.max(max, line.length), 0);
  const top = `╭${"─".repeat(contentWidth + 2)}╮`;
  const bottom = `╰${"─".repeat(contentWidth + 2)}╯`;
  const body = lines.map((line) => `│ ${truncateLine(line, contentWidth).padEnd(contentWidth)} │`);
  return [top, ...body, bottom].join("\n");
}

function truncateLine(line: string, width: number): string {
  if (line.length <= width) {
    return line;
  }
  if (width <= 1) {
    return line.slice(0, width);
  }
  return `${line.slice(0, width - 1)}…`;
}

function wrapText(text: string, width: number): readonly string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [""];
  }
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (word.length > width) {
      if (current) {
        lines.push(current);
        current = "";
      }
      lines.push(truncateLine(word, width));
      continue;
    }
    const next = current ? `${current} ${word}` : word;
    if (next.length > width) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}

// ---------------------------------------------------------------------------
// Bounded table renderer
//
// Human-facing tables (work list, sprint board, sprint show, dep tree, work
// rollup) should clamp to the terminal width instead of printing rows that
// wrap or truncate unpredictably. `boundedTable` truncates `flex` columns
// (titles, container names) with a trailing "…" while keeping `protected`
// columns (ids, statuses) at their natural width. Pass `--wide` through as
// `options.wide` to disable clamping entirely.
// ---------------------------------------------------------------------------

const TABLE_COLUMN_SEPARATOR = "  ";
const DEFAULT_MIN_FLEX_COLUMN_WIDTH = 8;
export const DEFAULT_TABLE_FALLBACK_WIDTH = 120;

export interface BoundedTableColumn {
  readonly key: string;
  readonly header: string;
  /** Truncatable column (e.g. title). Columns without this flag are never shrunk. */
  readonly flex?: boolean;
  readonly minWidth?: number;
}

export interface BoundedTableOptions {
  /** Explicit width, mainly for tests. Defaults to `process.stdout.columns` or 120. */
  readonly width?: number;
  /** Disable clamping entirely (the `--wide` escape hatch). */
  readonly wide?: boolean;
}

export function boundedTable(
  rows: readonly Record<string, string>[],
  columns: readonly BoundedTableColumn[],
  options: BoundedTableOptions = {}
): string {
  if (rows.length === 0 || columns.length === 0) {
    return "";
  }

  const natural = new Map<string, number>(
    columns.map((column) => [
      column.key,
      Math.max(column.header.length, ...rows.map((row) => String(row[column.key] ?? "").length))
    ])
  );

  const separatorWidth = TABLE_COLUMN_SEPARATOR.length * Math.max(0, columns.length - 1);
  const naturalTotalWidth = sumValues(natural) + separatorWidth;
  const totalWidth = resolveTableWidth(options);

  const widths =
    options.wide === true || naturalTotalWidth <= totalWidth
      ? natural
      : shrinkFlexColumns(columns, natural, Math.max(0, totalWidth - separatorWidth));

  const header = columns.map((column) => padCell(column.header, widths.get(column.key) ?? 0)).join(TABLE_COLUMN_SEPARATOR);
  const divider = columns.map((column) => "-".repeat(widths.get(column.key) ?? 0)).join(TABLE_COLUMN_SEPARATOR);
  const body = rows
    .map((row) =>
      columns
        .map((column) => {
          const width = widths.get(column.key) ?? 0;
          return padCell(truncateLine(String(row[column.key] ?? ""), width), width);
        })
        .join(TABLE_COLUMN_SEPARATOR)
    )
    .join("\n");

  return `${header}\n${divider}\n${body}\n`;
}

function resolveTableWidth(options: BoundedTableOptions): number {
  if (options.wide === true) {
    return Number.POSITIVE_INFINITY;
  }
  if (typeof options.width === "number") {
    return options.width;
  }
  return typeof process.stdout.columns === "number" && process.stdout.columns > 0
    ? process.stdout.columns
    : DEFAULT_TABLE_FALLBACK_WIDTH;
}

function shrinkFlexColumns(
  columns: readonly BoundedTableColumn[],
  natural: ReadonlyMap<string, number>,
  availableWidth: number
): Map<string, number> {
  const widths = new Map(natural);
  const flexColumns = columns.filter((column) => column.flex === true);
  if (flexColumns.length === 0) {
    return widths;
  }

  const protectedTotal = columns
    .filter((column) => column.flex !== true)
    .reduce((sum, column) => sum + (natural.get(column.key) ?? 0), 0);
  const flexNaturalTotal = flexColumns.reduce((sum, column) => sum + (natural.get(column.key) ?? 0), 0);
  const minFlexTotal = flexColumns.reduce((sum, column) => sum + (column.minWidth ?? DEFAULT_MIN_FLEX_COLUMN_WIDTH), 0);
  const availableForFlex = Math.max(availableWidth - protectedTotal, minFlexTotal);

  let remaining = availableForFlex;
  flexColumns.forEach((column, index) => {
    const minWidth = column.minWidth ?? DEFAULT_MIN_FLEX_COLUMN_WIDTH;
    const naturalWidth = natural.get(column.key) ?? minWidth;
    const isLast = index === flexColumns.length - 1;
    let width: number;
    if (isLast) {
      width = Math.max(minWidth, remaining);
    } else {
      const proportional = Math.round((availableForFlex * naturalWidth) / Math.max(flexNaturalTotal, 1));
      width = Math.max(minWidth, Math.min(proportional, naturalWidth));
    }
    widths.set(column.key, width);
    remaining -= width;
  });

  return widths;
}

function padCell(value: string, width: number): string {
  return value.length >= width ? value : value.padEnd(width);
}

function sumValues(values: ReadonlyMap<string, number>): number {
  let total = 0;
  for (const value of values.values()) {
    total += value;
  }
  return total;
}
