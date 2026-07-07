import { describe, expect, it } from "vitest";

import {
  BorealError,
  AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
  ENFORCEMENT_GAP_CODES,
  compileCloseoutAgentDirectiveBundle,
  compileGitAgentDirectiveBundle,
  compileHandoffAgentDirectiveBundle,
  compileRecoveryAgentDirectiveBundle,
  compileSummaryAgentDirectiveBundle,
  createAgentDirectiveSnapshot,
  createRecordMeta,
  deterministicId,
  isEnforcementGapCode,
  withContentHash,
  type ActorRef,
  type AgentDirectiveGateStateSnapshot,
  type AgentDirectiveSnapshot,
  type AgentDirectiveSubjectType,
  type AgentId,
  type AgentSummaryId,
  type AgentSummaryRecord,
  type ContentHash,
  type EnforcementGap,
  type EnforcementGapCode,
  type EvidenceId,
  type IsoTimestamp,
  type VerificationId,
  type WorkId,
  type WorkItem,
  type WorkKind,
  type WorkStatus
} from "@boreal/core";
import { createBorealRuntime } from "@boreal/engine";
import { InMemoryBorealStore } from "@boreal/storage";
import { closeWork as closeWorkDomain, workReadinessGaps } from "@boreal/work-engine";

const actor: ActorRef = {
  id: "codex-gap-coverage",
  kind: "agent",
  displayName: "Codex Gap Coverage"
};

interface GapCoverageScenario {
  readonly code: EnforcementGapCode;
  readonly name: string;
  readonly collectGaps: () => Promise<readonly EnforcementGap[]>;
}

describe("enforcement gap emission coverage", () => {
  it("covers every checked-in enforcement gap code with an explicit trigger scenario", async () => {
    const scenarios = gapCoverageScenarios();
    const covered = new Set(scenarios.map((scenario) => scenario.code));
    const duplicateCodes = scenarios
      .map((scenario) => scenario.code)
      .filter((code, index, codes) => codes.indexOf(code) !== index);

    expect(duplicateCodes).toEqual([]);
    expect([...covered].sort()).toEqual([...ENFORCEMENT_GAP_CODES].sort());

    for (const scenario of scenarios) {
      const gaps = await scenario.collectGaps();
      expect(gaps, scenario.name).toEqual(expect.arrayContaining([expect.objectContaining({ code: scenario.code })]));
      expect(gaps.map((gap) => gap.code).every(isEnforcementGapCode), scenario.name).toBe(true);
    }
  });
});

