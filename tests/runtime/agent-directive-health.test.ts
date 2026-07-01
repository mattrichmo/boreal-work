import { describe, expect, it } from "vitest";

import {
  AGENT_DIRECTIVE_REGISTRY,
  AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS,
  agentDirectiveHealthReport,
  assembleAgentDirectiveBundle,
  createAgentDirectiveSnapshot,
  type AgentDirectiveBundle,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryEntry,
  type AgentDirectiveSubjectType,
  type AgentId,
  type ContentHash,
  type IsoTimestamp
} from "@boreal/core";

describe("agent directive health diagnostics", () => {
  it("passes a valid emitted bundle from the trusted registry", () => {
    const bundle = validWorkflowNextBundle();
    const report = agentDirectiveHealthReport({ bundles: [bundle] });

    expect(report.ok).toBe(true);
    expect(report.checkedBundles).toBe(1);
    expect(report.issues).toEqual([]);
    expect(report.issueCounts.unknown_id).toBe(0);
    expect(report.issueCounts.stale_registry_version).toBe(0);
  });

  it("classifies emitted bundle issues required by doctor diagnostics", () => {
    const valid = validWorkflowNextBundle();
    const dynamicInstruction = {
      ...valid.directives[0],
      id: "directive.workflow_next.dynamic",
      instruction: "Please summarize ${summary}",
      data: {
        workflowRef: "workflows/40-work/claim-and-finish-work.md",
        commandPath: 42,
        requiredInputs: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS]
      },
      source: {
        ...valid.directives[0]?.source,
        registryVersion: "directives.v0"
      }
    };
    const unknownDirective = {
      ...valid.directives[0],
      id: "directive.workflow_next.dynamic",
      registryId: "workflow_next.unknown-template"
    };
    const badBundle = {
      ...valid,
      meta: {
        ...valid.meta,
        registryVersion: "directives.v0"
      },
      directives: [dynamicInstruction, unknownDirective],
      missingRequired: [
        {
          registryId: "workflow_next.canonical-next-step",
          family: "workflow_next",
          requirement: "commandPath",
          message: "missing required directive data"
        }
      ],
      conflicts: [
        {
          directiveIds: ["directive.workflow_next.dynamic", "directive.workflow_next.dynamic"],
          reason: "Injected diagnostic conflict",
          resolution: "manual_review",
          severity: "required"
        }
      ]
    } as AgentDirectiveBundle;

    const report = agentDirectiveHealthReport({ bundles: [badBundle] });

    expect(report.ok).toBe(false);
    expect(report.issueCounts.unknown_id).toBeGreaterThan(0);
    expect(report.issueCounts.duplicate_id).toBeGreaterThan(0);
    expect(report.issueCounts.invalid_data).toBeGreaterThan(0);
    expect(report.issueCounts.unsafe_dynamic_instruction).toBeGreaterThan(0);
    expect(report.issueCounts.stale_registry_version).toBeGreaterThan(0);
    expect(report.issueCounts.missing_required_directive).toBeGreaterThan(0);
    expect(report.issueCounts.conflict).toBeGreaterThan(0);
  });

  it("reports deprecated registry emissions and unsafe static registry instructions", () => {
    const valid = validWorkflowNextBundle();
    const supersededRegistry = registryWithEntry("workflow_next.canonical-next-step", {
      lifecycle: "superseded",
      defaultLifecycle: "superseded"
    });
    const deprecatedReport = agentDirectiveHealthReport({
      registry: supersededRegistry,
      bundles: [valid]
    });
    const unsafeRegistry = registryWithEntry("workflow_next.canonical-next-step", {
      instruction: "Please respond with {{summary}}"
    });
    const unsafeReport = agentDirectiveHealthReport({
      registry: unsafeRegistry,
      bundles: []
    });

    expect(deprecatedReport.issueCounts.deprecated_emission).toBeGreaterThan(0);
    expect(unsafeReport.issueCounts.unsafe_dynamic_instruction).toBeGreaterThan(0);
  });
});

function validWorkflowNextBundle(): AgentDirectiveBundle {
  const result = assembleAgentDirectiveBundle({
    snapshot: healthSnapshotFixture(),
    dataByRegistryId: {
      "workflow_next.canonical-next-step": {
        workflowRef: "workflows/40-work/claim-and-finish-work.md",
        commandPath: "bwrk work list --ready --json",
        requiredInputs: [...AGENT_DIRECTIVE_SNAPSHOT_CONTEXT_KEYS],
        subjectId: "/tmp/boreal-work",
        gitRoot: "/tmp/boreal-work"
      }
    }
  });
  if (!result.bundle) {
    throw new Error(`Expected a valid bundle, got ${JSON.stringify(result.issues)}`);
  }
  return result.bundle;
}

function registryWithEntry(
  id: string,
  overrides: Partial<AgentDirectiveRegistryEntry>
): AgentDirectiveRegistry {
  return {
    ...AGENT_DIRECTIVE_REGISTRY,
    entries: AGENT_DIRECTIVE_REGISTRY.entries.map((entry) =>
      entry.id === id ? { ...entry, ...overrides } : entry
    )
  };
}

function healthSnapshotFixture(
  options: {
    readonly subjectType?: AgentDirectiveSubjectType;
    readonly commandPath?: string;
  } = {}
) {
  const capturedAt = "2026-07-01T14:30:00.000Z" as IsoTimestamp;
  const commandPath = options.commandPath ?? "sync refresh";
  return createAgentDirectiveSnapshot({
    capturedAt,
    work: {
      labels: ["agent-directives"],
      dependencyIds: [],
      activeBlockerIds: [],
      blockedByIds: [],
      childWorkIds: [],
      descendantWorkIds: [],
      openDescendantIds: []
    },
    summary: {
      summaryIds: [],
      finalSummaryIds: [],
      childSummaryIds: [],
      artifactUris: [],
      commitShas: [],
      dirtyPathNotes: []
    },
    gate: {
      requiredGates: [],
      openGateIds: [],
      satisfiedGateIds: [],
      forcedGateIds: []
    },
    evidence: {
      evidenceIds: [],
      verificationIds: [],
      evidence: [],
      verifications: []
    },
    git: {
      roots: [
        {
          root: "/tmp/boreal-work",
          branchName: "main",
          detached: false,
          protectedBranch: true,
          clean: true,
          scopedChangedPaths: [],
          collaborationDirtyPaths: [],
          blockingDirtyPaths: [],
          untrackedPaths: []
        }
      ],
      checkpointCommitShas: [],
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
      ok: true,
      strict: true,
      diagnostics: []
    },
    sync: {
      ok: true,
      refreshed: true,
      ledgersFresh: true,
      searchIndexFresh: true,
      sqliteCacheFresh: true
    },
    command: {
      path: commandPath,
      argv: [...commandPath.split(" "), "--json"],
      envelopeSchema: "boreal.cli.sync.refresh.v1",
      json: true,
      mutatesState: true,
      resultOk: true
    },
    actor: {
      actor: {
        id: "doctor" as AgentId,
        kind: "agent",
        displayName: "doctor"
      },
      activeAgentId: "doctor" as AgentId,
      activeReservationIds: [],
      purpose: "Test directive health diagnostics"
    }
  });
}
