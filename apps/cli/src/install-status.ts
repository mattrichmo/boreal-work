import { execFile } from "node:child_process";
import { constants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { readJsonFile, type IsoTimestamp } from "@boreal/core";

import { installUpgradeStatus, type InstallChannel, type InstallUpgradeStatus } from "./install-channel.js";
import { getVersionInfo, type VersionInfo } from "./version.js";

const execFileAsync = promisify(execFile);
const SOURCE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const DEFAULT_BIN_DIR = join(homedir(), ".local", "bin");
const GLOBAL_PROBE_TIMEOUT_MS = 5_000;

export const INSTALL_STATUS_SCHEMA_VERSION = "boreal.cli.install.status.v1";
export const BINARY_IDENTITY_SCHEMA_VERSION = "boreal.cli.binary.identity.v1";

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
  readonly upgrade: InstallUpgradeStatus;
  readonly localSource: LocalSourceStatus;
  readonly localShim: LocalShimStatus;
  readonly path: PathStatus;
  readonly globalCommand: GlobalCommandStatus;
  readonly effectiveBinary: EffectiveBinaryStatus;
  readonly recommendedActions: readonly string[];
}

export interface BinaryIdentity {
  readonly schemaVersion: typeof BINARY_IDENTITY_SCHEMA_VERSION;
  readonly name: string;
  readonly version: string;
  readonly installChannel: string;
  readonly executable?: string;
  readonly build?: VersionInfo["build"];
}

export interface InstallProvenanceStatus {
  readonly manifestPath: string;
  readonly schemaVersion?: string;
  readonly transactionId?: string;
  readonly operation?: string;
  readonly status?: string;
  readonly installedAt?: string;
  readonly source?: unknown;
}

export interface InstallPackageStatus {
  readonly name: string;
  readonly version: string;
  readonly packageManager?: string;
  readonly installChannel: InstallChannel;
  readonly node: string;
}

export interface LocalSourceStatus {
  readonly sourceRoot: string;
  readonly available: boolean;
  readonly command: string;
  readonly packageScript: string;
  readonly packagePath: string;
  readonly cliEntrypoint: string;
  readonly identity: BinaryIdentity;
  readonly reason?: string;
}

export interface LocalShimStatus {
  readonly binDir: string;
  readonly path: string;
  readonly exists: boolean;
  readonly executable: boolean;
  readonly targetCli?: string;
  readonly provenance?: InstallProvenanceStatus;
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
  readonly identity?: BinaryIdentity;
  readonly provenance?: InstallProvenanceStatus;
}

export interface EffectiveBinaryStatus {
  readonly source: "path" | "source" | "unavailable";
  readonly path?: string;
  readonly identity?: BinaryIdentity;
  readonly provenance?: InstallProvenanceStatus;
  readonly verified: boolean;
  readonly reason?: string;
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
        probe: await probeCommand(globalPath, ["--version"]),
        identity: await probeBinaryIdentity(globalPath),
        provenance: await readInstallProvenanceForExecutable(globalPath)
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
  const upgrade = installUpgradeStatus(versionInfo.installChannel);
  const effectiveBinary: EffectiveBinaryStatus = globalCommand.found
    ? {
        source: "path",
        path: globalCommand.path,
        identity: globalCommand.identity,
        provenance: globalCommand.provenance,
        verified: Boolean(globalCommand.probe?.ok && globalCommand.identity),
        ...(globalCommand.identity ? {} : { reason: "Resolved command did not return a machine-readable build identity" })
      }
    : localSource.available
      ? {
          source: "source",
          path: localSource.cliEntrypoint,
          identity: localSource.identity,
          verified: true
        }
      : { source: "unavailable", verified: false, reason: "No executable or source CLI is available" };

