// Binding specs for the v1 route shell. The matcher is isolated from the
// retired screen-specific binding table so the active shell has no legacy
// implementation dependency.

import type { Key } from "ink";

import { matchToken } from "./key-matcher.js";

export type RouteActionId =
  | "move"
  | "drill"
  | "toggleDisclosure"
  | "expand"
  | "collapse"
  | "ready"
  | "back"
  | "search"
  | "refresh"
  | "filter"
  | "quit"
  | "previousSprint"
  | "nextSprint"
  | `numberKey:${number}`;

export interface RouteBindingSpec {
  readonly token: string;
  readonly action: RouteActionId;
  readonly hint?: { readonly keys: string; readonly label: string };
}

const MOVE: RouteBindingSpec = { token: "move", action: "move", hint: { keys: "↑↓/jk", label: "move" } };
const DRILL_PROJECT: RouteBindingSpec = { token: "drill", action: "drill", hint: { keys: "⏎", label: "open project" } };
const DRILL_WORK: RouteBindingSpec = { token: "drill", action: "drill", hint: { keys: "⏎", label: "open work" } };
const DRILL_ROLLUP: RouteBindingSpec = { token: "drillRollup", action: "drill", hint: { keys: "⏎", label: "open" } };
const TOGGLE_DISCLOSURE: RouteBindingSpec = { token: "toggleDisclosure", action: "toggleDisclosure", hint: { keys: "space", label: "fold" } };
const EXPAND_DISCLOSURE: RouteBindingSpec = { token: "expandDisclosure", action: "expand", hint: { keys: "→/l", label: "expand" } };
const COLLAPSE_DISCLOSURE: RouteBindingSpec = { token: "collapseDisclosure", action: "collapse", hint: { keys: "←/h", label: "collapse" } };
const READY_FILTER: RouteBindingSpec = { token: "readyFilter", action: "ready", hint: { keys: "a", label: "ready" } };
const DRILL_FINDING: RouteBindingSpec = { token: "drill", action: "drill", hint: { keys: "⏎", label: "open finding" } };
const DRILL_ACTION: RouteBindingSpec = { token: "drill", action: "drill", hint: { keys: "⏎", label: "run action" } };
const PREVIOUS_SPRINT: RouteBindingSpec = { token: "[", action: "previousSprint", hint: { keys: "[", label: "previous sprint" } };
const NEXT_SPRINT: RouteBindingSpec = { token: "]", action: "nextSprint", hint: { keys: "]", label: "next sprint" } };
const BACK: RouteBindingSpec = { token: "back", action: "back", hint: { keys: "esc", label: "back / quit" } };
const SEARCH: RouteBindingSpec = { token: "/", action: "search", hint: { keys: "/", label: "jump" } };
const REFRESH: RouteBindingSpec = { token: "r", action: "refresh", hint: { keys: "r", label: "refresh" } };
const FILTER: RouteBindingSpec = { token: "f", action: "filter", hint: { keys: "f", label: "filter" } };
const QUIT: RouteBindingSpec = { token: "q", action: "quit", hint: { keys: "q", label: "quit" } };
const SECTIONS: RouteBindingSpec = { token: "numberKey", action: "numberKey:0", hint: { keys: "1-9", label: "sections" } };

const FILTERABLE_ROUTES = new Set(["repo.rollup", "repo.sprintBoard", "repo.work", "global.queues"]);
const PROJECT_DRILL_ROUTES = new Set(["global.projects"]);
const WORK_DRILL_ROUTES = new Set(["global.queues", "repo.sprintBoard", "repo.now", "repo.milestones", "repo.sprints", "repo.work", "repo.ops"]);
const FINDING_DRILL_ROUTES = new Set(["global.overview"]);
const ACTION_DRILL_ROUTES = new Set(["repo.taskDetail"]);
const SECTION_ROUTES = new Set(["global.overview", "global.projects", "global.queues", "repo.now", "repo.rollup", "repo.milestones", "repo.sprints", "repo.work", "repo.ops"]);

/**
 * Return only bindings that have a meaningful action on the active route.
 */
export function bindingsForRoute(routeId: string): readonly RouteBindingSpec[] {
  const specs: RouteBindingSpec[] = [MOVE];
  if (PROJECT_DRILL_ROUTES.has(routeId)) specs.push(DRILL_PROJECT);
  if (routeId === "repo.rollup") specs.push(TOGGLE_DISCLOSURE, EXPAND_DISCLOSURE, COLLAPSE_DISCLOSURE, READY_FILTER, DRILL_ROLLUP);
  else if (WORK_DRILL_ROUTES.has(routeId)) specs.push(DRILL_WORK);
  if (FINDING_DRILL_ROUTES.has(routeId)) specs.push(DRILL_FINDING);
  if (ACTION_DRILL_ROUTES.has(routeId)) specs.push(DRILL_ACTION);
  if (routeId === "repo.sprintBoard") specs.push(PREVIOUS_SPRINT, NEXT_SPRINT);
  specs.push(BACK, SEARCH);
  if (FILTERABLE_ROUTES.has(routeId)) specs.push(FILTER);
  if (SECTION_ROUTES.has(routeId)) specs.push(SECTIONS);
  specs.push(REFRESH, QUIT);
  return specs;
}

export function resolveRouteAction(specs: readonly RouteBindingSpec[], input: string, key: Key): RouteActionId | undefined {
  for (const spec of specs) {
    if (spec.token === "numberKey") {
      if (/^[1-9]$/u.test(input)) return `numberKey:${Number(input)}`;
      continue;
    }
    if (matchToken(spec.token, input, key)) return spec.action;
  }
  return undefined;
}

export function routeFooterHints(specs: readonly RouteBindingSpec[]): readonly { readonly keys: string; readonly label: string }[] {
  const seen = new Set<string>();
  return specs.flatMap((spec) => {
    if (!spec.hint) return [];
    // The dispatcher resolves the first matching token. A footer must not
    // advertise two different actions for the same physical key even if a
    // caller supplies overlapping specs.
    const key = spec.hint.keys;
    if (seen.has(key)) return [];
    seen.add(key);
    return [spec.hint];
  });
}
