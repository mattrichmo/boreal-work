import { render } from "ink";
import { createElement } from "react";

import { App, GlobalApp } from "./app.js";
import { resolveWorkspaceRoot } from "./load.js";

function flagValue(argv: readonly string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

const argv = process.argv.slice(2);
if (argv.includes("--help") || argv.includes("-h")) {
  process.stdout.write(
    [
      "bwrk-tui - Boreal terminal dashboard",
      "",
      "Usage: bwrk-tui [--global] [--view overview|sprint|work] [--workspace <dir>] [--refresh-ms <n>]",
      "",
      "Repo keys:   o overview  s sprint  w work  j/k move  r refresh  q quit",
      "Global (--global): all registered projects  j/k move  r refresh  q quit",
      ""
    ].join("\n")
  );
  process.exit(0);
}

const workspaceRoot = resolveWorkspaceRoot(flagValue(argv, "--workspace"));
const refreshMs = Math.max(1000, Number(flagValue(argv, "--refresh-ms") ?? "5000") || 5000);
const global = argv.includes("--global");
const initialView = flagValue(argv, "--view");
const initialQuery = argv.includes("--search") ? flagValue(argv, "--search") ?? "" : undefined;

const enterAltScreen = "[?1049h";
const leaveAltScreen = "[?1049l";
process.stdout.write(enterAltScreen);

const element = global
  ? createElement(GlobalApp, { workspaceRoot, refreshMs })
  : createElement(App, { workspaceRoot, refreshMs, initialView, initialQuery });
const instance = render(element, { exitOnCtrlC: false });

instance
  .waitUntilExit()
  .catch(() => undefined)
  .finally(() => {
    process.stdout.write(leaveAltScreen);
  });
