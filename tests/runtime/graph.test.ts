import { describe, expect, it } from "vitest";

import { createGraphEdge } from "@boreal/graph-engine";

const actor = { id: "test", kind: "system" as const };
const now = "2026-06-25T00:00:00.000Z";

describe("graph edge identity", () => {
  it("includes endpoint types and directedness in deterministic IDs", () => {
    const base = createGraphEdge({
      kind: "relates_to",
      fromId: "alpha",
      fromType: "work",
      toId: "beta",
      toType: "work",
      actor,
      now
    });
    const explicitDirected = createGraphEdge({
      kind: "relates_to",
      fromId: "alpha",
      fromType: "work",
      toId: "beta",
      toType: "work",
      directed: true,
      actor,
      now
    });
    const differentFromType = createGraphEdge({
      kind: "relates_to",
      fromId: "alpha",
      fromType: "decision",
      toId: "beta",
      toType: "work",
      actor,
      now
    });
    const undirected = createGraphEdge({
      kind: "relates_to",
      fromId: "alpha",
      fromType: "work",
      toId: "beta",
      toType: "work",
      directed: false,
      actor,
      now
    });

    expect(base.meta.id).toBe(explicitDirected.meta.id);
    expect(differentFromType.meta.id).not.toBe(base.meta.id);
    expect(undirected.meta.id).not.toBe(base.meta.id);
  });
});
