import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BorealError, nowIso, type ActorRef } from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { FileBorealStore, breakStaleFileLock, inspectFileLock } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "file-store-test",
  kind: "agent"
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file-backed store", () => {
  const lock = {
    waitTimeoutMs: 250,
    staleAfterMs: 2_000,
    retryDelayMs: 5
  };

  it("persists runtime state across store instances", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new FileBorealStore({ rootDir, lock });
    const runtime = createBorealRuntime({ store, actor });

    const work = await runtime.createWork({
      title: "Persist runtime state",
      description: "State survives a new store instance."
    });

    const secondRuntime = createBorealRuntime({
      store: new FileBorealStore({ rootDir }),
      actor
    });
    await expect(secondRuntime.getWorkView(work.meta.id)).resolves.toMatchObject({
      id: work.meta.id,
      title: "Persist runtime state"
    });

    const state = JSON.parse(await readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8")) as {
      schemaVersion: string;
      workItems: unknown[];
    };
    expect(state.schemaVersion).toBe("boreal.file-store.v1");
    expect(state.workItems).toHaveLength(1);
  });

  it("does not persist failed transactions", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new FileBorealStore({ rootDir, lock });
    const work = createWorkItem({
      title: "Do not persist aborted transaction",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });

    await expect(
      store.write(async (writer) => {
        await writer.putWorkItem(work);
        throw new Error("abort file write");
      })
    ).rejects.toThrow("abort file write");

    await expect(store.read((reader) => reader.listWorkItems())).resolves.toHaveLength(0);
    await expect(readFile(join(rootDir, ".boreal/runtime/state.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("serializes writes from separate store instances without losing updates", async () => {
    const rootDir = await makeTempWorkspace();
    const storeA = new FileBorealStore({ rootDir, lock });
    const storeB = new FileBorealStore({ rootDir, lock });
    const workA = createWorkItem({
      title: "Concurrent write A",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });
    const workB = createWorkItem({
      title: "Concurrent write B",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:01.000Z"))
    });

    await Promise.all([
      storeA.write(async (writer) => {
        await writer.putWorkItem(workA);
        await sleep(50);
      }),
      storeB.write((writer) => writer.putWorkItem(workB))
    ]);

    const titles = await storeA.read(async (reader) =>
      (await reader.listWorkItems()).map((work) => work.title).sort()
    );
    expect(titles).toEqual(["Concurrent write A", "Concurrent write B"]);
  });

  it("rejects active locks with a structured conflict error", async () => {
    const rootDir = await makeTempWorkspace();
    await writeLockOwner(rootDir, new Date().toISOString());
    const store = new FileBorealStore({
      rootDir,
      lock: {
        waitTimeoutMs: 25,
        staleAfterMs: 30_000,
        retryDelayMs: 5
      }
    });
    const work = createWorkItem({
      title: "Blocked by active lock",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });

    await expect(store.write((writer) => writer.putWorkItem(work))).rejects.toMatchObject({
      code: "BOREAL_CONFLICT"
    } satisfies Partial<BorealError>);
  });

  it("breaks stale locks and releases its own lock after writing", async () => {
    const rootDir = await makeTempWorkspace();
    await writeLockOwner(rootDir, new Date(Date.now() - 60_000).toISOString());
    const store = new FileBorealStore({
      rootDir,
      lock: {
        waitTimeoutMs: 250,
        staleAfterMs: 1,
        retryDelayMs: 5
      }
    });
    const work = createWorkItem({
      title: "Recover from stale lock",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });

    await store.write((writer) => writer.putWorkItem(work));
    await expect(store.read((reader) => reader.listWorkItems())).resolves.toHaveLength(1);
    await expect(readFile(join(rootDir, ".boreal/runtime/state.lock/owner.json"), "utf8")).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("coordinates explicit concurrent stale lock breakers", async () => {
    const rootDir = await makeTempWorkspace();
    const lockDir = join(rootDir, ".boreal/runtime/state.lock");
    await writeLockOwner(rootDir, new Date(Date.now() - 60_000).toISOString());

    const results = await Promise.all([
      breakStaleFileLock(lockDir, { waitTimeoutMs: 250, staleAfterMs: 1, retryDelayMs: 5 }),
      breakStaleFileLock(lockDir, { waitTimeoutMs: 250, staleAfterMs: 1, retryDelayMs: 5 })
    ]);

    expect(results.filter((result) => result.removed)).toHaveLength(1);
    await expect(inspectFileLock(lockDir)).resolves.toMatchObject({ exists: false });
    await expect(readFile(`${lockDir}.recovery/owner.json`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("refuses to explicitly break active locks", async () => {
    const rootDir = await makeTempWorkspace();
    const lockDir = join(rootDir, ".boreal/runtime/state.lock");
    await writeLockOwner(rootDir, new Date().toISOString());

    await expect(
      breakStaleFileLock(lockDir, { waitTimeoutMs: 250, staleAfterMs: 30_000, retryDelayMs: 5 })
    ).rejects.toMatchObject({
      code: "BOREAL_CONFLICT"
    } satisfies Partial<BorealError>);
    await expect(inspectFileLock(lockDir, { staleAfterMs: 30_000 })).resolves.toMatchObject({ exists: true, stale: false });
  });

  it("rejects state files outside the workspace root", async () => {
    const rootDir = await makeTempWorkspace();
    expect(() => new FileBorealStore({ rootDir, stateFile: join(rootDir, "../state.json") })).toThrow(BorealError);
  });

  it("rejects symlinked runtime paths outside the workspace root", async () => {
    const rootDir = await makeTempWorkspace();
    const outsideDir = await makeTempWorkspace();
    await symlink(outsideDir, join(rootDir, ".boreal"), "dir");
    const store = new FileBorealStore({ rootDir, lock });
    const work = createWorkItem({
      title: "Reject symlinked state path",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });

    await expect(store.write((writer) => writer.putWorkItem(work))).rejects.toMatchObject({
      code: "BOREAL_INVALID_INPUT"
    } satisfies Partial<BorealError>);
    await expect(readFile(join(outsideDir, "runtime/state.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects invalid lock timing options", async () => {
    const rootDir = await makeTempWorkspace();
    expect(() => new FileBorealStore({ rootDir, lock: { waitTimeoutMs: 0 } })).toThrow(BorealError);
  });

  it("rejects invalid JSON and unsupported state versions", async () => {
    const rootDir = await makeTempWorkspace();
    const statePath = join(rootDir, ".boreal/runtime/state.json");
    await mkdir(join(rootDir, ".boreal/runtime"), { recursive: true });
    await writeFile(statePath, "{", "utf8");

    const invalidJsonStore = new FileBorealStore({ rootDir, lock });
    await expect(invalidJsonStore.read((reader) => reader.listWorkItems())).rejects.toMatchObject({
      code: "BOREAL_JSON_PARSE"
    } satisfies Partial<BorealError>);

    await writeFile(statePath, JSON.stringify({ schemaVersion: "boreal.file-store.v999" }), "utf8");
    const futureSchemaStore = new FileBorealStore({ rootDir, lock });
    await expect(futureSchemaStore.read((reader) => reader.listWorkItems())).rejects.toMatchObject({
      code: "BOREAL_STORAGE_ERROR"
    } satisfies Partial<BorealError>);

    await writeFile(
      statePath,
      JSON.stringify(
        emptyStateDocument({
          workItems: [
            {
              meta: {
                id: "bw_work_deadbeefdead",
                schemaVersion: "boreal.runtime.v1",
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
                createdBy: {},
                updatedBy: {},
                sourceRefs: [],
                tags: []
              },
              kind: "task",
              title: "Malformed status",
              description: "",
              status: "not_ready",
              priority: "normal",
              acceptanceCriteria: [],
              labels: [],
              dependencyIds: [],
              evidenceIds: [],
              verificationIds: []
            }
          ]
        })
      ),
      "utf8"
    );
    const invalidSchemaStore = new FileBorealStore({ rootDir, lock });
    await expect(invalidSchemaStore.read((reader) => reader.listWorkItems())).rejects.toMatchObject({
      code: "BOREAL_STORAGE_ERROR",
      details: expect.objectContaining({ issueCount: expect.any(Number) })
    } satisfies Partial<BorealError>);
  });
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-work-"));
  tempDirs.push(dir);
  return dir;
}

async function writeLockOwner(rootDir: string, createdAt: string): Promise<void> {
  const lockDir = join(rootDir, ".boreal/runtime/state.lock");
  await mkdir(lockDir, { recursive: true });
  await writeFile(
    join(lockDir, "owner.json"),
    JSON.stringify(
      {
        token: "external-lock",
        pid: 999_999,
        hostname: "test-host",
        createdAt
      },
      null,
      2
    ),
    "utf8"
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emptyStateDocument(overrides: Record<string, readonly unknown[]> = {}): Record<string, unknown> {
  return {
    schemaVersion: "boreal.file-store.v1",
    workItems: [],
    evidence: [],
    verifications: [],
    knowledgeSources: [],
    claims: [],
    decisions: [],
    graphEdges: [],
    reservations: [],
    events: [],
    projections: [],
    contextPacks: [],
    ...overrides
  };
}
