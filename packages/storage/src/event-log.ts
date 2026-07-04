import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { hashContent, type RuntimeEvent, type RuntimeOperation } from "@boreal/core";

import { writeTextFileAtomic } from "./atomic-write.js";

const GENESIS_HASH = "sha256:genesis";
export const EVENT_LOG_ENTRY_SCHEMA_VERSION = "boreal.event-log-entry.v1";

export interface EventLogEntry {
  readonly schemaVersion: typeof EVENT_LOG_ENTRY_SCHEMA_VERSION;
  readonly seq: number;
  readonly prevHash: string;
  readonly hash: string;
  readonly kind: "event" | "operation";
  readonly record: RuntimeEvent | RuntimeOperation;
}

export class FileEventLog {
  readonly path: string;

  #head: { readonly seq: number; readonly hash: string } | undefined;

  constructor(options: { readonly path: string }) {
    this.path = resolve(options.path);
  }

  async append(kind: EventLogEntry["kind"], record: RuntimeEvent | RuntimeOperation): Promise<EventLogEntry> {
    const head = await this.head();
    const entry = makeEntry({
      seq: head.seq + 1,
      prevHash: head.hash,
      kind,
      record
    });
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(entry)}\n`, "utf8");
    this.#head = { seq: entry.seq, hash: entry.hash };
    return entry;
  }

  async readAll(): Promise<readonly EventLogEntry[]> {
    const entries = parseEntries(await this.readText());
    const last = entries.at(-1);
    this.#head = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
    return entries;
  }

  async head(): Promise<{ readonly seq: number; readonly hash: string }> {
    if (this.#head) {
      return this.#head;
    }
    const entries = await this.readAll();
    const last = entries.at(-1);
    this.#head = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
    return this.#head;
  }

  async verify(): Promise<{ readonly ok: boolean; readonly brokenAtSeq?: number }> {
    const entries = await this.readAll();
    let prevHash = GENESIS_HASH;
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      const expectedSeq = index + 1;
      if (!entry || entry.seq !== expectedSeq || entry.prevHash !== prevHash || entry.hash !== entryHash(entry)) {
        return { ok: false, brokenAtSeq: entry?.seq ?? expectedSeq };
      }
      prevHash = entry.hash;
    }
    return { ok: true };
  }

  async rechain(): Promise<number> {
    const entries = await this.readAll();
    let rewritten = 0;
    let prevHash = GENESIS_HASH;
    const chained = entries.map((entry, index) => {
      const next = makeEntry({
        seq: index + 1,
        prevHash,
        kind: entry.kind,
        record: entry.record
      });
      if (next.seq !== entry.seq || next.prevHash !== entry.prevHash || next.hash !== entry.hash) {
        rewritten += 1;
      }
      prevHash = next.hash;
      return next;
    });
    await mkdir(dirname(this.path), { recursive: true });
    await writeTextFileAtomic(this.path, chained.length > 0 ? `${chained.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "");
    const last = chained.at(-1);
    this.#head = last ? { seq: last.seq, hash: last.hash } : { seq: 0, hash: GENESIS_HASH };
    return rewritten;
  }

  private async readText(): Promise<string> {
    try {
      return await readFile(this.path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }
}

function makeEntry(input: {
  readonly seq: number;
  readonly prevHash: string;
  readonly kind: EventLogEntry["kind"];
  readonly record: RuntimeEvent | RuntimeOperation;
}): EventLogEntry {
  return {
    schemaVersion: EVENT_LOG_ENTRY_SCHEMA_VERSION,
    ...input,
    hash: hashContent({ seq: input.seq, prevHash: input.prevHash, record: input.record })
  };
}

function entryHash(entry: EventLogEntry): string {
  return hashContent({ seq: entry.seq, prevHash: entry.prevHash, record: entry.record });
}

function parseEntries(text: string): EventLogEntry[] {
  const trimmed = text.trim();
  if (!trimmed) {
    return [];
  }
  return trimmed.split("\n").map((line) => normalizeEntry(JSON.parse(line)));
}

function normalizeEntry(value: unknown): EventLogEntry {
  if (!isRecord(value)) {
    throw new Error("Event log entry must be an object");
  }
  const schemaVersion = value.schemaVersion ?? EVENT_LOG_ENTRY_SCHEMA_VERSION;
  if (schemaVersion !== EVENT_LOG_ENTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported event log entry schema version: ${String(schemaVersion)}`);
  }
  return {
    schemaVersion: EVENT_LOG_ENTRY_SCHEMA_VERSION,
    seq: value.seq as number,
    prevHash: value.prevHash as string,
    hash: value.hash as string,
    kind: value.kind as EventLogEntry["kind"],
    record: value.record as EventLogEntry["record"]
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
