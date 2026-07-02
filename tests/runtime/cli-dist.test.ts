import { execFile } from "node:child_process";
import { access, cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

interface CommandRun {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const tempDirs: string[] = [];

beforeAll(async () => {
  await execFileAsync(process.execPath, [join(repoRoot, "tools", "build-cli-dist.mjs")], {
    cwd: repoRoot,
    env: commandEnv({ BOREAL_INSTALL_CHANNEL: "npm" }),
    maxBuffer: 1024 * 1024
  });
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bundled bwrk dist", () => {
  it("runs from a copied dist directory without a source checkout or node_modules", async () => {
    const bundleRoot = await makeTempDir("boreal-cli-bundle-");
    const workspaceRoot = await makeTempDir("boreal-cli-workspace-");
    await cp(join(repoRoot, "apps", "cli", "dist"), join(bundleRoot, "dist"), { recursive: true });

    const bundledBin = join(bundleRoot, "dist", "index.js");
    expect(await isMissing(join(bundleRoot, "node_modules"))).toBe(true);
    expect(await isMissing(join(workspaceRoot, "node_modules"))).toBe(true);
    expect(await isMissing(join(bundleRoot, "workflows"))).toBe(true);

    const version = await runBundle(bundledBin, workspaceRoot, ["--version"]);
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toBe("boreal-work 0.1.0 (npm)\n");

    const workflows = await runBundle(bundledBin, workspaceRoot, ["workflows", "list", "--json"]);
    const workflowRows = parseData<Array<{ readonly id: string; readonly path: string }>>(workflows.stdout);
    expect(workflows.exitCode).toBe(0);
    expect(workflowRows.length).toBeGreaterThan(0);
    expect(workflowRows.map((row) => row.path)).toContain("40-work/claim-and-finish-work.md");

    const init = await runBundle(bundledBin, workspaceRoot, ["init", "--setup-memory", "--json"]);
    expect(init.exitCode).toBe(0);

    const docs = await runBundle(bundledBin, workspaceRoot, ["docs", "check", "--json"]);
    const docsPayload = parseData<{ readonly ok: boolean; readonly assetIssueCount: number; readonly workflowCount: number }>(docs.stdout);
    expect(docs.exitCode).toBe(0);
    expect(docsPayload).toEqual(expect.objectContaining({ ok: true, assetIssueCount: 0 }));
    expect(docsPayload.workflowCount).toBeGreaterThan(0);

    const created = await runBundle(bundledBin, workspaceRoot, ["work", "create", "Bundled smoke work", "--ready", "--json"]);
    expect(created.exitCode).toBe(0);

    const list = await runBundle(bundledBin, workspaceRoot, ["work", "list", "--json"]);
    const rows = parseData<Array<{ readonly title: string }>>(list.stdout);
    expect(list.exitCode).toBe(0);
    expect(rows.map((row) => row.title)).toContain("Bundled smoke work");

    const sync = await runBundle(bundledBin, workspaceRoot, ["sync", "refresh", "--json"]);
    const syncPayload = parseData<{ readonly postRefreshStatusOk: boolean }>(sync.stdout);
    expect(sync.exitCode).toBe(0);
    expect(syncPayload.postRefreshStatusOk).toBe(true);

    const schema = await runBundle(bundledBin, workspaceRoot, ["schema", "validate", "--json"]);
    const schemaPayload = parseData<{ readonly ok: boolean }>(schema.stdout);
    expect(schema.exitCode).toBe(0);
    expect(schemaPayload.ok).toBe(true);

    const doctor = await runBundle(bundledBin, workspaceRoot, ["doctor", "--json"]);
    const doctorPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: readonly Array<{ readonly code: string; readonly details?: { readonly upgrade?: { readonly channel: string } } }>;
    }>(doctor.stdout);
    const installDiagnostic = doctorPayload.diagnostics.find((diagnostic) => diagnostic.code === "install.status");
    expect(doctor.exitCode).toBe(0);
    expect(doctorPayload.ok).toBe(true);
    expect(installDiagnostic?.details?.upgrade).toEqual(expect.objectContaining({ channel: "npm" }));
  }, 20_000);
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function runBundle(bin: string, cwd: string, args: readonly string[]): Promise<CommandRun> {
  try {
    const result = await execFileAsync(process.execPath, [bin, ...args], {
      cwd,
      env: commandEnv(),
      maxBuffer: 1024 * 1024
    });
    return {
      exitCode: 0,
      stdout: String(result.stdout),
      stderr: String(result.stderr)
    };
  } catch (error) {
    const failure = error as {
      readonly code?: unknown;
      readonly stdout?: unknown;
      readonly stderr?: unknown;
    };
    return {
      exitCode: typeof failure.code === "number" ? failure.code : null,
      stdout: typeof failure.stdout === "string" ? failure.stdout : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr : ""
    };
  }
}

function parseData<T>(text: string): T {
  const envelope = JSON.parse(text) as { readonly ok: true; readonly data: T };
  expect(envelope.ok).toBe(true);
  return envelope.data;
}

function commandEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  delete env.BOREAL_ASSET_ROOT;
  if (!("BOREAL_INSTALL_CHANNEL" in overrides)) {
    delete env.BOREAL_INSTALL_CHANNEL;
  }
  return env;
}

async function isMissing(path: string): Promise<boolean> {
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}
