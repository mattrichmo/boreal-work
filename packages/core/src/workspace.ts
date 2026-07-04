import { lstat, realpath } from "node:fs/promises";
import { dirname, join, parse, relative, resolve } from "node:path";

import { BorealError } from "./errors.js";

export interface BorealWorkspacePaths {
  readonly rootDir: string;
  readonly borealDir: string;
  readonly runtimeDir: string;
  readonly stateFile: string;
  readonly stateLockDir: string;
  readonly eventLogFile: string;
}

export function resolveWorkspacePaths(rootDir: string): BorealWorkspacePaths {
  const absoluteRoot = resolve(rootDir);
  const borealDir = join(absoluteRoot, ".boreal");
  const runtimeDir = join(borealDir, "runtime");
  const stateFile = join(runtimeDir, "state.json");
  const stateLockDir = join(runtimeDir, "state.lock");
  const eventLogFile = join(borealDir, "log", "events.jsonl");
  return {
    rootDir: absoluteRoot,
    borealDir,
    runtimeDir,
    stateFile,
    stateLockDir,
    eventLogFile
  };
}

export function assertPathInside(parentDir: string, childPath: string): void {
  assertNoNullBytes(parentDir);
  assertNoNullBytes(childPath);
  const parent = resolve(parentDir);
  const child = resolve(childPath);
  assertResolvedInside(parent, child);
}

export async function assertRealPathInside(parentDir: string, childPath: string): Promise<void> {
  assertNoNullBytes(parentDir);
  assertNoNullBytes(childPath);
  const parent = await realpath(resolve(parentDir));
  const child = resolve(childPath);
  const existing = await deepestExistingPath(child);
  const existingReal = await realpath(existing);
  assertResolvedInside(parent, existingReal);
}

function assertResolvedInside(parent: string, child: string): void {
  const relation = relative(parent, child);
  const inside = relation === "" || (!relation.startsWith("..") && !relation.startsWith("/"));
  if (!inside) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Path escapes Boreal workspace", {
      parentDir: parent,
      childPath: child
    });
  }
}

function assertNoNullBytes(path: string): void {
  if (path.includes("\0")) {
    throw new BorealError("BOREAL_INVALID_INPUT", "Path contains a null byte");
  }
}

async function deepestExistingPath(path: string): Promise<string> {
  let current = resolve(path);
  const root = parse(current).root;
  while (current !== root) {
    try {
      await lstat(current);
      return current;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "ENOENT") {
        throw error;
      }
      current = dirname(current);
    }
  }
  return root;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
