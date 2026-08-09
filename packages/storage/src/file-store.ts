import { resolve } from "node:path";

import {
  BorealError,
  assertPathInside,
  assertRealPathInside,
  hashContent,
  readJsonFile,
  resolveWorkspacePaths,
  runtimeSnapshotSchemaIssues,
  type RuntimeEvent,
  type RuntimeOperation
} from "@boreal/core";

import { FileEventLog, type EventLogEntry } from "./event-log.js";
import { normalizeFileLockOptions, withFileLock, type FileLockOptions } from "./file-lock.js";
import { InMemoryBorealStore, type StoreSnapshot } from "./memory-store.js";
import type { BorealReader, BorealStore, BorealWriter } from "./ports.js";
import { writeTextFileAtomic } from "./atomic-write.js";
import {
  createTransactionJournal,
  logRecordFingerprint,
  readTransactionJournals,
  removeTransactionJournal,
  transactionDirectory,
  toRecoveryRequiredError,
  updateTransactionJournal,
  type PendingLogRecord,
  type StoreTransactionJournal
} from "./transaction-journal.js";

export interface FileBorealStoreOptions {
  readonly rootDir: string;
  readonly stateFile?: string;
  readonly lockDir?: string;
  readonly lock?: Partial<FileLockOptions>;
}

export const FILE_STORE_SCHEMA_VERSION = "boreal.file-store.v2";
const LEGACY_FILE_STORE_SCHEMA_VERSION = "boreal.file-store.v1";

type PersistedStoreSnapshot = Omit<Required<StoreSnapshot>, "events" | "operations" | "projections" | "contextPacks">;

interface StateDocument extends PersistedStoreSnapshot {
  readonly schemaVersion: typeof FILE_STORE_SCHEMA_VERSION;
}

export class FileBorealStore implements BorealStore {
  readonly rootDir: string;
  readonly stateFile: string;
  readonly eventLogFile: string;
  readonly lockDir: string;
  readonly lockOptions: FileLockOptions;

  #writeQueue: Promise<void> = Promise.resolve();
  #eventLog: FileEventLog;

  constructor(options: FileBorealStoreOptions) {
    const paths = resolveWorkspacePaths(options.rootDir);
    this.rootDir = paths.rootDir;
    this.stateFile = resolve(options.stateFile ?? paths.stateFile);
    this.eventLogFile = paths.eventLogFile;
    this.lockDir = resolve(options.lockDir ?? (options.stateFile ? `${this.stateFile}.lock` : paths.stateLockDir));
    this.lockOptions = normalizeFileLockOptions(options.lock);
    this.#eventLog = new FileEventLog({ path: this.eventLogFile });
    assertPathInside(this.rootDir, this.stateFile);
    assertPathInside(this.rootDir, this.eventLogFile);
    assertPathInside(this.rootDir, this.lockDir);
  }

