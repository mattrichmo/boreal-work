import {
  AGENT_DIRECTIVE_FAMILIES,
  assertAgentDirectiveRegistry,
  type AgentDirectiveDataRequirement,
  type AgentDirectiveDataRequirementType,
  type AgentDirectiveFamily,
  type AgentDirectiveRegistry,
  type AgentDirectiveRegistryEntry,
  type AgentDirectiveRegistryVersion,
  type AgentDirectiveTemplateId,
  type AgentDirectiveVersion
} from "./agent-directives.js";

export const AGENT_DIRECTIVE_REGISTRY_VERSION = "directives.v1" as AgentDirectiveRegistryVersion;
export const AGENT_DIRECTIVE_REGISTRY_SOURCE_PATH = "packages/core/src/agent-directive-registry.ts";

const REGISTRY_ENTRY_VERSION = "v1" as AgentDirectiveVersion;

type RegistryEntryInput = Omit<
  AgentDirectiveRegistryEntry,
  "defaultLifecycle" | "lifecycle" | "sourcePath" | "supersedes" | "version"
> &
  Partial<Pick<AgentDirectiveRegistryEntry, "defaultLifecycle" | "lifecycle" | "supersedes">>;

function requirement(
  key: string,
  valueType: AgentDirectiveDataRequirementType,
  required: boolean,
  description: string
): AgentDirectiveDataRequirement {
  return { key, valueType, required, description };
}

function entry(input: RegistryEntryInput): AgentDirectiveRegistryEntry {
  return {
    ...input,
    version: REGISTRY_ENTRY_VERSION,
    defaultLifecycle: input.defaultLifecycle ?? "active",
    lifecycle: input.lifecycle ?? "active",
    sourcePath: AGENT_DIRECTIVE_REGISTRY_SOURCE_PATH,
    supersedes: input.supersedes ?? []
  };
}

