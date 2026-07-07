import { describe, expect, it } from "vitest";

import {
  createFixtureConsoleData,
  getSafeConsoleCommand,
  loadLiveConsoleData,
  renderConsoleHtml,
  runSafeConsoleCommand,
  safeConsoleCommandIds,
  type ConsoleCliRunner
} from "@boreal/console";

describe("console app runtime", () => {
  it("renders every console route with machine-readable state", () => {
    const data = createFixtureConsoleData({
      workspaceRoot: "/workspace/boreal-work",
      generatedAt: "2026-06-27T00:00:00.000Z"
    });

    for (const route of data.routes) {
      const html = renderConsoleHtml({ route: route.path, data });
      expect(html).toContain("Boreal Console");
      expect(html).toContain(`data-console-route="${route.id}"`);
      expect(html).toContain("boreal-console-state");
      expect(html).not.toContain("_owner");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("[object Object]");
    }
    expect(data.routes.map((route) => route.id)).toEqual([
      "overview",
      "sprint",
      "knowledge",
      "work",
      "reports",
      "repo",
      "health"
    ]);

    const tableHtml = renderConsoleHtml({ route: "/sprint?view=table&label=runtime", data });
    expect(tableHtml).toContain("data-console-route=\"sprint\"");
    expect(tableHtml).toContain("Dense sprint table");
    expect(tableHtml).toContain("href=\"/sprint?view=dependency&amp;label=runtime\"");
  });

  it("renders the global scope with only registry routes", () => {
    const data = createFixtureConsoleData({
      workspaceRoot: "/workspace/boreal-work",
      generatedAt: "2026-06-27T00:00:00.000Z",
      scope: "global"
    });
    expect(data.workspace.scope).toBe("global");
    expect(data.routes.map((route) => route.id)).toEqual(["global", "settings"]);
    const html = renderConsoleHtml({ route: "/", data });
    expect(html).toContain("Boreal Global");
    expect(html).toContain('data-console-scope="global"');
    expect(html).toContain("Global board");
    expect(html).toContain("Inbox rail");
    expect(html).toContain("Next rail");
  });

  it("provides fixture scenarios for stale, reservation, verification, and empty states", () => {
    const stale = createFixtureConsoleData({ workspaceRoot: "/workspace/boreal-work", scenario: "stale" });
    const reserved = createFixtureConsoleData({ workspaceRoot: "/workspace/boreal-work", scenario: "reservation" });
    const verification = createFixtureConsoleData({ workspaceRoot: "/workspace/boreal-work", scenario: "verification" });
    const empty = createFixtureConsoleData({ workspaceRoot: "/workspace/boreal-work", scenario: "empty" });

    expect(stale.workspace.stale).toBe(true);
    expect(stale.health.summary.warnings).toBeGreaterThan(0);
    expect(reserved.registry.summary.activeReservationCount).toBe(1);
    expect(verification.work.summary.needsVerification).toBeGreaterThan(0);
    expect(empty.work.summary.total).toBe(0);
  });

  it("renders stale and missing global board lanes from fixture rollups", () => {
    const data = createFixtureConsoleData({
      workspaceRoot: "/workspace/boreal-work",
      generatedAt: "2026-06-27T00:00:00.000Z",
      scenario: "stale",
      scope: "global"
    });
    const html = renderConsoleHtml({ route: "/", data });

    expect(data.globalBoard.summary.missingLanes).toBe(1);
    expect(data.globalBoard.summary.staleLanes).toBe(2);
    expect(data.globalBoard.lanes.find((lane) => lane.projectId === "missing-work")?.columns.map((column) => column.id)).toEqual([
      "draft",
      "ready",
      "in_progress",
      "blocked",
      "needs_verification",
      "verified",
      "closed"
    ]);
    expect(html).toContain("bw-global-board-lane--missing");
    expect(html).toContain("bw-global-board-lane--stale");
    expect(html).toContain("missing-work");
    expect(html).toContain("missing project, last seen 2026-06-01T00:00:00.000Z");
    expect(html).toContain("stale rollup from 2026-06-27T00:00:00.000Z");
  });

  it("loads live console data through the constrained CLI contract", async () => {
    const runner = fakeRunner();
    const data = await loadLiveConsoleData({ workspaceRoot: "/workspace/boreal-work", runner, scope: "global" });

    expect(data.workspace.mode).toBe("live");
    expect(data.sprint.sprint.id).toBe("bw_work_5d61b84c8d43c6a9");
    expect(data.sprint.sprint.directiveSummary).toMatchObject({
      total: 1,
      advisory: 1,
      acknowledgementCount: 1
    });
    expect(data.sprint.sprint.directiveSummary?.items[0]).toMatchObject({
      registryId: "workflow_next.canonical-next-step",
      sourceCommand: "bwrk work show bw_work_5d61b84c8d43c6a9 --json",
      acknowledgement: {
        requiredBefore: "continue",
        evidenceKind: "note",
        message: "Acknowledge the next workflow before acting."
      },
      relatedIds: ["bw_work_5d61b84c8d43c6a9"]
    });
    expect(data.sprint.summary.taskCount).toBeGreaterThan(0);
    expect(data.work.summary.ready).toBeGreaterThan(0);
    expect(data.globalQueues.summary.ready).toBeGreaterThan(1);
    expect(data.globalQueues.summary.blocked).toBeGreaterThan(0);
    expect(data.globalQueues.summary.needsVerification).toBeGreaterThan(0);
    expect(data.globalBoard.summary).toMatchObject({
      lanes: 2,
      ready: 2,
      blocked: 4,
      needsVerification: 1,
      next: 2
    });
    expect(data.globalBoard.rails.find((rail) => rail.id === "next")?.items.map((item) => item.projectName))
      .toEqual(expect.arrayContaining(["boreal-work", "other-work"]));
    expect(data.globalBoard.lanes.find((lane) => lane.projectId === "project_other_fixture")?.columns.map((column) => column.id)).toEqual([
      "draft",
      "ready",
      "in_progress",
      "blocked",
      "needs_verification",
      "verified",
      "closed"
    ]);
    expect(data.globalSearch.results[0]).toMatchObject({
      projectName: "boreal-work",
      sourceKind: "work"
    });
    expect(data.globalSearch.results.map((item) => item.projectId)).toContain("project_other_fixture");
    expect(data.globalActivity.summary).toMatchObject({
      human: 1,
      agent: 1,
      system: 1
    });
    expect(data.rawInbox.summary).toMatchObject({
      total: 2,
      queued: 1,
      linked: 1
    });
    expect(data.rawInbox.selected?.preview).toMatchObject({
      status: "truncated",
      mediaType: "text",
      truncated: true
    });
    expect(data.rawInbox.rows[0]?.retrievalCommand).toBe("bwrk raw show bw_source_thread --json");
    expect(data.rawInbox.ingestPlan?.mutations.map((mutation) => mutation.kind)).toEqual([
      "source",
      "wiki",
      "claim",
      "decision",
      "work"
    ]);
    expect(data.rawInbox.ingestPlan?.findings.map((finding) => finding.title)).toContain("Existing wiki link");
    expect(data.rawInbox.ingestPlan?.applyCommands.join("\n")).toContain("bwrk workflows show 20-memory/add-raw-source.md --json");
    expect(data.rawInbox.ingestPlan?.mutations.map((mutation) => mutation.workflowCommand)).toEqual(
      expect.arrayContaining(["bwrk workflows show 30-knowledge/create-wiki-page.md --json"])
    );
    expect(data.rawInbox.contradictionReview?.summary.total).toBeGreaterThan(0);
    expect(data.rawInbox.contradictionReview?.conflicts.flatMap((conflict) => conflict.resolutionCommands.map((command) => command.action)))
      .toEqual(expect.arrayContaining(["accept", "reject", "supersede"]));
    expect(data.rawInbox.contradictionReview?.conflicts.flatMap((conflict) => conflict.evidenceLinks.map((link) => link.ref)))
      .toContain("bw_source_thread");
    expect(data.memoryActions.summary).toMatchObject({
      total: 10,
      add: 4,
      update: 3,
      retrieve: 1,
      reconcile: 2
    });
    expect(data.memoryActions.actions.map((action) => action.skillRef)).toEqual(
      expect.arrayContaining(["$boreal-raw-inbox", "$boreal-memory-reconcile", "$boreal-wiki-claim-decision"])
    );
    expect(data.memoryActions.actions.every((action) => action.workflowCommand.startsWith("bwrk workflows show "))).toBe(true);
    expect(data.memoryActions.actions.map((action) => action.workflowPath)).toContain("20-memory/reconcile-raw-to-memory.md");
    expect(data.wikiExplorer.summary).toMatchObject({
      total: 2,
      accepted: 1,
      draft: 1,
      missingSources: 1
    });
    expect(data.wikiExplorer.rows.map((row) => row.truthStatus)).toEqual(["accepted", "draft"]);
    expect(data.wikiExplorer.selected).toMatchObject({
      title: "Runtime Hardening Notes",
      truthStatus: "accepted",
      sourceCoverageStatus: "covered",
      claimCount: 4,
      decisionCount: 4
    });
    expect(data.wikiExplorer.selected?.backlinks.map((page) => page.title)).toContain("Project Index");
    expect(data.wikiExplorer.selected?.outboundPages.map((page) => page.title)).toContain("CLI Hardening");
    expect(data.wikiExplorer.selected?.missingOutboundLinks).toContain("Missing Page");
    expect(data.wikiExplorer.selected?.sourceCoverage.runtimeSources.map((source) => source.id)).toContain("bw_source_runtime");
    expect(data.wikiExplorer.selected?.claims.map((claim) => claim.status)).toContain("accepted");
    expect(data.wikiExplorer.selected?.decisions.map((decision) => decision.title)).toContain("Keep raw previews read-only");
    expect(data.wikiExplorer.reviewSummary).toMatchObject({
      acceptedClaims: 1,
      proposedClaims: 1,
      rejectedClaims: 1,
      staleClaims: 1,
      acceptedDecisions: 1,
      proposedDecisions: 1,
      rejectedDecisions: 1,
      supersededDecisions: 1
    });
    expect(data.wikiExplorer.filters.claimStatuses).toEqual(["accepted", "proposed", "rejected", "stale"]);
    expect(data.wikiExplorer.filters.decisionStatuses).toEqual(["accepted", "proposed", "rejected", "superseded"]);
    expect(data.wikiExplorer.filters.sourceIds).toEqual(["bw_source_orphan", "bw_source_runtime", "bw_source_thread", "bw_source_uncovered"]);
    expect(data.wikiExplorer.healthSummary).toMatchObject({
      findings: 3,
      warnings: 2,
      dangers: 1,
      staleClaims: 1,
      orphanSources: 1,
      missingPageCoverage: 1
    });
    expect(data.wikiExplorer.healthFindings.map((finding) => finding.doctorCode)).toEqual(["vault.health", "vault.health", "vault.health"]);
    expect(data.wikiExplorer.healthFindings.map((finding) => finding.code)).toEqual(
      expect.arrayContaining(["vault.health.stale_assertion", "vault.health.orphan_source", "vault.health.missing_page_coverage"])
    );
    expect(data.wikiExplorer.healthFindings.map((finding) => finding.command)).toEqual(
      expect.arrayContaining([
        "bwrk claim show bw_claim_stale --json",
        "bwrk source show bw_source_orphan --json",
        "bwrk wiki show bw_page_draft --json"
      ])
    );
    expect(data.wikiExplorer.obsidian).toMatchObject({
      vaultName: "memory",
      obsidianUriAvailable: true,
      summary: {
        pages: 2,
        frontmatterComplete: 1,
        frontmatterPartial: 1,
        invalidPaths: 1
      }
    });
    expect(data.wikiExplorer.obsidian.pages.map((page) => page.obsidianUri)).toEqual(
      expect.arrayContaining([
        "obsidian://open?vault=memory&file=wiki%2Fruntime-hardening-notes.md"
      ])
    );
    expect(data.wikiExplorer.obsidian.dashboardLinks.map((link) => link.title)).toEqual(
      expect.arrayContaining(["Vault index", "Wiki index", "Work queue dashboard"])
    );
    expect(data.wikiExplorer.obsidian.invalidPathFindings[0]).toMatchObject({
      path: "memory/wiki",
      doctorCode: "vault.structure",
      command: "bwrk doctor --json"
    });
    expect(data.wikiExplorer.decisionTimeline.map((decision) => decision.context)).toContain("Keep raw previews read-only context");
    expect(data.wikiExplorer.decisionTimeline.flatMap((decision) => decision.consequences)).toContain("Fixture consequence.");
    expect(data.reports.summary.staticExportCount).toBe(4);
    expect(data.reports.staticExports.map((item) => item.command)).toEqual(
      expect.arrayContaining([
        "pnpm console:render -- --route /knowledge --mode live --out .boreal/results/console-knowledge.html",
        "pnpm bwrk export markdown --out .boreal/results/markdown-export --json"
      ])
    );
    expect(data.reports.knowledgeReport.summary).toMatchObject({
      rawSources: 2,
      wikiPages: 2,
      claims: 4,
      decisions: 4,
      healthFindings: 3
    });
    expect(data.reports.knowledgeReport.markdown).toContain("Knowledge Dashboard Static Report");
    expect(data.reports.knowledgeReport.markdown).toContain("vault.health.stale_assertion");
    expect(data.reports.warnings.join(" ")).toContain(".boreal/results");
    expect(data.globalHealth.summary).toMatchObject({
      warningProjects: 1,
      staleProjects: 1,
      ledgerFindings: expect.any(Number),
      searchFindings: expect.any(Number)
    });
    expect(data.globalHealth.findings.map((finding) => finding.projectRoot)).toContain("/workspace/other-work");
    expect(data.globalHealth.findings.map((finding) => finding.sourcePath)).toContain("/workspace/other-work/.boreal/ledgers");
    expect(data.globalHealth.findings.flatMap((finding) => finding.actions.map((action) => action.command))).toContain(
      "bwrk --workspace /workspace/other-work sync refresh --json"
    );
    expect(data.globalHealth.findings.flatMap((finding) => finding.actions).filter((action) => action.mutatesState))
      .toEqual(expect.arrayContaining([expect.objectContaining({ requiresConfirmation: true })]));
    expect(data.globalSettings.memoryModes.map((mode) => mode.id)).toEqual(["separate", "submodule", "shared"]);
    expect(data.globalSettings.projects.find((project) => project.projectId === "project_other_fixture")).toMatchObject({
      projectRoot: "/workspace/other-work",
      memoryGitMode: "separate",
      validateCommand: "bwrk --workspace /workspace/other-work doctor --json"
    });
    expect(data.globalSettings.projects.find((project) => project.projectId === "project_other_fixture")?.applySetupCommand)
      .toContain("--memory-root /workspace/other-work/memory");
    const readyQueue = data.globalQueues.queues.find((queue) => queue.id === "ready");
    expect(readyQueue?.items.filter((item) => item.work.id === "bw_work_534295e2daf65102").map((item) => item.projectId).sort()).toEqual([
      "project_boreal_fixture",
      "project_other_fixture"
    ]);
    expect(readyQueue?.items.find((item) => item.projectId === "project_other_fixture")?.claimCommand)
      .toContain("--workspace /workspace/other-work");
    expect(data.registry.entries[0]).toMatchObject({
      name: "boreal-work",
      syncFreshness: "fresh",
      openWorkCount: expect.any(Number),
      memoryGitMode: "separate"
    });
    expect(runner.calls).toContain("work list --label sprint-04 --limit 100 --json");
    expect(runner.calls).toContain("work list --limit 250 --json");
    expect(runner.calls).toContain("registry list --json");
    expect(runner.calls).toContain("registry doctor --json");
    expect(runner.calls).toContain("sync status --json");
    expect(runner.calls).toContain("raw list --limit 50 --json");
    expect(runner.calls).toContain("raw show bw_source_thread --preview-bytes 4096 --json");
    expect(runner.calls).toContain("wiki list --limit 100 --json");
    expect(runner.calls).toContain("wiki show bw_page_runtime --json");
    expect(runner.calls).toContain("source list --limit 100 --json");
    expect(runner.calls).toContain("claim list --limit 100 --json");
    expect(runner.calls).toContain("decision list --limit 100 --json");
    expect(runner.calls).toContain("--workspace /workspace/other-work work list --limit 250 --json");
    expect(runner.calls).toContain("--workspace /workspace/other-work reservation list --status active --json");
    expect(runner.calls).toContain("search query v1-remainder global dashboard registry --limit 10 --json");
    expect(runner.calls).toContain("--workspace /workspace/other-work search query v1-remainder global dashboard registry --limit 10 --json");
    expect(runner.calls).toContain("--workspace /workspace/other-work operation list --limit 20 --json");
  });

  it("rejects commands outside the explicit safe console boundary", async () => {
    const runner = fakeRunner();

    expect(getSafeConsoleCommand("unknown.command")).toBeUndefined();
    expect(getSafeConsoleCommand("work.claim")?.executable).toBe(false);
    expect(safeConsoleCommandIds()).toContain("sync.status");
    expect(safeConsoleCommandIds()).toContain("doctor.fix");
    expect(safeConsoleCommandIds()).toContain("work.release");
    expect(safeConsoleCommandIds()).toContain("work.create");
    expect(safeConsoleCommandIds()).toContain("sprint.start");
    await expect(runSafeConsoleCommand({ id: "work.claim", workspaceRoot: "/workspace/boreal-work", runner }))
      .rejects.toThrow("requires target input");
  });

  it("executes targeted work commands against the owning project workspace", async () => {
    const calls: string[] = [];
    const runner: ConsoleCliRunner = {
      async run(args) {
        calls.push(args.join(" "));
        return { ok: true };
      }
    };

    await runSafeConsoleCommand({
      id: "work.reserve",
      workspaceRoot: "/workspace/boreal-work",
      runner,
      params: new URLSearchParams({
        workId: "bw_work_ready",
        agentId: "console",
        purpose: "Console board drag",
        projectRoot: "/workspace/other-work"
      })
    });

    expect(calls).toEqual([
      "--workspace /workspace/other-work work reserve bw_work_ready --agent console --purpose Console board drag --json"
    ]);
    await expect(runSafeConsoleCommand({
      id: "work.release",
      workspaceRoot: "/workspace/boreal-work",
      runner,
      params: new URLSearchParams({
        workId: "bw_work_ready",
        projectRoot: "relative-workspace"
      })
    })).rejects.toThrow("projectRoot must be an absolute path");
  });
});

