import { describe, expect, it } from "vitest";

import { fitTableColumnWidths, sectionRailLayout, tableIndicatorLines, tableRowCapacity, windowList } from "../../apps/tui/src/ui.js";

describe("tui bounded terminal layout helpers", () => {
  it("keeps fitted columns inside the available row budget", () => {
    const widths = fitTableColumnWidths(
      [
        { header: "kind", width: 9 },
        { header: "status", width: 8 },
        { header: "title", width: 40 },
        { header: "done", width: 10 },
        { header: "blocked", width: 8 }
      ],
      32
    );

    expect(2 + widths.reduce((sum, width) => sum + width, 0)).toBeLessThanOrEqual(32);
    expect(widths[0]).toBeGreaterThan(0);
    expect(widths[2]).toBeGreaterThan(0);
  });

  it("reserves header and overflow rows before windowing table data", () => {
    expect(tableRowCapacity(20, 8)).toBe(5);
    expect(tableIndicatorLines(20, 8)).toBe(2);
    // With only one or two body rows available, keep the cursor rows and omit
    // indicators rather than overflowing the terminal vertically.
    expect(tableRowCapacity(20, 3)).toBe(2);
    expect(tableIndicatorLines(20, 3)).toBe(0);
  });

  it("keeps the cursor-centered window bounded and indexed", () => {
    const windowed = windowList(["a", "b", "c", "d", "e"], 4, 2);
    expect(windowed.rows.map(({ item, index }) => [item, index])).toEqual([
      ["d", 3],
      ["e", 4]
    ]);
    expect(windowed.above).toBe(3);
    expect(windowed.below).toBe(0);
  });

  it("falls back from a labeled rail to a rail-free narrow layout", () => {
    expect(sectionRailLayout(100)).toEqual({ width: 13, compact: false });
    expect(sectionRailLayout(60)).toEqual({ width: 9, compact: true });
    expect(sectionRailLayout(48)).toEqual({ width: 5, compact: true });
    expect(sectionRailLayout(47)).toEqual({ width: 0, compact: true });
  });
});
