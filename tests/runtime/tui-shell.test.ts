import { describe, expect, it } from "vitest";

import { isInteractiveTerminal, parseTuiArgs } from "../../apps/tui/src/index.js";
import { formatCommandFailure, isRefreshCurrent, routeRequestKey } from "../../apps/tui/src/shell.js";

describe("active TUI shell lifecycle helpers", () => {
  it("parses global, registry-root, mouse, and refresh options", () => {
    expect(parseTuiArgs([
      "--global",
      "--workspace",
      "/global",
      "--registry-root",
      "/custom/registry",
      "--mouse",
      "--refresh-ms",
      "1250"
    ])).toEqual({
      global: true,
      workspace: "/global",
      registryRoot: "/custom/registry",
      mouse: true,
      refreshMs: 1250
    });
    expect(parseTuiArgs([]).refreshMs).toBe(5_000);
    expect(parseTuiArgs(["--refresh-ms", "0"]).refreshMs).toBe(500);
    expect(() => parseTuiArgs(["--refresh-ms", "nope"])).toThrow("--refresh-ms");
    expect(() => parseTuiArgs(["--registry-root"])).toThrow("--registry-root requires a value");
  });

  it("recognizes only a real input/output TTY pair as interactive", () => {
    expect(isInteractiveTerminal({ isTTY: true }, { isTTY: true })).toBe(true);
    expect(isInteractiveTerminal({ isTTY: true }, { isTTY: false })).toBe(false);
    expect(isInteractiveTerminal({ isTTY: false }, { isTTY: true })).toBe(false);
  });

  it("keys refreshes by surface, route, entity, and registry root", () => {
    const base = {
      surface: "repo" as const,
      workspaceRoot: "/repo",
      routeId: "repo.rollup"
    };
    expect(routeRequestKey(base)).not.toBe(routeRequestKey({ ...base, routeId: "repo.sprintBoard" }));
    expect(routeRequestKey(base)).not.toBe(routeRequestKey({ ...base, entityId: "task-1" }));
    expect(routeRequestKey({ ...base, entityId: "same-id", entityKind: "task" })).not.toBe(
      routeRequestKey({ ...base, entityId: "same-id", entityKind: "issue" })
    );
    expect(routeRequestKey(base)).not.toBe(routeRequestKey({ ...base, registryRoot: "/custom" }));
  });

  it("ignores aborted generations and preserves command diagnostics", () => {
    const controller = new AbortController();
    expect(isRefreshCurrent(2, 2, controller.signal)).toBe(true);
    controller.abort();
    expect(isRefreshCurrent(2, 2, controller.signal)).toBe(false);
    expect(isRefreshCurrent(1, 2, new AbortController().signal)).toBe(false);

    const failure = Object.assign(new Error("command failed"), {
      code: 3,
      stderr: "policy denied"
    });
    expect(formatCommandFailure(failure)).toContain("exit: 3");
    expect(formatCommandFailure(failure)).toContain("stderr:\npolicy denied");
  });
});
