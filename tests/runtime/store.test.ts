import { describe, expect, it } from "vitest";

import { nowIso, type ActorRef } from "@boreal/core";
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
});

