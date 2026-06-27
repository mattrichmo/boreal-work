import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BorealError, nowIso, type ActorRef } from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { recordEvidence } from "@boreal/evidence-engine";
import { createKnowledgeSource } from "@boreal/knowledge-engine";
import {
  FileBorealStore,
  breakStaleFileLock,
  inspectFileLock,
  inspectSQLiteCache,
  querySQLiteCacheRecords,
  rebuildSQLiteCache,
  withFileLock,
  type StoreSnapshot
} from "@boreal/storage";
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

  it("serializes a concurrent writer burst while recovering one stale lock", async () => {
    const rootDir = await makeTempWorkspace();
    const lockDir = join(rootDir, ".boreal/runtime/state.lock");
    await writeLockOwner(rootDir, new Date(Date.now() - 60_000).toISOString());

    const results = await Promise.all(
      Array.from({ length: 24 }, (_, index) => {
        const store = new FileBorealStore({
          rootDir,
          lock: {
            waitTimeoutMs: 2_000,
            staleAfterMs: 1,
            retryDelayMs: 5
          }
        });
        const work = createWorkItem({
          title: `Concurrent stale-lock recovery ${String(index).padStart(2, "0")}`,
          actor,
          now: nowIso(new Date(Date.UTC(2026, 0, 1, 0, 0, index)))
        });
        return store.write(async (writer) => {
          await writer.putWorkItem(work);
          return work.meta.id;
        });
      })
    );

    const store = new FileBorealStore({ rootDir, lock });
    const workItems = await store.read((reader) => reader.listWorkItems());

    expect(results).toHaveLength(24);
    expect(new Set(results).size).toBe(24);
    expect(workItems.map((work) => work.title).sort()).toEqual(
      Array.from({ length: 24 }, (_, index) => `Concurrent stale-lock recovery ${String(index).padStart(2, "0")}`)
    );
    await expect(inspectFileLock(lockDir)).resolves.toMatchObject({ exists: false });
    await expect(readFile(`${lockDir}.recovery/owner.json`, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
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

  it("heartbeats active long-running locks so stale recovery does not break them", async () => {
    const rootDir = await makeTempWorkspace();
    const lockDir = join(rootDir, ".boreal/runtime/state.lock");
    let insideHeartbeat: string | undefined;

    await withFileLock(
      lockDir,
      {
        waitTimeoutMs: 250,
        staleAfterMs: 30,
        retryDelayMs: 5
      },
      async () => {
        await sleep(90);
        const inspection = await inspectFileLock(lockDir, { staleAfterMs: 30 });
        insideHeartbeat = inspection.owner?.lastHeartbeatAt;
        expect(inspection).toMatchObject({ exists: true, stale: false });
        expect(inspection.owner?.lastHeartbeatAt).toBeDefined();
        await expect(breakStaleFileLock(lockDir, { waitTimeoutMs: 250, staleAfterMs: 30, retryDelayMs: 5 }))
          .rejects.toMatchObject({
            code: "BOREAL_CONFLICT"
          } satisfies Partial<BorealError>);
      }
    );

    expect(insideHeartbeat).toBeDefined();
    await expect(inspectFileLock(lockDir)).resolves.toMatchObject({ exists: false });
  });

  it("rejects state files outside the workspace root", async () => {
    const rootDir = await makeTempWorkspace();
    expect(() => new FileBorealStore({ rootDir, stateFile: join(rootDir, "../state.json") })).toThrow(BorealError);
  });

  it("rebuilds and queries a generated SQLite cache without replacing the file store", async () => {
    const rootDir = await makeTempWorkspace();
    const work = createWorkItem({
      title: "SQLite cached work",
      actor,
      now: nowIso(new Date("2026-01-01T00:00:00.000Z"))
    });
    const snapshot = { workItems: [work] };

    const first = await rebuildSQLiteCache({ rootDir, snapshot });
    if (first.skipped) {
      expect(first.sqliteAvailable).toBe(false);
      return;
    }

    const second = await rebuildSQLiteCache({ rootDir, snapshot });
    const inspection = await inspectSQLiteCache({ rootDir, expectedSnapshot: snapshot });
    const staleInspection = await inspectSQLiteCache({
      rootDir,
      expectedSnapshot: snapshot,
      expectedSourceContentHash: "sha256:stale"
    });
    const rows = await querySQLiteCacheRecords({ rootDir, section: "workItems" });
    const store = new FileBorealStore({ rootDir, lock });

    expect(first).toEqual(
      expect.objectContaining({
        rebuilt: true,
        skipped: false,
        recordCounts: expect.objectContaining({ workItems: 1 })
      })
    );
    expect(second.sourceContentHash).toBe(first.sourceContentHash);
    expect(inspection).toEqual(
      expect.objectContaining({
        ok: true,
        exists: true,
        stale: false,
        sourceContentHash: first.sourceContentHash,
        recordCounts: expect.objectContaining({ workItems: 1 })
      })
    );
    expect(staleInspection).toEqual(expect.objectContaining({ ok: false, exists: true, stale: true }));
    expect(rows).toEqual([
      expect.objectContaining({
        section: "workItems",
        id: work.meta.id,
        title: "SQLite cached work",
        status: "draft",
        kind: "task"
      })
    ]);
    await expect(store.read((reader) => reader.listWorkItems())).resolves.toHaveLength(0);
  });

  it("rebuilds a thousands-record SQLite cache with bounded query performance and drift detection", async () => {
    const rootDir = await makeTempWorkspace();
    const snapshot = largeCacheSnapshot();

    const rebuildStartedAt = performance.now();
    const rebuild = await rebuildSQLiteCache({ rootDir, snapshot });
    const rebuildMs = performance.now() - rebuildStartedAt;
    if (rebuild.skipped) {
      expect(rebuild.sqliteAvailable).toBe(false);
      return;
    }

    const secondRebuildStartedAt = performance.now();
    const secondRebuild = await rebuildSQLiteCache({ rootDir, snapshot });
    const secondRebuildMs = performance.now() - secondRebuildStartedAt;
    const queryStartedAt = performance.now();
    const rows = await querySQLiteCacheRecords({ rootDir, limit: 20_000 });
    const queryMs = performance.now() - queryStartedAt;
    const workRows = await querySQLiteCacheRecords({ rootDir, section: "workItems", limit: 50 });
    const sourceRows = await querySQLiteCacheRecords({ rootDir, section: "knowledgeSources", limit: 50 });
    const evidenceRows = await querySQLiteCacheRecords({ rootDir, section: "evidence", limit: 50 });
    const inspection = await inspectSQLiteCache({ rootDir, expectedSnapshot: snapshot });
    const staleInspection = await inspectSQLiteCache({
      rootDir,
      expectedSnapshot: {
        ...snapshot,
        workItems: snapshot.workItems?.slice(1)
      }
    });

    expect(rebuild.recordCounts).toEqual(
      expect.objectContaining({
        workItems: 1_500,
        knowledgeSources: 1_250,
        evidence: 1_500
      })
    );
    expect(secondRebuild.sourceContentHash).toBe(rebuild.sourceContentHash);
    expect(rows).toHaveLength(1_000);
    expect(workRows).toHaveLength(50);
    expect(sourceRows).toHaveLength(50);
    expect(evidenceRows).toHaveLength(50);
    expect(workRows.every((row) => row.section === "workItems")).toBe(true);
    expect(sourceRows.every((row) => row.section === "knowledgeSources")).toBe(true);
    expect(evidenceRows.every((row) => row.section === "evidence")).toBe(true);
    expect(inspection).toEqual(
      expect.objectContaining({
        ok: true,
        exists: true,
        stale: false,
        sourceContentHash: rebuild.sourceContentHash,
        recordCounts: expect.objectContaining({
          workItems: 1_500,
          knowledgeSources: 1_250,
          evidence: 1_500
        })
      })
    );
    expect(staleInspection).toEqual(
      expect.objectContaining({
        ok: false,
        exists: true,
        stale: true,
        recordCounts: expect.objectContaining({ workItems: 1_500 }),
        expectedRecordCounts: expect.objectContaining({ workItems: 1_499 })
      })
    );
    expect(rebuildMs).toBeLessThan(15_000);
    expect(secondRebuildMs).toBeLessThan(15_000);
    expect(queryMs).toBeLessThan(1_500);
  });

  it("inspects missing and corrupt SQLite cache states", async () => {
    const rootDir = await makeTempWorkspace();
    const snapshot = { workItems: [] };

    const missing = await inspectSQLiteCache({ rootDir, expectedSnapshot: snapshot });
    expect(missing).toEqual(
      expect.objectContaining({
        ok: true,
        exists: false,
        stale: false
      })
    );

    await mkdir(join(rootDir, ".boreal/cache"), { recursive: true });
    await writeFile(join(rootDir, ".boreal/cache/runtime-cache.sqlite"), "not a sqlite database", "utf8");
    const corrupt = await inspectSQLiteCache({ rootDir, expectedSnapshot: snapshot });

    expect(corrupt).toEqual(
      expect.objectContaining({
        ok: false,
        exists: true,
        stale: true,
        error: expect.any(String)
      })
    );
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

function largeCacheSnapshot(): StoreSnapshot {
  const workItems = Array.from({ length: 1_500 }, (_, index) =>
    createWorkItem({
      title: `SQLite volume work ${index}`,
      description: "Volume fixture for SQLite cache rebuild hardening.",
      labels: ["sqlite-volume"],
      nonce: index,
      actor,
      now: nowIso(new Date(Date.UTC(2026, 0, 1, 0, 0, 0, index)))
    })
  );
  const knowledgeSources = Array.from({ length: 1_250 }, (_, index) =>
    createKnowledgeSource({
      kind: index % 2 === 0 ? "document" : "code",
      title: `SQLite volume source ${index}`,
      uri: `file://sqlite-volume/source-${index}.md`,
      summary: "Source fixture for SQLite cache rebuild hardening.",
      actor,
      now: nowIso(new Date(Date.UTC(2026, 0, 1, 1, 0, 0, index)))
    })
  );
  const evidence = Array.from({ length: 1_500 }, (_, index) =>
    recordEvidence({
      subjectId: workItems[index % workItems.length]?.meta.id ?? "missing",
      subjectType: "work",
      kind: index % 3 === 0 ? "command" : "artifact",
      summary: `SQLite volume evidence ${index}`,
      outcome: index % 2 === 0 ? "passed" : "observed",
      command: index % 3 === 0 ? `pnpm test --filter ${index}` : undefined,
      uri: index % 3 === 0 ? undefined : `file://sqlite-volume/evidence-${index}.md`,
      actor,
      now: nowIso(new Date(Date.UTC(2026, 0, 1, 2, 0, 0, index))),
      observedAt: nowIso(new Date(Date.UTC(2026, 0, 1, 2, 0, 0, index)))
    })
  );

  return {
    workItems,
    knowledgeSources,
    evidence
  };
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
    operations: [],
    projections: [],
    contextPacks: [],
    ...overrides
  };
}