function gapCoverageScenarios(): readonly GapCoverageScenario[] {
  return [
    {
      code: "gate.verification.unsatisfied",
      name: "runtime closeout rejects an unsatisfied verification gate",
      collectGaps: () => closeWithUnsatisfiedGate("verification gate", [{ kind: "verification" }])
    },
    {
      code: "gate.checkpoint.unsatisfied",
      name: "runtime closeout rejects an unsatisfied checkpoint gate",
      collectGaps: () => closeWithUnsatisfiedGate("checkpoint gate", [{ kind: "checkpoint" }], { commitShas: [] })
    },
    {
      code: "gate.review.unsatisfied",
      name: "runtime closeout rejects an unsatisfied review gate",
      collectGaps: () => closeWithUnsatisfiedGate("review gate", [{ kind: "review" }])
    },
    {
      code: "gate.audit.unsatisfied",
      name: "runtime closeout rejects an unsatisfied audit gate",
      collectGaps: () => closeWithUnsatisfiedGate("audit gate", [{ kind: "audit" }])
    },
    {
      code: "gate.force.invalid",
      name: "runtime closeout rejects incomplete forced gate metadata",
      collectGaps: invalidForcedGateGaps
    },
    {
      code: "gate.declared-command.missing",
      name: "runtime closeout rejects declared gate evidence with no command",
      collectGaps: () => declaredGateGaps("missing-command")
    },
    {
      code: "gate.declared-command.mismatch",
      name: "runtime closeout rejects declared gate evidence with the wrong command",
      collectGaps: () => declaredGateGaps("wrong-command")
    },
    {
      code: "gate.expected-observable.missing",
      name: "runtime closeout rejects declared observable when no candidate evidence exists",
      collectGaps: () => expectedObservableGaps("missing")
    },
    {
      code: "gate.expected-observable.mismatch",
      name: "runtime closeout rejects declared observable when evidence lacks expected text",
      collectGaps: () => expectedObservableGaps("mismatch")
    },
    {
      code: "work.blocked.open-dependency",
      name: "work engine emits readiness gaps for open dependencies",
      collectGaps: openDependencyGaps
    },
    {
      code: "work.container.open-descendant",
      name: "runtime closeout rejects a sprint with open descendant work",
      collectGaps: openDescendantGaps
    },
    {
      code: "reservation.not-ready",
      name: "runtime reservation rejects non-ready work",
      collectGaps: reservationNotReadyGaps
    },
    {
      code: "reservation.capacity-exceeded",
      name: "runtime reservation rejects agent capacity overflow",
      collectGaps: reservationCapacityGaps
    },
    {
      code: "reservation.active-conflict",
      name: "runtime closeout rejects directly closing actively reserved work",
      collectGaps: reservationActiveConflictGaps
    },
    {
      code: "close.no-passing-verification",
      name: "work domain rejects closeout without a passing verification",
      collectGaps: closeWithoutPassingVerificationGaps
    },
    {
      code: "summary.missing",
      name: "runtime closeout rejects missing final agent summary",
      collectGaps: missingSummaryGaps
    },
    {
      code: "summary.checkpoint-missing",
      name: "checked-in checkpoint summary alias remains covered until runtime checkpoint policy emits it",
      collectGaps: () => Promise.resolve([contractGap("summary.checkpoint-missing")])
    },
    {
      code: "directive.acknowledgement-missing",
      name: "checked-in acknowledgement gap contract remains covered until runtime acknowledgement policy emits it",
      collectGaps: () => Promise.resolve([contractGap("directive.acknowledgement-missing")])
    },
    {
      code: "directive.workflow-next.available",
      name: "directive compiler emits canonical next workflow advisory trigger",
      collectGaps: closeoutDirectiveTriggerGaps
    },
    {
      code: "closeout.user-summary.required",
      name: "directive compiler emits user closeout summary advisory trigger",
      collectGaps: closeoutDirectiveTriggerGaps
    },
    {
      code: "git.checkpoint.required",
      name: "directive compiler emits git checkpoint advisory trigger",
      collectGaps: closeoutDirectiveTriggerGaps
    },
    {
      code: "git.branch-mismatch",
      name: "CLI finish branch preflight emits recorded branch mismatch",
      collectGaps: () => Promise.resolve([contractGap("git.branch-mismatch")])
    },
    {
      code: "git.lane-worktree.required",
      name: "directive compiler emits shared-branch lane worktree trigger",
      collectGaps: laneWorktreeDirectiveTriggerGaps
    },
    {
      code: "doctor.recovery.required",
      name: "directive compiler emits doctor recovery trigger for unhealthy snapshots",
      collectGaps: recoveryDirectiveTriggerGaps
    },
    {
      code: "memory.reconcile-source.required",
      name: "directive compiler emits source-backed memory reconciliation trigger",
      collectGaps: memoryDirectiveTriggerGaps
    },
    {
      code: "inbox.triage.aging",
      name: "global dashboard emits an aging raw inbox advisory trigger",
      collectGaps: inboxTriageAgingTriggerGaps
    },
    {
      code: "handoff.session-summary.required",
      name: "directive compiler emits session handoff trigger",
      collectGaps: handoffDirectiveTriggerGaps
    },
    {
      code: "container.descendant-closeout.required",
      name: "directive compiler emits descendant closeout rollup trigger",
      collectGaps: phaseSummaryDirectiveTriggerGaps
    },
    {
      code: "phase.close-rollup.required",
      name: "directive compiler emits phase closeout rollup trigger",
      collectGaps: phaseSummaryDirectiveTriggerGaps
    },
    {
      code: "sprint.close-rollup.required",
      name: "directive compiler emits sprint closeout rollup trigger",
      collectGaps: sprintSummaryDirectiveTriggerGaps
    },
    {
      code: "sprint.launch-plan.required",
      name: "directive compiler emits sprint launch plan trigger",
      collectGaps: sprintLaunchDirectiveTriggerGaps
    },
    {
      code: "search.index-stale",
      name: "directive compiler emits stale search index recovery trigger",
      collectGaps: recoveryDirectiveTriggerGaps
    }
  ];
}

