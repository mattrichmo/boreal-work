import { describe, expect, it } from "vitest";

import { BorealError, type ActorRef, type EvidenceId, type IsoTimestamp, type KnowledgeSourceId } from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { InMemoryBorealStore } from "@boreal/storage";

const actor: ActorRef = {
  id: "codex-runtime-test",
  kind: "agent",
  displayName: "Codex Runtime Test"
};

describe("boreal runtime proof slice", () => {
  it("rejects runtime policies that do not match the schema", () => {
    expect(() =>
      createBorealRuntime({
        policy: { maxActiveReservationsPerAgent: 0 }
      })
    ).toThrow(expect.objectContaining({ code: "BOREAL_INVALID_INPUT" }));
  });

  it("resolves work references by exact id, id prefix, and title", async () => {
    const runtime = createBorealRuntime({ actor });
    const work = await runtime.createWork({ title: "Runtime reference target" });

    await expect(runtime.resolveWorkReference(work.meta.id)).resolves.toBe(work.meta.id);
    await expect(runtime.resolveWorkReference(work.meta.id.slice(0, 16))).resolves.toBe(work.meta.id);
    await expect(runtime.resolveWorkReference("runtime reference target")).resolves.toBe(work.meta.id);

    await runtime.markReady(work.meta.id);
    await runtime.claimNextWork({ agentId: actor.id });
    await expect(runtime.resolveWorkReference("current")).resolves.toBe(work.meta.id);
    await expect(runtime.resolveWorkReference("active", { agentId: actor.id })).resolves.toBe(work.meta.id);

    const secondActive = await runtime.createWork({ title: "Second active reference target", ready: true });
    const secondClaim = await runtime.claimNextWork({ agentId: actor.id });
    expect(secondClaim?.work.meta.id).toBe(secondActive.meta.id);
    await expect(runtime.resolveWorkReference("current")).rejects.toMatchObject({
      code: "BOREAL_CONFLICT"
    } satisfies Partial<BorealError>);
    await expect(runtime.resolveWorkReference("current", { agentId: "agent-without-work" })).rejects.toMatchObject({
      code: "BOREAL_NOT_FOUND"
    } satisfies Partial<BorealError>);

    await runtime.createWork({ title: "Ambiguous reference target" });
    await runtime.createWork({ title: "Ambiguous reference target" });
    await expect(runtime.resolveWorkReference("Ambiguous reference target")).rejects.toMatchObject({
      code: "BOREAL_CONFLICT"
    } satisfies Partial<BorealError>);
  });

  it("runs create, dependency readiness, reserve, evidence, verify, close, and projections", async () => {
    let tick = 0;
    const runtime = createBorealRuntime({
      actor,
      clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
    });

    await runtime.initWorkspace();
    const foundation = await runtime.createWork({
      title: "Build storage boundary",
      description: "Create transaction-capable store ports.",
      acceptanceCriteria: ["transactions roll back on failure"],
      labels: ["runtime"]
    });
    const feature = await runtime.createWork({
      title: "Build runtime proof slice",
      description: "Wire commands through the engine.",
      acceptanceCriteria: ["work cannot close without evidence"],
      labels: ["runtime", "engine"]
    });

    await runtime.markReady(foundation.meta.id);
    const blockedFeature = await runtime.addBlockingDependency({
      blockedWorkId: feature.meta.id,
      blockingWorkId: foundation.meta.id
    });
    expect(blockedFeature.status).toBe("blocked");

    await expect(runtime.closeWork({ workId: feature.meta.id, reason: "too early" })).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION"
    } satisfies Partial<BorealError>);

    const foundationEvidence = await runtime.recordEvidence({
      subjectId: foundation.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "storage transaction test passed",
      outcome: "passed"
    });
    await runtime.verifyWork({
      workId: foundation.meta.id,
      verdict: "passed",
      evidenceIds: [foundationEvidence.meta.id],
      notes: "The storage tests cover rollback behavior."
    });
    await runtime.closeWork({
      workId: foundation.meta.id,
      reason: "verified by test evidence"
    });

    const ready = await runtime.listReadyWork();
    expect(ready.map((item) => item.id)).toContain(feature.meta.id);

    const reserved = await runtime.reserveWork({
      workId: feature.meta.id,
      agentId: "agent-a",
      purpose: "finish proof slice"
    });
    expect(reserved.status).toBe("in_progress");

    await expect(
      runtime.reserveWork({
        workId: feature.meta.id,
        agentId: "agent-b",
        purpose: "conflicting reservation"
      })
    ).rejects.toMatchObject({ code: "BOREAL_CONFLICT" } satisfies Partial<BorealError>);

    const featureEvidence = await runtime.recordEvidence({
      subjectId: feature.meta.id,
      subjectType: "work",
      kind: "command",
      summary: "pnpm test passed",
      outcome: "passed",
      command: "pnpm test"
    });
    const verification = await runtime.verifyWork({
      workId: feature.meta.id,
      verdict: "passed",
      evidenceIds: [featureEvidence.meta.id]
    });
    expect(verification.verdict).toBe("passed");

    const closed = await runtime.closeWork({
      workId: feature.meta.id,
      reason: "proof slice verified"
    });
    expect(closed.status).toBe("closed");

    const views = await runtime.rebuildProjections();
    const featureView = views.find((view) => view.id === feature.meta.id);
    expect(featureView?.status).toBe("closed");
    expect(featureView?.evidenceCount).toBe(1);
    expect(featureView?.contextSummary).toContain("proof slice");

    const events = await runtime.listEvents();
    expect(new Set(events.map((event) => event.meta.id)).size).toBe(events.length);
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "workspace.initialized",
        "work.created",
        "work.dependency_added",
        "work.reserved",
        "evidence.recorded",
        "work.verified",
        "work.closed",
        "projection.rebuilt"
      ])
    );
  });

  it("uses nonce-backed work ids for same-title creates in one timestamp", async () => {
    const runtime = createBorealRuntime({
      actor,
      clock: () => new Date("2026-01-01T00:00:00.000Z")
    });

    const first = await runtime.createWork({
      title: "Duplicate import title",
      description: "Same imported description."
    });
    const second = await runtime.createWork({
      title: "Duplicate import title",
      description: "Same imported description."
    });

    expect(first.meta.id).not.toBe(second.meta.id);
  });

  it("repairs stale derived readiness with an explicit recompute", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({
      store,
      actor,
      clock: () => new Date("2026-01-01T00:00:00.000Z")
    });

    const blocker = await runtime.createWork({ title: "Open blocker" });
    const blocked = await runtime.createWork({ title: "Stale ready item" });
    await runtime.markReady(blocker.meta.id);
    await runtime.addBlockingDependency({
      blockedWorkId: blocked.meta.id,
      blockingWorkId: blocker.meta.id
    });

    await store.write(async (writer) => {
      const stale = await writer.getWorkItem(blocked.meta.id);
      if (!stale) {
        throw new Error("missing stale fixture");
      }
      await writer.putWorkItem({ ...stale, dependencyIds: [], status: "ready" });
    });

    await expect(runtime.getWorkView(blocked.meta.id)).resolves.toMatchObject({ status: "ready" });
    await expect(runtime.listReadyWork()).resolves.not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: blocked.meta.id })])
    );
    await expect(runtime.recomputeReadiness()).resolves.toEqual({ changed: 1 });
    await expect(runtime.getWorkView(blocked.meta.id)).resolves.toMatchObject({ status: "blocked" });
  });

  it("requires ready work for reservations unless force is documented", async () => {
    const runtime = createBorealRuntime({ actor });

    const draft = await runtime.createWork({ title: "Draft reservation target" });

    await expect(
      runtime.reserveWork({
        workId: draft.meta.id,
        agentId: "agent-a"
      })
    ).rejects.toMatchObject({ code: "BOREAL_POLICY_VIOLATION" } satisfies Partial<BorealError>);

    await expect(
      runtime.reserveWork({
        workId: draft.meta.id,
        agentId: "agent-a",
        force: true
      })
    ).rejects.toMatchObject({ code: "BOREAL_POLICY_VIOLATION" } satisfies Partial<BorealError>);

    const forced = await runtime.reserveWork({
      workId: draft.meta.id,
      agentId: "agent-a",
      force: true,
      forceReason: "coordinating an import repair"
    });

    expect(forced.status).toBe("in_progress");
  });

  it("atomically claims the next blocker-valid ready work by label and priority", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({ store, actor });
    const low = await runtime.createWork({ title: "Low priority claim", priority: "low", labels: ["cli"] });
    const high = await runtime.createWork({ title: "High priority claim", priority: "high", labels: ["cli"] });
    const blocker = await runtime.createWork({ title: "Open blocker", labels: ["blocker"] });
    const blocked = await runtime.createWork({ title: "Stale ready blocked claim", priority: "critical", labels: ["cli"] });

    await runtime.markReady(low.meta.id);
    await runtime.markReady(high.meta.id);
    await runtime.markReady(blocker.meta.id);
    await runtime.addBlockingDependency({
      blockedWorkId: blocked.meta.id,
      blockingWorkId: blocker.meta.id
    });
    await store.write(async (writer) => {
      const stale = await writer.getWorkItem(blocked.meta.id);
      if (!stale) {
        throw new Error("missing stale fixture");
      }
      await writer.putWorkItem({ ...stale, status: "ready" });
    });

    const claimed = await runtime.claimNextWork({
      agentId: "agent-a",
      labels: ["cli"],
      purpose: "start next slice"
    });
    expect(claimed?.work.meta.id).toBe(high.meta.id);
    expect(claimed?.work.status).toBe("in_progress");
    expect(claimed?.reservation.status).toBe("active");
    expect(claimed?.reservation.workId).toBe(high.meta.id);

    const second = await runtime.claimNextWork({ agentId: "agent-b", labels: ["cli"] });
    expect(second?.work.meta.id).toBe(low.meta.id);

    const none = await runtime.claimNextWork({ agentId: "agent-c", labels: ["missing"] });
    expect(none).toBeUndefined();

    const events = await runtime.listEvents();
    expect(events.map((event) => event.type)).toContain("work.claimed");
  });

  it("repairs dependency ids from canonical block graph edges", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({ store, actor });
    const blocker = await runtime.createWork({ title: "Canonical graph blocker" });
    const blocked = await runtime.createWork({ title: "Canonical graph blocked" });
    await runtime.markReady(blocker.meta.id);
    await runtime.addBlockingDependency({ blockedWorkId: blocked.meta.id, blockingWorkId: blocker.meta.id });

    await store.write(async (writer) => {
      const stale = await writer.getWorkItem(blocked.meta.id);
      if (!stale) {
        throw new Error("missing blocked fixture");
      }
      await writer.putWorkItem({ ...stale, dependencyIds: [], status: "ready" });
    });

    await expect(runtime.getWorkView(blocked.meta.id)).resolves.toMatchObject({
      blockedBy: [blocker.meta.id],
      status: "ready"
    });
    await expect(runtime.repairDependencyProjection()).resolves.toEqual({
      dependencyChanged: 1,
      readinessChanged: 1
    });
    await expect(runtime.getWorkView(blocked.meta.id)).resolves.toMatchObject({
      blockedBy: [blocker.meta.id],
      status: "blocked"
    });
  });

  it("removes canonical block graph dependencies and restores readiness", async () => {
    const runtime = createBorealRuntime({ actor });
    const blocker = await runtime.createWork({ title: "Removable graph blocker" });
    const blocked = await runtime.createWork({ title: "Removable graph blocked", ready: true });
    await runtime.markReady(blocker.meta.id);

    await expect(
      runtime.addBlockingDependency({ blockedWorkId: blocked.meta.id, blockingWorkId: blocker.meta.id })
    ).resolves.toMatchObject({
      status: "blocked",
      dependencyIds: [blocker.meta.id]
    });

    await expect(
      runtime.removeBlockingDependency({ blockedWorkId: blocked.meta.id, blockingWorkId: blocker.meta.id })
    ).resolves.toMatchObject({
      status: "ready",
      dependencyIds: []
    });
    await expect(runtime.getWorkView(blocked.meta.id)).resolves.toMatchObject({
      blockedBy: [],
      status: "ready"
    });
    await expect(
      runtime.removeBlockingDependency({ blockedWorkId: blocked.meta.id, blockingWorkId: blocker.meta.id })
    ).rejects.toMatchObject({
      code: "BOREAL_NOT_FOUND"
    } satisfies Partial<BorealError>);

    const events = await runtime.listEvents();
    expect(events.map((event) => event.type)).toContain("work.dependency_removed");
  });

  it("renews, releases, and expires active reservations", async () => {
    let current = new Date("2026-01-01T00:00:00.000Z");
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({
      store,
      actor,
      clock: () => current
    });
    const work = await runtime.createWork({ title: "Reservation lifecycle target" });
    await runtime.markReady(work.meta.id);

    await runtime.reserveWork({
      workId: work.meta.id,
      agentId: "agent-a",
      expiresAt: "2026-01-01T00:10:00.000Z" as IsoTimestamp
    });
    const renewed = await runtime.renewWorkReservation({
      workId: work.meta.id,
      expiresAt: "2026-01-01T00:20:00.000Z" as IsoTimestamp
    });
    expect(renewed.reservation.expiresAt).toBe("2026-01-01T00:20:00.000Z");

    const released = await runtime.releaseWorkReservation(work.meta.id);
    expect(released.reservation.status).toBe("released");
    expect(released.work.status).toBe("ready");
    expect(released.work.reservationId).toBeUndefined();

    await runtime.reserveWork({
      workId: work.meta.id,
      agentId: "agent-b",
      expiresAt: "2026-01-01T00:30:00.000Z" as IsoTimestamp
    });
    current = new Date("2026-01-01T00:31:00.000Z");
    const expired = await runtime.expireStaleReservations();
    expect(expired.expired).toHaveLength(1);
    expect(expired.expired[0]?.reservation.status).toBe("expired");
    expect(expired.expired[0]?.work.status).toBe("ready");
    await expect(runtime.getWorkView(work.meta.id)).resolves.toMatchObject({
      status: "ready",
      activeReservationId: undefined
    });

    const events = await runtime.listEvents();
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["work.reservation_renewed", "work.reservation_released", "work.reservation_expired"])
    );
  });

  it("finishes reserved work atomically from evidence through reservation release", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({ store, actor });
    const work = await runtime.createWork({ title: "Atomic finish target" });
    await runtime.markReady(work.meta.id);
    await runtime.reserveWork({ workId: work.meta.id, agentId: "agent-a" });

    await expect(
      runtime.finishReservedWork({
        workId: work.meta.id,
        agentId: "agent-b",
        evidence: {
          kind: "test",
          summary: "wrong agent should not write",
          outcome: "passed"
        },
        verification: {
          verdict: "passed"
        },
        release: true
      })
    ).rejects.toMatchObject({ code: "BOREAL_POLICY_VIOLATION" } satisfies Partial<BorealError>);

    const afterFailedFinish = await store.read(async (reader) => ({
      work: await reader.getWorkItem(work.meta.id),
      evidence: await reader.listEvidenceForSubject(work.meta.id),
      verifications: await reader.listVerificationsForSubject(work.meta.id),
      reservations: await reader.listReservationsForWork(work.meta.id)
    }));
    expect(afterFailedFinish.work?.status).toBe("in_progress");
    expect(afterFailedFinish.evidence).toHaveLength(0);
    expect(afterFailedFinish.verifications).toHaveLength(0);
    expect(afterFailedFinish.reservations).toEqual([expect.objectContaining({ status: "active", agentId: "agent-a" })]);

    const finished = await runtime.finishReservedWork({
      workId: work.meta.id,
      agentId: "agent-a",
      evidence: {
        kind: "test",
        summary: "atomic finish test passed",
        outcome: "passed"
      },
      verification: {
        verdict: "passed",
        notes: "single runtime write"
      },
      close: {
        reason: "verified atomically"
      }
    });

    expect(finished.work.status).toBe("closed");
    expect(finished.work.reservationId).toBeUndefined();
    expect(finished.evidence.outcome).toBe("passed");
    expect(finished.verification.verdict).toBe("passed");
    expect(finished.reservation.status).toBe("released");
    expect(finished.release.work.status).toBe("closed");
    expect(finished.closedWork?.closedReason).toBe("verified atomically");

    const events = await runtime.listEvents();
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining([
        "evidence.recorded",
        "work.verified",
        "work.closed",
        "work.reservation_released",
        "agent.finished"
      ])
    );
  });

  it("requires passed evidence for passed verification but allows failed verdict evidence", async () => {
    const runtime = createBorealRuntime({ actor });
    const work = await runtime.createWork({ title: "Verify evidence policy" });
    const failedEvidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "test failed",
      outcome: "failed"
    });

    await expect(
      runtime.verifyWork({
        workId: work.meta.id,
        verdict: "passed",
        evidenceIds: [failedEvidence.meta.id]
      })
    ).rejects.toMatchObject({ code: "BOREAL_POLICY_VIOLATION" } satisfies Partial<BorealError>);

    const failedVerification = await runtime.verifyWork({
      workId: work.meta.id,
      verdict: "failed",
      evidenceIds: [failedEvidence.meta.id]
    });

    expect(failedVerification.verdict).toBe("failed");
  });

  it("treats verified dependencies as resolved during readiness recompute", async () => {
    const runtime = createBorealRuntime({ actor });
    const blocker = await runtime.createWork({ title: "Verified blocker" });
    const blocked = await runtime.createWork({ title: "Downstream item" });

    await runtime.markReady(blocker.meta.id);
    await runtime.addBlockingDependency({
      blockedWorkId: blocked.meta.id,
      blockingWorkId: blocker.meta.id
    });
    const evidence = await runtime.recordEvidence({
      subjectId: blocker.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "verification test passed",
      outcome: "passed"
    });
    await runtime.verifyWork({
      workId: blocker.meta.id,
      verdict: "passed",
      evidenceIds: [evidence.meta.id]
    });

    await expect(runtime.recomputeReadiness()).resolves.toEqual({ changed: 1 });
    await expect(runtime.getWorkView(blocked.meta.id)).resolves.toMatchObject({ status: "ready" });
  });

  it("includes accepted claims and decisions in rebuilt context packs", async () => {
    const runtime = createBorealRuntime({ actor });
    const work = await runtime.createWork({
      title: "Build context surface",
      description: "Expose knowledge records through context packs."
    });
    const source = await runtime.createKnowledgeSource({
      kind: "document",
      title: "Context design note",
      uri: "file://context-design.md",
      summary: "Knowledge context must be visible to agents."
    });
    const evidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "context pack test passed",
      outcome: "passed"
    });

    await runtime.createClaim({
      statement: "Context packs include accepted claims.",
      status: "accepted",
      sourceIds: [source.meta.id],
      evidenceIds: [evidence.meta.id]
    });
    await runtime.createDecision({
      title: "Expose context packs",
      context: "Agents need compact project memory.",
      decision: "Expose context packs through the runtime and CLI.",
      status: "accepted",
      sourceIds: [source.meta.id]
    });
    await runtime.createClaim({
      statement: "Payroll approvals require finance review.",
      status: "accepted",
      sourceIds: [source.meta.id]
    });
    await runtime.createDecision({
      title: "Payroll approval policy",
      context: "Finance owns payroll controls.",
      decision: "Route payroll approvals through finance.",
      status: "accepted",
      sourceIds: [source.meta.id]
    });

    await runtime.rebuildProjections();
    const pack = await runtime.getContextPack(work.meta.id);

    expect(pack.facts).toContain("claim: Context packs include accepted claims.");
    expect(pack.facts).toContain("decision: Expose context packs through the runtime and CLI.");
    expect(pack.facts).not.toContain("claim: Payroll approvals require finance review.");
    expect(pack.facts).not.toContain("decision: Route payroll approvals through finance.");
    expect(pack.evidence).toContain("passed: context pack test passed");
  });

  it("prioritizes directly linked knowledge in context packs without relying on token overlap", async () => {
    const runtime = createBorealRuntime({ actor });
    const work = await runtime.createWork({
      title: "Calibrate telemetry lane",
      description: "Prepare the runtime handoff surface."
    });
    const source = await runtime.createKnowledgeSource({
      kind: "document",
      title: "Direct source note",
      uri: "file://direct-source.md",
      summary: "URI anchored source for projection selection."
    });
    const evidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "artifact",
      summary: "binary fixture passed",
      outcome: "passed",
      uri: source.uri
    });

    await runtime.createClaim({
      statement: "Lunch menu uses barley.",
      status: "accepted",
      evidenceIds: [evidence.meta.id]
    });
    await runtime.createDecision({
      title: "Finance approval route",
      context: "Budget owners need a path.",
      decision: "Escalate budget approvals weekly.",
      status: "accepted",
      sourceIds: [source.meta.id]
    });
    await runtime.createClaim({
      statement: "Orchard tickets require ladder review.",
      status: "accepted"
    });
    await runtime.createDecision({
      title: "Warehouse receiving policy",
      context: "Inventory team workflow.",
      decision: "Route receiving changes through inventory.",
      status: "accepted"
    });

    await runtime.rebuildProjections();
    const pack = await runtime.getContextPack(work.meta.id);

    expect(pack.facts).toContain("claim: Lunch menu uses barley.");
    expect(pack.facts).toContain("decision: Escalate budget approvals weekly.");
    expect(pack.facts).not.toContain("claim: Orchard tickets require ladder review.");
    expect(pack.facts).not.toContain("decision: Route receiving changes through inventory.");
  });

  it("rejects dangling knowledge source and evidence references", async () => {
    const runtime = createBorealRuntime({ actor });
    const missingSourceId = "bw_source_deadbeefdead" as KnowledgeSourceId;
    const missingEvidenceId = "bw_evidence_deadbeefdead" as EvidenceId;

    await expect(
      runtime.createClaim({
        statement: "This claim has missing references.",
        status: "accepted",
        sourceIds: [missingSourceId],
        evidenceIds: [missingEvidenceId]
      })
    ).rejects.toMatchObject({ code: "BOREAL_NOT_FOUND" } satisfies Partial<BorealError>);

    await expect(
      runtime.createDecision({
        title: "Missing source decision",
        context: "Invalid fixture.",
        decision: "Reject missing sources.",
        sourceIds: [missingSourceId]
      })
    ).rejects.toMatchObject({ code: "BOREAL_NOT_FOUND" } satisfies Partial<BorealError>);
  });
});
