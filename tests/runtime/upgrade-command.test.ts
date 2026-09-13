import { EventEmitter } from "node:events";
import { mkdir, writeFile } from "node:fs/promises";
import { PassThrough } from "node:stream";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

const updateMock = vi.hoisted(() => ({
  updateCommand: vi.fn()
}));
const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("../../apps/cli/src/commands/update.js", () => updateMock);
vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { parseArgs } from "../../apps/cli/src/args.js";
import { upgradeCommand } from "../../apps/cli/src/commands/upgrade.js";

function output() {
  return { write: vi.fn(), error: vi.fn() };
}

async function context() {
  const root = join(tmpdir(), `boreal-upgrade-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await mkdir(join(root, ".boreal"), { recursive: true });
  await writeFile(join(root, ".boreal", "project.json"), "{}\n");
  await writeFile(join(root, ".boreal", "state.json"), "{}\n");
  return {
    cwd: root,
    workspaceRoot: root,
    paths: { borealDir: join(root, ".boreal"), stateFile: join(root, ".boreal", "state.json") },
    storage: "file-v2"
  } as never;
}

function machineResult(binPath = "/tmp/bwrk-new") {
  return {
    exitCode: 0,
    data: { updated: true, binPath, dryRun: false }
  };
}

function childProcess(stdout: string, exitCode = 0, close = true) {
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = vi.fn();
  if (close) {
    queueMicrotask(() => {
      child.stdout.end(stdout);
      child.stderr.end();
      child.emit("close", exitCode);
    });
  }
  return child;
}

describe("upgrade command orchestration", () => {
  beforeEach(() => {
    updateMock.updateCommand.mockReset();
    spawnMock.mockReset();
  });

  it("updates the machine first, then invokes the new binary for project assets", async () => {
    const calls: string[] = [];
    updateMock.updateCommand.mockImplementation(async (action: string, _context: unknown, _args: unknown, out: { write: (s: string) => void }) => {
      calls.push(`in-process:${action}`);
      out.write(JSON.stringify({ data: machineResult().data }));
      return { exitCode: 0 };
    });
    spawnMock.mockImplementation((_bin: string, argv: string[]) => {
      calls.push(`spawn:${argv.slice(1, 3).join(" ")}`);
      return childProcess(JSON.stringify({ data: { workspaceRoot: "ok" } }));
    });

    const result = await upgradeCommand(await context(), parseArgs(["upgrade", "--json"]), output(), true);
    expect(result.exitCode).toBe(0);
    expect(calls).toEqual(["in-process:self", "spawn:update repo"]);
    expect(spawnMock).toHaveBeenCalledWith("/tmp/bwrk-new", expect.arrayContaining(["--no-delegate", "--workspace"]), expect.anything());
  });

  it("does not run project update when machine update fails", async () => {
    updateMock.updateCommand.mockRejectedValue(new Error("machine failed"));
    await expect(upgradeCommand(await context(), parseArgs(["upgrade", "--json"]), output(), true)).rejects.toThrow("machine failed");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("does not execute the installed binary during dry-run", async () => {
    updateMock.updateCommand.mockImplementation(async (_action: string, _context: unknown, _args: unknown, out: { write: (s: string) => void }) => {
      out.write(JSON.stringify({ data: { ...machineResult().data, dryRun: true } }));
      return { exitCode: 0 };
    });
    const result = await upgradeCommand(await context(), parseArgs(["upgrade", "--dry-run", "--json"]), output(), true);
    expect(result.exitCode).toBe(0);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("keeps project-only updates in process", async () => {
    updateMock.updateCommand.mockImplementation(async (_action: string, _context: unknown, _args: unknown, out: { write: (s: string) => void }) => {
      out.write(JSON.stringify({ ok: true, data: { workspaceRoot: "ok" } }));
      return { exitCode: 0 };
    });
    const result = await upgradeCommand(await context(), parseArgs(["upgrade", "--project", "--json"]), output(), true);
    expect(result.exitCode).toBe(0);
    expect(updateMock.updateCommand).toHaveBeenCalledWith("repo", expect.anything(), expect.anything(), expect.anything(), true);
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("rejects malformed project JSON", async () => {
    updateMock.updateCommand.mockImplementation(async (_action: string, _context: unknown, _args: unknown, out: { write: (s: string) => void }) => {
      out.write(JSON.stringify({ data: machineResult().data }));
      return { exitCode: 0 };
    });
    spawnMock.mockImplementation(() => childProcess("not-json"));
    await expect(upgradeCommand(await context(), parseArgs(["upgrade", "--json"]), output(), true)).rejects.toThrow("invalid JSON");
  });

  it("times out a hanging installed binary", async () => {
    vi.useFakeTimers();
    try {
      updateMock.updateCommand.mockImplementation(async (_action: string, _context: unknown, _args: unknown, out: { write: (s: string) => void }) => {
        out.write(JSON.stringify({ data: machineResult().data }));
        return { exitCode: 0 };
      });
      let child!: ReturnType<typeof childProcess>;
      spawnMock.mockImplementation(() => {
        child = childProcess("", 0, false);
        return child;
      });
      const pending = upgradeCommand(await context(), parseArgs(["upgrade", "--json"]), output(), true);
      const timedOut = expect(pending).rejects.toThrow("timed out");
      await vi.advanceTimersByTimeAsync(30_000);
      await timedOut;
      expect(child.kill).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
