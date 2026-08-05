import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import {
  FileEventLog,
  ObjectDirBorealStore,
  ObjectReadIndex,
  loadNodeSqlite,
  objectIndexPath,
  objectIndexWorkItemsFingerprint,
  type StoreSnapshot
} from "@boreal/storage";
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

  it("rebuilds a missing cache from canonical objects before stamping an audit-only head", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await seedWorkItems(store);
    await rm(objectIndexPath(rootDir), { force: true });

    await store.write((writer) => writer.putEvent(sampleEvent("bw_event_000000000002" as EventId)));

    const readyItems = await new ObjectDirBorealStore({ rootDir, sqlite }).read((reader) =>
      reader.listWorkItems({ status: "ready" })
    );
    const log = new FileEventLog({ path: resolveWorkspacePaths(rootDir).eventLogFile });
    expect(readyItems.map((item) => item.meta.id)).toEqual(["bw_work_000000000001"]);
    expect((await new ObjectReadIndex({ path: objectIndexPath(rootDir), sqlite }).status(await log.head())).fresh).toBe(true);
  });

  it("does not let a fresh index hide a deleted canonical work object", async () => {
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

    expect(readyItems.map((item) => item.meta.id)).toEqual([]);
  });

  it("does not let a fresh index hide an added canonical work object", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      expect(sqlite).toBeUndefined();
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await seedWorkItems(store);
    const added = { ...sampleWorkItem("bw_work_000000000003" as WorkId), status: "ready" as const };
    await writeFile(
      join(rootDir, ".boreal", "objects", "work", `${added.meta.id}.json`),
      `${JSON.stringify(added)}\n`,
      "utf8"
    );

    const reopened = new ObjectDirBorealStore({ rootDir, sqlite });
    const readyItems = await reopened.read((reader) => reader.listWorkItems({ status: "ready" }));

    expect(readyItems.map((item) => item.meta.id)).toEqual(["bw_work_000000000001", "bw_work_000000000003"]);
  });

  it("does not let a fresh index hide a modified canonical work object", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      expect(sqlite).toBeUndefined();
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await seedWorkItems(store);
    const path = join(rootDir, ".boreal", "objects", "work", "bw_work_000000000001.json");
    const canonical = JSON.parse(await readFile(path, "utf8")) as WorkItem;
    await writeFile(path, `${JSON.stringify({ ...canonical, status: "blocked" })}\n`, "utf8");

    const reopened = new ObjectDirBorealStore({ rootDir, sqlite });
    const readyItems = await reopened.read((reader) => reader.listWorkItems({ status: "ready" }));

    expect(readyItems.map((item) => item.meta.id)).toEqual([]);
  });

  it("isolates the v2 cache from a legacy unversioned v1 database", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      return;
    }
    const rootDir = await makeTempWorkspace();
    const legacyPath = join(rootDir, ".boreal", "cache", "index.sqlite");
    await mkdir(join(rootDir, ".boreal", "cache"), { recursive: true });
    const legacy = new sqlite.DatabaseSync(legacyPath);
    legacy.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
    legacy.prepare("INSERT INTO metadata(key, value) VALUES ('schemaVersion', 'boreal.object-index.v1');").run();
    legacy.exec("CREATE TABLE sentinel (value TEXT NOT NULL);");
    legacy.prepare("INSERT INTO sentinel(value) VALUES ('preserve-me');").run();
    legacy.close();
    const before = await readFile(legacyPath);

    await seedWorkItems(new ObjectDirBorealStore({ rootDir, sqlite }));

    expect(objectIndexPath(rootDir)).not.toBe(legacyPath);
    expect(existsSync(objectIndexPath(rootDir))).toBe(true);
    expect((await readFile(legacyPath)).equals(before)).toBe(true);
  });

  it.each(["boreal.object-index.v1", "boreal.object-index.v99"])(
    "preserves incompatible schema %s instead of resetting or invalidating it",
    async (schemaVersion) => {
      const sqlite = await loadNodeSqlite();
      if (!sqlite) {
        return;
      }
      const rootDir = await makeTempWorkspace();
      const path = objectIndexPath(rootDir);
      await mkdir(join(rootDir, ".boreal", "cache"), { recursive: true });
      const incompatible = new sqlite.DatabaseSync(path);
      incompatible.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
      incompatible.prepare("INSERT INTO metadata(key, value) VALUES ('schemaVersion', ?);").run(schemaVersion);
      incompatible.exec("CREATE TABLE sentinel (value TEXT NOT NULL);");
      incompatible.prepare("INSERT INTO sentinel(value) VALUES ('preserve-me');").run();
      incompatible.close();
      const before = await readFile(path);
      const index = new ObjectReadIndex({ path, sqlite });
      const snapshot = await new ObjectDirBorealStore({ rootDir, sqlite: undefined }).snapshot();
      const head = { seq: 0, hash: "sha256:unknown-schema-test" };

      await expect(index.rebuild(snapshot, head)).rejects.toMatchObject({ code: "BOREAL_OBJECT_INDEX_INCOMPATIBLE" });
      await expect(index.applyChanges([], head, undefined, objectIndexWorkItemsFingerprint([]))).rejects.toMatchObject({
        code: "BOREAL_OBJECT_INDEX_INCOMPATIBLE"
      });
      await expect(index.invalidate()).rejects.toMatchObject({ code: "BOREAL_OBJECT_INDEX_INCOMPATIBLE" });

      expect((await readFile(path)).equals(before)).toBe(true);
      const verification = new sqlite.DatabaseSync(path, { readOnly: true });
      expect((verification.prepare("SELECT value FROM sentinel;").get() as { value: string }).value).toBe("preserve-me");
      verification.close();
    }
  );

  it("keeps the prior index intact when a staged rebuild fails", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await seedWorkItems(store);
    const path = objectIndexPath(rootDir);
    const before = await readFile(path);
    const snapshot = await store.snapshot();
    const failingWorkItems = {
      *[Symbol.iterator]() {
        yield snapshot.workItems[0];
        throw new Error("injected staged rebuild failure");
      }
    } as unknown as StoreSnapshot["workItems"];
    const failingSnapshot = { ...snapshot, workItems: failingWorkItems };
    const head = await new FileEventLog({ path: resolveWorkspacePaths(rootDir).eventLogFile }).head();

    await expect(new ObjectReadIndex({ path, sqlite }).rebuild(failingSnapshot, head)).rejects.toThrow(
      "injected staged rebuild failure"
    );

    expect((await readFile(path)).equals(before)).toBe(true);
    expect((await readdir(join(rootDir, ".boreal", "cache"))).some((entry) => entry.includes(".tmp"))).toBe(false);
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