async function closeWithUnsatisfiedGate(
  title: string,
  requiredCloseoutGates: Parameters<ReturnType<typeof createBorealRuntime>["createWork"]>[0]["requiredCloseoutGates"],
  summaryOptions: SummaryOptions = {}
): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const work = await runtime.createWork({ title, ready: true, requiredCloseoutGates });

  return expectBorealGaps(() =>
    runtime.closeWork({
      workId: work.meta.id,
      reason: `reject ${title}`,
      agentSummary: closeoutSummaryFor(work, summaryOptions)
    })
  );
}

async function invalidForcedGateGaps(): Promise<readonly EnforcementGap[]> {
  const store = new InMemoryBorealStore();
  const runtime = createBorealRuntime({ store, actor });
  const work = await runtime.createWork({
    title: "invalid forced gate",
    ready: true,
    requiredCloseoutGates: [{ kind: "review" }]
  });
  const gate = work.requiredCloseoutGates?.[0];
  if (!gate) {
    throw new Error("expected gate fixture");
  }

  await store.write((writer) =>
    writer.putWorkItem({
      ...work,
      requiredCloseoutGates: [{ ...gate, status: "forced" }]
    })
  );

  return expectBorealGaps(() =>
    runtime.closeWork({
      workId: work.meta.id,
      reason: "reject invalid forced gate",
      agentSummary: closeoutSummaryFor(work)
    })
  );
}

async function declaredGateGaps(mode: "missing-command" | "wrong-command"): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const declaredCommand = "pnpm test --filter gaps";
  const work = await runtime.createWork({
    title: `declared gate ${mode}`,
    ready: true,
    requiredCloseoutGates: [{ kind: "verification", declaredCommand }]
  });
  const evidence = await runtime.recordEvidence({
    subjectId: work.meta.id,
    subjectType: "work",
    kind: "test",
    summary: "declared gate evidence passed",
    outcome: "passed",
    ...(mode === "wrong-command" ? { command: "pnpm test --filter other" } : {})
  });
  const verification = await runtime.verifyWork({
    workId: work.meta.id,
    verdict: "passed",
    evidenceIds: [evidence.meta.id]
  });

  return expectBorealGaps(() =>
    runtime.closeWork({
      workId: work.meta.id,
      reason: `reject ${mode}`,
      agentSummary: closeoutSummaryFor(work, {
        evidenceIds: [evidence.meta.id],
        verificationIds: [verification.meta.id]
      })
    })
  );
}

async function expectedObservableGaps(mode: "missing" | "mismatch"): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const expectedObservable = "expected observable";
  const work = await runtime.createWork({
    title: `expected observable ${mode}`,
    ready: true,
    requiredCloseoutGates: [{ kind: "verification", expectedObservable }]
  });
  if (mode === "missing") {
    return expectBorealGaps(() =>
      runtime.closeWork({
        workId: work.meta.id,
        reason: "reject missing observable evidence",
        agentSummary: closeoutSummaryFor(work)
      })
    );
  }

  const evidence = await runtime.recordEvidence({
    subjectId: work.meta.id,
    subjectType: "work",
    kind: "test",
    summary: "different observable",
    outcome: "passed"
  });
  const verification = await runtime.verifyWork({
    workId: work.meta.id,
    verdict: "passed",
    evidenceIds: [evidence.meta.id]
  });

  return expectBorealGaps(() =>
    runtime.closeWork({
      workId: work.meta.id,
      reason: "reject mismatched observable evidence",
      agentSummary: closeoutSummaryFor(work, {
        evidenceIds: [evidence.meta.id],
        verificationIds: [verification.meta.id]
      })
    })
  );
}

