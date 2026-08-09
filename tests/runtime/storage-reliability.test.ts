import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createRecordMeta, withContentHash, type EventId, type RuntimeEvent } from "@boreal/core";
import {
  EventLogCorruptionError,
  FileBorealStore,
  FileEventLog,
  LockHeartbeatError,
  ObjectDirBorealStore,
  RecoveryRequiredError,
  createTransactionJournal,
  transactionDirectory,
  withFileLock
} from "@boreal/storage";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("storage reliability boundaries", () => {
  it("recovers a pending object-store transaction before a read", async () => {
    const rootDir = await makeTempDir("boreal-storage-object-recovery-");
    const event = sampleEvent();

    const transaction = await createTransactionJournal({
      rootDir,
      storeKind: "object",
      changes: [],
      pendingLogRecords: [{ kind: "event", record: event }]
    });

    const events = await new ObjectDirBorealStore({ rootDir }).read((reader) => reader.listEvents());

    expect(events).toEqual([event]);
    await expect(readFile(transaction.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("recovers a pending file-store transaction before a snapshot", async () => {
    const rootDir = await makeTempDir("boreal-storage-file-recovery-");
    const event = sampleEvent();

    const transaction = await createTransactionJournal({
      rootDir,
      storeKind: "file",
      snapshot: {},
      pendingLogRecords: [{ kind: "event", record: event }]
    });

    const snapshot = await new FileBorealStore({ rootDir }).snapshot();

    expect(snapshot.events).toEqual([event]);
    await expect(readFile(transaction.path, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed with a typed error when a transaction journal is malformed", async () => {
    const rootDir = await makeTempDir("boreal-storage-journal-error-");
    const directory = transactionDirectory(rootDir);
    const path = join(directory, "tx_broken.json");
    await mkdir(directory, { recursive: true });
    await writeFile(path, "{\"schemaVersion\":", "utf8");

    const error = await captureError(() => new FileBorealStore({ rootDir }).read((reader) => reader.listWorkItems()));
    expect(error).toBeInstanceOf(RecoveryRequiredError);
    expect(error).toMatchObject({
      code: "BOREAL_STORAGE_ERROR",
      details: expect.objectContaining({ recoveryRequired: true, reason: "journal_parse_error" })
    });
  });

  it("reports malformed and torn event-log records instead of dropping them", async () => {
    const malformedRoot = await makeTempDir("boreal-storage-log-malformed-");
    const malformedPath = join(malformedRoot, "events.jsonl");
    const malformedLog = new FileEventLog({ path: malformedPath });
    const entry = await malformedLog.append("event", sampleEvent());
    await writeFile(malformedPath, `${JSON.stringify(entry)}\nnot-json\n`, "utf8");

    const malformedError = await captureError(() => malformedLog.readAll());
    expect(malformedError).toBeInstanceOf(EventLogCorruptionError);
    expect(malformedError).toMatchObject({
      reason: "malformed_record",
      details: expect.objectContaining({ line: 2 })
    });

    const tornRoot = await makeTempDir("boreal-storage-log-torn-");
    const tornPath = join(tornRoot, "events.jsonl");
    const tornLog = new FileEventLog({ path: tornPath });
    const tornEntry = await tornLog.append("event", sampleEvent());
    await writeFile(tornPath, `${JSON.stringify(tornEntry)}\n{\"seq\":2`, "utf8");

    const tornError = await captureError(() => tornLog.readAll());
    expect(tornError).toBeInstanceOf(EventLogCorruptionError);
    expect(tornError).toMatchObject({ reason: "torn_final_record" });
    await expect(tornLog.verify()).resolves.toMatchObject({
      ok: false,
      diagnostics: [expect.stringContaining("torn")]
    });
  });

  it("fails closed when lock ownership disappears during an operation", async () => {
    const rootDir = await makeTempDir("boreal-storage-heartbeat-");
    const lockDir = join(rootDir, "state.lock");
    const operation = withFileLock(
      lockDir,
      { waitTimeoutMs: 250, staleAfterMs: 30, retryDelayMs: 5 },
      async () => {
        await delay(80);
        return "completed";
      }
    );

    await delay(45);
    await rm(lockDir, { recursive: true, force: true });

    const heartbeatError = await captureError(() => operation);
    expect(heartbeatError).toBeInstanceOf(LockHeartbeatError);
    expect(heartbeatError).toMatchObject({ code: "BOREAL_CONFLICT" });
    expect(["owner_lost", "heartbeat_write_failed"]).toContain(
      (heartbeatError as { readonly details: { readonly reason?: string } }).details.reason
    );
  });
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sampleEvent(): RuntimeEvent {
  return withContentHash({
    meta: createRecordMeta({
      id: "bw_event_000000000001" as EventId,
      actor: { id: "storage-reliability-test", kind: "agent" },
      now: "2026-01-01T00:00:00.000Z"
    }),
    type: "storage.reliability.test",
    subjectId: "storage-reliability-test",
    subjectType: "workspace",
    payload: {}
  } satisfies RuntimeEvent);
}

async function captureError(operation: () => Promise<unknown>): Promise<unknown> {
  try {
    await operation();
  } catch (error) {
    return error;
  }
  throw new Error("Expected operation to fail");
}
