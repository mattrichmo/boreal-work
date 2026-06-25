import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { nowIso, type ActorRef } from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { FileBorealStore } from "@boreal/storage";
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
  it("persists runtime state across store instances", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new FileBorealStore({ rootDir });
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
    const store = new FileBorealStore({ rootDir });
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
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-work-"));
  tempDirs.push(dir);
  return dir;
}