  return {
    schemaVersion: INSTALL_STATUS_SCHEMA_VERSION,
    workspaceRoot: options.workspaceRoot,
    checkedAt: options.checkedAt,
    package: {
      name: versionInfo.name,
      version: versionInfo.version,
      packageManager: versionInfo.packageManager,
      installChannel: versionInfo.installChannel,
      node: versionInfo.node
    },
    upgrade,
    localSource,
    localShim,
    path: pathStatus,
    globalCommand,
    effectiveBinary,
    recommendedActions: installStatusRecommendedActions({ localSource, localShim, pathStatus, globalCommand, upgrade })
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
  return [...extensions.map((extension) => join(directory, `${command}${extension}`)), join(directory, command)];
}

async function inspectLocalSource(): Promise<LocalSourceStatus> {
  const packagePath = join(SOURCE_ROOT, "package.json");
  const cliEntrypoint = join(SOURCE_ROOT, "apps", "cli", "src", "index.ts");
  const command = "pnpm bwrk <command>";
  const identity = binaryIdentityFromVersionInfo(getVersionInfo(), cliEntrypoint);
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
        identity,
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
        identity,
        reason: "CLI source entrypoint is missing"
      };
    }
    return {
      sourceRoot: SOURCE_ROOT,
      available: true,
      command,
      packageScript: script,
      packagePath,
      cliEntrypoint,
      identity
    };
  } catch (error) {
    return {
      sourceRoot: SOURCE_ROOT,
      available: false,
      command,
      packageScript: "",
      packagePath,
      cliEntrypoint,
      identity,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}

async function inspectLocalShim(binDir: string, commandName: string): Promise<LocalShimStatus> {
  const candidates = executableCandidates(binDir, commandName);
  const preferredPath = process.platform === "win32" && !/\.[a-z0-9]+$/iu.test(commandName)
    ? join(binDir, `${commandName}.cmd`)
    : join(binDir, commandName);
  const shimPath = await firstRegularFile([preferredPath, ...candidates]) ?? preferredPath;
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
    provenance: await readInstallProvenanceForExecutable(targetCli ?? shimPath),
    reason: executable ? undefined : "Shim exists but is not executable"
  };
}

async function readShimTarget(path: string): Promise<string | undefined> {
  try {
    const text = await readFile(path, "utf8");
    const sourceRunnerMatch = /--tsconfig '[^']+' '([^']+)' "\$@"/u.exec(text);
    const windowsSourceRunnerMatch = /--tsconfig "[^"]+" "([^"]+)" %\*/u.exec(text);
    const distRunnerMatch = /exec node '([^']+)' "\$@"/u.exec(text);
    return sourceRunnerMatch?.[1] ?? windowsSourceRunnerMatch?.[1] ?? distRunnerMatch?.[1];
  } catch {
    return undefined;
  }
}

