import { describe, expect, it } from "vitest";
import type { Key } from "ink";

import { bindingsForScreen, footerHints, matchToken, resolveAction } from "../../apps/tui/src/bindings.js";
import type { TuiScreen } from "../../apps/tui/src/nav.js";
import { wheelFromInput } from "../../apps/tui/src/runtime.js";

const EMPTY_KEY: Key = {
  upArrow: false,
  downArrow: false,
  leftArrow: false,
  rightArrow: false,
  pageDown: false,
  pageUp: false,
  return: false,
  escape: false,
  ctrl: false,
  shift: false,
  tab: false,
  backspace: false,
  delete: false,
  meta: false
};

function key(overrides: Partial<Key>): Key {
  return { ...EMPTY_KEY, ...overrides };
}

const SCREENS: readonly TuiScreen[] = [
  "overview",
  "sprintList",
  "sprintDetail",
  "workList",
  "taskDetail",
  "activityList",
  "activityDetail"
];

describe("tui bindings", () => {
  it("matches movement, drill, and back across key variants", () => {
    expect(matchToken("move", "j", EMPTY_KEY)).toBe(true);
    expect(matchToken("move", "", key({ upArrow: true }))).toBe(true);
    expect(matchToken("drill", "l", EMPTY_KEY)).toBe(true);
    expect(matchToken("drill", "", key({ return: true }))).toBe(true);
    expect(matchToken("back", "h", EMPTY_KEY)).toBe(true);
    expect(matchToken("back", "", key({ escape: true }))).toBe(true);
    expect(matchToken("back", "", key({ backspace: true }))).toBe(true);
    expect(matchToken("back", "", key({ delete: true }))).toBe(true);
  });

  it("resolves drill on every list screen and back on every detail screen", () => {
    expect(resolveAction(bindingsForScreen("sprintList"), "", key({ return: true }))).toBe("drill");
    expect(resolveAction(bindingsForScreen("workList"), "", key({ return: true }))).toBe("drill");
    expect(resolveAction(bindingsForScreen("taskDetail"), "", key({ escape: true }))).toBe("back");
    expect(resolveAction(bindingsForScreen("activityDetail"), "", key({ backspace: true }))).toBe("back");
  });

  it("routes section, search, filter, and quit keys", () => {
    const specs = bindingsForScreen("workList");
    expect(resolveAction(specs, "s", EMPTY_KEY)).toBe("section:sprints");
    expect(resolveAction(specs, "a", EMPTY_KEY)).toBe("section:activity");
    expect(resolveAction(specs, "/", EMPTY_KEY)).toBe("search");
    expect(resolveAction(specs, "f", EMPTY_KEY)).toBe("filter");
    expect(resolveAction(specs, "q", EMPTY_KEY)).toBe("quit");
  });

  // The whole point of one table: every footer hint must map to a real action.
  it("keeps footer hints and the dispatcher in sync", () => {
    for (const screen of SCREENS) {
      const specs = bindingsForScreen(screen);
      const hints = footerHints(specs);
      expect(hints.length).toBeGreaterThan(0);
      for (const spec of specs) {
        if (!spec.hint) continue;
        // Each hinted, single-character binding must dispatch to its action.
        if (spec.token.length === 1) {
          expect(resolveAction(specs, spec.token, EMPTY_KEY)).toBe(spec.action);
        }
      }
    }
  });

  it("parses SGR mouse wheel up/down", () => {
    expect(wheelFromInput(`${String.fromCharCode(27)}[<64;10;5M`)).toBe("up");
    expect(wheelFromInput(`${String.fromCharCode(27)}[<65;10;5M`)).toBe("down");
    expect(wheelFromInput("j")).toBeUndefined();
  });
});
