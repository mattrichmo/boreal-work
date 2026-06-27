import { describe, expect, it } from "vitest";

import {
  CONSOLE_CLI_CONTRACT_FIXTURE_OUTPUTS,
  CONSOLE_CLI_CONTRACT_VERSION,
  ConsoleCliContractError,
  loadLiveConsoleData,
  validateConsoleCliContract,
  type ConsoleCliRunner
} from "@boreal/console";

describe("console CLI contracts", () => {
  it("ships versioned fixture outputs for every console command schema", () => {
    expect(CONSOLE_CLI_CONTRACT_FIXTURE_OUTPUTS.contractVersion).toBe(CONSOLE_CLI_CONTRACT_VERSION);

    for (const [command, output] of Object.entries(CONSOLE_CLI_CONTRACT_FIXTURE_OUTPUTS.outputs)) {
      validateConsoleCliContract(command.split(" "), output);
    }
    validateConsoleCliContract(
      ["--workspace", "/workspace/boreal-work", "work", "list", "--limit", "250", "--json"],
      CONSOLE_CLI_CONTRACT_FIXTURE_OUTPUTS.outputs["work list --limit 250 --json"]
    );
    validateConsoleCliContract(
      ["--workspace", "/workspace/boreal-work", "registry", "doctor", "--json"],
      CONSOLE_CLI_CONTRACT_FIXTURE_OUTPUTS.outputs["registry doctor --json"]
    );
    validateConsoleCliContract(
      ["--workspace", "/workspace/boreal-work", "search", "query", "global", "--limit", "10", "--json"],
      CONSOLE_CLI_CONTRACT_FIXTURE_OUTPUTS.outputs["search query global --limit 10 --json"]
    );
    validateConsoleCliContract(
      ["--workspace", "/workspace/boreal-work", "operation", "list", "--limit", "20", "--json"],
      CONSOLE_CLI_CONTRACT_FIXTURE_OUTPUTS.outputs["operation list --limit 20 --json"]
    );
  });

  it("reports the changed command and schema when command output drifts", () => {
    expect(() => validateConsoleCliContract(
      ["sync", "status", "--json"],
      { ok: true, workspaceRoot: "/workspace/boreal-work", vault: { ok: true }, ledgers: {}, searchIndex: { ok: true }, git: { ok: true } }
    )).toThrowError(ConsoleCliContractError);

    try {
      validateConsoleCliContract(["work", "list", "--label", "sprint-04", "--limit", "100", "--json"], [{ title: "missing id" }]);
    } catch (error) {
      expect(error).toBeInstanceOf(ConsoleCliContractError);
      expect((error as ConsoleCliContractError).command).toBe("work list --label <label> --limit <n> --json");
      expect((error as ConsoleCliContractError).schema).toBe("work-list.v1");
      expect((error as ConsoleCliContractError).path).toBe("$[0].id");
      expect(error).toMatchObject({
        message: expect.stringContaining("work-list.v1")
      });
      return;
    }
    throw new Error("Expected work list contract failure");
  });

  it("rejects malformed live adapter data before building console views", async () => {
    const runner: ConsoleCliRunner = {
      async run(args) {
        const command = args.join(" ");
        if (command === "work list --label sprint-04 --limit 100 --json") {
          return [{ id: "bw_work_1", title: "Sprint", status: "ready", priority: "high", labels: ["sprint-04"] }];
        }
        if (command === "work list --ready --label v1-remainder --limit 20 --json") {
          return [];
        }
        if (command === "work list --limit 250 --json") {
          return [{ id: "bw_work_1", title: "Sprint", status: "ready", priority: "high", labels: ["sprint-04"] }];
        }
        if (command === "registry list --json") {
          return { entries: [], entryCount: 0 };
        }
        if (command === "registry doctor --json") {
          return { ok: true, entryCount: 0, findings: [{ code: "registry.empty", severity: "ok", message: "No registry" }] };
        }
        if (command === "sync status --json") {
          return { ok: true, workspaceRoot: "/workspace/boreal-work", vault: { ok: true }, ledgers: { ok: true }, searchIndex: { ok: true }, git: { ok: true } };
        }
        if (command === "doctor --json") {
          return { ok: true, diagnostics: "not-an-array" };
        }
        if (command === "reservation list --status active --json") {
          return [];
        }
        if (command === "work show bw_work_1 --json") {
          return { id: "bw_work_1", title: "Sprint", kind: "sprint", status: "ready", priority: "high", labels: [] };
        }
        throw new Error(`Unexpected command: ${command}`);
      }
    };

    await expect(loadLiveConsoleData({ workspaceRoot: "/workspace/boreal-work", runner }))
      .rejects.toMatchObject({
        command: "doctor --json",
        schema: "doctor-result.v1",
        path: "$.diagnostics"
      });
  });
});
