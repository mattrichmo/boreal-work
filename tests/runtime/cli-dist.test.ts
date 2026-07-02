import { execFile } from "node:child_process";
import { access, cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
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
  await buildCliDist("npm");
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

  it("runs as a repo dev-dependency bin through pnpm and npx without a machine bwrk binary", async () => {
    const workspaceRoot = await makeTempDir("boreal-cli-package-bin-");
    const installedBin = await installBundledPackage(workspaceRoot);
    await writeFile(
      join(workspaceRoot, "package.json"),
      `${JSON.stringify({ name: "boreal-package-bin-fixture", private: true, devDependencies: { "@boreal/cli": "0.1.0" } }, null, 2)}\n`,
      "utf8"
    );

    expect(await realpath(installedBin)).toBe(await realpath(join(workspaceRoot, "node_modules", "@boreal", "cli", "dist", "index.js")));

    const pnpm = await runExternal("pnpm", ["bwrk", "--version"], workspaceRoot);
    expect(pnpm.exitCode).toBe(0);
    expect(pnpm.stdout).toBe("boreal-work 0.1.0 (npm)\n");

    const npx = await runExternal("npx", ["--no-install", "bwrk", "--version"], workspaceRoot);
    expect(npx.exitCode).toBe(0);
    expect(npx.stdout).toBe("boreal-work 0.1.0 (npm)\n");
  }, 30_000);

  it("delegates machine bwrk to a repo-pinned package before running commands", async () => {
    const machineRoot = await makeTempDir("boreal-cli-machine-");
    const workspaceRoot = await makeTempDir("boreal-cli-pinned-");

    await buildCliDist("brew");
    await cp(join(repoRoot, "apps", "cli", "dist"), join(machineRoot, "dist"), { recursive: true });
    const machineBin = join(machineRoot, "dist", "index.js");

    await buildCliDist("npm");
    const repoBin = await installBundledPackage(workspaceRoot);
    await mkdir(join(workspaceRoot, ".boreal"), { recursive: true });
    await writeFile(
      join(workspaceRoot, ".boreal", "project.json"),
      `${JSON.stringify({ bwrkPin: { binPath: "node_modules/.bin/bwrk", packageName: "@boreal/cli" } }, null, 2)}\n`,
      "utf8"
    );

    const delegated = await runBundle(machineBin, workspaceRoot, ["--version"]);
    expect(delegated.exitCode).toBe(0);
    expect(delegated.stdout).toBe("launcher: boreal-work 0.1.0 (brew)\ndelegated: boreal-work 0.1.0 (npm)\n");

    const json = await runBundle(machineBin, workspaceRoot, ["--version", "--json"]);
    const payload = parseData<{
      readonly delegation?: {
        readonly launcher: { readonly installChannel: string };
        readonly delegated: { readonly installChannel: string; readonly executable?: string };
      };
    }>(json.stdout);
    expect(json.exitCode).toBe(0);
    expect(payload.delegation?.launcher.installChannel).toBe("brew");
    expect(payload.delegation?.delegated.installChannel).toBe("npm");
    expect(await realpath(payload.delegation?.delegated.executable ?? "")).toBe(await realpath(repoBin));

    const guarded = await runBundle(machineBin, workspaceRoot, ["--version"], { BOREAL_BWRK_DELEGATED: "1" });
    expect(guarded.exitCode).toBe(0);
    expect(guarded.stdout).toBe("boreal-work 0.1.0 (brew)\n");

    const disabled = await runBundle(machineBin, workspaceRoot, ["--no-delegate", "--version"]);
    expect(disabled.exitCode).toBe(0);
    expect(disabled.stdout).toBe("boreal-work 0.1.0 (brew)\n");

    const noPinWorkspace = await makeTempDir("boreal-cli-no-pin-");
    const noPin = await runBundle(machineBin, noPinWorkspace, ["--version"]);
    expect(noPin.exitCode).toBe(0);
    expect(noPin.stdout).toBe("boreal-work 0.1.0 (brew)\n");
  }, 40_000);

  it("records repo-pinned bwrk metadata in imported project registry entries", async () => {
    const workspaceRoot = await makeTempDir("boreal-cli-registry-pin-");
    const registryRoot = await makeTempDir("boreal-cli-registry-root-");
    const bundledBin = join(repoRoot, "apps", "cli", "dist", "index.js");
    await installBundledPackage(workspaceRoot);

    const init = await runBundle(bundledBin, workspaceRoot, ["init", "--setup-memory", "--json"]);
    expect(init.exitCode).toBe(0);

    const imported = await runBundle(bundledBin, workspaceRoot, ["registry", "import-setup", "--registry-root", registryRoot, "--json"]);
    const payload = parseData<{
      readonly entry: {
        readonly bwrkPin?: {
          readonly source: string;
          readonly relativeBinPath: string;
          readonly packageName?: string;
        };
      };
    }>(imported.stdout);

    expect(imported.exitCode).toBe(0);
    expect(payload.entry.bwrkPin).toEqual(
      expect.objectContaining({
        source: "node_modules",
        relativeBinPath: "node_modules/.bin/bwrk",
        packageName: "@boreal/cli"
      })
    );
  }, 30_000);
});

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function buildCliDist(channel: "npm" | "brew"): Promise<void> {
  await execFileAsync(process.execPath, [join(repoRoot, "tools", "build-cli-dist.mjs")], {
    cwd: repoRoot,
    env: commandEnv({ BOREAL_INSTALL_CHANNEL: channel }),
    maxBuffer: 1024 * 1024
  });
}

async function installBundledPackage(workspaceRoot: string): Promise<string> {
  const packageRoot = join(workspaceRoot, "node_modules", "@boreal", "cli");
  const binDir = join(workspaceRoot, "node_modules", ".bin");
  const binPath = join(binDir, "bwrk");
  await mkdir(binDir, { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await cp(join(repoRoot, "apps", "cli", "dist"), join(packageRoot, "dist"), { recursive: true });
  await writeFile(
    join(packageRoot, "package.json"),
    `${JSON.stringify({ name: "@boreal/cli", version: "0.1.0", type: "module", bin: { bwrk: "./dist/index.js" } }, null, 2)}\n`,
    "utf8"
  );
  await symlink("../@boreal/cli/dist/index.js", binPath);
  return binPath;
}

async function runBundle(
  bin: string,
  cwd: string,
  args: readonly string[],
  envOverrides: NodeJS.ProcessEnv = {}
): Promise<CommandRun> {
  return runExternal(process.execPath, [bin, ...args], cwd, envOverrides);
}

async function runExternal(
  command: string,
  args: readonly string[],
  cwd: string,
  envOverrides: NodeJS.ProcessEnv = {}
): Promise<CommandRun> {
  try {
    const result = await execFileAsync(command, [...args], {
      cwd,
      env: commandEnv(envOverrides),
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
