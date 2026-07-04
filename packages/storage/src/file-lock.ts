import { randomUUID } from "node:crypto";
import { mkdir, rm, stat } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import { BorealError, nowIso, readJsonFile } from "@boreal/core";
import { writeTextFileAtomic } from "./atomic-write.js";

export interface FileLockOptions {
  readonly waitTimeoutMs: number;
  readonly staleAfterMs: number;
  readonly retryDelayMs: number;
}

export const DEFAULT_FILE_LOCK_OPTIONS: FileLockOptions = {
  waitTimeoutMs: 10_000,
  staleAfterMs: 60_000,
  retryDelayMs: 25
};

export function normalizeFileLockOptions(input?: Partial<FileLockOptions>): FileLockOptions {
  const options = { ...DEFAULT_FILE_LOCK_OPTIONS, ...input };
  assertPositiveInteger(options.waitTimeoutMs, "waitTimeoutMs");
  assertPositiveInteger(options.staleAfterMs, "staleAfterMs");
  assertPositiveInteger(options.retryDelayMs, "retryDelayMs");
  return options;
}

export interface LockOwner {
  readonly token: string;
  readonly pid: number;
  readonly hostname: string;
  readonly createdAt: string;
  readonly lastHeartbeatAt?: string;
}

export interface FileLockInspection {
  readonly exists: boolean;
  readonly stale: boolean;
  readonly lockDir: string;
  readonly owner?: LockOwner;
  readonly ageMs?: number;
  readonly ownerPidAlive?: boolean;
  readonly staleReason?: "owner_pid_exited" | "owner_heartbeat_expired" | "lock_mtime_expired";
}

export async function withFileLock<T>(
  lockDir: string,
  options: FileLockOptions,
  operation: () => Promise<T>
): Promise<T> {
  const lock = await acquireFileLock(lockDir, options);
  const heartbeat = startLockHeartbeat(lockDir, lock, options);
  try {
    return await operation();
  } finally {
    await heartbeat.stop();
    await releaseFileLock(lockDir, lock.token);
  }
}

export async function inspectFileLock(
  lockDir: string,
  input?: Partial<FileLockOptions>
): Promise<FileLockInspection> {
  const options = normalizeFileLockOptions(input);
  const stats = await stat(lockDir).catch(() => undefined);
  if (!stats) {
    return {
      exists: false,
      stale: false,
      lockDir
    };
  }

  const owner = await readLockOwner(lockDir);
  const stale = await assessLockStaleness(lockDir, owner, options.staleAfterMs);
  const freshestAt = owner ? Date.parse(owner.lastHeartbeatAt ?? owner.createdAt) : Number.NaN;
  const ageMs = Number.isFinite(freshestAt) ? Date.now() - freshestAt : Date.now() - stats.mtimeMs;
  return {
    exists: true,
    stale: stale.stale,
    lockDir,
    owner,
    ageMs,
    ownerPidAlive: stale.ownerPidAlive,
    staleReason: stale.staleReason
  };
}

export async function breakStaleFileLock(
  lockDir: string,
  input?: Partial<FileLockOptions>
): Promise<{ readonly removed: boolean; readonly inspection: FileLockInspection }> {
  return removeStaleFileLock(lockDir, normalizeFileLockOptions(input), true);
}

async function acquireFileLock(lockDir: string, options: FileLockOptions): Promise<LockOwner> {
  const startedAt = Date.now();
  const owner: LockOwner = {
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    createdAt: nowIso(),
    lastHeartbeatAt: nowIso()
  };

  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      try {
        await writeLockOwner(lockDir, owner);
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        if (isNodeError(error) && error.code === "ENOENT") {
          await sleep(options.retryDelayMs);
          continue;
        }
        throw error;
      }
      return owner;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      const currentOwner = await readLockOwner(lockDir);
      if (await isLockStale(lockDir, currentOwner, options.staleAfterMs)) {
        const recovery = await removeStaleFileLock(lockDir, options, false, currentOwner);
        if (recovery.removed || !recovery.inspection.exists) {
          continue;
        }
      }

      if (Date.now() - startedAt >= options.waitTimeoutMs) {
        throw new BorealError("BOREAL_CONFLICT", "Boreal runtime state is locked by another writer", {
          lockDir,
          owner: currentOwner,
          waitTimeoutMs: options.waitTimeoutMs,
          staleAfterMs: options.staleAfterMs
        });
      }

      await sleep(options.retryDelayMs);
    }
  }
}

