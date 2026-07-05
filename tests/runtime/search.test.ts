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
  it("splits camel case and URI-like path tokens before ranking", () => {
    const work = createWorkItem({
      title: "RemoteSensingAPIClient",
      description: "Review file://docs/runtimeLockDoctor.md before release.",
      actor,
      now
    });
    const index = buildSearchIndex({
      workItems: [work],
      evidence: [],
      knowledgeSources: [],
      claims: [],
      decisions: []
    });

    const results = querySearchIndex(index, "remote sensing api client lock doctor");

    expect(results[0]?.recordId).toBe(work.meta.id);
    expect(results[0]?.matches).toEqual(expect.arrayContaining(["remote", "sensing", "client", "lock", "doctor"]));
  });

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
      decisions: []
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

  it("uses vector-lite similarity for near-token retrieval with explain output", () => {
    const work = createWorkItem({
      title: "Reserve lease ownership",
      description: "Coordinate stale locks before an agent claims work.",
      actor,
      now
    });
    const index = buildSearchIndex({
      workItems: [work],
      evidence: [],
      knowledgeSources: [],
      claims: [],
      decisions: []
    });

    const results = querySearchIndex(index, "reservation", { explain: true });
    const vectorBreakdown = results[0]?.explain?.scoreBreakdown.find((entry) => entry.kind === "vector_similarity");

    expect(index.documents[0]?.vectorWeights.length).toBeGreaterThan(0);
    expect(results[0]?.recordId).toBe(work.meta.id);
    expect(results[0]?.matches).toContain("vector");
    expect(vectorBreakdown?.contribution).toBeGreaterThan(0);
    expect(vectorBreakdown?.matchedDimensions).toBeGreaterThan(0);
  });

  it("indexes only primary records", () => {
    const work = createWorkItem({
      title: "Primary Search Runtime",
      description: "Search records without derived context documents.",
      actor,
      now
    });
    const index = buildSearchIndex({
      workItems: [work],
      evidence: [],
      knowledgeSources: [],
      claims: [],
      decisions: []
    });

    expect([...new Set(index.documents.map((document) => document.type))]).toEqual(["work"]);
  });
});
