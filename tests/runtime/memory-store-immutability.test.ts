import { describe, expect, it } from "vitest";

import type { ActorRef, WorkId, WorkItem } from "@boreal/core";
import { InMemoryBorealStore } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "memory-store-test",
  kind: "agent"
};

describe("memory store immutability", () => {
  it("returns frozen records from reads without cloning per call", async () => {
    const store = new InMemoryBorealStore({ workItems: [sampleWorkItem("bw_work_a" as WorkId)] });

    await store.read(async (reader) => {
      const [a] = await reader.listWorkItems();
      const [b] = await reader.listWorkItems();
      expect(Object.isFrozen(a)).toBe(true);
      expect(Object.isFrozen(a?.labels)).toBe(true);
      expect(a).toBe(b);
    });
  });

  it("does not let a put alias caller-owned mutable data", async () => {
    const store = new InMemoryBorealStore();
    const item = sampleWorkItem("bw_work_b" as WorkId);
    await store.write((writer) => writer.putWorkItem(item));
    (item as { title: string }).title = "mutated after put";

    await store.read(async (reader) => {
      const got = await reader.getWorkItem("bw_work_b" as WorkId);
      expect(got?.title).not.toBe("mutated after put");
    });
  });
});

function sampleWorkItem(id: WorkId): WorkItem {
  const item = createWorkItem({
    title: `Sample ${id}`,
    labels: ["immutability"],
    actor,
    now: "2026-01-01T00:00:00.000Z"
  });
  return {
    ...item,
    meta: {
      ...item.meta,
      id
    }
  };
}
