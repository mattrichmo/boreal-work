import { isBorealReferenceUri, type ActorKind, type WorkItem } from "@boreal/core";

import type {
  DashboardAction,
  DashboardFinding,
  DashboardFindingSeverity,
  DashboardFindingStatus,
  LockStatusView
} from "./health-view.js";
import type {
  ProjectHealthState,
  ProjectMemoryGitMode,
  ProjectMemoryLayout,
  ProjectSyncFreshness
} from "./registry-view.js";
import type { WorkItemView, WorkReservationView } from "./work-view.js";

export type WorkQueueId = "ready" | "blocked" | "in_progress" | "needs_verification" | "verified" | "closed";
export type GlobalWorkQueueId = "ready" | "blocked" | "needs_verification";

export interface WorkQueueView {
  readonly id: WorkQueueId;
  readonly title: string;
  readonly items: readonly WorkItemView[];
  readonly count: number;
}

export interface ReservationViewInput {
  readonly id?: string;
  readonly meta?: { readonly id: string };
  readonly workId: string;
  readonly status: string;
  readonly agentId?: string | number;
  readonly reservedAt?: string;
  readonly expiresAt?: string;
  readonly expired?: boolean;
}

export interface GlobalWorkQueueProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly work: readonly WorkItemView[];
}

export interface GlobalWorkQueueItem {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly work: WorkItemView;
  readonly hasBorealReferences: boolean;
  readonly borealReferenceCount: number;
  readonly claimCommand?: string;
}

export interface GlobalWorkQueueView {
  readonly id: GlobalWorkQueueId;
  readonly title: string;
  readonly items: readonly GlobalWorkQueueItem[];
  readonly count: number;
}

export interface GlobalWorkQueueSummary {
  readonly total: number;
  readonly ready: number;
  readonly blocked: number;
  readonly needsVerification: number;
}

export interface GlobalWorkQueuesView {
  readonly generatedAt?: string;
  readonly queues: readonly GlobalWorkQueueView[];
  readonly summary: GlobalWorkQueueSummary;
}

export interface GlobalSearchProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly results: readonly GlobalSearchSourceRow[];
}

export interface GlobalSearchSourceRow {
  readonly id: string;
  readonly type: string;
  readonly recordId: string;
  readonly title: string;
  readonly summary?: string;
  readonly score: number;
}

export interface GlobalSearchResultItem {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly sourceKind: string;
  readonly recordId: string;
  readonly title: string;
  readonly summary?: string;
  readonly score: number;
}

export interface GlobalSearchView {
  readonly generatedAt?: string;
  readonly query: string;
  readonly results: readonly GlobalSearchResultItem[];
  readonly count: number;
}

export type GlobalActivityActorKind = ActorKind | "unknown";

export interface GlobalActivityProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly operations: readonly GlobalActivitySourceRow[];
}

export interface GlobalActivitySourceRow {
  readonly id: string;
  readonly sessionId: string;
  readonly commandPath: string;
  readonly status: string;
  readonly exitCode: number;
  readonly stateChanged: boolean;
  readonly generatedArtifactsChanged: boolean;
  readonly actorId: string;
  readonly actorKind?: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly eventCount: number;
}

export interface GlobalActivityItem {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly sessionId: string;
  readonly commandPath: string;
  readonly status: string;
  readonly exitCode: number;
  readonly stateChanged: boolean;
  readonly generatedArtifactsChanged: boolean;
  readonly actorId: string;
  readonly actorKind: GlobalActivityActorKind;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly eventCount: number;
}

export interface GlobalActivitySummary {
  readonly total: number;
  readonly human: number;
  readonly agent: number;
  readonly system: number;
  readonly unknown: number;
  readonly failed: number;
  readonly stateChanged: number;
  readonly generatedArtifactsChanged: number;
}

export interface GlobalActivityView {
  readonly generatedAt?: string;
  readonly items: readonly GlobalActivityItem[];
  readonly summary: GlobalActivitySummary;
}

export type GlobalHealthCategory = "doctor" | "sync" | "lock" | "search" | "ledger" | "setup" | "registry" | "git" | "vault" | "other";

