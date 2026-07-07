import { describe, expect, it } from "vitest";

import { createGraphEdge, wouldCreateCycle } from "@boreal/graph-engine";
import { graphEdgeSchemaIssues } from "@boreal/core";

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

  it("round-trips qualified project endpoints without changing local edge identity", () => {
    const local = createGraphEdge({
      kind: "references",
      fromId: "bw_work_deadbeefdead",
      fromType: "work",
      toId: "bw_work_cafebabecafe",
      toType: "work",
      actor,
      now
    });
    const qualified = createGraphEdge({
      kind: "references",
      fromProjectId: "project_alpha",
      fromId: "bw_work_deadbeefdead",
      fromType: "work",
      toProjectId: "project_beta",
      toId: "bw_work_cafebabecafe",
      toType: "work",
      actor,
      now
    });

    expect(qualified).toEqual(
      expect.objectContaining({
        fromProjectId: "project_alpha",
        fromId: "bw_work_deadbeefdead",
        toProjectId: "project_beta",
        toId: "bw_work_cafebabecafe"
      })
    );
    expect(qualified.meta.id).not.toBe(local.meta.id);
    expect(graphEdgeSchemaIssues(qualified)).toEqual([]);
  });

  it("detects cycles across mixed local and qualified endpoints", () => {
    const edges = [
      createGraphEdge({
        kind: "blocks",
        fromId: "bw_work_alpha000001",
        fromType: "work",
        toProjectId: "project_beta",
        toId: "bw_work_beta0000001",
        toType: "work",
        actor,
        now
      }),
      createGraphEdge({
        kind: "blocks",
        fromProjectId: "project_beta",
        fromId: "bw_work_beta0000001",
        fromType: "work",
        toId: "bw_work_gamma000001",
        toType: "work",
        actor,
        now
      })
    ];

    expect(
      wouldCreateCycle(edges, "bw_work_gamma000001", "bw_work_alpha000001", {
        localProjectId: "project_alpha"
      })
    ).toBe(true);
    expect(
      wouldCreateCycle(edges, "bw_work_gamma000001", "bw_work_alpha000001", {
        localProjectId: "project_alpha",
        proposedFromProjectId: "project_other"
      })
    ).toBe(false);
  });
});
