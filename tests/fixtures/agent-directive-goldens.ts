import type {
  AgentDirectiveData,
  AgentDirectiveFamily,
  AgentDirectiveKind,
  AgentDirectiveSeverity,
  AgentDirectiveSubjectType,
  AgentDirectiveTemplateId
} from "@boreal/core";

export const REQUIRED_AGENT_DIRECTIVE_GOLDEN_SCENARIOS = [
  "closeout",
  "sprint_launch",
  "blocked_state",
  "doctor_recovery",
  "handoff",
  "git_checkpoint",
  "workflow_next",
  "verification",
  "review",
  "memory"
] as const;

export type AgentDirectiveGoldenScenario = (typeof REQUIRED_AGENT_DIRECTIVE_GOLDEN_SCENARIOS)[number];

export interface AgentDirectiveGoldenCase {
  readonly scenario: AgentDirectiveGoldenScenario;
  readonly name: string;
  readonly registryId: AgentDirectiveTemplateId;
  readonly family: AgentDirectiveFamily;
  readonly subjectType: AgentDirectiveSubjectType;
  readonly commandPath: string;
  readonly data: AgentDirectiveData;
  readonly expected: {
    readonly title: string;
    readonly severity: AgentDirectiveSeverity;
    readonly kind: AgentDirectiveKind;
    readonly blocksCloseout: boolean;
    readonly requiredKeys: readonly string[];
    readonly optionalKeys: readonly string[];
  };
}

