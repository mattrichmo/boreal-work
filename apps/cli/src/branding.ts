import { getVersionInfo } from "./version.js";

export const BOREAL_WORK_BANNER = `██████   ██████  ██████  ███████  █████  ██          ██     ██  ██████  ██████  ██   ██
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██     ██ ██    ██ ██   ██ ██  ██
██████  ██    ██ ██████  █████   ███████ ██          ██  █  ██ ██    ██ ██████  █████
██   ██ ██    ██ ██   ██ ██      ██   ██ ██          ██ ███ ██ ██    ██ ██   ██ ██  ██
██████   ██████  ██   ██ ███████ ██   ██ ███████      ███ ███   ██████  ██   ██ ██   ██`;

export const TAGLINE = "Local-first work tracking, memory, and agent coordination.";
export const AUTHOR = "Matt Richmond";
export const HOMEPAGE = "https://boreal.work";

/** Draw a rounded box around the given lines, padded to a common width. */
export function box(lines: readonly string[], indent = ""): string {
  const width = lines.reduce((max, line) => Math.max(max, line.length), 0);
  const top = `${indent}╭${"─".repeat(width + 2)}╮`;
  const bottom = `${indent}╰${"─".repeat(width + 2)}╯`;
  const body = lines.map((line) => `${indent}│ ${line.padEnd(width)} │`);
  return [top, ...body, bottom].join("\n");
}

export function aboutText(): string {
  const { version } = getVersionInfo();
  return [
    "",
    BOREAL_WORK_BANNER,
    "",
    `  Boreal Work  ·  v${version}`,
    "",
    "  A local-first source of truth for work, knowledge, and agents.",
    "  Track tasks, plans, sprints, decisions, and memory in your repo,",
    "  and roll every project up into one global workspace.",
    "",
    "  Built for humans and AI agents to share one state: offline, in",
    "  git, with no server required.",
    "",
    `  Created by ${AUTHOR}`,
    `  ${HOMEPAGE}`,
    ""
  ].join("\n");
}
