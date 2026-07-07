import { basename } from "node:path";

import {
  buildDashboardHealthView,
  buildGlobalActivityView,
  buildGlobalBoardView,
  buildGlobalHealthView,
  buildGlobalSearchView,
  buildGlobalSettingsView,
  buildGlobalWorkQueuesView,
  buildProjectRegistryView,
  buildSprintBoardView,
  buildWorkDashboardView,
  type DashboardFinding,
  type LockDashboardView,
  type SyncDashboardView,
  type WorkDirectiveSummaryView,
  type WorkItemView
} from "@boreal/ui-model";

import { SAFE_CONSOLE_COMMANDS } from "./commands.js";
import { createMemoryDashboardActions, memoryWorkflowShowCommand } from "./memory-actions.js";
import { routesForScope } from "./routes.js";
import type {
  ConsoleDataSet,
  ConsoleScope,
  RawContradictionReviewView,
  RawIngestPlanView,
  RawInboxView,
  RawSourceDetailView,
  RawSourceRowView,
  ReportsView,
  WikiExplorerView,
  WikiPageRowView
} from "./types.js";

export type ConsoleFixtureScenario = "default" | "empty" | "reservation" | "stale" | "verification";

export function createFixtureConsoleData(input: {
  readonly workspaceRoot: string;
  readonly generatedAt?: string;
  readonly scenario?: ConsoleFixtureScenario;
  readonly warnings?: readonly string[];
  readonly scope?: ConsoleScope;
}): ConsoleDataSet {
  const generatedAt = input.generatedAt ?? new Date().toISOString();
  const scope: ConsoleScope = input.scope ?? "repo";
  const scenario = input.scenario ?? "default";
  const sprint = workItem({
    id: "bw_work_5d61b84c8d43c6a9",
    kind: "sprint",
    status: "blocked",
    title: "Sprint 04 - Client console app foundation",
    directiveSummary: directiveSummary("bw_work_5d61b84c8d43c6a9")
  });
  const sprintWork = sprint04FixtureWork(scenario);
  const healthFindings = fixtureHealthFindings(scenario, input.workspaceRoot);
  const work = buildWorkDashboardView({
    work: sprintWork,
    labels: ["sprint-04"],
    generatedAt
  });
  const health = buildDashboardHealthView({
    title: "Doctor",
    generatedAt,
    findings: healthFindings
  });
  const activeReservationCount = sprintWork.filter((item) => item.activeReservationId).length;
  const stale = scenario === "stale";
  const sync = syncView({ workspaceRoot: input.workspaceRoot, generatedAt, ok: !stale });
  const locks = lockView({ workspaceRoot: input.workspaceRoot, generatedAt });
  const registryEntry = {
    id: "boreal-work",
    name: "boreal-work",
    lifecycle: "linked" as const,
    projectRoot: input.workspaceRoot,
    memoryRoot: `${input.workspaceRoot}/memory`,
    memoryLayout: "in-repo" as const,
    memoryGitMode: "separate" as const,
    health: stale ? "warning" as const : "ok" as const,
    stale,
    syncFreshness: stale ? "stale" as const : "fresh" as const,
    openWorkCount: sprintWork.filter((item) => item.status !== "closed").length,
    readyWorkCount: sprintWork.filter((item) => item.status === "ready").length,
    blockedWorkCount: sprintWork.filter((item) => item.status === "blocked").length,
    activeReservationCount,
    findings: healthFindings,
    lastSeenAt: generatedAt
  };
  const missingRegistryEntry = stale ? {
    id: "missing-work",
    name: "missing-work",
    lifecycle: "missing" as const,
    projectRoot: "/workspace/missing-work",
    memoryRoot: "/workspace/missing-work/memory",
    memoryLayout: "in-repo" as const,
    memoryGitMode: "separate" as const,
    health: "missing" as const,
    stale: true,
    syncFreshness: "stale" as const,
    openWorkCount: 0,
    readyWorkCount: 0,
    blockedWorkCount: 0,
    activeReservationCount: 0,
    findings: [],
    lastSeenAt: "2026-06-01T00:00:00.000Z"
  } : undefined;
  const registryEntries = [registryEntry, ...(missingRegistryEntry ? [missingRegistryEntry] : [])];

  return {
    workspace: {
      projectName: basename(input.workspaceRoot),
      workspaceRoot: input.workspaceRoot,
      memoryRoot: `${input.workspaceRoot}/memory`,
      mode: "fixture",
      scope,
      generatedAt,
      stale,
      warnings: input.warnings ?? (stale ? ["Fixture sync state is stale."] : [])
    },
    routes: routesForScope(scope),
    registry: buildProjectRegistryView({
      generatedAt,
      entries: registryEntries
    }),
    globalBoard: buildGlobalBoardView({
      generatedAt,
      projects: registryEntries.map((entry) => ({
        projectId: entry.id,
        projectName: entry.name,
        projectRoot: entry.projectRoot,
        lifecycle: entry.lifecycle,
        health: entry.health,
        stale: entry.stale,
        syncFreshness: entry.syncFreshness,
        work: entry.id === registryEntry.id ? sprintWork : [],
        generatedAt,
        lastSeenAt: entry.lastSeenAt,
        findingCount: entry.findings.length
      }))
    }),
    globalQueues: buildGlobalWorkQueuesView({
      generatedAt,
      projects: [
        {
          projectId: "boreal-work",
          projectName: "boreal-work",
          projectRoot: input.workspaceRoot,
          work: sprintWork
        }
      ]
    }),
    globalSearch: buildGlobalSearchView({
      generatedAt,
      query: "v1-remainder global dashboard registry",
      projects: [
        {
          projectId: "boreal-work",
          projectName: "boreal-work",
          projectRoot: input.workspaceRoot,
          results: sprintWork.slice(0, 4).map((item, index) => ({
            id: `work:${item.id}`,
            type: "work",
            recordId: item.id,
            title: item.title,
            summary: item.contextSummary ?? item.labels.join(", "),
            score: 100 - index
          }))
        }
      ]
    }),
    globalActivity: buildGlobalActivityView({
      generatedAt,
      projects: [
        {
          projectId: "boreal-work",
          projectName: "boreal-work",
          projectRoot: input.workspaceRoot,
          operations: fixtureActivityRows(generatedAt)
        }
      ]
    }),
    globalHealth: buildGlobalHealthView({
      generatedAt,
      projects: registryEntries.map((entry) => ({
        projectId: entry.id,
        projectName: entry.name,
        projectRoot: entry.projectRoot,
        memoryRoot: entry.memoryRoot,
        health: entry.health,
        stale: entry.stale,
        syncFreshness: entry.syncFreshness,
        syncOk: entry.id === registryEntry.id ? sync.ok : false,
        vaultOk: entry.id === registryEntry.id ? sync.vaultOk : false,
        ledgersOk: entry.id === registryEntry.id ? sync.ledgersOk : false,
        searchIndexOk: entry.id === registryEntry.id ? sync.searchIndexOk : false,
        gitOk: entry.id === registryEntry.id ? sync.gitOk : false,
        findings: entry.findings,
        locks: entry.id === registryEntry.id ? locks.locks : []
      }))
    }),
    globalSettings: buildGlobalSettingsView({
      generatedAt,
      projects: [
        {
          projectId: registryEntry.id,
          projectName: registryEntry.name,
          projectRoot: registryEntry.projectRoot,
          memoryRoot: registryEntry.memoryRoot,
          memoryLayout: registryEntry.memoryLayout,
          memoryGitMode: registryEntry.memoryGitMode,
          installRoot: input.workspaceRoot,
          source: "project-setup",
          health: registryEntry.health,
          stale: registryEntry.stale
        }
      ]
    }),
    work,
    sprint: buildSprintBoardView({
      sprint,
      work: sprintWork,
      generatedAt
    }),
    health,
    sync,
    locks,
    rawInbox: rawInboxView(generatedAt),
    wikiExplorer: wikiExplorerView(generatedAt, `${input.workspaceRoot}/memory`),
    memoryActions: createMemoryDashboardActions(generatedAt),
    reports: reportsView(generatedAt, stale),
    safeCommands: SAFE_CONSOLE_COMMANDS
  };
}

