import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { BorealError, executeDeclaredGate, parseDeclaredCommand } from "@boreal/core";

const tempDirs: string[] = [];
afterEach(async () => Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("declared closeout gate execution", () => {
  it("previews only an approved gate declaration with bounded limits and redacted environment values", async () => {
    const root = await workspace();
    const result = await executeDeclaredGate({
      source: "required_closeout_gate",
      declaredCommand: `${process.execPath} -e "process.stdout.write('ok')"`,
      workspaceRoot: root,
      policy: { enabled: true, allowedExecutables: ["node"], environmentKeys: ["PATH"], timeoutMs: 500, stdoutMaxBytes: 64, stderrMaxBytes: 32 },
      environment: { PATH: process.env.PATH, SECRET_TOKEN: "must-not-escape" },
      dryRun: true
    });

    expect(result).toMatchObject({
      dryRun: true,
      preview: {
        source: "required_closeout_gate",
        shell: false,
        cwd: root,
        environmentKeys: ["PATH"],
        excludedEnvironmentKeyCount: 1,
        limits: { timeoutMs: 500, stdoutMaxBytes: 64, stderrMaxBytes: 32 }
      }
    });
    expect(JSON.stringify(result)).not.toContain("must-not-escape");
  });

  it("executes without a shell and preserves bounded output hashes", async () => {
    const root = await workspace();
    const executed = await executeDeclaredGate({
      source: "required_closeout_gate",
      declaredCommand: `${process.execPath} -e "process.stdout.write('witnessed')"`,
      workspaceRoot: root,
      policy: { enabled: true, allowedExecutables: ["node"], timeoutMs: 1_000, stdoutMaxBytes: 128, stderrMaxBytes: 128 }
    });
    expect(executed).toMatchObject({
      dryRun: false,
      result: { exitCode: 0, timedOut: false, cancelled: false, stdout: { text: "witnessed", bytes: 9 } }
    });
    if (!executed.dryRun) expect(executed.result.stdout.sha256).toMatch(/^sha256:[a-f0-9]{64}$/u);
  });

  it("rejects shell expansion, unapproved executables, disabled policy, and escaped cwd", async () => {
    const root = await workspace();
    expect(() => parseDeclaredCommand("pnpm test && rm -rf .")).toThrow(/shell operators/u);
    await expect(executeDeclaredGate({
      source: "required_closeout_gate",
      declaredCommand: "sh -c pwd",
      workspaceRoot: root,
      policy: { enabled: true }
    })).rejects.toMatchObject({ code: "BOREAL_POLICY_VIOLATION" } satisfies Partial<BorealError>);
    await expect(executeDeclaredGate({
      source: "required_closeout_gate",
      declaredCommand: "node -e 0",
      workspaceRoot: root,
      policy: { enabled: false }
    })).rejects.toMatchObject({ code: "BOREAL_POLICY_VIOLATION" } satisfies Partial<BorealError>);
    await expect(executeDeclaredGate({
      source: "required_closeout_gate",
      declaredCommand: "node -e 0",
      workspaceRoot: root,
      cwd: "..",
      policy: { enabled: true }
    })).rejects.toMatchObject({ code: "BOREAL_INVALID_INPUT" } satisfies Partial<BorealError>);
  });
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "boreal-declared-gate-"));
  tempDirs.push(path);
  return path;
}
