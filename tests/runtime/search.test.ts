import { describe, expect, it } from "vitest";

import { type ActorRef, type IsoTimestamp } from "@boreal/core";
import { buildSearchIndex, querySearchIndex } from "@boreal/search";
import { createWorkItem } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "search-test-agent",
  kind: "agent",
  displayName: "Search Test Agent"
};

const now = "2026-01-01T00:00:00.000Z" as IsoTimestamp;

describe("search ranking", () => {
  it("uses document frequency so rare low-weight tokens beat common high-weight tokens", () => {
    const commonWork = Array.from({ length: 8 }, (_value, index) =>
      createWorkItem({
        title: `Common runbook ${index}`,
        description: "Common operational background.",
        actor,
        now
      })
    );
    const needle = createWorkItem({
      title: "Specific retrieval target",
      description: "Needle detail lives here.",
      actor,
      now
    });
    const index = buildSearchIndex({
      workItems: [...commonWork, needle],
      evidence: [],
      knowledgeSources: [],
      claims: [],
      decisions: [],
      contextPacks: []
    });

    const results = querySearchIndex(index, "common needle", { explain: true });
    const frequencies = new Map(index.documentFrequencies);
    const needleResult = results.find((result) => result.recordId === needle.meta.id);
    const needleBreakdown = needleResult?.explain?.scoreBreakdown.find((entry) => entry.token === "needle");
    const commonResult = results.find((result) => result.recordId === commonWork[0]?.meta.id);
    const commonBreakdown = commonResult?.explain?.scoreBreakdown.find((entry) => entry.token === "common");

    expect(frequencies.get("common")).toBe(8);
    expect(frequencies.get("needle")).toBe(1);
    expect(results[0]?.recordId).toBe(needle.meta.id);
    expect(needleBreakdown?.idf).toBeGreaterThan(commonBreakdown?.idf ?? 0);
  });
});
