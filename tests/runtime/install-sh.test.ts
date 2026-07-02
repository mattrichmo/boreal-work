import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
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

interface InstallFixture {
  readonly root: string;
  readonly cwd: string;
  readonly binDir: string;
  readonly libDir: string;
  readonly registryRoot: string;
}

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
const installScript = join(repoRoot, "install.sh");
const bundledBin = join(repoRoot, "apps", "cli", "dist", "index.js");
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

describe("install.sh", () => {
  it("installs and upgrades the machine binary without global prompts in machine mode", async () => {
    const fixture = await makeFixture("boreal-install-machine-");

    const first = await runInstall(fixture, ["--machine", "--yes"]);
    const second = await runInstall(fixture, ["--machine", "--yes"]);
    const version = await runExternal(join(fixture.binDir, "bwrk"), ["--version"], fixture.cwd, fixtureEnv(fixture));

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(first.stdout).toContain("Machine install complete; skipped global manager prompts.");
    expect(second.stdout).toContain("Machine install complete; skipped global manager prompts.");
    expect(version).toEqual(expect.objectContaining({ exitCode: 0, stdout: "boreal-work 0.1.0 (npm)\n" }));
    expect(await exists(join(fixture.libDir, "dist", "index.js"))).toBe(true);
    expect(await exists(registryFile(fixture.registryRoot))).toBe(false);
  }, 30_000);

  it("default mode installs the machine binary, detects an existing registry by file, and links an initialized repo idempotently", async () => {
    const fixture = await makeFixture("boreal-install-default-");
    await writePackageJson(fixture.cwd);
    await initWorkspace(fixture);
    await writeEmptyRegistry(fixture.registryRoot);

    const first = await runInstall(fixture, ["--yes"]);
    const second = await runInstall(fixture, ["--yes"]);
    const registry = await readRegistry(fixture.registryRoot);

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(first.stdout).toContain("Global manager registry already exists");
    expect(first.stdout).toContain("Linked current repo to global manager registry");
    expect(second.stdout).toContain("Linked current repo to global manager registry");
    expect(registry.entries).toHaveLength(1);
    expect(registry.entries[0]?.projectRoot).toBe(await realpath(fixture.cwd));
    expect(await exists(join(fixture.binDir, "bwrk"))).toBe(true);
  }, 40_000);

  it("repo mode installs only a repo dev dependency, verifies pnpm bwrk, and does not create machine state", async () => {
    const fixture = await makeFixture("boreal-install-repo-");
    await writePackageJson(fixture.cwd);

    const first = await runInstall(fixture, ["--repo", "--yes"]);
    const second = await runInstall(fixture, ["--repo", "--yes"]);
    const version = await runExternal("pnpm", ["bwrk", "--version"], fixture.cwd, fixtureEnv(fixture));
    const packageJson = JSON.parse(await readFile(join(fixture.cwd, "package.json"), "utf8")) as {
      readonly devDependencies?: Record<string, string>;
    };

    expect(first.exitCode).toBe(0);
    expect(second.exitCode).toBe(0);
    expect(first.stdout).toContain("Global manager registry not found; repo install did not create global state.");
    expect(version.exitCode).toBe(0);
    expect(version.stdout).toContain("boreal-work 0.1.0 (npm)");
    expect(packageJson.devDependencies?.["@boreal/cli"]).toBe("file:.boreal/bwrk-package");
    expect(await exists(join(fixture.binDir, "bwrk"))).toBe(false);
    expect(await exists(fixture.libDir)).toBe(false);
    expect(await exists(registryFile(fixture.registryRoot))).toBe(false);
  }, 40_000);

  it("repo mode links only when an existing registry is present and linking is not disabled", async () => {
    const linked = await makeFixture("boreal-install-repo-link-");
    await writePackageJson(linked.cwd);
    await initWorkspace(linked);
    await writeEmptyRegistry(linked.registryRoot);

    const linkedRun = await runInstall(linked, ["--repo", "--yes"]);
    const linkedRegistry = await readRegistry(linked.registryRoot);

    expect(linkedRun.exitCode).toBe(0);
    expect(linkedRun.stdout).toContain("Linked current repo to global manager registry");
    expect(linkedRegistry.entries).toHaveLength(1);
    expect(linkedRegistry.entries[0]?.bwrkPin).toEqual(
      expect.objectContaining({
        source: "node_modules",
        relativeBinPath: "node_modules/.bin/bwrk",
        packageName: "@boreal/cli"
      })
    );
    expect(await exists(join(linked.binDir, "bwrk"))).toBe(false);
    expect(await exists(linked.libDir)).toBe(false);

    const skipped = await makeFixture("boreal-install-repo-nolink-");
    await writePackageJson(skipped.cwd);
    await initWorkspace(skipped);
    await writeEmptyRegistry(skipped.registryRoot);

    const skippedRun = await runInstall(skipped, ["--repo", "--yes", "--no-link"]);
    const skippedRegistry = await readRegistry(skipped.registryRoot);

    expect(skippedRun.exitCode).toBe(0);
    expect(skippedRun.stdout).toContain("Repo link skipped by --no-link.");
    expect(skippedRegistry.entries).toEqual([]);
    expect(await exists(join(skipped.binDir, "bwrk"))).toBe(false);
    expect(await exists(skipped.libDir)).toBe(false);
  }, 60_000);

  it("honors non-interactive global overrides without creating global bootstrap state", async () => {
    const globalRequested = await makeFixture("boreal-install-global-flag-");
    const requested = await runInstall(globalRequested, ["--global", "--yes"]);

    expect(requested.exitCode).toBe(0);
    expect(requested.stdout).toContain("Global manager first-run bootstrap is not implemented by install.sh yet");
    expect(await exists(join(globalRequested.binDir, "bwrk"))).toBe(true);
    expect(await exists(registryFile(globalRequested.registryRoot))).toBe(false);

    const globalSkipped = await makeFixture("boreal-install-no-global-");
    await writePackageJson(globalSkipped.cwd);
    await initWorkspace(globalSkipped);
    await writeEmptyRegistry(globalSkipped.registryRoot);

    const skipped = await runInstall(globalSkipped, ["--no-global", "--yes"]);
    const skippedRegistry = await readRegistry(globalSkipped.registryRoot);

    expect(skipped.exitCode).toBe(0);
    expect(skipped.stdout).toContain("Global manager setup skipped by --no-global.");
    expect(skipped.stdout).toContain("Repo link skipped by --no-global.");
    expect(skippedRegistry.entries).toEqual([]);
    expect(await exists(join(globalSkipped.binDir, "bwrk"))).toBe(true);
  }, 50_000);
});

