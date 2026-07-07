import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { createFixtureConsoleData } from "./app/fixtures.js";
import { loadLiveConsoleData } from "./app/live-data.js";
import { renderConsoleHtml } from "./app/render.js";
import type { ConsoleDataMode, ConsoleScope } from "./app/types.js";

interface RenderFileOptions {
  readonly workspaceRoot: string;
  readonly route: string;
  readonly outFile: string;
  readonly mode: ConsoleDataMode;
  readonly scope: ConsoleScope;
}

const options = parseArgs(process.argv.slice(2));
const data = options.mode === "live"
  ? await loadLiveConsoleData({ workspaceRoot: options.workspaceRoot, scope: options.scope })
  : createFixtureConsoleData({ workspaceRoot: options.workspaceRoot, scope: options.scope });
const html = renderConsoleHtml({ route: options.route, data });
await mkdir(dirname(options.outFile), { recursive: true });
await writeFile(options.outFile, html, "utf8");
process.stdout.write(`${JSON.stringify({ ok: true, outFile: options.outFile, route: options.route, mode: options.mode }, null, 2)}\n`);

function parseArgs(argv: readonly string[]): RenderFileOptions {
  const workspaceRoot = resolve(valueAfter(argv, "--workspace") ?? "../..");
  return {
    workspaceRoot,
    route: valueAfter(argv, "--route") ?? "/",
    outFile: resolve(workspaceRoot, valueAfter(argv, "--out") ?? ".boreal/results/console.html"),
    mode: valueAfter(argv, "--mode") === "fixture" ? "fixture" : "live",
    scope: valueAfter(argv, "--scope") === "global" ? "global" : "repo"
  };
}

function valueAfter(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}
