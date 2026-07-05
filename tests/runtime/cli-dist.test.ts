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
const suiteTempDirs: string[] = [];
let npmDistDir = join(repoRoot, "apps", "cli", "dist");

beforeAll(async () => {
  npmDistDir = await buildCliDist("npm", "suite");
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

afterAll(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  await Promise.all(suiteTempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bundled bwrk dist", () => {
  it("runs from a copied dist directory without a source checkout or node_modules", async () => {
    const bundleRoot = await makeTempDir("boreal-cli-bundle-");
    const workspaceRoot = await makeTempDir("boreal-cli-workspace-");
    await cp(npmDistDir, join(bundleRoot, "dist"), { recursive: true });

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

  it("bundles the terminal dashboard and launches it from a bare install without a source checkout", async () => {
    const bundleRoot = await makeTempDir("boreal-cli-tui-bundle-");
    const workspaceRoot = await makeTempDir("boreal-cli-tui-workspace-");
    await cp(npmDistDir, join(bundleRoot, "dist"), { recursive: true });
    const bundledBin = join(bundleRoot, "dist", "index.js");
    const bundledTui = join(bundleRoot, "dist", "tui", "index.js");

    // The TUI app ships inside the dist artifact (bw_work_67f67c5afd2decc5)...
    expect(await isMissing(bundledTui)).toBe(false);

    // ...its import graph (ink/react/yoga) loads without node_modules...
    const help = await runBundle(bundledTui, workspaceRoot, ["--help"]);
    expect(help.exitCode).toBe(0);
    expect(help.stdout).toContain("Boreal terminal dashboard");

    // ...and `bwrk dashboard` actually launches it (renders a frame) from
    // the standalone layout. Previously this exited silently with code 1.
    const init = await runBundle(bundledBin, workspaceRoot, ["init", "--json"]);
    expect(init.exitCode).toBe(0);
    const firstFrame = await captureFirstDashboardFrame(bundledBin, workspaceRoot);
    expect(firstFrame).toContain("boreal");
    expect(firstFrame).toContain("Roll-Up");
  }, 30_000);

  it("runs as a repo dev-dependency bin through pnpm and npx without a machine bwrk binary", async () => {
    const workspaceRoot = await makeTempDir("boreal-cli-package-bin-");
    const installedBin = await installBundledPackage(workspaceRoot);
    await writeFile(
      join(workspaceRoot, "package.json"),
      `${JSON.stringify(
        {
          name: "boreal-package-bin-fixture",
          private: true,
          packageManager: "pnpm@9.15.1",
          devDependencies: { "@boreal/cli": "0.1.0" }
        },
        null,
        2
      )}\n`,
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

    const brewDist = await buildCliDist("brew");
    await cp(brewDist, join(machineRoot, "dist"), { recursive: true });
    const machineBin = join(machineRoot, "dist", "index.js");

    const npmDist = await buildCliDist("npm");
    const repoBin = await installBundledPackage(workspaceRoot, npmDist);
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

    const missingPinWorkspace = await makeTempDir("boreal-cli-missing-pin-");
    await mkdir(join(missingPinWorkspace, ".boreal"), { recursive: true });
    await writeFile(
      join(missingPinWorkspace, ".boreal", "project.json"),
      `${JSON.stringify({ bwrkPin: { binPath: "node_modules/.bin/bwrk", packageName: "@boreal/cli" } }, null, 2)}\n`,
      "utf8"
    );

    const missingPin = await runBundle(machineBin, missingPinWorkspace, ["doctor", "--json"]);
    const missingPinPayload = parseError<{
      readonly code: string;
      readonly message: string;
      readonly details: { readonly reason: string; readonly installCommand: string; readonly relativeBinPath: string };
    }>(missingPin.stderr);
    expect(missingPin.exitCode).toBe(1);
    expect(missingPinPayload.code).toBe("BOREAL_POLICY_VIOLATION");
    expect(missingPinPayload.message).toContain("pnpm install");
    expect(missingPinPayload.details).toEqual(
      expect.objectContaining({
        reason: "repo_pinned_bwrk_missing",
        installCommand: "pnpm install",
        relativeBinPath: "node_modules/.bin/bwrk"
      })
    );
    expect(missingPin.stdout).toBe("");
  }, 40_000);

  it("reports version-skew warnings and unsupported state-schema errors with channel-correct commands", async () => {
    const npmDist = await buildCliDist("npm");
    const workspaceRoot = await makeTempDir("boreal-cli-compat-");
    const repoBin = await installBundledPackage(workspaceRoot, npmDist);

    const init = await runBundle(repoBin, workspaceRoot, ["init", "--json"], {
      BOREAL_BWRK_DELEGATED: "1",
      BOREAL_INIT_STORAGE: "file-v2"
    });
    expect(init.exitCode).toBe(0);

    const skewEnv = {
      BOREAL_BWRK_DELEGATED: "1",
      BOREAL_BWRK_LAUNCHER_NAME: "boreal-work",
      BOREAL_BWRK_LAUNCHER_VERSION: "0.2.0",
      BOREAL_BWRK_LAUNCHER_CHANNEL: "brew",
      BOREAL_BWRK_LAUNCHER_EXECUTABLE: "/opt/homebrew/bin/bwrk",
      BOREAL_BWRK_DELEGATED_BIN: repoBin
    };
    const skewDoctor = await runBundle(repoBin, workspaceRoot, ["doctor", "--json"], skewEnv);
    const skewPayload = parseData<{
      readonly diagnostics: readonly Array<{
        readonly code: string;
        readonly severity: string;
        readonly details?: {
          readonly launcher?: { readonly version: string; readonly installChannel: string };
          readonly repoPinned?: { readonly version: string; readonly installChannel: string };
          readonly upgrade?: { readonly channel: string; readonly command: string };
          readonly repoPinnedUpgrade?: { readonly channel: string; readonly command: string };
          readonly recommendedActions?: readonly string[];
        };
      }>;
    }>(skewDoctor.stdout);
    const skewDiagnostic = skewPayload.diagnostics.find((diagnostic) => diagnostic.code === "install.version_skew");
    expect(skewDoctor.exitCode).toBe(0);
    expect(skewDiagnostic).toEqual(
      expect.objectContaining({
        severity: "warning",
        details: expect.objectContaining({
          launcher: expect.objectContaining({ version: "0.2.0", installChannel: "brew" }),
          repoPinned: expect.objectContaining({ version: "0.1.0", installChannel: "npm" }),
          upgrade: expect.objectContaining({ channel: "brew", command: "brew upgrade boreal-work" }),
          repoPinnedUpgrade: expect.objectContaining({ channel: "npm", command: "npm install -g @boreal/cli@latest" }),
          recommendedActions: expect.arrayContaining([
            "Upgrade machine bwrk via brew: brew upgrade boreal-work.",
            "Upgrade repo-pinned bwrk via npm: npm install -g @boreal/cli@latest."
          ])
        })
      })
    );

    const skewResult = await runBundle(repoBin, workspaceRoot, ["work", "create", "Skew result envelope", "--ready", "--json"], skewEnv);
    const skewResultPayload = parseData<{
      readonly meta: { readonly id: string };
      readonly result: { readonly schemaVersion: string; readonly id: string; readonly kind: string; readonly status: string };
    }>(skewResult.stdout);
    expect(skewResult.exitCode).toBe(0);
    expect(skewResultPayload.result).toEqual(
      expect.objectContaining({
        schemaVersion: "boreal.cli.result.v1",
        id: skewResultPayload.meta.id,
        kind: "task",
        status: "ready"
      })
    );

    const skewBrief = await runBundle(repoBin, workspaceRoot, ["work", "show", skewResultPayload.meta.id, "--brief"], skewEnv);
    const skewBriefPayload = parseData<{
      readonly summary: { readonly id: string; readonly kind: string; readonly status: string; readonly title: string };
    }>(skewBrief.stdout);
    expect(skewBrief.exitCode).toBe(0);
    expect(skewBriefPayload.summary).toEqual(
      expect.objectContaining({
        id: skewResultPayload.meta.id,
        kind: "task",
        status: "ready",
        title: "Skew result envelope"
      })
    );

    await writeFile(join(workspaceRoot, ".boreal", "runtime", "state.json"), '{"schemaVersion":"boreal.file-store.v999"}\n', "utf8");
    const schemaDoctor = await runBundle(repoBin, workspaceRoot, ["doctor", "--json"], { BOREAL_BWRK_DELEGATED: "1" });
    const schemaPayload = parseData<{
      readonly ok: boolean;
      readonly diagnostics: readonly Array<{
        readonly code: string;
        readonly severity: string;
        readonly details?: {
          readonly schemaVersion?: string;
          readonly supportedSchemaVersion?: string;
          readonly upgrade?: { readonly channel: string; readonly command: string };
          readonly repairCommand?: string;
          readonly recommendedActions?: readonly string[];
        };
      }>;
    }>(schemaDoctor.stdout);
    const schemaDiagnostic = schemaPayload.diagnostics.find((diagnostic) => diagnostic.code === "state.schema");
    expect(schemaDoctor.exitCode).toBe(1);
    expect(schemaPayload.ok).toBe(false);
    expect(schemaDiagnostic).toEqual(
      expect.objectContaining({
        severity: "error",
        details: expect.objectContaining({
          schemaVersion: "boreal.file-store.v999",
          supportedSchemaVersion: "boreal.file-store.v2",
          upgrade: expect.objectContaining({ channel: "npm", command: "npm install -g @boreal/cli@latest" }),
          repairCommand: "npm install -g @boreal/cli@latest",
          recommendedActions: expect.arrayContaining(["Upgrade this bwrk binary via npm: npm install -g @boreal/cli@latest."])
        })
      })
    );
  }, 30_000);

  it("records repo-pinned bwrk metadata in imported project registry entries", async () => {
    const workspaceRoot = await makeTempDir("boreal-cli-registry-pin-");
    const registryRoot = await makeTempDir("boreal-cli-registry-root-");
    const bundledBin = join(npmDistDir, "index.js");
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

async function buildCliDist(channel: "npm" | "brew", lifetime: "test" | "suite" = "test"): Promise<string> {
  const snapshotRoot = await mkdtemp(join(tmpdir(), `boreal-cli-dist-${channel}-`));
  (lifetime === "suite" ? suiteTempDirs : tempDirs).push(snapshotRoot);
  const snapshotDist = join(snapshotRoot, "dist");
  await execFileAsync(process.execPath, [join(repoRoot, "tools", "build-cli-dist.mjs")], {
    cwd: repoRoot,
    env: commandEnv({ BOREAL_INSTALL_CHANNEL: channel, BOREAL_BUILD_DIST_SNAPSHOT_DIR: snapshotDist }),
    maxBuffer: 1024 * 1024
  });
  return snapshotDist;
}

async function installBundledPackage(workspaceRoot: string, distDir = npmDistDir): Promise<string> {
  const packageRoot = join(workspaceRoot, "node_modules", "@boreal", "cli");
  const binDir = join(workspaceRoot, "node_modules", ".bin");
  const binPath = join(binDir, "bwrk");
  await mkdir(binDir, { recursive: true });
  await mkdir(packageRoot, { recursive: true });
  await cp(distDir, join(packageRoot, "dist"), { recursive: true });
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

/** Spawn `bwrk dashboard` from a bundled bin and return its ANSI-stripped
 * output. On a non-TTY stdout Ink buffers rendering and flushes the frame on
 * exit, so waiting for the frame before terminating would deadlock: instead
 * wait for the alternate-screen enter sequence (proof the TUI process
 * booted), give the route loader a beat, terminate, and collect the frame
 * from the exit flush. */
async function captureFirstDashboardFrame(bundledBin: string, cwd: string): Promise<string> {
  const { spawn } = await import("node:child_process");
  return new Promise<string>((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [bundledBin, "dashboard"], {
      cwd,
      env: commandEnv({}),
      stdio: ["ignore", "pipe", "pipe"]
    });
    let output = "";
    let booted = false;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      child.kill("SIGKILL");
      rejectPromise(error);
    };
    const deadline = setTimeout(
      () => fail(new Error(`dashboard never entered the alt screen; output: ${output.slice(0, 500)}`)),
      15_000
    );
    const collect = (chunk: Buffer) => {
      output += chunk.toString();
      if (!booted && output.includes("[?1049h")) {
        booted = true;
        setTimeout(() => child.kill("SIGTERM"), 2_000);
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    child.once("error", (error) => fail(error));
    child.once("exit", () => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (!booted) {
        rejectPromise(new Error(`dashboard exited before entering the alt screen; output: ${output.slice(0, 500)}`));
        return;
      }
      // eslint-disable-next-line no-control-regex
      resolvePromise(output.replace(/\u001b\[[0-9;?]*[a-zA-Z]/gu, ""));
    });
  });
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

function parseError<T>(text: string): T {
  const envelope = JSON.parse(text) as T & { readonly ok: false };
  expect(envelope.ok).toBe(false);
  return envelope;
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
