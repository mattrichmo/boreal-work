import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRecordMeta,
  resolveWorkspacePaths,
  withContentHash,
  type ActorRef,
  type EventId,
  type RuntimeEvent,
  type WorkId,
  type WorkItem
} from "@boreal/core";
import { FileEventLog, ObjectDirBorealStore, ObjectReadIndex, loadNodeSqlite, objectIndexPath } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "object-index-test",
  kind: "agent"
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("object store SQLite read index", () => {
  it("falls back without rebuilding when the event-log head is stale", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      expect(sqlite).toBeUndefined();
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await seedWorkItems(store);
    const log = new FileEventLog({ path: resolveWorkspacePaths(rootDir).eventLogFile });
    await log.append("event", sampleEvent("bw_event_000000000001" as EventId));

    const index = new ObjectReadIndex({ path: objectIndexPath(rootDir), sqlite });
    expect((await index.status(await log.head())).fresh).toBe(false);

    const reopened = new ObjectDirBorealStore({ rootDir, sqlite });
    const readyItems = await reopened.read((reader) => reader.listWorkItems({ status: "ready" }));

    expect(readyItems.map((item) => item.meta.id)).toEqual(["bw_work_000000000001"]);
    expect((await index.status(await log.head())).fresh).toBe(false);
  });

  it("serves filtered work item lists from a fresh index", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      expect(sqlite).toBeUndefined();
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await seedWorkItems(store);
    await rm(join(rootDir, ".boreal", "objects", "work", "bw_work_000000000001.json"), { force: true });

    const reopened = new ObjectDirBorealStore({ rootDir, sqlite });
    const readyItems = await reopened.read((reader) => reader.listWorkItems({ status: "ready" }));

    expect(readyItems.map((item) => item.meta.id)).toEqual(["bw_work_000000000001"]);
  });

  it("falls back to directory reads when node:sqlite is unavailable", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite: undefined });
    await seedWorkItems(store);

    const readyItems = await store.read((reader) => reader.listWorkItems({ status: "ready" }));

    expect(readyItems.map((item) => item.meta.id)).toEqual(["bw_work_000000000001"]);
    expect(existsSync(objectIndexPath(rootDir))).toBe(false);
  });
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-object-index-"));
  tempDirs.push(dir);
  return dir;
}

async function seedWorkItems(store: ObjectDirBorealStore): Promise<void> {
  await store.write(async (writer) => {
    await writer.putWorkItem({
      ...sampleWorkItem("bw_work_000000000001" as WorkId),
      status: "ready"
    });
    await writer.putWorkItem(sampleWorkItem("bw_work_000000000002" as WorkId));
  });
}

function sampleWorkItem(id: WorkId): WorkItem {
  const item = createWorkItem({
    title: `Indexed ${id}`,
    labels: ["object-index"],
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
    type: "object.indexed",
    subjectId: "bw_work_000000000001",
    subjectType: "work",
    payload: {}
  } satisfies RuntimeEvent);
}
