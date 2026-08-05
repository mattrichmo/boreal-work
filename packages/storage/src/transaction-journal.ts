import { randomUUID } from "node:crypto";
import { readdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";

import { hashContent, nowIso, type RuntimeEvent, type RuntimeOperation } from "@boreal/core";

import { writeTextFileAtomic } from "./atomic-write.js";
import type { StoreChange, StoreSnapshot } from "./memory-store.js";

export const STORE_TRANSACTION_SCHEMA_VERSION = "boreal.store-transaction.v1";

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
    const journal = JSON.parse(await readFile(path, "utf8")) as StoreTransactionJournal;
    if (journal.schemaVersion !== STORE_TRANSACTION_SCHEMA_VERSION || !Array.isArray(journal.pendingLogRecords)) {
      throw new Error(`Unsupported store transaction journal: ${name}`);
    }
    journals.push({ path, journal });
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