function sprint04FixtureWork(scenario: ConsoleFixtureScenario): readonly WorkItemView[] {
  if (scenario === "empty") {
    return [];
  }
  const reserved = scenario === "reservation";
  return [
    workItem({
      id: "bw_work_d09eca1501862185",
      kind: "milestone",
      status: "blocked",
      title: "Phase 04A - Console package, routes, and build tooling",
      activeBlockerIds: ["bw_work_534295e2daf65102", "bw_work_ac840c148254ac0c", "bw_work_f0b382330fdc900b"]
    }),
    workItem({
      id: "bw_work_534295e2daf65102",
      status: reserved ? "in_progress" : "ready",
      title: "S04T01 - Scaffold apps/console package and workspace scripts",
      directiveSummary: directiveSummary("bw_work_534295e2daf65102"),
      activeReservationId: reserved ? "bw_reservation_fixture" : undefined,
      activeReservation: reserved ? {
        id: "bw_reservation_fixture",
        agentId: "cybertron",
        reservedAt: "2026-06-27T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
        expired: false
      } : undefined
    }),
    workItem({
      id: "bw_work_ac840c148254ac0c",
      status: "ready",
      title: "S04T02 - Implement the dashboard shell, sidebar, topbar, and route layout"
    }),
    workItem({
      id: "bw_work_f0b382330fdc900b",
      status: "ready",
      title: "S04T03 - Add local fixture data for UI development"
    }),
    workItem({
      id: "bw_work_f67c298c1d23cdfc",
      kind: "milestone",
      status: "blocked",
      title: "Phase 04B - Live data adapter and project guardrails",
      activeBlockerIds: ["bw_work_923ad83e0bbaf046", "bw_work_8178f36940dd8cf9", "bw_work_d10a66f387b640ec"]
    }),
    workItem({
      id: "bw_work_923ad83e0bbaf046",
      status: "blocked",
      title: "S04T04 - Add live Boreal data adapter for dashboard view models",
      activeBlockerIds: ["bw_work_d09eca1501862185"]
    }),
    workItem({
      id: "bw_work_8178f36940dd8cf9",
      status: "blocked",
      title: "S04T05 - Add command execution boundary for safe dashboard actions",
      activeBlockerIds: ["bw_work_d09eca1501862185"]
    }),
    workItem({
      id: "bw_work_d10a66f387b640ec",
      status: "blocked",
      title: "S04T06 - Add console state refresh and stale-data handling",
      activeBlockerIds: ["bw_work_d09eca1501862185"]
    }),
    workItem({
      id: "bw_work_95ca197bf5b36d26",
      status: scenario === "verification" ? "needs_verification" : "blocked",
      title: "S04T08 - Add CLI-to-console contract tests",
      evidenceCount: scenario === "verification" ? 1 : 0,
      verificationCount: 0,
      activeBlockerIds: scenario === "verification" ? [] : ["bw_work_93c7fb7ee4b40b51"]
    }),
    workItem({
      id: "bw_work_93c7fb7ee4b40b51",
      kind: "milestone",
      status: "blocked",
      title: "Phase 04C - Console verification harness",
      activeBlockerIds: ["bw_work_731f19a7fbd53810", "bw_work_95ca197bf5b36d26", "bw_work_ba595f5b3a4ab92c"]
    })
  ];
}

