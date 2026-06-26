import { describe, expect, it } from "vitest";

import { type ActorRef, type ContextPack, type IsoTimestamp, type ProjectionId } from "@boreal/core";
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
      decisions: [],
      contextPacks: []
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
      decisions: [],
      contextPacks: []
    });

    const results = querySearchIndex(index, "reservation", { explain: true });
    const vectorBreakdown = results[0]?.explain?.scoreBreakdown.find((entry) => entry.kind === "vector_similarity");

    expect(index.documents[0]?.vectorWeights.length).toBeGreaterThan(0);
    expect(results[0]?.recordId).toBe(work.meta.id);
    expect(results[0]?.matches).toContain("vector");
    expect(vectorBreakdown?.contribution).toBeGreaterThan(0);
    expect(vectorBreakdown?.matchedDimensions).toBeGreaterThan(0);
  });

  it("adds bounded context chunks that can outrank the full context pack", () => {
    const pack: ContextPack = {
      id: "projection_context_chunk_test" as ProjectionId,
      subjectId: "work_context_chunk_test",
      generatedAt: now,
      title: "Chunked Context Runtime",
      summary: "Context pack summary for bounded retrieval.",
      facts: Array.from({ length: 12 }, (_value, index) =>
        index === 5 ? "claim: Quartz needle appears in the precise fact." : `claim: Routine bounded context fact ${index}.`
      ),
      evidence: ["passed: chunk cap evidence should not be indexed once the cap is reached."]
    };
    const index = buildSearchIndex({
      workItems: [],
      evidence: [],
      knowledgeSources: [],
      claims: [],
      decisions: [],
      contextPacks: [pack]
    });

    const chunks = index.documents.filter((document) => document.type === "context_chunk");
    const results = querySearchIndex(index, "quartz needle", {
      types: ["context_pack", "context_chunk"]
    });

    expect(chunks).toHaveLength(8);
    expect(chunks.map((chunk) => chunk.id)).toContain("context_chunk:projection_context_chunk_test:fact-005");
    expect(chunks.map((chunk) => chunk.id)).not.toContain("context_chunk:projection_context_chunk_test:fact-010");
    expect(results[0]?.type).toBe("context_chunk");
    expect(results[0]?.recordId).toBe(pack.id);
  });
});
