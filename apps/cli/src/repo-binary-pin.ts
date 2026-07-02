import { existsSync, realpathSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

export const DEFAULT_REPO_BWRK_RELATIVE_BIN = "node_modules/.bin/bwrk";
export const DEFAULT_REPO_BWRK_PACKAGE = "@boreal/cli";

export type RepoBwrkPinSource = "node_modules" | "project-config";

export interface ProjectConfigBwrkPin {
  readonly binPath: string;
  readonly packageName?: string;
}

export interface RepoBwrkPin {
  readonly source: RepoBwrkPinSource;
  readonly binPath: string;
  readonly relativeBinPath: string;
  readonly packageName?: string;
}

export type RepoBwrkPinResolution =
  | {
      readonly status: "found";
      readonly pin: RepoBwrkPin;
    }
  | {
      readonly status: "missing";
      readonly pin: RepoBwrkPin;
      readonly installCommand: "pnpm install";
      readonly reason: string;
    }
  | {
      readonly status: "none";
    };

export interface ResolveRepoBwrkPinOptions {
  readonly requireExisting?: boolean;
}

export function resolveRepoBwrkPin(
  workspaceRoot: string,
  options: ResolveRepoBwrkPinOptions = {}
): RepoBwrkPin | undefined {
  const root = resolveUserPath(workspaceRoot);
  const configPin = readProjectConfigBwrkPin(root);
  if (configPin) {
    const resolved = resolvePinPath(root, configPin.binPath);
    if (!options.requireExisting || existsSync(resolved)) {
      return pinMetadata(root, resolved, "project-config", configPin.packageName ?? inferPinnedPackageName(root));
    }
  }

  const defaultBin = join(root, DEFAULT_REPO_BWRK_RELATIVE_BIN);
  if (!options.requireExisting || existsSync(defaultBin)) {
    return pinMetadata(root, defaultBin, "node_modules", inferPinnedPackageName(root));
  }
  return undefined;
}

export function resolveRepoBwrkPinForDelegation(workspaceRoot: string): RepoBwrkPinResolution {
  const root = resolveUserPath(workspaceRoot);
  const configPin = readProjectConfigBwrkPin(root);
  if (configPin) {
    const resolved = resolvePinPath(root, configPin.binPath);
    const pin = pinMetadata(root, resolved, "project-config", configPin.packageName ?? inferPinnedPackageName(root));
    if (existsSync(resolved)) {
      return { status: "found", pin };
    }
    return {
      status: "missing",
      pin,
      installCommand: "pnpm install",
      reason: "Configured repo-pinned bwrk binary is missing"
    };
  }

  const defaultBin = join(root, DEFAULT_REPO_BWRK_RELATIVE_BIN);
  if (existsSync(defaultBin)) {
    return { status: "found", pin: pinMetadata(root, defaultBin, "node_modules", inferPinnedPackageName(root)) };
  }
  return { status: "none" };
}

export function pathsReferToSameFile(left: string | undefined, right: string | undefined): boolean {
  if (!left || !right) {
    return false;
  }
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return resolve(left) === resolve(right);
  }
}

export function findBorealWorkspaceRoot(start: string): string | undefined {
  return findAncestorWithPath(start, ".boreal");
}

export function findRepoBwrkRoot(start: string): string | undefined {
  return findAncestorWithPath(start, DEFAULT_REPO_BWRK_RELATIVE_BIN);
}

function readProjectConfigBwrkPin(workspaceRoot: string): ProjectConfigBwrkPin | undefined {
  const configPath = join(workspaceRoot, ".boreal", "project.json");
  if (!existsSync(configPath)) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf8")) as { readonly bwrkPin?: unknown };
    return isProjectConfigBwrkPin(parsed.bwrkPin) ? parsed.bwrkPin : undefined;
  } catch {
    return undefined;
  }
}

function isProjectConfigBwrkPin(value: unknown): value is ProjectConfigBwrkPin {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return typeof record.binPath === "string" && (record.packageName === undefined || typeof record.packageName === "string");
}

function resolvePinPath(workspaceRoot: string, binPath: string): string {
  const expanded = resolveUserPath(binPath, workspaceRoot);
  return isAbsolute(expanded) ? resolve(expanded) : resolve(workspaceRoot, expanded);
}

function resolveUserPath(path: string, base = process.cwd()): string {
  const expanded = path.replace(/^~(?=$|\/)/u, homedir());
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

function pinMetadata(
  workspaceRoot: string,
  binPath: string,
  source: RepoBwrkPinSource,
  packageName: string | undefined
): RepoBwrkPin {
  const absoluteBin = resolve(binPath);
  return {
    source,
    binPath: absoluteBin,
    relativeBinPath: relative(workspaceRoot, absoluteBin) || ".",
    packageName
  };
}

function inferPinnedPackageName(workspaceRoot: string): string | undefined {
  for (const packageName of [DEFAULT_REPO_BWRK_PACKAGE, "boreal-work"]) {
    try {
      const packageJsonPath = join(workspaceRoot, "node_modules", packageName, "package.json");
      const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { readonly name?: unknown };
      if (typeof parsed.name === "string" && parsed.name.length > 0) {
        return parsed.name;
      }
    } catch {
      continue;
    }
  }
  return DEFAULT_REPO_BWRK_PACKAGE;
}

function findAncestorWithPath(start: string, relativePath: string): string | undefined {
  let current = resolveUserPath(start);
  while (true) {
    if (existsSync(join(current, relativePath))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return undefined;
    }
    current = parent;
  }
}
