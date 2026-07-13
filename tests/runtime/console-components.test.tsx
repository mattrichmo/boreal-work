import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  ActorActivityPanel,
  Button,
  BucketOverviewGrid,
  ClaimsTablePanel,
  DashboardHealthPanel,
  DirectiveSummaryPanel,
  EntityDetailHeader,
  GlobalBoard,
  GlobalDriftPanel,
  GlobalHealthSummaryPanel,
  GlobalOverviewMetrics,
  GlobalSearchPanel,
  GlobalSettingsPanel,
  GlobalWorkQueues,
  KnowledgeDecisionTimelinePanel,
  KnowledgeHealthPanel,
  MemoryWorkflowActionsPanel,
  ObsidianCompatibilityPanel,
  RawAssetPreviewPanel,
  RawContradictionReviewPanel,
  RawDiffReviewPanel,
  RawInboxPanel,
  RawIngestPlanPanel,
  ReportsBrowserPanel,
  StaticExportsPanel,
  StaticKnowledgeReportPanel,
  VaultDashboardLinksPanel,
  WikiClaimsPanel,
  WikiExplorerPanel,
  WikiPageDetailPanel,
  WikiSourceCoveragePanel,
  SprintBoardProgressView,
  SprintBoardTable,
  SprintDependencyView,
  SprintDashboardActions,
  SprintHeader,
  SprintKanbanBoard,
  SprintReviewQueues,
  SprintScopeSummary,
  SprintTimelineView,
  ViewModeTabs,
  WorkItemDetailPage,
  type ReferenceItem
} from "@boreal/console";
import type {
  DashboardHealthView,
  GlobalActivityView,
  GlobalBoardView,
  GlobalHealthView,
  GlobalSearchView,
  GlobalSettingsView,
  GlobalWorkQueuesView,
  ProjectRegistryView,
  SprintBoardView,
  WorkDirectiveSummaryView,
  WorkItemView
} from "@boreal/ui-model";
import type { RawInboxView, ReportsView, WikiExplorerView } from "@boreal/console";
import { createMemoryDashboardActions } from "@boreal/console";