  async read<T>(operation: (reader: BorealReader) => Promise<T> | T): Promise<T> {
    return withFileLock(this.lockDir, this.lockOptions, async () => {
      await this.recoverTransactions();
      const loaded = await this.loadSnapshotWithLog();
      const memory = new InMemoryBorealStore(loaded.snapshot);
      return memory.read((reader) => operation(withHeadSeqReader(reader, async () => (await this.#eventLog.head()).seq)));
    });
  }

  async write<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    const run = this.#writeQueue.then(() => this.writeOnce(operation));
    this.#writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  async snapshot(): Promise<StoreSnapshot> {
    return withFileLock(this.lockDir, this.lockOptions, async () => {
      await this.recoverTransactions();
      return (await this.loadSnapshotWithLog()).snapshot;
    });
  }

  private async writeOnce<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    await this.assertSafePaths();
    return withFileLock(this.lockDir, this.lockOptions, async () => {
      await this.recoverTransactions();
      const loaded = await this.loadSnapshotWithLog();
      const memory = new InMemoryBorealStore(loaded.snapshot);
      const baseHeadSeq = (await this.#eventLog.head()).seq;
      const result = await memory.write((writer) => operation(withHeadSeqWriter(writer, loaded.snapshot, baseHeadSeq)));
      const snapshot = await memory.snapshot();
      const pendingLogRecords = pendingLogRecordsFromSnapshot(loaded.snapshot, snapshot, loaded.backfillLog);
      const transaction = await createTransactionJournal({
        rootDir: this.rootDir,
        storeKind: "file",
        snapshot,
        pendingLogRecords
      });
      await this.saveSnapshot(snapshot);
      let journal = await updateTransactionJournal(transaction.path, transaction.journal, "state_written");
      await this.appendMissingLogRecords(pendingLogRecords);
      journal = await updateTransactionJournal(transaction.path, journal, "log_written");
      await removeTransactionJournal(transaction.path);
      return result;
    });
  }

  private async recoverTransactions(): Promise<void> {
    let journals: readonly { path: string; journal: StoreTransactionJournal }[];
    try {
      journals = await readTransactionJournals(this.rootDir);
    } catch (error) {
      throw toRecoveryRequiredError(error, {
        rootDir: this.rootDir,
        storeKind: "file",
        phase: "read_journals"
      });
    }
    for (const { path, journal } of journals) {
      if (journal.storeKind !== "file") {
        continue;
      }
      try {
        if (journal.snapshot) {
          await this.saveSnapshot(journal.snapshot);
        }
        await this.appendMissingLogRecords(journal.pendingLogRecords);
        await removeTransactionJournal(path);
      } catch (error) {
        throw toRecoveryRequiredError(error, {
          rootDir: this.rootDir,
          storeKind: "file",
          journalPath: path,
          journalId: journal.id,
          phase: journal.phase
        });
      }
    }
  }

  private async appendMissingLogRecords(records: readonly PendingLogRecord[]): Promise<void> {
    if (records.length === 0) {
      return;
    }
    const existing = new Set(
      (await this.#eventLog.readAll()).map((entry) => `${entry.kind}:${logRecordFingerprint(entry.record)}`)
    );
    for (const pending of records) {
      const key = `${pending.kind}:${logRecordFingerprint(pending.record)}`;
      if (existing.has(key)) {
        continue;
      }
      await this.#eventLog.append(pending.kind, pending.record);
      existing.add(key);
    }
  }

  private async loadSnapshotWithLog(): Promise<{
    readonly snapshot: StoreSnapshot;
    readonly backfillLog: boolean;
  }> {
    await assertRealPathInside(this.rootDir, this.stateFile);
    const documentSnapshot = await this.loadDocumentSnapshot();
    const logEntries = await this.#eventLog.readAll();
    const logSnapshot = snapshotFromLogEntries(logEntries);
    const hasLogRecords = logEntries.length > 0;
    const legacyEvents = documentSnapshot.events ?? [];
    const legacyOperations = documentSnapshot.operations ?? [];
    return {
      snapshot: {
        ...documentSnapshot,
        ...(hasLogRecords
          ? logSnapshot
          : {
              events: legacyEvents,
              operations: legacyOperations
            })
      },
      backfillLog: !hasLogRecords && (legacyEvents.length > 0 || legacyOperations.length > 0)
    };
  }

  private async loadDocumentSnapshot(): Promise<StoreSnapshot> {
    try {
      return documentToSnapshot(
        await readJsonFile(this.stateFile, {
          schemaName: FILE_STORE_SCHEMA_VERSION,
          expectedObject: true,
          maxBytes: 50 * 1024 * 1024
        })
      );
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {};
      }
      throw error;
    }
  }

  private async saveSnapshot(snapshot: StoreSnapshot): Promise<void> {
    const document = snapshotToDocument(snapshot);
    await assertRealPathInside(this.rootDir, this.stateFile);
    await writeTextFileAtomic(this.stateFile, `${JSON.stringify(document)}\n`);
  }

  private async assertSafePaths(): Promise<void> {
    await assertRealPathInside(this.rootDir, this.stateFile);
    await assertRealPathInside(this.rootDir, this.eventLogFile);
    await assertRealPathInside(this.rootDir, this.lockDir);
    await assertRealPathInside(this.rootDir, transactionDirectory(this.rootDir));
  }
}

function snapshotToDocument(snapshot: StoreSnapshot): StateDocument {
  return {
    schemaVersion: FILE_STORE_SCHEMA_VERSION,
    workItems: snapshot.workItems ?? [],
    agentSummaries: snapshot.agentSummaries ?? [],
    evidence: snapshot.evidence ?? [],
    verifications: snapshot.verifications ?? [],
    directiveAcknowledgements: snapshot.directiveAcknowledgements ?? [],
    knowledgeSources: snapshot.knowledgeSources ?? [],
    claims: snapshot.claims ?? [],
    decisions: snapshot.decisions ?? [],
    graphEdges: snapshot.graphEdges ?? [],
    reservations: snapshot.reservations ?? [],
    reviewerHeartbeats: snapshot.reviewerHeartbeats ?? [],
    runs: snapshot.runs ?? [],
    checkpoints: snapshot.checkpoints ?? [],
    eventCursors: snapshot.eventCursors ?? []
  };
}

function documentToSnapshot(value: unknown): StoreSnapshot {
  if (!isRecord(value)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal state file must contain an object");
  }

  if (value.schemaVersion !== FILE_STORE_SCHEMA_VERSION && value.schemaVersion !== LEGACY_FILE_STORE_SCHEMA_VERSION) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Unsupported Boreal state file version", {
      schemaVersion: value.schemaVersion
    });
  }