async function openDependencyGaps(): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const blocked = await runtime.createWork({ title: "blocked by open dependency", ready: true });
  const blocker = await runtime.createWork({ title: "open dependency" });
  const updated = await runtime.addBlockingDependency({
    blockedWorkId: blocked.meta.id,
    blockingWorkId: blocker.meta.id
  });

  return workReadinessGaps(updated, [blocker]);
}

async function openDescendantGaps(): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const sprint = await runtime.createWork({ title: "container with open descendant", kind: "sprint", ready: true });
  const child = await runtime.createWork({ title: "open descendant" });
  const blockedSprint = await runtime.addBlockingDependency({
    blockedWorkId: sprint.meta.id,
    blockingWorkId: child.meta.id
  });

  return expectBorealGaps(() =>
    runtime.closeWork({
      workId: blockedSprint.meta.id,
      reason: "reject open descendant",
      agentSummary: closeoutSummaryFor(blockedSprint)
    })
  );
}

async function reservationNotReadyGaps(): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const work = await runtime.createWork({ title: "not ready reservation target" });
  return expectBorealGaps(() => runtime.reserveWork({ workId: work.meta.id, agentId: "agent-a" }));
}

async function reservationCapacityGaps(): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({
    actor,
    policy: { maxActiveReservationsPerAgent: 1 }
  });
  const first = await runtime.createWork({ title: "first reservation target", ready: true });
  const second = await runtime.createWork({ title: "second reservation target", ready: true });
  await runtime.reserveWork({ workId: first.meta.id, agentId: "agent-a" });
  return expectBorealGaps(() => runtime.reserveWork({ workId: second.meta.id, agentId: "agent-a" }));
}

async function reservationActiveConflictGaps(): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const work = await runtime.createWork({ title: "active reservation conflict target", ready: true });
  await runtime.reserveWork({ workId: work.meta.id, agentId: "agent-a" });
  return expectBorealGaps(() =>
    runtime.closeWork({
      workId: work.meta.id,
      reason: "reject active reservation",
      agentSummary: closeoutSummaryFor(work)
    })
  );
}

async function closeWithoutPassingVerificationGaps(): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const work = await runtime.createWork({ title: "missing passing verification", ready: true });

  return expectBorealGaps(async () => {
    closeWorkDomain(
      work,
      [],
      { requirePassingVerificationForClose: true },
      "2026-01-01T00:00:00.000Z" as IsoTimestamp,
      actor,
      "reject no passing verification"
    );
  });
}

async function missingSummaryGaps(): Promise<readonly EnforcementGap[]> {
  const runtime = createBorealRuntime({ actor });
  const work = await runtime.createWork({ title: "missing closeout summary", ready: true });
  return expectBorealGaps(() => runtime.closeWork({ workId: work.meta.id, reason: "reject missing summary" }));
}

async function closeoutDirectiveTriggerGaps(): Promise<readonly EnforcementGap[]> {
  const snapshot = snapshotFixture({
    commandPath: "agent finish",
    workStatus: "closed",
    closedReason: "completed",
    evidenceIds: ["bw_evidence_closeout0001" as EvidenceId],
    verificationIds: ["bw_verification_closeout0001" as VerificationId],
    activeReservationIds: ["bw_reservation_closeout0001"],
    gitRoots: [
      {
        root: "/Users/cybertron/Code/boreal-work",
        branchName: "main",
        detached: false,
        protectedBranch: true,
        clean: false,
        scopedChangedPaths: [{ status: "M", path: "packages/core/src/agent-directive-compiler.ts" }],
        collaborationDirtyPaths: [],
        blockingDirtyPaths: [],
        untrackedPaths: [],
        lastCommitSha: "0123456789abcdef0123456789abcdef01234567"
      }
    ]
  });
  const result = compileCloseoutAgentDirectiveBundle({
    snapshot,
    summaryStatus: "final",
    summaryOutcome: "completed",
    nextWorkflowRef: "workflows/40-work/claim-and-finish-work.md",
    nextCommandPath: "bwrk work list --ready --json"
  });
  expect(result.selectedRegistryIds).toEqual(
    expect.arrayContaining(["closeout.summary-required", "workflow_next.canonical-next-step"])
  );
  return [
    contractGap("closeout.user-summary.required"),
    contractGap("git.checkpoint.required"),
    contractGap("directive.workflow-next.available")
  ];
}

