import { readdir, rm } from "node:fs/promises";
import { join } from "node:path";

import {
  BorealError,
  assertPathInside,
  assertRealPathInside,
  hashContent,
  readJsonFile,
  resolveWorkspacePaths,
  agentReservationSchemaIssues,
  agentSummaryRecordSchemaIssues,
  claimRecordSchemaIssues,
  decisionRecordSchemaIssues,
  directiveAcknowledgementRecordSchemaIssues,
  evidenceRecordSchemaIssues,
  graphEdgeSchemaIssues,
  knowledgeSourceSchemaIssues,
  reviewerHeartbeatSchemaIssues,
  runtimeEventSchemaIssues,
  runtimeOperationSchemaIssues,
  verificationRecordSchemaIssues,
  workItemSchemaIssues,
  type RuntimeEvent,
  type RuntimeOperation,
  type SchemaValidationIssue,
  type WorkItem
} from "@boreal/core";

import { writeTextFileAtomic } from "./atomic-write.js";
import { FileEventLog, type EventLogEntry } from "./event-log.js";
import { normalizeFileLockOptions, withFileLock, type FileLockOptions } from "./file-lock.js";
import {
  InMemoryBorealStore,
  type StoreChange,
  type StoreSectionName,
  type StoreSnapshot
} from "./memory-store.js";
import { ObjectReadIndex, objectIndexPath, type NodeSqliteModule } from "./object-index.js";
import type { BorealReader, BorealStore, BorealWriter, WorkItemFilter } from "./ports.js";

export interface ObjectDirBorealStoreOptions {
  readonly rootDir: string;
  readonly lock?: Partial<FileLockOptions>;
  readonly sqlite?: NodeSqliteModule;
}

type PersistedObjectSection = Exclude<StoreSectionName, "events" | "operations" | "projections" | "contextPacks">;

interface ObjectSectionDefinition {
  readonly section: PersistedObjectSection;
  readonly directory: string;
  readonly validator: (value: unknown, path?: string) => readonly SchemaValidationIssue[];
}

const RECORD_MAX_BYTES = 1024 * 1024;

const OBJECT_SECTIONS: readonly ObjectSectionDefinition[] = [
  { section: "workItems", directory: "work", validator: workItemSchemaIssues },
  { section: "agentSummaries", directory: "agent-summaries", validator: agentSummaryRecordSchemaIssues },
  { section: "evidence", directory: "evidence", validator: evidenceRecordSchemaIssues },
  { section: "verifications", directory: "verifications", validator: verificationRecordSchemaIssues },
  { section: "directiveAcknowledgements", directory: "directive-acks", validator: directiveAcknowledgementRecordSchemaIssues },
  { section: "knowledgeSources", directory: "knowledge-sources", validator: knowledgeSourceSchemaIssues },
  { section: "claims", directory: "claims", validator: claimRecordSchemaIssues },
  { section: "decisions", directory: "decisions", validator: decisionRecordSchemaIssues },
  { section: "graphEdges", directory: "edges", validator: graphEdgeSchemaIssues },
  { section: "reservations", directory: "reservations", validator: agentReservationSchemaIssues },
  { section: "reviewerHeartbeats", directory: "reviewer-heartbeats", validator: reviewerHeartbeatSchemaIssues }
];

const SECTION_BY_NAME = new Map<StoreSectionName, ObjectSectionDefinition>(
  OBJECT_SECTIONS.map((definition) => [definition.section, definition])
);

export class ObjectDirBorealStore implements BorealStore {
  readonly rootDir: string;
  readonly objectsDir: string;
  readonly eventLogFile: string;
  readonly objectIndexFile: string;
  readonly lockDir: string;
  readonly lockOptions: FileLockOptions;

  #writeQueue: Promise<void> = Promise.resolve();
  #eventLog: FileEventLog;
  #index: ObjectReadIndex;

