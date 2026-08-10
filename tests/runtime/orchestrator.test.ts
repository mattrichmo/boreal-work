import { describe, expect, it } from "vitest";

import type { ActorRef } from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { InMemoryBorealStore } from "@boreal/storage";

const actor: ActorRef = {
  id: "orchestrator-test",
  kind: "agent",
  displayName: "Orchestrator Test"
};

describe("boreal orchestrator", () => {
  it("dispatches a bounded wave through existing claims and persists typed progress", async () => {
    const store = new InMemoryBorealStore();
    let clock = new Date("2026-08-09T00:00:00.000Z");
    const runtime = createBorealRuntime({ actor, store, clock: () => clock });
    const root = await runtime.createWork({ title: "Orchestration root", kind: "sprint" });
    const child = await runtime.createWork({ title: "Orchestration child", kind: "task", ready: true, priority: "high" });
    await runtime.addBlockingDependency({ blockedWorkId: root.meta.id, blockingWorkId: child.meta.id });

    const orchestration = await runtime.orchestrator.start({
      rootWorkId: root.meta.id,
      agentPool: ["agent-a"],
      policy: {
        maxConcurrent: 1,
        nudgeAfterMs: 1_000,
        staleAfterMs: 2_000,
        maxNudgesPerWork: 2
      }
    });
    expect(orchestration.status).toBe("active");
    const planned = await runtime.orchestrator.show(orchestration.meta.id);
    expect(planned.readyCandidates[0]?.acceptanceCriteria).toEqual([]);
    expect(planned.readyCandidates[0]?.contextCommand).toContain("bwrk context show");

    const firstTick = await runtime.orchestrator.tick({ orchestrationId: orchestration.meta.id, dispatch: true });
    expect(firstTick.assigned).toHaveLength(1);
    expect(firstTick.assigned[0]?.workId).toBe(child.meta.id);
    expect(firstTick.assigned[0]?.agentId).toBe("agent-a");
    expect(firstTick.run.wave).toBe(1);

    const working = await runtime.orchestrator.progress({
      orchestrationId: orchestration.meta.id,
      workId: child.meta.id,
      agentId: "agent-a",
      state: "working",
      phase: "implementation",
      nextCheckpoint: "run focused tests",
      touchedPaths: ["packages/engine/src/orchestrator.ts"]
    });
    expect(working.assignments[0]?.state).toBe("working");

    clock = new Date("2026-08-09T00:00:01.500Z");
    const nudged = await runtime.orchestrator.tick({ orchestrationId: orchestration.meta.id });
    expect(nudged.issuedNudges).toHaveLength(1);
    expect(nudged.issuedNudges[0]?.kind).toBe("heartbeat");
    expect(nudged.issuedNudges[0]?.reasonCode).toBe("heartbeat_overdue");

    const checkpointNudge = await runtime.orchestrator.nudge({
      orchestrationId: orchestration.meta.id,
      workId: child.meta.id,
      kind: "checkpoint"
    });
    expect(checkpointNudge.nudge.commandPath).toContain("bwrk orchestrate progress");

    const acknowledged = await runtime.orchestrator.progress({
      orchestrationId: orchestration.meta.id,
      workId: child.meta.id,
      agentId: "agent-a",
      state: "waiting",
      note: "Focused tests are running."
    });
    expect(acknowledged.assignments[0]?.state).toBe("waiting");
    expect(acknowledged.nudges.filter((nudge) => nudge.acknowledgedAt)).toHaveLength(2);

    const reloaded = createBorealRuntime({ actor, store, clock: () => clock });
    const shown = await reloaded.orchestrator.show(orchestration.meta.id);
    expect(shown.run.assignments[0]?.lastProgress?.state).toBe("waiting");
    expect(shown.run.nudges).toHaveLength(2);
    expect((await reloaded.listEvents()).filter((event) => event.subjectType === "orchestration").length).toBeGreaterThanOrEqual(5);
  });

  it("pauses dispatch and requires attention after the nudge budget is exhausted", async () => {
    let clock = new Date("2026-08-09T01:00:00.000Z");
    const runtime = createBorealRuntime({ actor, clock: () => clock });
    const work = await runtime.createWork({ title: "Nudge budget target", ready: true });
    const orchestration = await runtime.orchestrator.start({
      rootWorkId: work.meta.id,
      agentPool: ["agent-a"],
      policy: { maxConcurrent: 1, nudgeAfterMs: 1_000, staleAfterMs: 1_000, maxNudgesPerWork: 1 }
    });
    await runtime.orchestrator.tick({ orchestrationId: orchestration.meta.id, dispatch: true });

    clock = new Date("2026-08-09T01:00:02.000Z");
    const tick = await runtime.orchestrator.tick({ orchestrationId: orchestration.meta.id });
    expect(tick.run.status).toBe("needs_attention");
    expect(tick.run.assignments[0]?.state).toBe("stale");

    const paused = await runtime.orchestrator.transition(orchestration.meta.id, "paused");
    expect(paused.status).toBe("paused");
    const resumed = await runtime.orchestrator.transition(orchestration.meta.id, "resumed");
    expect(resumed.status).toBe("active");
  });

  it("persists the session and Git handoff returned by the injected start adapter", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({
      actor,
      store,
      orchestrationClaimWork: async (input, dependencies) => {
        const claim = await dependencies.claimWork(input);
        const reservation = await dependencies.attachReservationGit({
          reservationId: claim.reservation.meta.id,
          git: {
            branch: "work/orchestration-child",
            baseSha: "abc123",
            worktreePath: "/tmp/boreal-orchestration-child"
          }
        });
        return { ...claim, reservation };
      }
    });
    const root = await runtime.createWork({ title: "Session handoff root", kind: "sprint" });
    const child = await runtime.createWork({ title: "Session handoff child", kind: "task", ready: true });
    await runtime.addBlockingDependency({ blockedWorkId: root.meta.id, blockingWorkId: child.meta.id });

    const orchestration = await runtime.orchestrator.start({
      rootWorkId: root.meta.id,
      agentPool: ["agent-a"],
      sessionId: "session-42",
      worktree: true
    });
    expect(orchestration.sessionId).toBe("session-42");
    expect(orchestration.worktree).toBe(true);

    const planned = await runtime.orchestrator.show(orchestration.meta.id);
    expect(planned.readyCandidates[0]?.command).toContain("--session session-42");
    expect(planned.readyCandidates[0]?.command).toContain("--worktree");

    const dispatched = await runtime.orchestrator.tick({ orchestrationId: orchestration.meta.id, dispatch: true });
    expect(dispatched.assigned[0]).toMatchObject({
      workId: child.meta.id,
      agentId: "agent-a",
      sessionId: "session-42",
      git: {
        branch: "work/orchestration-child",
        baseSha: "abc123",
        worktreePath: "/tmp/boreal-orchestration-child"
      }
    });

    const reloaded = createBorealRuntime({ actor, store });
    const shown = await reloaded.orchestrator.show(orchestration.meta.id);
    expect(shown.run.assignments[0]).toMatchObject({
      sessionId: "session-42",
      git: { worktreePath: "/tmp/boreal-orchestration-child" }
    });
  });
});