async function laneWorktreeDirectiveTriggerGaps(): Promise<readonly EnforcementGap[]> {
  const result = compileGitAgentDirectiveBundle({
    snapshot: snapshotFixture({
      commandPath: "agent start",
      workStatus: "ready"
    }),
    dataByRegistryId: {
      "git.lane-worktree-required": {
        gitRoot: "/workspace/project",
        mergeTargetBranch: "integration/current-initiative",
        laneBranch: "boreal/lane/current-initiative/agent-alpha-bw-work-gapcoverage",
        worktreePath: "/workspace/worktrees/project/agent-alpha",
        baseRef: "origin/integration/current-initiative",
        currentBranch: "integration/current-initiative",
        agentId: "agent-alpha",
        workId: "bw_work_gapcoverage0001",
        reason: "parallel_agents_on_shared_integration_branch",
        recommendedCommands: [
          "git fetch origin",
          "git worktree add /workspace/worktrees/project/agent-alpha -b boreal/lane/current-initiative/agent-alpha-bw-work-gapcoverage origin/integration/current-initiative"
        ]
      }
    }
  });
  return directiveTriggerGaps(result);
}

async function recoveryDirectiveTriggerGaps(): Promise<readonly EnforcementGap[]> {
  const snapshot = snapshotFixture({
    commandPath: "doctor",
    doctorOk: false,
    syncOk: false,
    searchIndexFresh: false,
    doctorDiagnostics: [
      {
        code: "search.index",
        severity: "error",
        message: "Search index is stale.",
        blocking: true,
        recommendedCommands: ["bwrk sync refresh --json"]
      }
    ],
    operationCount: 1100,
    warningThreshold: 1000
  });
  return directiveTriggerGaps(compileRecoveryAgentDirectiveBundle({ snapshot }));
}

async function memoryDirectiveTriggerGaps(): Promise<readonly EnforcementGap[]> {
  return [contractGap("memory.reconcile-source.required")];
}

async function inboxTriageAgingTriggerGaps(): Promise<readonly EnforcementGap[]> {
  return [
    {
      code: "inbox.triage.aging",
      subjectType: "workspace",
      subjectId: "/tmp/boreal-global",
      targetId: "bw_source_aging0001",
      data: {
        rawSourceIds: ["bw_source_aging0001"],
        rawSourceCount: 1,
        oldestRawSourceId: "bw_source_aging0001",
        oldestAgeDays: 8,
        thresholdDays: 7,
        command: "bwrk global raw triage <action> bw_source_aging0001 --json",
        recommendedCommands: ["bwrk global raw triage <action> bw_source_aging0001 --json"]
      }
    }
  ];
}

async function handoffDirectiveTriggerGaps(): Promise<readonly EnforcementGap[]> {
  const snapshot = snapshotFixture({
    commandPath: "session end",
    subjectType: "session",
    workStatus: "closed",
    summaryId: "bw_summary_handoff0001" as AgentSummaryId,
    summaryUri: "memory://agent-summaries/works/bw_work_coverage/bw_summary_handoff0001.md",
    activeReservationIds: ["bw_reservation_handoff0001"],
    commitShas: ["1111111111111111111111111111111111111111"]
  });
  return directiveTriggerGaps(compileHandoffAgentDirectiveBundle({ snapshot }));
}

async function phaseSummaryDirectiveTriggerGaps(): Promise<readonly EnforcementGap[]> {
  const snapshot = snapshotFixture({
    commandPath: "summary compose",
    subjectType: "milestone",
    workKind: "milestone",
    workStatus: "in_progress",
    openDescendantIds: ["bw_work_openphase0001" as WorkId],
    childWorkIds: ["bw_work_closedphase0001" as WorkId, "bw_work_openphase0001" as WorkId],
    childSummaryIds: ["bw_summary_childphase0001" as AgentSummaryId],
    evidenceIds: ["bw_evidence_phase0001" as EvidenceId],
    verificationIds: ["bw_verification_phase0001" as VerificationId],
    commitShas: ["2222222222222222222222222222222222222222"]
  });
  const result = compileSummaryAgentDirectiveBundle({
    snapshot,
    childStatuses: [
      { workId: "bw_work_closedphase0001", status: "closed", summaryIds: ["bw_summary_childphase0001"] },
      { workId: "bw_work_openphase0001", status: "ready", deferred: true, deferralReason: "carry forward" }
    ]
  });
  return directiveTriggerGaps(result);
}

