#!/usr/bin/env node
import {
  inspectDaemonStatus,
  runDaemonWatchOnce,
  type DaemonStatusResult,
  type DaemonWatchResult
} from "./runtime.js";

export * from "./runtime.js";

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const command = argv[0] && !argv[0].startsWith("-") ? argv[0] : "status";
  const workspaceRoot = flagValue(argv, "workspace") ?? flagValue(argv, "project-root") ?? process.cwd();
  const result = command === "watch"
    ? await runDaemonWatchOnce({ workspaceRoot })
    : await inspectDaemonStatus({ workspaceRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function flagValue(argv: readonly string[], name: string): string | undefined {
  const index = argv.findIndex((arg) => arg === `--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export type { DaemonStatusResult, DaemonWatchResult };