describe("console component exports", () => {
  it("renders foundation primitives with stable classes", () => {
    const html = renderToStaticMarkup(<Button variant="primary">Claim</Button>);

    expect(html).toContain("bw-button");
    expect(html).toContain("Claim");
  });

  it("renders entity primitives from typed data", () => {
    const refs: readonly ReferenceItem[] = [{ id: "src-1", kind: "raw", label: "thread.txt", status: "ok" }];
    const directiveWork = workItem({
      id: "bw_work_1",
      title: "Evidence gate",
      directiveSummary: directiveSummaryFixture("bw_work_1"),
      requiredCloseoutGates: [{
        id: "bw_gate_trustfixture" as WorkItemView["requiredCloseoutGates"][number]["id"],
        subjectId: "bw_work_1" as WorkItemView["requiredCloseoutGates"][number]["subjectId"],
        subjectType: "work",
        kind: "verification",
        scope: "self",
        status: "open",
        requiredEvidenceKinds: ["test"],
        requiredOutcome: "passed",
        minEvidenceCount: 1,
        requiredTrustLevels: ["boreal_witnessed", "external_attested"],
        requireCurrentRevision: true,
        requireCurrentGitHead: true
      }]
    });
    const html = renderToStaticMarkup(
      <>
        <EntityDetailHeader title="Evidence gate" kind="work" status="ready" labels={["sprint-03"]} />
        <WorkItemDetailPage work={directiveWork} />
        <DirectiveSummaryPanel work={directiveWork} />
        <span>{refs[0]?.label}</span>
      </>
    );

    expect(html).toContain("bw-entity-header");
    expect(html).toContain("Evidence gate");
    expect(html).toContain("thread.txt");
    expect(html).toContain("Agent directives");
    expect(html).toContain("workflow_next.canonical-next-step");
    expect(html).toContain("directive.workflow_next.fixture");
    expect(html).toContain("bwrk sync refresh --json");
    expect(html).toContain("bw_work_1");
    expect(html).toContain("Directive conflicts");
    expect(html).toContain("Missing required directive data");
    expect(html).toContain("Safe next workflow commands");
    expect(html).toContain("Directive acknowledgements");
    expect(html).toContain("acknowledgement before close");
    expect(html).toContain("The user-facing closeout summary must be prepared from verified data.");
    expect(html).toContain("trust boreal_witnessed, external_attested");
    expect(html).toContain("revision current");
    expect(html).toContain("Git current checkpoint");
    expect(html).toContain("closeout.summary-required");
    expect(html).toContain("workflows/40-work/claim-and-finish-work.md");
  });

  it("covers directive populated, empty, warning, blocked, conflict, and acknowledgement states", () => {
    const populated = workItem({
      id: "bw_work_directive_states",
      title: "Directive states",
      directiveSummary: directiveSummaryFixture("bw_work_directive_states")
    });
    const empty = workItem({ id: "bw_work_empty_directives", title: "No directives" });
    const populatedHtml = renderToStaticMarkup(<DirectiveSummaryPanel work={populated} />);
    const emptyHtml = renderToStaticMarkup(<DirectiveSummaryPanel work={empty} />);

    expect(populatedHtml).toContain("Agent directives");
    expect(populatedHtml).toContain("required directives");
    expect(populatedHtml).toContain("blocking directives");
    expect(populatedHtml).toContain("Directive conflicts");
    expect(populatedHtml).toContain("Missing required directive data");
    expect(populatedHtml).toContain("Directive acknowledgements");
    expect(populatedHtml).toContain("before force_gate");
    expect(emptyHtml).toContain("No directive bundle data is available");
  });

  it("renders sprint, global, and operations dashboard primitives", () => {
    const board = sprintBoardView();
    const registry = registryView();
    const globalBoard = globalBoardView();
    const queues = globalQueuesView();
    const search = globalSearchView();
    const activity = globalActivityView();
    const globalHealth = globalHealthView();
    const globalSettings = globalSettingsView();
    const health = healthView();
    const html = renderToStaticMarkup(
      <>
        <SprintHeader view={board} />
        <SprintScopeSummary view={board} />
        <SprintHeader />
        <SprintScopeSummary />
        <SprintHeader view={closedSprintBoardView()} />
        <ViewModeTabs active="dependency" routePath="/sprint?view=dependency&label=runtime" />
        <SprintReviewQueues view={board} routePath="/sprint?view=kanban&label=runtime" />
        <SprintDashboardActions view={board} routePath="/sprint?view=kanban&label=runtime" />
        <SprintKanbanBoard view={board} />
        <SprintBoardTable view={board} />
        <SprintDependencyView view={board} />
        <SprintTimelineView view={board} />
        <SprintBoardProgressView view={board} />
        <GlobalOverviewMetrics view={registry} />
        <GlobalBoard view={globalBoard} routePath="/?mode=live" />
        <BucketOverviewGrid view={registry} />
        <GlobalWorkQueues view={queues} />
        <GlobalSearchPanel view={search} />
        <GlobalHealthSummaryPanel view={globalHealth} />
        <GlobalDriftPanel view={globalHealth} />
        <GlobalSettingsPanel view={globalSettings} />
        <ActorActivityPanel view={activity} />
        <DashboardHealthPanel view={health} />
        <RawInboxPanel view={rawInboxView()} />
        <RawAssetPreviewPanel source={rawInboxView().selected} />
        <RawIngestPlanPanel plan={rawInboxView().ingestPlan} />
        <RawDiffReviewPanel plan={rawInboxView().ingestPlan} />
        <RawContradictionReviewPanel review={rawInboxView().contradictionReview} />
        <ReportsBrowserPanel view={reportsView()} />
        <StaticExportsPanel view={reportsView()} />
        <StaticKnowledgeReportPanel view={reportsView()} />
        <MemoryWorkflowActionsPanel view={createMemoryDashboardActions("2026-06-27T00:00:00.000Z")} />
        <WikiExplorerPanel view={wikiExplorerView()} />
        <WikiPageDetailPanel page={wikiExplorerView().selected} />
        <WikiSourceCoveragePanel page={wikiExplorerView().selected} />
        <WikiClaimsPanel page={wikiExplorerView().selected} />
        <KnowledgeHealthPanel view={wikiExplorerView()} />
        <ObsidianCompatibilityPanel view={wikiExplorerView()} />
        <VaultDashboardLinksPanel view={wikiExplorerView()} />
        <ClaimsTablePanel view={wikiExplorerView()} />
        <KnowledgeDecisionTimelinePanel view={wikiExplorerView()} statusFilter="accepted" sourceFilter="bw_source_runtime" />
      </>
    );

    expect(html).toContain("bw-kanban");
    expect(html).toContain("bw-sprint-header");
    expect(html).toContain("Scope summary");
    expect(html).toContain("Phase progress");
    expect(html).toContain("Active agents");
    expect(html).toContain("No active sprint");
    expect(html).toContain("Closed sprint");
    expect(html).toContain("Projects");
    expect(html).toContain("bw-kanban-card--ready");
    expect(html).toContain("bw-kanban-card--blocked");
    expect(html).toContain("bw-kanban-card--in_progress");
    expect(html).toContain("bw-kanban-card--needs_verification");
    expect(html).toContain("bw-kanban-card--closed");
    expect(html).toContain("reserved");
    expect(html).toContain("cybertron");
    expect(html).toContain("advisory directives");
    expect(html).toContain("required directives");
    expect(html).toContain("blocking directives");
    expect(html).toContain("directive conflicts");
    expect(html).toContain("missing required");
    expect(html).toContain("next steps");
    expect(html).toContain("Sprint review");
    expect(html).toContain("Verification queue");
    expect(html).toContain("Promote discovery");
    expect(html).toContain("/api/commands/work.create");
    expect(html).toContain("sourceRef");
    expect(html).toContain("Sprint actions");
    expect(html).toContain("/api/commands/work.reserve");
    expect(html).toContain("/api/commands/work.release");
    expect(html).toContain("/api/commands/work.renew");
    expect(html).toContain("/api/commands/work.verify");
    expect(html).toContain("/api/commands/work.close");
    expect(html).toContain("/api/commands/sync.refresh");
    expect(html).toContain("returnTo");
    expect(html).toContain("component-import");
    expect(html).toContain("Dense sprint table");
    expect(html).toContain("Dependency diagnostics");
    expect(html).toContain("Dependency cycle");
    expect(html).toContain("stale blocker refs");
    expect(html).toContain("Timeline review");
    expect(html).toContain("Sprint progress");
    expect(html).toContain("href=\"/sprint?view=table&amp;label=runtime\"");
    expect(html).toContain("Project buckets");
    expect(html).toContain("Global board");
    expect(html).toContain("data-bw-board-refusal");
    expect(html).toContain("data-bw-drop-column=\"blocked\"");
    expect(html).toContain("data-bw-droppable=\"false\"");
    expect(html).toContain("data-bw-drop-column=\"in_progress\"");
    expect(html).toContain("data-bw-droppable=\"true\"");
    expect(html).toContain("draggable=\"true\"");
    expect(html).toContain("/api/commands/work.reserve");
    expect(html).toContain("/api/commands/work.release");
    expect(html).toContain("/api/commands/work.close");
    expect(html).toContain("projectRoot");
    expect(html).toContain("/repo/b");
    expect(html).toContain("/repo?project=project-b");
    expect(html).toContain("Global queues");
    expect(html).toContain("Claim command");
    expect(html).toContain("--workspace /repo/b");
    expect(html).toContain("Global search");
    expect(html).toContain("context_pack");
    expect(html).toContain("Global health");
    expect(html).toContain("Drift findings");
    expect(html).toContain("bwrk --workspace /repo/b sync refresh --json");
    expect(html).toContain("/repo/b/.boreal/ledgers");
    expect(html).toContain("confirm");
    expect(html).toContain("Project settings");
    expect(html).toContain("Validate and apply setup");
    expect(html).toContain("shared");
    expect(html).toContain("bwrk --workspace /repo/b doctor --json");
    expect(html).toContain("Actor activity");
    expect(html).toContain("agent");
    expect(html).toContain("Doctor");
    expect(html).toContain("Raw inbox");
    expect(html).toContain("source-backed");
    expect(html).toContain("Preview truncated");
    expect(html).toContain("bwrk raw show bw_source_thread --json");
    expect(html).toContain("Ingest plan");
    expect(html).toContain("Diff review");
    expect(html).toContain("Open workflow");
    expect(html).toContain("bwrk workflows show 30-knowledge/create-wiki-page.md --json");
    expect(html).toContain("$boreal-wiki-claim-decision");
    expect(html).toContain("Review flags");
    expect(html).toContain("Contradictions");
    expect(html).toContain("Accept incoming assertion");
    expect(html).toContain("bwrk workflows show 20-memory/contradiction-resolution.md --json");
    expect(html).toContain("superseded");
    expect(html).toContain("Reports browser");
    expect(html).toContain("Static exports");
    expect(html).toContain("Knowledge Dashboard Static Report");
    expect(html).toContain("pnpm console:render -- --route /knowledge");
    expect(html).toContain("Memory workflow actions");
    expect(html).toContain("$boreal-memory-reconcile");
    expect(html).toContain("bwrk workflows show 20-memory/reconcile-raw-to-memory.md --json");
    expect(html).toContain("Wiki explorer");
    expect(html).toContain("Runtime Hardening Notes");
    expect(html).toContain("accepted");
    expect(html).toContain("draft");
    expect(html).toContain("Source coverage");
    expect(html).toContain("bw_source_runtime");
    expect(html).toContain("Claims and decisions");
    expect(html).toContain("Runtime raw source rows stay immutable.");
    expect(html).toContain("Claims table");
    expect(html).toContain("Knowledge health");
    expect(html).toContain("Obsidian compatibility");
    expect(html).toContain("Vault dashboard links");
    expect(html).toContain("obsidian://open?vault=memory");
    expect(html).toContain("partial");
    expect(html).toContain("vault.health");
    expect(html).toContain("bwrk claim show bw_claim_stale --json");
    expect(html).toContain("bwrk source show bw_source_orphan --json");
    expect(html).toContain("Decision timeline");
    expect(html).toContain("bwrk decision list --source bw_source_runtime --json");
    expect(html).toContain("needs_review");
  });
});

