import { render } from "ink";
import { createElement } from "react";

import { App } from "./app.js";
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
      "Usage: bwrk-tui [--workspace <dir>] [--refresh-ms <n>]",
      "",
      "Keys: g global  s sprint  w work  j/k move  r refresh  q quit",
      ""
    ].join("\n")
  );
  process.exit(0);
}

const workspaceRoot = resolveWorkspaceRoot(flagValue(argv, "--workspace"));
const refreshMs = Math.max(1000, Number(flagValue(argv, "--refresh-ms") ?? "5000") || 5000);

const enterAltScreen = "[?1049h";
const leaveAltScreen = "[?1049l";
process.stdout.write(enterAltScreen);

const instance = render(createElement(App, { workspaceRoot, refreshMs }), { exitOnCtrlC: false });

instance
  .waitUntilExit()
  .catch(() => undefined)
  .finally(() => {
    process.stdout.write(leaveAltScreen);
  });
