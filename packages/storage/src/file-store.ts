import { mkdir, open, readFile, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { BorealError, assertPathInside, resolveWorkspacePaths } from "@boreal/core";

import { normalizeFileLockOptions, withFileLock, type FileLockOptions } from "./file-lock.js";
import { InMemoryBorealStore, type StoreSnapshot } from "./memory-store.js";
import type { BorealReader, BorealStore, BorealWriter } from "./ports.js";

export interface FileBorealStoreOptions {
  readonly rootDir: string;
  readonly stateFile?: string;
  readonly lockDir?: string;
  readonly lock?: Partial<FileLockOptions>;
}

interface StateDocument extends Required<StoreSnapshot> {
  readonly schemaVersion: "boreal.file-store.v1";
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
    return withFileLock(this.lockDir, this.lockOptions, async () => {
      const memory = new InMemoryBorealStore(await this.loadSnapshot());
      const result = await memory.write(operation);
      await this.saveSnapshot(await memory.snapshot());
      return result;
    });
  }

  private async loadSnapshot(): Promise<StoreSnapshot> {
    try {
      const raw = await readFile(this.stateFile, "utf8");
      return documentToSnapshot(JSON.parse(raw) as unknown);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return {};
      }
      if (error instanceof SyntaxError) {
        throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal state file contains invalid JSON", {
          stateFile: this.stateFile
        });
      }
      throw error;
    }
  }

  private async saveSnapshot(snapshot: StoreSnapshot): Promise<void> {
    const document = snapshotToDocument(snapshot);
    const tempFile = `${this.stateFile}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`;
    await mkdir(dirname(this.stateFile), { recursive: true });
    const handle = await open(tempFile, "w", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
      await handle.sync();
      await handle.close();
      await rename(tempFile, this.stateFile);
    } catch (error) {
      await handle.close().catch(() => undefined);
      await unlink(tempFile).catch(() => undefined);
      throw error;
    }
  }
}

function snapshotToDocument(snapshot: StoreSnapshot): StateDocument {
  return {
    schemaVersion: "boreal.file-store.v1",
    workItems: snapshot.workItems ?? [],
    evidence: snapshot.evidence ?? [],
    verifications: snapshot.verifications ?? [],
    knowledgeSources: snapshot.knowledgeSources ?? [],
    claims: snapshot.claims ?? [],
    decisions: snapshot.decisions ?? [],
    graphEdges: snapshot.graphEdges ?? [],
    reservations: snapshot.reservations ?? [],
    events: snapshot.events ?? [],
    projections: snapshot.projections ?? [],
    contextPacks: snapshot.contextPacks ?? []
  };
}

function documentToSnapshot(value: unknown): StoreSnapshot {
  if (!isRecord(value)) {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Boreal state file must contain an object");
  }

  if (value.schemaVersion !== "boreal.file-store.v1") {
    throw new BorealError("BOREAL_STORAGE_ERROR", "Unsupported Boreal state file version", {
      schemaVersion: value.schemaVersion
    });
  }

  return {
    workItems: readArray(value, "workItems"),
    evidence: readArray(value, "evidence"),
    verifications: readArray(value, "verifications"),
    knowledgeSources: readArray(value, "knowledgeSources"),
    claims: readArray(value, "claims"),
    decisions: readArray(value, "decisions"),
    graphEdges: readArray(value, "graphEdges"),
    reservations: readArray(value, "reservations"),
    events: readArray(value, "events"),
    projections: readArray(value, "projections"),
    contextPacks: readArray(value, "contextPacks")
  };
}

function readArray<T = unknown>(value: Record<string, unknown>, key: string): readonly T[] {
  const candidate = value[key];
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