function workItem(input: Partial<WorkItemView> & Pick<WorkItemView, "id" | "title">): WorkItemView {
  return {
    kind: "task",
    status: "ready",
    priority: "normal",
    labels: [],
    dependencyIds: [],
    activeBlockerIds: [],
    blockedBy: [],
    evidenceCount: 0,
    verificationCount: 0,
    requiredCloseoutGates: [],
    ...input
  };
}

function directiveSummaryFixture(subjectId: string): WorkDirectiveSummaryView {
  const base = {
    total: 4,
    advisory: 2,
    required: 1,
    blocking: 1,
    sourceCommands: ["bwrk sync refresh --json", `bwrk work show ${subjectId} --json`],
    items: [
      {
        id: "directive.workflow_next.fixture",
        registryId: "workflow_next.canonical-next-step",
        family: "workflow_next",
        kind: "next_step",
        title: "Follow next canonical workflow",
        severity: "advisory",
        lane: "advisory",
        reason: "Follow the named canonical workflow before continuing.",
        sourceCommand: "bwrk sync refresh --json",
        nextCommand: "bwrk sync refresh --json",
        workflowRef: "workflows/40-work/claim-and-finish-work.md",
        requiredInputs: ["work", "doctor"],
        relatedIds: [subjectId]
      },
      {
        id: "directive.closeout.fixture",
        registryId: "closeout.required-summary",
        family: "closeout",
        kind: "final_response",
        title: "Summarize successful closeout",
        severity: "required",
        lane: "required",
        reason: "Final closeout requires a concise user-facing summary.",
      sourceCommand: `bwrk work show ${subjectId} --json`,
      blocksCloseout: true,
      acknowledgement: {
        requiredBefore: "close",
        evidenceKind: "note",
        message: "The user-facing closeout summary must be prepared from verified data."
      },
      requiredInputs: ["summary"],
      relatedIds: [subjectId, "bw_gate_fixture"]
      },
      {
        id: "directive.git.fixture",
        registryId: "git.blocked-dirty-state",
        family: "git",
        kind: "blocked",
        title: "Resolve dirty checkpoint",
        severity: "blocking",
        lane: "blocking",
        reason: "Checkpoint is blocked until dirty state is resolved or explicitly explained.",
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
        id: "directive.context.fixture",
        registryId: "context.info",
        family: "context",
        kind: "reference",
        title: "Context pack available",
        severity: "advisory",
        lane: "advisory",
        reason: "Context pack can be inspected before responding.",
        sourceCommand: `bwrk summary show ${subjectId} --json`,
        requiredInputs: [],
        relatedIds: [subjectId, "bw_summary_fixture"]
      }
    ]
  };
  const nextSteps: WorkDirectiveSummaryView["nextSteps"] = [
    {
      id: "next-step-directive.workflow_next.fixture",
      title: "Follow next canonical workflow",
      lane: "advisory",
      command: "bwrk sync refresh --json",
      workflowRef: "workflows/40-work/claim-and-finish-work.md",
      reason: "Follow the named canonical workflow before continuing.",
      relatedIds: [subjectId]
    },
    {
      id: "next-step-directive.git.fixture",
      title: "Resolve dirty checkpoint",
      lane: "blocking",
      command: "bwrk doctor --json",
      workflowRef: "workflows/60-health/sync-and-doctor.md",
      reason: "Checkpoint is blocked until dirty state is resolved or explicitly explained.",
      relatedIds: [subjectId, "bw_reservation_fixture", "bw_work_blocker_fixture"]
    }
  ];
  const conflicts: WorkDirectiveSummaryView["conflicts"] = [
    {
      id: "directive-conflict-fixture",
      directiveIds: ["directive.git.fixture", "directive.workflow_next.fixture"],
      reason: "Blocking directive wins.",
      resolution: "blocking_wins",
      resolvedDirectiveId: "directive.git.fixture",
      severity: "blocking",
      lane: "blocking"
    }
  ];
  const missingRequired: WorkDirectiveSummaryView["missingRequired"] = [
    {
      id: "directive-missing-fixture",
      registryId: "closeout.summary-required",
      family: "closeout",
      requirement: "summary.latestSummaryId",
      message: "Summary data is required.",
      subjectId,
      subjectType: "work"
    }
  ];
  return {
    ...base,
    conflictCount: conflicts.length,
    missingRequiredCount: missingRequired.length,
    acknowledgementCount: base.items.filter((item) => item.acknowledgement).length,
    blockerIds: ["bw_work_blocker_fixture"],
    safeCommands: ["bwrk sync refresh --json", `bwrk work show ${subjectId} --json`, "bwrk doctor --json", `bwrk summary show ${subjectId} --json`],
    nextSteps,
    conflicts,
    missingRequired
  };
}

