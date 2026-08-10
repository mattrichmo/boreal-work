import { mkdir, open, readFile, readdir, stat } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

import {
  createRecordMeta,
  hashContent,
  nowIso,
  randomId,
  runtimeEventSchemaIssues,
  runtimeOperationSchemaIssues,
  withContentHash,
  type EventId,
  type RuntimeEvent,
  type RuntimeOperation
} from "@boreal/core";

import { writeTextFileAtomic } from "./atomic-write.js";
import { DEFAULT_FILE_LOCK_OPTIONS, withFileLock } from "./file-lock.js";
import { RecoveryRequiredError } from "./transaction-journal.js";

const GENESIS_HASH = "sha256:genesis";
const LEGACY_EVENT_LOG_ENTRY_SCHEMA_VERSION = "boreal.event-log-entry.v1";
export const EVENT_LOG_ENTRY_SCHEMA_VERSION = "boreal.event-log-entry.v2";

export interface EventLogHead {
  readonly seq: number;
  readonly hash: string;
}

export interface EventLogEntry {
  readonly schemaVersion: typeof EVENT_LOG_ENTRY_SCHEMA_VERSION | typeof LEGACY_EVENT_LOG_ENTRY_SCHEMA_VERSION;
  readonly seq: number;
  readonly prevHash: string;
  /**
   * Immutable parent tips for the branch-native v2 history graph. `prevHash`
   * remains as the canonical parent for readers that only understand v1.
   */
  readonly parentHashes?: readonly string[];
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
  readonly archivedHeads: readonly EventLogHead[];
  readonly genesisEntry: EventLogEntry;
}

export interface EventLogVerificationResult {
  readonly ok: boolean;
  readonly brokenAtSeq?: number;
  readonly diagnostics?: readonly string[];
}

export interface EventLogDeepVerificationResult extends EventLogVerificationResult {
  readonly archives: number;
}

export interface EventLogArchiveInfo {
  readonly path: string;
  readonly bytes: number;
  readonly modifiedAt: string;
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

export type EventLogCorruptionReason =
  | "malformed_record"
  | "torn_final_record"
  | "entry_integrity"
  | "history_integrity";

export class EventLogCorruptionError extends RecoveryRequiredError {
  readonly reason: EventLogCorruptionReason;

  constructor(message: string, reason: EventLogCorruptionReason, details?: Record<string, unknown>) {
    super(message, { reason, ...details });
    this.name = "EventLogCorruptionError";
    this.reason = reason;
  }
}

export class FileEventLog {
  readonly path: string;

  #headCache:
    | {
        readonly signature: string;
        readonly heads: readonly EventLogHead[];
      }
    | undefined;

  #entriesCache:
    | {
        readonly signature: string;
        readonly entries: readonly EventLogEntry[];
      }
    | undefined;

  constructor(options: { readonly path: string }) {
    this.path = resolve(options.path);
  }

  async append(kind: EventLogEntry["kind"], record: RuntimeEvent | RuntimeOperation): Promise<EventLogEntry> {
    return withFileLock(`${this.path}.lock`, DEFAULT_FILE_LOCK_OPTIONS, async () => {
      const heads = await this.verifiedHeads();
      validateRecord(kind, record);
      const canonical = canonicalHead(heads);
      const parentHashes = canonical.seq > 0 ? [canonical.hash] : [];
      const entry = makeEntry({
        seq: canonical.seq + 1,
        parentHashes,
        kind,
        record
      });
      await mkdir(dirname(this.path), { recursive: true });
      await appendTextFileDurable(this.path, `${JSON.stringify(entry)}\n`);
      await this.cacheHeads([headOf(entry)], entry);
      return entry;
    });
  }

  /** Read the complete logical history, including rotated archives. */
  async readAll(): Promise<readonly EventLogEntry[]> {
    return withFileLock(`${this.path}.lock`, DEFAULT_FILE_LOCK_OPTIONS, async () => this.readAllUnlocked());
  }

  /** Read only the mutable live segment. Rotation is the main valid caller. */
  async readLive(): Promise<readonly EventLogEntry[]> {
    return withFileLock(`${this.path}.lock`, DEFAULT_FILE_LOCK_OPTIONS, async () => this.readLiveUnlocked());
  }