export interface GlobalHealthAction extends DashboardAction {
  readonly mutatesState: boolean;
  readonly requiresConfirmation: boolean;
}

export interface GlobalHealthProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly memoryRoot?: string;
  readonly health: ProjectHealthState;
  readonly stale: boolean;
  readonly syncFreshness: ProjectSyncFreshness;
  readonly syncOk: boolean;
  readonly vaultOk: boolean;
  readonly ledgersOk: boolean;
  readonly searchIndexOk: boolean;
  readonly gitOk: boolean;
  readonly findings: readonly DashboardFinding[];
  readonly locks?: readonly LockStatusView[];
}

export interface GlobalHealthFindingItem {
  readonly id: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly workspaceRoot: string;
  readonly category: GlobalHealthCategory;
  readonly code: string;
  readonly title: string;
  readonly severity: DashboardFindingSeverity;
  readonly status: DashboardFindingStatus;
  readonly message: string;
  readonly sourcePath: string;
  readonly actions: readonly GlobalHealthAction[];
}

export interface GlobalHealthProjectStatus {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly memoryRoot?: string;
  readonly health: ProjectHealthState;
  readonly stale: boolean;
  readonly syncFreshness: ProjectSyncFreshness;
  readonly syncOk: boolean;
  readonly vaultOk: boolean;
  readonly ledgersOk: boolean;
  readonly searchIndexOk: boolean;
  readonly gitOk: boolean;
  readonly findingCount: number;
}

export interface GlobalHealthSummary {
  readonly totalProjects: number;
  readonly healthyProjects: number;
  readonly warningProjects: number;
  readonly errorProjects: number;
  readonly staleProjects: number;
  readonly findings: number;
  readonly errors: number;
  readonly warnings: number;
  readonly fixableActions: number;
  readonly lockFindings: number;
  readonly searchFindings: number;
  readonly ledgerFindings: number;
  readonly setupFindings: number;
}

export interface GlobalHealthDriftGroup {
  readonly category: GlobalHealthCategory;
  readonly title: string;
  readonly findings: readonly GlobalHealthFindingItem[];
  readonly count: number;
}

export interface GlobalHealthView {
  readonly generatedAt?: string;
  readonly projects: readonly GlobalHealthProjectStatus[];
  readonly findings: readonly GlobalHealthFindingItem[];
  readonly driftGroups: readonly GlobalHealthDriftGroup[];
  readonly summary: GlobalHealthSummary;
}

export interface GlobalSettingsMemoryModeOption {
  readonly id: ProjectMemoryGitMode;
  readonly label: string;
  readonly description: string;
  readonly risk: string;
}

export interface GlobalSettingsProjectInput {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: ProjectMemoryLayout;
  readonly memoryGitMode: ProjectMemoryGitMode;
  readonly memoryRemote?: string;
  readonly installRoot?: string;
  readonly source?: string;
  readonly health: ProjectHealthState;
  readonly stale: boolean;
}

export interface GlobalSettingsProject {
  readonly projectId: string;
  readonly projectName: string;
  readonly projectRoot: string;
  readonly memoryRoot: string;
  readonly memoryLayout: ProjectMemoryLayout;
  readonly memoryGitMode: ProjectMemoryGitMode;
  readonly memoryRemote?: string;
  readonly installRoot?: string;
  readonly source?: string;
  readonly health: ProjectHealthState;
  readonly stale: boolean;
  readonly validateCommand: string;
  readonly importSetupCommand: string;
  readonly applySetupCommand: string;
  readonly requiresConfirmation: boolean;
}

export interface GlobalSettingsView {
  readonly generatedAt?: string;
  readonly projects: readonly GlobalSettingsProject[];
  readonly memoryModes: readonly GlobalSettingsMemoryModeOption[];
  readonly addProjectAction: string;
  readonly importSetupAction: string;
  readonly applySetupAction: string;
}

export interface WorkDashboardSummary {
  readonly total: number;
  readonly ready: number;
  readonly blocked: number;
  readonly inProgress: number;
  readonly needsVerification: number;
  readonly verified: number;
  readonly closed: number;
  readonly activeReservations: number;
  readonly expiredReservations: number;
}

