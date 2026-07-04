import { describe, expect, it } from "vitest";

import {
  AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
  AGENT_DIRECTIVE_SNAPSHOT_SCHEMA_VERSION,
  agentDirectiveSnapshotHash,
  agentDirectiveSnapshotIssues,
  assertAgentDirectiveSnapshot,
  createAgentDirectiveSnapshot,
  type AgentDirectiveSnapshot,
  type AgentId,
  type AgentSummaryId,
  type CloseoutGateId,
  type ContentHash,
  type EvidenceId,
  type IsoTimestamp,
  type ReservationId,
  type VerificationId,
  type WorkId
} from "@boreal/core";

describe("agent directive compiler snapshots", () => {
  it("validates an explicit compiler input snapshot for every dynamic context", () => {
    const snapshot = agentDirectiveSnapshotFixture();

    expect([...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS]).toEqual([
      "work",
      "summary",
      "gate",
      "evidence",
      "git",
      "workflow",
      "doctor",
      "sync",
      "command",
      "actor"
    ]);
    expect(agentDirectiveSnapshotIssues(snapshot)).toEqual([]);
    expect(() => assertAgentDirectiveSnapshot(snapshot)).not.toThrow();
    expect(agentDirectiveSnapshotHash(snapshot)).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("keeps source hashes stable across capture timestamps", () => {
    const snapshot = agentDirectiveSnapshotFixture();
    const recaptured = createAgentDirectiveSnapshot({
      ...snapshot,
      capturedAt: "2026-07-01T00:00:01.000Z" as IsoTimestamp
    });

    expect(agentDirectiveSnapshotHash(recaptured)).toBe(agentDirectiveSnapshotHash(snapshot));
  });

  it("creates snapshots without inventing runtime context", () => {
    const snapshot = agentDirectiveSnapshotFixture();
    const { schemaVersion: _schemaVersion, ...input } = snapshot;

    expect(createAgentDirectiveSnapshot(input)).toEqual({
      ...input,
      schemaVersion: AGENT_DIRECTIVE_SNAPSHOT_SCHEMA_VERSION
    });

    expect(() =>
      createAgentDirectiveSnapshot({
        capturedAt: snapshot.capturedAt,
        command: snapshot.command,
        actor: snapshot.actor
      } as Parameters<typeof createAgentDirectiveSnapshot>[0])
    ).toThrow(
      expect.objectContaining({
        code: "BOREAL_INVALID_INPUT",
        details: expect.objectContaining({
          issues: expect.arrayContaining([
            expect.objectContaining({ path: "$.work", message: "must be an object" }),
            expect.objectContaining({ path: "$.sync", message: "must be an object" })
          ])
        })
      })
    );
  });

  it("rejects unsafe or implicit compiler inputs", () => {
    const snapshot = agentDirectiveSnapshotFixture();
    const missingSync = { ...snapshot } as Record<string, unknown>;
    delete missingSync.sync;

    expect(agentDirectiveSnapshotIssues(missingSync)).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.sync", message: "must be an object" })])
    );

    expect(
      agentDirectiveSnapshotIssues({
        ...snapshot,
        workflow: {
          ...snapshot.workflow,
          requiredInputNames: ["work", "runtimeState"]
        }
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "$.workflow.requiredInputNames[1]",
          message: "must name an explicit directive snapshot context"
        })
      ])
    );

    expect(
      agentDirectiveSnapshotIssues({
        ...snapshot,
        sync: {
          ...snapshot.sync,
          readRuntimeState: () => true
        }
      })
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "$.sync.readRuntimeState", message: "must be JSON-compatible data" })
      ])
    );

    expect(
      agentDirectiveSnapshotIssues({
        ...snapshot,
        capturedAt: "2026-07-01"
      })
    ).toEqual(expect.arrayContaining([expect.objectContaining({ path: "$.capturedAt" })]));
  });
});

