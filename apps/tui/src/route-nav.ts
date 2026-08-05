// Route-based navigation reducer for the TUI shell (see
// docs/architecture/TUI_SURFACE_CONTRACTS.md). Kept pure and free of
// React/Ink so drill-in/back/global<->repo breadcrumb behavior can be
// unit-tested without rendering anything.
//
// This coexists with the legacy four-section reducer in nav.ts (still used
// by the pre-v1 `App`/`app.tsx`, whose tests still pass); the shell wires
// into this reducer instead.

import type { OpenRepoTarget, TuiEntityRef, TuiFilterState, TuiNavFrame, TuiSurfaceKind } from "@boreal/ui-model";

export interface RouteSession {
  readonly surface: TuiSurfaceKind;
  readonly workspaceRoot: string;
  /** Always at least one frame; the last entry is the active screen. */
  readonly stack: readonly TuiNavFrame[];
}

export interface RouteNavState {
  readonly current: RouteSession;
  /**
   * The preserved global session a repo session was opened from. Present
   * only while `current` is a repo surface entered via `openRepo`; popping
   * past the repo root restores this session with its cursor intact.
   */
  readonly returnTo?: RouteSession;
}

export type RouteNavAction =
  | { readonly type: "push"; readonly frame: TuiNavFrame }
  | { readonly type: "pop" }
  | { readonly type: "setCursor"; readonly cursor: number }
  | { readonly type: "setFilters"; readonly filters: TuiFilterState | undefined }
  | { readonly type: "openRepo"; readonly target: OpenRepoTarget }
  | { readonly type: "jump"; readonly session: RouteSession };

export function rootFrame(routeId: string, title: string): TuiNavFrame {
  return { routeId, title, cursor: 0 };
}

export function initialRouteNavState(surface: TuiSurfaceKind, workspaceRoot: string, routeId: string, title: string): RouteNavState {
  return { current: { surface, workspaceRoot, stack: [rootFrame(routeId, title)] } };
}

export function topFrame(state: RouteNavState): TuiNavFrame {
  const frame = state.current.stack[state.current.stack.length - 1];
  if (!frame) {
    throw new Error("RouteNavState.current.stack must never be empty");
  }
  return frame;
}

export function atRoot(state: RouteNavState): boolean {
  return state.current.stack.length <= 1;
}

function replaceTopOf(session: RouteSession, frame: TuiNavFrame): RouteSession {
  return { ...session, stack: [...session.stack.slice(0, -1), frame] };
}

export function reduceRouteNav(state: RouteNavState, action: RouteNavAction): RouteNavState {
  switch (action.type) {
    case "push":
      return { ...state, current: { ...state.current, stack: [...state.current.stack, action.frame] } };
    case "pop": {
      if (state.current.stack.length > 1) {
        return { ...state, current: { ...state.current, stack: state.current.stack.slice(0, -1) } };
      }
      // At the repo root: if this session was opened from a global frame,
      // restore that global session (cursor and filters intact) instead of
      // silently no-op'ing, and drop the breadcrumb back-link.
      if (state.returnTo) {
        return { current: state.returnTo };
      }
      return state;
    }
    case "setCursor":
      return { ...state, current: replaceTopOf(state.current, { ...topFrame(state), cursor: action.cursor }) };
    case "setFilters":
      return { ...state, current: replaceTopOf(state.current, { ...topFrame(state), filters: action.filters }) };
    case "openRepo": {
      const initialEntity: TuiEntityRef | undefined = action.target.initialEntity;
      const repoFrame: TuiNavFrame = {
        routeId: action.target.initialRoute ?? "repo.rollup",
        title: action.target.projectName,
        cursor: 0,
        entity: initialEntity
      };
      return {
        current: { surface: "repo", workspaceRoot: action.target.projectRoot, stack: [repoFrame] },
        returnTo: replaceTopOf(state.current, action.target.returnToGlobalFrame)
      };
    }
    case "jump":
      // `jump` is only ever a same-surface section switch (number key or
      // palette selection inside the current surface); openRepo is the only
      // surface-switcher. Preserving `returnTo` here matters: without it, a
      // repo session entered from global that then jumps between repo
      // sections loses its breadcrumb and `esc` at the new root quits
      // instead of returning to the preserved global frame.
      return { ...state, current: action.session };
    default:
      return state;
  }
}

/** Breadcrumb labels for the top bar: `global > project > route` when the
 * current repo session was opened from a preserved global frame. */
export function breadcrumbs(state: RouteNavState): readonly string[] {
  const own = state.current.stack.map((frame) => frame.title);
  if (state.current.surface === "repo" && state.returnTo) {
    return ["global", ...own];
  }
  return own;
}