export interface WorkDashboardView {
  readonly generatedAt?: string;
  readonly labels: readonly string[];
  readonly queues: readonly WorkQueueView[];
  readonly summary: WorkDashboardSummary;
}

export type SprintBoardLaneId =
  | "draft"
  | "ready"
  | "blocked"
  | "in_progress"
  | "needs_verification"
  | "verified"
  | "closed"
  | "cancelled";

export interface SprintBoardLane {
  readonly id: SprintBoardLaneId;
  readonly title: string;
  readonly items: readonly WorkItemView[];
  readonly count: number;
}

export interface SprintBoardSummary extends WorkDashboardSummary {
  readonly sprintId: string;
  readonly phaseCount: number;
  readonly taskCount: number;
  readonly activeBlockerCount: number;
}

export interface SprintBoardView {
  readonly sprint: WorkItemView;
  readonly generatedAt?: string;
  readonly phases: readonly WorkItemView[];
  readonly lanes: readonly SprintBoardLane[];
  readonly summary: SprintBoardSummary;
}

export function buildWorkDashboardView(input: {
  readonly work: readonly WorkItemView[];
  readonly reservations?: readonly ReservationViewInput[];
  readonly labels?: readonly string[];
  readonly generatedAt?: string;
}): WorkDashboardView {
  const work = sortWork(withReservationViews(input.work, input.reservations ?? []));
  const queues = WORK_QUEUE_DEFINITIONS.map((definition) => {
    const items = work.filter((item) => definition.statuses.includes(item.status));
    return {
      id: definition.id,
      title: definition.title,
      items,
      count: items.length
    };
  });

  return {
    generatedAt: input.generatedAt,
    labels: input.labels ?? [],
    queues,
    summary: buildWorkDashboardSummary(work, input.reservations ?? [])
  };
}

export function buildGlobalWorkQueuesView(input: {
  readonly projects: readonly GlobalWorkQueueProject[];
  readonly generatedAt?: string;
  readonly claimPurpose?: string;
  readonly limit?: number;
}): GlobalWorkQueuesView {
  const queues = GLOBAL_WORK_QUEUE_DEFINITIONS.map((definition) => {
    const items = input.projects
      .flatMap((project) =>
        sortWork(project.work)
          .filter((work) => work.status === definition.status)
          .map((work): GlobalWorkQueueItem => {
            const borealReferenceCount = borealSourceRefCount(work.sourceRefs ?? []);
            return {
              id: `${project.projectId}:${work.id}`,
              projectId: project.projectId,
              projectName: project.projectName,
              projectRoot: project.projectRoot,
              work,
              hasBorealReferences: borealReferenceCount > 0,
              borealReferenceCount,
              claimCommand: definition.id === "ready"
                ? buildClaimCommand(project.projectRoot, work.id, input.claimPurpose ?? "Claim from Boreal Console")
                : undefined
            };
          })
      )
      .sort(compareGlobalQueueItems)
      .slice(0, input.limit ?? Number.POSITIVE_INFINITY);
    return {
      id: definition.id,
      title: definition.title,
      items,
      count: items.length
    };
  });

  return {
    generatedAt: input.generatedAt,
    queues,
    summary: {
      total: queues.reduce((total, queue) => total + queue.count, 0),
      ready: queueCount(queues, "ready"),
      blocked: queueCount(queues, "blocked"),
      needsVerification: queueCount(queues, "needs_verification")
    }
  };
}

function borealSourceRefCount(sourceRefs: readonly { readonly uri: string }[]): number {
  return sourceRefs.filter((sourceRef) => isBorealReferenceUri(sourceRef.uri)).length;
}

export function buildGlobalSearchView(input: {
  readonly query: string;
  readonly projects: readonly GlobalSearchProject[];
  readonly generatedAt?: string;
  readonly limit?: number;
}): GlobalSearchView {
  const results = input.projects
    .flatMap((project) =>
      project.results.map((result): GlobalSearchResultItem => ({
        id: `${project.projectId}:${result.id}`,
        projectId: project.projectId,
        projectName: project.projectName,
        projectRoot: project.projectRoot,
        sourceKind: result.type,
        recordId: result.recordId,
        title: result.title,
        summary: result.summary,
        score: result.score
      }))
    )
    .sort(compareGlobalSearchResults)
    .slice(0, input.limit ?? 20);

  return {
    generatedAt: input.generatedAt,
    query: input.query,
    results,
    count: results.length
  };
}

