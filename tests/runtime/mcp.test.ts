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
    }
  };
}
