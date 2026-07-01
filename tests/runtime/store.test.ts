import { describe, expect, it } from "vitest";

import { createRecordMeta, deterministicId, nowIso, withContentHash, type ActorRef, type ReviewerHeartbeatId } from "@boreal/core";
import { InMemoryBorealStore } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "test-agent",
  kind: "agent"
};

describe("in-memory store", () => {
  it("rolls back failed write transactions", async () => {
    const store = new InMemoryBorealStore();
    const work = createWorkItem({
      title: "Transactional write",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });

    await expect(
      store.write(async (writer) => {
        await writer.putWorkItem(work);
        throw new Error("abort");
      })
    ).rejects.toThrow("abort");

    await expect(store.read((reader) => reader.listWorkItems())).resolves.toHaveLength(0);
  });

  it("returns cloned values from reads", async () => {
    const store = new InMemoryBorealStore();
    const work = createWorkItem({
      title: "Clone safety",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });

    await store.write((writer) => writer.putWorkItem(work));
    const loaded = await store.read((reader) => reader.getWorkItem(work.meta.id));
    expect(loaded).toEqual(work);
    expect(loaded).not.toBe(work);
  });

  it("preserves required closeout gate metadata through writes and reads", async () => {
    const store = new InMemoryBorealStore();
    const work = createWorkItem({
      title: "Gate metadata storage",
      requiredCloseoutGates: [{ kind: "review" }, { kind: "audit", scope: "descendants" }],
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });

    await store.write((writer) => writer.putWorkItem(work));
    const loaded = await store.read((reader) => reader.getWorkItem(work.meta.id));

    expect(loaded?.requiredCloseoutGates).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^bw_gate_[a-f0-9]{16}$/),
        subjectId: work.meta.id,
        subjectType: "work",
        kind: "review",
        scope: "self",
        status: "open",
        requiredEvidenceKinds: ["review"],
        requiredOutcome: "passed",
        minEvidenceCount: 1
      }),
      expect.objectContaining({
        subjectId: work.meta.id,
        kind: "audit",
        scope: "descendants",
        requiredEvidenceKinds: ["review", "command", "artifact"]
      })
    ]);
    expect(loaded?.requiredCloseoutGates).not.toBe(work.requiredCloseoutGates);
  });

  it("preserves reviewer heartbeat checkpoints through writes and reads", async () => {
    const store = new InMemoryBorealStore();
    const now = nowIso(new Date("2026-01-01T00:00:00.000Z"));
    const heartbeat = withContentHash({
      meta: createRecordMeta({
        id: deterministicId<ReviewerHeartbeatId>("heartbeat", {
          name: "review-pass",
          reviewerId: "reviewer-a",
          containerId: null
        }),
        actor,
        now,
        tags: ["reviewer-heartbeat"]
      }),
      name: "review-pass",
      reviewerId: "reviewer-a",
      lastClosedAt: now,
      advancedAt: now
    });

    await store.write((writer) => writer.putReviewerHeartbeat(heartbeat));
    const loaded = await store.read(async (reader) => ({
      single: await reader.getReviewerHeartbeat(heartbeat.meta.id),
      all: await reader.listReviewerHeartbeats()
    }));

    expect(loaded.single).toEqual(heartbeat);
    expect(loaded.single).not.toBe(heartbeat);
    expect(loaded.all).toEqual([heartbeat]);
  });
});
