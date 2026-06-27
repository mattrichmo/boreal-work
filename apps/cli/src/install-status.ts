import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { readJsonFile, type IsoTimestamp } from "@boreal/core";

import { getVersionInfo } from "./version.js";

const execFileAsync = promisify(execFile);
const SOURCE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_BIN_DIR = join(homedir(), ".local", "bin");
const GLOBAL_PROBE_TIMEOUT_MS = 5_000;

export const INSTALL_STATUS_SCHEMA_VERSION = "boreal.cli.install.status.v1";

export interface InstallStatusOptions {
  readonly workspaceRoot: string;
  readonly checkedAt: IsoTimestamp;
  readonly binDir?: string;
  readonly envPath?: string;
  readonly commandName?: string;
}

export interface InstallStatus {
  readonly schemaVersion: typeof INSTALL_STATUS_SCHEMA_VERSION;
  readonly workspaceRoot: string;
  readonly checkedAt: IsoTimestamp;
  readonly package: InstallPackageStatus;
  readonly localSource: LocalSourceStatus;
  readonly localShim: LocalShimStatus;
  readonly path: PathStatus;
  readonly globalCommand: GlobalCommandStatus;
  readonly recommendedActions: readonly string[];
}

export interface InstallPackageStatus {
  readonly name: string;
  readonly version: string;
  readonly packageManager?: string;
  readonly node: string;
}

export interface LocalSourceStatus {
  readonly sourceRoot: string;
  readonly available: boolean;
  readonly command: string;
  readonly packageScript: string;
  readonly packagePath: string;
  readonly cliEntrypoint: string;
  readonly reason?: string;
}

export interface LocalShimStatus {
  readonly binDir: string;
  readonly path: string;
  readonly exists: boolean;
  readonly executable: boolean;
  readonly targetCli?: string;
  readonly reason?: string;
}

export interface PathStatus {
  readonly envPath: string;
  readonly entries: readonly string[];
  readonly binDirOnPath: boolean;
  readonly addToPathCommand?: string;
}

export interface GlobalCommandStatus {
  readonly command: string;
  readonly found: boolean;
  readonly path?: string;
  readonly probe?: CommandProbeStatus;
}

export interface CommandProbeStatus {
  readonly ok: boolean;
  readonly command: readonly string[];
  readonly stdout: string;
  readonly stderr: string;
  readonly error?: string;
}

export async function inspectBorealInstallStatus(options: InstallStatusOptions): Promise<InstallStatus> {
  const commandName = options.commandName ?? "bwrk";
  const binDir = resolve(options.binDir ?? process.env.BOREAL_BIN_DIR ?? DEFAULT_BIN_DIR);
  const envPath = options.envPath ?? process.env.PATH ?? "";
  const entries = pathEntries(envPath);
  const [localSource, localShim] = await Promise.all([inspectLocalSource(), inspectLocalShim(binDir, commandName)]);
  const versionInfo = getVersionInfo();
  const globalPath = await resolveExecutableOnPath(commandName, envPath);
  const globalCommand: GlobalCommandStatus = globalPath
    ? {
        command: commandName,
        found: true,
        path: globalPath,
        probe: await probeCommand(globalPath, ["--version"])
      }
    : {
        command: commandName,
        found: false
      };
  const pathStatus: PathStatus = {
    envPath,
    entries,
    binDirOnPath: entries.some((entry) => resolve(entry) === binDir),
    addToPathCommand: pathAddCommand(binDir)
  };

  return {
    schemaVersion: INSTALL_STATUS_SCHEMA_VERSION,
    workspaceRoot: options.workspaceRoot,
    checkedAt: options.checkedAt,
    package: {
      name: versionInfo.name,
      version: versionInfo.version,
      packageManager: versionInfo.packageManager,
      node: versionInfo.node
    },
    localSource,
    localShim,
    path: pathStatus,
    globalCommand,
    recommendedActions: installStatusRecommendedActions({ localSource, localShim, pathStatus, globalCommand })
  };
}

export async function resolveExecutableOnPath(command: string, envPath: string): Promise<string | undefined> {
  for (const entry of pathEntries(envPath)) {
    for (const candidate of executableCandidates(entry, command)) {
      if (await isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }
  return undefined;
}

function pathEntries(envPath: string): readonly string[] {
  return envPath
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => resolve(entry));
}

function executableCandidates(directory: string, command: string): readonly string[] {
  if (process.platform !== "win32" || /\.[a-z0-9]+$/iu.test(command)) {
    return [join(directory, command)];
  }
  const extensions = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.trim())
    .filter((extension) => extension.length > 0);
  return [join(directory, command), ...extensions.map((extension) => join(directory, `${command}${extension}`))];
}

