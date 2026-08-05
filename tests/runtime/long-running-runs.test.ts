import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createBorealRuntime } from "@boreal/engine";
import { InMemoryBorealStore, FileBorealStore, ObjectDirBorealStore } from "@boreal/storage";
import type { IsoTimestamp } from "@boreal/core";

const actor = { id: "run-test", kind: "agent" as const, displayName: "Run test" };

describe("durable execution runs", () => {
  it("keeps attempts separate from work and supports checkpoint, wait, retry, and cursors", async () => {
    let current = new Date("2026-08-04T00:00:00.000Z");
    const runtime = createBorealRuntime({
      store: new InMemoryBorealStore(),
      actor,
      clock: () => current
    });
    const work = await runtime.createWork({ title: "Long-running fixture" });
    const queued = await runtime.runs.start({ workId: work.meta.id, idempotencyKey: "fixture", maxAttempts: 2, staleAfterMs: 1_000 });
    expect(queued.status).toBe("queued");
    expect(await runtime.runs.start({ workId: work.meta.id, idempotencyKey: "fixture" })).toMatchObject({ meta: { id: queued.meta.id } });

    const running = await runtime.runs.resume(queued.meta.id, "worker-a");
    const checkpoint = await runtime.runs.checkpoint({
      runId: running.meta.id,
      phase: "ingest",
      progress: { completed: 2, total: 10, unit: "records" },
      cursor: "source:2"
    });
    expect(checkpoint.checkpoint.sequence).toBe(1);
    expect(checkpoint.run.currentCheckpointId).toBe(checkpoint.checkpoint.meta.id);

    const wakeAt = "2026-08-04T00:02:00.000Z" as IsoTimestamp;
    await runtime.runs.wait(running.meta.id, {
      kind: "timer",
      reasonCode: "rate_window",
      reason: "Waiting for the next source window",
      wakeAt
    });
    current = new Date(wakeAt);
    const reconciled = await runtime.runs.reconcile();
    expect(reconciled.requeued).toContain(running.meta.id);

    const requeued = await runtime.runs.show(running.meta.id);
    expect(requeued.run.status).toBe("queued");
    await runtime.runs.resume(running.meta.id, "worker-a");
    current = new Date("2026-08-04T00:04:00.000Z");
    const stale = await runtime.runs.reconcile();
    expect(stale.expired).toContain(running.meta.id);
    expect((await runtime.runs.show(running.meta.id)).run.status).toBe("needs_attention");

    const retry = await runtime.runs.retry(running.meta.id);
    expect(retry.attempt).toBe(2);
    expect(retry.parentRunId).toBe(running.meta.id);

    const events = await runtime.runs.listEventsAfter();
    const cursor = await runtime.runs.advanceCursor({ name: "fixture", consumerId: "worker-a", eventId: events.at(-1)?.meta.id });
    expect(cursor.lastEventId).toBe(events.at(-1)?.meta.id);
    expect((await runtime.runs.listEventsAfter(cursor.lastEventId)).length).toBeLessThan(events.length);
  });

  it("executes an approved command once and persists the result in both file backends", async () => {
    for (const kind of ["file", "objects"] as const) {
      const root = await mkdtemp(join(tmpdir(), `boreal-runs-${kind}-`));
      try {
        const store = kind === "file" ? new FileBorealStore({ rootDir: root }) : new ObjectDirBorealStore({ rootDir: root, sqlite: undefined });
        const runtime = createBorealRuntime({ store, actor, workspaceRoot: root });
        const work = await runtime.createWork({ title: `Worker ${kind}` });
        const run = await runtime.runs.start({
          workId: work.meta.id,
          command: {
            executable: "node",
            args: ["-e", "process.stdout.write('done')"],
            cwd: ".",
            timeoutMs: 5_000,
            stdoutMaxBytes: 10_000,
            stderrMaxBytes: 10_000
          },
          idempotencyKey: kind
        });
        const finished = await runtime.runs.executeQueued("worker");
        expect(finished?.meta.id).toBe(run.meta.id);
        expect(finished?.status).toBe("succeeded");
        expect(finished?.result?.stdoutExcerpt).toBe("done");

        const reopened = kind === "file" ? new FileBorealStore({ rootDir: root }) : new ObjectDirBorealStore({ rootDir: root, sqlite: undefined });
        await expect(reopened.read((reader) => reader.getRun(run.meta.id))).resolves.toMatchObject({ status: "succeeded" });
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    }
  });

  it("cancels a running command and preserves the cancelled terminal state", async () => {
    const root = await mkdtemp(join(tmpdir(), "boreal-runs-cancel-"));
    try {
      const runtime = createBorealRuntime({
        store: new FileBorealStore({ rootDir: root }),
        actor,
        workspaceRoot: root
      });
      const work = await runtime.createWork({ title: "Cancellable worker" });
      const run = await runtime.runs.start({
        workId: work.meta.id,
        command: {
          executable: "node",
          args: ["-e", "setTimeout(() => {}, 10000)"],
          cwd: ".",
          timeoutMs: 15_000,
          stdoutMaxBytes: 10_000,
          stderrMaxBytes: 10_000
        }
      });
      const execution = runtime.runs.executeQueued("worker-cancel");
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await runtime.runs.show(run.meta.id)).run.status === "running") break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect((await runtime.runs.show(run.meta.id)).run.status).toBe("running");
      await runtime.runs.transition(run.meta.id, "cancelled");
      const finished = await execution;
      expect(finished?.status).toBe("cancelled");
      expect(finished?.errorCode).toBe("BOREAL_COMMAND_CANCELLED");
      expect(finished?.result?.cancelled).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
