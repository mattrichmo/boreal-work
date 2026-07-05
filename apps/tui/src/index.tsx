import { render } from "ink";
import { createElement } from "react";

import { resolveWorkspaceRoot } from "./load.js";
import { RouteApp } from "./shell.js";

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
      "Usage: bwrk-tui [--global] [--workspace <dir>]",
      "",
      "One process, two surfaces: `--global` opens the cross-repo Overview /",
      "Projects / Queues surface; without it, opens the repo Roll-Up / Sprint",
      "Board / Task Detail surface for the current workspace.",
      "",
      "Keys: 1-9 sections · ↑↓/jk move · ⏎ open · esc back · r refresh · q quit",
      ""
    ].join("\n")
  );
  process.exit(0);
}

const workspaceRoot = resolveWorkspaceRoot(flagValue(argv, "--workspace"));
const global = argv.includes("--global");

// Alternate-screen enter/exit + SGR mouse + signal-safe restore live in
// useAltScreen() (apps/tui/src/runtime.ts), so a signalled exit can't leave
// the terminal stuck in the alt buffer. In --global mode the workspace root
// is already the global store (the CLI passes it); RouteApp starts on the
// Overview route and drills into a repo session with an explicit
// workspaceRoot when a project row is opened (see route-nav.ts#openRepo).
const element = createElement(RouteApp, { workspaceRoot, global });
const instance = render(element, { exitOnCtrlC: false });

instance.waitUntilExit().catch(() => undefined);