export function buildGlobalActivityView(input: {
  readonly projects: readonly GlobalActivityProject[];
  readonly generatedAt?: string;
  readonly limit?: number;
}): GlobalActivityView {
  const items = input.projects
    .flatMap((project) =>
      project.operations.map((operation): GlobalActivityItem => ({
        id: `${project.projectId}:${operation.id}`,
        projectId: project.projectId,
        projectName: project.projectName,
        projectRoot: project.projectRoot,
        sessionId: operation.sessionId,
        commandPath: operation.commandPath,
        status: operation.status,
        exitCode: operation.exitCode,
        stateChanged: operation.stateChanged,
        generatedArtifactsChanged: operation.generatedArtifactsChanged,
        actorId: operation.actorId,
        actorKind: activityActorKind(operation.actorKind),
        startedAt: operation.startedAt,
        finishedAt: operation.finishedAt,
        eventCount: operation.eventCount
      }))
    )
    .sort(compareGlobalActivityItems)
    .slice(0, input.limit ?? 20);

  return {
    generatedAt: input.generatedAt,
    items,
    summary: {
      total: items.length,
      human: countActorKind(items, "human"),
      agent: countActorKind(items, "agent"),
      system: countActorKind(items, "system"),
      unknown: countActorKind(items, "unknown"),
      failed: items.filter((item) => item.status === "failed").length,
      stateChanged: items.filter((item) => item.stateChanged).length,
      generatedArtifactsChanged: items.filter((item) => item.generatedArtifactsChanged).length
    }
  };
}

export function buildGlobalHealthView(input: {
  readonly projects: readonly GlobalHealthProject[];
  readonly generatedAt?: string;
  readonly limit?: number;
}): GlobalHealthView {
  const projects = input.projects.map((project): GlobalHealthProjectStatus => {
    const findings = nonOkFindings(project);
    return {
      projectId: project.projectId,
      projectName: project.projectName,
      projectRoot: project.projectRoot,
      memoryRoot: project.memoryRoot,
      health: project.health,
      stale: project.stale,
      syncFreshness: project.syncFreshness,
      syncOk: project.syncOk,
      vaultOk: project.vaultOk,
      ledgersOk: project.ledgersOk,
      searchIndexOk: project.searchIndexOk,
      gitOk: project.gitOk,
      findingCount: findings.length + syntheticHealthFindings(project).length
    };
  }).sort((left, right) => left.projectName.localeCompare(right.projectName));

  const findings = input.projects
    .flatMap((project) => [
      ...syntheticHealthFindings(project),
      ...nonOkFindings(project).map((finding) => globalFindingFromDashboardFinding(project, finding))
    ])
    .sort(compareGlobalHealthFindings)
    .slice(0, input.limit ?? 200);
  const driftGroups = GLOBAL_HEALTH_CATEGORY_DEFINITIONS.map((definition) => {
    const groupFindings = findings.filter((finding) => finding.category === definition.category);
    return {
      category: definition.category,
      title: definition.title,
      findings: groupFindings,
      count: groupFindings.length
    };
  }).filter((group) => group.count > 0);

  return {
    generatedAt: input.generatedAt,
    projects,
    findings,
    driftGroups,
    summary: {
      totalProjects: projects.length,
      healthyProjects: projects.filter((project) => project.health === "ok").length,
      warningProjects: projects.filter((project) => project.health === "warning").length,
      errorProjects: projects.filter((project) => project.health === "error" || project.health === "missing").length,
      staleProjects: projects.filter((project) => project.stale || project.syncFreshness === "stale").length,
      findings: findings.length,
      errors: findings.filter((finding) => finding.severity === "error").length,
      warnings: findings.filter((finding) => finding.severity === "warning").length,
      fixableActions: findings.reduce(
        (total, finding) => total + finding.actions.filter((action) => action.command && action.destructive !== true).length,
        0
      ),
      lockFindings: findings.filter((finding) => finding.category === "lock").length,
      searchFindings: findings.filter((finding) => finding.category === "search").length,
      ledgerFindings: findings.filter((finding) => finding.category === "ledger").length,
      setupFindings: findings.filter((finding) => finding.category === "setup" || finding.category === "registry").length
    }
  };
}