async function makeFixture(prefix: string): Promise<InstallFixture> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempDirs.push(root);
  const cwd = join(root, "repo");
  await mkdir(cwd, { recursive: true });
  return {
    root,
    cwd,
    binDir: join(root, "machine-bin"),
    libDir: join(root, "machine-lib"),
    registryRoot: join(root, "registry-root")
  };
}

async function writePackageJson(cwd: string): Promise<void> {
  await writeFile(join(cwd, "package.json"), `${JSON.stringify({ name: "boreal-install-fixture", private: true }, null, 2)}\n`, "utf8");
}

async function initWorkspace(fixture: InstallFixture): Promise<void> {
  const init = await runExternal(process.execPath, [bundledBin, "init", "--setup-memory", "--json"], fixture.cwd, fixtureEnv(fixture));
  expect(init.exitCode, init.stderr).toBe(0);
}

async function writeEmptyRegistry(registryRoot: string): Promise<void> {
  const registryDir = join(registryRoot, "registry");
  const file = registryFile(registryRoot);
  await mkdir(registryDir, { recursive: true });
  await writeFile(
    file,
    `${JSON.stringify({
      schemaVersion: "boreal.project-registry.v1",
      storage: {
        scope: "machine-local",
        rootDir: registryRoot,
        registryDir,
        registryFile: file,
        lockDir: join(registryDir, "projects.lock")
      },
      entries: []
    }, null, 2)}\n`,
    "utf8"
  );
}

async function readRegistry(registryRoot: string): Promise<{
  readonly entries: readonly Array<{ readonly projectRoot: string; readonly bwrkPin?: unknown }>;
}> {
  return JSON.parse(await readFile(registryFile(registryRoot), "utf8")) as {
    readonly entries: readonly Array<{ readonly projectRoot: string; readonly bwrkPin?: unknown }>;
  };
}

function registryFile(registryRoot: string): string {
  return join(registryRoot, "registry", "projects.json");
}

async function runInstall(fixture: InstallFixture, args: readonly string[]): Promise<CommandRun> {
  return runExternal("bash", [installScript, ...args], fixture.cwd, fixtureEnv(fixture));
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
      maxBuffer: 10 * 1024 * 1024
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

function fixtureEnv(fixture: InstallFixture): NodeJS.ProcessEnv {
  return {
    HOME: fixture.root,
    BOREAL_INSTALL_BIN_DIR: fixture.binDir,
    BOREAL_INSTALL_LIB_DIR: fixture.libDir,
    BOREAL_PROJECT_REGISTRY_ROOT: fixture.registryRoot,
    PNPM_HOME: join(fixture.root, "pnpm-home"),
    XDG_DATA_HOME: join(fixture.root, "xdg-data"),
    XDG_CACHE_HOME: join(fixture.root, "xdg-cache"),
    npm_config_cache: join(fixture.root, "npm-cache")
  };
}

function commandEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  delete env.BOREAL_ASSET_ROOT;
  delete env.BOREAL_BWRK_DELEGATED;
  if (!("BOREAL_INSTALL_CHANNEL" in overrides)) {
    delete env.BOREAL_INSTALL_CHANNEL;
  }
  return env;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