export function workItem(input: Partial<WorkItemView> & Pick<WorkItemView, "id" | "title">): WorkItemView {
  const item = {
    kind: "task" as const,
    status: "ready" as const,
    priority: "high" as const,
    labels: ["sprint-04", "console", "client", "app-foundation"],
    dependencyIds: [],
    activeBlockerIds: [],
    blockedBy: input.activeBlockerIds ?? [],
    evidenceCount: 0,
    verificationCount: 0,
    ...input
  };
  return {
    ...item,
    requiredCloseoutGates: item.requiredCloseoutGates ?? []
  };
}

function directiveSummary(subjectId: string): WorkDirectiveSummaryView {
  const items: WorkDirectiveSummaryView["items"] = [
    {
      id: `directive.workflow_next.canonical-next-step.${subjectId}`,
      registryId: "workflow_next.canonical-next-step",
      family: "workflow_next",
      kind: "next_step",
      title: "Follow next canonical workflow",
      severity: "advisory",
      lane: "advisory",
      reason: "Follow the named canonical workflow and pass only typed inputs to the next command.",
      sourceCommand: `bwrk work show ${subjectId} --json`,
      nextCommand: `bwrk work show ${subjectId} --json`,
      workflowRef: "workflows/40-work/claim-and-finish-work.md",
      requiredInputs: ["work", "summary", "doctor"],
      relatedIds: [subjectId]
    },
    {
      id: `directive.closeout.required-summary.${subjectId}`,
      registryId: "closeout.required-summary",
      family: "closeout",
      kind: "final_response",
      title: "Prepare final user summary",
      severity: "required",
      lane: "required",
      reason: "Closed successful work must provide a user-facing summary in the agent response.",
      sourceCommand: `bwrk agent finish ${subjectId} --json`,
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "note",
        message: "The user-facing closeout summary must be prepared from verified data."
      },
      requiredInputs: ["summary", "evidence", "verification"],
      relatedIds: [subjectId, "bw_gate_fixture"]
    },
    {
      id: `directive.git.blocked-dirty-state.${subjectId}`,
      registryId: "git.blocked-dirty-state",
      family: "git",
      kind: "blocked",
      title: "Resolve blocking dirty state",
      severity: "blocking",
      lane: "blocking",
      reason: "The directive is blocked until related work has a clean checkpoint or dirty-path reason.",
      sourceCommand: "bwrk doctor --json",
      nextCommand: "bwrk doctor --json",
      recoveryWorkflow: "workflows/60-health/sync-and-doctor.md",
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "force_gate",
        evidenceKind: "command",
        message: "A dirty checkpoint must be resolved or explicitly explained before force-gating closeout."
      },
      requiredInputs: ["git", "doctor"],
      relatedIds: [subjectId, "bw_reservation_fixture", "bw_work_blocker_fixture"]
    },
    {
      id: `directive.context.info.${subjectId}`,
      registryId: "context.info",
      family: "context",
      kind: "reference",
      title: "Context pack available",
      severity: "advisory",
      lane: "advisory",
      reason: "A context pack is available for operator review.",
      sourceCommand: `bwrk summary show ${subjectId} --json`,
      requiredInputs: [],
      relatedIds: [subjectId, "bw_summary_fixture"]
    }
  ];
  const nextSteps = items.flatMap((item) => {
    const workflowRef = item.workflowRef ?? item.recoveryWorkflow;
    if (!item.nextCommand && !workflowRef) {
      return [];
    }
    return [{
      id: `next-step-${item.id}`,
      title: item.title,
      lane: item.lane,
      command: item.nextCommand,
      workflowRef,
      reason: item.reason,
      relatedIds: item.relatedIds
    }];
  });
  const conflicts: WorkDirectiveSummaryView["conflicts"] = [
    {
      id: `directive-conflict-${subjectId}`,
      directiveIds: [`directive.git.blocked-dirty-state.${subjectId}`, `directive.workflow_next.canonical-next-step.${subjectId}`],
      reason: "Blocking directive must be resolved before the next step can be acted on.",
      resolution: "blocking_wins",
      resolvedDirectiveId: `directive.git.blocked-dirty-state.${subjectId}`,
      severity: "blocking",
      lane: "blocking"
    }
  ];
  const missingRequired: WorkDirectiveSummaryView["missingRequired"] = [
    {
      id: `directive-missing-${subjectId}`,
      registryId: "closeout.summary-required",
      family: "closeout",
      requirement: "summary.latestSummaryId",
      message: "Summary data is required.",
      subjectId,
      subjectType: "work"
    }
  ];
  return {
    total: items.length,
    advisory: items.filter((item) => item.lane === "advisory").length,
    required: items.filter((item) => item.lane === "required").length,
    blocking: items.filter((item) => item.lane === "blocking").length,
    conflictCount: conflicts.length,
    missingRequiredCount: missingRequired.length,
    acknowledgementCount: items.filter((item) => item.acknowledgement).length,
    blockerIds: ["bw_work_blocker_fixture"],
    sourceCommands: Array.from(new Set(items.flatMap((item) => item.sourceCommand ? [item.sourceCommand] : []))),
    safeCommands: Array.from(new Set([
      ...items.flatMap((item) => item.sourceCommand ? [item.sourceCommand] : []),
      ...nextSteps.flatMap((step) => step.command ? [step.command] : [])
    ])),
    nextSteps,
    conflicts,
    missingRequired,
    items
  };
}