export function buildGlobalSettingsView(input: {
  readonly projects: readonly GlobalSettingsProjectInput[];
  readonly generatedAt?: string;
}): GlobalSettingsView {
  return {
    generatedAt: input.generatedAt,
    projects: input.projects
      .map((project): GlobalSettingsProject => ({
        ...project,
        validateCommand: `bwrk --workspace ${shellQuote(project.projectRoot)} doctor --json`,
        importSetupCommand: `bwrk --workspace ${shellQuote(project.projectRoot)} registry import-setup --json`,
        applySetupCommand: buildApplySetupCommand(project),
        requiresConfirmation: true
      }))
      .sort((left, right) => left.projectName.localeCompare(right.projectName)),
    memoryModes: GLOBAL_SETTINGS_MEMORY_MODES,
    addProjectAction: "/api/settings/projects/add",
    importSetupAction: "/api/settings/projects/import-setup",
    applySetupAction: "/api/settings/projects/apply-setup"
  };
}

export function buildSprintBoardView(input: {
  readonly sprint: WorkItemView;
  readonly work: readonly WorkItemView[];
  readonly reservations?: readonly ReservationViewInput[];
  readonly generatedAt?: string;
}): SprintBoardView {
  const work = sortWork(withReservationViews(input.work, input.reservations ?? []));
  const phases = work.filter((item) => item.kind === "milestone");
  const lanes = SPRINT_BOARD_LANE_DEFINITIONS.map((definition) => {
    const items = work.filter((item) => item.status === definition.id);
    return {
      id: definition.id,
      title: definition.title,
      items,
      count: items.length
    };
  });
  const summary = buildWorkDashboardSummary(work, input.reservations ?? []);

  return {
    sprint: input.sprint,
    generatedAt: input.generatedAt,
    phases,
    lanes,
    summary: {
      ...summary,
      sprintId: input.sprint.id,
      phaseCount: phases.length,
      taskCount: work.filter((item) => item.kind === "task").length,
      activeBlockerCount: work.reduce((total, item) => total + item.activeBlockerIds.length, 0)
    }
  };
}

function buildWorkDashboardSummary(
  work: readonly WorkItemView[],
  reservations: readonly ReservationViewInput[]
): WorkDashboardSummary {
  return {
    total: work.length,
    ready: countStatus(work, "ready"),
    blocked: countStatus(work, "blocked"),
    inProgress: countStatus(work, "in_progress"),
    needsVerification: countStatus(work, "needs_verification"),
    verified: countStatus(work, "verified"),
    closed: countStatus(work, "closed"),
    activeReservations: reservations.filter((reservation) => reservation.status === "active").length,
    expiredReservations: reservations.filter((reservation) => reservation.status === "expired").length
  };
}

function withReservationViews(
  work: readonly WorkItemView[],
  reservations: readonly ReservationViewInput[]
): readonly WorkItemView[] {
  const activeByWork = new Map(
    reservations
      .filter((reservation) => reservation.status === "active")
      .map((reservation) => [reservation.workId, reservation])
  );
  return work.map((item) => {
    const reservation = activeByWork.get(item.id);
    if (!reservation) {
      return item;
    }
    const id = reservation.id ?? reservation.meta?.id;
    if (!id) {
      return item;
    }
    const activeReservation: WorkReservationView = {
      id,
      agentId: String(reservation.agentId ?? ""),
      reservedAt: reservation.reservedAt,
      expiresAt: reservation.expiresAt,
      expired: reservation.expired
    };
    return {
      ...item,
      activeReservationId: item.activeReservationId ?? id,
      activeReservation
    };
  });
}

function countStatus(work: readonly WorkItemView[], status: WorkItem["status"]): number {
  return work.filter((item) => item.status === status).length;
}

