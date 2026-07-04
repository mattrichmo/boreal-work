import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRecordMeta, withContentHash, type ActorRef, type EventId, type RuntimeEvent } from "@boreal/core";
import { FileEventLog } from "@boreal/storage";

const actor: ActorRef = {
  id: "event-log-test",
  kind: "agent"
};

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("file event log", () => {
  it("appends chained entries with increasing seq", async () => {
    const dir = await makeTempDir();
    const log = new FileEventLog({ path: join(dir, "events.jsonl") });

    const a = await log.append("event", sampleEvent("bw_event_000000000001" as EventId));
    const b = await log.append("event", sampleEvent("bw_event_000000000002" as EventId));

    expect(a.seq).toBe(1);
    expect(b.seq).toBe(2);
    expect(b.prevHash).toBe(a.hash);
    expect((await log.verify()).ok).toBe(true);
  });

  it("detects a tampered entry", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "events.jsonl");
    const log = new FileEventLog({ path });
    await log.append("event", sampleEvent("bw_event_000000000001" as EventId));
    await log.append("event", sampleEvent("bw_event_000000000002" as EventId));
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    const tampered = JSON.parse(lines[0] ?? "{}") as { record: { type: string } };
    tampered.record.type = "forged";
    await writeFile(path, `${[JSON.stringify(tampered), lines[1]].join("\n")}\n`, "utf8");

    const result = await log.verify();

    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(1);
  });

  it("head() is cheap and correct after reopen", async () => {
    const dir = await makeTempDir();
    const path = join(dir, "events.jsonl");
    const log1 = new FileEventLog({ path });
    await log1.append("event", sampleEvent("bw_event_000000000001" as EventId));
    const log2 = new FileEventLog({ path });

    expect(await log2.head()).toEqual(expect.objectContaining({ seq: 1 }));
  });
});

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-event-log-"));
  tempDirs.push(dir);
  return dir;
}

function sampleEvent(id: EventId): RuntimeEvent {
  return withContentHash({
    meta: createRecordMeta({
      id,
      actor,
      now: "2026-01-01T00:00:00.000Z"
    }),
    type: "event.log.test",
    subjectId: id,
    subjectType: "workspace",
    payload: {}
  } satisfies RuntimeEvent);
}
