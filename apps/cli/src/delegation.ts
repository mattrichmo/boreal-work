import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import { expandGlobalNamespace, parseArgs } from "./args.js";
import { commandBehavior, commandPath, findCommandDefinition } from "./command-registry.js";
import {
  BWRK_DELEGATED_BIN_ENV,
  BWRK_DELEGATION_GUARD_ENV,
  BWRK_LAUNCHER_AGENT_ASSET_DIGEST_ENV,
  BWRK_LAUNCHER_ARTIFACT_DIGEST_ENV,
  BWRK_LAUNCHER_BUILD_SHA_ENV,
  BWRK_LAUNCHER_CHANNEL_ENV,
  BWRK_LAUNCHER_EXECUTABLE_ENV,
  BWRK_LAUNCHER_NAME_ENV,
  BWRK_LAUNCHER_VERSION_ENV
} from "./delegation-env.js";
import {
  findBorealWorkspaceRoot,
  findRepoBwrkRoot,
  pathsReferToSameFile,
  resolveRepoBwrkPinForDelegation
} from "./repo-binary-pin.js";
import {
  assertCanonicalWritesAllowed,
  inspectProjectToolchainSync,
  isToolchainRecoveryCommand,
  type ProjectToolchainStatus
} from "./toolchain.js";
import { getVersionInfo } from "./version.js";

export const NO_DELEGATE_FLAG = "--no-delegate";

export interface DelegationResult {
  readonly delegated: boolean;
  readonly exitCode?: number;
  readonly reason?: string;
  readonly pinPath?: string;
  readonly workspaceRoot?: string;
  readonly toolchainMode?: ProjectToolchainStatus["mode"];
}

export interface DelegateToRepoBwrkOptions {
  readonly argv?: readonly string[];
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly currentExecutable?: string;
}