export const AGENT_DIRECTIVE_REGISTRY: AgentDirectiveRegistry = {
  version: AGENT_DIRECTIVE_REGISTRY_VERSION,
  entries: [
    entry({
      id: "blocked.resolve-blockers" as AgentDirectiveTemplateId,
      family: "blocked",
      severity: "blocking",
      audience: "agent",
      kind: "recovery",
      title: "Resolve active blockers",
      instruction:
        "Stop the current mutation until the listed blockers are resolved, closed, or explicitly forced through an approved gate.",
      appliesTo: {
        commandPaths: ["agent start", "agent finish", "dep tree", "work close", "work show"],
        subjectTypes: ["work", "sprint", "phase", "milestone"],
        workStatuses: ["blocked"]
      },
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "force_gate",
        evidenceKind: "note",
        message: "Active blockers require explicit resolution or a forced gate reason."
      },
      dataRequirements: [
        requirement("subjectId", "id", true, "Blocked work, sprint, phase, or milestone id."),
        requirement("blockerIds", "array", true, "Active blocker ids that prevent the current action."),
        requirement("blockerTitles", "array", false, "Display titles for active blockers."),
        requirement("gateIds", "array", false, "Required gate ids involved in the blocked state."),
        requirement("recoveryWorkflow", "string", false, "Canonical workflow reference for blocker recovery.")
      ]
    }),
    entry({
      id: "verification.evidence-required" as AgentDirectiveTemplateId,
      family: "verification",
      severity: "required",
      audience: "agent",
      kind: "obligation",
      title: "Attach passed verification evidence",
      instruction:
        "Run the required validation command and attach passed verification evidence before reporting the work as complete.",
      appliesTo: {
        commandPaths: ["agent finish", "work close", "work verify"],
        subjectTypes: ["work", "sprint", "phase", "milestone"],
        workStatuses: ["in_progress", "ready", "blocked"]
      },
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "command",
        message: "Passed verification evidence is required before closeout."
      },
      dataRequirements: [
        requirement("subjectId", "id", true, "Work, sprint, phase, or milestone id under verification."),
        requirement("command", "string", true, "Validation command that must be run or referenced."),
        requirement("expectedVerdict", "string", true, "Expected verification verdict."),
        requirement("evidenceIds", "array", false, "Evidence ids attached to the subject."),
        requirement("verificationIds", "array", false, "Verification ids attached to the subject.")
      ]
    }),
    entry({
      id: "review.gate-required" as AgentDirectiveTemplateId,
      family: "review",
      severity: "required",
      audience: "reviewer",
      kind: "obligation",
      title: "Satisfy review gate",
      instruction: "Obtain passed review evidence for the listed review gate before closing the scoped work.",
      appliesTo: {
        commandPaths: ["agent finish", "gate closeout", "summary compose", "summary show", "work close"],
        subjectTypes: ["work", "sprint", "phase", "milestone"],
        gates: ["review"]
      },
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "review",
        message: "A required review gate needs passed review evidence."
      },
      dataRequirements: [
        requirement("subjectId", "id", true, "Subject id that owns the review gate."),
        requirement("gateIds", "array", true, "Open review gate ids."),
        requirement("requiredEvidenceKinds", "array", true, "Evidence kinds accepted by the review gate."),
        requirement("minEvidenceCount", "number", true, "Minimum passed evidence count required."),
        requirement("forceReasonCode", "string", false, "Approved force reason code when bypassing the gate.")
      ]
    }),
    entry({
      id: "audit.gate-required" as AgentDirectiveTemplateId,
      family: "audit",
      severity: "required",
      audience: "reviewer",
      kind: "obligation",
      title: "Satisfy audit gate",
      instruction: "Obtain passed audit evidence or record an approved forced gate reason before closing the scoped work.",
      appliesTo: {
        commandPaths: ["agent finish", "gate closeout", "summary compose", "summary show", "work close"],
        subjectTypes: ["work", "sprint", "phase", "milestone", "project"],
        gates: ["audit"]
      },
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "artifact",
        message: "A required audit gate needs passed audit evidence or approved force metadata."
      },
      dataRequirements: [
        requirement("subjectId", "id", true, "Subject id that owns the audit gate."),
        requirement("gateIds", "array", true, "Open audit gate ids."),
        requirement("requiredEvidenceKinds", "array", true, "Evidence kinds accepted by the audit gate."),
        requirement("findingsDisposition", "string", false, "Disposition for audit findings."),
        requirement("forceReasonCode", "string", false, "Approved force reason code when bypassing the gate.")
      ]
    }),
    entry({
      id: "git.checkpoint-required" as AgentDirectiveTemplateId,
      family: "git",
      severity: "required",
      audience: "agent",
      kind: "obligation",
      title: "Record Git checkpoint",
      instruction:
        "Inspect the Git roots, commit only scoped changes, and record a commit SHA or accepted dirty-path reason before closeout.",
      appliesTo: {
        commandPaths: ["agent finish", "summary compose", "summary show", "sync status", "work close", "work cancel"],
        subjectTypes: ["work", "sprint", "phase", "milestone", "project"]
      },
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "command",
        message: "A Git checkpoint or accepted no-commit reason is required before closeout."
      },
      dataRequirements: [
        requirement("gitRoot", "string", true, "Git root that was inspected."),
        requirement("commitShas", "array", false, "Scoped checkpoint commit SHAs."),
        requirement("dirtyPathNotes", "array", false, "Dirty paths left out of scope with reasons."),
        requirement("reasonCode", "string", false, "Accepted reason code when no commit is valid."),
        requirement("branchName", "string", false, "Branch name inspected for the checkpoint.")
      ]
    }),
    entry({
      id: "closeout.summary-required" as AgentDirectiveTemplateId,
      family: "closeout",
      severity: "required",
      audience: "agent",
      kind: "summary",
      title: "Respond with closeout summary",
      instruction:
        "Respond to the user with a concise summary of the verified terminal outcome, summary artifact, checkpoint, remaining risks, and next workflow.",
      appliesTo: {
        commandPaths: ["agent finish", "summary compose", "summary show", "work close", "work cancel"],
        subjectTypes: ["work", "sprint", "phase", "milestone", "project"],
        workStatuses: ["in_progress", "closed", "cancelled"]
      },
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "note",
        message: "The user-facing closeout summary must be prepared from verified data."
      },
      dataRequirements: [
        requirement("subjectId", "id", true, "Closed or closing subject id."),
        requirement("summaryId", "id", true, "Agent summary record id."),
        requirement("summaryUri", "uri", true, "Markdown artifact URI for the agent summary."),
        requirement("evidenceIds", "array", true, "Evidence ids used in closeout."),
        requirement("verificationIds", "array", true, "Verification ids used in closeout."),
        requirement("commitShas", "array", false, "Checkpoint commit SHAs included in closeout."),
        requirement("dirtyPathNotes", "array", false, "Dirty paths intentionally left out of the checkpoint."),
        requirement("summaryStatus", "string", false, "Final or forced summary status."),
        requirement("summaryOutcome", "string", false, "Terminal summary outcome."),
        requirement("closeReason", "string", false, "Close or cancellation reason."),
        requirement("duplicateOf", "string", false, "Duplicate target when the terminal outcome is duplicate."),
        requirement("forceReasonCode", "string", false, "Forced-summary reason code."),
        requirement("forceComment", "string", false, "Forced-summary operator comment.")
      ]
    }),
    entry({
      id: "doctor.recovery-required" as AgentDirectiveTemplateId,
      family: "doctor",
      severity: "required",
      audience: "agent",
      kind: "recovery",
      title: "Recover workspace health",
      instruction: "Run the safe health workflow for the listed diagnostics before continuing dependent work.",
      appliesTo: {
        commandPaths: ["doctor", "lock inspect", "prime", "sync refresh", "sync status"],
        subjectTypes: ["workspace", "project", "session"]
      },
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "handoff",
        evidenceKind: "command",
        message: "Workspace health diagnostics require safe recovery before dependent work continues."
      },
      dataRequirements: [
        requirement("diagnostics", "array", true, "Doctor or sync diagnostics that need attention."),
        requirement("recommendedCommands", "array", true, "Safe recovery commands recommended by Boreal."),
        requirement("syncOk", "boolean", false, "Whether sync status was healthy."),
        requirement("doctorOk", "boolean", false, "Whether strict doctor was healthy."),
        requirement("lockPaths", "array", false, "Runtime or search lock paths involved in recovery.")
      ]
    }),
    entry({
      id: "memory.reconcile-source" as AgentDirectiveTemplateId,
      family: "memory",
      severity: "action",
      audience: "agent",
      kind: "obligation",
      title: "Reconcile source-backed memory",
      instruction:
        "Reconcile source-backed memory changes into wiki, claim, decision, or work records before treating them as durable project truth.",
      appliesTo: {
        commandPaths: ["context rebuild", "raw add", "raw triage", "sync refresh"],
        subjectTypes: ["workspace", "project", "work"]
      },
      dataRequirements: [
        requirement("sourceIds", "array", true, "Raw or knowledge source ids that need reconciliation."),
        requirement("memoryRoot", "string", true, "Memory root inspected for reconciliation."),
        requirement("requiredRecordTypes", "array", true, "Durable record types expected from the source."),
        requirement("wikiPageIds", "array", false, "Wiki pages linked to reconciled source truth."),
        requirement("claimIds", "array", false, "Claim records linked to reconciled source truth.")
      ]
    }),
    entry({
      id: "handoff.session-summary" as AgentDirectiveTemplateId,
      family: "handoff",
      severity: "action",
      audience: "agent",
      kind: "summary",
      title: "Prepare session handoff",
      instruction:
        "Build a handoff that names the current work, evidence, verification, summary artifact, checkpoint state, and next canonical workflow.",
      appliesTo: {
        commandPaths: ["agent finish", "session end", "summary compose", "summary show"],
        subjectTypes: ["session", "work", "sprint", "project"]
      },
      dataRequirements: [
        requirement("workId", "id", false, "Current or most recent work id."),
        requirement("summaryUri", "uri", true, "Agent summary or handoff artifact URI."),
        requirement("nextWorkflow", "string", true, "Canonical workflow recommended for the next agent."),
        requirement("reservationIds", "array", false, "Active or released reservation ids."),
        requirement("commitShas", "array", false, "Checkpoint commit SHAs available to the next agent.")
      ]
    }),
    entry({
      id: "container.descendant-closeout" as AgentDirectiveTemplateId,
      family: "container",
      severity: "action",
      audience: "agent",
      kind: "obligation",
      title: "Close descendant blockers",
      instruction: "Close or document every descendant blocker before closing the parent container.",
      appliesTo: {
        commandPaths: ["agent finish", "dep tree", "summary compose", "summary show", "work close"],
        subjectTypes: ["work", "milestone", "project"]
      },
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "artifact",
        message: "Parent containers require closed or documented descendant blockers."
      },
      dataRequirements: [
        requirement("containerId", "id", true, "Parent issue, milestone, or project container id."),
        requirement("openDescendantIds", "array", true, "Open descendant ids preventing parent closeout."),
        requirement("requiredGateIds", "array", false, "Descendant or parent gate ids still open."),
        requirement("childSummaryIds", "array", false, "Child summary ids included in the parent rollup."),
        requirement("childStatuses", "array", false, "Child or descendant status records included in the rollup."),
        requirement("evidenceIds", "array", false, "Evidence ids referenced by the parent rollup."),
        requirement("verificationIds", "array", false, "Verification ids referenced by the parent rollup."),
        requirement("commitShas", "array", false, "Checkpoint commit SHAs referenced by the parent rollup."),
        requirement("dirtyPathNotes", "array", false, "Dirty path notes referenced by the parent rollup."),
        requirement("deferredWorkIds", "array", false, "Deferred or carried-forward descendant work ids."),
        requirement("gateState", "array", false, "Required gate state records included in the rollup."),
        requirement("closeReason", "string", false, "Close or force reason used for parent closeout.")
      ]
    }),
    entry({
      id: "phase.close-rollup" as AgentDirectiveTemplateId,
      family: "phase",
      severity: "action",
      audience: "agent",
      kind: "summary",
      title: "Roll up phase closeout",
      instruction: "Roll up child task outcomes, evidence, verification, and checkpoint references before closing the phase.",
      appliesTo: {
        commandPaths: ["agent finish", "summary compose", "summary show", "work close"],
        subjectTypes: ["phase", "milestone"]
      },
      dataRequirements: [
        requirement("phaseId", "id", true, "Phase or phase-like milestone id."),
        requirement("childWorkIds", "array", true, "Child work ids included in the phase rollup."),
        requirement("childSummaryIds", "array", true, "Child summary ids included in the phase rollup."),
        requirement("childStatuses", "array", false, "Child status records included in the phase rollup."),
        requirement("evidenceIds", "array", false, "Evidence ids referenced by the phase rollup."),
        requirement("verificationIds", "array", false, "Verification ids referenced by the phase rollup."),
        requirement("commitShas", "array", false, "Checkpoint commit SHAs referenced by the phase rollup."),
        requirement("dirtyPathNotes", "array", false, "Dirty path notes referenced by the phase rollup."),
        requirement("deferredWorkIds", "array", false, "Deferred child work ids carried forward from the phase."),
        requirement("gateIds", "array", false, "Required gate ids included in the phase rollup."),
        requirement("gateState", "array", false, "Required gate state records included in the phase rollup.")
      ]
    }),
    entry({
      id: "sprint.close-rollup" as AgentDirectiveTemplateId,
      family: "sprint",
      severity: "action",
      audience: "agent",
      kind: "summary",
      title: "Prepare sprint closeout",
      instruction:
        "Prepare the sprint report with closed child status, carryover, verification, gate evidence, and checkpoint references before closing the sprint.",
      appliesTo: {
        commandPaths: ["agent finish", "sprint close", "sprint metrics", "sprint report", "summary compose"],
        subjectTypes: ["sprint"]
      },
      dataRequirements: [
        requirement("sprintId", "id", true, "Sprint id being reported or closed."),
        requirement("childWorkIds", "array", true, "Child work ids included in the sprint."),
        requirement("carryoverWorkIds", "array", false, "Open child work ids carried forward."),
        requirement("childSummaryIds", "array", false, "Child summary ids included in the sprint rollup."),
        requirement("childStatuses", "array", false, "Child status records included in the sprint rollup."),
        requirement("evidenceIds", "array", false, "Evidence ids referenced by the sprint rollup."),
        requirement("verificationIds", "array", false, "Verification ids referenced by the sprint rollup."),
        requirement("commitShas", "array", false, "Checkpoint commit SHAs referenced by the sprint rollup."),
        requirement("dirtyPathNotes", "array", false, "Dirty path notes referenced by the sprint rollup."),
        requirement("deferredWorkIds", "array", false, "Deferred child work ids carried forward from the sprint."),
        requirement("summaryUri", "uri", true, "Sprint report or summary artifact URI."),
        requirement("gateIds", "array", false, "Review, audit, or checkpoint gate ids for the sprint."),
        requirement("gateState", "array", false, "Required gate state records included in the sprint rollup.")
      ]
    }),
    entry({
      id: "sprint.launch-plan" as AgentDirectiveTemplateId,
      family: "sprint",
      severity: "action",
      audience: "agent",
      kind: "obligation",
      title: "Prepare sprint launch",
      instruction:
        "Create the sprint container, attach scoped child work, mark only unblocked leaf tasks ready, and record checkpoint boundaries before implementation starts.",
      appliesTo: {
        commandPaths: ["dep add", "doctor", "prime", "session start", "sync refresh", "work create", "work ready"],
        subjectTypes: ["project", "session", "sprint"]
      },
      dataRequirements: [
        requirement("sprintTitle", "string", true, "Sprint title being launched."),
        requirement("childWorkIds", "array", true, "Child work ids scoped to the sprint."),
        requirement("readyWorkIds", "array", true, "Leaf work ids marked ready at launch."),
        requirement("checkpointPlan", "array", true, "Planned Git or evidence checkpoint boundaries."),
        requirement("workflowRef", "string", true, "Canonical sprint launch workflow reference."),
        requirement("sprintId", "id", false, "Sprint id after the launch container is created.")
      ]
    }),
    entry({
      id: "workflow_next.canonical-next-step" as AgentDirectiveTemplateId,
      family: "workflow_next",
      severity: "action",
      audience: "agent",
      kind: "next_step",
      title: "Follow next canonical workflow",
      instruction: "Follow the named canonical workflow and pass only the listed typed inputs to the next command.",
      appliesTo: {
        commandPaths: [
          "agent start",
          "agent finish",
          "prime",
          "gate closeout",
          "sprint metrics",
          "sprint report",
          "summary compose",
          "summary show",
          "work cancel",
          "work close",
          "work show",
          "workflows show"
        ],
        subjectTypes: ["work", "sprint", "phase", "milestone", "session"]
      },
      dataRequirements: [
        requirement("workflowRef", "string", true, "Canonical workflow reference to use next."),
        requirement("commandPath", "string", true, "Recommended command path for the next step."),
        requirement("requiredInputs", "array", true, "Typed input names required by the workflow."),
        requirement("currentStatus", "string", false, "Current status of the subject."),
        requirement("subjectId", "id", false, "Subject id for the next workflow.")
      ]
    })
  ]
};

assertAgentDirectiveRegistry(AGENT_DIRECTIVE_REGISTRY);

export const AGENT_DIRECTIVE_REGISTRY_ENTRIES = AGENT_DIRECTIVE_REGISTRY.entries;
export const AGENT_DIRECTIVE_REGISTRY_IDS = AGENT_DIRECTIVE_REGISTRY_ENTRIES.map((registryEntry) => registryEntry.id);

export function agentDirectiveRegistryEntriesByFamily(
  entries: readonly AgentDirectiveRegistryEntry[] = AGENT_DIRECTIVE_REGISTRY.entries
): Readonly<Record<AgentDirectiveFamily, readonly AgentDirectiveRegistryEntry[]>> {
  const grouped = Object.fromEntries(AGENT_DIRECTIVE_FAMILIES.map((family) => [family, []])) as unknown as Record<
    AgentDirectiveFamily,
    AgentDirectiveRegistryEntry[]
  >;
  for (const registryEntry of entries) {
    grouped[registryEntry.family].push(registryEntry);
  }
  return grouped;
}

export const AGENT_DIRECTIVE_REGISTRY_BY_FAMILY = agentDirectiveRegistryEntriesByFamily();