function sprintBoardView(): SprintBoardView {
  const sprint = workItem({ id: "bw_work_sprint", kind: "sprint", title: "Sprint 03" });
  const phase = workItem({
    id: "bw_work_phase",
    kind: "milestone",
    title: "Phase 03A",
    status: "blocked",
    activeBlockerIds: ["bw_work_task", "bw_work_docs"],
    evidenceCount: 1
  });
  const task = workItem({
    id: "bw_work_task",
    title: "Convert components",
    labels: ["component-import"],
    dependencyIds: ["bw_work_active"],
    activeBlockerIds: ["bw_work_active"],
    evidenceCount: 2,
    directiveSummary: directiveSummaryFixture("bw_work_task")
  });
  const active = workItem({
    id: "bw_work_active",
    title: "Wire sprint board",
    status: "in_progress",
    priority: "high",
    labels: ["sprint-ui", "kanban", "component-import", "runtime", "console"],
    dependencyIds: ["bw_work_task"],
    activeReservationId: "bw_reservation_active",
    activeReservation: {
      id: "bw_reservation_active",
      agentId: "cybertron",
      reservedAt: "2026-06-27T00:00:00.000Z",
      expiresAt: "2099-01-01T00:00:00.000Z",
      expired: false
    },
    contextSummary: "Card keeps bounded context visible."
  });
  const verification = workItem({
    id: "bw_work_verify",
    title: "Verify responsive lanes",
    status: "needs_verification",
    priority: "critical",
    evidenceCount: 2,
    verificationCount: 1
  });
  const closed = workItem({ id: "bw_work_closed", title: "Close board shell", status: "closed", evidenceCount: 1, verificationCount: 1 });
  return {
    sprint,
    phases: [phase],
    lanes: [
      { id: "ready", title: "Ready", count: 1, items: [task] },
      { id: "blocked", title: "Blocked", count: 1, items: [phase] },
      { id: "in_progress", title: "In Progress", count: 1, items: [active] },
      { id: "needs_verification", title: "Needs Verification", count: 1, items: [verification] },
      { id: "closed", title: "Closed", count: 1, items: [closed] }
    ],
    summary: {
      sprintId: sprint.id,
      total: 5,
      ready: 1,
      blocked: 1,
      inProgress: 1,
      needsVerification: 1,
      verified: 0,
      closed: 1,
      activeReservations: 1,
      expiredReservations: 0,
      phaseCount: 1,
      taskCount: 4,
      activeBlockerCount: 3
    }
  };
}

function closedSprintBoardView(): SprintBoardView {
  const base = sprintBoardView();
  return {
    ...base,
    sprint: { ...base.sprint, status: "closed", title: "Sprint 03 Closed" },
    summary: { ...base.summary, blocked: 0, activeBlockerCount: 0, closed: base.summary.total }
  };
}

function registryView(): ProjectRegistryView {
  return {
    entries: [
      {
        id: "project-b",
        name: "B Project",
        projectRoot: "/repo/b",
        memoryRoot: "/repo/b/memory",
        memoryLayout: "child",
        memoryGitMode: "separate",
        health: "warning",
        stale: true,
        syncFreshness: "stale",
        openWorkCount: 2,
        readyWorkCount: 1,
        blockedWorkCount: 1,
        activeReservationCount: 1,
        findings: []
      }
    ],
    summary: {
      totalProjects: 2,
      healthyProjects: 1,
      warningProjects: 1,
      errorProjects: 0,
      missingProjects: 0,
      staleProjects: 1,
      openWorkCount: 2,
      readyWorkCount: 1,
      blockedWorkCount: 1,
      activeReservationCount: 1
    }
  };
}

