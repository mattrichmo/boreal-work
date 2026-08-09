import { describe, expect, it } from "vitest";

import {
  reconciliationObligationGaps,
  runtimeSnapshotSchemaIssues,
  type ActorRef,
  type OperationId,
  type WorkItem
} from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { InMemoryBorealStore } from "@boreal/storage";
import { deriveReadinessStatus } from "@boreal/work-engine";

const actor: ActorRef = { id: "reconciliation-test", kind: "agent" };
const obligationDraft = {
  findingId: "finding-validation-001",
  subjectScope: { subjectType: "work", subjectId: "artifact-contract" },
  requiredChanges: [{ kind: "contract" as const, description: "Update the affected contract" }],
  revalidationCommand: "pnpm test -- reconciliation-obligations",
  reconciliationInputs: { sourceGeneration: "gen-1", findingCount: 1 },
  unlocks: []
};

describe("reconciliation obligations", () => {
  it("persists typed obligations and makes ready work effectively blocked", async () => {
    const runtime = createBorealRuntime({ actor, policy: { requireAgentSummaryForClose: false } });
    const work = await runtime.createWork({
      title: "Reconciliation-gated work",
      reconciliationObligations: [obligationDraft],
      ready: true
    });

    expect(work.reconciliationObligations).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^bw_obligation_[a-f0-9]{16}$/),
        findingId: obligationDraft.findingId,
        status: "open",
        revalidationCommand: obligationDraft.revalidationCommand,
        unlocks: []
      })
    ]);
    expect(work.status).toBe("blocked");
    expect(await runtime.listReadyWork()).toEqual([]);
    expect(reconciliationObligationGaps(work)).toEqual([
      expect.objectContaining({
        code: "reconciliation.obligation.open",
        subjectId: work.meta.id,
        data: expect.objectContaining({
          findingIds: [obligationDraft.findingId],
          revalidationCommands: [obligationDraft.revalidationCommand]
        })
      })
    ]);
  });

  it("does not promote passed verification to verified while an obligation is open", async () => {
    const runtime = createBorealRuntime({ actor, policy: { requireAgentSummaryForClose: false } });
    const work = await runtime.createWork({
      title: "Verification with an unresolved finding",
      reconciliationObligations: [obligationDraft]
    });
    const evidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "revalidation command observed",
      outcome: "passed"
    });

    const verification = await runtime.verifyWork({
      workId: work.meta.id,
      verdict: "passed",
      evidenceIds: [evidence.meta.id]
    });

    expect(verification.verdict).toBe("passed");
    await expect(runtime.getWorkView(work.meta.id)).resolves.toMatchObject({ status: "blocked" });
    await expect(runtime.listEvents()).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "work.verification_recorded" })])
    );
    expect((await runtime.listEvents()).some((event) => event.type === "work.verified")).toBe(false);
    await expect(runtime.closeWork({ workId: work.meta.id, reason: "not reconciled" })).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      gaps: [expect.objectContaining({ code: "reconciliation.obligation.open" })]
    });
  });

  it("requires resolve, passed revalidation, and reconciliation before unlocking", async () => {
    const runtime = createBorealRuntime({ actor, policy: { requireAgentSummaryForClose: false } });
    const work = await runtime.createWork({
      title: "Lifecycle-gated work",
      reconciliationObligations: [obligationDraft]
    });
    const obligationId = work.reconciliationObligations?.[0]?.id;
    if (!obligationId) throw new Error("obligation missing");

    const resolving = await runtime.transitionReconciliation({
      workId: work.meta.id,
      obligationId,
      transition: "resolve"
    });
    expect(resolving.reconciliationObligations?.[0]?.status).toBe("remediation-in-progress");

    await expect(runtime.transitionReconciliation({
      workId: work.meta.id,
      obligationId,
      transition: "revalidate"
    })).rejects.toMatchObject({ code: "BOREAL_INVALID_INPUT" });

    const failed = await runtime.transitionReconciliation({
      workId: work.meta.id,
      obligationId,
      transition: "revalidate",
      revalidationPassed: false
    });
    expect(failed.reconciliationObligations?.[0]?.status).toBe("revalidation-failed");
    await expect(runtime.transitionReconciliation({
      workId: work.meta.id,
      obligationId,
      transition: "reconcile"
    })).rejects.toMatchObject({ code: "BOREAL_POLICY_VIOLATION" });

    await runtime.transitionReconciliation({
      workId: work.meta.id,
      obligationId,
      transition: "revalidate",
      revalidationPassed: true
    });
    const reconciled = await runtime.transitionReconciliation({
      workId: work.meta.id,
      obligationId,
      transition: "reconcile",
      revalidationPassed: true
    });
    expect(reconciled.reconciliationObligations?.[0]).toEqual(expect.objectContaining({ status: "reconciled" }));
    expect(reconciled.status).toBe("ready");
  });

  it("blocks sprint closeout when a verified descendant still has an open obligation", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({
      actor,
      store,
      policy: { requireAgentSummaryForClose: false }
    });
    const sprint = await runtime.createWork({ title: "Reconciliation sprint", kind: "sprint" });
    const child = await runtime.createWork({
      title: "Verified but unreconciled child",
      reconciliationObligations: [obligationDraft]
    });
    await runtime.addBlockingDependency({ blockedWorkId: sprint.meta.id, blockingWorkId: child.meta.id });

    const sprintEvidence = await runtime.recordEvidence({
      subjectId: sprint.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "sprint closeout evidence",
      outcome: "passed"
    });
    await runtime.verifyWork({
      workId: sprint.meta.id,
      verdict: "passed",
      evidenceIds: [sprintEvidence.meta.id]
    });

    await store.write(async (writer) => {
      const current = await writer.getWorkItem(child.meta.id);
      if (!current) throw new Error("child work missing");
      await writer.putWorkItem({ ...current, status: "verified" });
    });

    await expect(runtime.closeWork({ workId: sprint.meta.id, reason: "advance sprint" })).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      details: expect.objectContaining({
        gateGaps: expect.arrayContaining([
          expect.objectContaining({
            code: "reconciliation.obligation.open",
            targetId: child.meta.id
          })
        ])
      })
    });
  });

  it("allows effective verification readiness after every obligation is reconciled", () => {
    const work = fixtureWorkWithOpenObligation();
    const reconciled: WorkItem = {
      ...work,
      status: "verified",
      reconciliationObligations: work.reconciliationObligations?.map((obligation) => ({
        ...obligation,
        status: "reconciled",
        reconciledBy: "bw_operation_0123456789abcdef" as OperationId
      }))
    };

    expect(reconciliationObligationGaps(reconciled)).toEqual([]);
    expect(deriveReadinessStatus(reconciled, [])).toBe("verified");
  });

  it("keeps dependents blocked by a verified but unreconciled blocker", () => {
    const dependency = fixtureWorkWithOpenObligation();
    const dependent: WorkItem = {
      ...fixtureWorkWithOpenObligation(),
      meta: { ...fixtureWorkWithOpenObligation().meta, id: "bw_work_fedcba9876543210" },
      status: "ready",
      reconciliationObligations: undefined,
      title: "dependent"
    };

    expect(deriveReadinessStatus({ ...dependency, status: "verified" }, [dependency])).toBe("blocked");
    expect(deriveReadinessStatus(dependent, [dependency])).toBe("blocked");
  });

  it("validates obligation shape in the published work-item schema", () => {
    const work = fixtureWorkWithOpenObligation();
    expect(runtimeSnapshotSchemaIssues({ workItems: [work] })).toEqual([]);
    expect(
      runtimeSnapshotSchemaIssues({
        workItems: [{
          ...work,
          reconciliationObligations: [{
            ...work.reconciliationObligations?.[0],
            id: "not-an-obligation"
          }]
        }]
      })
    ).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: "workItems[0].reconciliationObligations[0].id" })
    ]));
  });
});

function fixtureWorkWithOpenObligation(): WorkItem {
  return {
    meta: {
      id: "bw_work_0123456789abcdef",
      schemaVersion: "boreal.runtime.v1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      createdBy: actor,
      updatedBy: actor,
      sourceRefs: [],
      tags: []
    },
    kind: "task",
    title: "fixture",
    description: "fixture",
    status: "blocked",
    priority: "normal",
    acceptanceCriteria: [],
    labels: [],
    dependencyIds: [],
    evidenceIds: [],
    verificationIds: [],
    reconciliationObligations: [
      {
        id: "bw_obligation_0123456789abcdef",
        findingId: "finding-fixture",
        subjectScope: { subjectType: "work", subjectId: "bw_work_0123456789abcdef" },
        requiredChanges: [{ kind: "code", description: "change fixture" }],
        revalidationCommand: "pnpm test -- fixture",
        reconciliationInputs: { generation: "one" },
        status: "open",
        unlocks: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: actor,
        updatedBy: actor
      }
    ]
  };
}