function rawInboxView(generatedAt: string): RawInboxView {
  const rows: readonly RawSourceRowView[] = [
    rawRow({
      id: "bw_source_fixture_thread",
      title: "thread-export.txt",
      kind: "chat",
      uri: "memory/raw/thread-export.txt",
      summary: "Runtime hardening notes captured from a source transcript.",
      processingStatus: "linked",
      linkedPageCount: 1
    }),
    rawRow({
      id: "bw_source_fixture_missing",
      title: "missing-asset.md",
      kind: "document",
      uri: "memory/raw/missing-asset.md",
      summary: "Fixture row for missing local preview handling.",
      processingStatus: "queued",
      linkedPageCount: 0
    })
  ];
  const selectedRow = rows[0] as RawSourceRowView;
  return {
    generatedAt,
    rows,
    selected: {
      ...selectedRow,
      linkedPages: [{ id: "bw_page_fixture", title: "Runtime Hardening Notes", path: "memory/wiki/runtime-hardening-notes.md" }],
      preview: {
        status: "available",
        mediaType: "text",
        message: "Text preview available.",
        uri: selectedRow.uri,
        path: "/workspace/boreal-work/memory/raw/thread-export.txt",
        body: "Decision: keep raw source rows immutable and route preview through read-only commands.",
        bytes: 82,
        totalBytes: 82,
        maxBytes: 4096,
        truncated: false
      }
    } satisfies RawSourceDetailView,
    ingestPlan: rawIngestPlan(generatedAt, selectedRow),
    contradictionReview: rawContradictionReview(generatedAt, selectedRow),
    summary: {
      total: rows.length,
      queued: rows.filter((row) => row.processingStatus === "queued").length,
      linked: rows.filter((row) => row.processingStatus === "linked").length,
      missingPreview: 0,
      unsupportedPreview: 0
    },
    warnings: []
  };
}

