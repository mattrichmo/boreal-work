import { describe, expect, it } from "vitest";

import { fuzzyScore, searchItems, type SearchItem } from "../../apps/tui/src/search.js";
import { initialNavState, jumpTo, reduceNav, topFrame } from "../../apps/tui/src/nav.js";

const items: readonly SearchItem[] = [
  { kind: "sprint", id: "s6", label: "Sprint 06 - Active sprint kanban", hint: "closed" },
  { kind: "task", id: "t1", label: "Add sprint list/show/current command", hint: "closed" },
  { kind: "task", id: "t2", label: "Implement board table and timeline", hint: "ready" },
  { kind: "event", id: "e1", label: "work.closed", hint: "work" }
];

describe("tui fuzzy search", () => {
  it("returns everything (capped) for an empty query", () => {
    expect(searchItems(items, "", 2)).toHaveLength(2);
  });

  it("matches as a subsequence, not just substring", () => {
    expect(fuzzyScore("brd", "board")).not.toBeNull();
    expect(fuzzyScore("xyz", "board")).toBeNull();
  });

  it("ranks the closer match first", () => {
    const results = searchItems(items, "sprint");
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.label.toLowerCase().startsWith("sprint")).toBe(true);
  });

  it("finds an event by type", () => {
    const results = searchItems(items, "closed");
    expect(results.some((result) => result.kind === "event" && result.id === "e1")).toBe(true);
  });

  it("returns no results for an unmatched query", () => {
    expect(searchItems(items, "zzzzz")).toHaveLength(0);
  });
});

describe("tui jump navigation", () => {
  it("jumps from any section straight to a task detail", () => {
    const start = initialNavState("sprints");
    const target = jumpTo("task", "bw_task_7");
    const next = reduceNav(start, { type: "jump", section: target.section, stack: target.stack });
    expect(next.section).toBe("work");
    expect(topFrame(next).screen).toBe("taskDetail");
    expect(topFrame(next).taskId).toBe("bw_task_7");
    // back returns to the section's list, not wherever we came from.
    const back = reduceNav(next, { type: "back" });
    expect(topFrame(back).screen).toBe("workList");
  });

  it("jumps to a sprint detail and an event detail", () => {
    const sprint = jumpTo("sprint", "bw_sprint_06");
    expect(sprint.section).toBe("sprints");
    expect(sprint.stack[sprint.stack.length - 1]?.screen).toBe("sprintDetail");

    const event = jumpTo("event", "bw_event_3");
    expect(event.section).toBe("activity");
    expect(event.stack[event.stack.length - 1]?.eventId).toBe("bw_event_3");
  });
});
