import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createBorealRuntime } from "@boreal/engine";
import {
  BorealError,
  executionRunCapabilitySchemaIssues,
  executeDeclaredGate,
  hashContent,
  isTrustedExecutableCapability,
  runBoundedProcess,
  withContentHash
} from "@boreal/core";
import { InMemoryBorealStore } from "@boreal/storage";
import { buildExportDocument, importJson } from "../../apps/cli/src/import-export.ts";
import type { CliContext } from "../../apps/cli/src/context.ts";

const tempDirs: string[] = [];
const actor = { id: "trusted-execution-test", kind: "agent" as const, displayName: "Trusted execution test" };

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("trusted execution hardening", () => {
  it("sanitizes code-loading environment variables and uses the trusted Node runtime", async () => {
    const result = await executeDeclaredGate({
      source: "required_closeout_gate",
      declaredCommand: `${process.execPath} -e "process.stdout.write('safe')"`,
      workspaceRoot: await workspace(),
      policy: {
        enabled: true,
        allowedExecutables: ["node"],
        environmentKeys: ["PATH", "NODE_OPTIONS", "NODE_PATH"],
        timeoutMs: 1_000,
        stdoutMaxBytes: 64,
        stderrMaxBytes: 64
      },
      environment: {
        PATH: process.env.PATH,
        NODE_OPTIONS: "--require /definitely-not-a-real-module",
        NODE_PATH: "/tmp/untrusted-node-path"
      }
    });

    expect(result).toMatchObject({ dryRun: false, preview: { executable: process.execPath, environmentKeys: ["PATH"] } });
    if (!result.dryRun) expect(result.result.stdout.text).toBe("safe");
  });

  it("rejects untrusted imported capabilities and code-loading arguments", () => {
    expect(isTrustedExecutableCapability("sh")).toBe(false);
    expect(isTrustedExecutableCapability("/tmp/node")).toBe(false);
    expect(isTrustedExecutableCapability(process.execPath, undefined, { allowRuntimePath: false })).toBe(false);
    expect(executionRunCapabilitySchemaIssues({ command: { executable: "sh", args: [] } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.command.executable" })])
    );
    expect(executionRunCapabilitySchemaIssues({ command: { executable: "node", args: ["-e", "process.exit(0)"] } })).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: "$.command.args" })])
    );
  });

  it("rejects an imported snapshot containing an executable outside the capability policy", async () => {
    const sourceStore = new InMemoryBorealStore();
    const runtime = createBorealRuntime({ store: sourceStore, actor });
    const work = await runtime.createWork({ title: "Imported execution fixture" });
    await runtime.runs.start({
      workId: work.meta.id,
      command: {
        executable: "node",
        args: ["--version"],
        timeoutMs: 1_000,
        stdoutMaxBytes: 1_024,
        stderrMaxBytes: 1_024
      }
    });
    const document = await buildExportDocument({ workspaceRoot: "/source", store: sourceStore } as unknown as CliContext);
    const state = {
      ...document.state,
      runs: document.state.runs.map((run) => ({ ...run, command: { ...run.command!, executable: "sh" } }))
    };
    const dir = await workspace();
    const path = join(dir, "untrusted-export.json");
    await writeFile(path, `${JSON.stringify({ ...document, state, contentHash: hashContent(state) }, null, 2)}\n`);

    await expect(importJson({ workspaceRoot: "/target", store: new InMemoryBorealStore() } as unknown as CliContext, path, { allowExternalRead: true })).rejects.toMatchObject({
      code: "BOREAL_POLICY_VIOLATION",
      message: "Imported execution runs contain untrusted executable capabilities"
    });
  });

  it("quarantines a queued run whose command was changed outside the validated API", async () => {
    const store = new InMemoryBorealStore();
    const runtime = createBorealRuntime({ store, actor });
    const work = await runtime.createWork({ title: "Untrusted command fixture" });
    const run = await runtime.runs.start({
      workId: work.meta.id,
      command: {
        executable: "node",
        args: ["--version"],
        timeoutMs: 1_000,
        stdoutMaxBytes: 1_024,
        stderrMaxBytes: 1_024
      }
    });

    await store.write(async (writer) => {
      const current = await writer.getRun(run.meta.id);
      if (!current) throw new Error("run fixture was not persisted");
      await writer.putRun(withContentHash({ ...current, command: { ...current.command!, executable: "/tmp/backdoor" } }));
    });

    const finished = await runtime.runs.executeQueued("worker");
    expect(finished).toBeUndefined();
    await expect(runtime.runs.show(run.meta.id)).resolves.toMatchObject({
      run: { status: "needs_attention", errorCode: "BOREAL_POLICY_VIOLATION" }
    });
  });

  it("kills descendants when an output cap is exceeded", async () => {
    if (process.platform === "win32") return;
    const root = await workspace();
    const marker = join(root, "descendant-survived.txt");
    const childCode = `setTimeout(() => require("node:fs").writeFileSync(${JSON.stringify(marker)}, "survived"), 250);`;
    const parentCode = `require("node:child_process").spawn(process.execPath, ["-e", ${JSON.stringify(childCode)}], {stdio: "ignore"}); process.stdout.write("x".repeat(4096)); setTimeout(() => {}, 10000);`;

    await expect(
      runBoundedProcess({
        command: process.execPath,
        args: ["-e", parentCode],
        timeoutMs: 2_000,
        stdoutMaxBytes: 64,
        stderrMaxBytes: 64,
        killProcessGroup: true
      })
    ).rejects.toMatchObject({ code: "BOREAL_COMMAND_OUTPUT_LIMIT" } satisfies Partial<BorealError>);

    await new Promise((resolve) => setTimeout(resolve, 400));
    await expect(access(marker)).rejects.toThrow();
  });
});

async function workspace(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "boreal-trusted-execution-"));
  tempDirs.push(path);
  return path;
}
