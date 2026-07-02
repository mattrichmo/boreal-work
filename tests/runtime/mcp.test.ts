import { describe, expect, it } from "vitest";

import {
  callBorealMcpTool,
  handleBorealMcpRequest,
  listBorealMcpTools,
  type BorealCliRunner
} from "@boreal/mcp";

const WORKSPACE = "/workspace/boreal-work";
const MEMORY = "/workspace/boreal-work/memory";

describe("boreal MCP server", () => {
  it("lists a bounded selected-project tool surface", () => {
    const tools = listBorealMcpTools();
    const names = tools.map((tool) => tool.name);

    expect(names).toContain("boreal_command_catalog");
    expect(names).toContain("boreal_workspace_status");
    expect(names).toContain("boreal_directives_current");
    expect(names).toContain("boreal_directives_compile");
    expect(names).toContain("boreal_directives_explain");
    expect(names).toContain("boreal_work_next");
    expect(names).toContain("boreal_work_claim");
    expect(names).toContain("boreal_sync_refresh");
    expect(tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
  });

  it("runs read-only tools through selected workspace CLI contracts", async () => {
    const runner = fakeRunner({
      "--workspace /workspace/boreal-work work next --label v1-remainder --limit 100 --json": [
        {
          id: "bw_work_ready",
          status: "ready",
          priority: "high",
          title: "Ready work",
          labels: ["v1-remainder"]
        }
      ]
    });

    const result = await callBorealMcpTool(
      "boreal_work_next",
      { workspaceRoot: WORKSPACE, memoryRoot: MEMORY, label: "v1-remainder", limit: 999 },
      { runner }
    );
    const payload = result.structuredContent as {
      readonly contract: { readonly readOnly: boolean };
      readonly result: readonly [{ readonly id: string }];
    };

    expect(result.isError).toBeUndefined();
    expect(payload.contract.readOnly).toBe(true);
    expect(payload.result[0].id).toBe("bw_work_ready");
    expect(runner.calls).toEqual(["--workspace /workspace/boreal-work work next --label v1-remainder --limit 100 --json"]);
  });

  it("returns current work directive envelopes with conflict and missing-required summaries", async () => {
    const runner = fakeRunner({
      "--workspace /workspace/boreal-work work show bw_work_blocked --json": {
        ok: true,
        data: {
          id: "bw_work_blocked",
          kind: "task",
          title: "Blocked work",
          status: "blocked"
        },
        agentDirectives: [
          {
            meta: {
              schemaVersion: "boreal.agent-directives.v1",
              registryVersion: "directives.v1",
              generatedAt: "2026-01-01T00:00:00.000Z",
              commandPath: "work show"
            },
            directives: [
              {
                id: "directive.blocked.resolve-blockers.fixture",
                registryId: "blocked.resolve-blockers",
                version: "v1",
                family: "blocked",
                severity: "blocking",
                audience: "agent",
                kind: "recovery",
                title: "Resolve active blockers",
                instruction: "Stop until blockers are resolved.",
                triggerCodes: ["work.blocked.open-dependency"],
                nextCommandTemplate: "bwrk dep tree <subjectId> --json",
                data: { blockerIds: ["bw_work_blocker"] },
                source: {
                  registryVersion: "directives.v1",
                  registryPath: "packages/core/src/agent-directive-registry.ts",
                  selectedBy: ["gap.work.blocked.open-dependency"]
                },
                subject: {
                  type: "work",
                  id: "bw_work_blocked",
                  title: "Blocked work"
                },
                supersedes: []
              },
              {
                id: "directive.workflow_next.fixture",
                registryId: "workflow_next.canonical-next-step",
                version: "v1",
                family: "workflow_next",
                severity: "advisory",
                audience: "agent",
                kind: "next_step",
                title: "Follow next canonical workflow",
                instruction: "Follow the canonical next workflow after blockers are resolved.",
                triggerCodes: ["directive.workflow-next.available"],
                nextCommandTemplate: "<workflow-recommended-command>",
                data: {
                  workflowRef: "workflows/40-work/link-dependencies.md",
                  commandPath: "bwrk dep tree bw_work_blocked --json",
                  requiredInputs: ["work", "command", "actor"]
                },
                source: {
                  registryVersion: "directives.v1",
                  registryPath: "packages/core/src/agent-directive-registry.ts",
                  selectedBy: ["gap.directive.workflow-next.available"]
                },
                subject: {
                  type: "work",
                  id: "bw_work_blocked",
                  title: "Blocked work"
                },
                supersedes: []
              }
            ],
            conflicts: [
              {
                directiveIds: ["directive.blocked.resolve-blockers.fixture", "directive.workflow_next.fixture"],
                reason: "Blocking directive wins.",
                resolution: "blocking_wins",
                resolvedDirectiveId: "directive.blocked.resolve-blockers.fixture",
                severity: "blocking"
              }
            ],
            deprecations: [],
            missingRequired: [
              {
                registryId: "closeout.summary-required",
                requirement: "summary.latestSummaryId",
                message: "Summary data is required."
              }
            ]
          }
        ]
      }
    });

    const result = await callBorealMcpTool(
      "boreal_directives_current",
      { workspaceRoot: WORKSPACE, memoryRoot: MEMORY, workId: "bw_work_blocked" },
      { runner }
    );
    const payload = result.structuredContent as {
      readonly result: {
        readonly result: { readonly id: string };
        readonly summary: {
          readonly directiveCount: number;
          readonly blockingCount: number;
          readonly conflictCount: number;
          readonly missingRequiredCount: number;
          readonly missingRequiredRegistryIds: readonly string[];
          readonly registryIds: readonly string[];
        };
        readonly agentDirectives: readonly {
          readonly directives: readonly { readonly registryId: string; readonly lifecycle: string }[];
        }[];
      };
    };

    expect(result.isError).toBeUndefined();
    expect(payload.result.result.id).toBe("bw_work_blocked");
    expect(payload.result.agentDirectives.length).toBe(1);
    expect(payload.result.summary).toEqual(
      expect.objectContaining({
        directiveCount: 2,
        advisoryCount: 1,
        blockingCount: 1,
        conflictCount: 1,
        missingRequiredCount: 1,
        registryIds: ["blocked.resolve-blockers", "workflow_next.canonical-next-step"],
        missingRequiredRegistryIds: ["closeout.summary-required"]
      })
    );
    expect(payload.result.agentDirectives[0]?.directives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ registryId: "workflow_next.canonical-next-step", severity: "advisory" })
      ])
    );
  });

  it("fails current directive requests with a missing subject before CLI execution", async () => {
    const runner = fakeRunner({});
    const result = await callBorealMcpTool(
      "boreal_directives_current",
      { workspaceRoot: WORKSPACE, memoryRoot: MEMORY },
      { runner }
    );
    const payload = result.structuredContent as { readonly code: string; readonly details?: { readonly name?: string } };

    expect(result.isError).toBe(true);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
    expect(payload.details?.name).toBe("workId");
    expect(runner.calls).toEqual([]);
  });

  it("wraps directive compile and explain CLI commands for MCP clients", async () => {
    const runner = fakeRunner({
      "--workspace /workspace/boreal-work directives compile --command work show --subject-type work --subject-id bw_work_blocked --status blocked --active-blocker bw_work_blocker --json": {
        schemaVersion: "boreal.cli.directives.compile.v1",
        commandPath: "work show",
        selectedRegistryIds: ["blocked.resolve-blockers"],
        missingRequired: [],
        bundle: {
          directives: [{ registryId: "blocked.resolve-blockers" }],
          conflicts: [{ severity: "blocking" }]
        }
      },
      "--workspace /workspace/boreal-work directives explain blocked.resolve-blockers --fixture blocked-work --json": {
        schemaVersion: "boreal.cli.directives.explain.v1",
        directiveId: "blocked.resolve-blockers",
        selected: true,
        emitted: true,
        reason: "emitted with conflict resolution metadata",
        conflicts: [{ severity: "blocking" }],
        missingRequired: []
      }
    });

    const compiled = await callBorealMcpTool(
      "boreal_directives_compile",
      {
        workspaceRoot: WORKSPACE,
        memoryRoot: MEMORY,
        commandPath: "work show",
        subjectType: "work",
        subjectId: "bw_work_blocked",
        status: "blocked",
        activeBlockers: ["bw_work_blocker"]
      },
      { runner }
    );
    const compilePayload = compiled.structuredContent as {
      readonly result: { readonly bundle: { readonly conflicts: readonly unknown[] } };
    };

    const explained = await callBorealMcpTool(
      "boreal_directives_explain",
      {
        workspaceRoot: WORKSPACE,
        memoryRoot: MEMORY,
        directiveId: "blocked.resolve-blockers",
        fixture: "blocked-work"
      },
      { runner }
    );
    const explainPayload = explained.structuredContent as {
      readonly result: { readonly emitted: boolean; readonly reason: string };
    };

    expect(compiled.isError).toBeUndefined();
    expect(compilePayload.result.bundle.conflicts.length).toBe(1);
    expect(explained.isError).toBeUndefined();
    expect(explainPayload.result.emitted).toBe(true);
    expect(explainPayload.result.reason).toBe("emitted with conflict resolution metadata");
  });

  it("passes stale registry directive compile diagnostics through MCP unchanged", async () => {
    const runner = fakeRunner({
      "--workspace /workspace/boreal-work directives compile --fixture blocked-work --json": {
        schemaVersion: "boreal.cli.directives.compile.v1",
        commandPath: "work show",
        selectedRegistryIds: ["blocked.resolve-blockers"],
        issues: [
          {
            kind: "stale_registry_version",
            path: "$.meta.registryVersion",
            message: "must be current registry version directives.v1"
          }
        ],
        missingRequired: [],
        bundle: {
          directives: [],
          conflicts: []
        }
      }
    });

    const result = await callBorealMcpTool(
      "boreal_directives_compile",
      { workspaceRoot: WORKSPACE, memoryRoot: MEMORY, fixture: "blocked-work" },
      { runner }
    );
    const payload = result.structuredContent as {
      readonly result: { readonly issues: readonly [{ readonly kind: string; readonly path: string }] };
    };

    expect(result.isError).toBeUndefined();
    expect(payload.result.issues).toEqual([
      expect.objectContaining({ kind: "stale_registry_version", path: "$.meta.registryVersion" })
    ]);
    expect(runner.calls).toEqual(["--workspace /workspace/boreal-work directives compile --fixture blocked-work --json"]);
  });

  it("fails closed before CLI execution when project selection crosses registry roots", async () => {
    const runner = fakeRunner({});
    const result = await callBorealMcpTool(
      "boreal_command_catalog",
      {
        workspaceRoot: WORKSPACE,
        memoryRoot: MEMORY,
        selectedProjectId: "project-other",
        registryEntries: [
          {
            id: "project-other",
            projectRoot: "/workspace/other",
            memoryRoot: "/workspace/other/memory",
            memoryLayout: "in-repo"
          }
        ]
      },
      { runner }
    );
    const payload = result.structuredContent as { readonly code: string };

    expect(result.isError).toBe(true);
    expect(payload.code).toBe("BOREAL_INVALID_INPUT");
    expect(runner.calls).toEqual([]);
  });

  it("requires confirmation for mutating tools and returns operation evidence when confirmed", async () => {
    const runner = fakeRunner({
      "--workspace /workspace/boreal-work --session mcp-test work claim --agent codex --label v1-remainder --purpose hardening --ttl 2h --json": {
        claimed: true,
        work: { id: "bw_work_ready" }
      },
      "--workspace /workspace/boreal-work operation list --session-id mcp-test --limit 1 --json": [
        {
          id: "bw_operation_audit",
          sessionId: "mcp-test",
          commandPath: "work claim",
          status: "succeeded",
          exitCode: 0,
          stateChanged: true,
          generatedArtifactsChanged: false,
          eventCount: 2
        }
      ]
    });

    const blocked = await callBorealMcpTool(
      "boreal_work_claim",
      { workspaceRoot: WORKSPACE, memoryRoot: MEMORY, agentId: "codex", label: "v1-remainder" },
      { runner }
    );
    expect(blocked.isError).toBe(true);
    expect(runner.calls).toEqual([]);

    const confirmed = await callBorealMcpTool(
      "boreal_work_claim",
      {
        workspaceRoot: WORKSPACE,
        memoryRoot: MEMORY,
        confirmed: true,
        agentId: "codex",
        label: "v1-remainder",
        purpose: "hardening",
        ttl: "2h"
      },
      { runner, sessionIdFactory: () => "mcp-test" }
    );
    const payload = confirmed.structuredContent as {
      readonly operationId: string;
      readonly contract: {
        readonly requiresConfirmation: boolean;
        readonly returnsOperationId: boolean;
        readonly commandPreview?: { readonly argv: readonly string[] };
      };
    };

    expect(confirmed.isError).toBeUndefined();
    expect(payload.operationId).toBe("bw_operation_audit");
    expect(payload.contract.requiresConfirmation).toBe(true);
    expect(payload.contract.returnsOperationId).toBe(true);
    expect(payload.contract.commandPreview?.argv).toEqual([
      "bwrk",
      "--workspace",
      WORKSPACE,
      "--session",
      "mcp-test",
      "work",
      "claim",
      "--agent",
      "codex",
      "--label",
      "v1-remainder",
      "--purpose",
      "hardening",
      "--ttl",
      "2h",
      "--json"
    ]);
  });

  it("serves initialize, tools/list, and tools/call JSON-RPC requests", async () => {
    const runner = fakeRunner({
      "--workspace /workspace/boreal-work commands --json": [
        {
          path: ["work", "list"],
          summary: "List work"
        }
      ]
    });

    const initialized = await handleBorealMcpRequest({ jsonrpc: "2.0", id: 1, method: "initialize" }, { runner });
    expect(initialized?.result).toEqual(
      expect.objectContaining({
        capabilities: { tools: {} },
        serverInfo: expect.objectContaining({ name: "boreal-work-mcp" })
      })
    );

    const listed = await handleBorealMcpRequest({ jsonrpc: "2.0", id: 2, method: "tools/list" }, { runner });
    expect((listed?.result as { readonly tools: readonly unknown[] }).tools.length).toBeGreaterThan(0);

    const called = await handleBorealMcpRequest(
      {
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: {
          name: "boreal_command_catalog",
          arguments: { workspaceRoot: WORKSPACE, memoryRoot: MEMORY }
        }
      },
      { runner }
    );
    expect(called?.error).toBeUndefined();
    expect(called?.result).toEqual(expect.objectContaining({ content: expect.any(Array) }));
  });
});

function fakeRunner(responses: Readonly<Record<string, unknown>>): BorealCliRunner & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(args) {
      const key = args.join(" ");
      calls.push(key);
      if (!(key in responses)) {
        throw new Error(`Unexpected MCP CLI call: ${key}`);
      }
      return responses[key];
    },
    async runEnvelope(args) {
      const key = args.join(" ");
      calls.push(key);
      if (!(key in responses)) {
        throw new Error(`Unexpected MCP CLI envelope call: ${key}`);
      }
      return responses[key] as Awaited<ReturnType<NonNullable<BorealCliRunner["runEnvelope"]>>>;
    }
  };
}