function fakeRunner(): ConsoleCliRunner & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(args) {
      calls.push(args.join(" "));
      const command = args.join(" ");
      if (command === "work list --label sprint-04 --limit 100 --json") {
        return [
          row("bw_work_5d61b84c8d43c6a9", "Sprint 04 - Client console app foundation", "blocked", ["sprint-04"]),
          row("bw_work_d09eca1501862185", "Phase 04A - Console package, routes, and build tooling", "blocked", ["sprint-04", "phase"]),
          row("bw_work_534295e2daf65102", "S04T01 - Scaffold apps/console package and workspace scripts", "ready", ["sprint-04", "task"]),
          row("bw_work_ac840c148254ac0c", "S04T02 - Implement the dashboard shell, sidebar, topbar, and route layout", "ready", ["sprint-04", "task"])
        ];
      }
      if (command === "work list --ready --label v1-remainder --limit 20 --json") {
        return [row("bw_work_534295e2daf65102", "S04T01 - Scaffold apps/console package and workspace scripts", "ready", ["sprint-04", "task"])];
      }
      if (command === "work list --limit 250 --json") {
        return [
          row("bw_work_5d61b84c8d43c6a9", "Sprint 04 - Client console app foundation", "blocked", ["sprint-04"]),
          row("bw_work_534295e2daf65102", "S04T01 - Scaffold apps/console package and workspace scripts", "ready", ["sprint-04", "task"]),
          row("bw_work_closed", "Closed fixture task", "closed", ["sprint-04", "task"])
        ];
      }
      if (command === "--workspace /workspace/other-work work list --limit 250 --json") {
        return [
          row("bw_work_534295e2daf65102", "Remote duplicate ready id", "ready", ["v1-remainder", "task"]),
          row("bw_work_remote_blocked", "Remote blocked task", "blocked", ["v1-remainder", "task"]),
          row("bw_work_remote_verify", "Remote verification task", "needs_verification", ["v1-remainder", "task"])
        ];
      }
      if (command.startsWith("work show ")) {
        const id = args[2] ?? "";
        const labels = id === "bw_work_5d61b84c8d43c6a9" ? ["sprint-04"] : id === "bw_work_d09eca1501862185" ? ["sprint-04", "phase"] : ["sprint-04", "task"];
        return {
          id,
          title: id === "bw_work_5d61b84c8d43c6a9" ? "Sprint 04 - Client console app foundation" : `Work ${id}`,
          kind: id === "bw_work_5d61b84c8d43c6a9" ? "sprint" : labels.includes("phase") ? "milestone" : "task",
          status: id.includes("534295") ? "ready" : "blocked",
          priority: "high",
          labels,
          dependencyIds: [],
          activeBlockerIds: [],
          blockedBy: [],
          evidenceCount: 0,
          verificationCount: 0,
          agentDirectives: agentDirectivesFor(id)
        };
      }
      if (command === "sync status --json") {
        return {
          ok: true,
          workspaceRoot: "/workspace/boreal-work",
          vault: { ok: true, rootDir: "/workspace/boreal-work/memory" },
          ledgers: { ok: true },
          searchIndex: { ok: true },
          git: { ok: true },
          recommendedActions: []
        };
      }
      if (command === "--workspace /workspace/other-work sync status --json") {
        return {
          ok: false,
          workspaceRoot: "/workspace/other-work",
          vault: { ok: true, rootDir: "/workspace/other-work/memory" },
          ledgers: { ok: false },
          searchIndex: { ok: false },
          git: { ok: true },
          recommendedActions: ["bwrk sync refresh --json"]
        };
      }
      if (command === "doctor --json") {
        return {
          ok: true,
          diagnostics: [
            { code: "lock.absent", severity: "ok", message: "No runtime state lock present" },
            {
              code: "vault.structure",
              severity: "ok",
              message: "Boreal memory vault structure is initialized",
              details: {
                invalidPaths: [
                  { path: "memory/wiki", kind: "directory", exists: true, valid: false }
                ]
              }
            }
          ]
        };
      }
      if (command === "--workspace /workspace/other-work doctor --json") {
        return {
          ok: false,
          diagnostics: [
            { code: "lock.absent", severity: "ok", message: "No runtime state lock present" },
            {
              code: "ledger.export_drift",
              severity: "warning",
              message: "JSONL ledger export is stale",
              details: {
                path: "/workspace/other-work/.boreal/ledgers",
                repairCommand: "bwrk sync refresh --json"
              }
            }
          ]
        };
      }
      if (command === "reservation list --status active --json") {
        return [];
      }
      if (command === "--workspace /workspace/other-work reservation list --status active --json") {
        return [];
      }
      if (command === "search query v1-remainder global dashboard registry --limit 10 --json") {
        return [
          searchResult("work:bw_work_1", "work", "bw_work_1", "Current project result", 20),
          searchResult("context_pack:bw_projection_1", "context_pack", "bw_projection_1", "Current context", 12)
        ];
      }
      if (command === "--workspace /workspace/other-work search query v1-remainder global dashboard registry --limit 10 --json") {
        return [
          searchResult("work:bw_work_remote", "work", "bw_work_remote", "Remote project result", 18)
        ];
      }
      if (command === "operation list --limit 20 --json") {
        return [
          operationRow("bw_operation_human", "work list", "cybertron", "human")
        ];
      }
      if (command === "raw list --limit 50 --json") {
        return [
          rawRow("bw_source_thread", "thread-export.txt", "chat", "memory/raw/thread-export.txt", "linked"),
          rawRow("bw_source_missing", "missing-asset.md", "document", "memory/raw/missing-asset.md", "queued")
        ];
      }
      if (command === "raw show bw_source_thread --preview-bytes 4096 --json") {
        return {
          ...rawRow("bw_source_thread", "thread-export.txt", "chat", "memory/raw/thread-export.txt", "linked"),
          linkedPages: [{ id: "bw_page_runtime", title: "Runtime Hardening Notes", path: "memory/wiki/runtime-hardening-notes.md" }],
          preview: {
            status: "truncated",
            mediaType: "text",
            message: "Preview truncated to 4096 of 9000 bytes.",
            uri: "memory/raw/thread-export.txt",
            path: "/workspace/boreal-work/memory/raw/thread-export.txt",
            body: "Decision: keep raw source rows immutable.",
            bytes: 4096,
            totalBytes: 9000,
            maxBytes: 4096,
            truncated: true
          }
        };
      }
      if (command === "wiki list --limit 100 --json") {
        return [
          wikiRow("bw_page_runtime", "runtime-hardening-notes", "Runtime Hardening Notes", "accepted", ["bw_source_thread"]),
          wikiRow("bw_page_draft", "draft-reconcile-notes", "Draft Reconcile Notes", "draft", ["bw_source_uncovered"])
        ];
      }
      if (command === "wiki show bw_page_runtime --json") {
        return {
          ...wikiRow("bw_page_runtime", "runtime-hardening-notes", "Runtime Hardening Notes", "accepted", ["bw_source_thread"]),
          backlinks: [wikiLinkedPage("bw_page_index", "project-index", "Project Index", "accepted")],
          outboundPages: [wikiLinkedPage("bw_page_cli", "cli-hardening", "CLI Hardening", "draft")],
          missingOutboundLinks: ["Missing Page"]
        };
      }
      if (command === "source list --limit 100 --json") {
        return [
          sourceRow("bw_source_runtime", "raw", "thread-export.txt", "memory/raw/thread-export.txt"),
          sourceRow("bw_source_orphan", "raw", "orphan-source.md", "memory/raw/orphan-source.md")
        ];
      }
      if (command === "claim list --limit 100 --json") {
        return [
          claimRow("bw_claim_runtime", "accepted", "Runtime source rows stay immutable.", ["bw_source_runtime"]),
          claimRow("bw_claim_proposed", "proposed", "Draft claim needs review.", ["bw_source_runtime"]),
          claimRow("bw_claim_rejected", "rejected", "Rejected duplicate claim.", ["bw_source_runtime"]),
          claimRow("bw_claim_stale", "stale", "Stale claim needs refresh.", ["bw_source_runtime"])
        ];
      }
      if (command === "decision list --limit 100 --json") {
        return [
          decisionRow("bw_decision_runtime", "accepted", "Keep raw previews read-only", "Raw preview commands do not mutate state.", ["bw_source_runtime"]),
          decisionRow("bw_decision_proposed", "proposed", "Promote reconciled source", "Reviewer must decide whether to promote it.", ["bw_source_runtime"]),
          decisionRow("bw_decision_rejected", "rejected", "Reject duplicate page", "Do not promote duplicate coverage.", ["bw_source_runtime"]),
          decisionRow("bw_decision_superseded", "superseded", "Old wiki organization", "Superseded by source-backed explorer.", ["bw_source_runtime"])
        ];
      }
      if (command === "--workspace /workspace/other-work operation list --limit 20 --json") {
        return [
          operationRow("bw_operation_agent", "agent start", "codex", "agent", true, true),
          operationRow("bw_operation_system", "sync refresh", "system", "system", false, true)
        ];
      }
      if (command === "registry list --json") {
        return {
          entries: [
            registryEntry("project_boreal_fixture", "boreal-work", "/workspace/boreal-work"),
            registryEntry("project_other_fixture", "other-work", "/workspace/other-work")
          ],
          entryCount: 2
        };
      }
      if (command === "registry doctor --json") {
        return {
          ok: true,
          entryCount: 2,
          findings: [
            { code: "registry.project_root", severity: "ok", message: "Project root exists", projectId: "project_boreal_fixture" },
            { code: "registry.project_root", severity: "ok", message: "Project root exists", projectId: "project_other_fixture" }
          ]
        };
      }
      throw new Error(`Unexpected command: ${command}`);
    }
  };
}

