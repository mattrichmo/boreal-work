import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  Button,
  DashboardHealthPanel,
  EntityDetailHeader,
  GlobalOverviewMetrics,
  SprintKanbanBoard,
  WorkItemDetailPage,
  type ReferenceItem
} from "@boreal/console";
import type { DashboardHealthView, ProjectRegistryView, SprintBoardView, WorkItemView } from "@boreal/ui-model";

describe("console component exports", () => {
  it("renders foundation primitives with stable classes", () => {
    const html = renderToStaticMarkup(<Button variant="primary">Claim</Button>);

    expect(html).toContain("bw-button");
    expect(html).toContain("Claim");
  });

  it("renders entity primitives from typed data", () => {
    const refs: readonly ReferenceItem[] = [{ id: "src-1", kind: "raw", label: "thread.txt", status: "ok" }];
    const html = renderToStaticMarkup(
      <>
        <EntityDetailHeader title="Evidence gate" kind="work" status="ready" labels={["sprint-03"]} />
        <WorkItemDetailPage work={workItem({ id: "bw_work_1", title: "Evidence gate" })} />
        <span>{refs[0]?.label}</span>
      </>
    );

    expect(html).toContain("bw-entity-header");
    expect(html).toContain("Evidence gate");
    expect(html).toContain("thread.txt");
  });

  it("renders sprint, global, and operations dashboard primitives", () => {
    const board = sprintBoardView();
    const registry = registryView();
    const health = healthView();
    const html = renderToStaticMarkup(
      <>
        <SprintKanbanBoard view={board} />
        <GlobalOverviewMetrics view={registry} />
        <DashboardHealthPanel view={health} />
      </>
    );

    expect(html).toContain("bw-kanban");
    expect(html).toContain("Projects");
    expect(html).toContain("Doctor");
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
    ...input
  };
}

function sprintBoardView(): SprintBoardView {
  const sprint = workItem({ id: "bw_work_sprint", kind: "sprint", title: "Sprint 03" });
  const task = workItem({ id: "bw_work_task", title: "Convert components" });
  return {
    sprint,
    phases: [],
    lanes: [
      { id: "ready", title: "Ready", count: 1, items: [task] },
      { id: "closed", title: "Closed", count: 0, items: [] }
    ],
    summary: {
      sprintId: sprint.id,
      total: 1,
      ready: 1,
      blocked: 0,
      inProgress: 0,
      needsVerification: 0,
      verified: 0,
      closed: 0,
      activeReservations: 0,
      expiredReservations: 0,
      phaseCount: 0,
      taskCount: 1,
      activeBlockerCount: 0
    }
  };
}

function registryView(): ProjectRegistryView {
  return {
    entries: [],
    summary: {
      totalProjects: 2,
      healthyProjects: 2,
      warningProjects: 0,
      errorProjects: 0,
      missingProjects: 0,
      readyWorkCount: 1,
      blockedWorkCount: 0,
      activeReservationCount: 0
    }
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