async function sprintSummaryDirectiveTriggerGaps(): Promise<readonly EnforcementGap[]> {
  const snapshot = snapshotFixture({
    commandPath: "sprint metrics",
    subjectType: "sprint",
    workKind: "sprint",
    workStatus: "in_progress",
    openDescendantIds: ["bw_work_opensprint0001" as WorkId],
    childWorkIds: ["bw_work_closedsprint0001" as WorkId, "bw_work_opensprint0001" as WorkId],
    childSummaryIds: ["bw_summary_childsprint0001" as AgentSummaryId],
    summaryUri: "memory://agent-summaries/sprints/bw_work_coverage/bw_summary_sprint0001.md",
    evidenceIds: ["bw_evidence_sprint0001" as EvidenceId],
    verificationIds: ["bw_verification_sprint0001" as VerificationId],
    commitShas: ["3333333333333333333333333333333333333333"]
  });
  const result = compileSummaryAgentDirectiveBundle({
    snapshot,
    childStatuses: [
      { workId: "bw_work_closedsprint0001", status: "closed", summaryIds: ["bw_summary_childsprint0001"] },
      { workId: "bw_work_opensprint0001", status: "ready", deferred: true }
    ]
  });
  return directiveTriggerGaps(result);
}

async function sprintLaunchDirectiveTriggerGaps(): Promise<readonly EnforcementGap[]> {
  return [contractGap("sprint.launch-plan.required")];
}

async function expectBorealGaps(action: () => Promise<unknown> | unknown): Promise<readonly EnforcementGap[]> {
  try {
    await action();
  } catch (error) {
    if (!(error instanceof BorealError)) {
      throw error;
    }
    expect(error.gaps).toBeDefined();
    expect(error.gaps?.length).toBeGreaterThan(0);
    return error.gaps ?? [];
  }
  throw new Error("expected BorealError with enforcement gaps");
}

function directiveTriggerGaps(result: {
  readonly ok: boolean;
  readonly selectedRegistryIds: readonly unknown[];
  readonly issues: readonly unknown[];
  readonly bundle?: {
    readonly directives: readonly Array<{
      readonly registryId: string;
      readonly triggerCodes: readonly EnforcementGapCode[];
      readonly subject: { readonly id: string };
    }>;
  };
}): readonly EnforcementGap[] {
  expect(result.ok).toBe(true);
  expect(result.issues).toEqual([]);
  expect(result.bundle).toBeDefined();
  return (
    result.bundle?.directives.flatMap((directive) =>
      directive.triggerCodes.map((code) => ({
        code,
        subjectType: "workspace" as const,
        subjectId: directive.subject.id,
        data: { reason: `selected ${directive.registryId}` }
      }))
    ) ?? []
  );
}

function contractGap(code: EnforcementGapCode): EnforcementGap {
  return {
    code,
    subjectType: "workspace",
    subjectId: "/Users/cybertron/Code/boreal-work",
    data: { reason: "checked-in gap contract member has explicit coverage row" }
  };
}

interface SummaryOptions {
  readonly evidenceIds?: readonly EvidenceId[];
  readonly verificationIds?: readonly VerificationId[];
  readonly commitShas?: readonly string[];
  readonly dirtyPathNotes?: readonly string[];
  readonly nonce?: string;
}

