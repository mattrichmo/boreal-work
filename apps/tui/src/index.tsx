import { render } from "ink";
import { createElement } from "react";
import { fileURLToPath } from "node:url";
import { basename, resolve } from "node:path";

import { resolveWorkspaceRoot } from "./load.js";
import { DEFAULT_TUI_REFRESH_MS, normalizeRefreshInterval } from "./head-poll.js";
import { RouteApp } from "./shell.js";

export interface TuiLaunchOptions {
  readonly workspace?: string;
  readonly global: boolean;
  readonly mouse: boolean;
  readonly refreshMs: number;
  readonly registryRoot?: string;
}

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  const value = index >= 0 ? argv[index + 1] : undefined;
  return value && !value.startsWith("--") ? value : undefined;
}

export function parseTuiArgs(argv: readonly string[]): TuiLaunchOptions {
  const refreshValue = flagValue(argv, "--refresh-ms");
  if (argv.includes("--refresh-ms") && refreshValue === undefined) {
    throw new Error("--refresh-ms requires a value");
  }
  if (argv.includes("--workspace") && flagValue(argv, "--workspace") === undefined) {
    throw new Error("--workspace requires a value");
  }
  if (argv.includes("--registry-root") && flagValue(argv, "--registry-root") === undefined) {
    throw new Error("--registry-root requires a value");
  }
  let refreshMs = DEFAULT_TUI_REFRESH_MS;
  if (refreshValue !== undefined) {
    const parsed = Number(refreshValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`--refresh-ms must be a non-negative integer; received ${refreshValue}`);
    }
    refreshMs = normalizeRefreshInterval(parsed);
  }
  return {
    workspace: flagValue(argv, "--workspace"),
    global: argv.includes("--global"),
    mouse: argv.includes("--mouse"),
    refreshMs,
    registryRoot: flagValue(argv, "--registry-root")
  };
}

export function isInteractiveTerminal(
  input: Pick<NodeJS.ReadStream, "isTTY"> = process.stdin,
  output: Pick<NodeJS.WriteStream, "isTTY"> = process.stdout
): boolean {
  return input.isTTY === true && output.isTTY === true;
}

function formatProcessFailure(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = error as Error & {
    readonly code?: string | number;
    readonly signal?: string;
    readonly stderr?: string | Buffer;
    readonly stdout?: string | Buffer;
  };
  const lines = [details.message];
  if (details.code !== undefined) lines.push(`exit: ${String(details.code)}`);
  if (details.signal) lines.push(`signal: ${details.signal}`);
  if (details.stderr) lines.push(`stderr:\n${String(details.stderr).trimEnd()}`);
  if (details.stdout) lines.push(`stdout:\n${String(details.stdout).trimEnd()}`);
  return lines.filter((line) => line.length > 0).join("\n");
}

function printHelp(): void {
  process.stdout.write(
    [
      "bwrk-tui - Boreal terminal dashboard",
      "",
      "Usage: bwrk-tui [--global] [--workspace <dir>] [--registry-root <dir>] [--mouse] [--refresh-ms <ms>]",
      "",
      "One process, two surfaces: `--global` opens the cross-repo Overview /",
      "Projects / Queues surface; without it, opens the repo Roll-Up / Sprint",
      "Board / Task Detail surface for the current workspace.",
      "",
      "Keys: 1-3 sections · ↑↓/jk move · ⏎ open/run · esc back · r refresh · q quit",
      ""
    ].join("\n")
  );
}

export function isMainModule(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) return false;
  const modulePath = resolve(fileURLToPath(import.meta.url));
  const entryPath = resolve(entry);
  // Bundlers can preserve the source module URL while executing the emitted
  // sibling entry. Keep the exact check first, then recognize only the two
  // supported TUI artifact layouts; this remains false for test runners and
  // ordinary imports.
  return modulePath === entryPath
    || (basename(entryPath) === "index.js" && (entryPath.endsWith("/dist/index.js") || entryPath.endsWith("/dist/tui/index.js")));
}

export function main(argv: readonly string[] = process.argv.slice(2)): void {
  if (argv.includes("--help") || argv.includes("-h")) {
    printHelp();
    return;
  }

  let options: TuiLaunchOptions;
  try {
    options = parseTuiArgs(argv);
  } catch (error) {
    process.stderr.write(`bwrk-tui: ${formatProcessFailure(error)}\n`);
    process.exitCode = 2;
    return;
  }

  if (!isInteractiveTerminal()) {
    process.stderr.write(
      "bwrk-tui requires an interactive terminal; use a TTY or run `bwrk dashboard --json` for non-interactive output.\n"
    );
    process.exitCode = 2;
    return;
  }

  const workspaceRoot = resolveWorkspaceRoot(options.workspace);
  // The existing global loader invokes the CLI without a registry-root
  // argument. Export the explicit override for that child process instead of
  // changing the loader API; the CLI resolves this documented environment
  // variable when it builds the global dashboard payload.
  if (options.global && options.registryRoot) {
    const registryRoot = resolve(options.registryRoot);
    process.env.BOREAL_PROJECT_REGISTRY_ROOT = registryRoot;
  }

  const element = createElement(RouteApp, {
    workspaceRoot,
    global: options.global,
    mouse: options.mouse,
    refreshMs: options.refreshMs,
    registryRoot: options.registryRoot ? resolve(options.registryRoot) : undefined
  });
  try {
    const instance = render(element, { exitOnCtrlC: false });
    instance.waitUntilExit().catch((error: unknown) => {
      process.stderr.write(`bwrk-tui failed: ${formatProcessFailure(error)}\n`);
      process.exitCode = 1;
    });
  } catch (error) {
    process.stderr.write(`bwrk-tui failed: ${formatProcessFailure(error)}\n`);
    process.exitCode = 1;
  }
}

if (isMainModule()) {
  main();
}
