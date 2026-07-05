// Binding specs for the v1 route shell. Reuses bindings.ts#matchToken (a
// generic token matcher, not tied to the legacy TuiScreen type) so the
// footer hints and the dispatcher can't drift apart, same as the legacy
// four-section shell.

import type { Key } from "ink";

import { matchToken } from "./bindings.js";

export type RouteActionId =
  | "move"
  | "drill"
  | "back"
  | "search"
  | "refresh"
  | "filter"
  | "quit"
  | `numberKey:${number}`;

export interface RouteBindingSpec {
  readonly token: string;
  readonly action: RouteActionId;
  readonly hint?: { readonly keys: string; readonly label: string };
}

const MOVE: RouteBindingSpec = { token: "move", action: "move", hint: { keys: "↑↓/jk", label: "move" } };
const DRILL: RouteBindingSpec = { token: "drill", action: "drill", hint: { keys: "⏎", label: "open" } };
const BACK: RouteBindingSpec = { token: "back", action: "back", hint: { keys: "esc", label: "back" } };
const SEARCH: RouteBindingSpec = { token: "/", action: "search", hint: { keys: "/", label: "search" } };
const REFRESH: RouteBindingSpec = { token: "r", action: "refresh", hint: { keys: "r", label: "refresh" } };
const FILTER: RouteBindingSpec = { token: "f", action: "filter", hint: { keys: "f", label: "filter" } };
const QUIT: RouteBindingSpec = { token: "q", action: "quit", hint: { keys: "q", label: "quit" } };
const SECTIONS: RouteBindingSpec = { token: "numberKey", action: "numberKey:0", hint: { keys: "1-9", label: "sections" } };

const FILTERABLE_ROUTES = new Set(["repo.rollup", "global.queues"]);

/** All routes support move/drill/back/search/refresh/sections/quit; `filter`
 * only appears (and is dispatched) on routes with a status facet. */
export function bindingsForRoute(routeId: string): readonly RouteBindingSpec[] {
  const specs: RouteBindingSpec[] = [MOVE, DRILL, BACK, SEARCH];
  if (FILTERABLE_ROUTES.has(routeId)) specs.push(FILTER);
  specs.push(SECTIONS, REFRESH, QUIT);
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
  return specs.flatMap((spec) => (spec.hint ? [spec.hint] : []));
}
