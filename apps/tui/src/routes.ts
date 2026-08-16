// Route table for the v1 shell. Only the routes named in the v1 scope cut
// are implemented; everything else in TUI_SURFACE_CONTRACTS.md renders a
// "planned" placeholder via `isStub`.

import type { TuiSurfaceKind } from "@boreal/ui-model";

export interface RouteSpec {
  readonly id: string;
  readonly surface: TuiSurfaceKind;
  readonly label: string;
  readonly numberKey: number;
  readonly isStub?: boolean;
}

/** Routes that have a live loader and are safe to expose in the rail. */
export const GLOBAL_ROUTES: readonly RouteSpec[] = [
  { id: "global.overview", surface: "global", label: "Overview", numberKey: 1 },
  { id: "global.projects", surface: "global", label: "Projects", numberKey: 2 },
  { id: "global.queues", surface: "global", label: "Queues", numberKey: 3 }
];

/** Documented v1 follow-ups stay addressable for validation, but are hidden
 * from the active rail and number-key palette until they have loaders. */
export const GLOBAL_STUB_ROUTES: readonly RouteSpec[] = [
  { id: "global.search", surface: "global", label: "Search", numberKey: 4, isStub: true },
  { id: "global.activity", surface: "global", label: "Activity", numberKey: 5, isStub: true },
  { id: "global.health", surface: "global", label: "Health", numberKey: 6, isStub: true },
  { id: "global.settings", surface: "global", label: "Settings", numberKey: 7, isStub: true }
];

export const REPO_ROUTES: readonly RouteSpec[] = [
  { id: "repo.rollup", surface: "repo", label: "Roll-Up", numberKey: 1 },
  { id: "repo.sprintBoard", surface: "repo", label: "Sprint Board", numberKey: 2 }
];

export const REPO_STUB_ROUTES: readonly RouteSpec[] = [
  { id: "repo.work", surface: "repo", label: "Work", numberKey: 3, isStub: true },
  { id: "repo.activity", surface: "repo", label: "Activity", numberKey: 4, isStub: true },
  { id: "repo.knowledge", surface: "repo", label: "Knowledge", numberKey: 5, isStub: true },
  { id: "repo.reports", surface: "repo", label: "Reports", numberKey: 6, isStub: true },
  { id: "repo.health", surface: "repo", label: "Health", numberKey: 7, isStub: true },
  { id: "repo.settings", surface: "repo", label: "Settings", numberKey: 8, isStub: true }
];

// Task Detail is reached only by drilling from Roll-Up/Sprint Board (never a
// rail section) so it is intentionally absent from REPO_ROUTES.
export const REPO_TASK_DETAIL_ROUTE = "repo.taskDetail";

export function railFor(surface: TuiSurfaceKind): readonly RouteSpec[] {
  return surface === "global" ? GLOBAL_ROUTES : REPO_ROUTES;
}

export function routeById(id: string): RouteSpec | undefined {
  return [...GLOBAL_ROUTES, ...GLOBAL_STUB_ROUTES, ...REPO_ROUTES, ...REPO_STUB_ROUTES].find((route) => route.id === id);
}

export function routeByNumberKey(surface: TuiSurfaceKind, key: number): RouteSpec | undefined {
  return railFor(surface).find((route) => route.numberKey === key);
}
