import { describe, expect, it } from "vitest";

import {
  atRoot,
  initialNavState,
  reduceNav,
  topFrame,
  type NavState
} from "../../apps/tui/src/nav.js";

function drive(state: NavState, ...actions: Parameters<typeof reduceNav>[1][]): NavState {
  return actions.reduce((current, action) => reduceNav(current, action), state);
}

describe("tui navigation reducer", () => {
  it("drills Sprints -> sprint -> task and backs out level by level", () => {
    let state = initialNavState("sprints");
    expect(topFrame(state).screen).toBe("sprintList");

    state = reduceNav(state, { type: "move", delta: 1, length: 14 });
    expect(topFrame(state).cursor).toBe(1);

    state = reduceNav(state, { type: "drill", id: "bw_sprint_06" });
    expect(topFrame(state).screen).toBe("sprintDetail");
    expect(topFrame(state).sprintId).toBe("bw_sprint_06");
    expect(topFrame(state).cursor).toBe(0);

    state = reduceNav(state, { type: "drill", id: "bw_task_1" });
    expect(topFrame(state).screen).toBe("taskDetail");
    expect(topFrame(state).taskId).toBe("bw_task_1");
    expect(topFrame(state).sprintId).toBe("bw_sprint_06");

    // taskDetail is a leaf: drilling further is a no-op.
    state = reduceNav(state, { type: "drill", id: "ignored" });
    expect(topFrame(state).screen).toBe("taskDetail");

    state = reduceNav(state, { type: "back" });
    expect(topFrame(state).screen).toBe("sprintDetail");
    expect(topFrame(state).sprintId).toBe("bw_sprint_06");

    state = reduceNav(state, { type: "back" });
    expect(topFrame(state).screen).toBe("sprintList");
    expect(atRoot(state)).toBe(true);
  });

  it("treats back at root as a no-op", () => {
    const state = initialNavState("sprints");
    expect(reduceNav(state, { type: "back" })).toEqual(state);
  });

  it("ignores drill without an id", () => {
    const state = initialNavState("sprints");
    expect(reduceNav(state, { type: "drill" })).toEqual(state);
  });

  it("clamps cursor within the list bounds", () => {
    let state = initialNavState("work");
    state = reduceNav(state, { type: "move", delta: -5, length: 10 });
    expect(topFrame(state).cursor).toBe(0);
    state = reduceNav(state, { type: "move", delta: 99, length: 10 });
    expect(topFrame(state).cursor).toBe(9);
    state = reduceNav(state, { type: "move", delta: 3, length: 0 });
    expect(topFrame(state).cursor).toBe(0);
  });

  it("switching section resets depth and cursor", () => {
    let state = initialNavState("sprints");
    state = drive(
      state,
      { type: "move", delta: 4, length: 14 },
      { type: "drill", id: "s1" },
      { type: "drill", id: "t1" }
    );
    expect(state.stack).toHaveLength(3);

    state = reduceNav(state, { type: "section", section: "work" });
    expect(state.section).toBe("work");
    expect(state.stack).toHaveLength(1);
    expect(topFrame(state).screen).toBe("workList");
    expect(topFrame(state).cursor).toBe(0);
  });

  it("work drills straight to a task and backs to the list", () => {
    let state = initialNavState("work");
    state = reduceNav(state, { type: "drill", id: "bw_task_42" });
    expect(topFrame(state).screen).toBe("taskDetail");
    expect(topFrame(state).taskId).toBe("bw_task_42");
    state = reduceNav(state, { type: "back" });
    expect(topFrame(state).screen).toBe("workList");
  });
});
