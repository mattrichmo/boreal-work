import type {
  AgentDirectiveData,
  AgentDirectiveFamily,
  AgentDirectiveKind,
  AgentDirectiveSeverity,
  AgentDirectiveSubjectType,
  AgentDirectiveTemplateId,
  EnforcementGapCode
} from "@boreal/core";

export const REQUIRED_AGENT_DIRECTIVE_GOLDEN_SCENARIOS = [
  "closeout",
  "sprint_launch",
  "blocked_state",
  "doctor_recovery",
  "handoff",
  "git_checkpoint",
  "lane_worktree",
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
    readonly triggerCodes: readonly EnforcementGapCode[];
    readonly nextCommandTemplate: string;
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
      triggerCodes: ["closeout.user-summary.required", "summary.missing"],
      nextCommandTemplate: "bwrk summary show <subjectId> --json",
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
      severity: "advisory",
      kind: "obligation",
      blocksCloseout: false,
      triggerCodes: ["sprint.launch-plan.required"],
      nextCommandTemplate: "bwrk work create <sprint-title> --json",
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
      triggerCodes: ["work.blocked.open-dependency"],
      nextCommandTemplate: "bwrk dep tree <subjectId> --json",
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
      operationCount: 1260,
      warningThreshold: 1250
    },
    expected: {
      title: "Recover workspace health",
      severity: "required",
      kind: "recovery",
      blocksCloseout: true,
      triggerCodes: ["doctor.recovery.required", "search.index-stale"],
      nextCommandTemplate: "bwrk doctor --strict --json",
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
      summaryId: "bw_summary_deadbeef0007",
      summaryUri: "memory://agent-summaries/works/bw_work_deadbeef0007/bw_summary_deadbeef0007.md",
      nextWorkflow: "workflows/40-work/claim-and-finish-work.md",
      reservationIds: ["bw_reservation_deadbeef0001"],
      commitShas: ["abcdef0123456789abcdef0123456789abcdef01"],
      subjectStatus: "closed",
      branchName: "main",
      gitRoot: "/Users/cybertron/Code/boreal-work",
      evidenceIds: ["bw_evidence_deadbeef0007"],
      verificationIds: ["bw_verification_deadbeef0007"],
      openBlockerIds: ["bw_work_deadbeef0012"],
      openDescendantIds: ["bw_work_deadbeef0013"],
      requiredGateIds: ["bw_gate_deadbeef0007"],
      nextCommandPath: "bwrk work list --ready --json",
      requiredInputs: ["work", "summary", "git"]
    },
    expected: {
      title: "Prepare session handoff",
      severity: "advisory",
      kind: "summary",
      blocksCloseout: false,
      triggerCodes: ["handoff.session-summary.required"],
      nextCommandTemplate: "bwrk session end --json",
      requiredKeys: ["summaryUri", "nextWorkflow"],
      optionalKeys: [
        "workId",
        "summaryId",
        "reservationIds",
        "commitShas",
        "subjectStatus",
        "branchName",
        "gitRoot",
        "evidenceIds",
        "verificationIds",
        "openBlockerIds",
        "openDescendantIds",
        "requiredGateIds",
        "nextCommandPath",
        "requiredInputs"
      ]
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
      triggerCodes: ["git.checkpoint.required", "gate.checkpoint.unsatisfied", "summary.checkpoint-missing"],
      nextCommandTemplate: "git status --short --branch",
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
    scenario: "lane_worktree",
    name: "parallel lane worktree isolation",
    registryId: "git.lane-worktree-required" as AgentDirectiveTemplateId,
    family: "git",
    subjectType: "work",
    commandPath: "agent start",
    data: {
      gitRoot: "/workspace/project",
      mergeTargetBranch: "integration/current-initiative",
      laneBranch: "boreal/lane/current-initiative/agent-alpha-bw-work-deadbeef0012",
      worktreePath: "/workspace/worktrees/project/agent-alpha",
      baseRef: "origin/integration/current-initiative",
      baseSha: "2222222222222222222222222222222222222222",
      currentBranch: "integration/current-initiative",
      agentId: "agent-alpha",
      workId: "bw_work_deadbeef0012",
      reason: "parallel_agents_on_shared_integration_branch",
      recommendedCommands: [
        "git fetch origin",
        "git worktree add /workspace/worktrees/project/agent-alpha -b boreal/lane/current-initiative/agent-alpha-bw-work-deadbeef0012 origin/integration/current-initiative"
      ]
    },
    expected: {
      title: "Use isolated lane worktree",
      severity: "required",
      kind: "obligation",
      blocksCloseout: true,
      triggerCodes: ["git.lane-worktree.required"],
      nextCommandTemplate: "git worktree add <worktreePath> -b <laneBranch> <baseRef>",
      requiredKeys: ["gitRoot", "mergeTargetBranch", "laneBranch", "worktreePath"],
      optionalKeys: [
        "baseRef",
        "baseSha",
        "currentBranch",
        "agentId",
        "workId",
        "reason",
        "recommendedCommands"
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
      subjectId: "bw_work_deadbeef0008",
      branchName: "main",
      gitRoot: "/Users/cybertron/Code/boreal-work",
      evidenceIds: ["bw_evidence_deadbeef0008"],
      verificationIds: ["bw_verification_deadbeef0008"],
      openBlockerIds: ["bw_work_deadbeef0014"],
      openDescendantIds: ["bw_work_deadbeef0015"],
      requiredGateIds: ["bw_gate_deadbeef0008"],
      activeReservationIds: ["bw_reservation_deadbeef0008"],
      summaryUri: "memory://agent-summaries/works/bw_work_deadbeef0008/bw_summary_deadbeef0008.md",
      summaryId: "bw_summary_deadbeef0008"
    },
    expected: {
      title: "Follow next canonical workflow",
      severity: "advisory",
      kind: "next_step",
      blocksCloseout: false,
      triggerCodes: ["directive.workflow-next.available"],
      nextCommandTemplate: "<workflow-recommended-command>",
      requiredKeys: ["workflowRef", "commandPath", "requiredInputs"],
      optionalKeys: [
        "currentStatus",
        "subjectId",
        "branchName",
        "gitRoot",
        "evidenceIds",
        "verificationIds",
        "openBlockerIds",
        "openDescendantIds",
        "requiredGateIds",
        "activeReservationIds",
        "summaryUri",
        "summaryId"
      ]
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
      triggerCodes: [
        "close.no-passing-verification",
        "gate.verification.unsatisfied",
        "gate.declared-command.missing",
        "gate.expected-observable.missing"
      ],
      nextCommandTemplate: "<validation-command>",
      requiredKeys: ["subjectId", "command", "expectedVerdict"],
      optionalKeys: ["gateIds", "declaredCommands", "expectedObservable", "expectedObservables", "evidenceIds", "verificationIds"]
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
      triggerCodes: ["gate.review.unsatisfied"],
      nextCommandTemplate: "bwrk evidence add <subjectId> --kind review --outcome passed --json",
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
      severity: "advisory",
      kind: "obligation",
      blocksCloseout: false,
      triggerCodes: ["memory.reconcile-source.required"],
      nextCommandTemplate: "bwrk raw triage --json",
      requiredKeys: ["sourceIds", "memoryRoot", "requiredRecordTypes"],
      optionalKeys: ["wikiPageIds", "claimIds"]
    }
  }
];