function wikiExplorerView(generatedAt: string, memoryRoot: string): WikiExplorerView {
  const accepted = wikiPageRow({
    id: "bw_page_fixture",
    slug: "runtime-hardening-notes",
    title: "Runtime Hardening Notes",
    truthStatus: "accepted",
    sourceCoverageStatus: "covered",
    sourceRefCount: 2,
    backlinkCount: 1,
    outboundLinkCount: 1,
    claimCount: 1,
    decisionCount: 1
  });
  const draft = wikiPageRow({
    id: "bw_page_draft",
    slug: "draft-reconcile-notes",
    title: "Draft Reconcile Notes",
    truthStatus: "draft",
    sourceCoverageStatus: "unbacked",
    sourceRefCount: 0,
    backlinkCount: 0,
    outboundLinkCount: 1,
    claimCount: 0,
    decisionCount: 0
  });
  return {
    generatedAt,
    rows: [accepted, draft],
    selected: {
      ...accepted,
      sourceRefs: ["bw_source_fixture_thread", "bw_source_runtime"],
      outboundLinks: ["Draft Reconcile Notes"],
      backlinks: [{
        id: "bw_page_index",
        slug: "project-index",
        title: "Project Index",
        path: "memory/wiki/project-index.md",
        truthStatus: "accepted"
      }],
      outboundPages: [{
        id: "bw_page_draft",
        slug: "draft-reconcile-notes",
        title: "Draft Reconcile Notes",
        path: "memory/wiki/draft-reconcile-notes.md",
        truthStatus: "draft"
      }],
      missingOutboundLinks: [],
      sourceCoverage: {
        status: "covered",
        sourceRefs: ["bw_source_fixture_thread", "bw_source_runtime"],
        coveredRefs: ["bw_source_fixture_thread", "bw_source_runtime"],
        missingRefs: [],
        rawSources: [rawRow({
          id: "bw_source_fixture_thread",
          title: "thread-export.txt",
          kind: "chat",
          uri: "memory/raw/thread-export.txt",
          summary: "Runtime hardening notes captured from a source transcript.",
          processingStatus: "linked",
          linkedPageCount: 1
        })],
        runtimeSources: [{
          id: "bw_source_runtime",
          kind: "raw",
          title: "thread-export.txt",
          uri: "memory/raw/thread-export.txt"
        }]
      },
      claims: [{
        id: "bw_claim_fixture",
        status: "accepted",
        statement: "Runtime raw source rows stay immutable.",
        sourceIds: ["bw_source_runtime"],
        evidenceIds: ["bw_evidence_fixture"],
        evidenceCount: 1,
        reviewState: "accepted",
        updatedAt: generatedAt
      }],
      decisions: [{
        id: "bw_decision_fixture",
        status: "accepted",
        title: "Keep raw preview read-only",
        context: "Raw inbox previews are reviewer aids.",
        decision: "Raw preview commands must not mutate project state.",
        consequences: ["Preview panels can be refreshed safely."],
        sourceIds: ["bw_source_runtime"],
        reviewState: "accepted",
        updatedAt: generatedAt
      }]
    },
    importantPages: [accepted, draft],
    claims: [
      {
        id: "bw_claim_fixture",
        status: "accepted",
        statement: "Runtime raw source rows stay immutable.",
        sourceIds: ["bw_source_runtime"],
        evidenceIds: ["bw_evidence_fixture"],
        evidenceCount: 1,
        reviewState: "accepted",
        updatedAt: generatedAt
      },
      {
        id: "bw_claim_proposed",
        status: "proposed",
        statement: "Draft reconcile notes need review before promotion.",
        sourceIds: ["bw_source_fixture_thread"],
        evidenceIds: [],
        evidenceCount: 0,
        reviewState: "needs_review",
        updatedAt: generatedAt
      },
      {
        id: "bw_claim_stale",
        status: "stale",
        statement: "Old dashboard assumptions require refresh.",
        sourceIds: ["bw_source_fixture_thread"],
        evidenceIds: ["bw_evidence_old"],
        evidenceCount: 1,
        reviewState: "needs_refresh",
        updatedAt: generatedAt
      },
      {
        id: "bw_claim_rejected",
        status: "rejected",
        statement: "Rejected duplicate claim fixture.",
        sourceIds: ["bw_source_runtime"],
        evidenceIds: [],
        evidenceCount: 0,
        reviewState: "rejected",
        updatedAt: generatedAt
      }
    ],
    decisionTimeline: [
      {
        id: "bw_decision_fixture",
        status: "accepted",
        title: "Keep raw preview read-only",
        context: "Raw inbox previews are reviewer aids.",
        decision: "Raw preview commands must not mutate project state.",
        consequences: ["Preview panels can be refreshed safely."],
        sourceIds: ["bw_source_runtime"],
        reviewState: "accepted",
        updatedAt: generatedAt
      },
      {
        id: "bw_decision_proposed",
        status: "proposed",
        title: "Promote reconciled source",
        context: "Raw source has an ingest plan.",
        decision: "Reviewer must decide whether to promote it.",
        consequences: ["Proposed state remains separate from accepted truth."],
        sourceIds: ["bw_source_fixture_thread"],
        reviewState: "needs_review",
        updatedAt: generatedAt
      },
      {
        id: "bw_decision_superseded",
        status: "superseded",
        title: "Old wiki organization",
        context: "Prior wiki structure was replaced.",
        decision: "Superseded by source-backed wiki explorer.",
        consequences: ["Historical decision remains visible."],
        sourceIds: ["bw_source_runtime"],
        reviewState: "superseded",
        supersessionStatus: "superseded",
        updatedAt: generatedAt
      },
      {
        id: "bw_decision_rejected",
        status: "rejected",
        title: "Reject duplicate page",
        context: "Duplicate page was reviewed.",
        decision: "Do not promote duplicate coverage.",
        consequences: [],
        sourceIds: ["bw_source_runtime"],
        reviewState: "rejected",
        updatedAt: generatedAt
      }
    ],
    filters: {
      claimStatuses: ["accepted", "proposed", "rejected", "stale"],
      decisionStatuses: ["accepted", "proposed", "rejected", "superseded"],
      sourceIds: ["bw_source_fixture_thread", "bw_source_orphan", "bw_source_runtime"]
    },
    healthFindings: [
      {
        id: "vault.health.stale_assertion:bw_claim_stale",
        code: "vault.health.stale_assertion",
        doctorCode: "vault.health",
        severity: "warning",
        title: "Stale claim",
        detail: "Claim bw_claim_stale is stale: Old dashboard assumptions require refresh.",
        targetKind: "claim",
        targetId: "bw_claim_stale",
        href: "/knowledge?claimStatus=stale&source=bw_source_fixture_thread",
        command: "bwrk claim show bw_claim_stale --json"
      },
      {
        id: "vault.health.orphan_source:bw_source_orphan",
        code: "vault.health.orphan_source",
        doctorCode: "vault.health",
        severity: "warning",
        title: "Orphan source",
        detail: "orphan-source.md is not referenced by wiki pages, claims, or decisions.",
        targetKind: "source",
        targetId: "bw_source_orphan",
        href: "/knowledge?source=bw_source_orphan",
        command: "bwrk source show bw_source_orphan --json"
      },
      {
        id: "vault.health.missing_page_coverage:bw_page_draft",
        code: "vault.health.missing_page_coverage",
        doctorCode: "vault.health",
        severity: "warning",
        title: "Missing page coverage",
        detail: "Draft Reconcile Notes has unbacked source coverage.",
        targetKind: "page",
        targetId: "bw_page_draft",
        href: "/knowledge?page=bw_page_draft",
        command: "bwrk wiki show bw_page_draft --json"
      }
    ],
    obsidian: obsidianCompatibilityView(generatedAt, memoryRoot, [accepted, draft]),
    summary: {
      total: 2,
      accepted: 1,
      draft: 1,
      proposed: 0,
      stale: 0,
      unbacked: 1,
      missingSources: 0
    },
    reviewSummary: {
      claims: 4,
      acceptedClaims: 1,
      proposedClaims: 1,
      rejectedClaims: 1,
      staleClaims: 1,
      decisions: 4,
      acceptedDecisions: 1,
      proposedDecisions: 1,
      rejectedDecisions: 1,
      supersededDecisions: 1
    },
    healthSummary: {
      findings: 3,
      warnings: 3,
      dangers: 0,
      staleClaims: 1,
      orphanSources: 1,
      missingPageCoverage: 1
    },
    warnings: []
  };
}

