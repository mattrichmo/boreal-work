import { describe, expect, it } from "vitest";

import { canonicalJson, deterministicId, hashContent, randomId, type EventId, type WorkId } from "@boreal/core";

describe("core hashing and ids", () => {
  it("canonicalizes object keys before hashing", () => {
    const left = { b: 2, a: { d: 4, c: 3 } };
    const right = { a: { c: 3, d: 4 }, b: 2 };

    expect(canonicalJson(left)).toBe(canonicalJson(right));
    expect(hashContent(left)).toBe(hashContent(right));
  });

  it("creates deterministic typed ids", () => {
    const first = deterministicId<WorkId>("work", { title: "Build runtime" });
    const second = deterministicId<WorkId>("work", { title: "Build runtime" });

    expect(first).toBe(second);
    expect(first).toMatch(/^bw_work_[a-f0-9]{16}$/);
  });

  it("creates random event ids for append-only event streams", () => {
    const first = randomId<EventId>("event");
    const second = randomId<EventId>("event");

    expect(first).not.toBe(second);
    expect(first).toMatch(/^bw_event_[a-f0-9]{32}$/);
  });
});
