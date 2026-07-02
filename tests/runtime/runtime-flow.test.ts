import { describe, expect, it } from "vitest";

import {
  BorealError,
  createRecordMeta,
  deterministicId,
  withContentHash,
  type ActorRef,
  type AgentDirectiveId,
  type AgentSummaryId,
  type AgentSummaryRecord,
  type EvidenceId,
  type IsoTimestamp,
  type KnowledgeSourceId,
  type VerificationId,
  type WorkItem
} from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { recordEvidence, verifySubject } from "@boreal/evidence-engine";
import { createClaim, createDecision, createKnowledgeSource } from "@boreal/knowledge-engine";
import { InMemoryBorealStore } from "@boreal/storage";
import { closeWork as closeWorkDomain } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "codex-runtime-test",
  kind: "agent",
  displayName: "Codex Runtime Test"
};

function closeoutSummaryFor(
  work: WorkItem,
  input: {
    readonly evidenceIds?: readonly EvidenceId[];
    readonly verificationIds?: readonly VerificationId[];
    readonly nonce?: string;
  } = {}
): AgentSummaryRecord {
  const generatedAt = "2026-01-01T00:00:00.000Z" as IsoTimestamp;
  const subjectType = work.kind === "sprint" ? "sprint" : work.kind === "milestone" ? "milestone" : "work";
  const summaryId = deterministicId<AgentSummaryId>("summary", {
    subjectId: work.meta.id,
    title: work.title,
    nonce: input.nonce ?? "runtime-test-closeout"
  });
  return withContentHash({
    meta: createRecordMeta({
      id: summaryId,
      now: generatedAt,
      actor,
      tags: ["agent-summary", "closeout"]
    }),
    subjectId: work.meta.id,
    subjectType,
    summaryKind: subjectType === "sprint" || subjectType === "milestone" ? subjectType : "task",
    status: "final",
    outcome: "completed",
    title: `Closeout summary: ${work.title}`,
    body: "Runtime test closeout summary.",
    completedWork: [
      {
        workId: work.meta.id,
        title: work.title,
        outcome: "completed",
        notes: "Runtime test closeout."
      }
    ],
    evidenceIds: input.evidenceIds ?? [],
    verificationIds: input.verificationIds ?? [],
    commitShas: ["abc1234"],
    dirtyPathNotes: [],
    childSummaryIds: [],
    artifactUri: `agent-summaries/${summaryId}.md`,
    generatedAt
  } satisfies AgentSummaryRecord);
}

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

  it("persists required closeout gates on work records and views", async () => {
    const runtime = createBorealRuntime({ actor });
    const work = await runtime.createWork({
      title: "Runtime gate metadata target",
      description: "Runtime view should carry the full task specification.",
      acceptanceCriteria: ["gate metadata is visible"],
      sourceRefs: [{ uri: "file://gate-source.md", label: "Gate Source" }],
      requiredCloseoutGates: [
        {
          kind: "verification",
          declaredCommand: "pnpm test -- runtime-flow",
          expectedObservable: "passed"
        },
        { kind: "review", scope: "descendants" }
      ]
    });
    const legacy = await runtime.createWork({ title: "Legacy no-gate target" });

    expect(work.requiredCloseoutGates).toEqual([
      expect.objectContaining({
        id: expect.stringMatching(/^bw_gate_[a-f0-9]{16}$/),
        subjectId: work.meta.id,
        subjectType: "work",
        kind: "verification",
        scope: "self",
        status: "open",
        requiredEvidenceKinds: ["command", "test", "diff", "review", "artifact"],
        requiredOutcome: "passed",
        minEvidenceCount: 1,
        declaredCommand: "pnpm test -- runtime-flow",
        expectedObservable: "passed"
      }),
      expect.objectContaining({
        subjectId: work.meta.id,
        kind: "review",
        scope: "descendants",
        requiredEvidenceKinds: ["review"]
      })
    ]);
    expect(legacy.requiredCloseoutGates).toBeUndefined();

    const view = await runtime.getWorkView(work.meta.id);
    const legacyView = await runtime.getWorkView(legacy.meta.id);
    expect(view.requiredCloseoutGates).toEqual(work.requiredCloseoutGates);
    expect(view).toMatchObject({
      description: "Runtime view should carry the full task specification.",
      acceptanceCriteria: ["gate metadata is visible"],
      sourceRefs: [{ uri: "file://gate-source.md", label: "Gate Source" }]
    });
    expect(legacyView.requiredCloseoutGates).toEqual([]);

    const projections = await runtime.rebuildProjections();
    const projected = projections.find((entry) => entry.id === work.meta.id);
    expect(projected?.requiredCloseoutGates).toEqual(work.requiredCloseoutGates);
  });

  it("refreshes a subject context pack after evidence, verification, and close mutations", async () => {
    let tick = 0;
    const runtime = createBorealRuntime({
      actor,
      clock: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++))
    });
    const work = await runtime.createWork({
      title: "Fresh context mutation target",
      description: "Initial context body.",
      acceptanceCriteria: ["context observes mutations"]
    });
    await runtime.rebuildProjections();
    const before = await runtime.getContextPack(work.meta.id);

    const evidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "fresh mutation evidence passed",
      outcome: "passed"
    });
    const afterEvidence = await runtime.getContextPack(work.meta.id);
    expect(afterEvidence.generatedAt).not.toBe(before.generatedAt);
    expect(afterEvidence.evidence).toContain("passed: fresh mutation evidence passed");
    expect(afterEvidence.facts).toContain("status: needs_verification");

    const verification = await runtime.verifyWork({ workId: work.meta.id, verdict: "passed", evidenceIds: [evidence.meta.id] });
    const afterVerification = await runtime.getContextPack(work.meta.id);
    expect(afterVerification.facts).toContain("status: verified");

    await runtime.closeWork({
      workId: work.meta.id,
      reason: "context refresh verified",
      agentSummary: closeoutSummaryFor(work, {
        evidenceIds: [evidence.meta.id],
        verificationIds: [verification.meta.id],
        nonce: "context-refresh"
      })
    });
    const afterClose = await runtime.getContextPack(work.meta.id);
    expect(afterClose.facts).toContain("status: closed");
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
    const foundationVerification = await runtime.verifyWork({
      workId: foundation.meta.id,
      verdict: "passed",
      evidenceIds: [foundationEvidence.meta.id],
      notes: "The storage tests cover rollback behavior."
    });
    await runtime.closeWork({
      workId: foundation.meta.id,
      reason: "verified by test evidence",
      agentSummary: closeoutSummaryFor(foundation, {
        evidenceIds: [foundationEvidence.meta.id],
        verificationIds: [foundationVerification.meta.id],
        nonce: "foundation"
      })
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
    await runtime.releaseWorkReservation(feature.meta.id);

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
      reason: "proof slice verified",
      agentSummary: closeoutSummaryFor(feature, {
        evidenceIds: [featureEvidence.meta.id],
        verificationIds: [verification.meta.id],
        nonce: "feature"
      })
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

	  it("enforces agent summary policy at the runtime close boundary", async () => {
	    const store = new InMemoryBorealStore();
	    const runtime = createBorealRuntime({ store, actor });
	    const work = await runtime.createWork({ title: "Runtime summary policy target", ready: true });
	    const evidence = await runtime.recordEvidence({
	      subjectId: work.meta.id,
	      subjectType: "work",
	      kind: "test",
	      summary: "summary policy evidence passed",
	      outcome: "passed"
	    });
	    const verification = await runtime.verifyWork({
	      workId: work.meta.id,
	      verdict: "passed",
	      evidenceIds: [evidence.meta.id]
	    });

	    await expect(runtime.closeWork({ workId: work.meta.id, reason: "missing summary" })).rejects.toMatchObject({
	      code: "BOREAL_POLICY_VIOLATION"
	    } satisfies Partial<BorealError>);
	    const closed = await runtime.closeWork({
	      workId: work.meta.id,
	      reason: "summary provided",
	      agentSummary: closeoutSummaryFor(work, {
	        evidenceIds: [evidence.meta.id],
	        verificationIds: [verification.meta.id],
	        nonce: "runtime-policy"
	      })
	    });

	    expect(closed.status).toBe("closed");
	    const summaries = await store.read((reader) => reader.listAgentSummariesForSubject(work.meta.id));
	    expect(summaries).toEqual([
	      expect.objectContaining({ subjectId: work.meta.id, status: "final" })
	    ]);
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

  it("canonicalizes deterministic evidence and knowledge inputs before hashing", () => {
    const now = "2026-01-01T00:00:00.000Z" as IsoTimestamp;
    const evidence = recordEvidence({
      subjectId: "bw_work_subject",
      subjectType: "work",
      kind: "test",
      summary: "  Command   passed  ",
      outcome: "passed",
      uri: " file://reports/test.json ",
      actor,
      now
    });
    const sameEvidence = recordEvidence({
      subjectId: "bw_work_subject",
      subjectType: "work",
      kind: "test",
      summary: "Command passed",
      outcome: "passed",
      uri: "file://reports/test.json",
      actor,
      now
    });
    const otherEvidence = recordEvidence({
      subjectId: "bw_work_subject",
      subjectType: "work",
      kind: "artifact",
      summary: "Other evidence",
      outcome: "observed",
      actor,
      now
    });

    expect(evidence.meta.id).toBe(sameEvidence.meta.id);
    expect(evidence.summary).toBe("Command passed");
    expect(evidence.uri).toBe("file://reports/test.json");
    expect(evidence.meta.contentHash).toBe(sameEvidence.meta.contentHash);

    const verification = verifySubject({
      subjectId: "bw_work_subject",
      subjectType: "work",
      verdict: "passed",
      evidenceIds: [otherEvidence.meta.id, evidence.meta.id, evidence.meta.id],
      availableEvidence: [evidence, otherEvidence],
      notes: "  Verified   by test  ",
      policy: { requireEvidenceForVerification: true },
      actor,
      now
    });
    const sameVerification = verifySubject({
      subjectId: "bw_work_subject",
      subjectType: "work",
      verdict: "passed",
      evidenceIds: [evidence.meta.id, otherEvidence.meta.id],
      availableEvidence: [otherEvidence, evidence],
      notes: "Verified by test",
      policy: { requireEvidenceForVerification: true },
      actor,
      now
    });
    expect(verification.meta.id).toBe(sameVerification.meta.id);
    expect(verification.evidenceIds).toEqual([evidence.meta.id, otherEvidence.meta.id].sort());
    expect(verification.meta.contentHash).toBe(sameVerification.meta.contentHash);

    const source = createKnowledgeSource({
      kind: "document",
      title: "  Runtime   note  ",
      uri: " file://runtime.md ",
      summary: "",
      actor,
      now
    });
    const sameSource = createKnowledgeSource({
      kind: "document",
      title: "Runtime note",
      uri: "file://runtime.md",
      summary: "",
      actor,
      now
    });
    expect(source.meta.id).toBe(sameSource.meta.id);
    expect(source.meta.contentHash).toBe(sameSource.meta.contentHash);

    const claim = createClaim({
      statement: "  Runtime   facts are stable.  ",
      status: "accepted",
      sourceIds: [source.meta.id, source.meta.id],
      evidenceIds: [otherEvidence.meta.id, evidence.meta.id, evidence.meta.id],
      wikiPageIds: [" Wiki/Runtime ", "Wiki/Runtime"],
      actor,
      now
    });
    const sameClaim = createClaim({
      statement: "Runtime facts are stable.",
      status: "accepted",
      sourceIds: [source.meta.id],
      evidenceIds: [evidence.meta.id, otherEvidence.meta.id],
      wikiPageIds: ["Wiki/Runtime"],
      actor,
      now
    });
    expect(claim.meta.id).toBe(sameClaim.meta.id);
    expect(claim.evidenceIds).toEqual([evidence.meta.id, otherEvidence.meta.id].sort());
    expect(claim.wikiPageIds).toEqual(["Wiki/Runtime"]);
    expect(claim.meta.contentHash).toBe(sameClaim.meta.contentHash);

    const decision = createDecision({
      title: "  Runtime decision ",
      context: "  Keep   inputs canonical. ",
      decision: "  Sort and trim deterministic fields. ",
      status: "accepted",
      consequences: [" B ", "A", "A"],
      sourceIds: [source.meta.id, source.meta.id],
      wikiPageIds: [" Wiki/Runtime ", "Wiki/Runtime"],
      actor,
      now
    });
    const sameDecision = createDecision({
      title: "Runtime decision",
      context: "Keep inputs canonical.",
      decision: "Sort and trim deterministic fields.",
      status: "accepted",
      consequences: ["A", "B"],
      sourceIds: [source.meta.id],
      wikiPageIds: ["Wiki/Runtime"],
      actor,
      now
    });
    expect(decision.meta.id).toBe(sameDecision.meta.id);
    expect(decision.consequences).toEqual(["A", "B"]);
    expect(decision.meta.contentHash).toBe(sameDecision.meta.contentHash);
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

  it("keeps work blocked when adding a resolved blocker beside an open blocker", async () => {
    const runtime = createBorealRuntime({ actor });
    const openBlocker = await runtime.createWork({ title: "Open blocker", ready: true });
    const resolvedBlocker = await runtime.createWork({ title: "Resolved blocker", ready: true });
    const blocked = await runtime.createWork({ title: "Blocked by full graph", ready: true });

    await runtime.addBlockingDependency({
      blockedWorkId: blocked.meta.id,
      blockingWorkId: openBlocker.meta.id
    });
    const evidence = await runtime.recordEvidence({
      subjectId: resolvedBlocker.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "resolved blocker passed",
      outcome: "passed"
    });
    const resolvedVerification = await runtime.verifyWork({
      workId: resolvedBlocker.meta.id,
      verdict: "passed",
      evidenceIds: [evidence.meta.id]
    });
    await runtime.closeWork({
      workId: resolvedBlocker.meta.id,
      reason: "resolved before adding dependency",
      agentSummary: closeoutSummaryFor(resolvedBlocker, {
        evidenceIds: [evidence.meta.id],
        verificationIds: [resolvedVerification.meta.id],
        nonce: "resolved-blocker"
      })
    });

    const updated = await runtime.addBlockingDependency({
      blockedWorkId: blocked.meta.id,
      blockingWorkId: resolvedBlocker.meta.id
    });

    expect(updated.status).toBe("blocked");
    expect(updated.dependencyIds).toEqual(expect.arrayContaining([openBlocker.meta.id, resolvedBlocker.meta.id]));
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

  it("refuses direct close while work has an active reservation and cleans up expired reservations", async () => {
    let current = new Date("2026-01-01T00:00:00.000Z");
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({
      store,
      actor,
      clock: () => current
    });
    const work = await runtime.createWork({ title: "Direct close reservation guard" });
    await runtime.markReady(work.meta.id);
    await runtime.reserveWork({
      workId: work.meta.id,
      agentId: "agent-a",
      expiresAt: "2026-01-01T00:10:00.000Z" as IsoTimestamp
    });
    const evidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "close guard evidence passed",
      outcome: "passed"
    });
    const verification = await runtime.verifyWork({ workId: work.meta.id, verdict: "passed", evidenceIds: [evidence.meta.id] });

    await expect(runtime.closeWork({ workId: work.meta.id, reason: "direct close while active" })).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION"
    } satisfies Partial<BorealError>);
    await expect(runtime.getWorkView(work.meta.id)).resolves.toMatchObject({
      status: "verified",
      activeReservationId: expect.any(String)
    });

    current = new Date("2026-01-01T00:11:00.000Z");
    const closed = await runtime.closeWork({
      workId: work.meta.id,
      reason: "expired reservation no longer owns close",
      agentSummary: closeoutSummaryFor(work, {
        evidenceIds: [evidence.meta.id],
        verificationIds: [verification.meta.id],
        nonce: "expired-reservation"
      })
    });
    expect(closed.status).toBe("closed");
    await expect(runtime.getWorkView(work.meta.id)).resolves.toMatchObject({
      status: "closed",
      activeReservationId: undefined
    });
    const reservations = await store.read((reader) => reader.listReservationsForWork(work.meta.id));
    expect(reservations).toEqual([expect.objectContaining({ status: "expired" })]);
    const events = await runtime.listEvents();
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["work.reservation_expired", "work.closed"])
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
        reason: "verified atomically",
        agentSummary: ({ closedWork, evidence, verification }) =>
          closeoutSummaryFor(closedWork, {
            evidenceIds: [evidence.meta.id],
            verificationIds: [verification.meta.id],
            nonce: "finish-reserved"
          })
      }
    });

    expect(finished.work.status).toBe("closed");
    expect(finished.work.reservationId).toBeUndefined();
    expect(finished.evidence.outcome).toBe("passed");
    expect(finished.verification.verdict).toBe("passed");
    expect(finished.reservation.status).toBe("released");
    expect(finished.release.work.status).toBe("closed");
    expect(finished.closedWork?.closedReason).toBe("verified atomically");
    expect(finished.agentSummary?.subjectId).toBe(work.meta.id);

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

  it("requires review gate evidence before direct runtime close", async () => {
    const runtime = createBorealRuntime({ actor });
    const work = await runtime.createWork({
      title: "Runtime review gate target",
      ready: true,
      requiredCloseoutGates: [{ kind: "review" }]
    });
    const testEvidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "ordinary verification evidence passed",
      outcome: "passed"
    });
    const verification = await runtime.verifyWork({
      workId: work.meta.id,
      verdict: "passed",
      evidenceIds: [testEvidence.meta.id]
    });

    await expect(
      runtime.closeWork({
        workId: work.meta.id,
        reason: "missing review evidence",
        agentSummary: closeoutSummaryFor(work, {
          evidenceIds: [testEvidence.meta.id],
          verificationIds: [verification.meta.id],
          nonce: "review-gate-missing"
        })
      })
    ).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      details: expect.objectContaining({
        gateGaps: expect.arrayContaining([
          expect.objectContaining({
            gateKind: "review",
            gateScope: "self",
            subjectId: work.meta.id,
            targetId: work.meta.id,
            reason: "required gate has no satisfying evidence"
          })
        ])
      })
    } satisfies Partial<BorealError>);

    const reviewEvidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "review",
      summary: "required review passed",
      outcome: "passed"
    });
    const closed = await runtime.closeWork({
      workId: work.meta.id,
      reason: "review evidence present",
      agentSummary: closeoutSummaryFor(work, {
        evidenceIds: [testEvidence.meta.id, reviewEvidence.meta.id],
        verificationIds: [verification.meta.id],
        nonce: "review-gate-satisfied"
      })
    });

    expect(closed.status).toBe("closed");
    expect(closed.requiredCloseoutGates?.[0]).toEqual(
      expect.objectContaining({
        status: "satisfied",
        satisfiedBy: expect.objectContaining({
          evidenceIds: [reviewEvidence.meta.id]
        })
      })
    );
  });

  it("emits typed enforcement gaps from policy failures", async () => {
    const runtime = createBorealRuntime({
      actor,
      policy: { maxActiveReservationsPerAgent: 1 }
    });
    const draft = await runtime.createWork({ title: "Gap draft reservation target" });

    await expect(runtime.reserveWork({ workId: draft.meta.id, agentId: "agent-a" })).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      gaps: [expect.objectContaining({ code: "reservation.not-ready", subjectId: draft.meta.id })]
    } satisfies Partial<BorealError>);

    const first = await runtime.createWork({ title: "Gap first reservation target", ready: true });
    const second = await runtime.createWork({ title: "Gap second reservation target", ready: true });
    await runtime.reserveWork({ workId: first.meta.id, agentId: "agent-a" });
    await expect(runtime.reserveWork({ workId: second.meta.id, agentId: "agent-a" })).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      gaps: [expect.objectContaining({ code: "reservation.capacity-exceeded", subjectId: second.meta.id })]
    } satisfies Partial<BorealError>);

    await expect(runtime.closeWork({ workId: second.meta.id, reason: "missing summary" })).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      gaps: [expect.objectContaining({ code: "summary.missing", subjectId: second.meta.id })]
    } satisfies Partial<BorealError>);

    expect(() =>
      closeWorkDomain(
        second,
        [],
        { requirePassingVerificationForClose: true },
        "2026-01-01T00:00:00.000Z" as IsoTimestamp,
        actor,
        "missing verification"
      )
    ).toThrow(
      expect.objectContaining({
        code: "BOREAL_POLICY_VIOLATION",
        gaps: [expect.objectContaining({ code: "close.no-passing-verification", subjectId: second.meta.id })]
      } satisfies Partial<BorealError>)
    );
  });

  it("enforces declared closeout gate command and observable constraints", async () => {
    const runtime = createBorealRuntime({ actor });
    const declaredCommand = "pnpm test --token=<redacted>";
    const expectedObservable = "expected pass";

    const commandMismatch = await runtime.createWork({
      title: "Declared command mismatch target",
      ready: true,
      requiredCloseoutGates: [{ kind: "verification", declaredCommand, expectedObservable }]
    });
    const wrongCommandEvidence = await runtime.recordEvidence({
      subjectId: commandMismatch.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "expected pass",
      outcome: "passed",
      command: "pnpm test --other"
    });
    const wrongCommandVerification = await runtime.verifyWork({
      workId: commandMismatch.meta.id,
      verdict: "passed",
      evidenceIds: [wrongCommandEvidence.meta.id]
    });
    await expect(
      runtime.closeWork({
        workId: commandMismatch.meta.id,
        reason: "wrong command",
        agentSummary: closeoutSummaryFor(commandMismatch, {
          evidenceIds: [wrongCommandEvidence.meta.id],
          verificationIds: [wrongCommandVerification.meta.id],
          nonce: "declared-command-mismatch"
        })
      })
    ).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      gaps: [expect.objectContaining({ code: "gate.declared-command.mismatch", subjectId: commandMismatch.meta.id })]
    } satisfies Partial<BorealError>);

    const observableMismatch = await runtime.createWork({
      title: "Declared observable mismatch target",
      ready: true,
      requiredCloseoutGates: [{ kind: "verification", declaredCommand, expectedObservable }]
    });
    const missingObservableEvidence = await runtime.recordEvidence({
      subjectId: observableMismatch.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "different output",
      outcome: "passed",
      command: "pnpm test --token=secret"
    });
    expect(missingObservableEvidence.command).toBe(declaredCommand);
    const missingObservableVerification = await runtime.verifyWork({
      workId: observableMismatch.meta.id,
      verdict: "passed",
      evidenceIds: [missingObservableEvidence.meta.id]
    });
    await expect(
      runtime.closeWork({
        workId: observableMismatch.meta.id,
        reason: "missing observable",
        agentSummary: closeoutSummaryFor(observableMismatch, {
          evidenceIds: [missingObservableEvidence.meta.id],
          verificationIds: [missingObservableVerification.meta.id],
          nonce: "declared-observable-mismatch"
        })
      })
    ).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      gaps: [expect.objectContaining({ code: "gate.expected-observable.mismatch", subjectId: observableMismatch.meta.id })]
    } satisfies Partial<BorealError>);

    const satisfied = await runtime.createWork({
      title: "Declared gate satisfied target",
      ready: true,
      requiredCloseoutGates: [{ kind: "verification", declaredCommand, expectedObservable }]
    });
    const matchingEvidence = await runtime.recordEvidence({
      subjectId: satisfied.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "expected pass",
      outcome: "passed",
      command: "pnpm test --token=secret"
    });
    const matchingVerification = await runtime.verifyWork({
      workId: satisfied.meta.id,
      verdict: "passed",
      evidenceIds: [matchingEvidence.meta.id]
    });
    const closed = await runtime.closeWork({
      workId: satisfied.meta.id,
      reason: "declared gate satisfied",
      agentSummary: closeoutSummaryFor(satisfied, {
        evidenceIds: [matchingEvidence.meta.id],
        verificationIds: [matchingVerification.meta.id],
        nonce: "declared-gate-satisfied"
      })
    });
    expect(closed.requiredCloseoutGates?.[0]).toEqual(expect.objectContaining({ status: "satisfied" }));

    const finishTarget = await runtime.createWork({
      title: "Declared gate finish path target",
      ready: true,
      requiredCloseoutGates: [{ kind: "verification", declaredCommand, expectedObservable }]
    });
    await runtime.reserveWork({ workId: finishTarget.meta.id, agentId: actor.id });
    const finished = await runtime.finishReservedWork({
      workId: finishTarget.meta.id,
      agentId: actor.id,
      evidence: {
        kind: "test",
        summary: "expected pass",
        outcome: "passed",
        command: "pnpm test --token=secret"
      },
      verification: { verdict: "passed" },
      close: {
        reason: "declared finish gate satisfied",
        agentSummary: ({ evidence, verification }) =>
          closeoutSummaryFor(finishTarget, {
            evidenceIds: [evidence.meta.id],
            verificationIds: [verification.meta.id],
            nonce: "declared-gate-finish"
          })
      }
    });
    expect(finished.closedWork?.status).toBe("closed");
    expect(finished.closedWork?.requiredCloseoutGates?.[0]).toEqual(expect.objectContaining({ status: "satisfied" }));
  });

  it("preserves directive links when satisfying closeout gates", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({ store, actor });
    const directiveIds = ["closeout.summary-required" as AgentDirectiveId];
    const acknowledgementIds = ["ack.closeout.summary-required"];
    const work = await runtime.createWork({
      title: "Directive-linked review gate target",
      ready: true,
      requiredCloseoutGates: [{ kind: "review" }]
    });
    const gate = work.requiredCloseoutGates?.[0];
    if (!gate) {
      throw new Error("expected required gate fixture");
    }
    await store.write((writer) =>
      writer.putWorkItem({
        ...work,
        requiredCloseoutGates: [
          {
            ...gate,
            satisfiedBy: {
              directiveIds,
              acknowledgementIds
            }
          }
        ]
      })
    );
    const testEvidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "verification evidence passed",
      outcome: "passed"
    });
    const verification = await runtime.verifyWork({
      workId: work.meta.id,
      verdict: "passed",
      evidenceIds: [testEvidence.meta.id]
    });
    const reviewEvidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "review",
      summary: "directive-linked review passed",
      outcome: "passed"
    });

    const closed = await runtime.closeWork({
      workId: work.meta.id,
      reason: "review evidence present",
      agentSummary: closeoutSummaryFor(work, {
        evidenceIds: [testEvidence.meta.id, reviewEvidence.meta.id],
        verificationIds: [verification.meta.id],
        nonce: "directive-linked-review-gate"
      })
    });

    expect(closed.requiredCloseoutGates?.[0]?.satisfiedBy).toEqual(
      expect.objectContaining({
        evidenceIds: [reviewEvidence.meta.id],
        directiveIds,
        acknowledgementIds
      })
    );
  });

  it("enforces required gates against pending agent finish evidence", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({ store, actor });
    const work = await runtime.createWork({
      title: "Finish review gate target",
      ready: true,
      requiredCloseoutGates: [{ kind: "review" }]
    });
    await runtime.reserveWork({ workId: work.meta.id, agentId: "review-agent" });

    await expect(
      runtime.finishReservedWork({
        workId: work.meta.id,
        agentId: "review-agent",
        evidence: {
          kind: "test",
          summary: "test evidence alone is not review evidence",
          outcome: "passed"
        },
        verification: {
          verdict: "passed"
        },
        close: {
          reason: "missing review gate",
          agentSummary: ({ closedWork, evidence, verification }) =>
            closeoutSummaryFor(closedWork, {
              evidenceIds: [evidence.meta.id],
              verificationIds: [verification.meta.id],
              nonce: "finish-gate-missing"
            })
        }
      })
    ).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      details: expect.objectContaining({
        gateGaps: expect.arrayContaining([
          expect.objectContaining({
            gateKind: "review",
            subjectId: work.meta.id,
            targetId: work.meta.id
          })
        ])
      })
    } satisfies Partial<BorealError>);

    const afterFailedFinish = await store.read(async (reader) => ({
      work: await reader.getWorkItem(work.meta.id),
      evidence: await reader.listEvidenceForSubject(work.meta.id),
      verifications: await reader.listVerificationsForSubject(work.meta.id),
      summaries: await reader.listAgentSummariesForSubject(work.meta.id)
    }));
    expect(afterFailedFinish.work?.status).toBe("in_progress");
    expect(afterFailedFinish.evidence).toHaveLength(0);
    expect(afterFailedFinish.verifications).toHaveLength(0);
    expect(afterFailedFinish.summaries).toHaveLength(0);

    const finished = await runtime.finishReservedWork({
      workId: work.meta.id,
      agentId: "review-agent",
      evidence: {
        kind: "review",
        summary: "finish review evidence passed",
        outcome: "passed"
      },
      verification: {
        verdict: "passed"
      },
      close: {
        reason: "review gate satisfied",
        agentSummary: ({ closedWork, evidence, verification }) =>
          closeoutSummaryFor(closedWork, {
            evidenceIds: [evidence.meta.id],
            verificationIds: [verification.meta.id],
            nonce: "finish-gate-satisfied"
          })
      }
    });

    expect(finished.work.status).toBe("closed");
    expect(finished.work.requiredCloseoutGates?.[0]).toEqual(
      expect.objectContaining({
        status: "satisfied",
        satisfiedBy: expect.objectContaining({
          evidenceIds: [finished.evidence.meta.id],
          verificationIds: []
        })
      })
    );
  });

  it("refuses sprint closeout while descendant work remains unresolved", async () => {
    const runtime = createBorealRuntime({ actor });
    const sprint = await runtime.createWork({ title: "Container gate sprint", kind: "sprint", ready: true });
    const child = await runtime.createWork({ title: "Container gate child", ready: true });
    await runtime.addBlockingDependency({
      blockedWorkId: sprint.meta.id,
      blockingWorkId: child.meta.id
    });

    const sprintEvidence = await runtime.recordEvidence({
      subjectId: sprint.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "sprint evidence passed",
      outcome: "passed"
    });
    const sprintVerification = await runtime.verifyWork({
      workId: sprint.meta.id,
      verdict: "passed",
      evidenceIds: [sprintEvidence.meta.id]
    });

    await expect(
      runtime.closeWork({
        workId: sprint.meta.id,
        reason: "child still open",
        agentSummary: closeoutSummaryFor(sprint, {
          evidenceIds: [sprintEvidence.meta.id],
          verificationIds: [sprintVerification.meta.id],
          nonce: "sprint-open-child"
        })
      })
    ).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      details: expect.objectContaining({
        gateGaps: expect.arrayContaining([
          expect.objectContaining({
            gateKind: "descendant_work",
            gateScope: "descendants",
            subjectId: sprint.meta.id,
            targetId: child.meta.id,
            reason: "descendant work is ready"
          })
        ])
      })
    } satisfies Partial<BorealError>);

    const childEvidence = await runtime.recordEvidence({
      subjectId: child.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "child evidence passed",
      outcome: "passed"
    });
    const childVerification = await runtime.verifyWork({
      workId: child.meta.id,
      verdict: "passed",
      evidenceIds: [childEvidence.meta.id]
    });
    await runtime.closeWork({
      workId: child.meta.id,
      reason: "child resolved",
      agentSummary: closeoutSummaryFor(child, {
        evidenceIds: [childEvidence.meta.id],
        verificationIds: [childVerification.meta.id],
        nonce: "child-resolved"
      })
    });

    const closedSprint = await runtime.closeWork({
      workId: sprint.meta.id,
      reason: "descendants resolved",
      agentSummary: closeoutSummaryFor(sprint, {
        evidenceIds: [sprintEvidence.meta.id],
        verificationIds: [sprintVerification.meta.id],
        nonce: "sprint-resolved-child"
      })
    });
    expect(closedSprint.status).toBe("closed");
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

  it("rejects verification evidence from another subject", async () => {
    const runtime = createBorealRuntime({ actor });
    const target = await runtime.createWork({ title: "Evidence subject target" });
    const other = await runtime.createWork({ title: "Evidence subject other" });
    const otherEvidence = await runtime.recordEvidence({
      subjectId: other.meta.id,
      subjectType: "work",
      kind: "test",
      summary: "other work evidence passed",
      outcome: "passed"
    });

    await expect(
      runtime.verifyWork({
        workId: target.meta.id,
        verdict: "passed",
        evidenceIds: [otherEvidence.meta.id]
      })
    ).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      details: {
        mismatchedEvidence: [
          expect.objectContaining({
            evidenceId: otherEvidence.meta.id,
            subjectId: other.meta.id,
            subjectType: "work"
          })
        ]
      }
    } satisfies Partial<BorealError>);
  });

  it("redacts likely secrets before persisting evidence commands", async () => {
    const runtime = createBorealRuntime({ actor });
    const work = await runtime.createWork({ title: "Evidence redaction target" });
    const evidence = await runtime.recordEvidence({
      subjectId: work.meta.id,
      subjectType: "work",
      kind: "command",
      summary: "secret-bearing evidence command",
      outcome: "passed",
      command:
        "API_TOKEN=abc123 bwrk evidence add --token token123 --password=pw123 curl -H 'Authorization: Bearer bearer123' 'https://example.test/check?api_key=query123'"
    });

    expect(evidence.command).toContain("API_TOKEN=<redacted>");
    expect(evidence.command).toContain("--token <redacted>");
    expect(evidence.command).toContain("--password=<redacted>");
    expect(evidence.command).toContain("Bearer <redacted>");
    expect(evidence.command).toContain("api_key=<redacted>");
    expect(evidence.command).not.toContain("abc123");
    expect(evidence.command).not.toContain("token123");
    expect(evidence.command).not.toContain("pw123");
    expect(evidence.command).not.toContain("bearer123");
    expect(evidence.command).not.toContain("query123");
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
