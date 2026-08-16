import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { ActorRef, AgentReservation, GraphEdge, RuntimeEvent, WorkId } from "@boreal/core";
import { FileBorealStore, ObjectDirBorealStore } from "@boreal/storage";
import { createWorkItem } from "@boreal/work-engine";
import type { DashboardGlobalPayload } from "../../apps/tui/src/loaders.js";
import {
  globalOverviewBodyFromPayload,
  isDashboardGlobalPayload,
  loadGlobalProjects,
  loadRepoRollup,
  loadRepoSprintBoard,
  loadRepoTaskDetail,
  loadRoute,
  TuiCliLoadError
} from "../../apps/tui/src/loaders.js";
import { activeReservationViewsByWorkId } from "../../apps/tui/src/repo-store.js";
import { toWorkItemView, type WorkDirectiveSummaryView } from "@boreal/ui-model";

const actor: ActorRef = { id: "tui-loader-test", kind: "agent" };
const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function reservation(input: Partial<AgentReservation> & Pick<AgentReservation, "workId">): AgentReservation {
  return {
    meta: {
      id: "bw_reservation_aaaaaaaaaaaaaaaa" as AgentReservation["meta"]["id"],
      schemaVersion: "boreal.runtime.v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: actor,
      updatedBy: actor,
      sourceRefs: [],
      tags: []
    },
    agentId: "agent-tui",
    status: "active",
    reservedAt: "2026-01-01T00:00:00.000Z",
    ...input
  };
}

function sprintActivatedEvent(sprintId: string): RuntimeEvent {
  return {
    meta: {
      id: "bw_event_aaaaaaaaaaaaaaaa" as RuntimeEvent["meta"]["id"],
      schemaVersion: "boreal.runtime.v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: actor,
      updatedBy: actor,
      sourceRefs: [],
      tags: []
    },
    type: "sprint.activated",
    subjectId: sprintId,
    subjectType: "sprint",
    payload: { sprintId }
  };
}

async function makeTempWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "boreal-tui-loader-"));
  tempDirs.push(dir);
  return dir;
}