function globalBoardView(): GlobalBoardView {
  const ready = workItem({
    id: "bw_work_ready",
    title: "Ready board card",
    status: "ready",
    directiveSummary: directiveSummaryFixture("bw_work_ready")
  });
  const active = workItem({
    id: "bw_work_active",
    title: "Active board card",
    status: "in_progress",
    activeReservationId: "bw_reservation_active"
  });
  const blocked = workItem({
    id: "bw_work_blocked",
    title: "Blocked board card",
    status: "blocked",
    activeBlockerIds: ["bw_work_ready"],
    blockedBy: ["bw_work_ready"]
  });
  const columns: GlobalBoardView["lanes"][number]["columns"] = [
    { id: "draft", title: "Draft", count: 0, items: [] },
    {
      id: "ready",
      title: "Ready",
      count: 1,
      items: [{
        id: "project-b:bw_work_ready",
        projectId: "project-b",
        projectName: "B Project",
        projectRoot: "/repo/b",
        work: ready,
        status: ready.status,
        columnId: "ready",
        hasBorealReferences: false,
        borealReferenceCount: 0,
        claimCommand: "bwrk --workspace /repo/b work reserve bw_work_ready --purpose 'Claim from Boreal Console' --json"
      }]
    },
    {
      id: "in_progress",
      title: "In Progress",
      count: 1,
      items: [{
        id: "project-b:bw_work_active",
        projectId: "project-b",
        projectName: "B Project",
        projectRoot: "/repo/b",
        work: active,
        status: active.status,
        columnId: "in_progress",
        hasBorealReferences: false,
        borealReferenceCount: 0
      }]
    },
    {
      id: "blocked",
      title: "Blocked",
      count: 1,
      items: [{
        id: "project-b:bw_work_blocked",
        projectId: "project-b",
        projectName: "B Project",
        projectRoot: "/repo/b",
        work: blocked,
        status: blocked.status,
        columnId: "blocked",
        hasBorealReferences: false,
        borealReferenceCount: 0
      }]
    },
    { id: "needs_verification", title: "Needs Verification", count: 0, items: [] },
    { id: "verified", title: "Verified", count: 0, items: [] },
    { id: "closed", title: "Closed", count: 0, items: [] }
  ];
  return {
    lanes: [{
      id: "project-b",
      kind: "project",
      projectId: "project-b",
      projectName: "B Project",
      projectRoot: "/repo/b",
      lifecycle: "linked",
      health: "ok",
      stale: false,
      syncFreshness: "fresh",
      stalenessLabel: "fresh",
      columns,
      totalWork: 3,
      openWork: 3,
      blockedWork: 1,
      readyWork: 1,
      findingCount: 0
    }],
    rails: [
      { id: "inbox", title: "Inbox rail", items: [], count: 0, emptyLabel: "No inbox items." },
      { id: "next", title: "Next rail", items: [], count: 0, emptyLabel: "No next work." }
    ],
    summary: {
      lanes: 1,
      projects: 1,
      initiatives: 0,
      totalWork: 3,
      openWork: 3,
      staleLanes: 0,
      pausedLanes: 0,
      missingLanes: 0,
      draft: 0,
      ready: 1,
      inProgress: 1,
      blocked: 1,
      needsVerification: 0,
      verified: 0,
      closed: 0,
      inbox: 0,
      next: 0
    }
  };
}

function globalQueuesView(): GlobalWorkQueuesView {
  const work = workItem({
    id: "bw_work_ready",
    title: "Claimable work",
    status: "ready",
    directiveSummary: directiveSummaryFixture("bw_work_ready")
  });
  return {
    queues: [
      {
        id: "ready",
        title: "Ready to claim",
        count: 1,
        items: [
          {
            id: `project-b:${work.id}`,
            projectId: "project-b",
            projectName: "B Project",
            projectRoot: "/repo/b",
            work,
            claimCommand: "bwrk --workspace /repo/b work reserve bw_work_ready --purpose 'Claim from Boreal Console' --json"
          }
        ]
      },
      { id: "blocked", title: "Blocked", count: 0, items: [] },
      { id: "needs_verification", title: "Needs verification", count: 0, items: [] }
    ],
    summary: {
      total: 1,
      ready: 1,
      blocked: 0,
      needsVerification: 0
    }
  };
}

function globalSearchView(): GlobalSearchView {
  return {
    query: "console",
    count: 1,
    results: [
      {
        id: "project-b:context_pack:bw_projection_1",
        projectId: "project-b",
        projectName: "B Project",
        projectRoot: "/repo/b",
        sourceKind: "context_pack",
        recordId: "bw_projection_1",
        title: "Console context",
        summary: "Search result keeps project and source kind.",
        score: 11.2
      }
    ]
  };
}

function globalActivityView(): GlobalActivityView {
  return {
    items: [
      {
        id: "project-b:bw_operation_1",
        projectId: "project-b",
        projectName: "B Project",
        projectRoot: "/repo/b",
        sessionId: "local",
        commandPath: "agent start",
        status: "succeeded",
        exitCode: 0,
        stateChanged: true,
        generatedArtifactsChanged: true,
        actorId: "codex",
        actorKind: "agent",
        startedAt: "2026-06-27T00:00:00.000Z",
        finishedAt: "2026-06-27T00:00:01.000Z",
        eventCount: 1
      }
    ],
    summary: {
      total: 1,
      human: 0,
      agent: 1,
      system: 0,
      unknown: 0,
      failed: 0,
      stateChanged: 1,
      generatedArtifactsChanged: 1
    }
  };
}

