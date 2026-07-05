import { describe, expect, it } from "vitest";

import { type ActorRef, type ContentHash, type IsoTimestamp } from "@boreal/core";
import { recordEvidence } from "@boreal/evidence-engine";
import { buildSearchIndex, searchCorpusFingerprint, type SearchCorpusSnapshot } from "@boreal/search";
import { createWorkItem } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "search-staleness-agent",
  kind: "agent",
  displayName: "Search Staleness Agent"
};

const now = "2026-01-01T00:00:00.000Z" as IsoTimestamp;

describe("search corpus fingerprint", () => {
  it("is stable for identical corpora", () => {
    expect(searchCorpusFingerprint(sampleCorpus())).toBe(searchCorpusFingerprint(sampleCorpus()));
  });

  it("changes when any record content hash changes", () => {
    const original = sampleCorpus();
    const firstWork = original.workItems[0];
    if (!firstWork) {
      throw new Error("sample corpus is missing work items");
    }
    const changedHash = `sha256:${"1".repeat(64)}` as ContentHash;
    const changed = {
      ...original,
      workItems: [
        {
          ...firstWork,
          meta: {
            ...firstWork.meta,
            contentHash: changedHash
          }
        },
        ...original.workItems.slice(1)
      ]
    } satisfies SearchCorpusSnapshot;

    expect(searchCorpusFingerprint(original)).not.toBe(searchCorpusFingerprint(changed));
  });

  it("is embedded in built indexes", () => {
    const snapshot = sampleCorpus();

    expect(buildSearchIndex(snapshot).corpusFingerprint).toBe(searchCorpusFingerprint(snapshot));
  });

  it("indexes only primary records", () => {
    const index = buildSearchIndex(sampleCorpus());
    const types = [...new Set(index.documents.map((document) => document.type))].sort();

    expect(types).toEqual(["evidence", "work"]);
  });
});

function sampleCorpus(): SearchCorpusSnapshot {
  const parserWork = createWorkItem({
    title: "Parser empty input crash",
    description: "Fix crash on empty parser input.",
    labels: ["parser"],
    actor,
    now,
    nonce: 1
  });
  const docsWork = createWorkItem({
    title: "Document parser fallback",
    description: "Document the parser fallback behavior.",
    labels: ["docs"],
    actor,
    now,
    nonce: 2
  });
  const evidence = recordEvidence({
    subjectId: parserWork.meta.id,
    subjectType: "work",
    kind: "test",
    summary: "Parser regression test passed",
    outcome: "passed",
    command: "pnpm vitest run tests/runtime/parser.test.ts",
    actor,
    now
  });

  return {
    workItems: [parserWork, docsWork],
    agentSummaries: [],
    evidence: [evidence],
    knowledgeSources: [],
    claims: [],
    decisions: []
  };
}