  async readAllIncludingArchives(): Promise<readonly EventLogEntry[]> {
    return this.readAll();
  }

  async archiveInfo(): Promise<readonly EventLogArchiveInfo[]> {
    return withFileLock(`${this.path}.lock`, DEFAULT_FILE_LOCK_OPTIONS, async () => {
      const archives: EventLogArchiveInfo[] = [];
      for (const path of await this.archivePaths()) {
        const stats = await stat(path);
        archives.push({ path, bytes: stats.size, modifiedAt: new Date(stats.mtimeMs).toISOString() });
      }
      return archives;
    });
  }

  async heads(): Promise<readonly EventLogHead[]> {
    return withFileLock(`${this.path}.lock`, DEFAULT_FILE_LOCK_OPTIONS, async () => this.verifiedHeads());
  }

  async head(): Promise<EventLogHead> {
    return withFileLock(`${this.path}.lock`, DEFAULT_FILE_LOCK_OPTIONS, async () => canonicalHead(await this.verifiedHeads()));
  }

  async verify(): Promise<EventLogVerificationResult> {
    try {
      const entries = await this.readAll();
      return verifyHistoryGraph(entries, { allowExternalParents: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        brokenAtSeq: sequenceFromError(message),
        diagnostics: [message]
      };
    }
  }

  async verifyDeep(): Promise<EventLogDeepVerificationResult> {
    const archivePaths = await this.archivePaths();
    let verification: EventLogVerificationResult;
    try {
      verification = verifyHistoryGraph(await this.readAll(), { allowExternalParents: false });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      verification = {
        ok: false,
        brokenAtSeq: sequenceFromError(message),
        diagnostics: [message]
      };
    }
    return { ...verification, archives: archivePaths.length };
  }

  async inspectRepairableChainBreak(): Promise<EventLogRepairInspection> {
    let entries: readonly EventLogEntry[];
    try {
      // A merge-repair candidate can have duplicate sequence numbers or a
      // forked chain, which readAll intentionally rejects. Rechain operates
      // on the live segment, so inspect that raw segment when no archives are
      // present and reserve archive-aware failures for manual recovery.
      entries = (await this.archivePaths()).length === 0 ? await this.readLive() : await this.readAll();
    } catch (error) {
      return {
        ok: false,
        repairable: false,
        entries: 0,
        reason: "parse_error",
        error: error instanceof Error ? error.message : String(error)
      };
    }

    const verification = verifyHistoryGraph(entries, { allowExternalParents: false });
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
      const entries = await this.readLiveUnlocked();
      const archivedHeads = await this.verifiedHeads();
      const archivedHead = canonicalHead(archivedHeads);
      const archivedPath = await this.nextArchivePath();
      const archiveText = entries.length > 0 ? `${entries.map((entry) => JSON.stringify(entry)).join("\n")}\n` : "";
      await mkdir(dirname(this.path), { recursive: true });
      await writeTextFileAtomic(archivedPath, archiveText);

      const genesisEntry = makeEntry({
        seq: canonicalHead(archivedHeads).seq + 1,
        parentHashes: canonicalHead(archivedHeads).seq > 0 ? [canonicalHead(archivedHeads).hash] : [],
        kind: "event",
        record: rotationEvent({
          archivedPath,
          archivedEntries: entries.length,
          archivedHead,
          archivedHeads
        })
      });
      await writeTextFileAtomic(this.path, `${JSON.stringify(genesisEntry)}\n`);
      await this.cacheHeads([headOf(genesisEntry)]);
      this.#entriesCache = undefined;
      return {
        archivedPath,
        archivedEntries: entries.length,
        archivedHead,
        archivedHeads,
        genesisEntry
      };
    });
  }

