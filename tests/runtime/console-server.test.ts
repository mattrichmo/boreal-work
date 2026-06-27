import { describe, expect, it } from "vitest";

import { ConsoleCommandError, type ConsoleCliRunner } from "@boreal/console";
import { listenConsole } from "@boreal/console/server";

describe("console server", () => {
  it("serves console routes and state without a global install", async () => {
    const running = await listenConsole({
      workspaceRoot: "/workspace/boreal-work",
      mode: "fixture",
      port: 0
    });
    try {
      for (const route of ["/", "/sprint", "/knowledge", "/repo", "/reports", "/settings", "/work", "/health"]) {
        const response = await fetch(`${running.url}${route}`);
        const html = await response.text();

        expect(response.status).toBe(200);
        expect(html).toContain("Boreal Console");
        expect(html).toContain("data-console-route");
      }

      const state = await fetch(`${running.url}/api/state`);
      const payload = await state.json() as { readonly workspace?: { readonly mode?: string } };

      expect(state.status).toBe(200);
      expect(payload.workspace?.mode).toBe("fixture");

      const unconfirmed = await fetch(`${running.url}/api/commands/sync.refresh`, { method: "POST" });
      const unconfirmedPayload = await unconfirmed.json() as { readonly error?: { readonly code?: string } };
      expect(unconfirmed.status).toBe(200);
      expect(unconfirmedPayload.error?.code).toBe("CONSOLE_COMMAND_CONFIRMATION_REQUIRED");

      const unknown = await fetch(`${running.url}/api/commands/unknown`, { method: "POST" });
      const unknownPayload = await unknown.json() as { readonly error?: { readonly code?: string; readonly message?: string } };
      expect(unknown.status).toBe(500);
      expect(unknownPayload.error?.code).toBe("CONSOLE_COMMAND_NOT_ALLOWED");
      expect(unknownPayload.error?.message).not.toContain("at ");
    } finally {
      await running.close();
    }
  });

  it("guards project settings writes with confirmation and doctor validation", async () => {
    const runner = settingsRunner();
    const running = await listenConsole({
      workspaceRoot: "/workspace/boreal-work",
      mode: "fixture",
      port: 0,
      runner
    });
    try {
      const unconfirmed = await fetch(`${running.url}/api/settings/projects/add`, {
        method: "POST",
        body: new URLSearchParams({ projectRoot: "/workspace/other-work" })
      });
      const unconfirmedPayload = await unconfirmed.json() as { readonly error?: { readonly code?: string } };
      expect(unconfirmedPayload.error?.code).toBe("CONSOLE_COMMAND_CONFIRMATION_REQUIRED");

      const added = await fetch(`${running.url}/api/settings/projects/add`, {
        method: "POST",
        body: new URLSearchParams({ projectRoot: "/workspace/other-work", confirm: "yes" })
      });
      const addedPayload = await added.json() as { readonly ok?: boolean };
      expect(added.status).toBe(200);
      expect(addedPayload.ok).toBe(true);
      expect(runner.calls).toEqual([
        "--workspace /workspace/other-work doctor --json",
        "registry add --workspace /workspace/other-work --json"
      ]);
    } finally {
      await running.close();
    }
  });

  it("executes targeted sprint command actions with confirmation and return redirects", async () => {
    const runner = actionRunner();
    const running = await listenConsole({
      workspaceRoot: "/workspace/boreal-work",
      mode: "fixture",
      port: 0,
      runner
    });
    const returnTo = "/sprint?view=kanban&label=runtime";
    const cases = [
      {
        id: "work.reserve",
        body: {
          workId: "bw_work_ready",
          agentId: "cybertron",
          ttl: "2h",
          purpose: "Claim from test"
        },
        expected: "work reserve bw_work_ready --agent cybertron --purpose Claim from test --ttl 2h --json"
      },
      {
        id: "work.release",
        body: { workId: "bw_work_ready" },
        expected: "work release bw_work_ready --json"
      },
      {
        id: "work.renew",
        body: { workId: "bw_work_ready", ttl: "2h" },
        expected: "work renew bw_work_ready --ttl 2h --json"
      },
      {
        id: "work.verify",
        body: {
          workId: "bw_work_ready",
          evidenceId: "bw_evidence_1",
          verdict: "passed",
          notes: "verified from console"
        },
        expected: "work verify bw_work_ready --evidence bw_evidence_1 --verdict passed --notes verified from console --json"
      },
      {
        id: "work.close",
        body: { workId: "bw_work_ready", reason: "done" },
        expected: "work close bw_work_ready --reason done --json"
      },
      {
        id: "work.create",
        body: {
          title: "Promoted discovery",
          description: "Keep source context",
          kind: "task",
          priority: "high",
          label: "discovery",
          acceptance: "Source context is preserved.",
          sourceRef: "raw:bw_raw_1",
          ready: "yes"
        },
        expected: "work create Promoted discovery --kind task --priority high --description Keep source context --label discovery --acceptance Source context is preserved. --source raw:bw_raw_1 --ready --json"
      },
      {
        id: "sync.refresh",
        body: {},
        expected: "sync refresh --json"
      }
    ] as const;

    try {
      for (const entry of cases) {
        const response = await fetch(`${running.url}/api/commands/${entry.id}`, {
          method: "POST",
          body: new URLSearchParams({ ...entry.body, confirm: "yes", returnTo }),
          redirect: "manual"
        });

        expect(response.status).toBe(303);
        expect(response.headers.get("location")).toBe(returnTo);
      }

      expect(runner.calls).toEqual(cases.map((entry) => entry.expected));
    } finally {
      await running.close();
    }
  });

  it("returns CLI failure code, details, and recovery actions for sprint commands", async () => {
    const runner = failingActionRunner();
    const running = await listenConsole({
      workspaceRoot: "/workspace/boreal-work",
      mode: "fixture",
      port: 0,
      runner
    });
    try {
      const response = await fetch(`${running.url}/api/commands/work.release`, {
        method: "POST",
        body: new URLSearchParams({ workId: "bw_work_ready", confirm: "yes" })
      });
      const payload = await response.json() as {
        readonly error?: {
          readonly code?: string;
          readonly message?: string;
          readonly details?: Record<string, unknown>;
          readonly recovery?: readonly { readonly command?: string }[];
        };
      };
      const recoveryCommands = payload.error?.recovery?.map((action) => action.command) ?? [];

      expect(response.status).toBe(500);
      expect(payload.error).toMatchObject({
        code: "BOREAL_RESERVATION_CONFLICT",
        message: "No active reservation",
        details: { workId: "bw_work_ready" }
      });
      expect(recoveryCommands).toContain("bwrk work show bw_work_ready --json");
      expect(recoveryCommands).toContain("bwrk sync refresh --json");
      expect(recoveryCommands).toContain("bwrk doctor --json");
    } finally {
      await running.close();
    }
  });
});

function settingsRunner(): ConsoleCliRunner & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(args) {
      const command = args.join(" ");
      calls.push(command);
      if (command === "--workspace /workspace/other-work doctor --json") {
        return { ok: true, diagnostics: [] };
      }
      if (command === "registry add --workspace /workspace/other-work --json") {
        return { added: true, entry: { id: "project_other_fixture" } };
      }
      throw new Error(`Unexpected command: ${command}`);
    }
  };
}

function actionRunner(): ConsoleCliRunner & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(args) {
      calls.push(args.join(" "));
      return { ok: true };
    }
  };
}

function failingActionRunner(): ConsoleCliRunner {
  return {
    async run(args) {
      if (args.join(" ") === "work release bw_work_ready --json") {
        throw new ConsoleCommandError("BOREAL_RESERVATION_CONFLICT", "No active reservation", {
          workId: "bw_work_ready"
        });
      }
      return { ok: true };
    }
  };
}
