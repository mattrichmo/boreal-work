import { describe, expect, it } from "vitest";

import type { OpenRepoTarget, TuiFilterState } from "@boreal/ui-model";
import {
  atRoot,
  breadcrumbs,
  initialRouteNavState,
  reduceRouteNav,
  rootFrame,
  topFrame,
  type RouteNavState
} from "../../apps/tui/src/route-nav.js";

function drive(state: RouteNavState, ...actions: Parameters<typeof reduceRouteNav>[1][]): RouteNavState {
  return actions.reduce((current, action) => reduceRouteNav(current, action), state);
}

describe("route nav reducer", () => {
  it("push/pop preserves cursor and filters on the frame being returned to", () => {
    let state = initialRouteNavState("repo", "/repo", "repo.rollup", "Roll-Up");
    state = reduceRouteNav(state, { type: "setCursor", cursor: 3 });
    const filters: TuiFilterState = { clauses: [{ field: "status", operator: "is", value: "ready" }], sort: [] };
    state = reduceRouteNav(state, { type: "setFilters", filters });
    expect(topFrame(state).cursor).toBe(3);
    expect(topFrame(state).filters).toEqual(filters);

    state = reduceRouteNav(state, { type: "push", frame: rootFrame("repo.taskDetail", "Task 1") });
    expect(atRoot(state)).toBe(false);
    expect(topFrame(state).routeId).toBe("repo.taskDetail");

    state = reduceRouteNav(state, { type: "pop" });
    expect(atRoot(state)).toBe(true);
    expect(topFrame(state).routeId).toBe("repo.rollup");
    // The rollup frame's cursor and filters survived the round trip.
    expect(topFrame(state).cursor).toBe(3);
    expect(topFrame(state).filters).toEqual(filters);
  });

  it("pop at root with no return frame is a no-op", () => {
    const state = initialRouteNavState("global", "/global", "global.overview", "Overview");
    expect(reduceRouteNav(state, { type: "pop" })).toEqual(state);
  });

  it("openRepo switches to a repo session and preserves a breadcrumb back to the global frame", () => {
    let state = initialRouteNavState("global", "/global", "global.projects", "Projects");
    state = reduceRouteNav(state, { type: "setCursor", cursor: 2 });

    const target: OpenRepoTarget = {
      projectId: "proj-1",
      projectName: "boreal-work",
      projectRoot: "/repos/boreal-work",
      initialRoute: "repo.rollup",
      returnToGlobalFrame: { routeId: "global.projects", title: "Projects", cursor: 2 }
    };
    state = reduceRouteNav(state, { type: "openRepo", target });

    expect(state.current.surface).toBe("repo");
    expect(state.current.workspaceRoot).toBe("/repos/boreal-work");
    expect(topFrame(state).routeId).toBe("repo.rollup");
    expect(breadcrumbs(state)).toEqual(["global", "boreal-work"]);

    // esc at repo root returns to the preserved global frame, cursor intact.
    state = reduceRouteNav(state, { type: "pop" });
    expect(state.current.surface).toBe("global");
    expect(state.current.workspaceRoot).toBe("/global");
    expect(topFrame(state).routeId).toBe("global.projects");
    expect(topFrame(state).cursor).toBe(2);
    expect(state.returnTo).toBeUndefined();
  });

  it("preserves the return-to breadcrumb across a same-surface section jump inside the repo (numberKey/palette)", () => {
    let state = initialRouteNavState("global", "/global", "global.projects", "Projects");
    state = reduceRouteNav(state, { type: "setCursor", cursor: 2 });
    const target: OpenRepoTarget = {
      projectId: "proj-1",
      projectName: "boreal-work",
      projectRoot: "/repos/boreal-work",
      returnToGlobalFrame: { routeId: "global.projects", title: "Projects", cursor: 2 }
    };
    state = reduceRouteNav(state, { type: "openRepo", target });

    // Switch repo sections the way a number key or the palette does: a
    // same-surface `jump` to a different repo route's root frame.
    state = reduceRouteNav(state, {
      type: "jump",
      session: { surface: "repo", workspaceRoot: "/repos/boreal-work", stack: [rootFrame("repo.sprintBoard", "Sprint Board")] }
    });
    expect(state.current.surface).toBe("repo");
    expect(topFrame(state).routeId).toBe("repo.sprintBoard");
    expect(breadcrumbs(state)).toEqual(["global", "Sprint Board"]);

    // esc at the new repo root must still return to the preserved global
    // frame with its cursor intact, not quit.
    state = reduceRouteNav(state, { type: "pop" });
    expect(state.current.surface).toBe("global");
    expect(topFrame(state).routeId).toBe("global.projects");
    expect(topFrame(state).cursor).toBe(2);
  });

  it("drilling further before returning still restores the original global cursor", () => {
    let state = initialRouteNavState("global", "/global", "global.queues", "Queues");
    state = reduceRouteNav(state, { type: "setCursor", cursor: 5 });
    const target: OpenRepoTarget = {
      projectId: "p",
      projectName: "demo",
      projectRoot: "/repos/demo",
      returnToGlobalFrame: { routeId: "global.queues", title: "Queues", cursor: 5 }
    };
    state = drive(
      state,
      { type: "openRepo", target },
      { type: "push", frame: rootFrame("repo.sprintBoard", "Sprint 1") },
      { type: "push", frame: rootFrame("repo.taskDetail", "Task 1") }
    );
    expect(state.current.stack).toHaveLength(3);

    state = drive(state, { type: "pop" }, { type: "pop" }, { type: "pop" });
    expect(state.current.surface).toBe("global");
    expect(topFrame(state).cursor).toBe(5);
  });
});
