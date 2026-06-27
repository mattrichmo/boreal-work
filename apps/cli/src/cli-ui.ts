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
    this.io.output.write(`${title}\n\n${detail}\n\n`);
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
  const lines = [
    `${label}:`,
    ...options.map((option, optionIndex) => {
      const cursor = optionIndex === index ? ">" : " ";
      const marker = multiple ? (selected.has(option.value) ? "[x]" : "[ ]") : selected.has(option.value) ? "(*)" : "( )";
      return `${cursor} ${marker} ${option.label}`;
    }),
    "",
    active ? active.description : "",
    multiple ? "Space toggles. Enter accepts." : "Enter accepts.",
    ""
  ];
  const prefix = previousLineCount > 0 ? `\x1B[${previousLineCount}F\x1B[J` : "";
  output.write(`${prefix}${lines.join("\n")}`);
  return lines.length;
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

function isString(value: string | undefined): value is string {
  return typeof value === "string";
}