function sortWork(work: readonly WorkItemView[]): readonly WorkItemView[] {
  return [...work].sort((left, right) => {
    const priority = priorityRank(right.priority) - priorityRank(left.priority);
    if (priority !== 0) {
      return priority;
    }
    return left.title.localeCompare(right.title);
  });
}

function priorityRank(priority: WorkItem["priority"]): number {
  switch (priority) {
    case "critical":
      return 4;
    case "high":
      return 3;
    case "normal":
      return 2;
    case "low":
      return 1;
  }
}

function compareGlobalQueueItems(left: GlobalWorkQueueItem, right: GlobalWorkQueueItem): number {
  return (
    left.projectName.localeCompare(right.projectName) ||
    priorityRank(right.work.priority) - priorityRank(left.work.priority) ||
    left.work.title.localeCompare(right.work.title)
  );
}

function compareGlobalSearchResults(left: GlobalSearchResultItem, right: GlobalSearchResultItem): number {
  return (
    right.score - left.score ||
    left.projectName.localeCompare(right.projectName) ||
    left.title.localeCompare(right.title)
  );
}

function compareGlobalActivityItems(left: GlobalActivityItem, right: GlobalActivityItem): number {
  return (
    Date.parse(right.finishedAt) - Date.parse(left.finishedAt) ||
    Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
    left.projectName.localeCompare(right.projectName) ||
    left.commandPath.localeCompare(right.commandPath)
  );
}

function activityActorKind(value: string | undefined): GlobalActivityActorKind {
  if (value === "human" || value === "agent" || value === "system") {
    return value;
  }
  return "unknown";
}

function countActorKind(items: readonly GlobalActivityItem[], kind: GlobalActivityActorKind): number {
  return items.filter((item) => item.actorKind === kind).length;
}

function nonOkFindings(project: GlobalHealthProject): readonly DashboardFinding[] {
  return project.findings.filter((finding) => finding.severity !== "info" || finding.status !== "ok");
}

function syntheticHealthFindings(project: GlobalHealthProject): readonly GlobalHealthFindingItem[] {
  const findings: GlobalHealthFindingItem[] = [];
  if (!project.syncOk) {
    findings.push(syntheticGlobalFinding(project, {
      code: "sync.status",
      category: "sync",
      severity: "warning",
      message: "Sync status is unhealthy for this project.",
      command: "bwrk sync refresh --json"
    }));
  }
  if (!project.vaultOk) {
    findings.push(syntheticGlobalFinding(project, {
      code: "vault.status",
      category: "vault",
      severity: "error",
      message: "Vault status is unhealthy for this project.",
      command: "bwrk doctor --json"
    }));
  }
  if (!project.ledgersOk) {
    findings.push(syntheticGlobalFinding(project, {
      code: "ledger.status",
      category: "ledger",
      severity: "warning",
      message: "Ledger export status is unhealthy for this project.",
      command: "bwrk sync refresh --json"
    }));
  }
  if (!project.searchIndexOk) {
    findings.push(syntheticGlobalFinding(project, {
      code: "search.index_status",
      category: "search",
      severity: "warning",
      message: "Search index status is unhealthy for this project.",
      command: "bwrk sync refresh --json"
    }));
  }
  if (!project.gitOk) {
    findings.push(syntheticGlobalFinding(project, {
      code: "git.status",
      category: "git",
      severity: "warning",
      message: "Git collaboration status is unhealthy for this project.",
      command: "bwrk sync status --json"
    }));
  }
  for (const lock of project.locks ?? []) {
    if (lock.status === "clear") {
      continue;
    }
    findings.push({
      id: `${project.projectId}:lock:${lock.domain}:${lock.path}`,
      projectId: project.projectId,
      projectName: project.projectName,
      projectRoot: project.projectRoot,
      workspaceRoot: project.projectRoot,
      category: "lock",
      code: lock.domain,
      title: lock.domain,
      severity: "warning",
      status: "warning",
      message: `Runtime lock is ${lock.status}.`,
      sourcePath: lock.path,
      actions: lock.repairCommand ? [globalHealthAction(project.projectRoot, { label: "Repair lock", command: lock.repairCommand })] : []
    });
  }
  return findings;
}