function rawInboxView(): RawInboxView {
  const row = {
    id: "bw_source_thread",
    title: "thread-export.txt",
    kind: "chat",
    uri: "memory/raw/thread-export.txt",
    summary: "Captured source transcript.",
    tags: ["raw-inbox"],
    addedAt: "2026-06-27T00:00:00.000Z",
    actorId: "cybertron",
    contentHash: "sha256:fixture",
    sourceBacked: true as const,
    immutable: true as const,
    processingStatus: "linked" as const,
    linkedPageCount: 1,
    retrievalCommand: "bwrk raw show bw_source_thread --json",
    previewCommand: "bwrk raw show bw_source_thread --preview-bytes 4096 --json"
  };
  return {
    generatedAt: "2026-06-27T00:00:00.000Z",
    rows: [row],
    selected: {
      ...row,
      linkedPages: [{ id: "bw_page_runtime", title: "Runtime Hardening Notes", path: "memory/wiki/runtime-hardening-notes.md" }],
      preview: {
        status: "truncated",
        mediaType: "text",
        message: "Preview truncated to 4096 of 9000 bytes.",
        uri: row.uri,
        path: "/repo/b/memory/raw/thread-export.txt",
        body: "Decision: raw rows stay immutable.",
        bytes: 4096,
        totalBytes: 9000,
        maxBytes: 4096,
        truncated: true
      }
    },
    ingestPlan: {
      sourceId: row.id,
      sourceTitle: row.title,
      generatedAt: "2026-06-27T00:00:00.000Z",
      sourceLinks: [
        { label: "Raw vault source", ref: row.id, command: row.retrievalCommand },
        { label: "Runtime source placeholder", ref: "<source-id-from-source-add>" }
      ],
      applyCommands: [
        "bwrk workflows show 20-memory/add-raw-source.md --json",
        "bwrk workflows show 30-knowledge/create-wiki-page.md --json"
      ],
      findings: [
        {
          id: "bw_source_thread:partial",
          severity: "warning",
          title: "Preview is partial",
          detail: "Preview truncated to 4096 of 9000 bytes.",
          sourceRefs: [row.id]
        }
      ],
      mutations: [
        {
          id: "bw_source_thread:wiki",
          kind: "wiki",
          title: "Create source-backed wiki page",
          summary: "Draft a wiki entry linked directly to the raw source.",
          status: "planned",
          command: "bwrk workflows show 30-knowledge/create-wiki-page.md --json",
          workflowPath: "30-knowledge/create-wiki-page.md",
          workflowCommand: "bwrk workflows show 30-knowledge/create-wiki-page.md --json",
          skillRef: "$boreal-wiki-claim-decision",
          sourceRefs: [row.id],
          additions: ["wiki page", "source_refs entry"],
          contradictions: []
        },
        {
          id: "bw_source_thread:claim",
          kind: "claim",
          title: "Create proposed claim",
          summary: "Capture a proposed claim after runtime source creation.",
          status: "needs_input",
          command: "bwrk workflows show 30-knowledge/create-claim.md --json",
          workflowPath: "30-knowledge/create-claim.md",
          workflowCommand: "bwrk workflows show 30-knowledge/create-claim.md --json",
          skillRef: "$boreal-wiki-claim-decision",
          sourceRefs: [row.id, "<source-id-from-source-add>"],
          additions: ["proposed claim"],
          contradictions: ["Claim statement requires human wording before apply."]
        }
      ]
    },
    contradictionReview: {
      generatedAt: "2026-06-27T00:00:00.000Z",
      sourceId: row.id,
      conflicts: [
        {
          id: "bw_source_thread:conflict",
          severity: "medium",
          title: "Potential duplicate claim",
          currentAssertion: "Existing memory already covers this thread.",
          incomingAssertion: "Incoming raw source proposes a new claim.",
          sourceRefs: [row.id, "<source-id-from-source-add>"],
          evidenceLinks: [
            { label: "Raw vault source", ref: row.id, command: row.retrievalCommand },
            { label: "Runtime source placeholder", ref: "<source-id-from-source-add>" }
          ],
          resolutionCommands: [
            {
              action: "accept",
              label: "Accept incoming assertion",
              command: "bwrk workflows show 20-memory/contradiction-resolution.md --json",
              auditTrail: "Routes accepted assertion review through the contradiction workflow."
            },
            {
              action: "reject",
              label: "Reject incoming assertion",
              command: "bwrk workflows show 20-memory/contradiction-resolution.md --json",
              auditTrail: "Routes rejected assertion review through the contradiction workflow."
            },
            {
              action: "supersede",
              label: "Supersede with decision",
              command: "bwrk workflows show 20-memory/contradiction-resolution.md --json",
              auditTrail: "Routes supersession review through the contradiction workflow."
            }
          ]
        }
      ],
      summary: { total: 1, high: 0, medium: 1, low: 0 }
    },
    summary: { total: 1, queued: 0, linked: 1, missingPreview: 0, unsupportedPreview: 0 },
    warnings: []
  };
}

function reportsView(): ReportsView {
  const markdown = [
    "# Knowledge Dashboard Static Report",
    "",
    "Generated: 2026-06-27T00:00:00.000Z",
    "State: fresh",
    "",
    "## Summary",
    "",
    "- Raw sources: 1",
    "- Wiki pages: 2",
    "- Claims: 4",
    "- Decisions: 4",
    "- Health findings: 3",
    "",
    "## Reproduce",
    "",
    "- pnpm console:render -- --route /knowledge --mode live --out .boreal/results/console-knowledge.html"
  ].join("\n");
  return {
    generatedAt: "2026-06-27T00:00:00.000Z",
    artifacts: [
      {
        id: "report:console-knowledge",
        title: "console-knowledge.html",
        path: ".boreal/results/console-knowledge.html",
        kind: "html",
        bytes: 24000,
        updatedAt: "2026-06-27T00:00:00.000Z",
        stale: false,
        preview: "<!doctype html><html><body>Knowledge</body></html>",
        openCommand: "open .boreal/results/console-knowledge.html"
      },
      {
        id: "report:knowledge-markdown",
        title: "knowledge-report.md",
        path: ".boreal/results/knowledge-report.md",
        kind: "markdown",
        bytes: markdown.length,
        updatedAt: "2026-06-27T00:00:00.000Z",
        stale: false,
        preview: markdown,
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
        stale: false,
        summary: "Static read-only project dashboard export generated from current runtime state."
      },
      {
        id: "console-knowledge",
        title: "Knowledge dashboard HTML",
        route: "/knowledge",
        outFile: ".boreal/results/console-knowledge.html",
        format: "html",
        command: "pnpm console:render -- --route /knowledge --mode live --out .boreal/results/console-knowledge.html",
        stale: false,
        summary: "Static read-only knowledge dashboard export."
      }
    ],
    knowledgeReport: {
      title: "Knowledge Dashboard Static Report",
      generatedAt: "2026-06-27T00:00:00.000Z",
      stale: false,
      markdown,
      commands: ["pnpm console:render -- --route /knowledge --mode live --out .boreal/results/console-knowledge.html"],
      summary: {
        rawSources: 1,
        wikiPages: 2,
        claims: 4,
        decisions: 4,
        healthFindings: 3
      }
    },
    summary: {
      artifactCount: 2,
      staleArtifacts: 0,
      staticExportCount: 2,
      markdownArtifacts: 1,
      htmlArtifacts: 1
    },
    warnings: []
  };
}

