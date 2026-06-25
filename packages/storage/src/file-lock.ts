import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { dirname, join } from "node:path";

import { BorealError, nowIso } from "@boreal/core";

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
}

export interface FileLockInspection {
  readonly exists: boolean;
  readonly stale: boolean;
  readonly lockDir: string;
  readonly owner?: LockOwner;
  readonly ageMs?: number;
}

export async function withFileLock<T>(
  lockDir: string,
  options: FileLockOptions,
  operation: () => Promise<T>
): Promise<T> {
  const lock = await acquireFileLock(lockDir, options);
  try {
    return await operation();
  } finally {
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
  const createdAt = owner ? Date.parse(owner.createdAt) : Number.NaN;
  const ageMs = Number.isFinite(createdAt) ? Date.now() - createdAt : Date.now() - stats.mtimeMs;
  return {
    exists: true,
    stale: await isLockStale(lockDir, owner, options.staleAfterMs),
    lockDir,
    owner,
    ageMs
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
    createdAt: nowIso()
  };

  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      try {
        await writeFile(ownerPath(lockDir), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
        throw error;
      }
      return owner;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      const currentOwner = await readLockOwner(lockDir);
      if (await isLockStale(lockDir, currentOwner, options.staleAfterMs)) {
        const recovery = await removeStaleFileLock(lockDir, options, false);
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
  throwOnActive: boolean
): Promise<{ readonly removed: boolean; readonly inspection: FileLockInspection }> {
  return withRecoveryLock(lockDir, options, async () => {
    const inspection = await inspectFileLock(lockDir, options);
    if (!inspection.exists) {
      return { removed: false, inspection };
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

async function withRecoveryLock<T>(
  lockDir: string,
  options: FileLockOptions,
  operation: () => Promise<T>
): Promise<T> {
  const recoveryDir = `${lockDir}.recovery`;
  const lock = await acquireRecoveryLock(recoveryDir, options);
  try {
    return await operation();
  } finally {
    await releaseFileLock(recoveryDir, lock.token);
  }
}

async function acquireRecoveryLock(lockDir: string, options: FileLockOptions): Promise<LockOwner> {
  const startedAt = Date.now();
  const owner: LockOwner = {
    token: randomUUID(),
    pid: process.pid,
    hostname: hostname(),
    createdAt: nowIso()
  };

  await mkdir(dirname(lockDir), { recursive: true });

  while (true) {
    try {
      await mkdir(lockDir);
      try {
        await writeFile(ownerPath(lockDir), `${JSON.stringify(owner, null, 2)}\n`, "utf8");
      } catch (error) {
        await rm(lockDir, { recursive: true, force: true });
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

async function readLockOwner(lockDir: string): Promise<LockOwner | undefined> {
  try {
    const raw = await readFile(ownerPath(lockDir), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isLockOwner(parsed)) {
      return undefined;
    }
    return parsed;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

async function isLockStale(lockDir: string, owner: LockOwner | undefined, staleAfterMs: number): Promise<boolean> {
  const createdAt = owner ? Date.parse(owner.createdAt) : Number.NaN;
  if (Number.isFinite(createdAt)) {
    return Date.now() - createdAt > staleAfterMs;
  }

  const stats = await stat(lockDir).catch(() => undefined);
  if (!stats) {
    return false;
  }
  return Date.now() - stats.mtimeMs > staleAfterMs;
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
    typeof record.createdAt === "string"
  );
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
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