function syntheticGlobalFinding(
  project: GlobalHealthProject,
  input: {
    readonly code: string;
    readonly category: GlobalHealthCategory;
    readonly severity: DashboardFindingSeverity;
    readonly message: string;
    readonly command: string;
  }
): GlobalHealthFindingItem {
  return {
    id: `${project.projectId}:${input.code}`,
    projectId: project.projectId,
    projectName: project.projectName,
    projectRoot: project.projectRoot,
    workspaceRoot: project.projectRoot,
    category: input.category,
    code: input.code,
    title: input.code,
    severity: input.severity,
    status: input.severity === "error" ? "failed" : "warning",
    message: input.message,
    sourcePath: project.projectRoot,
    actions: [globalHealthAction(project.projectRoot, { label: "Repair", command: input.command })]
  };
}

function globalFindingFromDashboardFinding(project: GlobalHealthProject, finding: DashboardFinding): GlobalHealthFindingItem {
  return {
    id: `${project.projectId}:${finding.code}:${finding.source ?? project.projectRoot}`,
    projectId: project.projectId,
    projectName: project.projectName,
    projectRoot: project.projectRoot,
    workspaceRoot: project.projectRoot,
    category: globalHealthCategory(finding.code),
    code: finding.code,
    title: finding.title,
    severity: finding.severity,
    status: finding.status,
    message: finding.message,
    sourcePath: finding.source ?? project.projectRoot,
    actions: finding.actions.map((action) => globalHealthAction(project.projectRoot, action))
  };
}

function globalHealthAction(projectRoot: string, action: DashboardAction): GlobalHealthAction {
  const command = action.command ? scopedCommand(projectRoot, action.command) : undefined;
  const mutatesState = command ? commandMutatesState(command) || action.destructive === true : false;
  return {
    ...action,
    command,
    mutatesState,
    requiresConfirmation: mutatesState
  };
}

