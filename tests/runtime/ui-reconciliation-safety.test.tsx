import { describe, expect, it } from "vitest";

import type { WorkItemView } from "@boreal/ui-model";
import { createFixtureConsoleData, renderConsoleHtml } from "@boreal/console";
import { reconciliationStatusForWork as consoleReconciliationStatusForWork } from "../../apps/console/src/app/reconciliation.js";
import { loadRepoRollup } from "../../apps/tui/src/loaders.js";
import { reconciliationStatusForWork as tuiReconciliationStatusForWork } from "../../apps/tui/src/reconciliation.js";

function work(input: Partial<WorkItemView> = {}): WorkItemView {
  return {
    id: "bw_ui_safety_work",
    title: "UI safety fixture",
    kind: "task",
    status: "needs_verification",
    priority: "normal",
    labels: [],
    dependencyIds: [],
    activeBlockerIds: ["finding-1"],
    blockedBy: ["finding-1"],
    evidenceCount: 2,
    verificationCount: 1,
    requiredCloseoutGates: [],
    ...input
  };
}

describe("bounded reconciliation-first UI slice", () => {
  it("makes stale browser route actions non-actionable and shows the reconciliation chain", () => {
    const data = createFixtureConsoleData({ workspaceRoot: "/workspace/boreal-work", scenario: "stale" });
    const html = renderConsoleHtml({ route: "/sprint", data });

    expect(html).toContain('data-bw-actions-blocked="true"');
    expect(html).toContain("Read-only until refreshed");
    expect(html).toContain("Reconciliation");
    expect(html).toContain("Resolve / update");
    expect(html).toContain("Revalidate");
    expect(html).toContain("Refresh before taking any state-changing action");
  });

  it("does not render a fallback route with actions for an unsupported browser path", () => {
    const data = createFixtureConsoleData({ workspaceRoot: "/workspace/boreal-work" });
    const html = renderConsoleHtml({ route: "/not-a-console-route", data });

    expect(html).toContain("Unsupported route");
    expect(html).toContain("No console view is registered");
    expect(html).not.toContain("data-bw-actions-blocked=\"false\"");
    expect(html).not.toContain('action="/api/commands/work.close"');
  });

  it("derives the same honest five-step status in browser and TUI helpers", () => {
    const fixture = work();
    const consoleStatus = consoleReconciliationStatusForWork(fixture);
    const tuiStatus = tuiReconciliationStatusForWork(fixture);

    expect(consoleStatus.steps.map((step) => step.label)).toEqual([
      "Review findings",
      "Resolve / update",
      "Revalidate",
      "Reconcile",
      "Advance"
    ]);
    expect(consoleStatus.overall).toBe("blocked");
    expect(consoleStatus.steps.find((step) => step.id === "revalidate")?.status).toBe("pending");
    expect(tuiStatus.overall).toBe(consoleStatus.overall);
    expect(tuiStatus.steps.map((step) => step.status)).toEqual(consoleStatus.steps.map((step) => step.status));
  });

  it("keeps verified work blocked when a persisted reconciliation obligation is still open", () => {
    const fixture = work({
      status: "verified",
      activeBlockerIds: [],
      blockedBy: [],
      evidenceCount: 1,
      verificationCount: 1,
      reconciliationObligations: [{
        id: "bw_obligation_ui_safety",
        findingId: "finding-ui-safety",
        subjectScope: { subjectType: "work", subjectId: "bw_ui_safety_work" },
        requiredChanges: [{ kind: "code", description: "Update the affected UI" }],
        revalidationCommand: "pnpm test -- ui-reconciliation-safety",
        reconciliationInputs: { generation: "one" },
        status: "open",
        unlocks: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        createdBy: { id: "ui-test", kind: "agent" },
        updatedBy: { id: "ui-test", kind: "agent" }
      }]
    });

    const consoleStatus = consoleReconciliationStatusForWork(fixture);
    const tuiStatus = tuiReconciliationStatusForWork(fixture);
    expect(consoleStatus.overall).toBe("blocked");
    expect(consoleStatus.steps.find((step) => step.id === "advance")?.status).toBe("blocked");
    expect(tuiStatus.steps.find((step) => step.id === "advance")?.status).toBe("blocked");
  });

  it("marks an uninitialized TUI route stale so its actions cannot be run", async () => {
    const envelope = await loadRepoRollup("/tmp/boreal-ui-safety-missing-workspace");

    expect(envelope.stale).toBe(true);
    expect(envelope.warnings[0]).toContain("Workspace is not set up");
  });
});
