import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  createRecordMeta,
  hashContent,
  nowIso,
  randomId,
  withContentHash,
  type EventId,
  type RuntimeEvent,
  type RuntimeOperation
} from "@boreal/core";

import { writeTextFileAtomic } from "./atomic-write.js";
import { DEFAULT_FILE_LOCK_OPTIONS, withFileLock } from "./file-lock.js";

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

export interface EventLogRotationResult {
  readonly archivedPath: string;
  readonly archivedEntries: number;
  readonly archivedHead: {
    readonly seq: number;
    readonly hash: string;
  };
  readonly genesisEntry: EventLogEntry;
}

export interface EventLogVerificationResult {
  readonly ok: boolean;
  readonly brokenAtSeq?: number;
}

export interface EventLogDeepVerificationResult extends EventLogVerificationResult {
  readonly archives: number;
}

export interface EventLogRepairInspection {
  readonly ok: boolean;
  readonly repairable: boolean;
  readonly entries: number;
  readonly brokenAtSeq?: number;
  readonly invalidAtSeq?: number;
  readonly reason?: "parse_error" | "entry_integrity";
  readonly error?: string;
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

  async readAllIncludingArchives(): Promise<readonly EventLogEntry[]> {
    const archiveEntries = await Promise.all((await this.archivePaths()).map(async (path) => parseEntries(await this.readText(path))));
    return [...archiveEntries.flat(), ...(await this.readAll())];
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

  async verify(): Promise<EventLogVerificationResult> {
    const entries = await this.readAll();
    const first = entries[0];
    if (!first) {
      return { ok: true };
    }
    if (first.seq < 1) {
      return { ok: false, brokenAtSeq: first.seq };
    }
    return verifyChainedEntries(entries, {
      seq: first.seq,
      prevHash: first.seq === 1 ? GENESIS_HASH : first.prevHash
    });
  }

  async verifyDeep(): Promise<EventLogDeepVerificationResult> {
    const archivePaths = await this.archivePaths();
    let expectedSeq = 1;
    let prevHash = GENESIS_HASH;
    for (const path of [...archivePaths, this.path]) {
      const entries = parseEntries(await this.readText(path));
      const verification = verifyChainedEntries(entries, {
        seq: expectedSeq,
        prevHash
      });
      if (!verification.ok) {
        return { ...verification, archives: archivePaths.length };
      }
      const last = entries.at(-1);
      if (last) {
        expectedSeq = last.seq + 1;
        prevHash = last.hash;
      }
    }
    return { ok: true, archives: archivePaths.length };
  }

  async inspectRepairableChainBreak(): Promise<EventLogRepairInspection> {
    let entries: readonly EventLogEntry[];
    try {
      entries = parseEntries(await this.readText());
    } catch (error) {
      return {
        ok: false,
        repairable: false,
        entries: 0,
        reason: "parse_error",
        error: error instanceof Error ? error.message : String(error)
      };
    }

    const first = entries[0];
    const verification = !first
      ? { ok: true }
      : first.seq < 1
        ? { ok: false, brokenAtSeq: first.seq }
        : verifyChainedEntries(entries, {
            seq: first.seq,
            prevHash: first.seq === 1 ? GENESIS_HASH : first.prevHash
          });
    if (verification.ok) {
      return { ok: true, repairable: false, entries: entries.length };
    }

    const invalid = entries.find((entry) => entryIntegrityIssue(entry) !== undefined);
    if (invalid) {
      return {
        ok: false,
        repairable: false,
        entries: entries.length,
        brokenAtSeq: verification.brokenAtSeq,
        invalidAtSeq: invalid.seq,
        reason: "entry_integrity",
        error: entryIntegrityIssue(invalid)
      };
    }

    return {
      ok: false,
      repairable: true,
      entries: entries.length,
      brokenAtSeq: verification.brokenAtSeq
    };
  }

  async rotate(): Promise<EventLogRotationResult> {
    return withFileLock(`${this.path}.lock`, DEFAULT_FILE_LOCK_OPTIONS, async () => {
      const entries = parseEntries(await this.readText());
      const archivedHead = entries.at(-1)
        ? { seq: entries.at(-1)?.seq ?? 0, hash: entries.at(-1)?.hash ?? GENESIS_HASH }
        : { seq: 0, hash: GENESIS_HASH };
      const archivedPath = await this.nextArchivePath();
      const archiveText = entries.length > 0 ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
      await mkdir(dirname(this.path), { recursive: true });
      await writeTextFileAtomic(archivedPath, archiveText);

      const genesisEntry = makeEntry({
        seq: archivedHead.seq + 1,
        prevHash: archivedHead.hash,
        kind: "event",
        record: rotationEvent({
          archivedPath,
          archivedEntries: entries.length,
          archivedHead
        })
      });
      await writeTextFileAtomic(this.path, `${JSON.stringify(genesisEntry)}\n`);
      this.#head = { seq: genesisEntry.seq, hash: genesisEntry.hash };
      return {
        archivedPath,
        archivedEntries: entries.length,
        archivedHead,
        genesisEntry
      };
    });
  }

  async rechain(): Promise<number> {
    const entries = await this.readAll();
    let rewritten = 0;
    const first = entries[0];
    let prevHash = first && first.seq > 1 ? first.prevHash : GENESIS_HASH;
    const firstSeq = first?.seq ?? 1;
    const chained = entries.map((entry, index) => {
      const next = makeEntry({
        seq: firstSeq + index,
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

  private async readText(path = this.path): Promise<string> {
    try {
      return await readFile(path, "utf8");
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }

  private async archivePaths(): Promise<readonly string[]> {
    const dir = dirname(this.path);
    const archivePattern = archiveNamePattern(this.path);
    const names = await readdir(dir).catch((error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        return [] as string[];
      }
      throw error;
    });
    return names
      .map((name) => ({ name, match: archivePattern.exec(name) }))
      .filter((entry): entry is { readonly name: string; readonly match: RegExpExecArray } => entry.match !== null)
      .sort((left, right) => Number(left.match[1]) - Number(right.match[1]))
      .map((entry) => join(dir, entry.name));
  }

  private async nextArchivePath(): Promise<string> {
    const archivePaths = await this.archivePaths();
    const next = archivePaths
      .map((path) => archiveNamePattern(this.path).exec(basename(path))?.[1])
      .filter((value): value is string => value !== undefined)
      .map((value) => Number(value))
      .reduce((max, value) => Math.max(max, value), 0) + 1;
    return join(dirname(this.path), `${archiveBaseName(this.path)}-${String(next).padStart(4, "0")}.jsonl.archived`);
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

function entryIntegrityIssue(entry: EventLogEntry): string | undefined {
  if (!Number.isSafeInteger(entry.seq) || entry.seq < 1) {
    return "Event log entry seq must be a positive safe integer";
  }
  if (typeof entry.prevHash !== "string" || entry.prevHash.length === 0) {
    return "Event log entry prevHash must be a non-empty string";
  }
  if (typeof entry.hash !== "string" || entry.hash.length === 0) {
    return "Event log entry hash must be a non-empty string";
  }
  if (entry.kind !== "event" && entry.kind !== "operation") {
    return "Event log entry kind must be event or operation";
  }
  if (!isRecord(entry.record)) {
    return "Event log entry record must be an object";
  }
  if (entry.hash !== entryHash(entry)) {
    return "Event log entry hash does not match its content";
  }
  return undefined;
}

function verifyChainedEntries(
  entries: readonly EventLogEntry[],
  start: { readonly seq: number; readonly prevHash: string }
): EventLogVerificationResult {
  let expectedSeq = start.seq;
  let prevHash = start.prevHash;
  for (const entry of entries) {
    if (entry.seq !== expectedSeq || entry.prevHash !== prevHash || entry.hash !== entryHash(entry)) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    expectedSeq = entry.seq + 1;
    prevHash = entry.hash;
  }
  return { ok: true };
}

function rotationEvent(input: {
  readonly archivedPath: string;
  readonly archivedEntries: number;
  readonly archivedHead: { readonly seq: number; readonly hash: string };
}): RuntimeEvent {
  const now = nowIso();
  return withContentHash({
    meta: createRecordMeta({
      id: randomId<EventId>("event"),
      actor: { id: "boreal.storage", kind: "system", displayName: "Boreal storage" },
      now
    }),
    type: "log.rotated",
    subjectId: "event-log",
    subjectType: "workspace",
    payload: {
      archivedPath: input.archivedPath,
      archivedEntries: input.archivedEntries,
      archivedHead: input.archivedHead
    }
  } satisfies RuntimeEvent);
}

function archiveBaseName(path: string): string {
  const name = basename(path);
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
}

function archiveNamePattern(path: string): RegExp {
  return new RegExp(`^${escapeRegExp(archiveBaseName(path))}-(\\d{4})\\.jsonl\\.archived$`, "u");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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
