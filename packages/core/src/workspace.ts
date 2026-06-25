import { resolve, relative, join } from "node:path";

import { BorealError } from "./errors.js";

export interface BorealWorkspacePaths {
  readonly rootDir: string;
  readonly borealDir: string;
  readonly runtimeDir: string;
  readonly stateFile: string;
  readonly stateLockDir: string;
}

export function resolveWorkspacePaths(rootDir: string): BorealWorkspacePaths {
  const absoluteRoot = resolve(rootDir);
  const borealDir = join(absoluteRoot, ".boreal");
  const runtimeDir = join(borealDir, "runtime");
  const stateFile = join(runtimeDir, "state.json");
  const stateLockDir = join(runtimeDir, "state.lock");
  return {
    rootDir: absoluteRoot,
    borealDir,
    runtimeDir,
    stateFile,
    stateLockDir
  };
}

export function assertPathInside(parentDir: string, childPath: string): void {
  const parent = resolve(parentDir);
  const child = resolve(childPath);
  const relation = relative(parent, child);
  const inside = relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
  if (!inside) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Path escapes Boreal workspace", {
      parentDir: parent,
      childPath: child
    });
  }
}