  const snapshot: StoreSnapshot = {
    workItems: readArray(value, "workItems"),
    agentSummaries: readOptionalArray(value, "agentSummaries"),
    evidence: readArray(value, "evidence"),
    verifications: readArray(value, "verifications"),
    directiveAcknowledgements: readOptionalArray(value, "directiveAcknowledgements"),
    knowledgeSources: readArray(value, "knowledgeSources"),
    claims: readArray(value, "claims"),
    decisions: readArray(value, "decisions"),
    graphEdges: readArray(value, "graphEdges"),
    reservations: readArray(value, "reservations"),
    reviewerHeartbeats: readOptionalArray(value, "reviewerHeartbeats"),
    runs: readOptionalArray(value, "runs"),
    checkpoints: readOptionalArray(value, "checkpoints"),
    eventCursors: readOptionalArray(value, "eventCursors"),
    events: readOptionalArray(value, "events"),
    operations: readOptionalArray(value, "operations"),
    projections: [],
    contextPacks: []
  };
  const schemaIssues = runtimeSnapshotSchemaIssues(snapshot);
  if (schemaIssues.length > 0) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal state file failed schema validation", {
      issues: schemaIssues.slice(0, 50),
      issueCount: schemaIssues.length
    });
  }
  return snapshot;
}

function snapshotFromLogEntries(entries: readonly EventLogEntry[]): Pick<StoreSnapshot, "events" | "operations"> {
  return {
    events: latestLogRecords<RuntimeEvent>(entries, "event"),
    operations: latestLogRecords<RuntimeOperation>(entries, "operation")
  };
}

function latestLogRecords<TRecord extends RuntimeEvent | RuntimeOperation>(
  entries: readonly EventLogEntry[],
  kind: EventLogEntry["kind"]
): readonly TRecord[] {
  const records = new Map<string, TRecord>();
  for (const entry of entries) {
    if (entry.kind !== kind) {
      continue;
    }
    const record = entry.record as TRecord;
    if (kind === "operation" && isOperationTombstone(record)) {
      records.delete(record.meta.id);
      continue;
    }
    records.delete(record.meta.id);
    records.set(record.meta.id, record);
  }
  return [...records.values()];
}

