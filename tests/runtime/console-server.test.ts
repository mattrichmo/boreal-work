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

      expect(htmlWithToken(await (await fetch(`${running.url}/work`)).text())).toContain(running.csrfToken);

      const missingToken = await fetch(`${running.url}/api/commands/sync.refresh`, { method: "POST" });
      const missingTokenPayload = await missingToken.json() as { readonly error?: { readonly code?: string } };
      expect(missingToken.status).toBe(403);
      expect(missingTokenPayload.error?.code).toBe("CONSOLE_SECURITY_TOKEN_INVALID");

      const unconfirmed = await fetch(`${running.url}/api/commands/sync.refresh`, {
        method: "POST",
        body: new URLSearchParams({ consoleToken: running.csrfToken })
      });
      const unconfirmedPayload = await unconfirmed.json() as { readonly error?: { readonly code?: string } };
      expect(unconfirmed.status).toBe(200);
      expect(unconfirmedPayload.error?.code).toBe("CONSOLE_COMMAND_CONFIRMATION_REQUIRED");

      const unknown = await fetch(`${running.url}/api/commands/unknown`, {
        method: "POST",
        body: new URLSearchParams({ consoleToken: running.csrfToken })
      });
      const unknownPayload = await unknown.json() as { readonly error?: { readonly code?: string; readonly message?: string } };
      expect(unknown.status).toBe(500);
      expect(unknownPayload.error?.code).toBe("CONSOLE_COMMAND_NOT_ALLOWED");
      expect(unknownPayload.error?.message).not.toContain("at ");
    } finally {
      await running.close();
    }
  });

  it("caches live route data, exposes live failures as warnings, and invalidates after mutations", async () => {
    const runner = failingLiveRunner();
    const running = await listenConsole({
      workspaceRoot: "/workspace/boreal-work",
      mode: "live",
      port: 0,
      runner,
      liveCacheTtlMs: 30_000
    });
    try {
      const first = await fetch(`${running.url}/`);
      const second = await fetch(`${running.url}/work`);
      const state = await fetch(`${running.url}/api/state`);
      const statePayload = await state.json() as { readonly workspace?: { readonly mode?: string; readonly warnings?: readonly string[] } };

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(statePayload.workspace?.mode).toBe("fixture");
      expect(statePayload.workspace?.warnings?.[0]).toContain("simulated live failure");
      // Default scope is repo, which never reaches across projects, so the
      // cross-repo registry commands are not issued.
      const liveLoadCommands = [
        "work list --label sprint-04 --limit 100 --json",
        "work list --ready --label v1-remainder --limit 20 --json",
        "work list --limit 250 --json",
        "sync status --json",
        "doctor --json",
        "reservation list --status active --json"
      ];
      expect(runner.calls).toEqual(liveLoadCommands);

      const refresh = await fetch(`${running.url}/api/commands/sync.refresh`, {
        method: "POST",
        body: new URLSearchParams({ confirm: "yes", consoleToken: running.csrfToken })
      });
      expect(refresh.status).toBe(200);

      const afterMutation = await fetch(`${running.url}/api/state`);
      expect(afterMutation.status).toBe(200);
      expect(runner.calls).toEqual([
        ...liveLoadCommands,
        "sync refresh --json",
        ...liveLoadCommands
      ]);
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
        body: new URLSearchParams({ projectRoot: "/workspace/other-work", consoleToken: running.csrfToken })
      });
      const unconfirmedPayload = await unconfirmed.json() as { readonly error?: { readonly code?: string } };
      expect(unconfirmedPayload.error?.code).toBe("CONSOLE_COMMAND_CONFIRMATION_REQUIRED");

      const added = await fetch(`${running.url}/api/settings/projects/add`, {
        method: "POST",
        body: new URLSearchParams({ projectRoot: "/workspace/other-work", confirm: "yes", consoleToken: running.csrfToken })
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
          body: new URLSearchParams({ ...entry.body, confirm: "yes", returnTo, consoleToken: running.csrfToken }),
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
        body: new URLSearchParams({ workId: "bw_work_ready", confirm: "yes", consoleToken: running.csrfToken })
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

  it("rejects missing tokens, bad tokens, and cross-origin console posts while allowing local posts", async () => {
    const runner = actionRunner();
    const running = await listenConsole({
      workspaceRoot: "/workspace/boreal-work",
      mode: "fixture",
      port: 0,
      runner
    });
    try {
      const badToken = await fetch(`${running.url}/api/commands/sync.refresh`, {
        method: "POST",
        body: new URLSearchParams({ confirm: "yes", consoleToken: "wrong" })
      });
      const badTokenPayload = await badToken.json() as { readonly error?: { readonly code?: string } };
      expect(badToken.status).toBe(403);
      expect(badTokenPayload.error?.code).toBe("CONSOLE_SECURITY_TOKEN_INVALID");

      const crossOrigin = await fetch(`${running.url}/api/commands/sync.refresh`, {
        method: "POST",
        headers: { origin: "http://evil.example.test" },
        body: new URLSearchParams({ confirm: "yes", consoleToken: running.csrfToken })
      });
      const crossOriginPayload = await crossOrigin.json() as { readonly error?: { readonly code?: string } };
      expect(crossOrigin.status).toBe(403);
      expect(crossOriginPayload.error?.code).toBe("CONSOLE_SECURITY_ORIGIN_REJECTED");

      const valid = await fetch(`${running.url}/api/commands/sync.refresh`, {
        method: "POST",
        headers: { origin: running.url },
        body: new URLSearchParams({ confirm: "yes", consoleToken: running.csrfToken })
      });
      expect(valid.status).toBe(200);
      expect(await valid.json()).toMatchObject({ ok: true, commandId: "sync.refresh" });
      expect(runner.calls).toEqual(["sync refresh --json"]);
    } finally {
      await running.close();
    }

    const remote = await listenConsole({
      workspaceRoot: "/workspace/boreal-work",
      mode: "fixture",
      host: "0.0.0.0",
      port: 0
    });
    try {
      expect(remote.warnings).toEqual([
        "Console is bound to 0.0.0.0; mutating POST requests still require the per-server token and same Host/Origin validation."
      ]);
    } finally {
      await remote.close();
    }
  });
});

function htmlWithToken(html: string): string {
  expect(html).toContain('name="consoleToken"');
  return html;
}

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

function failingLiveRunner(): ConsoleCliRunner & { readonly calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async run(args) {
      const command = args.join(" ");
      calls.push(command);
      if (command === "sync refresh --json") {
        return { ok: true };
      }
      throw new Error(`simulated live failure for ${command}`);
    }
  };
}