export const AGENT_DIRECTIVE_GOLDEN_CASES: readonly AgentDirectiveGoldenCase[] = [
  {
    scenario: "closeout",
    name: "closeout final user summary",
    registryId: "closeout.summary-required" as AgentDirectiveTemplateId,
    family: "closeout",
    subjectType: "work",
    commandPath: "agent finish",
    data: {
      subjectId: "bw_work_deadbeef0001",
      summaryId: "bw_summary_deadbeef0001",
      summaryUri: "memory://agent-summaries/works/bw_work_deadbeef0001/bw_summary_deadbeef0001.md",
      evidenceIds: ["bw_evidence_deadbeef0001"],
      verificationIds: ["bw_verification_deadbeef0001"],
      commitShas: ["0123456789abcdef0123456789abcdef01234567"],
      dirtyPathNotes: ["README.md left dirty because it predates the closeout"],
      summaryStatus: "final",
      summaryOutcome: "completed",
      closeReason: "Completed acceptance criteria"
    },
    expected: {
      title: "Respond with closeout summary",
      severity: "required",
      kind: "summary",
      blocksCloseout: true,
      requiredKeys: ["subjectId", "summaryId", "summaryUri", "evidenceIds", "verificationIds"],
      optionalKeys: [
        "commitShas",
        "dirtyPathNotes",
        "summaryStatus",
        "summaryOutcome",
        "closeReason",
        "duplicateOf",
        "forceReasonCode",
        "forceComment"
      ]
    }
  },
  {
    scenario: "sprint_launch",
    name: "sprint launch work structure",
    registryId: "sprint.launch-plan" as AgentDirectiveTemplateId,
    family: "sprint",
    subjectType: "sprint",
    commandPath: "work create",
    data: {
      sprintTitle: "Agent directive runtime integration",
      childWorkIds: ["bw_work_deadbeef0002", "bw_work_deadbeef0003"],
      readyWorkIds: ["bw_work_deadbeef0002"],
      checkpointPlan: ["commit after registry dispatcher", "commit after CLI envelope"],
      workflowRef: "workflows/40-work/launch-sprint.md",
      sprintId: "bw_work_deadbeef0004"
    },
    expected: {
      title: "Prepare sprint launch",
      severity: "action",
      kind: "obligation",
      blocksCloseout: false,
      requiredKeys: ["sprintTitle", "childWorkIds", "readyWorkIds", "checkpointPlan", "workflowRef"],
      optionalKeys: ["sprintId"]
    }
  },
  {
    scenario: "blocked_state",
    name: "blocked work recovery",
    registryId: "blocked.resolve-blockers" as AgentDirectiveTemplateId,
    family: "blocked",
    subjectType: "work",
    commandPath: "work show",
    data: {
      subjectId: "bw_work_deadbeef0005",
      blockerIds: ["bw_work_deadbeef0006"],
      blockerTitles: ["Finish registry validator"],
      gateIds: ["bw_gate_deadbeef0001"],
      recoveryWorkflow: "workflows/40-work/claim-and-finish-work.md",
      blockedByIds: ["bw_work_deadbeef0006"],
      recommendedCommands: [
        "bwrk dep tree bw_work_deadbeef0005 --json",
        "bwrk work show bw_work_deadbeef0006 --json"
      ],
      nextCommandPath: "bwrk work show bw_work_deadbeef0005 --json"
    },
    expected: {
      title: "Resolve active blockers",
      severity: "blocking",
      kind: "recovery",
      blocksCloseout: true,
      requiredKeys: ["subjectId", "blockerIds"],
      optionalKeys: [
        "blockerTitles",
        "gateIds",
        "recoveryWorkflow",
        "blockedByIds",
        "recommendedCommands",
        "nextCommandPath"
      ]
    }
  },
  {
    scenario: "doctor_recovery",
    name: "strict doctor recovery",
    registryId: "doctor.recovery-required" as AgentDirectiveTemplateId,
    family: "doctor",
    subjectType: "workspace",
    commandPath: "doctor",
    data: {
      diagnostics: ["ledger.export_drift", "search.index"],
      recommendedCommands: ["bwrk sync refresh --json", "bwrk doctor --strict --json"],
      syncOk: false,
      doctorOk: false,
      lockPaths: [".boreal/runtime/state.lock", ".boreal/runtime/search-index.lock"],
      diagnosticCodes: ["ledger.export_drift", "search.index"],
      blockingDiagnosticCodes: ["ledger.export_drift"],
      safeWorkflow: "workflows/30-health/sync-and-doctor.md",
      nextCommandPath: "bwrk sync refresh --json",
      operationCount: 1029,
      warningThreshold: 1025
    },
    expected: {
      title: "Recover workspace health",
      severity: "required",
      kind: "recovery",
      blocksCloseout: true,
      requiredKeys: ["diagnostics", "recommendedCommands"],
      optionalKeys: [
        "syncOk",
        "doctorOk",
        "lockPaths",
        "diagnosticCodes",
        "blockingDiagnosticCodes",
        "safeWorkflow",
        "nextCommandPath",
        "operationCount",
        "warningThreshold"
      ]
    }
  },
  {
    scenario: "handoff",
    name: "session handoff summary",
    registryId: "handoff.session-summary" as AgentDirectiveTemplateId,
    family: "handoff",
    subjectType: "session",
    commandPath: "session end",
    data: {
      workId: "bw_work_deadbeef0007",
      summaryUri: "memory://agent-summaries/works/bw_work_deadbeef0007/bw_summary_deadbeef0007.md",
      nextWorkflow: "workflows/40-work/claim-and-finish-work.md",
      reservationIds: ["bw_reservation_deadbeef0001"],
      commitShas: ["abcdef0123456789abcdef0123456789abcdef01"]
    },
    expected: {
      title: "Prepare session handoff",
      severity: "action",
      kind: "summary",
      blocksCloseout: false,
      requiredKeys: ["summaryUri", "nextWorkflow"],
      optionalKeys: ["workId", "reservationIds", "commitShas"]
    }
  },
  {
    scenario: "git_checkpoint",
    name: "scoped Git checkpoint",
    registryId: "git.checkpoint-required" as AgentDirectiveTemplateId,
    family: "git",
    subjectType: "work",
    commandPath: "summary compose",
    data: {
      gitRoot: "/Users/cybertron/Code/boreal-work",
      commitShas: ["1111111111111111111111111111111111111111"],
      dirtyPathNotes: ["README.md left dirty because it predates this work"],
      reasonCode: "scoped_commit_recorded",
      branchName: "main",
      roots: [
        {
          root: "/Users/cybertron/Code/boreal-work",
          branchName: "main",
          detached: false,
          protectedBranch: true,
          clean: false,
          scopedChangedPaths: [{ status: "M", path: "packages/core/src/agent-directive-compiler.ts" }],
          collaborationDirtyPaths: [{ status: "M", path: "README.md" }],
          blockingDirtyPaths: [],
          untrackedPaths: [],
          lastCommitSha: "1111111111111111111111111111111111111111"
        }
      ],
      protectedBranch: true,
      detached: false,
      clean: false,
      repositoryChanged: true,
      noRepoChanges: false,
      scopedChangedPaths: [{ status: "M", path: "packages/core/src/agent-directive-compiler.ts" }],
      collaborationDirtyPaths: [{ status: "M", path: "README.md" }],
      blockingDirtyPaths: [],
      untrackedPaths: [],
      outOfScopeRepoNotes: ["README.md left dirty because it predates this work"],
      noCommitReason: "scoped_commit_recorded",
      protectedBranchCaveat: "protected_branch_checkpoint",
      lastCommitSha: "1111111111111111111111111111111111111111"
    },
    expected: {
      title: "Record Git checkpoint",
      severity: "required",
      kind: "obligation",
      blocksCloseout: true,
      requiredKeys: ["gitRoot"],
      optionalKeys: [
        "commitShas",
        "dirtyPathNotes",
        "reasonCode",
        "branchName",
        "roots",
        "protectedBranch",
        "detached",
        "clean",
        "repositoryChanged",
        "noRepoChanges",
        "scopedChangedPaths",
        "collaborationDirtyPaths",
        "blockingDirtyPaths",
        "untrackedPaths",
        "outOfScopeRepoNotes",
        "noCommitReason",
        "protectedBranchCaveat",
        "lastCommitSha"
      ]
    }
  },
  {
    scenario: "workflow_next",
    name: "canonical next workflow",
    registryId: "workflow_next.canonical-next-step" as AgentDirectiveTemplateId,
    family: "workflow_next",
    subjectType: "work",
    commandPath: "workflows show",
    data: {
      workflowRef: "workflows/40-work/claim-and-finish-work.md",
      commandPath: "bwrk work show bw_work_deadbeef0008 --json",
      requiredInputs: ["workId", "agentId"],
      currentStatus: "ready",
      subjectId: "bw_work_deadbeef0008"
    },
    expected: {
      title: "Follow next canonical workflow",
      severity: "action",
      kind: "next_step",
      blocksCloseout: false,
      requiredKeys: ["workflowRef", "commandPath", "requiredInputs"],
      optionalKeys: ["currentStatus", "subjectId"]
    }
  },
  {
    scenario: "verification",
    name: "required validation evidence",
    registryId: "verification.evidence-required" as AgentDirectiveTemplateId,
    family: "verification",
    subjectType: "work",
    commandPath: "work verify",
    data: {
      subjectId: "bw_work_deadbeef0009",
      command: "pnpm exec vitest run tests/runtime/agent-directive-goldens.test.ts",
      expectedVerdict: "passed",
      evidenceIds: ["bw_evidence_deadbeef0009"],
      verificationIds: ["bw_verification_deadbeef0009"]
    },
    expected: {
      title: "Attach passed verification evidence",
      severity: "required",
      kind: "obligation",
      blocksCloseout: true,
      requiredKeys: ["subjectId", "command", "expectedVerdict"],
      optionalKeys: ["evidenceIds", "verificationIds"]
    }
  },
  {
    scenario: "review",
    name: "required review gate",
    registryId: "review.gate-required" as AgentDirectiveTemplateId,
    family: "review",
    subjectType: "work",
    commandPath: "gate closeout",
    data: {
      subjectId: "bw_work_deadbeef0010",
      gateIds: ["bw_gate_deadbeef0010"],
      requiredEvidenceKinds: ["review"],
      minEvidenceCount: 1,
      forceReasonCode: "reviewer_unavailable"
    },
    expected: {
      title: "Satisfy review gate",
      severity: "required",
      kind: "obligation",
      blocksCloseout: true,
      requiredKeys: ["subjectId", "gateIds", "requiredEvidenceKinds", "minEvidenceCount"],
      optionalKeys: ["forceReasonCode"]
    }
  },
  {
    scenario: "memory",
    name: "source-backed memory reconciliation",
    registryId: "memory.reconcile-source" as AgentDirectiveTemplateId,
    family: "memory",
    subjectType: "project",
    commandPath: "raw triage",
    data: {
      sourceIds: ["bw_source_deadbeef0011"],
      memoryRoot: "/Users/cybertron/Code/boreal-work/memory",
      requiredRecordTypes: ["wiki", "claim", "decision"],
      wikiPageIds: ["bw_wiki_deadbeef0011"],
      claimIds: ["bw_claim_deadbeef0011"]
    },
    expected: {
      title: "Reconcile source-backed memory",
      severity: "action",
      kind: "obligation",
      blocksCloseout: false,
      requiredKeys: ["sourceIds", "memoryRoot", "requiredRecordTypes"],
      optionalKeys: ["wikiPageIds", "claimIds"]
    }
  }
];
