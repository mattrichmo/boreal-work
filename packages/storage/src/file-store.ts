import { resolve } from "node:path";

import {
  BorealError,
  assertPathInside,
  assertRealPathInside,
  readJsonFile,
  resolveWorkspacePaths,
  runtimeSnapshotSchemaIssues
} from "@boreal/core";

import { normalizeFileLockOptions, withFileLock, type FileLockOptions } from "./file-lock.js";
import { InMemoryBorealStore, type StoreSnapshot } from "./memory-store.js";
import type { BorealReader, BorealStore, BorealWriter } from "./ports.js";
import { writeTextFileAtomic } from "./atomic-write.js";

export interface FileBorealStoreOptions {
  readonly rootDir: string;
  readonly stateFile?: string;
  readonly lockDir?: string;
  readonly lock?: Partial<FileLockOptions>;
}

export const FILE_STORE_SCHEMA_VERSION = "boreal.file-store.v1";

interface StateDocument extends Required<StoreSnapshot> {
  readonly schemaVersion: typeof FILE_STORE_SCHEMA_VERSION;
}

export class FileBorealStore implements BorealStore {
  readonly rootDir: string;
  readonly stateFile: string;
  readonly lockDir: string;
  readonly lockOptions: FileLockOptions;

  #writeQueue: Promise<void> = Promise.resolve();

  constructor(options: FileBorealStoreOptions) {
    const paths = resolveWorkspacePaths(options.rootDir);
    this.rootDir = paths.rootDir;
    this.stateFile = resolve(options.stateFile ?? paths.stateFile);
    this.lockDir = resolve(options.lockDir ?? (options.stateFile ? `${this.stateFile}.lock` : paths.stateLockDir));
    this.lockOptions = normalizeFileLockOptions(options.lock);
    assertPathInside(this.rootDir, this.stateFile);
    assertPathInside(this.rootDir, this.lockDir);
  }

  async read<T>(operation: (reader: BorealReader) => Promise<T> | T): Promise<T> {
    const memory = new InMemoryBorealStore(await this.loadSnapshot());
    return memory.read(operation);
  }

  async write<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    const run = this.#writeQueue.then(() => this.writeOnce(operation));
    this.#writeQueue = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  }

  private async writeOnce<T>(operation: (writer: BorealWriter) => Promise<T> | T): Promise<T> {
    await this.assertSafePaths();
    return withFileLock(this.lockDir, this.lockOptions, async () => {
      const memory = new InMemoryBorealStore(await this.loadSnapshot());
      const result = await memory.write(operation);
      await this.saveSnapshot(await memory.snapshot());
      return result;
    });
  }

  private async loadSnapshot(): Promise<StoreSnapshot> {
    await assertRealPathInside(this.rootDir, this.stateFile);
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
    await writeTextFileAtomic(this.stateFile, `${JSON.stringify(document, null, 2)}\n`);
  }

  private async assertSafePaths(): Promise<void> {
    await assertRealPathInside(this.rootDir, this.stateFile);
    await assertRealPathInside(this.rootDir, this.lockDir);
  }
}

function snapshotToDocument(snapshot: StoreSnapshot): StateDocument {
  return {
    schemaVersion: FILE_STORE_SCHEMA_VERSION,
    workItems: snapshot.workItems ?? [],
    evidence: snapshot.evidence ?? [],
    verifications: snapshot.verifications ?? [],
    knowledgeSources: snapshot.knowledgeSources ?? [],
    claims: snapshot.claims ?? [],
    decisions: snapshot.decisions ?? [],
    graphEdges: snapshot.graphEdges ?? [],
    reservations: snapshot.reservations ?? [],
    events: snapshot.events ?? [],
    operations: snapshot.operations ?? [],
    projections: snapshot.projections ?? [],
    contextPacks: snapshot.contextPacks ?? []
  };
}

function documentToSnapshot(value: unknown): StoreSnapshot {
  if (!isRecord(value)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal state file must contain an object");
  }

  if (value.schemaVersion !== FILE_STORE_SCHEMA_VERSION) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Unsupported Boreal state file version", {
      schemaVersion: value.schemaVersion
    });
  }

  const snapshot: StoreSnapshot = {
    workItems: readArray(value, "workItems"),
    evidence: readArray(value, "evidence"),
    verifications: readArray(value, "verifications"),
    knowledgeSources: readArray(value, "knowledgeSources"),
    claims: readArray(value, "claims"),
    decisions: readArray(value, "decisions"),
    graphEdges: readArray(value, "graphEdges"),
    reservations: readArray(value, "reservations"),
    events: readArray(value, "events"),
    operations: readOptionalArray(value, "operations"),
    projections: readArray(value, "projections"),
    contextPacks: readArray(value, "contextPacks")
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