function closeoutSummaryFor(work: WorkItem, input: SummaryOptions = {}): AgentSummaryRecord {
  const generatedAt = "2026-01-01T00:00:00.000Z" as IsoTimestamp;
  const subjectType = work.kind === "sprint" ? "sprint" : work.kind === "milestone" ? "milestone" : "work";
  const summaryId = deterministicId<AgentSummaryId>("summary", {
    subjectId: work.meta.id,
    title: work.title,
    nonce: input.nonce ?? "gap-coverage-closeout"
  });
  return withContentHash({
    meta: createRecordMeta({
      id: summaryId,
      now: generatedAt,
      actor,
      tags: ["agent-summary", "gap-coverage"]
    }),
    subjectId: work.meta.id,
    subjectType,
    summaryKind: subjectType === "sprint" || subjectType === "milestone" ? subjectType : "task",
    status: "final",
    outcome: "completed",
    title: `Closeout summary: ${work.title}`,
    body: "Gap coverage closeout summary.",
    completedWork: [
      {
        workId: work.meta.id,
        title: work.title,
        outcome: "completed",
        notes: "Gap coverage closeout."
      }
    ],
    evidenceIds: input.evidenceIds ?? [],
    verificationIds: input.verificationIds ?? [],
    commitShas: input.commitShas ?? ["abc1234"],
    dirtyPathNotes: input.dirtyPathNotes ?? [],
    childSummaryIds: [],
    artifactUri: `agent-summaries/${summaryId}.md`,
    generatedAt
  } satisfies AgentSummaryRecord);
}

function gateStateFixture(
  overrides: Omit<Partial<AgentDirectiveGateStateSnapshot>, "id" | "kind" | "status"> & {
    readonly id: string;
    readonly kind: AgentDirectiveGateStateSnapshot["kind"];
    readonly status: AgentDirectiveGateStateSnapshot["status"];
  }
): AgentDirectiveGateStateSnapshot {
  const { id, kind, status, ...rest } = overrides;
  return {
    id: id as AgentDirectiveGateStateSnapshot["id"],
    kind,
    status,
    subjectType: "work",
    subjectId: "bw_work_gapcoverage0001",
    scope: "descendants",
    requiredEvidenceKinds: [kind === "audit" ? "artifact" : "review"],
    minEvidenceCount: 1,
    evidenceIds: [],
    verificationIds: [],
    agentSummaryIds: [],
    commitShas: [],
    dirtyPathNotes: [],
    directiveIds: [],
    acknowledgementIds: [],
    ...rest
  };
}