function wikiExplorerView(): WikiExplorerView {
  const accepted = {
    id: "bw_page_runtime",
    slug: "runtime-hardening-notes",
    title: "Runtime Hardening Notes",
    path: "memory/wiki/runtime-hardening-notes.md",
    truthStatus: "accepted" as const,
    sourceRefCount: 2,
    backlinkCount: 1,
    outboundLinkCount: 1,
    claimCount: 1,
    decisionCount: 1,
    sourceCoverageStatus: "covered" as const,
    showCommand: "bwrk wiki show bw_page_runtime --json"
  };
  const draft = {
    id: "bw_page_draft",
    slug: "draft-reconcile-notes",
    title: "Draft Reconcile Notes",
    path: "memory/wiki/draft-reconcile-notes.md",
    truthStatus: "draft" as const,
    sourceRefCount: 0,
    backlinkCount: 0,
    outboundLinkCount: 1,
    claimCount: 0,
    decisionCount: 0,
    sourceCoverageStatus: "unbacked" as const,
    showCommand: "bwrk wiki show bw_page_draft --json"
  };
  return {
    generatedAt: "2026-06-27T00:00:00.000Z",
    rows: [accepted, draft],
    selected: {
      ...accepted,
      sourceRefs: ["bw_source_thread", "bw_source_runtime"],
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
      missingOutboundLinks: ["Missing Page"],
      sourceCoverage: {
        status: "covered",
        sourceRefs: ["bw_source_thread", "bw_source_runtime"],
        coveredRefs: ["bw_source_thread", "bw_source_runtime"],
        missingRefs: [],
        rawSources: [rawInboxView().rows[0]!],
        runtimeSources: [{
          id: "bw_source_runtime",
          kind: "raw",
          title: "thread-export.txt",
          uri: "memory/raw/thread-export.txt"
        }]
      },
      claims: [{
        id: "bw_claim_runtime",
        status: "accepted",
        statement: "Runtime raw source rows stay immutable.",
        sourceIds: ["bw_source_runtime"],
        evidenceIds: ["bw_evidence_runtime"],
        evidenceCount: 1,
        reviewState: "accepted",
        updatedAt: "2026-06-27T00:00:00.000Z"
      }],
      decisions: [{
        id: "bw_decision_runtime",
        status: "accepted",
        title: "Keep raw previews read-only",
        context: "Raw preview context.",
        decision: "Raw preview commands do not mutate state.",
        consequences: ["Preview can be refreshed safely."],
        sourceIds: ["bw_source_runtime"],
        reviewState: "accepted",
        updatedAt: "2026-06-27T00:00:00.000Z"
      }]
    },
    importantPages: [accepted, draft],
    claims: [
      {
        id: "bw_claim_runtime",
        status: "accepted",
        statement: "Runtime raw source rows stay immutable.",
        sourceIds: ["bw_source_runtime"],
        evidenceIds: ["bw_evidence_runtime"],
        evidenceCount: 1,
        reviewState: "accepted",
        updatedAt: "2026-06-27T00:00:00.000Z"
      },
      {
        id: "bw_claim_proposed",
        status: "proposed",
        statement: "Proposed source claim needs review.",
        sourceIds: ["bw_source_runtime"],
        evidenceIds: [],
        evidenceCount: 0,
        reviewState: "needs_review",
        updatedAt: "2026-06-27T00:00:00.000Z"
      },
      {
        id: "bw_claim_rejected",
        status: "rejected",
        statement: "Rejected source claim.",
        sourceIds: ["bw_source_runtime"],
        evidenceIds: [],
        evidenceCount: 0,
        reviewState: "rejected",
        updatedAt: "2026-06-27T00:00:00.000Z"
      },
      {
        id: "bw_claim_stale",
        status: "stale",
        statement: "Stale source claim.",
        sourceIds: ["bw_source_runtime"],
        evidenceIds: ["bw_evidence_old"],
        evidenceCount: 1,
        reviewState: "needs_refresh",
        updatedAt: "2026-06-27T00:00:00.000Z"
      }
    ],
    decisionTimeline: [
      {
        id: "bw_decision_runtime",
        status: "accepted",
        title: "Keep raw previews read-only",
        context: "Raw preview context.",
        decision: "Raw preview commands do not mutate state.",
        consequences: ["Preview can be refreshed safely."],
        sourceIds: ["bw_source_runtime"],
        reviewState: "accepted",
        updatedAt: "2026-06-27T00:00:00.000Z"
      },
      {
        id: "bw_decision_proposed",
        status: "proposed",
        title: "Promote proposed source",
        context: "Reviewer context.",
        decision: "Review before promotion.",
        consequences: ["Proposed decisions remain distinct."],
        sourceIds: ["bw_source_runtime"],
        reviewState: "needs_review",
        updatedAt: "2026-06-27T00:00:00.000Z"
      },
      {
        id: "bw_decision_rejected",
        status: "rejected",
        title: "Reject duplicate source",
        context: "Duplicate context.",
        decision: "Do not promote duplicate.",
        consequences: [],
        sourceIds: ["bw_source_runtime"],
        reviewState: "rejected",
        updatedAt: "2026-06-27T00:00:00.000Z"
      },
      {
        id: "bw_decision_superseded",
        status: "superseded",
        title: "Old source decision",
        context: "Historical context.",
        decision: "Superseded by source-backed workflow.",
        consequences: ["Historical state remains visible."],
        sourceIds: ["bw_source_runtime"],
        reviewState: "superseded",
        supersessionStatus: "superseded",
        updatedAt: "2026-06-27T00:00:00.000Z"
      }
    ],
    filters: {
      claimStatuses: ["accepted", "proposed", "rejected", "stale"],
      decisionStatuses: ["accepted", "proposed", "rejected", "superseded"],
      sourceIds: ["bw_source_orphan", "bw_source_runtime"]
    },
    healthFindings: [
      {
        id: "vault.health.stale_assertion:bw_claim_stale",
        code: "vault.health.stale_assertion",
        doctorCode: "vault.health",
        severity: "warning",
        title: "Stale claim",
        detail: "Claim bw_claim_stale is stale: Stale source claim.",
        targetKind: "claim",
        targetId: "bw_claim_stale",
        href: "/knowledge?claimStatus=stale&source=bw_source_runtime",
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
    obsidian: obsidianCompatibilityView([accepted, draft]),
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

function obsidianCompatibilityView(pages: readonly WikiExplorerView["rows"][number][]): WikiExplorerView["obsidian"] {
  return {
    generatedAt: "2026-06-27T00:00:00.000Z",
    memoryRoot: "/workspace/boreal-work/memory",
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

function globalHealthView(): GlobalHealthView {
  return {
    projects: [
      {
        projectId: "project-b",
        projectName: "B Project",
        projectRoot: "/repo/b",
        memoryRoot: "/repo/b/memory",
        health: "warning",
        stale: true,
        syncFreshness: "stale",
        syncOk: false,
        vaultOk: true,
        ledgersOk: false,
        searchIndexOk: true,
        gitOk: true,
        findingCount: 1
      }
    ],
    findings: [
      {
        id: "project-b:ledger.export_drift",
        projectId: "project-b",
        projectName: "B Project",
        projectRoot: "/repo/b",
        workspaceRoot: "/repo/b",
        category: "ledger",
        code: "ledger.export_drift",
        title: "ledger.export_drift",
        severity: "warning",
        status: "warning",
        message: "Ledger export is stale.",
        sourcePath: "/repo/b/.boreal/ledgers",
        actions: [
          {
            label: "Refresh",
            command: "bwrk --workspace /repo/b sync refresh --json",
            mutatesState: true,
            requiresConfirmation: true
          }
        ]
      }
    ],
    driftGroups: [
      {
        category: "ledger",
        title: "Ledgers and snapshots",
        count: 1,
        findings: [
          {
            id: "project-b:ledger.export_drift",
            projectId: "project-b",
            projectName: "B Project",
            projectRoot: "/repo/b",
            workspaceRoot: "/repo/b",
            category: "ledger",
            code: "ledger.export_drift",
            title: "ledger.export_drift",
            severity: "warning",
            status: "warning",
            message: "Ledger export is stale.",
            sourcePath: "/repo/b/.boreal/ledgers",
            actions: [
              {
                label: "Refresh",
                command: "bwrk --workspace /repo/b sync refresh --json",
                mutatesState: true,
                requiresConfirmation: true
              }
            ]
          }
        ]
      }
    ],
    summary: {
      totalProjects: 1,
      healthyProjects: 0,
      warningProjects: 1,
      errorProjects: 0,
      staleProjects: 1,
      findings: 1,
      errors: 0,
      warnings: 1,
      fixableActions: 1,
      lockFindings: 0,
      searchFindings: 0,
      ledgerFindings: 1,
      setupFindings: 0
    }
  };
}

function globalSettingsView(): GlobalSettingsView {
  return {
    projects: [
      {
        projectId: "project-b",
        projectName: "B Project",
        projectRoot: "/repo/b",
        memoryRoot: "/repo/b/memory",
        memoryLayout: "child",
        memoryGitMode: "separate",
        installRoot: "/repo/b",
        source: "project-setup",
        health: "warning",
        stale: true,
        validateCommand: "bwrk --workspace /repo/b doctor --json",
        importSetupCommand: "bwrk --workspace /repo/b registry import-setup --json",
        applySetupCommand: "bwrk --workspace /repo/b init --setup-memory --memory-root /repo/b/memory --memory-layout child --memory-git-mode separate --json",
        requiresConfirmation: true
      }
    ],
    memoryModes: [
      {
        id: "separate",
        label: "Separate",
        description: "Separate memory history.",
        risk: "Default for avoiding mixed project and memory history."
      },
      {
        id: "submodule",
        label: "Submodule",
        description: "Linked memory repository.",
        risk: "Requires remote metadata."
      },
      {
        id: "shared",
        label: "Shared",
        description: "Shared project history.",
        risk: "Use only when mixed history is intentional."
      }
    ],
    addProjectAction: "/api/settings/projects/add",
    importSetupAction: "/api/settings/projects/import-setup",
    applySetupAction: "/api/settings/projects/apply-setup"
  };
}

function healthView(): DashboardHealthView {
  return {
    title: "Doctor",
    summary: {
      ok: true,
      total: 0,
      errors: 0,
      warnings: 0,
      manualActions: 0,
      fixableActions: 0
    },
    findings: []
  };
}