function agentDirectiveSnapshotFixture(): AgentDirectiveSnapshot {
  const workId = "bw_work_0f55e2240849c396" as WorkId;
  const evidenceId = "bw_evidence_deadbeefdead" as EvidenceId;
  const verificationId = "bw_verification_deadbeefdead" as VerificationId;
  const summaryId = "bw_summary_deadbeefdead" as AgentSummaryId;
  const gateId = "bw_gate_deadbeefdead" as CloseoutGateId;
  const reservationId = "bw_reservation_deadbeefdead" as ReservationId;
  const capturedAt = "2026-07-01T14:00:00.000Z" as IsoTimestamp;

  return createAgentDirectiveSnapshot({
    capturedAt,
    work: {
      subject: {
        type: "work",
        id: workId,
        title: "S02T01 - Define directive compiler input snapshots",
        kind: "task",
        status: "in_progress",
        priority: "critical",
        reservationId
      },
      labels: ["agent-directives", "sprint-02", "compiler"],
      dependencyIds: ["bw_work_c6e1d7bd372b2029" as WorkId],
      activeBlockerIds: [],
      blockedByIds: [],
      childWorkIds: [],
      descendantWorkIds: [],
      openDescendantIds: []
    },
    summary: {
      summaryIds: [summaryId],
      finalSummaryIds: [summaryId],
      childSummaryIds: [],
      artifactUris: ["memory://agent-summaries/work/bw_work_0f55e2240849c396/bw_summary_deadbeefdead.md"],
      commitShas: ["abcdef1"],
      dirtyPathNotes: ["unrelated_dirty_state: pre-existing docs changes outside scope"],
      latestSummaryId: summaryId,
      latestSummaryUri: "memory://agent-summaries/work/bw_work_0f55e2240849c396/bw_summary_deadbeefdead.md"
    },
    gate: {
      requiredGates: [
        {
          id: gateId,
          subjectType: "work",
          subjectId: workId,
          kind: "verification",
          scope: "self",
          status: "satisfied",
          requiredEvidenceKinds: ["test"],
          minEvidenceCount: 1,
          evidenceIds: [evidenceId],
          verificationIds: [verificationId],
          agentSummaryIds: [summaryId],
          commitShas: ["abcdef1"],
          dirtyPathNotes: [],
          directiveIds: [],
          acknowledgementIds: []
        }
      ],
      openGateIds: [],
      satisfiedGateIds: [gateId],
      forcedGateIds: []
    },
    evidence: {
      evidenceIds: [evidenceId],
      verificationIds: [verificationId],
      evidence: [
        {
          id: evidenceId,
          subjectId: workId,
          subjectType: "work",
          kind: "test",
          outcome: "passed",
          summary: "Focused snapshot tests passed.",
          command: "pnpm exec vitest run tests/runtime/agent-directive-snapshot.test.ts",
          observedAt: capturedAt
        }
      ],
      verifications: [
        {
          id: verificationId,
          subjectId: workId,
          subjectType: "work",
          verdict: "passed",
          evidenceIds: [evidenceId],
          verifiedAt: capturedAt
        }
      ]
    },
    git: {
      roots: [
        {
          root: "/Users/cybertron/Code/boreal-work",
          branchName: "main",
          detached: false,
          protectedBranch: true,
          clean: false,
          scopedChangedPaths: [
            { status: "A", path: "packages/core/src/agent-directive-snapshot.ts" },
            { status: "M", path: "packages/core/src/index.ts" },
            { status: "A", path: "tests/runtime/agent-directive-snapshot.test.ts" }
          ],
          collaborationDirtyPaths: [],
          blockingDirtyPaths: [],
          untrackedPaths: []
        }
      ],
      checkpointCommitShas: ["abcdef1"],
      dirtyPathNotes: ["unrelated_dirty_state: pre-existing docs changes outside scope"]
    },
    workflow: {
      workflowRefs: ["workflows/40-work/claim-and-finish-work.md"],
      skillRefs: ["boreal-work-execution"],
      requiredInputNames: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS],
      nextWorkflowRef: "workflows/40-work/claim-and-finish-work.md",
      recommendedCommandPath: "bwrk agent finish",
      assetManifestHash: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as ContentHash
    },
    doctor: {
      ok: true,
      strict: true,
      diagnostics: [
        {
          code: "workspace.root",
          severity: "ok",
          message: "Workspace root: /Users/cybertron/Code/boreal-work",
          blocking: false,
          recommendedCommands: []
        }
      ]
    },
    sync: {
      ok: true,
      refreshed: true,
      ledgersFresh: true,
      searchIndexFresh: true,
      sqliteCacheFresh: true,
      operationCount: 1020,
      warningThreshold: 1250,
      contentHash: "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789" as ContentHash,
      searchIndexHash: "sha256:fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210" as ContentHash
    },
    command: {
      path: "agent finish",
      argv: ["agent", "finish", workId],
      envelopeSchema: "boreal.cli.result.v1",
      json: true,
      mutatesState: true,
      resultOk: true,
      spooledResultPath: ".boreal/results/agent-finish.json"
    },
    actor: {
      actor: {
        id: "cybertron" as AgentId,
        kind: "agent",
        displayName: "cybertron"
      },
      activeAgentId: "cybertron" as AgentId,
      activeReservationIds: [reservationId],
      purpose: "Implement directive compiler input snapshots"
    }
  });
}