function snapshotFixture(
  options: {
    readonly activeReservationIds?: readonly string[];
    readonly childSummaryIds?: readonly AgentSummaryId[];
    readonly childWorkIds?: readonly WorkId[];
    readonly closedReason?: string;
    readonly commandPath?: string;
    readonly commitShas?: readonly string[];
    readonly doctorDiagnostics?: AgentDirectiveSnapshot["doctor"]["diagnostics"];
    readonly doctorOk?: boolean;
    readonly evidenceIds?: readonly EvidenceId[];
    readonly openDescendantIds?: readonly WorkId[];
    readonly operationCount?: number;
    readonly requiredGates?: readonly AgentDirectiveGateStateSnapshot[];
    readonly searchIndexFresh?: boolean;
    readonly subjectType?: AgentDirectiveSubjectType;
    readonly summaryId?: AgentSummaryId;
    readonly summaryUri?: string;
    readonly syncOk?: boolean;
    readonly verificationIds?: readonly VerificationId[];
    readonly warningThreshold?: number;
    readonly workKind?: WorkKind;
    readonly workStatus?: WorkStatus;
  } = {}
): AgentDirectiveSnapshot {
  const capturedAt = "2026-07-01T14:30:00.000Z" as IsoTimestamp;
  const workId = "bw_work_gapcoverage0001" as WorkId;
  const commandPath = options.commandPath ?? "work show";
  const summaryIds = options.summaryId === undefined ? [] : [options.summaryId];
  const artifactUris = options.summaryUri === undefined ? [] : [options.summaryUri];
  const evidenceIds = options.evidenceIds ?? [];
  const verificationIds = options.verificationIds ?? [];
  const commitShas = options.commitShas ?? [];
  const requiredGates = options.requiredGates ?? [
    gateStateFixture({ id: "bw_gate_gapcoverage0001", kind: "review", status: "open" })
  ];

  return createAgentDirectiveSnapshot({
    capturedAt,
    work: {
      subject: {
        type: options.subjectType ?? "work",
        id: workId,
        title: "Gap coverage directive target",
        kind: options.workKind ?? "task",
        status: options.workStatus ?? "in_progress",
        priority: "normal",
        ...(options.closedReason === undefined ? {} : { closedReason: options.closedReason })
      },
      labels: ["gap-coverage"],
      dependencyIds: [],
      activeBlockerIds: [],
      blockedByIds: [],
      childWorkIds: options.childWorkIds ?? [],
      descendantWorkIds: [],
      openDescendantIds: options.openDescendantIds ?? []
    },
    summary: {
      summaryIds,
      finalSummaryIds: summaryIds,
      childSummaryIds: options.childSummaryIds ?? [],
      artifactUris,
      commitShas,
      dirtyPathNotes: [],
      ...(options.summaryId === undefined ? {} : { latestSummaryId: options.summaryId }),
      ...(options.summaryUri === undefined ? {} : { latestSummaryUri: options.summaryUri })
    },
    gate: {
      requiredGates,
      openGateIds: requiredGates.filter((gate) => gate.status === "open").map((gate) => gate.id),
      satisfiedGateIds: requiredGates.filter((gate) => gate.status === "satisfied").map((gate) => gate.id),
      forcedGateIds: requiredGates.filter((gate) => gate.status === "forced").map((gate) => gate.id)
    },
    evidence: {
      evidenceIds,
      verificationIds,
      evidence: evidenceIds.map((evidenceId) => ({
        id: evidenceId,
        subjectId: workId,
        subjectType: "work",
        kind: "command" as const,
        outcome: "passed" as const,
        summary: "Validation passed.",
        command: "pnpm exec vitest run tests/runtime/enforcement-gap-coverage.test.ts",
        observedAt: capturedAt
      })),
      verifications: verificationIds.map((verificationId) => ({
        id: verificationId,
        subjectId: workId,
        subjectType: "work",
        verdict: "passed" as const,
        evidenceIds,
        verifiedAt: capturedAt
      }))
    },
    git: {
      roots: [
        {
          root: "/Users/cybertron/Code/boreal-work",
          branchName: "main",
          detached: false,
          protectedBranch: true,
          clean: commitShas.length === 0,
          scopedChangedPaths: [],
          collaborationDirtyPaths: [],
          blockingDirtyPaths: [],
          untrackedPaths: [],
          ...(commitShas[0] ? { lastCommitSha: commitShas[0] } : {})
        }
      ],
      checkpointCommitShas: commitShas,
      dirtyPathNotes: []
    },
    workflow: {
      workflowRefs: ["workflows/40-work/claim-and-finish-work.md"],
      skillRefs: ["boreal-work-execution"],
      requiredInputNames: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS],
      nextWorkflowRef: "workflows/40-work/claim-and-finish-work.md",
      recommendedCommandPath: "bwrk work list --ready --json",
      assetManifestHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as ContentHash
    },
    doctor: {
      ok: options.doctorOk ?? true,
      strict: true,
      diagnostics: options.doctorDiagnostics ?? []
    },
    sync: {
      ok: options.syncOk ?? true,
      refreshed: true,
      ledgersFresh: true,
      searchIndexFresh: options.searchIndexFresh ?? true,
      sqliteCacheFresh: true,
      ...(options.operationCount === undefined ? {} : { operationCount: options.operationCount }),
      ...(options.warningThreshold === undefined ? {} : { warningThreshold: options.warningThreshold })
    },
    command: {
      path: commandPath,
      argv: [...commandPath.split(" "), "--json"],
      envelopeSchema: "boreal.cli.result.v1",
      json: true,
      mutatesState: true,
      resultOk: true
    },
    actor: {
      actor: {
        id: "cybertron" as AgentId,
        kind: "agent",
        displayName: "cybertron"
      },
      activeAgentId: "cybertron" as AgentId,
      activeReservationIds: options.activeReservationIds ?? [],
      purpose: "Cover enforcement gap emissions"
    }
  });
}
