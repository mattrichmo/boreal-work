import { emitKeypressEvents } from "node:readline";
import { createInterface } from "node:readline/promises";

export interface CliSelectOption<T extends string> {
  readonly value: T;
  readonly label: string;
  readonly description: string;
}

export interface CliPromptIO {
  readonly input: NodeJS.ReadStream;
  readonly output: NodeJS.WriteStream;
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
    const wasRaw = stdin.isRaw;
    let renderedLines = 0;

    emitKeypressEvents(stdin);
    stdin.setRawMode(true);
    stdin.resume();
    stdout.write("\x1B[?25l");
    renderedLines = renderSelect(stdout, label, options, index, selected, input.multiple, renderedLines);

    try {
      return await new Promise<readonly T[]>((resolveSelection) => {
        const onKeypress = (_text: string, key: { readonly name?: string; readonly ctrl?: boolean }) => {
          if (key.ctrl && key.name === "c") {
            stdin.off("keypress", onKeypress);
            stdout.write("\x1B[?25h\n");
            process.exit(130);
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
            stdout.write("\x1B[?25h\n");
            resolveSelection(options.filter((option) => selected.has(option.value)).map((option) => option.value));
          }
        };
        stdin.on("keypress", onKeypress);
      });
    } finally {
      stdin.setRawMode(wasRaw);
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