export function delegateToRepoPinnedBwrk(options: DelegateToRepoBwrkOptions = {}): DelegationResult {
  const argv = options.argv ?? process.argv.slice(2);
  const cwd = resolveUserPath(options.cwd ?? process.cwd());
  const env = options.env ?? process.env;
  const currentExecutable = options.currentExecutable ?? process.argv[1];

  if (hasNoDelegateFlag(argv)) {
    return { delegated: false, reason: "disabled" };
  }
  if (env[BWRK_DELEGATION_GUARD_ENV]) {
    return { delegated: false, reason: "guarded" };
  }
  if (isGlobalInvocation(argv)) {
    return { delegated: false, reason: "global" };
  }

  const workspaceRoot = resolveWorkspaceRootForDelegation(argv, cwd);
  if (!workspaceRoot) {
    return { delegated: false, reason: "no-workspace" };
  }

  const launcherToolchain = inspectProjectToolchainSync(workspaceRoot);

  const pinResolution = resolveRepoBwrkPinForDelegation(workspaceRoot);
  if (pinResolution.status === "none") {
    if (argvWritesCanonicalState(argv) && !launcherToolchain.canonicalWritesAllowed) {
      writeToolchainMismatchError(launcherToolchain, argv);
      return { delegated: true, exitCode: 1, reason: "toolchain-incompatible", workspaceRoot, toolchainMode: launcherToolchain.mode };
    }
    return { delegated: false, reason: "no-pin", workspaceRoot, toolchainMode: launcherToolchain.mode };
  }
  if (pinResolution.status === "missing") {
    writeMissingRepoPinError(workspaceRoot, pinResolution, argv);
    return { delegated: true, exitCode: 1, reason: "pin-missing", workspaceRoot, pinPath: pinResolution.pin.binPath };
  }
  const pin = pinResolution.pin;
  if (pathsReferToSameFile(currentExecutable, pin.binPath)) {
    if (argvWritesCanonicalState(argv) && !launcherToolchain.canonicalWritesAllowed) {
      writeToolchainMismatchError(launcherToolchain, argv);
      return {
        delegated: true,
        exitCode: 1,
        reason: "toolchain-incompatible",
        workspaceRoot,
        pinPath: pin.binPath,
        toolchainMode: launcherToolchain.mode
      };
    }
    return { delegated: false, reason: "self", workspaceRoot, pinPath: pin.binPath, toolchainMode: launcherToolchain.mode };
  }

  const launcher = getVersionInfo();
  if (argvWritesCanonicalState(argv)) {
    const pinnedIdentity = probePinnedBuildIdentity(pin.binPath, cwd, env);
    const pinnedToolchain = pinnedIdentity
      ? inspectProjectToolchainSync(workspaceRoot, pinnedIdentity)
      : {
          ...launcherToolchain,
          mode: "compatibility-read" as const,
          canonicalWritesAllowed: false,
          findings: ["repo_pinned_build_identity_unavailable"]
        };
    if (!pinnedToolchain.canonicalWritesAllowed) {
      writeToolchainMismatchError(pinnedToolchain, argv);
      return {
        delegated: true,
        exitCode: 1,
        reason: "toolchain-incompatible",
        workspaceRoot,
        pinPath: pin.binPath,
        toolchainMode: pinnedToolchain.mode
      };
    }
  }
  const result = spawnSync(pin.binPath, [...argv], {
    cwd,
    env: {
      ...env,
      [BWRK_DELEGATION_GUARD_ENV]: "1",
      [BWRK_LAUNCHER_NAME_ENV]: launcher.name,
      [BWRK_LAUNCHER_VERSION_ENV]: launcher.version,
      [BWRK_LAUNCHER_CHANNEL_ENV]: launcher.installChannel,
      [BWRK_LAUNCHER_EXECUTABLE_ENV]: currentExecutable ?? "",
      [BWRK_LAUNCHER_BUILD_SHA_ENV]: launcher.build.buildSha,
      [BWRK_LAUNCHER_ARTIFACT_DIGEST_ENV]: launcher.build.artifactDigest,
      [BWRK_LAUNCHER_AGENT_ASSET_DIGEST_ENV]: launcher.build.agentAssetDigest,
      [BWRK_DELEGATED_BIN_ENV]: pin.binPath
    },
    stdio: "inherit"
  });

  if (result.error) {
    process.stderr.write(`Failed to delegate bwrk to repo-pinned binary at ${pin.binPath}: ${result.error.message}\n`);
    return { delegated: true, exitCode: 1, reason: "spawn-error", workspaceRoot, pinPath: pin.binPath };
  }
  if (result.signal) {
    process.stderr.write(`Repo-pinned bwrk terminated with signal ${result.signal}\n`);
    return { delegated: true, exitCode: 1, reason: "signal", workspaceRoot, pinPath: pin.binPath };
  }

  return {
    delegated: true,
    exitCode: result.status ?? 0,
    reason: "delegated",
    workspaceRoot,
    pinPath: pin.binPath,
    toolchainMode: launcherToolchain.mode
  };
}

function probePinnedBuildIdentity(
  binPath: string,
  cwd: string,
  env: NodeJS.ProcessEnv
): ReturnType<typeof getVersionInfo>["build"] | undefined {
  const result = spawnSync(binPath, ["--no-delegate", "--version", "--json"], {
    cwd,
    env: { ...env, [BWRK_DELEGATION_GUARD_ENV]: "1" },
    encoding: "utf8",
    timeout: 10_000,
    maxBuffer: 1_000_000
  });
  if (result.error || result.signal || result.status !== 0 || typeof result.stdout !== "string") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(result.stdout) as { readonly data?: { readonly build?: ReturnType<typeof getVersionInfo>["build"] } };
    return parsed.data?.build;
  } catch {
    return undefined;
  }
}