async function removeStaleFileLock(
  lockDir: string,
  options: FileLockOptions,
  throwOnActive: boolean,
  expectedOwner?: LockOwner
): Promise<{ readonly removed: boolean; readonly inspection: FileLockInspection }> {
  return withRecoveryLock(lockDir, options, async () => {
    let inspection = await inspectFileLock(lockDir, options);
    if (!inspection.exists) {
      return { removed: false, inspection };
    }
    if (expectedOwner && !sameLockOwner(inspection.owner, expectedOwner)) {
      return { removed: false, inspection };
    }
    if (inspection.stale && inspection.owner && inspection.staleReason !== "owner_pid_exited") {
      await sleep(Math.max(options.retryDelayMs, Math.min(50, options.staleAfterMs)));
      const refreshed = await inspectFileLock(lockDir, options);
      if (!refreshed.exists) {
        return { removed: false, inspection: refreshed };
      }
      if (expectedOwner && !sameLockOwner(refreshed.owner, expectedOwner)) {
        return { removed: false, inspection: refreshed };
      }
      inspection = refreshed;
    }
    if (!inspection.stale) {
      if (throwOnActive) {
        throw new BorealError("BOREAL_CONFLICT", "Refusing to break an active Boreal runtime lock", {
          lockDir,
          owner: inspection.owner,
          ageMs: inspection.ageMs
        });
      }
      return { removed: false, inspection };
    }

    await rm(lockDir, { recursive: true, force: true });
    return { removed: true, inspection };
  });
}

function sameLockOwner(left: LockOwner | undefined, right: LockOwner): boolean {
  return (
    left?.token === right.token &&
    left.pid === right.pid &&
    left.hostname === right.hostname &&
    left.createdAt === right.createdAt
  );
}

async function withRecoveryLock<T>(
  lockDir: string,
  options: FileLockOptions,
  operation: () => Promise<T>
): Promise<T> {
  const recoveryDir = `${lockDir}.recovery`;
  const lock = await acquireRecoveryLock(recoveryDir, recoveryLockOptions(options));
  try {
    return await operation();
  } finally {
    await releaseFileLock(recoveryDir, lock.token);
  }
}

function recoveryLockOptions(options: FileLockOptions): FileLockOptions {
  return {
    ...options,
    staleAfterMs: Math.max(options.staleAfterMs, options.waitTimeoutMs)
  };
}

async function acquireRecoveryLock(lockDir: string, options: FileLockOptions): Promise<LockOwner> {
  const startedAt = Date.now();
  const owner: LockOwner = {
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    createdAt: nowIso(),
    lastHeartbeatAt: nowIso()
  };

  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      try {
        await writeLockOwner(lockDir, owner);
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        if (isNodeError(error) && error.code === "ENOENT") {
          await sleep(options.retryDelayMs);
          continue;
        }
        throw error;
      }
      return owner;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      const currentOwner = await readLockOwner(lockDir);
      if (await isLockStale(lockDir, currentOwner, options.staleAfterMs)) {
        await rm(lockDir, { recursive: true, force: true });
        continue;
      }

      if (Date.now() - startedAt >= options.waitTimeoutMs) {
        throw new BorealError("BOREAL_CONFLICT", "Boreal runtime lock recovery is already in progress", {
          lockDir,
          owner: currentOwner,
          waitTimeoutMs: options.waitTimeoutMs,
          staleAfterMs: options.staleAfterMs
        });
      }

      await sleep(options.retryDelayMs);
    }
  }
}