function wikiPageRow(input: Omit<WikiPageRowView, "path" | "claimStatus" | "showCommand"> & { readonly claimStatus?: string }): WikiPageRowView {
  return {
    ...input,
    path: `memory/wiki/${input.slug}.md`,
    claimStatus: input.claimStatus,
    showCommand: `bwrk wiki show ${input.id} --json`
  };
}

function obsidianCompatibilityView(
  generatedAt: string,
  memoryRoot: string,
  pages: readonly WikiPageRowView[]
): WikiExplorerView["obsidian"] {
  return {
    generatedAt,
    memoryRoot,
    vaultName: "memory",
    obsidianUriAvailable: true,
    pages: pages.map((page) => ({
      id: page.id,
      title: page.title,
      path: page.path,
      href: `/knowledge?page=${page.id}`,
      obsidianUri: `obsidian://open?vault=memory&file=${encodeURIComponent(`wiki/${page.slug}.md`)}`,
      frontmatterStatus: page.truthStatus === "accepted" ? "complete" : "partial",
      frontmatterKeys: page.truthStatus === "accepted"
        ? ["id", "slug", "title", "claim_status", "source_refs"]
        : ["id", "slug", "title"],
      linkHealthStatus: page.sourceCoverageStatus === "covered" ? "ok" : "warning",
      linkHealthDetail: page.sourceCoverageStatus === "covered"
        ? "Wiki links, source coverage, and dashboard navigation are healthy."
        : `Source coverage is ${page.sourceCoverageStatus}`,
      sourceCoverageStatus: page.sourceCoverageStatus,
      showCommand: page.showCommand
    })),
    dashboardLinks: [
      {
        id: "vault-index",
        title: "Vault index",
        kind: "dashboard",
        path: "memory/index.md",
        href: "/repo",
        obsidianUri: "obsidian://open?vault=memory&file=index.md",
        status: "ok",
        detail: "Local dashboard link remains available without Obsidian."
      },
      {
        id: "wiki-index",
        title: "Wiki index",
        kind: "wiki",
        path: "memory/wiki/index.md",
        href: "/knowledge",
        obsidianUri: "obsidian://open?vault=memory&file=wiki%2Findex.md",
        status: "ok",
        detail: "Local dashboard link remains available without Obsidian."
      }
    ],
    invalidPathFindings: [],
    summary: {
      pages: pages.length,
      obsidianUris: pages.length + 2,
      frontmatterComplete: pages.filter((page) => page.truthStatus === "accepted").length,
      frontmatterPartial: pages.filter((page) => page.truthStatus !== "accepted").length,
      frontmatterMissing: 0,
      linkWarnings: pages.filter((page) => page.sourceCoverageStatus !== "covered").length,
      invalidPaths: 0
    },
    warnings: []
  };
}

function reportsView(generatedAt: string, stale: boolean): ReportsView {
  const knowledgeMarkdown = [
    "# Knowledge Dashboard Static Report",
    "",
    `Generated: ${generatedAt}`,
    `State: ${stale ? "stale" : "fresh"}`,
    "",
    "## Summary",
    "",
    "- Raw sources: 2",
    "- Wiki pages: 2",
    "- Claims: 4",
    "- Decisions: 4",
    "- Health findings: 3",
    "",
    "## Reproduce",
    "",
    "- pnpm console:render -- --route /knowledge --mode live --out .boreal/results/console-knowledge.html",
    "- pnpm bwrk export markdown --out .boreal/results/markdown-export --json"
  ].join("\n");
  return {
    generatedAt,
    artifacts: [
      {
        id: "report-console-knowledge",
        title: "console-knowledge.html",
        path: ".boreal/results/console-knowledge.html",
        kind: "html",
        bytes: 24000,
        updatedAt: "2026-06-27T00:00:00.000Z",
        stale: true,
        preview: "<!doctype html><html><body>Boreal Console Knowledge</body></html>",
        openCommand: "open .boreal/results/console-knowledge.html"
      },
      {
        id: "report-knowledge-static",
        title: "knowledge-report.md",
        path: ".boreal/results/knowledge-report.md",
        kind: "markdown",
        bytes: knowledgeMarkdown.length,
        updatedAt: generatedAt,
        stale: false,
        preview: knowledgeMarkdown,
        openCommand: "open .boreal/results/knowledge-report.md"
      }
    ],
    staticExports: [
      {
        id: "console-project",
        title: "Project dashboard HTML",
        route: "/",
        outFile: ".boreal/results/console-project.html",
        format: "html",
        command: "pnpm console:render -- --route / --mode live --out .boreal/results/console-project.html",
        stale,
        summary: "Static read-only project dashboard export generated from current runtime state."
      },
      {
        id: "console-knowledge",
        title: "Knowledge dashboard HTML",
        route: "/knowledge",
        outFile: ".boreal/results/console-knowledge.html",
        format: "html",
        command: "pnpm console:render -- --route /knowledge --mode live --out .boreal/results/console-knowledge.html",
        stale,
        summary: "Static read-only knowledge dashboard export with raw inbox, wiki, claims, decisions, and health findings."
      },
      {
        id: "knowledge-markdown",
        title: "Knowledge report Markdown",
        route: "/reports",
        outFile: ".boreal/results/knowledge-report.md",
        format: "markdown",
        command: "pnpm bwrk export markdown --out .boreal/results/markdown-export --json",
        stale,
        summary: "Markdown export command for reproducible project and knowledge records."
      }
    ],
    knowledgeReport: {
      title: "Knowledge Dashboard Static Report",
      generatedAt,
      stale,
      markdown: knowledgeMarkdown,
      commands: [
        "pnpm console:render -- --route /knowledge --mode live --out .boreal/results/console-knowledge.html",
        "pnpm bwrk export markdown --out .boreal/results/markdown-export --json"
      ],
      summary: {
        rawSources: 2,
        wikiPages: 2,
        claims: 4,
        decisions: 4,
        healthFindings: 3
      }
    },
    summary: {
      artifactCount: 2,
      staleArtifacts: 1,
      staticExportCount: 3,
      markdownArtifacts: 1,
      htmlArtifacts: 1
    },
    warnings: stale ? ["Static report fixture is marked stale because workspace state is stale."] : []
  };
}