function row(id: string, title: string, status: string, labels: readonly string[]) {
  return { id, title, status, priority: "high", labels };
}

function agentDirectivesFor(subjectId: string) {
  return [
    {
      meta: {
        id: `bundle.work.show.${subjectId}`,
        commandPath: "work show"
      },
      directives: [
        {
          id: `directive.workflow_next.${subjectId}`,
          registryId: "workflow_next.canonical-next-step",
          family: "workflow_next",
          severity: "advisory",
          kind: "next_step",
          title: "Follow next canonical workflow",
          instruction: "Follow the named canonical workflow.",
          acknowledgement: {
            requiredBefore: "continue",
            evidenceKind: "note",
            message: "Acknowledge the next workflow before acting."
          },
          data: {
            commandPath: `bwrk work show ${subjectId} --json`,
            subjectId
          },
          subject: {
            type: "work",
            id: subjectId,
            title: `Work ${subjectId}`
          }
        }
      ],
      conflicts: [],
      deprecations: [],
      missingRequired: []
    }
  ];
}

function rawRow(id: string, title: string, kind: string, uri: string, processingStatus: "queued" | "linked" | "routed" | "kept_global" | "dropped") {
  return {
    id,
    title,
    kind,
    uri,
    summary: `${title} source summary`,
    tags: ["raw-inbox"],
    addedAt: "2026-06-27T00:00:00.000Z",
    actorId: "cybertron",
    contentHash: "sha256:fixture",
    sourceBacked: true,
    immutable: true,
    processingStatus,
    linkedPageCount: processingStatus === "linked" ? 1 : 0,
    retrievalCommand: `bwrk raw show ${id} --json`,
    previewCommand: `bwrk raw show ${id} --preview-bytes 4096 --json`
  };
}