function commandMutatesState(command: string): boolean {
  const readOnlyPatterns = [
    /\bbwrk\s+(?:--workspace\s+(?:'[^']+'|\S+)\s+)?doctor\s+--json\b/,
    /\bbwrk\s+(?:--workspace\s+(?:'[^']+'|\S+)\s+)?sync\s+status\s+--json\b/,
    /\bbwrk\s+(?:--workspace\s+(?:'[^']+'|\S+)\s+)?registry\s+doctor\s+--json\b/
  ];
  return !readOnlyPatterns.some((pattern) => pattern.test(command));
}

function scopedCommand(projectRoot: string, command: string): string {
  const trimmed = command.trim();
  if (trimmed.startsWith("bwrk --workspace ")) {
    return trimmed;
  }
  if (trimmed.startsWith("bwrk ")) {
    return `bwrk --workspace ${shellQuote(projectRoot)} ${trimmed.slice("bwrk ".length)}`;
  }
  if (trimmed.startsWith("git ")) {
    return `git -C ${shellQuote(projectRoot)} ${trimmed.slice("git ".length)}`;
  }
  return `(cd ${shellQuote(projectRoot)} && ${trimmed})`;
}

function globalHealthCategory(code: string): GlobalHealthCategory {
  if (code.startsWith("lock.")) {
    return "lock";
  }
  if (code.startsWith("search.")) {
    return "search";
  }
  if (code.startsWith("ledger.") || code.startsWith("snapshot.")) {
    return "ledger";
  }
  if (code.startsWith("project_setup.")) {
    return "setup";
  }
  if (code.startsWith("registry.")) {
    return "registry";
  }
  if (code.startsWith("git.")) {
    return "git";
  }
  if (code.startsWith("vault.")) {
    return "vault";
  }
  if (code.startsWith("sync.")) {
    return "sync";
  }
  return "doctor";
}

function compareGlobalHealthFindings(left: GlobalHealthFindingItem, right: GlobalHealthFindingItem): number {
  return (
    healthSeverityRank(right.severity) - healthSeverityRank(left.severity) ||
    left.projectName.localeCompare(right.projectName) ||
    left.category.localeCompare(right.category) ||
    left.code.localeCompare(right.code)
  );
}

function healthSeverityRank(severity: DashboardFindingSeverity): number {
  switch (severity) {
    case "error":
      return 3;
    case "warning":
      return 2;
    case "info":
      return 1;
  }
}

function queueCount(queues: readonly GlobalWorkQueueView[], id: GlobalWorkQueueId): number {
  return queues.find((queue) => queue.id === id)?.count ?? 0;
}

function buildClaimCommand(projectRoot: string, workId: string, purpose: string): string {
  return `bwrk --workspace ${shellQuote(projectRoot)} work reserve ${shellQuote(workId)} --purpose ${shellQuote(purpose)} --json`;
}

function buildApplySetupCommand(project: GlobalSettingsProjectInput): string {
  return [
    "bwrk",
    "--workspace",
    shellQuote(project.projectRoot),
    "init",
    "--setup-memory",
    "--memory-root",
    shellQuote(project.memoryRoot),
    "--memory-layout",
    project.memoryLayout,
    "--memory-git-mode",
    project.memoryGitMode,
    ...(project.memoryGitMode === "submodule" && project.memoryRemote ? ["--memory-remote", shellQuote(project.memoryRemote)] : []),
    "--json"
  ].join(" ");
}

function shellQuote(value: string): string {
  return /^[A-Za-z0-9_./:@%+=,-]+$/.test(value) ? value : `'${value.replaceAll("'", "'\\''")}'`;
}

const WORK_QUEUE_DEFINITIONS: readonly {
  readonly id: WorkQueueId;
  readonly title: string;
  readonly statuses: readonly WorkItem["status"][];
}[] = [
  { id: "ready", title: "Ready", statuses: ["ready"] },
  { id: "blocked", title: "Blocked", statuses: ["blocked"] },
  { id: "in_progress", title: "In Progress", statuses: ["in_progress", "reserved"] },
  { id: "needs_verification", title: "Needs Verification", statuses: ["needs_verification"] },
  { id: "verified", title: "Verified", statuses: ["verified"] },
  { id: "closed", title: "Closed", statuses: ["closed", "cancelled"] }
];

const GLOBAL_WORK_QUEUE_DEFINITIONS: readonly {
  readonly id: GlobalWorkQueueId;
  readonly title: string;
  readonly status: WorkItem["status"];
}[] = [
  { id: "ready", title: "Ready to claim", status: "ready" },
  { id: "blocked", title: "Blocked", status: "blocked" },
  { id: "needs_verification", title: "Needs verification", status: "needs_verification" }
];

const GLOBAL_HEALTH_CATEGORY_DEFINITIONS: readonly {
  readonly category: GlobalHealthCategory;
  readonly title: string;
}[] = [
  { category: "sync", title: "Sync" },
  { category: "lock", title: "Locks" },
  { category: "search", title: "Search" },
  { category: "ledger", title: "Ledgers and snapshots" },
  { category: "setup", title: "Project setup" },
  { category: "registry", title: "Registry" },
  { category: "git", title: "Git" },
  { category: "vault", title: "Vault" },
  { category: "doctor", title: "Doctor" },
  { category: "other", title: "Other" }
];

const GLOBAL_SETTINGS_MEMORY_MODES: readonly GlobalSettingsMemoryModeOption[] = [
  {
    id: "separate",
    label: "Separate",
    description: "Memory keeps its own Git history while the project ignores child memory files or points at a sibling memory root.",
    risk: "Default for avoiding mixed project and memory history."
  },
  {
    id: "submodule",
    label: "Submodule",
    description: "Memory is a separate repository linked from the project through submodule metadata.",
    risk: "Requires a remote and clean submodule metadata before writes."
  },
  {
    id: "shared",
    label: "Shared",
    description: "Memory files are committed in the same project Git history as application code.",
    risk: "Use only when mixed project and memory history is intentional."
  }
];

const SPRINT_BOARD_LANE_DEFINITIONS: readonly {
  readonly id: SprintBoardLaneId;
  readonly title: string;
}[] = [
  { id: "draft", title: "Draft" },
  { id: "ready", title: "Ready" },
  { id: "blocked", title: "Blocked" },
  { id: "in_progress", title: "In Progress" },
  { id: "needs_verification", title: "Needs Verification" },
  { id: "verified", title: "Verified" },
  { id: "closed", title: "Closed" },
  { id: "cancelled", title: "Cancelled" }
];
