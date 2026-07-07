import type {
  AgentDirectiveDataValue,
  AgentDirectiveRegistry,
  AgentDirectiveTemplateId
} from "./agent-directives.js";

export const AGENT_DIRECTIVE_PAYLOAD_FIELD_VALUE_TYPES = [
  "string",
  "number",
  "boolean",
  "array",
  "object",
  "id",
  "timestamp",
  "content_hash",
  "uri"
] as const;

export type AgentDirectivePayloadFieldValueType = (typeof AGENT_DIRECTIVE_PAYLOAD_FIELD_VALUE_TYPES)[number];
type PayloadArray = readonly AgentDirectiveDataValue[];

export interface AgentDirectivePayloadField<Key extends string = string> {
  readonly key: Key;
  readonly valueType: AgentDirectivePayloadFieldValueType;
  readonly required: boolean;
  readonly description: string;
}

export interface BlockedResolveBlockersPayload {
  readonly subjectId: string;
  readonly blockerIds: PayloadArray;
  readonly blockerTitles?: PayloadArray;
  readonly gateIds?: PayloadArray;
  readonly recoveryWorkflow?: string;
  readonly blockedByIds?: PayloadArray;
  readonly recommendedCommands?: PayloadArray;
  readonly nextCommandPath?: string;
}

export interface VerificationEvidenceRequiredPayload {
  readonly subjectId: string;
  readonly command: string;
  readonly expectedVerdict: string;
  readonly gateIds?: PayloadArray;
  readonly declaredCommands?: PayloadArray;
  readonly expectedObservable?: string;
  readonly expectedObservables?: PayloadArray;
  readonly evidenceIds?: PayloadArray;
  readonly verificationIds?: PayloadArray;
}

export interface ReviewGateRequiredPayload {
  readonly subjectId: string;
  readonly gateIds: PayloadArray;
  readonly requiredEvidenceKinds: PayloadArray;
  readonly minEvidenceCount: number;
  readonly forceReasonCode?: string;
}

export interface AuditGateRequiredPayload {
  readonly subjectId: string;
  readonly gateIds: PayloadArray;
  readonly requiredEvidenceKinds: PayloadArray;
  readonly findingsDisposition?: string;
  readonly forceReasonCode?: string;
}

export interface GitCheckpointRequiredPayload {
  readonly gitRoot: string;
  readonly commitShas?: PayloadArray;
  readonly dirtyPathNotes?: PayloadArray;
  readonly reasonCode?: string;
  readonly branchName?: string;
  readonly roots?: PayloadArray;
  readonly protectedBranch?: boolean;
  readonly detached?: boolean;
  readonly clean?: boolean;
  readonly repositoryChanged?: boolean;
  readonly noRepoChanges?: boolean;
  readonly scopedChangedPaths?: PayloadArray;
  readonly collaborationDirtyPaths?: PayloadArray;
  readonly blockingDirtyPaths?: PayloadArray;
  readonly untrackedPaths?: PayloadArray;
  readonly outOfScopeRepoNotes?: PayloadArray;
  readonly noCommitReason?: string;
  readonly protectedBranchCaveat?: string;
  readonly lastCommitSha?: string;
}

export interface GitLaneWorktreeRequiredPayload {
  readonly gitRoot: string;
  readonly mergeTargetBranch: string;
  readonly laneBranch: string;
  readonly worktreePath: string;
  readonly baseRef?: string;
  readonly baseSha?: string;
  readonly currentBranch?: string;
  readonly agentId?: string;
  readonly workId?: string;
  readonly reason?: string;
  readonly recommendedCommands?: PayloadArray;
}

