import { describe, expect, it } from "vitest";

import { headsDiffer, normalizeRefreshInterval, type EventLogHead } from "../../apps/tui/src/head-poll.js";

const first: EventLogHead = { seq: 4, hash: "hash-a" };

describe("tui head polling", () => {
  it("uses both sequence and hash to detect a changed head", () => {
    expect(headsDiffer(undefined, first)).toBe(false);
    expect(headsDiffer(first, first)).toBe(false);
    expect(headsDiffer(first, { seq: 5, hash: "hash-a" })).toBe(true);
    expect(headsDiffer(first, { seq: 4, hash: "hash-b" })).toBe(true);
  });

  it("applies a safe refresh floor while retaining the configured interval", () => {
    expect(normalizeRefreshInterval(undefined)).toBe(5_000);
    expect(normalizeRefreshInterval(1_250)).toBe(1_250);
    expect(normalizeRefreshInterval(0)).toBe(500);
    expect(normalizeRefreshInterval(Number.NaN)).toBe(5_000);
  });
});