function argvWritesCanonicalState(argv: readonly string[]): boolean {
  if (argv.includes("--version") || argv.includes("--about") || argv.includes("--help") || argv[0] === "help") {
    return false;
  }
  try {
    const parsed = parseArgs(expandGlobalNamespace(stripNoDelegateArgv(argv)));
    const definition = findCommandDefinition(parsed.command);
    return definition
      ? commandBehavior(definition).writesState && !isToolchainRecoveryCommand(commandPath(definition))
      : false;
  } catch {
    return false;
  }
}

function writeToolchainMismatchError(status: ProjectToolchainStatus, argv: readonly string[]): void {
  let error: unknown;
  try {
    assertCanonicalWritesAllowed(status, argv.join(" "));
  } catch (caught) {
    error = caught;
  }
  const candidate = error as { readonly code?: string; readonly message?: string; readonly details?: unknown };
  const payload = {
    ok: false,
    code: candidate.code ?? "BOREAL_POLICY_VIOLATION",
    message: candidate.message ?? "Boreal toolchain lock mismatch",
    details: candidate.details ?? { findings: status.findings }
  };
  if (argvWantsJson(argv)) {
    process.stderr.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }
  process.stderr.write(`${payload.code}: ${payload.message}\n`);
}

export function stripNoDelegateArgv(argv: readonly string[]): readonly string[] {
  return argv.filter((arg) => arg !== NO_DELEGATE_FLAG && !arg.startsWith(`${NO_DELEGATE_FLAG}=`));
}

export function hasNoDelegateFlag(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === NO_DELEGATE_FLAG || arg === `${NO_DELEGATE_FLAG}=true`);
}

function resolveWorkspaceRootForDelegation(argv: readonly string[], cwd: string): string | undefined {
  const explicit = explicitWorkspaceArg(argv);
  if (explicit) {
    return resolveUserPath(explicit, cwd);
  }
  return findBorealWorkspaceRoot(cwd) ?? findRepoBwrkRoot(cwd);
}

function explicitWorkspaceArg(argv: readonly string[]): string | undefined {
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--workspace" || arg === "--project-root") {
      return argv[index + 1];
    }
    if (arg?.startsWith("--workspace=")) {
      return arg.slice("--workspace=".length);
    }
    if (arg?.startsWith("--project-root=")) {
      return arg.slice("--project-root=".length);
    }
  }
  return undefined;
}

function isGlobalInvocation(argv: readonly string[]): boolean {
  return argv.includes("--global") || argv.some((arg) => arg.startsWith("--global=") && arg !== "--global=false") || argv[0] === "global";
}

function writeMissingRepoPinError(
  workspaceRoot: string,
  resolution: Extract<ReturnType<typeof resolveRepoBwrkPinForDelegation>, { readonly status: "missing" }>,
  argv: readonly string[]
): void {
  const message = `${resolution.reason} at ${resolution.pin.relativeBinPath}; run \`${resolution.installCommand}\` in ${workspaceRoot} before using a machine bwrk binary here.`;
  const details = {
    reason: "repo_pinned_bwrk_missing",
    workspaceRoot,
    pinPath: resolution.pin.binPath,
    relativeBinPath: resolution.pin.relativeBinPath,
    source: resolution.pin.source,
    packageName: resolution.pin.packageName,
    installCommand: resolution.installCommand
  };
  if (argvWantsJson(argv)) {
    process.stderr.write(
      `${JSON.stringify(
        {
          ok: false,
          code: "BOREAL_POLICY_VIOLATION",
          message,
          details
        },
        null,
        2
      )}\n`
    );
    return;
  }
  process.stderr.write(`BOREAL_POLICY_VIOLATION: ${message}\n`);
}

function argvWantsJson(argv: readonly string[]): boolean {
  return argv.some((arg) => arg === "--json" || arg === "--json=true");
}

function resolveUserPath(path: string, base = process.cwd()): string {
  const expanded = path.replace(/^~(?=$|\/)/u, homedir());
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}
