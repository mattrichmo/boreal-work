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
  mode: options.mode,
  liveCacheTtlMs: options.liveCacheTtlMs
});

try {
  const results: ConsoleSmokeRouteResult[] = [];
  for (const viewport of consoleSmokeViewports) {
    for (const route of consoleSmokeRoutes) {
      const startedAt = Date.now();
      const response = await fetchWithTimeout(`${running.url}${route}`, {
        headers: { "x-boreal-smoke-viewport": `${viewport.name}:${viewport.width}x${viewport.height}` }
      }, options.routeTimeoutMs);
      const html = await response.text();
      const durationMs = Date.now() - startedAt;
      results.push({
        ...validateConsoleSmokeHtml({
        routePath: route,
        viewport,
        status: response.status,
        html
        }),
        durationMs
      });
    }
  }
  const state = await fetchWithTimeout(`${running.url}/api/state`, {}, options.routeTimeoutMs);
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
  readonly routeTimeoutMs: number;
  readonly liveCacheTtlMs: number;
} {
  const out = valueAfter(argv, "--out");
  return {
    workspaceRoot: resolve(valueAfter(argv, "--workspace") ?? "../.."),
    mode: valueAfter(argv, "--mode") === "live" ? "live" : "fixture",
    outFile: out ? resolve(out) : undefined,
    routeTimeoutMs: positiveIntegerFlag(argv, "--route-timeout-ms", 15_000),
    liveCacheTtlMs: positiveIntegerFlag(argv, "--live-cache-ttl-ms", 10_000)
  };
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function positiveIntegerFlag(argv: readonly string[], flag: string, fallback: number): number {
  const value = valueAfter(argv, flag);
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} must be a positive integer`);
  }
  return parsed;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`Console smoke request timed out after ${timeoutMs}ms: ${url}`)), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