describe("global route loaders: fixture JSON parsing", () => {
  it("builds the overview body (registry summary, queue summary, non-info attention rows) from a dashboard global fixture", () => {
    const fixture: DashboardGlobalPayload = {
      schemaVersion: "boreal.cli.dashboard.global.v1",
      generatedAt: "2026-07-05T00:00:00.000Z",
      limits: { projects: 100, workPerProject: 250, queueRowsPerQueue: 200 },
      truncated: { projects: true },
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
              { code: "search.stale", title: "Search index stale", severity: "warning", status: "warning", message: "reindex needed", actions: [{ label: "Rebuild", command: "bwrk search rebuild --json" }] },
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
    expect(body.attention[0]).toMatchObject({ projectId: "proj-a", projectMissing: false, severity: "warning", title: "Search index stale" });
    expect(body.attention[0]?.action).toEqual({ label: "Rebuild", command: 'bwrk --workspace "/repos/proj-a" search rebuild --json' });
    expect(body.attention[0]?.projectRoot).toBe("/repos/proj-a");
    expect(isDashboardGlobalPayload(fixture)).toBe(true);
    expect(isDashboardGlobalPayload({ ...fixture, registry: undefined })).toBe(false);
  });

  it("preserves dashboard metadata and rejects CLI failure instead of returning an empty success", async () => {
    const rootDir = await makeTempWorkspace();
    const payload: DashboardGlobalPayload = {
      schemaVersion: "boreal.cli.dashboard.global.v1",
      generatedAt: "2026-07-05T00:00:00.000Z",
      limits: { projects: 1, workPerProject: 2, queueRowsPerQueue: 3, rollupCacheTtlMs: 4 },
      truncated: { projects: true },
      registry: {
        entries: [],
        summary: {
          totalProjects: 0,
          healthyProjects: 0,
          warningProjects: 0,
          errorProjects: 0,
          missingProjects: 0,
          staleProjects: 0,
          openWorkCount: 0,
          readyWorkCount: 0,
          blockedWorkCount: 0,
          activeReservationCount: 0
        }
      },
      globalQueues: { queues: [], summary: { total: 0, ready: 0, blocked: 0, needsVerification: 0 } }
    };
    const successCli = join(rootDir, "fake-bwrk-success");
    await writeFile(successCli, `#!/usr/bin/env node\nprocess.stdout.write(${JSON.stringify(JSON.stringify({ ok: true, ledgerSeq: null, data: payload }))});\n`);
    await chmod(successCli, 0o755);
    const failureCli = join(rootDir, "fake-bwrk-failure");
    await writeFile(failureCli, "#!/usr/bin/env node\nprocess.stderr.write('fixture failure'); process.exit(7);\n");
    await chmod(failureCli, 0o755);

    const previousCli = process.env.BOREAL_TUI_CLI;
    try {
      process.env.BOREAL_TUI_CLI = successCli;
      const envelope = await loadGlobalProjects(rootDir);
      expect(envelope.stale).toBe(false);
      expect(envelope.limits).toMatchObject({ projects: 1, workPerProject: 2, queueRowsPerQueue: 3, rollupCacheTtlMs: 4 });
      expect(envelope.truncated).toMatchObject({ projects: true });

      process.env.BOREAL_TUI_CLI = failureCli;
      await expect(loadGlobalProjects(rootDir)).rejects.toMatchObject({ code: "TUI_CLI_LOAD_FAILED" });
      await expect(loadGlobalProjects(rootDir)).rejects.toBeInstanceOf(TuiCliLoadError);
    } finally {
      if (previousCli === undefined) delete process.env.BOREAL_TUI_CLI;
      else process.env.BOREAL_TUI_CLI = previousCli;
    }
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

  it("attaches canonical reservation ownership/expiry to task detail and avoids direct close for live claims", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new FileBorealStore({ rootDir });
    const task = {
      ...createWorkItem({ title: "Reserved task", kind: "task", actor, now: "2026-01-01T00:00:00.000Z" }),
      status: "in_progress" as const
    };
    const liveReservation = reservation({ workId: task.meta.id, expiresAt: "2099-01-01T00:00:00.000Z" });
    await store.write(async (writer) => {
      await writer.putWorkItem(task);
      await writer.putReservation(liveReservation);
    });

    const envelope = await loadRepoTaskDetail(rootDir, task.meta.id);
    expect(envelope?.body.work.activeReservation).toMatchObject({
      id: liveReservation.meta.id,
      agentId: "agent-tui",
      expired: false
    });
    expect(envelope?.body.actions.find((action) => action.id.startsWith("work.close:"))).toMatchObject({
      disabled: true,
      disabledReason: expect.stringContaining("owning agent")
    });

    const views = activeReservationViewsByWorkId([reservation({
      workId: task.meta.id,
      expiresAt: "2000-01-01T00:00:00.000Z"
    })], "2026-01-01T00:00:00.000Z");
    expect(views.get(task.meta.id)?.expired).toBe(true);
  });

  it("uses the persisted active sprint projection instead of the first alphabetical sprint", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir });
    const first = createWorkItem({ title: "A sprint", kind: "sprint", actor, now: "2026-01-01T00:00:00.000Z" });
    const active = createWorkItem({ title: "Z sprint", kind: "sprint", actor, now: "2026-01-01T00:00:01.000Z" });
    await store.write(async (writer) => {
      await writer.putWorkItem(first);
      await writer.putWorkItem(active);
      await writer.putEvent(sprintActivatedEvent(active.meta.id));
    });

    const envelope = await loadRepoSprintBoard(rootDir);
    expect(envelope.body.activeSprintId).toBe(active.meta.id);
    expect(envelope.body.selectedSprintId).toBe(active.meta.id);
    expect(envelope.body.sprints.find((sprint) => sprint.view.id === active.meta.id)?.active).toBe(true);
  });

  it("selects the first deterministic sprint when no active sprint projection exists", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new FileBorealStore({ rootDir });
    const first = createWorkItem({ title: "First sprint", kind: "sprint", actor, now: "2026-01-01T00:00:00.000Z" });
    const second = createWorkItem({ title: "Second sprint", kind: "sprint", actor, now: "2026-01-01T00:00:01.000Z" });
    await store.write(async (writer) => {
      await writer.putWorkItem(second);
      await writer.putWorkItem(first);
    });

    const envelope = await loadRepoSprintBoard(rootDir);
    expect(envelope.body.selectedSprintId).toBe(first.meta.id);
    expect(envelope.body.board?.sprint.id).toBe(first.meta.id);
  });

  it("honors route surface and entity kind while preserving issue identity", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new FileBorealStore({ rootDir });
    const issue = {
      ...createWorkItem({ title: "Issue identity", kind: "issue", actor, now: "2026-01-01T00:00:00.000Z" }),
      status: "ready" as const
    };
    await store.write((writer) => writer.putWorkItem(issue));

    await expect(loadRoute({ surface: "global", workspaceRoot: rootDir, routeId: "repo.rollup" })).rejects.toThrow("requires surface repo");
    await expect(loadRoute({
      surface: "repo",
      workspaceRoot: rootDir,
      routeId: "repo.sprintBoard",
      entity: { kind: "sprint", id: issue.meta.id, workspaceRoot: rootDir, label: issue.title }
    })).rejects.toThrow("selected sprint");
    const envelope = await loadRoute({
      surface: "repo",
      workspaceRoot: rootDir,
      routeId: "repo.taskDetail",
      entity: { kind: "issue", id: issue.meta.id, workspaceRoot: rootDir, label: issue.title }
    });
    expect((envelope.body as { readonly work: { readonly kind: string } }).work.kind).toBe("issue");
    await expect(loadRoute({
      surface: "repo",
      workspaceRoot: rootDir,
      routeId: "repo.taskDetail",
      entity: { kind: "task", id: issue.meta.id, workspaceRoot: rootDir, label: issue.title }
    })).rejects.toThrow("does not match issue");

    const milestone = createWorkItem({ title: "Phase detail", kind: "milestone", actor, now: "2026-01-01T00:00:02.000Z" });
    await store.write((writer) => writer.putWorkItem(milestone));
    const milestoneEnvelope = await loadRoute({
      surface: "repo",
      workspaceRoot: rootDir,
      routeId: "repo.taskDetail",
      entity: { kind: "milestone", id: milestone.meta.id, workspaceRoot: rootDir, label: milestone.title }
    });
    expect((milestoneEnvelope.body as { readonly work: { readonly kind: string } }).work.kind).toBe("milestone");
  });

  it("derives graph and directive blockers in the shared work view", () => {
    const blocker = createWorkItem({ title: "Blocker", kind: "task", actor, now: "2026-01-01T00:00:00.000Z" });
    const target = createWorkItem({ title: "Target", kind: "task", actor, now: "2026-01-01T00:00:01.000Z" });
    const edge = {
      meta: { id: "bw_edge_tui_fixture" },
      kind: "blocks",
      fromId: blocker.meta.id,
      fromType: "work",
      toId: target.meta.id,
      toType: "work",
      directed: true
    } as unknown as GraphEdge;
    const directives = {
      total: 1,
      advisory: 0,
      required: 0,
      blocking: 1,
      conflictCount: 0,
      missingRequiredCount: 0,
      acknowledgementCount: 0,
      blockerIds: ["directive-blocker"],
      sourceCommands: [],
      safeCommands: [],
      nextSteps: [],
      conflicts: [],
      missingRequired: [],
      items: []
    } satisfies WorkDirectiveSummaryView;
    const view = toWorkItemView({ work: target, dependencies: [blocker, target], graphEdges: [edge], directiveSummary: directives });
    expect(view.activeBlockerIds).toEqual([blocker.meta.id, "directive-blocker"]);
    expect(view.directiveSummary).toBe(directives);
  });

  it("reads a real objects-v1 workspace (the CLI's default storage kind), not just the legacy file-v2 store", async () => {
    const rootDir = await makeTempWorkspace();
    const store = new ObjectDirBorealStore({ rootDir });
    const task = createWorkItem({ title: "Object store task", kind: "task", actor, now: "2026-01-01T00:00:00.000Z" });
    await store.write(async (writer) => {
      await writer.putWorkItem(task);
    });

    const envelope = await loadRepoRollup(rootDir);
    expect(envelope.warnings).toEqual([]);
    expect(envelope.body.summary.tasks).toBe(1);
    expect(envelope.body.flatRows.some((node) => node.id === task.meta.id)).toBe(true);
  });
});