async function releaseFileLock(lockDir: string, token: string): Promise<void> {
  const currentOwner = await readLockOwner(lockDir);
  if (!currentOwner || currentOwner.token !== token) {
    return;
  }
  await rm(lockDir, { recursive: true, force: true });
}

function startLockHeartbeat(
  lockDir: string,
  owner: LockOwner,
  options: FileLockOptions
): { readonly stop: () => Promise<void> } {
  const intervalMs = Math.max(10, Math.min(10_000, Math.floor(options.staleAfterMs / 3)));
  const pending = new Set<Promise<void>>();
  let stopped = false;
  const interval = setInterval(() => {
    if (stopped) {
      return;
    }
    const heartbeat = heartbeatLockOwner(lockDir, owner)
      .catch(() => undefined)
      .finally(() => {
        pending.delete(heartbeat);
      });
    pending.add(heartbeat);
  }, intervalMs);
  interval.unref();
  return {
    async stop() {
      stopped = true;
      clearInterval(interval);
      await Promise.all([...pending]);
    }
  };
}

async function heartbeatLockOwner(lockDir: string, owner: LockOwner): Promise<void> {
  const currentOwner = await readLockOwner(lockDir).catch(() => undefined);
  if (!currentOwner || !sameLockOwner(currentOwner, owner)) {
    return;
  }
  await writeLockOwner(lockDir, { ...currentOwner, lastHeartbeatAt: nowIso() });
}

async function writeLockOwner(lockDir: string, owner: LockOwner): Promise<void> {
  await writeTextFileAtomic(ownerPath(lockDir), `${JSON.stringify(owner, null, 2)}\n`);
}

async function readLockOwner(lockDir: string): Promise<LockOwner | undefined> {
  try {
    const parsed = await readJsonFile(ownerPath(lockDir), {
      schemaName: "boreal.lock-owner.v1",
      expectedObject: true,
      maxBytes: 16 * 1024
    });
    if (!isLockOwner(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    if (error instanceof BorealError && error.code === "BOREAL_JSON_PARSE") {
      return undefined;
    }
    throw error;
  }
}

async function isLockStale(lockDir: string, owner: LockOwner | undefined, staleAfterMs: number): Promise<boolean> {
  return (await assessLockStaleness(lockDir, owner, staleAfterMs)).stale;
}

async function assessLockStaleness(
  lockDir: string,
  owner: LockOwner | undefined,
  staleAfterMs: number
): Promise<{
  readonly stale: boolean;
  readonly ownerPidAlive?: boolean;
  readonly staleReason?: FileLockInspection["staleReason"];
}> {
  if (owner) {
    const ownerPidAlive = owner.hostname === hostname() ? pidExists(owner.pid) : undefined;
    if (ownerPidAlive === false) {
      return { stale: true, ownerPidAlive, staleReason: "owner_pid_exited" };
    }

    const freshestAt = Date.parse(owner.lastHeartbeatAt ?? owner.createdAt);
    if (Number.isFinite(freshestAt) && Date.now() - freshestAt > staleAfterMs) {
      return { stale: true, ownerPidAlive, staleReason: "owner_heartbeat_expired" };
    }
    return { stale: false, ownerPidAlive };
  }

  const stats = await stat(lockDir).catch(() => undefined);
  if (!stats) {
    return { stale: false };
  }
  if (Date.now() - stats.mtimeMs > staleAfterMs) {
    return { stale: true, staleReason: "lock_mtime_expired" };
  }
  return { stale: false };
}

function ownerPath(lockDir: string): string {
  return join(lockDir, "owner.json");
}

function isLockOwner(value: unknown): value is LockOwner {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.token === "string" &&
    typeof record.pid === "number" &&
    typeof record.hostname === "string" &&
    typeof record.createdAt === "string" &&
    (record.lastHeartbeatAt === undefined || typeof record.lastHeartbeatAt === "string")
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function pidExists(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ESRCH") {
      return false;
    }
    if (isNodeError(error) && error.code === "EPERM") {
      return true;
    }
    return false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new BorealError("BOREAL_INVALID_INPUT", `File lock option ${label} must be a positive integer`, {
      value
    });
  }
}