function rawContradictionReview(generatedAt: string, row: RawSourceRowView): RawContradictionReviewView {
  const conflict = {
    id: `${row.id}:claim-conflict`,
    severity: "medium" as const,
    title: "Potential duplicate wiki coverage",
    currentAssertion: "Runtime hardening notes are already represented by an existing wiki page.",
    incomingAssertion: "The selected raw source proposes another wiki and claim path for the same subject.",
    sourceRefs: [row.id, "<source-id-from-source-add>"],
    evidenceLinks: [
      { label: "Raw vault source", ref: row.id, command: row.retrievalCommand },
      { label: "Runtime source placeholder", ref: "<source-id-from-source-add>" }
    ],
    resolutionCommands: [
      {
        action: "accept" as const,
        label: "Accept incoming assertion",
        command: memoryWorkflowShowCommand("20-memory/contradiction-resolution.md"),
        auditTrail: "Routes accepted assertion review through the contradiction workflow."
      },
      {
        action: "reject" as const,
        label: "Reject incoming assertion",
        command: memoryWorkflowShowCommand("20-memory/contradiction-resolution.md"),
        auditTrail: "Routes rejected assertion review through the contradiction workflow."
      },
      {
        action: "supersede" as const,
        label: "Supersede with decision",
        command: memoryWorkflowShowCommand("20-memory/contradiction-resolution.md"),
        auditTrail: "Routes supersession review through the contradiction workflow."
      }
    ]
  };
  return {
    generatedAt,
    sourceId: row.id,
    conflicts: [conflict],
    summary: { total: 1, high: 0, medium: 1, low: 0 }
  };
}

function rawIngestPlan(generatedAt: string, row: RawSourceRowView): RawIngestPlanView {
  const runtimeSourcePlaceholder = "<source-id-from-source-add>";
  return {
    sourceId: row.id,
    sourceTitle: row.title,
    generatedAt,
    mutations: [
      {
        id: `${row.id}:source`,
        kind: "source",
        title: "Create runtime knowledge source",
        summary: "Mirror the immutable raw vault source into runtime knowledge so claims and decisions can carry source refs.",
        status: "planned",
        command: memoryWorkflowShowCommand("20-memory/add-raw-source.md"),
        workflowPath: "20-memory/add-raw-source.md",
        workflowCommand: memoryWorkflowShowCommand("20-memory/add-raw-source.md"),
        skillRef: "$boreal-raw-inbox",
        sourceRefs: [row.id],
        additions: ["runtime knowledge source", row.uri ?? row.id],
        contradictions: []
      },
      {
        id: `${row.id}:wiki`,
        kind: "wiki",
        title: "Create source-backed wiki page",
        summary: "Draft a wiki entry linked directly to the raw source.",
        status: "planned",
        command: memoryWorkflowShowCommand("30-knowledge/create-wiki-page.md"),
        workflowPath: "30-knowledge/create-wiki-page.md",
        workflowCommand: memoryWorkflowShowCommand("30-knowledge/create-wiki-page.md"),
        skillRef: "$boreal-wiki-claim-decision",
        sourceRefs: [row.id],
        additions: ["wiki page", "source_refs entry"],
        contradictions: ["Source is already linked to 1 wiki page; review for duplicate coverage."]
      },
      {
        id: `${row.id}:claim`,
        kind: "claim",
        title: "Create proposed claim",
        summary: "Capture the source summary as a proposed claim after runtime source creation.",
        status: "needs_input",
        command: memoryWorkflowShowCommand("30-knowledge/create-claim.md"),
        workflowPath: "30-knowledge/create-claim.md",
        workflowCommand: memoryWorkflowShowCommand("30-knowledge/create-claim.md"),
        skillRef: "$boreal-wiki-claim-decision",
        sourceRefs: [row.id, runtimeSourcePlaceholder],
        additions: ["proposed claim"],
        contradictions: ["Claim statement requires human wording before apply."]
      },
      {
        id: `${row.id}:decision`,
        kind: "decision",
        title: "Capture reviewed decision",
        summary: "Record any decision discovered during reconciliation.",
        status: "needs_input",
        command: memoryWorkflowShowCommand("30-knowledge/capture-decision.md"),
        workflowPath: "30-knowledge/capture-decision.md",
        workflowCommand: memoryWorkflowShowCommand("30-knowledge/capture-decision.md"),
        skillRef: "$boreal-wiki-claim-decision",
        sourceRefs: [row.id, runtimeSourcePlaceholder],
        additions: ["proposed decision"],
        contradictions: ["Decision text requires human review before apply."]
      },
      {
        id: `${row.id}:work`,
        kind: "work",
        title: "Create follow-up work",
        summary: "Promote unresolved source questions into tracked work.",
        status: "planned",
        command: memoryWorkflowShowCommand("40-work/discovery-to-work.md"),
        workflowPath: "40-work/discovery-to-work.md",
        workflowCommand: memoryWorkflowShowCommand("40-work/discovery-to-work.md"),
        skillRef: "$boreal-work-planning",
        sourceRefs: [`raw:${row.id}`],
        additions: ["ready work item"],
        contradictions: []
      }
    ],
    findings: [
      {
        id: `${row.id}:linked`,
        severity: "warning",
        title: "Existing wiki link",
        detail: "This raw source already has linked wiki coverage; review before creating another page.",
        sourceRefs: [row.id]
      }
    ],
    sourceLinks: [
      { label: "Raw vault source", ref: row.id, command: row.retrievalCommand },
      { label: "Runtime source placeholder", ref: runtimeSourcePlaceholder }
    ],
    applyCommands: [
      memoryWorkflowShowCommand("20-memory/add-raw-source.md"),
      memoryWorkflowShowCommand("30-knowledge/create-wiki-page.md"),
      memoryWorkflowShowCommand("40-work/discovery-to-work.md")
    ]
  };
}