export interface CloseoutSummaryRequiredPayload {
  readonly subjectId: string;
  readonly summaryId: string;
  readonly summaryUri: string;
  readonly evidenceIds: PayloadArray;
  readonly verificationIds: PayloadArray;
  readonly commitShas?: PayloadArray;
  readonly dirtyPathNotes?: PayloadArray;
  readonly summaryStatus?: string;
  readonly summaryOutcome?: string;
  readonly closeReason?: string;
  readonly duplicateOf?: string;
  readonly forceReasonCode?: string;
  readonly forceComment?: string;
}

export interface DoctorRecoveryRequiredPayload {
  readonly diagnostics: PayloadArray;
  readonly recommendedCommands: PayloadArray;
  readonly syncOk?: boolean;
  readonly doctorOk?: boolean;
  readonly lockPaths?: PayloadArray;
  readonly diagnosticCodes?: PayloadArray;
  readonly blockingDiagnosticCodes?: PayloadArray;
  readonly safeWorkflow?: string;
  readonly nextCommandPath?: string;
  readonly operationCount?: number;
  readonly warningThreshold?: number;
}

export interface MemoryReconcileSourcePayload {
  readonly sourceIds: PayloadArray;
  readonly memoryRoot: string;
  readonly requiredRecordTypes: PayloadArray;
  readonly wikiPageIds?: PayloadArray;
  readonly claimIds?: PayloadArray;
}

export interface InboxTriageAgingPayload {
  readonly rawSourceIds: PayloadArray;
  readonly rawSourceCount: number;
  readonly oldestRawSourceId: string;
  readonly oldestAgeDays: number;
  readonly thresholdDays: number;
  readonly command: string;
  readonly recommendedCommands?: PayloadArray;
}

export interface HandoffSessionSummaryPayload {
  readonly workId?: string;
  readonly summaryId?: string;
  readonly summaryUri: string;
  readonly nextWorkflow: string;
  readonly reservationIds?: PayloadArray;
  readonly commitShas?: PayloadArray;
  readonly subjectStatus?: string;
  readonly branchName?: string;
  readonly gitRoot?: string;
  readonly evidenceIds?: PayloadArray;
  readonly verificationIds?: PayloadArray;
  readonly openBlockerIds?: PayloadArray;
  readonly openDescendantIds?: PayloadArray;
  readonly requiredGateIds?: PayloadArray;
  readonly nextCommandPath?: string;
  readonly requiredInputs?: PayloadArray;
}

export interface ContainerDescendantCloseoutPayload {
  readonly containerId: string;
  readonly openDescendantIds: PayloadArray;
  readonly requiredGateIds?: PayloadArray;
  readonly childSummaryIds?: PayloadArray;
  readonly childStatuses?: PayloadArray;
  readonly evidenceIds?: PayloadArray;
  readonly verificationIds?: PayloadArray;
  readonly commitShas?: PayloadArray;
  readonly dirtyPathNotes?: PayloadArray;
  readonly deferredWorkIds?: PayloadArray;
  readonly gateState?: PayloadArray;
  readonly closeReason?: string;
}

export interface PhaseCloseRollupPayload {
  readonly phaseId: string;
  readonly childWorkIds: PayloadArray;
  readonly childSummaryIds: PayloadArray;
  readonly childStatuses?: PayloadArray;
  readonly evidenceIds?: PayloadArray;
  readonly verificationIds?: PayloadArray;
  readonly commitShas?: PayloadArray;
  readonly dirtyPathNotes?: PayloadArray;
  readonly deferredWorkIds?: PayloadArray;
  readonly gateIds?: PayloadArray;
  readonly gateState?: PayloadArray;
}

export interface SprintCloseRollupPayload {
  readonly sprintId: string;
  readonly childWorkIds: PayloadArray;
  readonly carryoverWorkIds?: PayloadArray;
  readonly childSummaryIds?: PayloadArray;
  readonly childStatuses?: PayloadArray;
  readonly evidenceIds?: PayloadArray;
  readonly verificationIds?: PayloadArray;
  readonly commitShas?: PayloadArray;
  readonly dirtyPathNotes?: PayloadArray;
  readonly deferredWorkIds?: PayloadArray;
  readonly summaryUri: string;
  readonly gateIds?: PayloadArray;
  readonly gateState?: PayloadArray;
}

