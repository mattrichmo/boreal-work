import {
  DEFAULT_FILE_LOCK_OPTIONS,
  inspectFileLock,
  withFileLock,
  type FileLockInspection
} from "@boreal/storage";

import type { CliContext } from "./context.js";
import { searchIndexLockDir } from "./search-cli.js";

export type RuntimeLockName = "state" | "searchIndex";

export interface RuntimeLockTarget {
  readonly name: RuntimeLockName;
  readonly codePrefix: string;
  readonly path: string;
  readonly label: string;
  readonly breakHint: string;
}

export interface RuntimeLockState {
  readonly name: RuntimeLockName;
  readonly codePrefix: string;
  readonly label: string;
  readonly path: string;
  readonly breakHint: string;
  readonly status: "absent" | "active" | "stale";
  readonly diagnosticCode: string;
  readonly inspection: FileLockInspection;
}

export interface RuntimeLockInspectionResult extends FileLockInspection {
  readonly schemaVersion: "boreal.cli.lock-inspect.v1";
  readonly ok: boolean;
  readonly workspaceRoot: string;
  readonly locks: readonly RuntimeLockState[];
  readonly state: FileLockInspection;
  readonly searchIndex: FileLockInspection;
}

/**
 * Runtime writers acquire the workspace state lock before the event-log lock.
 * Keep maintenance mutations on the same order so they cannot interleave with
 * FileBorealStore/ObjectDirBorealStore transactions.
 */
export function withRuntimeWriteLock<T>(context: CliContext, operation: () => Promise<T>): Promise<T> {
  return withFileLock(context.paths.stateLockDir, DEFAULT_FILE_LOCK_OPTIONS, operation);
}

export async function inspectRuntimeLocks(context: CliContext): Promise<RuntimeLockInspectionResult> {
  const targets = runtimeLockTargets(context);
  const locks = await Promise.all(
    targets.map(async (target): Promise<RuntimeLockState> => {
      const inspection = await inspectFileLock(target.path);
      const status = lockStatus(inspection);
      return {
        name: target.name,
        codePrefix: target.codePrefix,
        label: target.label,
        path: target.path,
        breakHint: target.breakHint,
        status,
        diagnosticCode: `${target.codePrefix}.${status}`,
        inspection
      };
    })
  );
  const state = requireRuntimeLock(locks, "state").inspection;
  const searchIndex = requireRuntimeLock(locks, "searchIndex").inspection;
  return {
    schemaVersion: "boreal.cli.lock-inspect.v1",
    ok: locks.every((lock) => lock.status !== "stale"),
    workspaceRoot: context.workspaceRoot,
    locks,
    state,
    searchIndex,
    exists: state.exists,
    stale: state.stale,
    lockDir: state.lockDir,
    owner: state.owner,
    ageMs: state.ageMs,
    ownerPidAlive: state.ownerPidAlive,
    staleReason: state.staleReason
  };
}

export function runtimeLockTargets(context: CliContext): readonly RuntimeLockTarget[] {
  return [
    {
      name: "state",
      codePrefix: "lock",
      path: context.paths.stateLockDir,
      label: "runtime state",
      breakHint: " or `bwrk lock break --stale-only`"
    },
    {
      name: "searchIndex",
      codePrefix: "lock.search_index",
      path: searchIndexLockDir(context),
      label: "search index",
      breakHint: ""
    }
  ];
}

function lockStatus(inspection: FileLockInspection): RuntimeLockState["status"] {
  if (!inspection.exists) {
    return "absent";
  }
  return inspection.stale ? "stale" : "active";
}

function requireRuntimeLock(locks: readonly RuntimeLockState[], name: RuntimeLockName): RuntimeLockState {
  const lock = locks.find((candidate) => candidate.name === name);
  if (!lock) {
    throw new Error(`Missing ${name} lock inspection`);
  }
  return lock;
}
