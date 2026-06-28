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
      "Usage: bwrk-tui [--global] [--view overview|sprint|work|activity] [--search <q>] [--mouse] [--workspace <dir>] [--refresh-ms <n>]",
      "",
      "Keys: o/s/w/a sections · ↑↓/jk move · ⏎ open · ⌫/esc back · / search · r refresh · q quit",
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
const mouse = argv.includes("--mouse");

// Alternate-screen enter/exit + SGR mouse + signal-safe restore live in
// useAltScreen() (apps/tui/src/runtime.ts), so a signalled exit can't leave
// the terminal stuck in the alt buffer. In --global mode the workspace root is
// already the global store (the CLI passes it), so App runs against it and adds
// the linked-projects monitor.
const element = createElement(App, { workspaceRoot, refreshMs, initialView, initialQuery, mouse, global });
const instance = render(element, { exitOnCtrlC: false });

instance.waitUntilExit().catch(() => undefined);
