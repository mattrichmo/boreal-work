#!/usr/bin/env node
import {
  daemonErrorPayload,
  inspectDaemonStatus,
  runDaemonWatchOnce,
  type DaemonStatusResult,
  type DaemonWatchResult
} from "./runtime.js";

export * from "./runtime.js";
export * from "./global-rollup-cache.js";

declare const BOREAL_BUNDLED_CLI: boolean | undefined;

const runningInsideBundledCli = typeof BOREAL_BUNDLED_CLI === "boolean" && BOREAL_BUNDLED_CLI;

if (!runningInsideBundledCli && import.meta.url === `file://${process.argv[1]}`) {
  process.exitCode = await runDaemonCli();
}

export interface DaemonCliOutput {
  write(text: string): void;
  error(text: string): void;
}

export async function runDaemonCli(
  argv = process.argv.slice(2),
  output: DaemonCliOutput = processOutput()
): Promise<number> {
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "status";
  const workspaceRoot = flagValue(argv, "workspace") ?? flagValue(argv, "project-root") ?? process.cwd();
  try {
    const result = command === "watch"
      ? await runDaemonWatchOnce({ workspaceRoot })
      : await inspectDaemonStatus({ workspaceRoot });
    output.write(`${JSON.stringify(result, null, 2)}\n`);
    return daemonResultExitCode(result);
  } catch (error) {
    output.error(`${JSON.stringify(daemonErrorPayload(error), null, 2)}\n`);
    return 1;
  }
}

function daemonResultExitCode(result: DaemonStatusResult | DaemonWatchResult): number {
  if ("action" in result) {
    return result.reason === "project_boundary_unhealthy" ? 1 : 0;
  }
  return result.state === "missing" || result.state === "drift" || result.state === "stale" ? 1 : 0;
}

function processOutput(): DaemonCliOutput {
  return {
    write(text) {
      process.stdout.write(text);
    },
    error(text) {
      process.stderr.write(text);
    }
  };
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.findIndex((arg) => arg === `--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export type { DaemonStatusResult, DaemonWatchResult };
