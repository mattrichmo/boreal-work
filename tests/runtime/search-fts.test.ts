import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { type ActorRef } from "@boreal/core";
import { FileEventLog, FtsSearchIndex, ObjectDirBorealStore, loadNodeSqlite, type FtsDocumentInput } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "search-fts-test",
  kind: "agent",
  displayName: "Search FTS Test"
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("FTS search index", () => {
  it("indexes and ranks by BM25 field weights", async () => {
    const fts = await openFts();
    if (!fts) {
      expect(fts).toBeUndefined();
      return;
    }
    try {
      fts.upsert([
        doc("bw_work_a", "work", "parser crash on empty input", "fix parser crash", "parser crash"),
        doc("bw_work_b", "work", "docs update", "mentions parser once in body", "parser")
      ]);

      const results = fts.query("parser crash");

      expect(results[0]?.recordId).toBe("bw_work_a");
      expect(results[0]?.snippet).toContain("[parser]");
    } finally {
      fts.close();
    }
  });

  it("matches prefixes on the final query token", async () => {
    const fts = await openFts();
    if (!fts) {
      expect(fts).toBeUndefined();
      return;
    }
    try {
      fts.upsert([doc("bw_work_a", "work", "parser crash", "empty input", "parser")]);

      expect(fts.query("pars")[0]?.recordId).toBe("bw_work_a");
    } finally {
      fts.close();
    }
  });

  it("upsert replaces prior docs for the same record id", async () => {
    const fts = await openFts();
    if (!fts) {
      expect(fts).toBeUndefined();
      return;
    }
    try {
      fts.upsert([doc("bw_work_a", "work", "parser crash", "empty input", "parser")]);
      fts.upsert([doc("bw_work_a", "work", "render crash", "canvas failure", "render canvas")]);

      expect(fts.count()).toBe(1);
      expect(fts.query("parser")).toEqual([]);
      expect(fts.query("render")[0]?.recordId).toBe("bw_work_a");
    } finally {
      fts.close();
    }
  });

  it("returns undefined when sqlite is unavailable", async () => {
    const rootDir = await makeTempWorkspace();

    await expect(FtsSearchIndex.open(rootDir, { sqlite: undefined })).resolves.toBeUndefined();
  });

  it("is populated by object-index writes and tracks the event-log head", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      expect(sqlite).toBeUndefined();
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await store.write((writer) =>
      writer.putWorkItem(
        createWorkItem({
          title: "Parser crash on empty input",
          description: "Fix parser crash in the object index.",
          labels: ["parser"],
          actor,
          now: "2026-01-01T00:00:00.000Z"
        })
      )
    );

    const fts = await FtsSearchIndex.open(rootDir, { sqlite });
    expect(fts).toBeDefined();
    if (!fts) {
      return;
    }
    try {
      const head = await new FileEventLog({ path: join(rootDir, ".boreal", "log", "events.jsonl") }).head();

      expect(fts.status(head)).toMatchObject({ fresh: true, documentCount: 1, recordCount: 1 });
      expect(fts.query("parser crash")[0]?.type).toBe("work");
    } finally {
      fts.close();
    }
  });
});

async function openFts(): Promise<FtsSearchIndex | undefined> {
  return FtsSearchIndex.open(await makeTempWorkspace());
}

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-search-fts-"));
  tempDirs.push(dir);
  return dir;
}

function doc(recordId: string, type: FtsDocumentInput["type"], title: string, summary: string, bodyText: string): FtsDocumentInput {
  return {
    recordId,
    type,
    title,
    summary,
    idText: recordId,
    labelText: "",
    bodyText,
    stateText: type
  };
}