async function probeCommand(command: string, args: readonly string[]): Promise<CommandProbeStatus> {
  const probeCommandLine = [command, ...args];
  try {
    const isWindowsCommandScript = process.platform === "win32" && /\.(?:cmd|bat)$/iu.test(command);
    const executable = isWindowsCommandScript ? process.env.ComSpec ?? "cmd.exe" : command;
    const executableArgs = isWindowsCommandScript
      ? ["/d", "/s", "/c", windowsCommandLine(command, args)]
      : [...args];
    const result = await execFileAsync(executable, executableArgs, {
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

async function probeBinaryIdentity(command: string): Promise<BinaryIdentity | undefined> {
  const probe = await probeCommand(command, ["--no-delegate", "--version", "--json"]);
  if (!probe.ok) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(probe.stdout) as { readonly data?: unknown };
    if (!isRecord(parsed?.data)) {
      return undefined;
    }
    const data = parsed.data;
    if (typeof data.name !== "string" || typeof data.version !== "string" || typeof data.installChannel !== "string") {
      return undefined;
    }
    const build = parseBuildIdentity(data.build);
    return {
      schemaVersion: BINARY_IDENTITY_SCHEMA_VERSION,
      name: data.name,
      version: data.version,
      installChannel: data.installChannel,
      executable: command,
      ...(build ? { build } : {})
    };
  } catch {
    return undefined;
  }
}

function binaryIdentityFromVersionInfo(info: VersionInfo, executable: string): BinaryIdentity {
  return {
    schemaVersion: BINARY_IDENTITY_SCHEMA_VERSION,
    name: info.name,
    version: info.version,
    installChannel: info.installChannel,
    executable,
    build: info.build
  };
}

function parseBuildIdentity(value: unknown): VersionInfo["build"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const strings = ["semanticVersion", "buildSha", "artifactDigest", "agentAssetDigest"];
  const numbers = ["protocolEpoch", "writerEpoch", "readerEpoch", "cacheEpoch"];
  if (!strings.every((key) => typeof value[key] === "string") || !numbers.every((key) => typeof value[key] === "number")) {
    return undefined;
  }
  return {
    semanticVersion: value.semanticVersion as string,
    buildSha: value.buildSha as string,
    artifactDigest: value.artifactDigest as string,
    protocolEpoch: value.protocolEpoch as number,
    writerEpoch: value.writerEpoch as number,
    readerEpoch: value.readerEpoch as number,
    cacheEpoch: value.cacheEpoch as number,
    agentAssetDigest: value.agentAssetDigest as string
  };
}

async function readInstallProvenanceForExecutable(executable: string): Promise<InstallProvenanceStatus | undefined> {
  const target = await readShimTarget(executable) ?? executable;
  const manifestPath = join(dirname(dirname(resolve(target))), "install-manifest.json");
  try {
    const parsed = await readJsonFile(manifestPath, {
      schemaName: "boreal.install.manifest.v1",
      expectedObject: true,
      maxBytes: 256 * 1024
    });
    if (!isRecord(parsed)) {
      return undefined;
    }
    return {
      manifestPath,
      ...(typeof parsed.schemaVersion === "string" ? { schemaVersion: parsed.schemaVersion } : {}),
      ...(typeof parsed.transactionId === "string" ? { transactionId: parsed.transactionId } : {}),
      ...(typeof parsed.operation === "string" ? { operation: parsed.operation } : {}),
      ...(typeof parsed.status === "string" ? { status: parsed.status } : {}),
      ...(typeof parsed.installedAt === "string" ? { installedAt: parsed.installedAt } : {}),
      ...("source" in parsed ? { source: parsed.source } : {})
    };
  } catch {
    return undefined;
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

async function firstRegularFile(paths: readonly string[]): Promise<string | undefined> {
  for (const path of [...new Set(paths)]) {
    if (await isRegularFile(path)) {
      return path;
    }
  }
  return undefined;
}

async function isExecutableFile(path: string): Promise<boolean> {
  try {
    if (process.platform === "win32") {
      return (await stat(path)).isFile();
    }
    await access(path, constants.X_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function pathAddCommand(binDir: string): string {
  if (process.platform === "win32") {
    return `set "PATH=${binDir};%PATH%"`;
  }
  return `export PATH=${shellQuote(binDir)}:$PATH`;
}

function installStatusRecommendedActions(input: {
  readonly localSource: LocalSourceStatus;
  readonly localShim: LocalShimStatus;
  readonly pathStatus: PathStatus;
  readonly globalCommand: GlobalCommandStatus;
  readonly upgrade: InstallUpgradeStatus;
}): readonly string[] {
  const actions: string[] = [`Upgrade ${input.globalCommand.command} via ${input.upgrade.channel}: ${input.upgrade.command}.`];
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
  if (process.platform === "win32") {
    return cmdQuote(value);
  }
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function windowsCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(cmdQuote).join(" ");
}

function cmdQuote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function installStatusHealthy(status: InstallStatus): boolean {
  const globalProbeHealthy = status.globalCommand.probe ? status.globalCommand.probe.ok : true;
  return (status.localSource.available || status.globalCommand.found) && globalProbeHealthy;
}

export function installStatusSummary(status: InstallStatus): string {
  const suffix = ` (${status.package.installChannel} channel; upgrade: ${status.upgrade.command})`;
  if (status.globalCommand.found && status.globalCommand.probe?.ok) {
    return `Global ${status.globalCommand.command} resolves to ${status.globalCommand.path}${suffix}`;
  }
  if (status.globalCommand.found) {
    return `Global ${status.globalCommand.command} resolves but failed version verification${suffix}`;
  }
  if (status.localSource.available) {
    return `Local source runner is available; global ${status.globalCommand.command} is not on PATH${suffix}`;
  }
  return `No local source runner or global ${status.globalCommand.command} command is available${suffix}`;
}