  async rechain(): Promise<number> {
    return withFileLock(`${this.path}.lock`, DEFAULT_FILE_LOCK_OPTIONS, async () => {
      const entries = [...(await this.readLiveUnlocked())].sort((left, right) => {
        if (left.seq === 0 && right.seq !== 0) return 1;
        if (left.seq !== 0 && right.seq === 0) return -1;
        return left.seq - right.seq || left.hash.localeCompare(right.hash);
      });
      let rewritten = 0;
      const first = entries[0];
      const hasArchivedHistory = (await this.archivePaths()).length > 0;
      const firstSeq = hasArchivedHistory && first && first.seq > 1 ? first.seq : 1;
      let prevHash = hasArchivedHistory && firstSeq > 1 ? first?.prevHash ?? GENESIS_HASH : GENESIS_HASH;
      const chained = entries.map((entry, index) => {
        const next = makeRechainedEntry(entry, { seq: firstSeq + index, prevHash });
        if (next.seq !== entry.seq || next.prevHash !== entry.prevHash || next.hash !== entry.hash) {
          rewritten += 1;
        }
        prevHash = next.hash;
        return next;
      });
      await mkdir(dirname(this.path), { recursive: true });
      await writeTextFileAtomic(
        this.path,
        chained.length > 0 ? `${chained.map((entry) => JSON.stringify(entry)).join("\n")}\n` : ""
      );
      this.#headCache = undefined;
      this.#entriesCache = undefined;
      return rewritten;
    });
  }

  private async readAllUnlocked(): Promise<readonly EventLogEntry[]> {
    const paths = [...(await this.archivePaths()), this.path];
    const signature = await this.historySignature(paths);
    if (this.#entriesCache?.signature === signature) {
      return this.#entriesCache.entries;
    }
    const entries = await this.readPaths(paths);
    const verification = verifyHistoryGraph(entries, { allowExternalParents: false });
    if (!verification.ok) {
      const invalid = entries.find((entry) => entryIntegrityIssue(entry) !== undefined);
      throw new EventLogCorruptionError(
        `Event history graph is invalid at seq ${String(verification.brokenAtSeq ?? "unknown")}${
          verification.diagnostics?.length ? `: ${verification.diagnostics.join("; ")}` : ""
        }`,
        invalid ? "entry_integrity" : "history_integrity",
        {
          paths,
          brokenAtSeq: verification.brokenAtSeq,
          invalidAtSeq: invalid?.seq,
          diagnostics: verification.diagnostics
        }
      );
    }
    this.#headCache = { signature, heads: graphHeads(entries) };
    this.#entriesCache = { signature, entries };
    return entries;
  }

  private async readLiveUnlocked(): Promise<readonly EventLogEntry[]> {
    return normalizeHistoryEntries(parseEntries(await this.readText(), this.path));
  }

  private async verifiedHeads(): Promise<readonly EventLogHead[]> {
    const paths = [...(await this.archivePaths()), this.path];
    const signature = await this.historySignature(paths);
    if (this.#headCache?.signature === signature) {
      return this.#headCache.heads;
    }
    const entries = await this.readPaths(paths);
    const verification = verifyHistoryGraph(entries, { allowExternalParents: false });
    if (!verification.ok) {
      const invalid = entries.find((entry) => entryIntegrityIssue(entry) !== undefined);
      throw new EventLogCorruptionError(
        `Event history graph is invalid at seq ${String(verification.brokenAtSeq ?? "unknown")}`,
        invalid ? "entry_integrity" : "history_integrity",
        {
          paths,
          brokenAtSeq: verification.brokenAtSeq,
          invalidAtSeq: invalid?.seq,
          diagnostics: verification.diagnostics
        }
      );
    }
    const heads = graphHeads(entries);
    this.#headCache = { signature, heads };
    return heads;
  }

