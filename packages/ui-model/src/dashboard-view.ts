import type { AgentReservation, WorkItem } from "@boreal/core";

import type { WorkItemView } from "./work-view.js";

export type WorkQueueId = "ready" | "blocked" | "in_progress" | "needs_verification" | "verified" | "closed";

export interface WorkQueueView {
  readonly id: WorkQueueId;
  readonly title: string;
  readonly items: readonly WorkItemView[];
  readonly count: number;
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
  readonly reservations?: readonly AgentReservation[];
  readonly labels?: readonly string[];
  readonly generatedAt?: string;
}): WorkDashboardView {
  const work = sortWork(input.work);
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

export function buildSprintBoardView(input: {
  readonly sprint: WorkItemView;
  readonly work: readonly WorkItemView[];
  readonly reservations?: readonly AgentReservation[];
  readonly generatedAt?: string;
}): SprintBoardView {
  const work = sortWork(input.work);
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
  reservations: readonly AgentReservation[]
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
