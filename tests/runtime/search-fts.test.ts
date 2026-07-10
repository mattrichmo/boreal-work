import { mkdir, mkdtemp, rm, stat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createRecordMeta,
  withContentHash,
  type ActorRef,
  type EventId,
  type RuntimeEvent
} from "@boreal/core";
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

  it("uses partial OR semantics for every query token", async () => {
    const fts = await openFts();
    if (!fts) {
      return;
    }
    try {
      fts.upsert([doc("bw_work_a", "work", "parser recovery", "handles input safely", "parser")]);

      const results = fts.query("pars missing-term");

      expect(results[0]?.recordId).toBe("bw_work_a");
      expect(results[0]?.matches).toEqual(["pars"]);
      expect(results[0]?.snippet).toContain("[parser]");
    } finally {
      fts.close();
    }
  });

  it("rejects an invalid type filter instead of broadening the query", async () => {
    const fts = await openFts();
    if (!fts) {
      return;
    }
    try {
      fts.upsert([doc("bw_work_a", "work", "parser recovery", "handles input safely", "parser")]);

      expect(fts.query("parser", { types: ["not_a_type"] })).toEqual([]);
    } finally {
      fts.close();
    }
  });

  it("returns subject identity and a snippet from the matching field", async () => {
    const fts = await openFts();
    if (!fts) {
      return;
    }
    try {
      fts.upsert([{ ...doc("bw_summary_a", "agent_summary", "parser handoff", "safe closeout", "unrelated"), subjectId: "bw_work_a" }]);

      const result = fts.query("parser")[0];

      expect(result?.subjectId).toBe("bw_work_a");
      expect(result?.snippet).toContain("[parser]");
      expect(result?.snippet).not.toContain("unrelated");
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

  it("rejects a symlinked cache escape on read-only open", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      return;
    }
    const rootDir = await makeTempWorkspace();
    const outsideDir = await makeTempWorkspace();
    await mkdir(join(rootDir, ".boreal"), { recursive: true });
    await symlink(outsideDir, join(rootDir, ".boreal", "cache"), "dir");

    await expect(FtsSearchIndex.open(rootDir, { sqlite, create: false })).rejects.toThrow("Path escapes Boreal workspace");
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

      expect(fts.status(head)).toMatchObject({
        fresh: true,
        integrityValid: true,
        documentCount: 1,
        recordCount: 1,
        mismatchedCount: 0
      });
      expect(fts.query("parser crash")[0]?.type).toBe("work");
    } finally {
      fts.close();
    }
  });

  it("stays search-fresh when only an unrelated audit event advances the shared log", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await store.write((writer) =>
      writer.putWorkItem(
        createWorkItem({
          title: "Stable search corpus",
          description: "Audit-only events must not invalidate searchable content.",
          labels: ["freshness"],
          actor,
          now: "2026-01-01T00:00:00.000Z"
        })
      )
    );
    const log = new FileEventLog({ path: join(rootDir, ".boreal", "log", "events.jsonl") });
    const fts = await FtsSearchIndex.open(rootDir, { sqlite, create: false });
    expect(fts).toBeDefined();
    if (!fts) {
      return;
    }
    try {
      const initialHead = await log.head();
      const fingerprint = fts.status(initialHead).corpusFingerprint;

      await log.append("event", auditOnlyEvent());
      const advancedHead = await log.head();

      expect(fts.status(advancedHead).fresh).toBe(false);
      expect(fts.status(advancedHead, fingerprint)).toMatchObject({
        fresh: true,
        corpusFingerprint: fingerprint
      });
    } finally {
      fts.close();
    }
  });

  it("does not modify an existing index during read-only open and query", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await store.write((writer) =>
      writer.putWorkItem(
        createWorkItem({
          title: "Read-only parser search",
          description: "The query must not write SQLite.",
          labels: ["read-only"],
          actor,
          now: "2026-01-01T00:00:00.000Z"
        })
      )
    );
    const path = join(rootDir, ".boreal", "cache", "index.sqlite");
    const before = await stat(path);

    const fts = await FtsSearchIndex.open(rootDir, { sqlite, create: false });
    expect(fts?.query("parser")[0]?.type).toBe("work");
    fts?.close();

    const after = await stat(path);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
  });

  it("marks equal-count indexes stale when canonical content hashes diverge", async () => {
    const sqlite = await loadNodeSqlite();
    if (!sqlite) {
      return;
    }
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir, sqlite });
    await store.write((writer) =>
      writer.putWorkItem(
        createWorkItem({
          title: "Content-bound search row",
          description: "Detect equal-count drift.",
          labels: ["integrity"],
          actor,
          now: "2026-01-01T00:00:00.000Z"
        })
      )
    );
    const path = join(rootDir, ".boreal", "cache", "index.sqlite");
    const db = new sqlite.DatabaseSync(path);
    db.prepare("UPDATE records SET content_hash = 'sha256:tampered';").run();
    db.close();

    const fts = await FtsSearchIndex.open(rootDir, { sqlite, create: false });
    expect(fts).toBeDefined();
    if (!fts) {
      return;
    }
    try {
      const head = await new FileEventLog({ path: join(rootDir, ".boreal", "log", "events.jsonl") }).head();
      expect(fts.status(head)).toMatchObject({ fresh: false, documentCount: 1, recordCount: 1 });
      expect(fts.status(head).mismatchedCount).toBeGreaterThan(0);
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
    contentHash: `sha256:${recordId}`,
    title,
    summary,
    idText: recordId,
    labelText: "",
    bodyText,
    stateText: type
  };
}

function auditOnlyEvent(): RuntimeEvent {
  return withContentHash({
    meta: createRecordMeta({
      id: "bw_event_000000000001" as EventId,
      now: "2026-01-01T00:00:01.000Z",
      actor,
      tags: ["audit"]
    }),
    type: "install.skills_checked",
    subjectId: "fixture",
    subjectType: "workspace",
    payload: {}
  } satisfies RuntimeEvent);
}