export interface SprintLaunchPlanPayload {
  readonly sprintTitle: string;
  readonly childWorkIds: PayloadArray;
  readonly readyWorkIds: PayloadArray;
  readonly checkpointPlan: PayloadArray;
  readonly workflowRef: string;
  readonly sprintId?: string;
}

export interface WorkflowNextCanonicalNextStepPayload {
  readonly workflowRef: string;
  readonly commandPath: string;
  readonly requiredInputs: PayloadArray;
  readonly currentStatus?: string;
  readonly subjectId?: string;
  readonly branchName?: string;
  readonly gitRoot?: string;
  readonly evidenceIds?: PayloadArray;
  readonly verificationIds?: PayloadArray;
  readonly openBlockerIds?: PayloadArray;
  readonly openDescendantIds?: PayloadArray;
  readonly requiredGateIds?: PayloadArray;
  readonly activeReservationIds?: PayloadArray;
  readonly summaryUri?: string;
  readonly summaryId?: string;
}

export interface AgentDirectivePayloadByRegistryId {
  readonly "blocked.resolve-blockers": BlockedResolveBlockersPayload;
  readonly "verification.evidence-required": VerificationEvidenceRequiredPayload;
  readonly "review.gate-required": ReviewGateRequiredPayload;
  readonly "audit.gate-required": AuditGateRequiredPayload;
  readonly "git.checkpoint-required": GitCheckpointRequiredPayload;
  readonly "git.lane-worktree-required": GitLaneWorktreeRequiredPayload;
  readonly "closeout.summary-required": CloseoutSummaryRequiredPayload;
  readonly "doctor.recovery-required": DoctorRecoveryRequiredPayload;
  readonly "memory.reconcile-source": MemoryReconcileSourcePayload;
  readonly "inbox.triage-aging": InboxTriageAgingPayload;
  readonly "handoff.session-summary": HandoffSessionSummaryPayload;
  readonly "container.descendant-closeout": ContainerDescendantCloseoutPayload;
  readonly "phase.close-rollup": PhaseCloseRollupPayload;
  readonly "sprint.close-rollup": SprintCloseRollupPayload;
  readonly "sprint.launch-plan": SprintLaunchPlanPayload;
  readonly "workflow_next.canonical-next-step": WorkflowNextCanonicalNextStepPayload;
}

export type AgentDirectivePayloadRegistryId = Extract<keyof AgentDirectivePayloadByRegistryId, string>;
export type AgentDirectivePayloadFor<RegistryId extends AgentDirectivePayloadRegistryId> =
  AgentDirectivePayloadByRegistryId[RegistryId];

type PayloadFieldMap<RegistryId extends AgentDirectivePayloadRegistryId> = {
  readonly [Key in Extract<keyof AgentDirectivePayloadFor<RegistryId>, string>]-?: AgentDirectivePayloadField<Key>;
};

