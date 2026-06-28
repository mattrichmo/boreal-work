import type { Key } from "ink";

import type { TuiScreen, TuiSection } from "./nav.js";

export type ActionId =
  | "move"
  | "drill"
  | "back"
  | "search"
  | "refresh"
  | "filter"
  | "quit"
  | `section:${TuiSection}`;

export interface BindingSpec {
  /** Logical key token resolved by matchToken. */
  readonly token: string;
  readonly action: ActionId;
  /** Present when this binding should appear in the footer hint row. */
  readonly hint?: { readonly keys: string; readonly label: string };
}

// One matcher for both the footer hints and the dispatcher, so they can't drift.
export function matchToken(token: string, input: string, key: Key): boolean {
  switch (token) {
    case "move":
      return Boolean(key.upArrow || key.downArrow) || input === "j" || input === "k";
    case "drill":
      return Boolean(key.return || key.rightArrow) || input === "l";
    case "back":
      return Boolean(key.escape || key.backspace || key.delete || key.leftArrow) || input === "h";
    default:
      return input === token;
  }
}

const SEARCH: BindingSpec = { token: "/", action: "search", hint: { keys: "/", label: "search" } };
const REFRESH: BindingSpec = { token: "r", action: "refresh", hint: { keys: "r", label: "refresh" } };
const QUIT: BindingSpec = { token: "q", action: "quit", hint: { keys: "q", label: "quit" } };
const MOVE: BindingSpec = { token: "move", action: "move", hint: { keys: "↑↓/jk", label: "move" } };
const BACK: BindingSpec = { token: "back", action: "back", hint: { keys: "⌫/esc", label: "back" } };

// Sections share a single footer hint; only the first carries it.
const SECTIONS: readonly BindingSpec[] = [
  { token: "o", action: "section:overview", hint: { keys: "o/s/w/a", label: "sections" } },
  { token: "s", action: "section:sprints" },
  { token: "w", action: "section:work" },
  { token: "a", action: "section:activity" }
];

function drill(label: string): BindingSpec {
  return { token: "drill", action: "drill", hint: { keys: "⏎", label } };
}

export function bindingsForScreen(screen: TuiScreen): readonly BindingSpec[] {
  switch (screen) {
    case "overview":
      return [SEARCH, ...SECTIONS, REFRESH, QUIT];
    case "sprintList":
      return [MOVE, drill("open sprint"), SEARCH, ...SECTIONS, QUIT];
    case "activityList":
      return [MOVE, drill("open event"), SEARCH, ...SECTIONS, QUIT];
    case "workList":
      return [MOVE, drill("open"), { token: "f", action: "filter", hint: { keys: "f", label: "filter" } }, SEARCH, ...SECTIONS, QUIT];
    case "sprintDetail":
      return [MOVE, drill("open task"), BACK, SEARCH, ...SECTIONS, QUIT];
    case "taskDetail":
    case "activityDetail":
      return [BACK, SEARCH, ...SECTIONS, QUIT];
    default:
      return [SEARCH, ...SECTIONS, REFRESH, QUIT];
  }
}

export function resolveAction(specs: readonly BindingSpec[], input: string, key: Key): ActionId | undefined {
  for (const spec of specs) {
    if (matchToken(spec.token, input, key)) return spec.action;
  }
  return undefined;
}

export function footerHints(specs: readonly BindingSpec[]): readonly { readonly keys: string; readonly label: string }[] {
  return specs.flatMap((spec) => (spec.hint ? [spec.hint] : []));
}