function wikiRow(id: string, slug: string, title: string, truthStatus: string, sourceRefs: readonly string[]) {
  return {
    id,
    slug,
    title,
    path: `memory/wiki/${slug}.md`,
    sourceRefs,
    links: ["CLI Hardening", "Missing Page"],
    claimStatus: truthStatus === "draft" ? undefined : truthStatus,
    truthStatus,
    sourceRefCount: sourceRefs.length,
    outboundLinkCount: 2,
    backlinkCount: truthStatus === "accepted" ? 1 : 0,
    showCommand: `bwrk wiki show ${id} --json`
  };
}

function wikiLinkedPage(id: string, slug: string, title: string, truthStatus: string) {
  return {
    id,
    slug,
    title,
    path: `memory/wiki/${slug}.md`,
    truthStatus
  };
}

function sourceRow(id: string, kind: string, title: string, uri: string) {
  return { id, kind, title, uri };
}

function claimRow(id: string, status: string, statement: string, sourceIds: readonly string[]) {
  return {
    id,
    status,
    statement,
    sources: sourceIds.join(","),
    sourceIds,
    sourceCount: sourceIds.length,
    evidence: "bw_evidence_fixture",
    evidenceIds: ["bw_evidence_fixture"],
    evidenceCount: 1,
    reviewState: status === "proposed" ? "needs_review" : status === "stale" ? "needs_refresh" : status,
    updatedAt: "2026-06-27T00:00:00.000Z"
  };
}

