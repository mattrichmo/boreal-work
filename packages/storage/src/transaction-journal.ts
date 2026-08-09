import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { BorealError, hashContent, nowIso, type RuntimeEvent, type RuntimeOperation } from "@boreal/core";

import { writeTextFileAtomic } from "./atomic-write.js";
import type { StoreChange, StoreSnapshot } from "./memory-store.js";

export const STORE_TRANSACTION_SCHEMA_VERSION = "boreal.store-transaction.v1";

export class RecoveryRequiredError extends BorealError {
  readonly recoveryRequired = true;

  constructor(message: string, details?: Record<string, unknown>) {
    super("BOREAL_STORAGE_ERROR", message, {
      recoveryRequired: true,
      ...details
    });
    this.name = "RecoveryRequiredError";
  }
}

export function isRecoveryRequiredError(error: unknown): error is RecoveryRequiredError {
  return error instanceof RecoveryRequiredError ||
    (error instanceof BorealError && error.details !== null && typeof error.details === "object" &&
      (error.details as Record<string, unknown>).recoveryRequired === true);
}

export function toRecoveryRequiredError(
  error: unknown,
  details: Record<string, unknown>
): RecoveryRequiredError {
  if (error instanceof RecoveryRequiredError) {
    return error;
  }
  return new RecoveryRequiredError("Boreal storage recovery could not complete; recovery is required", {
    ...details,
    cause: error instanceof Error ? error.message : String(error)
  });
}

export interface PendingLogRecord {
  readonly kind: "event" | "operation";
  readonly record: RuntimeEvent | RuntimeOperation;
}

export interface StoreTransactionJournal {
  readonly schemaVersion: typeof STORE_TRANSACTION_SCHEMA_VERSION;
  readonly id: string;
  readonly createdAt: string;
  readonly storeKind: "object" | "file";
  readonly phase: "prepared" | "state_written" | "log_written";
  readonly changes?: readonly StoreChange[];
  readonly snapshot?: StoreSnapshot;
  readonly pendingLogRecords: readonly PendingLogRecord[];
}

export function transactionDirectory(rootDir: string): string {
  return join(rootDir, ".boreal", "runtime", "transactions");
}

export async function createTransactionJournal(input: {
  readonly rootDir: string;
  readonly storeKind: StoreTransactionJournal["storeKind"];
  readonly changes?: readonly StoreChange[];
  readonly snapshot?: StoreSnapshot;
  readonly pendingLogRecords: readonly PendingLogRecord[];
}): Promise<{ readonly path: string; readonly journal: StoreTransactionJournal }> {
  const id = `tx_${randomUUID().replaceAll("-", "")}`;
  const journal: StoreTransactionJournal = {
    schemaVersion: STORE_TRANSACTION_SCHEMA_VERSION,
    id,
    createdAt: nowIso(),
    storeKind: input.storeKind,
    phase: "prepared",
    ...(input.changes ? { changes: input.changes } : {}),
    ...(input.snapshot ? { snapshot: input.snapshot } : {}),
    pendingLogRecords: input.pendingLogRecords
  };
  const path = join(transactionDirectory(input.rootDir), `${id}.json`);
  await writeTransactionJournal(path, journal);
  return { path, journal };
}

export async function updateTransactionJournal(
  path: string,
  journal: StoreTransactionJournal,
  phase: StoreTransactionJournal["phase"]
): Promise<StoreTransactionJournal> {
  const next = { ...journal, phase };
  await writeTransactionJournal(path, next);
  return next;
}

export async function removeTransactionJournal(path: string): Promise<void> {
  await rm(path, { force: true });
}

export async function readTransactionJournals(rootDir: string): Promise<readonly { path: string; journal: StoreTransactionJournal }[]> {
  const directory = transactionDirectory(rootDir);
  const names = await readdir(directory).catch((error) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [] as string[];
    }
    throw error;
  });
  const journals: Array<{ path: string; journal: StoreTransactionJournal }> = [];
  for (const name of names.filter((value) => value.endsWith(".json")).sort()) {
    const path = join(directory, name);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(path, "utf8"));
    } catch (error) {
      throw new RecoveryRequiredError("Boreal storage transaction journal is malformed; recovery is required", {
        journalPath: path,
        journalName: name,
        reason: "journal_parse_error",
        cause: error instanceof Error ? error.message : String(error)
      });
    }
    if (!isRecord(parsed) ||
      parsed.schemaVersion !== STORE_TRANSACTION_SCHEMA_VERSION ||
      typeof parsed.id !== "string" ||
      typeof parsed.createdAt !== "string" ||
      (parsed.storeKind !== "object" && parsed.storeKind !== "file") ||
      (parsed.phase !== "prepared" && parsed.phase !== "state_written" && parsed.phase !== "log_written") ||
      !Array.isArray(parsed.pendingLogRecords)) {
      throw new RecoveryRequiredError("Unsupported Boreal storage transaction journal; recovery is required", {
        journalPath: path,
        journalName: name,
        reason: "journal_schema_error"
      });
    }
    journals.push({ path, journal: parsed as unknown as StoreTransactionJournal });
  }
  return journals;
}

export function logRecordFingerprint(record: RuntimeEvent | RuntimeOperation): string {
  return hashContent(record);
}

async function writeTransactionJournal(path: string, journal: StoreTransactionJournal): Promise<void> {
  await writeTextFileAtomic(path, `${JSON.stringify(journal)}\n`);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