function pendingLogRecordsFromSnapshot(
  before: StoreSnapshot,
  after: StoreSnapshot,
  backfillLog: boolean
): Array<{ readonly kind: EventLogEntry["kind"]; readonly record: RuntimeEvent | RuntimeOperation }> {
  return [
    ...pendingRecords(before.events ?? [], after.events ?? [], "event", backfillLog),
    ...pendingRecords(before.operations ?? [], after.operations ?? [], "operation", backfillLog),
    ...deletedOperationRecords(before.operations ?? [], after.operations ?? [])
  ];
}

function pendingRecords<TRecord extends RuntimeEvent | RuntimeOperation>(
  before: readonly TRecord[],
  after: readonly TRecord[],
  kind: EventLogEntry["kind"],
  includeExisting: boolean
): Array<{ readonly kind: EventLogEntry["kind"]; readonly record: TRecord }> {
  const beforeById = new Map(before.map((record) => [record.meta.id, record]));
  return after
    .filter((record) => includeExisting || recordChanged(beforeById.get(record.meta.id), record))
    .map((record) => ({ kind, record }));
}

function recordChanged<TRecord extends RuntimeEvent | RuntimeOperation>(before: TRecord | undefined, after: TRecord): boolean {
  return before === undefined || hashContent(before) !== hashContent(after);
}

function deletedOperationRecords(
  before: readonly RuntimeOperation[],
  after: readonly RuntimeOperation[]
): Array<{ readonly kind: EventLogEntry["kind"]; readonly record: RuntimeOperation }> {
  const afterIds = new Set(after.map((record) => record.meta.id));
  return before
    .filter((record) => !afterIds.has(record.meta.id))
    .map((record) => ({ kind: "operation", record: operationTombstone(record) }));
}

function operationTombstone(record: RuntimeOperation): RuntimeOperation {
  return { ...record, tombstone: true } as RuntimeOperation;
}

function isOperationTombstone(record: RuntimeEvent | RuntimeOperation): boolean {
  return isRecord(record) && record.tombstone === true;
}

function withHeadSeqReader<TReader extends BorealReader>(
  reader: TReader,
  headSeq: () => Promise<number>
): TReader {
  return new Proxy(reader, {
    get(target, property, receiver) {
      if (property === "headSeq") {
        return headSeq;
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

function withHeadSeqWriter<TWriter extends BorealWriter>(
  writer: TWriter,
  before: StoreSnapshot,
  baseHeadSeq: number
): TWriter {
  const pending = new Set<string>();
  const beforeEvents = new Map((before.events ?? []).map((record) => [record.meta.id, record]));
  const beforeOperations = new Map((before.operations ?? []).map((record) => [record.meta.id, record]));
  return new Proxy(writer, {
    get(target, property, receiver) {
      if (property === "headSeq") {
        return async () => baseHeadSeq + pending.size;
      }
      if (property === "putEvent") {
        return async (record: RuntimeEvent) => {
          await target.putEvent(record);
          if (recordChanged(beforeEvents.get(record.meta.id), record)) {
            pending.add(`event:${record.meta.id}`);
          }
        };
      }
      if (property === "putOperation") {
        return async (record: RuntimeOperation) => {
          await target.putOperation(record);
          if (recordChanged(beforeOperations.get(record.meta.id), record)) {
            pending.add(`operation:${record.meta.id}`);
          }
        };
      }
      if (property === "deleteOperation") {
        return async (id: RuntimeOperation["meta"]["id"]) => {
          const deleted = await target.deleteOperation(id);
          if (deleted && beforeOperations.has(id)) {
            pending.add(`operation:${id}:delete`);
          }
          return deleted;
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

function readArray<T = unknown>(value: Record<string, unknown>, key: string): readonly T[] {
  const candidate = value[key];
  if (!Array.isArray(candidate)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal state file section must be an array", { key });
  }
  return candidate as readonly T[];
}

function readOptionalArray<T = unknown>(value: Record<string, unknown>, key: string): readonly T[] {
  const candidate = value[key];
  if (candidate === undefined) {
    return [];
  }
  if (!Array.isArray(candidate)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal state file section must be an array", { key });
  }
  return candidate as readonly T[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