  private async cacheHeads(heads: readonly EventLogHead[], appendedEntry?: EventLogEntry): Promise<void> {
    const paths = [...(await this.archivePaths()), this.path];
    const signature = await this.historySignature(paths);
    this.#headCache = {
      signature,
      heads: normalizeHeads(heads)
    };
    if (appendedEntry && this.#entriesCache) {
      this.#entriesCache = {
        signature,
        entries: [...this.#entriesCache.entries, appendedEntry]
      };
    }
  }

  private async readPaths(paths: readonly string[]): Promise<readonly EventLogEntry[]> {
    return normalizeHistoryEntries(
      (await Promise.all(paths.map(async (path) => parseEntries(await this.readText(path), path)))).flat()
    );
  }

  private async historySignature(paths: readonly string[]): Promise<string> {
    const rows = await Promise.all(
      paths.map(async (path) => {
        const stats = await stat(path).catch((error) => {
          if (isNodeError(error) && error.code === "ENOENT") {
            return undefined;
          }
          throw error;
        });
        if (!stats) {
          return `${basename(path)}:missing`;
        }
        return `${basename(path)}:${stats.dev}:${stats.ino}:${stats.size}:${stats.mtimeMs}:${stats.ctimeMs}`;
      })
    );
    return hashContent(rows);
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

function sequenceFromError(message: string): number | undefined {
  const match = /at seq (\d+)/u.exec(message);
  return match ? Number(match[1]) : undefined;
}

function makeEntry(input: {
  readonly seq: number;
  readonly parentHashes: readonly string[];
  readonly kind: EventLogEntry["kind"];
  readonly record: RuntimeEvent | RuntimeOperation;
}): EventLogEntry {
  const parentHashes = [...new Set(input.parentHashes)].sort((left, right) => left.localeCompare(right));
  const entry: Omit<EventLogEntry, "hash"> = {
    schemaVersion: EVENT_LOG_ENTRY_SCHEMA_VERSION,
    seq: input.seq,
    prevHash: parentHashes.at(-1) ?? GENESIS_HASH,
    parentHashes,
    kind: input.kind,
    record: input.record
  };
  return { ...entry, hash: hashContent(entry) };
}

function makeLegacyEntry(input: {
  readonly seq: number;
  readonly prevHash: string;
  readonly kind: EventLogEntry["kind"];
  readonly record: RuntimeEvent | RuntimeOperation;
}): EventLogEntry {
  return {
    schemaVersion: LEGACY_EVENT_LOG_ENTRY_SCHEMA_VERSION,
    ...input,
    hash: hashContent({ seq: input.seq, prevHash: input.prevHash, record: input.record })
  };
}

function makeRechainedEntry(
  entry: EventLogEntry,
  input: { readonly seq: number; readonly prevHash: string }
): EventLogEntry {
  if (entry.schemaVersion === LEGACY_EVENT_LOG_ENTRY_SCHEMA_VERSION) {
    return makeLegacyEntry({ ...input, kind: entry.kind, record: entry.record });
  }
  return makeEntry({
    seq: input.seq,
    parentHashes: input.prevHash === GENESIS_HASH ? [] : [input.prevHash],
    kind: entry.kind,
    record: entry.record
  });
}

function entryHash(entry: EventLogEntry): string {
  if (entry.schemaVersion === EVENT_LOG_ENTRY_SCHEMA_VERSION) {
    return hashContent({
      schemaVersion: entry.schemaVersion,
      seq: entry.seq,
      prevHash: entry.prevHash,
      parentHashes: entry.parentHashes,
      kind: entry.kind,
      record: entry.record
    });
  }
  return hashContent({ seq: entry.seq, prevHash: entry.prevHash, record: entry.record });
}

function entryIntegrityIssue(entry: EventLogEntry): string | undefined {
  if (
    entry.schemaVersion !== EVENT_LOG_ENTRY_SCHEMA_VERSION &&
    entry.schemaVersion !== LEGACY_EVENT_LOG_ENTRY_SCHEMA_VERSION
  ) {
    return "Event log entry schema version is unsupported";
  }
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
  const recordIssues = entry.kind === "event"
    ? runtimeEventSchemaIssues(entry.record, `eventLog.${entry.seq}.record`)
    : runtimeOperationSchemaIssues(entry.record, `eventLog.${entry.seq}.record`);
  if (recordIssues.length > 0) {
    return `Event log record failed schema validation: ${recordIssues[0]?.message ?? "invalid record"}`;
  }
  if (entry.schemaVersion === EVENT_LOG_ENTRY_SCHEMA_VERSION) {
    if (!Array.isArray(entry.parentHashes) || entry.parentHashes.some((hash) => typeof hash !== "string" || hash.length === 0)) {
      return "Event log v2 parentHashes must be an array of non-empty strings";
    }
    const normalizedParents = [...new Set(entry.parentHashes)].sort((left, right) => left.localeCompare(right));
    if (
      normalizedParents.length !== entry.parentHashes.length ||
      normalizedParents.some((hash, index) => hash !== entry.parentHashes?.[index])
    ) {
      return "Event log v2 parentHashes must be unique and sorted";
    }
    if (entry.prevHash !== (normalizedParents.at(-1) ?? GENESIS_HASH)) {
      return "Event log v2 prevHash must identify its canonical parent";
    }
    if (entry.seq === 1 && normalizedParents.length > 0) {
      return "Event log v2 genesis entries cannot have parents";
    }
    if (entry.seq > 1 && normalizedParents.length === 0) {
      return "Event log v2 non-genesis entries must have at least one parent";
    }
  }
  if (entry.hash !== entryHash(entry)) {
    return "Event log entry hash does not match its content";
  }
  return undefined;
}

function verifyHistoryGraph(
  entries: readonly EventLogEntry[],
  options: { readonly allowExternalParents: boolean }
): EventLogVerificationResult {
  const byHash = new Map(entries.map((entry) => [entry.hash, entry]));
  const seenSeq = new Set<number>();
  const roots: EventLogEntry[] = [];
  for (const entry of entries) {
    if (entryIntegrityIssue(entry)) {
      return { ok: false, brokenAtSeq: entry.seq, diagnostics: [entryIntegrityIssue(entry) ?? "entry integrity failure"] };
    }
    if (seenSeq.has(entry.seq)) {
      return { ok: false, brokenAtSeq: entry.seq, diagnostics: [`duplicate sequence number ${entry.seq}`] };
    }
    seenSeq.add(entry.seq);
    const parents = entryParents(entry);
    if (parents.includes(entry.hash)) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    const resolvedParents = parents.map((hash) => byHash.get(hash)).filter((parent): parent is EventLogEntry => parent !== undefined);
    if (!options.allowExternalParents && resolvedParents.length !== parents.length) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    if (resolvedParents.some((parent) => parent.seq >= entry.seq)) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    if (parents.length === 0 && entry.seq !== 1) {
      return { ok: false, brokenAtSeq: entry.seq };
    }
    if (parents.length === 0) {
      roots.push(entry);
    }
    if (parents.length > 0 && resolvedParents.length === parents.length) {
      const expectedSeq = Math.max(...resolvedParents.map((parent) => parent.seq)) + 1;
      if (entry.seq !== expectedSeq) {
        return { ok: false, brokenAtSeq: entry.seq };
      }
    }
  }
  if (entries.length > 0 && roots.length !== 1) {
    return {
      ok: false,
      brokenAtSeq: roots[0]?.seq ?? entries[0]?.seq,
      diagnostics: [`expected exactly one history root, found ${roots.length}`]
    };
  }
  return { ok: true };
}

function entryParents(entry: EventLogEntry): readonly string[] {
  if (entry.schemaVersion === EVENT_LOG_ENTRY_SCHEMA_VERSION) {
    return Array.isArray(entry.parentHashes) ? entry.parentHashes : [];
  }
  return entry.prevHash === GENESIS_HASH ? [] : [entry.prevHash];
}

function normalizeHistoryEntries(entries: readonly EventLogEntry[]): readonly EventLogEntry[] {
  const byHash = new Map<string, { readonly entry: EventLogEntry; readonly semanticHash: string }>();
  const unhashed: EventLogEntry[] = [];
  for (const entry of entries) {
    if (entry.hash.length === 0) {
      unhashed.push(entry);
      continue;
    }
    const semanticHash = hashContent(entry);
    const existing = byHash.get(entry.hash);
    if (existing && existing.semanticHash !== semanticHash) {
      throw new EventLogCorruptionError(
        `Event history contains different entries with hash ${entry.hash}`,
        "entry_integrity",
        { hash: entry.hash }
      );
    }
    if (!existing) {
      byHash.set(entry.hash, { entry, semanticHash });
    }
  }
  return [...[...byHash.values()].map(({ entry }) => entry), ...unhashed]
    .sort((left, right) => left.seq - right.seq || left.hash.localeCompare(right.hash));
}

function graphHeads(entries: readonly EventLogEntry[]): readonly EventLogHead[] {
  if (entries.length === 0) {
    return [{ seq: 0, hash: GENESIS_HASH }];
  }
  const hashes = new Set(entries.map((entry) => entry.hash));
  const referenced = new Set(entries.flatMap((entry) => entryParents(entry)).filter((hash) => hashes.has(hash)));
  return normalizeHeads(entries.filter((entry) => !referenced.has(entry.hash)).map(headOf));
}

function normalizeHeads(heads: readonly EventLogHead[]): readonly EventLogHead[] {
  const byHash = new Map(heads.map((head) => [head.hash, head]));
  const normalized = [...byHash.values()].sort((left, right) => left.seq - right.seq || left.hash.localeCompare(right.hash));
  return normalized.length > 0 ? normalized : [{ seq: 0, hash: GENESIS_HASH }];
}

function canonicalHead(heads: readonly EventLogHead[]): EventLogHead {
  return normalizeHeads(heads).at(-1) ?? { seq: 0, hash: GENESIS_HASH };
}

function headOf(entry: EventLogEntry): EventLogHead {
  return { seq: entry.seq, hash: entry.hash };
}

function rotationEvent(input: {
  readonly archivedPath: string;
  readonly archivedEntries: number;
  readonly archivedHead: EventLogHead;
  readonly archivedHeads: readonly EventLogHead[];
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
      archivedPath: basename(input.archivedPath),
      archivedEntries: input.archivedEntries,
      archivedHead: input.archivedHead,
      archivedHeads: input.archivedHeads
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

function parseEntries(text: string, path: string): EventLogEntry[] {
  if (!text.trim()) {
    return [];
  }
  const hasFinalNewline = text.endsWith("\n");
  const lines = (hasFinalNewline ? text.slice(0, -1) : text).split("\n");
  const entries: EventLogEntry[] = [];
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) {
      continue;
    }
    try {
      entries.push(normalizeEntry(JSON.parse(line)));
    } catch (error) {
      const isFinalPartialLine = !hasFinalNewline && index === lines.length - 1;
      throw new EventLogCorruptionError(
        isFinalPartialLine
          ? `Event log final record is torn at line ${index + 1}`
          : `Event log line ${index + 1} is malformed`,
        isFinalPartialLine ? "torn_final_record" : "malformed_record",
        {
          path,
          line: index + 1,
          finalNewlinePresent: hasFinalNewline,
          cause: error instanceof Error ? error.message : String(error)
        }
      );
    }
  }
  return entries;
}

function normalizeEntry(value: unknown): EventLogEntry {
  if (!isRecord(value)) {
    throw new Error("Event log entry must be an object");
  }
  const schemaVersion = value.schemaVersion ?? LEGACY_EVENT_LOG_ENTRY_SCHEMA_VERSION;
  if (schemaVersion !== EVENT_LOG_ENTRY_SCHEMA_VERSION && schemaVersion !== LEGACY_EVENT_LOG_ENTRY_SCHEMA_VERSION) {
    throw new Error(`Unsupported event log entry schema version: ${String(schemaVersion)}`);
  }
  return {
    schemaVersion: schemaVersion as EventLogEntry["schemaVersion"],
    seq: value.seq as number,
    prevHash: value.prevHash as string,
    ...(schemaVersion === EVENT_LOG_ENTRY_SCHEMA_VERSION
      ? { parentHashes: value.parentHashes as readonly string[] }
      : {}),
    hash: value.hash as string,
    kind: value.kind as EventLogEntry["kind"],
    record: value.record as EventLogEntry["record"]
  };
}

function validateRecord(kind: EventLogEntry["kind"], record: RuntimeEvent | RuntimeOperation): void {
  const issues = kind === "event"
    ? runtimeEventSchemaIssues(record, "eventLog.record")
    : runtimeOperationSchemaIssues(record, "eventLog.record");
  if (issues.length > 0) {
    throw new Error(`Cannot append invalid ${kind} record: ${issues[0]?.message ?? "schema validation failed"}`);
  }
  const serialized = JSON.stringify(record);
  if (serialized === undefined || Buffer.byteLength(serialized, "utf8") > 1024 * 1024) {
    throw new Error(`Cannot append ${kind} record larger than 1 MiB`);
  }
}

async function appendTextFileDurable(path: string, content: string): Promise<void> {
  const handle = await open(path, "a", 0o600);
  try {
    await handle.writeFile(content, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