export const AGENT_DIRECTIVE_PAYLOAD_FIELDS = {
  "blocked.resolve-blockers": {
    subjectId: field("subjectId", "id", true, "Blocked work, sprint, phase, or milestone id."),
    blockerIds: field("blockerIds", "array", true, "Active blocker ids that prevent the current action."),
    blockerTitles: field("blockerTitles", "array", false, "Display titles for active blockers."),
    gateIds: field("gateIds", "array", false, "Required gate ids involved in the blocked state."),
    recoveryWorkflow: field("recoveryWorkflow", "string", false, "Canonical workflow reference for blocker recovery."),
    blockedByIds: field("blockedByIds", "array", false, "Dependency ids that currently block the subject."),
    recommendedCommands: field("recommendedCommands", "array", false, "Safe inspection or recovery commands for blockers."),
    nextCommandPath: field("nextCommandPath", "string", false, "Recommended command path after blocker recovery.")
  },
  "verification.evidence-required": {
    subjectId: field("subjectId", "id", true, "Work, sprint, phase, or milestone id under verification."),
    command: field("command", "string", true, "Validation command that must be run or referenced."),
    expectedVerdict: field("expectedVerdict", "string", true, "Expected verification verdict."),
    gateIds: field("gateIds", "array", false, "Open declared verification gate ids."),
    declaredCommands: field("declaredCommands", "array", false, "Declared commands attached to open verification gates."),
    expectedObservable: field("expectedObservable", "string", false, "Observable text expected in matching evidence."),
    expectedObservables: field("expectedObservables", "array", false, "Observable texts expected by open verification gates."),
    evidenceIds: field("evidenceIds", "array", false, "Evidence ids attached to the subject."),
    verificationIds: field("verificationIds", "array", false, "Verification ids attached to the subject.")
  },
  "review.gate-required": {
    subjectId: field("subjectId", "id", true, "Subject id that owns the review gate."),
    gateIds: field("gateIds", "array", true, "Open review gate ids."),
    requiredEvidenceKinds: field("requiredEvidenceKinds", "array", true, "Evidence kinds accepted by the review gate."),
    minEvidenceCount: field("minEvidenceCount", "number", true, "Minimum passed evidence count required."),
    forceReasonCode: field("forceReasonCode", "string", false, "Approved force reason code when bypassing the gate.")
  },
  "audit.gate-required": {
    subjectId: field("subjectId", "id", true, "Subject id that owns the audit gate."),
    gateIds: field("gateIds", "array", true, "Open audit gate ids."),
    requiredEvidenceKinds: field("requiredEvidenceKinds", "array", true, "Evidence kinds accepted by the audit gate."),
    findingsDisposition: field("findingsDisposition", "string", false, "Disposition for audit findings."),
    forceReasonCode: field("forceReasonCode", "string", false, "Approved force reason code when bypassing the gate.")
  },
  "git.checkpoint-required": {
    gitRoot: field("gitRoot", "string", true, "Git root that was inspected."),
    commitShas: field("commitShas", "array", false, "Scoped checkpoint commit SHAs."),
    dirtyPathNotes: field("dirtyPathNotes", "array", false, "Dirty paths left out of scope with reasons."),
    reasonCode: field("reasonCode", "string", false, "Accepted reason code when no commit is valid."),
    branchName: field("branchName", "string", false, "Branch name inspected for the checkpoint."),
    roots: field("roots", "array", false, "Git root state records inspected for the checkpoint."),
    protectedBranch: field("protectedBranch", "boolean", false, "Whether the primary Git root is on a protected branch."),
    detached: field("detached", "boolean", false, "Whether the primary Git root is detached."),
    clean: field("clean", "boolean", false, "Whether the primary Git root is clean."),
    repositoryChanged: field("repositoryChanged", "boolean", false, "Whether scoped repository changes were observed."),
    noRepoChanges: field("noRepoChanges", "boolean", false, "Whether no scoped repository changes were observed."),
    scopedChangedPaths: field("scopedChangedPaths", "array", false, "Scoped changed paths in the primary Git root."),
    collaborationDirtyPaths: field("collaborationDirtyPaths", "array", false, "Out-of-scope collaboration dirty paths."),
    blockingDirtyPaths: field("blockingDirtyPaths", "array", false, "Dirty paths that block safe checkpointing."),
    untrackedPaths: field("untrackedPaths", "array", false, "Untracked paths observed in the primary Git root."),
    outOfScopeRepoNotes: field("outOfScopeRepoNotes", "array", false, "Operator notes for dirty paths outside the current work."),
    noCommitReason: field("noCommitReason", "string", false, "Accepted reason when no commit SHA is produced."),
    protectedBranchCaveat: field("protectedBranchCaveat", "string", false, "Caveat emitted when checkpointing on a protected branch."),
    lastCommitSha: field("lastCommitSha", "string", false, "Last observed commit SHA for the primary Git root.")
  },
  "git.lane-worktree-required": {
    gitRoot: field("gitRoot", "string", true, "Git root whose shared branch must not be mutated directly."),
    mergeTargetBranch: field("mergeTargetBranch", "string", true, "Shared integration branch that receives reviewed lane merges."),
    laneBranch: field("laneBranch", "string", true, "Per-agent or per-lane branch used for isolated implementation commits."),
    worktreePath: field("worktreePath", "string", true, "Filesystem path for the isolated lane worktree."),
    baseRef: field("baseRef", "string", false, "Ref used as the worktree base, normally the merge target branch."),
    baseSha: field("baseSha", "string", false, "Observed base commit SHA for the lane branch."),
    currentBranch: field("currentBranch", "string", false, "Current branch detected in the shared checkout."),
    agentId: field("agentId", "string", false, "Agent expected to work in the lane worktree."),
    workId: field("workId", "id", false, "Work item assigned to the lane."),
    reason: field("reason", "string", false, "Reason the current checkout requires lane isolation."),
    recommendedCommands: field("recommendedCommands", "array", false, "Safe commands for creating or entering the lane worktree.")
  },
  "closeout.summary-required": {
    subjectId: field("subjectId", "id", true, "Closed or closing subject id."),
    summaryId: field("summaryId", "id", true, "Agent summary record id."),
    summaryUri: field("summaryUri", "uri", true, "Markdown artifact URI for the agent summary."),
    evidenceIds: field("evidenceIds", "array", true, "Evidence ids used in closeout."),
    verificationIds: field("verificationIds", "array", true, "Verification ids used in closeout."),
    commitShas: field("commitShas", "array", false, "Checkpoint commit SHAs included in closeout."),
    dirtyPathNotes: field("dirtyPathNotes", "array", false, "Dirty paths intentionally left out of the checkpoint."),
    summaryStatus: field("summaryStatus", "string", false, "Final or forced summary status."),
    summaryOutcome: field("summaryOutcome", "string", false, "Terminal summary outcome."),
    closeReason: field("closeReason", "string", false, "Close or cancellation reason."),
    duplicateOf: field("duplicateOf", "string", false, "Duplicate target when the terminal outcome is duplicate."),
    forceReasonCode: field("forceReasonCode", "string", false, "Forced-summary reason code."),
    forceComment: field("forceComment", "string", false, "Forced-summary operator comment.")
  },
  "doctor.recovery-required": {
    diagnostics: field("diagnostics", "array", true, "Doctor or sync diagnostics that need attention."),
    recommendedCommands: field("recommendedCommands", "array", true, "Safe recovery commands recommended by Boreal."),
    syncOk: field("syncOk", "boolean", false, "Whether sync status was healthy."),
    doctorOk: field("doctorOk", "boolean", false, "Whether strict doctor was healthy."),
    lockPaths: field("lockPaths", "array", false, "Runtime or search lock paths involved in recovery."),
    diagnosticCodes: field("diagnosticCodes", "array", false, "Diagnostic codes included in the recovery directive."),
    blockingDiagnosticCodes: field("blockingDiagnosticCodes", "array", false, "Diagnostic codes that block continued work."),
    safeWorkflow: field("safeWorkflow", "string", false, "Canonical workflow reference for safe recovery."),
    nextCommandPath: field("nextCommandPath", "string", false, "Recommended command path after recovery."),
    operationCount: field("operationCount", "number", false, "Observed operation log count when available."),
    warningThreshold: field("warningThreshold", "number", false, "Operation log warning threshold when available.")
  },
  "memory.reconcile-source": {
    sourceIds: field("sourceIds", "array", true, "Raw or knowledge source ids that need reconciliation."),
    memoryRoot: field("memoryRoot", "string", true, "Memory root inspected for reconciliation."),
    requiredRecordTypes: field("requiredRecordTypes", "array", true, "Durable record types expected from the source."),
    wikiPageIds: field("wikiPageIds", "array", false, "Wiki pages linked to reconciled source truth."),
    claimIds: field("claimIds", "array", false, "Claim records linked to reconciled source truth.")
  },
  "inbox.triage-aging": {
    rawSourceIds: field("rawSourceIds", "array", true, "Aging queued raw source ids."),
    rawSourceCount: field("rawSourceCount", "number", true, "Number of queued raw sources older than the threshold."),
    oldestRawSourceId: field("oldestRawSourceId", "id", true, "Oldest queued raw source id."),
    oldestAgeDays: field("oldestAgeDays", "number", true, "Oldest queued raw source age in days."),
    thresholdDays: field("thresholdDays", "number", true, "Configured aging threshold in days."),
    command: field("command", "string", true, "Primary triage command."),
    recommendedCommands: field("recommendedCommands", "array", false, "Safe triage commands for aging raw source ids.")
  },
  "handoff.session-summary": {
    workId: field("workId", "id", false, "Current or most recent work id."),
    summaryId: field("summaryId", "id", false, "Agent summary id included in the handoff."),
    summaryUri: field("summaryUri", "uri", true, "Agent summary or handoff artifact URI."),
    nextWorkflow: field("nextWorkflow", "string", true, "Canonical workflow recommended for the next agent."),
    reservationIds: field("reservationIds", "array", false, "Active or released reservation ids."),
    commitShas: field("commitShas", "array", false, "Checkpoint commit SHAs available to the next agent."),
    subjectStatus: field("subjectStatus", "string", false, "Current subject status at handoff time."),
    branchName: field("branchName", "string", false, "Primary Git branch name at handoff time."),
    gitRoot: field("gitRoot", "string", false, "Primary Git root inspected for handoff."),
    evidenceIds: field("evidenceIds", "array", false, "Evidence ids available to the next agent."),
    verificationIds: field("verificationIds", "array", false, "Verification ids available to the next agent."),
    openBlockerIds: field("openBlockerIds", "array", false, "Unresolved blocker ids that the next agent must inspect."),
    openDescendantIds: field("openDescendantIds", "array", false, "Open descendant ids carried into the handoff."),
    requiredGateIds: field("requiredGateIds", "array", false, "Open gate ids carried into the handoff."),
    nextCommandPath: field("nextCommandPath", "string", false, "Recommended command path for the next agent."),
    requiredInputs: field("requiredInputs", "array", false, "Typed input names required by the next workflow.")
  },
  "container.descendant-closeout": {
    containerId: field("containerId", "id", true, "Parent issue, milestone, or project container id."),
    openDescendantIds: field("openDescendantIds", "array", true, "Open descendant ids preventing parent closeout."),
    requiredGateIds: field("requiredGateIds", "array", false, "Descendant or parent gate ids still open."),
    childSummaryIds: field("childSummaryIds", "array", false, "Child summary ids included in the parent rollup."),
    childStatuses: field("childStatuses", "array", false, "Child or descendant status records included in the rollup."),
    evidenceIds: field("evidenceIds", "array", false, "Evidence ids referenced by the parent rollup."),
    verificationIds: field("verificationIds", "array", false, "Verification ids referenced by the parent rollup."),
    commitShas: field("commitShas", "array", false, "Checkpoint commit SHAs referenced by the parent rollup."),
    dirtyPathNotes: field("dirtyPathNotes", "array", false, "Dirty path notes referenced by the parent rollup."),
    deferredWorkIds: field("deferredWorkIds", "array", false, "Deferred or carried-forward descendant work ids."),
    gateState: field("gateState", "array", false, "Required gate state records included in the rollup."),
    closeReason: field("closeReason", "string", false, "Close or force reason used for parent closeout.")
  },
  "phase.close-rollup": {
    phaseId: field("phaseId", "id", true, "Phase or phase-like milestone id."),
    childWorkIds: field("childWorkIds", "array", true, "Child work ids included in the phase rollup."),
    childSummaryIds: field("childSummaryIds", "array", true, "Child summary ids included in the phase rollup."),
    childStatuses: field("childStatuses", "array", false, "Child status records included in the phase rollup."),
    evidenceIds: field("evidenceIds", "array", false, "Evidence ids referenced by the phase rollup."),
    verificationIds: field("verificationIds", "array", false, "Verification ids referenced by the phase rollup."),
    commitShas: field("commitShas", "array", false, "Checkpoint commit SHAs referenced by the phase rollup."),
    dirtyPathNotes: field("dirtyPathNotes", "array", false, "Dirty path notes referenced by the phase rollup."),
    deferredWorkIds: field("deferredWorkIds", "array", false, "Deferred child work ids carried forward from the phase."),
    gateIds: field("gateIds", "array", false, "Required gate ids included in the phase rollup."),
    gateState: field("gateState", "array", false, "Required gate state records included in the phase rollup.")
  },
  "sprint.close-rollup": {
    sprintId: field("sprintId", "id", true, "Sprint id being reported or closed."),
    childWorkIds: field("childWorkIds", "array", true, "Child work ids included in the sprint."),
    carryoverWorkIds: field("carryoverWorkIds", "array", false, "Open child work ids carried forward."),
    childSummaryIds: field("childSummaryIds", "array", false, "Child summary ids included in the sprint rollup."),
    childStatuses: field("childStatuses", "array", false, "Child status records included in the sprint rollup."),
    evidenceIds: field("evidenceIds", "array", false, "Evidence ids referenced by the sprint rollup."),
    verificationIds: field("verificationIds", "array", false, "Verification ids referenced by the sprint rollup."),
    commitShas: field("commitShas", "array", false, "Checkpoint commit SHAs referenced by the sprint rollup."),
    dirtyPathNotes: field("dirtyPathNotes", "array", false, "Dirty path notes referenced by the sprint rollup."),
    deferredWorkIds: field("deferredWorkIds", "array", false, "Deferred child work ids carried forward from the sprint."),
    summaryUri: field("summaryUri", "uri", true, "Sprint report or summary artifact URI."),
    gateIds: field("gateIds", "array", false, "Review, audit, or checkpoint gate ids for the sprint."),
    gateState: field("gateState", "array", false, "Required gate state records included in the sprint rollup.")
  },
  "sprint.launch-plan": {
    sprintTitle: field("sprintTitle", "string", true, "Sprint title being launched."),
    childWorkIds: field("childWorkIds", "array", true, "Child work ids scoped to the sprint."),
    readyWorkIds: field("readyWorkIds", "array", true, "Leaf work ids marked ready at launch."),
    checkpointPlan: field("checkpointPlan", "array", true, "Planned Git or evidence checkpoint boundaries."),
    workflowRef: field("workflowRef", "string", true, "Canonical sprint launch workflow reference."),
    sprintId: field("sprintId", "id", false, "Sprint id after the launch container is created.")
  },
  "workflow_next.canonical-next-step": {
    workflowRef: field("workflowRef", "string", true, "Canonical workflow reference to use next."),
    commandPath: field("commandPath", "string", true, "Recommended command path for the next step."),
    requiredInputs: field("requiredInputs", "array", true, "Typed input names required by the workflow."),
    currentStatus: field("currentStatus", "string", false, "Current status of the subject."),
    subjectId: field("subjectId", "id", false, "Subject id for the next workflow."),
    branchName: field("branchName", "string", false, "Primary Git branch name for workflow navigation."),
    gitRoot: field("gitRoot", "string", false, "Primary Git root for workflow navigation."),
    evidenceIds: field("evidenceIds", "array", false, "Evidence ids relevant to the next workflow."),
    verificationIds: field("verificationIds", "array", false, "Verification ids relevant to the next workflow."),
    openBlockerIds: field("openBlockerIds", "array", false, "Unresolved blocker ids relevant to the next workflow."),
    openDescendantIds: field("openDescendantIds", "array", false, "Open descendant ids relevant to the next workflow."),
    requiredGateIds: field("requiredGateIds", "array", false, "Open gate ids relevant to the next workflow."),
    activeReservationIds: field("activeReservationIds", "array", false, "Active reservation ids relevant to the next workflow."),
    summaryUri: field("summaryUri", "uri", false, "Latest summary or handoff artifact URI."),
    summaryId: field("summaryId", "id", false, "Latest summary id relevant to the next workflow.")
  }
} satisfies { readonly [RegistryId in AgentDirectivePayloadRegistryId]: PayloadFieldMap<RegistryId> };

