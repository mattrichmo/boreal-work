import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ActorRef, WorkId } from "@boreal/core";
import { FileBorealStore } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";
import type { DashboardGlobalPayload } from "../../apps/tui/src/loaders.js";
import { globalOverviewBodyFromPayload, loadRepoRollup, loadRepoTaskDetail } from "../../apps/tui/src/loaders.js";

const actor: ActorRef = { id: "tui-loader-test", kind: "agent" };
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-tui-loader-"));
  tempDirs.push(dir);
  return dir;
}

describe("global route loaders: fixture JSON parsing", () => {
  it("builds the overview body (registry summary, queue summary, non-info attention rows) from a dashboard global fixture", () => {
    const fixture: DashboardGlobalPayload = {
      generatedAt: "2026-07-05T00:00:00.000Z",
      registry: {
        entries: [
          {
            id: "proj-a",
            name: "proj-a",
            projectRoot: "/repos/proj-a",
            memoryRoot: "/repos/proj-a/memory",
            memoryLayout: "child",
            memoryGitMode: "separate",
            health: "warning",
            stale: true,
            syncFreshness: "stale",
            openWorkCount: 5,
            readyWorkCount: 2,
            blockedWorkCount: 1,
            activeReservationCount: 0,
            findings: [
              { code: "search.stale", title: "Search index stale", severity: "warning", status: "warning", message: "reindex needed", actions: [] },
              { code: "info.note", title: "note", severity: "info", status: "ok", message: "fyi", actions: [] }
            ]
          }
        ],
        summary: {
          totalProjects: 1,
          healthyProjects: 0,
          warningProjects: 1,
          errorProjects: 0,
          missingProjects: 0,
          staleProjects: 1,
          openWorkCount: 5,
          readyWorkCount: 2,
          blockedWorkCount: 1,
          activeReservationCount: 0
        }
      },
      globalQueues: {
        queues: [],
        summary: { total: 3, ready: 2, blocked: 1, needsVerification: 0 }
      }
    };

    const body = globalOverviewBodyFromPayload(fixture);
    expect(body.registrySummary.totalProjects).toBe(1);
    expect(body.queueSummary.ready).toBe(2);
    // Only the non-info finding surfaces as an attention row.
    expect(body.attention).toHaveLength(1);
    expect(body.attention[0]).toMatchObject({ projectId: "proj-a", severity: "warning", title: "Search index stale" });
  });
});

describe("repo route loaders: direct store read", () => {
  it("loadRepoRollup returns a stable envelope over a real workspace store", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new FileBorealStore({ rootDir });
    const milestone = createWorkItem({ title: "Milestone A", kind: "milestone", actor, now: "2026-01-01T00:00:00.000Z" });
    const task = createWorkItem({
      title: "Task 1",
      kind: "task",
      parentId: milestone.meta.id,
      actor,
      now: "2026-01-01T00:00:01.000Z"
    });
    await store.write(async (writer) => {
      await writer.putWorkItem(milestone);
      await writer.putWorkItem(task);
    });

    const envelope = await loadRepoRollup(rootDir);
    expect(envelope.surface).toBe("repo");
    expect(envelope.workspaceRoot).toBe(rootDir);
    expect(envelope.body.summary.milestones).toBe(1);
    expect(envelope.body.summary.tasks).toBe(1);
    const milestoneNode = envelope.body.flatRows.find((node) => node.id === milestone.meta.id);
    expect(milestoneNode?.childIds).toEqual([task.meta.id]);
  });

  it("loadRepoTaskDetail fetches a single work item on demand and returns undefined for unknown ids", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new FileBorealStore({ rootDir });
    const task = createWorkItem({ title: "Task 1", kind: "task", actor, now: "2026-01-01T00:00:00.000Z" });
    await store.write(async (writer) => {
      await writer.putWorkItem(task);
    });

    const envelope = await loadRepoTaskDetail(rootDir, task.meta.id);
    expect(envelope?.body.work.id).toBe(task.meta.id);
    expect(envelope?.body.work.title).toBe("Task 1");

    const missing = await loadRepoTaskDetail(rootDir, "bw_work_doesnotexist" as WorkId);
    expect(missing).toBeUndefined();
  });
});
