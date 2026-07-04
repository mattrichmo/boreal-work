import { existsSync, statSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRecordMeta,
  withContentHash,
  type ActorRef,
  type EventId,
  type RuntimeEvent,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import { ObjectDirBorealStore } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "object-store-test",
  kind: "agent"
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("object directory store", () => {
  it("round-trips records as one file per record", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir });

    await store.write(async (writer) => {
      await writer.putWorkItem(sampleWorkItem("bw_work_00000000000a" as WorkId));
      await writer.putWorkItem(sampleWorkItem("bw_work_00000000000b" as WorkId));
    });

    expect(existsSync(join(rootDir, ".boreal", "objects", "work", "bw_work_00000000000a.json"))).toBe(true);
    expect(existsSync(join(rootDir, ".boreal", "objects", "work", "bw_work_00000000000b.json"))).toBe(true);
    const raw = await readFile(join(rootDir, ".boreal", "objects", "work", "bw_work_00000000000a.json"), "utf8");
    expect(raw.startsWith('{"meta"')).toBe(true);
    expect(raw.endsWith("\n")).toBe(true);

    const reopened = new ObjectDirBorealStore({ rootDir });
    await reopened.read(async (reader) => {
      expect(await reader.listWorkItems()).toHaveLength(2);
    });
  });

  it("a write touches only mutated record files", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir });
    await store.write(async (writer) => {
      await writer.putWorkItem(sampleWorkItem("bw_work_00000000000a" as WorkId));
      await writer.putWorkItem(sampleWorkItem("bw_work_00000000000b" as WorkId));
    });
    const aPath = join(rootDir, ".boreal", "objects", "work", "bw_work_00000000000a.json");
    const before = statSync(aPath).mtimeMs;

    await store.write(async (writer) =>
      writer.putWorkItem({
        ...sampleWorkItem("bw_work_00000000000b" as WorkId),
        title: "changed"
      })
    );

    expect(statSync(aPath).mtimeMs).toBe(before);
  });

  it("delete removes the record file", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir });
    const path = join(rootDir, ".boreal", "objects", "work", "bw_work_00000000000a.json");
    await store.write((writer) => writer.putWorkItem(sampleWorkItem("bw_work_00000000000a" as WorkId)));

    await store.write((writer) => writer.deleteWorkItem("bw_work_00000000000a" as WorkId));

    expect(existsSync(path)).toBe(false);
  });

  it("rejects ids that escape the objects dir", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir });

    await expect(store.write((writer) => writer.putWorkItem(sampleWorkItem("../../evil" as WorkId)))).rejects.toThrow();
  });

  it("routes events through the hash-chained event log", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir });
    const event = sampleEvent("bw_event_000000000001" as EventId);

    await store.write((writer) => writer.putEvent(event));

    expect(existsSync(join(rootDir, ".boreal", "objects", "events", event.meta.id))).toBe(false);
    expect(existsSync(join(rootDir, ".boreal", "log", "events.jsonl"))).toBe(true);
    await new ObjectDirBorealStore({ rootDir }).read(async (reader) => {
      expect(await reader.headSeq()).toBe(1);
      expect(await reader.listEvents()).toEqual([event]);
    });
  });
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-object-store-"));
  tempDirs.push(dir);
  return dir;
}

function sampleWorkItem(id: WorkId): WorkItem {
  const item = createWorkItem({
    title: `Sample ${id}`,
    labels: ["object-store"],
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

function sampleEvent(id: EventId): RuntimeEvent {
  return withContentHash({
    meta: createRecordMeta({
      id,
      now: "2026-01-01T00:00:00.000Z",
      actor,
      tags: ["event"]
    }),
    type: "object.tested",
    subjectId: "bw_work_00000000000a",
    subjectType: "work",
    payload: {}
  } satisfies RuntimeEvent);
}
