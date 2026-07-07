import { describe, expect, it } from "vitest";

import { buildGlobalBoardView } from "../../packages/ui-model/src/dashboard-view.ts";

describe("global board view", () => {
  it("prepends queued raw inbox items to the inbox rail", () => {
    const view = buildGlobalBoardView({
      generatedAt: "2026-07-07T00:00:00.000Z",
      projects: [],
      inboxItems: [
        {
          id: "bw_source_fixture_missing",
          title: "missing-asset.md",
          detail: "Fixture row for missing local preview handling.",
          status: "queued raw source",
          command: "bwrk global raw triage <action> bw_source_fixture_missing --json"
        }
      ]
    });

    expect(view.rails.find((rail) => rail.id === "inbox")?.items).toEqual([
      expect.objectContaining({
        id: "raw:bw_source_fixture_missing",
        title: "missing-asset.md",
        command: "bwrk global raw triage <action> bw_source_fixture_missing --json"
      })
    ]);
    expect(view.summary.inbox).toBe(1);
  });
});
