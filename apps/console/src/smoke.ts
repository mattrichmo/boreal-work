import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { listenConsole } from "./server.js";
import {
  consoleSmokeRoutes,
  consoleSmokeViewports,
  validateConsoleSmokeHtml,
  type ConsoleSmokeRouteResult
} from "./app/smoke-checks.js";
import type { ConsoleDataMode } from "./app/types.js";

const options = parseArgs(process.argv.slice(2));
const running = await listenConsole({
  workspaceRoot: options.workspaceRoot,
  host: "127.0.0.1",
  port: 0,
  mode: options.mode
});

try {
  const results: ConsoleSmokeRouteResult[] = [];
  for (const viewport of consoleSmokeViewports) {
    for (const route of consoleSmokeRoutes) {
      const response = await fetch(`${running.url}${route}`, {
        headers: { "x-boreal-smoke-viewport": `${viewport.name}:${viewport.width}x${viewport.height}` }
      });
      const html = await response.text();
      results.push(validateConsoleSmokeHtml({
        routePath: route,
        viewport,
        status: response.status,
        html
      }));
    }
  }
  const state = await fetch(`${running.url}/api/state`);
  if (!state.ok) {
    throw new Error("Console state endpoint failed smoke check");
  }
  const statePayload: unknown = await state.json();
  const workspaceState = isRecord(statePayload) && isRecord(statePayload.workspace) ? statePayload.workspace : {};
  const workspaceWarnings = Array.isArray(workspaceState.warnings) ? workspaceState.warnings : [];
  const output = {
    ok: true,
    url: running.url,
    mode: options.mode,
    viewports: consoleSmokeViewports,
    routes: results,
    state: {
      status: state.status,
      mode: typeof workspaceState.mode === "string" ? workspaceState.mode : undefined,
      warningCount: workspaceWarnings.length
    }
  };
  if (options.outFile) {
    await mkdir(dirname(options.outFile), { recursive: true });
    await writeFile(options.outFile, `${JSON.stringify(output, null, 2)}\n`);
  }
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
} finally {
  await running.close();
}

function parseArgs(argv: readonly string[]): {
  readonly workspaceRoot: string;
  readonly mode: ConsoleDataMode;
  readonly outFile?: string;
} {
  const out = valueAfter(argv, "--out");
  return {
    workspaceRoot: resolve(valueAfter(argv, "--workspace") ?? "../.."),
    mode: valueAfter(argv, "--mode") === "live" ? "live" : "fixture",
    outFile: out ? resolve(out) : undefined
  };
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