function decisionRow(id: string, status: string, title: string, decision: string, sourceIds: readonly string[]) {
  return {
    id,
    status,
    title,
    context: `${title} context`,
    decision,
    consequences: ["Fixture consequence."],
    consequenceCount: 1,
    sources: sourceIds.join(","),
    sourceIds,
    sourceCount: sourceIds.length,
    reviewState: status === "proposed" ? "needs_review" : status,
    supersessionStatus: status === "superseded" ? "superseded" : "none",
    updatedAt: "2026-06-27T00:00:00.000Z"
  };
}

function registryEntry(id: string, name: string, projectRoot: string) {
  return {
    id,
    display: { name, labels: [] },
    projectRoot,
    borealDir: `${projectRoot}/.boreal`,
    runtimeDir: `${projectRoot}/.boreal/runtime`,
    runtimeStateFile: `${projectRoot}/.boreal/runtime/state.json`,
    projectConfigPath: `${projectRoot}/.boreal/project.json`,
    memoryRoot: `${projectRoot}/memory`,
    memoryBorealDir: `${projectRoot}/memory/.boreal`,
    memoryLayout: "in-repo",
    memoryGitMode: "separate",
    installRoot: projectRoot,
    skillTargets: {},
    folderScoped: false,
    source: "project-setup",
    addedAt: "2026-06-27T00:00:00.000Z",
    updatedAt: "2026-06-27T00:00:00.000Z",
    lastSeenAt: "2026-06-27T00:00:00.000Z"
  };
}

function searchResult(id: string, type: string, recordId: string, title: string, score: number) {
  return {
    id,
    type,
    recordId,
    title,
    summary: `${title} summary`,
    score,
    matches: ["global"]
  };
}

function operationRow(
  id: string,
  commandPath: string,
  actorId: string,
  actorKind: string,
  stateChanged = false,
  generatedArtifactsChanged = false
) {
  return {
    id,
    sessionId: "local",
    commandPath,
    status: "succeeded",
    exitCode: 0,
    stateChanged,
    generatedArtifactsChanged,
    actorId,
    actorKind,
    startedAt: "2026-06-27T00:00:00.000Z",
    finishedAt: "2026-06-27T00:00:01.000Z",
    eventCount: generatedArtifactsChanged ? 1 : 0
  };
}