async function inspectLocalSource(): Promise<LocalSourceStatus> {
  const packagePath = join(SOURCE_ROOT, "package.json");
  const cliEntrypoint = join(SOURCE_ROOT, "apps", "cli", "src", "index.ts");
  const command = "pnpm bwrk <command>";
  try {
    const parsed = await readJsonFile(packagePath, {
      schemaName: "boreal.package.v1",
      expectedObject: true,
      maxBytes: 512 * 1024
    });
    const script = isRecord(parsed) && isRecord(parsed.scripts) ? parsed.scripts.bwrk : undefined;
    if (typeof script !== "string" || script.trim().length === 0) {
      return {
        sourceRoot: SOURCE_ROOT,
        available: false,
        command,
        packageScript: "",
        packagePath,
        cliEntrypoint,
        reason: "Root package.json does not define a bwrk script"
      };
    }
    if (!(await isRegularFile(cliEntrypoint))) {
      return {
        sourceRoot: SOURCE_ROOT,
        available: false,
        command,
        packageScript: script,
        packagePath,
        cliEntrypoint,
        reason: "CLI source entrypoint is missing"
      };
    }
    return {
      sourceRoot: SOURCE_ROOT,
      available: true,
      command,
      packageScript: script,
      packagePath,
      cliEntrypoint
    };
  } catch (error) {
    return {
      sourceRoot: SOURCE_ROOT,
      available: false,
      command,
      packageScript: "",
      packagePath,
      cliEntrypoint,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

async function inspectLocalShim(binDir: string, commandName: string): Promise<LocalShimStatus> {
  const shimPath = join(binDir, commandName);
  if (!(await isRegularFile(shimPath))) {
    return {
      binDir,
      path: shimPath,
      exists: false,
      executable: false,
      reason: "Shim is not installed"
    };
  }
  const [executable, targetCli] = await Promise.all([isExecutableFile(shimPath), readShimTarget(shimPath)]);
  return {
    binDir,
    path: shimPath,
    exists: true,
    executable,
    targetCli,
    reason: executable ? undefined : "Shim exists but is not executable"
  };
}

async function readShimTarget(path: string): Promise<string | undefined> {
  try {
    const text = await readFile(path, "utf8");
    const sourceRunnerMatch = /--tsconfig '[^']+' '([^']+)' "\$@"/u.exec(text);
    const distRunnerMatch = /exec node '([^']+)' "\$@"/u.exec(text);
    return sourceRunnerMatch?.[1] ?? distRunnerMatch?.[1];
  } catch {
    return undefined;
  }
}

async function probeCommand(command: string, args: readonly string[]): Promise<CommandProbeStatus> {
  const probeCommandLine = [command, ...args];
  try {
    const result = await execFileAsync(command, [...args], {
      timeout: GLOBAL_PROBE_TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 64 * 1024
    });
    return {
      ok: true,
      command: probeCommandLine,
      stdout: String(result.stdout).trim(),
      stderr: String(result.stderr).trim()
    };
  } catch (error) {
    const failure = error as { readonly stdout?: unknown; readonly stderr?: unknown; readonly message?: unknown };
    return {
      ok: false,
      command: probeCommandLine,
      stdout: typeof failure.stdout === "string" ? failure.stdout.trim() : "",
      stderr: typeof failure.stderr === "string" ? failure.stderr.trim() : "",
      error: typeof failure.message === "string" ? failure.message : String(error)
    };
  }
}

async function isRegularFile(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isFile();
  } catch {
    return false;
  }
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function pathAddCommand(binDir: string): string {
  return `export PATH=${shellQuote(binDir)}:$PATH`;
}

function installStatusRecommendedActions(input: {
  readonly localSource: LocalSourceStatus;
  readonly localShim: LocalShimStatus;
  readonly pathStatus: PathStatus;
  readonly globalCommand: GlobalCommandStatus;
}): readonly string[] {
  const actions: string[] = [];
  if (!input.localSource.available) {
    actions.push(`Run from a Boreal source checkout or use an installed ${input.globalCommand.command} binary.`);
  }
  if (!input.localShim.exists) {
    actions.push(`Run pnpm install:local -- --bin-dir ${shellQuote(input.localShim.binDir)}.`);
  } else if (!input.localShim.executable) {
    actions.push(`Run chmod +x ${shellQuote(input.localShim.path)}.`);
  }
  if (!input.pathStatus.binDirOnPath) {
    actions.push(`Add the local shim directory to PATH: ${input.pathStatus.addToPathCommand ?? pathAddCommand(input.localShim.binDir)}.`);
  }
  if (!input.globalCommand.found) {
    actions.push(`Open a new shell or add a directory containing ${input.globalCommand.command} to PATH.`);
  } else if (input.globalCommand.probe && !input.globalCommand.probe.ok) {
    actions.push(`Repair ${basename(input.globalCommand.path ?? input.globalCommand.command)} at ${input.globalCommand.path ?? "PATH"}.`);
  }
  return actions;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function installStatusHealthy(status: InstallStatus): boolean {
  const globalProbeHealthy = status.globalCommand.probe ? status.globalCommand.probe.ok : true;
  return (status.localSource.available || status.globalCommand.found) && globalProbeHealthy;
}

export function installStatusSummary(status: InstallStatus): string {
  if (status.globalCommand.found && status.globalCommand.probe?.ok) {
    return `Global ${status.globalCommand.command} resolves to ${status.globalCommand.path}`;
  }
  if (status.globalCommand.found) {
    return `Global ${status.globalCommand.command} resolves but failed version verification`;
  }
  if (status.localSource.available) {
    return `Local source runner is available; global ${status.globalCommand.command} is not on PATH`;
  }
  return `No local source runner or global ${status.globalCommand.command} command is available`;
}
