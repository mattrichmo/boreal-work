import { describe, expect, it } from "vitest";

import { fit } from "../../apps/tui/src/theme.js";

describe("tui fit()", () => {
  it("pads short values to width", () => {
    expect(fit("ab", 5)).toBe("ab   ");
    expect(fit("ab", 5)).toHaveLength(5);
  });

  it("truncates with an ellipsis", () => {
    expect(fit("abcdef", 4)).toBe("abc…");
  });

  it("never splits a surrogate pair when truncating", () => {
    // 😀 is a surrogate pair (2 UTF-16 units, 1 code point).
    const result = fit("😀😀😀", 2);
    // width 2 -> 1 char + ellipsis; the kept emoji must be intact (no lone surrogate).
    expect(result).toBe("😀…");
    expect(Array.from(result)).toHaveLength(2);
  });

  it("handles zero/one width without throwing", () => {
    expect(fit("abc", 0)).toBe("");
    expect(fit("abc", 1)).toBe("a");
  });
});
