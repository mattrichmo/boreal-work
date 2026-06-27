import type { MemoryDashboardActionsView, MemoryWorkflowActionKind, MemoryWorkflowActionView } from "./types.js";

const MEMORY_WORKFLOW_ACTIONS: readonly Omit<MemoryWorkflowActionView, "workflowCommand" | "workflowSourcePath">[] = [
  {
    id: "raw.add-source",
    title: "Add raw source",
    kind: "add",
    skillName: "boreal-raw-inbox",
    skillRef: "$boreal-raw-inbox",
    workflowPath: "20-memory/add-raw-source.md",
    summary: "Use the raw inbox adapter to add immutable source material through the canonical workflow."
  },
  {
    id: "raw.triage-inbox",
    title: "Triage raw inbox",
    kind: "update",
    skillName: "boreal-raw-inbox",
    skillRef: "$boreal-raw-inbox",
    workflowPath: "20-memory/triage-raw-inbox.md",
    summary: "Use the raw inbox adapter to review queued raw sources and decide the next workflow."
  },
  {
    id: "raw.retrieve-source",
    title: "Retrieve raw source",
    kind: "retrieve",
    skillName: "boreal-raw-inbox",
    skillRef: "$boreal-raw-inbox",
    workflowPath: "10-context/retrieve-raw-source.md",
    summary: "Use the raw inbox adapter to inspect source-backed material without mutating it."
  },
  {
    id: "memory.reconcile-raw",
    title: "Reconcile raw to memory",
    kind: "reconcile",
    skillName: "boreal-memory-reconcile",
    skillRef: "$boreal-memory-reconcile",
    workflowPath: "20-memory/reconcile-raw-to-memory.md",
    summary: "Use the reconcile adapter to promote raw material into wiki, claims, decisions, or work."
  },
  {
    id: "memory.update",
    title: "Update memory",
    kind: "update",
    skillName: "boreal-memory-reconcile",
    skillRef: "$boreal-memory-reconcile",
    workflowPath: "20-memory/update-memory.md",
    summary: "Use the reconcile adapter for bounded memory updates after retrieval and conflict checks."
  },
  {
    id: "memory.reconcile-chat",
    title: "Reconcile chat thread",
    kind: "reconcile",
    skillName: "boreal-memory-reconcile",
    skillRef: "$boreal-memory-reconcile",
    workflowPath: "20-memory/reconcile-chat-thread.md",
    summary: "Use the reconcile adapter when a chat transcript needs to become durable memory."
  },
  {
    id: "knowledge.create-wiki",
    title: "Create wiki page",
    kind: "add",
    skillName: "boreal-wiki-claim-decision",
    skillRef: "$boreal-wiki-claim-decision",
    workflowPath: "30-knowledge/create-wiki-page.md",
    summary: "Use the knowledge adapter to create source-backed wiki pages."
  },
  {
    id: "knowledge.create-claim",
    title: "Create claim",
    kind: "add",
    skillName: "boreal-wiki-claim-decision",
    skillRef: "$boreal-wiki-claim-decision",
    workflowPath: "30-knowledge/create-claim.md",
    summary: "Use the knowledge adapter to create a claim with source references."
  },
  {
    id: "knowledge.capture-decision",
    title: "Capture decision",
    kind: "add",
    skillName: "boreal-wiki-claim-decision",
    skillRef: "$boreal-wiki-claim-decision",
    workflowPath: "30-knowledge/capture-decision.md",
    summary: "Use the knowledge adapter to capture a durable decision record."
  },
  {
    id: "knowledge.supersede-decision",
    title: "Supersede decision",
    kind: "update",
    skillName: "boreal-wiki-claim-decision",
    skillRef: "$boreal-wiki-claim-decision",
    workflowPath: "30-knowledge/supersede-decision.md",
    summary: "Use the knowledge adapter to supersede an existing decision without rewriting history."
  }
];

export function createMemoryDashboardActions(generatedAt: string): MemoryDashboardActionsView {
  const actions = MEMORY_WORKFLOW_ACTIONS.map((action) => ({
    ...action,
    workflowSourcePath: memoryWorkflowSourcePath(action.workflowPath),
    workflowCommand: memoryWorkflowShowCommand(action.workflowPath)
  }));
  return {
    generatedAt,
    actions,
    summary: {
      total: actions.length,
      add: countKind(actions, "add"),
      update: countKind(actions, "update"),
      retrieve: countKind(actions, "retrieve"),
      reconcile: countKind(actions, "reconcile")
    },
    warnings: []
  };
}

export function memoryWorkflowShowCommand(workflowPath: string): string {
  return `bwrk workflows show ${workflowPath} --json`;
}

export function memoryWorkflowSourcePath(workflowPath: string): string {
  return `workflows/${workflowPath}`;
}

function countKind(actions: readonly MemoryWorkflowActionView[], kind: MemoryWorkflowActionKind): number {
  return actions.filter((action) => action.kind === kind).length;
}