  constructor(options: ObjectDirBorealStoreOptions) {
    const paths = resolveWorkspacePaths(options.rootDir);
    this.rootDir = paths.rootDir;
    this.objectsDir = paths.objectsDir;
    this.eventLogFile = paths.eventLogFile;
    this.objectIndexFile = objectIndexPath(paths.rootDir);
    this.lockDir = paths.stateLockDir;
    this.lockOptions = normalizeFileLockOptions(options.lock);
    this.#eventLog = new FileEventLog({ path: this.eventLogFile });
    this.#index = new ObjectReadIndex({
      path: this.objectIndexFile,
      ...(Object.hasOwn(options, "sqlite") ? { sqlite: options.sqlite } : {})
    });
    assertPathInside(this.rootDir, this.objectsDir);
    assertPathInside(this.rootDir, this.eventLogFile);
    assertPathInside(this.rootDir, this.objectIndexFile);
    assertPathInside(this.rootDir, this.lockDir);
  }

  async read<T>(operation: (reader: BorealReader) => Promise<T> | T): Promise<T> {
    return operation(this.createReader());
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
    return this.loadSnapshot();
  }

  private async writeOnce<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    await this.assertSafePaths();
    return withFileLock(this.lockDir, this.lockOptions, async () => {
      const snapshot = await this.loadSnapshot();
      const memory = new InMemoryBorealStore(snapshot);
      const baseHead = await this.#eventLog.head();
      const baseHeadSeq = baseHead.seq;
      const { result, changes } = await memory.writeWithChangeSet((writer) =>
        operation(withHeadSeqWriter(writer, snapshot, baseHeadSeq))
      );
      await this.persistObjectChanges(changes);
      for (const pending of logRecordsFromChanges(snapshot, changes)) {
        await this.#eventLog.append(pending.kind, pending.record);
      }
      try {
        await this.#index.applyChanges(changes, await this.#eventLog.head(), baseHead);
      } catch {
        // The SQLite index is a disposable cache. Durable object and event-log
        // writes have already committed, so invalidate it and let the next read
        // rebuild instead of reporting the durable operation as failed.
        try {
          await this.#index.invalidate();
        } catch {
          // Cache cleanup is best effort for the same reason: canonical writes
          // are already durable and must remain the command's source of truth.
        }
      }
      return result;
    });
  }

  private createReader(): BorealReader {
    let fullReader: Promise<BorealReader> | undefined;
    const loadFullReader = async (): Promise<BorealReader> => {
      fullReader ??= this.loadSnapshot().then(async (snapshot) => {
        const memory = new InMemoryBorealStore(snapshot);
        return memory.read((reader) => withHeadSeqReader(reader, async () => (await this.#eventLog.head()).seq));
      });
      return fullReader;
    };
    const callFullReader = async (property: PropertyKey, args: readonly unknown[]): Promise<unknown> => {
      const reader = await loadFullReader();
      const value = (reader as unknown as Record<PropertyKey, unknown>)[property];
      if (typeof value !== "function") {
        return value;
      }
      return (value as (...input: readonly unknown[]) => unknown).apply(reader, [...args]);
    };
    const indexedMethods = {
      headSeq: async () => (await this.#eventLog.head()).seq,
      listWorkItems: async (filter?: WorkItemFilter) => {
        const indexed = await this.listIndexedWorkItems(filter);
        if (indexed !== undefined) {
          return indexed;
        }
        const reader = await loadFullReader();
        return reader.listWorkItems(filter);
      }
    };
    return new Proxy(indexedMethods, {
      get(target, property, receiver) {
        if (property in target) {
          return Reflect.get(target, property, receiver);
        }
        return (...args: readonly unknown[]) => callFullReader(property, args);
      }
    }) as BorealReader;
  }

  private async listIndexedWorkItems(filter?: WorkItemFilter): Promise<readonly WorkItem[] | undefined> {
    const head = await this.#eventLog.head();
    const indexed = await this.#index.listWorkItems(filter, head);
    if (indexed !== undefined) {
      return indexed;
    }
    const status = await this.#index.status(head);
    if (!status.available) {
      return undefined;
    }
    // Reads never repair or initialize the disposable SQLite cache. This keeps
    // status, list, and inspection commands physically read-only; explicit
    // search rebuilds and durable writes are responsible for cache updates.
    return undefined;
  }

  private async loadSnapshot(): Promise<StoreSnapshot> {
    await assertRealPathInside(this.rootDir, this.objectsDir);
    const snapshot: Record<string, readonly unknown[]> = {};
    for (const definition of OBJECT_SECTIONS) {
      snapshot[definition.section] = await this.loadObjectSection(definition);
    }
    const logEntries = await this.#eventLog.readAll();
    return {
      ...snapshot,
      ...snapshotFromLogEntries(logEntries),
      projections: [],
      contextPacks: []
    } as StoreSnapshot;
  }

  private async loadObjectSection(definition: ObjectSectionDefinition): Promise<readonly unknown[]> {
    const directory = this.sectionDir(definition);
    let entries: string[];
    try {
      entries = await readdir(directory);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    }

    const records: unknown[] = [];
    for (const entry of entries.sort((left, right) => left.localeCompare(right))) {
      if (!entry.endsWith(".json")) {
        continue;
      }
      const path = join(directory, entry);
      assertPathInside(directory, path);
      records.push(
        await readJsonFile(path, {
          schemaName: `boreal.object-store.${definition.section}`,
          expectedObject: true,
          maxBytes: RECORD_MAX_BYTES
        })
      );
    }
    return records;
  }

  private async persistObjectChanges(changes: readonly StoreChange[]): Promise<void> {
    for (const change of changes) {
      const definition = SECTION_BY_NAME.get(change.section);
      if (!definition) {
        continue;
      }
      const path = this.recordPath(definition, change.id);
      if (change.record === null) {
        await rm(path, { force: true });
        continue;
      }
      validateRecord(definition, change.id, change.record);
      await writeTextFileAtomic(path, `${JSON.stringify(change.record)}\n`);
    }
  }

  private sectionDir(definition: ObjectSectionDefinition): string {
    const path = join(this.objectsDir, definition.directory);
    assertPathInside(this.objectsDir, path);
    return path;
  }

  private recordPath(definition: ObjectSectionDefinition, id: string): string {
    const directory = this.sectionDir(definition);
    const path = join(directory, `${id}.json`);
    assertPathInside(directory, path);
    return path;
  }

  private async assertSafePaths(): Promise<void> {
    await assertRealPathInside(this.rootDir, this.objectsDir);
    await assertRealPathInside(this.rootDir, this.eventLogFile);
    await assertRealPathInside(this.rootDir, this.objectIndexFile);
    await assertRealPathInside(this.rootDir, this.lockDir);
  }
}

function validateRecord(definition: ObjectSectionDefinition, id: string, record: unknown): void {
  const issues = definition.validator(record, `${definition.section}.${id}`);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Object store record failed schema validation", {
      section: definition.section,
      id,
      issues: issues.slice(0, 50),
      issueCount: issues.length
    });
  }
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

function logRecordsFromChanges(
  before: StoreSnapshot,
  changes: readonly StoreChange[]
): Array<{ readonly kind: EventLogEntry["kind"]; readonly record: RuntimeEvent | RuntimeOperation }> {
  const previousOperations = new Map((before.operations ?? []).map((record) => [record.meta.id, record]));
  const records: Array<{ readonly kind: EventLogEntry["kind"]; readonly record: RuntimeEvent | RuntimeOperation }> = [];
  for (const change of changes) {
    if (change.section === "events" && change.record !== null) {
      validateLogRecord("event", change.id, change.record);
      records.push({ kind: "event", record: change.record as RuntimeEvent });
      continue;
    }
    if (change.section === "operations") {
      if (change.record !== null) {
        validateLogRecord("operation", change.id, change.record);
        records.push({ kind: "operation", record: change.record as RuntimeOperation });
        continue;
      }
      const previous = previousOperations.get(change.id as RuntimeOperation["meta"]["id"]);
      if (previous) {
        records.push({ kind: "operation", record: operationTombstone(previous) });
      }
    }
  }
  return records;
}

function validateLogRecord(kind: EventLogEntry["kind"], id: string, record: unknown): void {
  const issues = kind === "event" ? runtimeEventSchemaIssues(record, `events.${id}`) : runtimeOperationSchemaIssues(record, `operations.${id}`);
  if (issues.length > 0) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Object store event log record failed schema validation", {
      kind,
      id,
      issues: issues.slice(0, 50),
      issueCount: issues.length
    });
  }
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

function recordChanged<TRecord extends RuntimeEvent | RuntimeOperation>(before: TRecord | undefined, after: TRecord): boolean {
  return before === undefined || hashContent(before) !== hashContent(after);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
