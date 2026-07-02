import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

import {
  BWRK_DELEGATED_BIN_ENV,
  BWRK_DELEGATION_GUARD_ENV,
  BWRK_LAUNCHER_CHANNEL_ENV,
  BWRK_LAUNCHER_EXECUTABLE_ENV,
  BWRK_LAUNCHER_NAME_ENV,
  BWRK_LAUNCHER_VERSION_ENV
} from "./delegation-env.js";
import { findBorealWorkspaceRoot, findRepoBwrkRoot, pathsReferToSameFile, resolveRepoBwrkPin } from "./repo-binary-pin.js";
import { getVersionInfo } from "./version.js";

export const NO_DELEGATE_FLAG = "--no-delegate";

export interface DelegationResult {
  readonly delegated: boolean;
  readonly exitCode?: number;
  readonly reason?: string;
  readonly pinPath?: string;
  readonly workspaceRoot?: string;
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

  const pin = resolveRepoBwrkPin(workspaceRoot, { requireExisting: true });
  if (!pin) {
    return { delegated: false, reason: "no-pin", workspaceRoot };
  }
  if (pathsReferToSameFile(currentExecutable, pin.binPath)) {
    return { delegated: false, reason: "self", workspaceRoot, pinPath: pin.binPath };
  }

  const launcher = getVersionInfo();
  const result = spawnSync(pin.binPath, [...argv], {
    cwd,
    env: {
      ...env,
      [BWRK_DELEGATION_GUARD_ENV]: "1",
      [BWRK_LAUNCHER_NAME_ENV]: launcher.name,
      [BWRK_LAUNCHER_VERSION_ENV]: launcher.version,
      [BWRK_LAUNCHER_CHANNEL_ENV]: launcher.installChannel,
      [BWRK_LAUNCHER_EXECUTABLE_ENV]: currentExecutable ?? "",
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
    pinPath: pin.binPath
  };
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

function resolveUserPath(path: string, base = process.cwd()): string {
  const expanded = path.replace(/^~(?=$|\/)/u, homedir());
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}
