import {
  AGENT_DIRECTIVE_FAMILIES,
  assertAgentDirectiveRegistry,
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
      triggerCodes: ["work.blocked.open-dependency"],
      nextCommandTemplate: "bwrk dep tree <subjectId> --json",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "force_gate",
        evidenceKind: "note",
        message: "Active blockers require explicit resolution or a forced gate reason."
      }
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
      triggerCodes: [
        "close.no-passing-verification",
        "gate.verification.unsatisfied",
        "gate.declared-command.missing",
        "gate.expected-observable.missing"
      ],
      nextCommandTemplate: "<validation-command>",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "command",
        message: "Passed verification evidence is required before closeout."
      }
    }),
    entry({
      id: "review.gate-required" as AgentDirectiveTemplateId,
      family: "review",
      severity: "required",
      audience: "reviewer",
      kind: "obligation",
      title: "Satisfy review gate",
      instruction: "Obtain passed review evidence for the listed review gate before closing the scoped work.",
      triggerCodes: ["gate.review.unsatisfied"],
      nextCommandTemplate: "bwrk evidence add <subjectId> --kind review --outcome passed --json",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "review",
        message: "A required review gate needs passed review evidence."
      }
    }),
    entry({
      id: "audit.gate-required" as AgentDirectiveTemplateId,
      family: "audit",
      severity: "required",
      audience: "reviewer",
      kind: "obligation",
      title: "Satisfy audit gate",
      instruction: "Obtain passed audit evidence or record an approved forced gate reason before closing the scoped work.",
      triggerCodes: ["gate.audit.unsatisfied"],
      nextCommandTemplate: "bwrk evidence add <subjectId> --kind command --outcome passed --json",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "artifact",
        message: "A required audit gate needs passed audit evidence or approved force metadata."
      }
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
      triggerCodes: ["git.checkpoint.required", "gate.checkpoint.unsatisfied", "summary.checkpoint-missing"],
      nextCommandTemplate: "git status --short --branch",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "command",
        message: "A Git checkpoint or accepted no-commit reason is required before closeout."
      }
    }),
    entry({
      id: "git.lane-worktree-required" as AgentDirectiveTemplateId,
      family: "git",
      severity: "required",
      audience: "agent",
      kind: "obligation",
      title: "Use isolated lane worktree",
      instruction:
        "Move state-changing agent work off the shared integration branch and into the named lane worktree before mutating files or records.",
      triggerCodes: ["git.lane-worktree.required"],
      nextCommandTemplate: "git worktree add <worktreePath> -b <laneBranch> <baseRef>",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "command",
        message: "Parallel or shared-branch work requires an isolated lane worktree before mutation."
      }
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
      triggerCodes: ["closeout.user-summary.required", "summary.missing"],
      nextCommandTemplate: "bwrk summary show <subjectId> --json",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "note",
        message: "The user-facing closeout summary must be prepared from verified data."
      }
    }),
    entry({
      id: "doctor.recovery-required" as AgentDirectiveTemplateId,
      family: "doctor",
      severity: "required",
      audience: "agent",
      kind: "recovery",
      title: "Recover workspace health",
      instruction: "Run the safe health workflow for the listed diagnostics before continuing dependent work.",
      triggerCodes: ["doctor.recovery.required", "search.index-stale"],
      nextCommandTemplate: "bwrk doctor --strict --json",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "handoff",
        evidenceKind: "command",
        message: "Workspace health diagnostics require safe recovery before dependent work continues."
      }
    }),
    entry({
      id: "memory.reconcile-source" as AgentDirectiveTemplateId,
      family: "memory",
      severity: "advisory",
      audience: "agent",
      kind: "obligation",
      title: "Reconcile source-backed memory",
      instruction:
        "Reconcile source-backed memory changes into wiki, claim, decision, or work records before treating them as durable project truth.",
      triggerCodes: ["memory.reconcile-source.required"],
      nextCommandTemplate: "bwrk raw triage --json"
    }),
    entry({
      id: "inbox.triage-aging" as AgentDirectiveTemplateId,
      family: "memory",
      severity: "advisory",
      audience: "agent",
      kind: "obligation",
      title: "Triage aging raw inbox items",
      instruction:
        "Review aging global raw inbox items and route, keep, or drop them through raw triage.",
      triggerCodes: ["inbox.triage.aging"],
      nextCommandTemplate: "bwrk global raw triage <action> <raw-id> --json"
    }),
    entry({
      id: "handoff.session-summary" as AgentDirectiveTemplateId,
      family: "handoff",
      severity: "advisory",
      audience: "agent",
      kind: "summary",
      title: "Prepare session handoff",
      instruction:
        "Build a handoff that names the current work, evidence, verification, summary artifact, checkpoint state, and next canonical workflow.",
      triggerCodes: ["handoff.session-summary.required"],
      nextCommandTemplate: "bwrk session end --json"
    }),
    entry({
      id: "container.descendant-closeout" as AgentDirectiveTemplateId,
      family: "container",
      severity: "advisory",
      audience: "agent",
      kind: "obligation",
      title: "Close descendant blockers",
      instruction: "Close or document every descendant blocker before closing the parent container.",
      triggerCodes: ["work.container.open-descendant", "container.descendant-closeout.required"],
      nextCommandTemplate: "bwrk dep tree <containerId> --json",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "artifact",
        message: "Parent containers require closed or documented descendant blockers."
      }
    }),
    entry({
      id: "phase.close-rollup" as AgentDirectiveTemplateId,
      family: "phase",
      severity: "advisory",
      audience: "agent",
      kind: "summary",
      title: "Roll up phase closeout",
      instruction: "Roll up child task outcomes, evidence, verification, and checkpoint references before closing the phase.",
      triggerCodes: ["phase.close-rollup.required"],
      nextCommandTemplate: "bwrk summary compose <phaseId> --json"
    }),
    entry({
      id: "sprint.close-rollup" as AgentDirectiveTemplateId,
      family: "sprint",
      severity: "advisory",
      audience: "agent",
      kind: "summary",
      title: "Prepare sprint closeout",
      instruction:
        "Prepare the sprint report with closed child status, carryover, verification, gate evidence, and checkpoint references before closing the sprint.",
      triggerCodes: ["sprint.close-rollup.required"],
      nextCommandTemplate: "bwrk sprint report <sprintId> --json"
    }),
    entry({
      id: "sprint.launch-plan" as AgentDirectiveTemplateId,
      family: "sprint",
      severity: "advisory",
      audience: "agent",
      kind: "obligation",
      title: "Prepare sprint launch",
      instruction:
        "Create the sprint container, attach scoped child work, mark only unblocked leaf tasks ready, and record checkpoint boundaries before implementation starts.",
      triggerCodes: ["sprint.launch-plan.required"],
      nextCommandTemplate: "bwrk work create <sprint-title> --json"
    }),
    entry({
      id: "workflow_next.canonical-next-step" as AgentDirectiveTemplateId,
      family: "workflow_next",
      severity: "advisory",
      audience: "agent",
      kind: "next_step",
      title: "Follow next canonical workflow",
      instruction: "Follow the named canonical workflow and pass only the listed typed inputs to the next command.",
      triggerCodes: ["directive.workflow-next.available"],
      nextCommandTemplate: "<workflow-recommended-command>"
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
