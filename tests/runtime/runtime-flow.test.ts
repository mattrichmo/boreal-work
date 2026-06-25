import { describe, expect, it } from "vitest";

import { BorealError, type ActorRef } from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";

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
});

