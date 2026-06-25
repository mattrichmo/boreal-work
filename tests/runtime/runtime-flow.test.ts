import { describe, expect, it } from "vitest";

import { BorealError, type ActorRef, type EvidenceId, type KnowledgeSourceId } from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { InMemoryBorealStore } from "@boreal/storage";

const actor: ActorRef = {
  id: "codex-runtime-test",
  kind: "agent",
  displayName: "Codex Runtime Test"
};

describe("boreal runtime proof slice", () => {
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
    expect(reserved.status).toBe("reserved");

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
      await writer.putWorkItem({ ...stale, status: "ready" });
    });

    await expect(runtime.getWorkView(blocked.meta.id)).resolves.toMatchObject({ status: "ready" });
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

    expect(forced.status).toBe("reserved");
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

    await runtime.rebuildProjections();
    const pack = await runtime.getContextPack(work.meta.id);

    expect(pack.facts).toContain("claim: Context packs include accepted claims.");
    expect(pack.facts).toContain("decision: Expose context packs through the runtime and CLI.");
    expect(pack.evidence).toContain("passed: context pack test passed");
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