function rawRow(input: {
  readonly id: string;
  readonly title: string;
  readonly kind: string;
  readonly uri?: string;
  readonly summary?: string;
  readonly processingStatus: "queued" | "linked";
  readonly linkedPageCount: number;
}): RawSourceRowView {
  return {
    id: input.id,
    title: input.title,
    kind: input.kind,
    uri: input.uri,
    summary: input.summary,
    tags: ["raw-inbox"],
    addedAt: "2026-06-27T00:00:00.000Z",
    actorId: "cybertron",
    contentHash: "sha256:fixture",
    sourceBacked: true,
    immutable: true,
    processingStatus: input.processingStatus,
    linkedPageCount: input.linkedPageCount,
    retrievalCommand: `bwrk raw show ${input.id} --json`,
    previewCommand: `bwrk raw show ${input.id} --preview-bytes 4096 --json`
  };
}

function syncView(input: { readonly workspaceRoot: string; readonly generatedAt: string; readonly ok: boolean }): SyncDashboardView {
  return {
    generatedAt: input.generatedAt,
    ok: input.ok,
    workspaceRoot: input.workspaceRoot,
    vaultOk: true,
    ledgersOk: input.ok,
    searchIndexOk: true,
    gitOk: true,
    recommendedActions: [{ label: "Refresh projections", command: "bwrk sync refresh --json" }],
    findings: []
  };
}

function fixtureHealthFindings(scenario: ConsoleFixtureScenario, workspaceRoot: string): readonly DashboardFinding[] {
  if (scenario !== "stale") {
    return [];
  }
  return [
    {
      code: "ledger.export_drift",
      title: "ledger.export_drift",
      severity: "warning",
      status: "warning",
      message: "JSONL ledger export is stale in this fixture.",
      source: `${workspaceRoot}/.boreal/ledgers`,
      actions: [{ label: "Refresh projections", command: "bwrk sync refresh --json" }]
    },
    {
      code: "search.index",
      title: "search.index",
      severity: "warning",
      status: "warning",
      message: "Search index is stale in this fixture.",
      source: `${workspaceRoot}/.boreal/search/index.json`,
      actions: [{ label: "Refresh search", command: "bwrk sync refresh --json" }]
    }
  ];
}

function fixtureActivityRows(generatedAt: string) {
  return [
    operationRow({
      id: "bw_operation_human",
      commandPath: "work list",
      actorId: "cybertron",
      actorKind: "human",
      startedAt: generatedAt,
      finishedAt: generatedAt
    }),
    operationRow({
      id: "bw_operation_agent",
      commandPath: "agent start",
      actorId: "codex",
      actorKind: "agent",
      stateChanged: true,
      generatedArtifactsChanged: true,
      startedAt: generatedAt,
      finishedAt: generatedAt,
      eventCount: 2
    }),
    operationRow({
      id: "bw_operation_system",
      commandPath: "sync refresh",
      actorId: "system",
      actorKind: "system",
      generatedArtifactsChanged: true,
      startedAt: generatedAt,
      finishedAt: generatedAt,
      eventCount: 1
    })
  ];
}

function operationRow(input: {
  readonly id: string;
  readonly commandPath: string;
  readonly actorId: string;
  readonly actorKind: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly stateChanged?: boolean;
  readonly generatedArtifactsChanged?: boolean;
  readonly eventCount?: number;
}) {
  return {
    id: input.id,
    sessionId: "local",
    commandPath: input.commandPath,
    status: "succeeded",
    exitCode: 0,
    stateChanged: input.stateChanged ?? false,
    generatedArtifactsChanged: input.generatedArtifactsChanged ?? false,
    actorId: input.actorId,
    actorKind: input.actorKind,
    startedAt: input.startedAt,
    finishedAt: input.finishedAt,
    eventCount: input.eventCount ?? 0
  };
}

function lockView(input: { readonly workspaceRoot: string; readonly generatedAt: string }): LockDashboardView {
  return {
    generatedAt: input.generatedAt,
    ok: true,
    workspaceRoot: input.workspaceRoot,
    locks: []
  };
}
