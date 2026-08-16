import { describe, expect, it } from "vitest";

import { cellWidth, createColorPalette, fit, resolveColorMode, truncate } from "../../apps/tui/src/theme.js";

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
    // A wide emoji occupies both cells, so an ellipsis would overflow width 2.
    expect(result).toBe("😀");
    expect(Array.from(result)).toHaveLength(1);
  });

  it("measures wide, combining, and joined glyphs in terminal cells", () => {
    expect(cellWidth("😀")).toBe(2);
    expect(cellWidth("e\u0301")).toBe(1);
    expect(cellWidth("♥️")).toBe(2);
    expect(cellWidth("👨‍👩‍👧‍👦")).toBe(2);
    expect(cellWidth("\u001b[31mred\u001b[0m")).toBe(3);
  });

  it("keeps fitted output within the requested cell width", () => {
    const fitted = fit("😀😀", 2);
    expect(fitted).toBe("😀");
    expect(cellWidth(fitted)).toBe(2);
    expect(cellWidth(fit("a😀b", 3))).toBe(3);
    expect(fit("7", 3, "right")).toBe("  7");
    expect(truncate("a😀b", 3)).toBe("a…");
  });

  it("handles zero/one width without throwing", () => {
    expect(fit("abc", 0)).toBe("");
    expect(fit("abc", 1)).toBe("a");
  });
});

describe("tui color modes", () => {
  it("honors NO_COLOR and the explicit high-contrast switch", () => {
    expect(resolveColorMode({ NO_COLOR: "" })).toBe("none");
    expect(resolveColorMode({ BOREAL_TUI_NO_COLOR: "1" })).toBe("none");
    expect(resolveColorMode({ BOREAL_TUI_HIGH_CONTRAST: "1" })).toBe("high-contrast");
    expect(createColorPalette("none").accent).toBe("");
    expect(createColorPalette("high-contrast").faint).not.toBe(createColorPalette("color").faint);
  });
});