export const AGENT_DIRECTIVE_PAYLOAD_REGISTRY_IDS = Object.keys(
  AGENT_DIRECTIVE_PAYLOAD_FIELDS
) as readonly AgentDirectivePayloadRegistryId[];

export interface AgentDirectivePayloadRegistryIssue {
  readonly path: string;
  readonly message: string;
  readonly registryId?: AgentDirectiveTemplateId;
}

export function agentDirectivePayloadFields(registryId: string): readonly AgentDirectivePayloadField[] {
  const fields = AGENT_DIRECTIVE_PAYLOAD_FIELDS[registryId as AgentDirectivePayloadRegistryId];
  return fields === undefined ? [] : Object.values(fields);
}

export function agentDirectivePayloadFieldMap(
  registryId: string
): Readonly<Record<string, AgentDirectivePayloadField>> | undefined {
  return AGENT_DIRECTIVE_PAYLOAD_FIELDS[registryId as AgentDirectivePayloadRegistryId];
}

export function agentDirectivePayloadRegistryIssues(
  registry: AgentDirectiveRegistry
): readonly AgentDirectivePayloadRegistryIssue[] {
  const issues: AgentDirectivePayloadRegistryIssue[] = [];
  const registryIds = new Set(registry.entries.map((entry) => entry.id));
  const payloadRegistryIds = new Set<string>(AGENT_DIRECTIVE_PAYLOAD_REGISTRY_IDS);

  registry.entries.forEach((entry, index) => {
    const fields = agentDirectivePayloadFields(entry.id);
    if (fields.length === 0) {
      issues.push({
        path: `$.entries[${index}]`,
        message: "must have a typed payload field contract",
        registryId: entry.id
      });
      return;
    }
    const fieldKeys = fields.map((payloadField) => payloadField.key);
    if (new Set(fieldKeys).size !== fieldKeys.length) {
      issues.push({
        path: `$.payloadFields.${entry.id}`,
        message: "must contain unique payload keys",
        registryId: entry.id
      });
    }
    for (const payloadField of fields) {
      if (!payloadRegistryIds.has(entry.id)) {
        issues.push({
          path: `$.payloadFields.${entry.id}.${payloadField.key}`,
          message: "must reference a known payload registry id",
          registryId: entry.id
        });
      }
    }
  });

  for (const payloadRegistryId of AGENT_DIRECTIVE_PAYLOAD_REGISTRY_IDS) {
    if (!registryIds.has(payloadRegistryId as AgentDirectiveTemplateId)) {
      issues.push({
        path: `$.payloadFields.${payloadRegistryId}`,
        message: "must reference a registry entry"
      });
    }
  }

  return issues;
}

function field<Key extends string>(
  key: Key,
  valueType: AgentDirectivePayloadFieldValueType,
  required: boolean,
  description: string
): AgentDirectivePayloadField<Key> {
  return { key, valueType, required, description };
}
