# Boreal Storage Engine & Git Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the O(N²) clone-and-rewrite-the-world behavior of the Boreal runtime, migrate storage to a git-first per-record object store with a hash-chained event log, and make git branch lifecycle a runtime-enforced responsibility.

**Architecture:** Six phases, each independently shippable. Phases 1–3 fix performance inside the existing `FileBorealStore` (kill inline artifact refresh, evict derived/historical data from the state document, replace deep-clone semantics with freeze-on-load + copy-on-write, make readiness/context recompute incremental). Phase 4 introduces `ObjectDirBorealStore` (one JSON file per record under `.boreal/objects/`, append-only hash-chained `events.jsonl`) behind the existing `BorealStore` port, with a migration command. Phase 5 makes epic/sprint branch naming deterministic and enforced at claim/finish. Phase 6 fixes error-domain declaration and splits `commands.ts`.

**Tech Stack:** TypeScript 5.7, Node >= 22, pnpm workspaces, vitest. No new runtime dependencies (uses `node:crypto`, `node:fs`; `node:sqlite` only behind feature detection).

## Global Constraints

- `"type": "module"`; all imports use `.js` extensions in source (existing convention).
- Node engines floor stays `>=22.0.0`; anything needing `node:sqlite` must feature-detect (`try { await import("node:sqlite") } catch {}`) and degrade gracefully — the existing `sqliteAvailable` pattern.
- Every phase must leave `pnpm check` (tsc -b) and `pnpm test` green.
- The `BorealStore` / `BorealReader` / `BorealWriter` interfaces in `packages/storage/src/ports.ts` are the stability boundary: Phases 1–4 must not change their method signatures (adding methods is allowed; changing/removing is not).
- All new persisted formats get a schema version string and a loader that accepts the previous version (no more brick-on-mismatch).
- Never write to `state.json`, ledgers, or objects except through `writeTextFileAtomic` (`packages/storage/src/atomic-write.ts`).
- Run all tests with `pnpm vitest run <file>` from the repo root.
- Commit after every task. Commit messages: `perf:`, `feat:`, `refactor:`, `test:` prefixes.

## Precondition (before Task 1)

The working tree currently has ~50 modified files on `main`. **Do not start until the tree is clean.** Ask the user to commit or stash their WIP, then:

```bash
git switch -c boreal/storage-engine
```

If the tree is already clean, just create the branch.

---

## Phase 1 — Stop the bleeding

### Task 1: Baseline benchmark

**Files:**
- Create: `tools/bench-mutation.mjs`

**Interfaces:**
- Produces: `node tools/bench-mutation.mjs <workspace-dir>` printing JSON `{ closeMs, stateBytes, filesWritten }`. Used at the end of every phase to prove the win.

- [x] **Step 1: Write the benchmark script**

```js
// tools/bench-mutation.mjs
// Seeds a throwaway workspace with N work items + edges, then times one
// `work close` through the built CLI. Usage: node tools/bench-mutation.mjs [count]
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const count = Number(process.argv[2] ?? 200);
const ws = mkdtempSync(join(tmpdir(), "boreal-bench-"));
const bwrk = (args) =>
  execFileSync("pnpm", ["--silent", "bwrk", ...args, "--workspace", ws, "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"]
  });

bwrk(["init"]);
const ids = [];
for (let i = 0; i < count; i += 1) {
  const out = JSON.parse(bwrk(["work", "create", "--title", `bench item ${i}`, "--kind", "task", "--ready"]));
  ids.push(out.result?.meta?.id ?? out.meta?.id ?? out.workId ?? out.id);
}
// chain half of them as blockers to make readiness recompute non-trivial
for (let i = 1; i < count / 2; i += 1) {
  bwrk(["work", "block", ids[i], "--by", ids[i - 1]]);
}

const target = ids[0];
bwrk(["agent", "start", target, "--agent", "bench-agent"]);
const t0 = performance.now();
bwrk([
  "agent", "finish", target,
  "--agent", "bench-agent",
  "--summary", "bench close",
  "--evidence-summary", "bench evidence",
  "--evidence-kind", "command",
  "--evidence-outcome", "passed",
  "--verdict", "passed",
  "--close-reason", "bench"
]);
const closeMs = performance.now() - t0;

const stateFile = join(ws, ".boreal", "runtime", "state.json");
const stateBytes = statSync(stateFile).size;
const runtimeDir = join(ws, ".boreal", "runtime");
console.log(JSON.stringify({ workspace: ws, count, closeMs: Math.round(closeMs), stateBytes, runtimeFiles: readdirSync(runtimeDir) }, null, 2));
```

> Note: the exact `agent finish` flags must match `docs/cli/COMMANDS.md`. If a flag name differs, fix the script (not the CLI) — the script is a consumer.

- [x] **Step 2: Run it and record the baseline**

Run: `node tools/bench-mutation.mjs 200`
Expected: JSON output. Paste the numbers into the commit message.

- [x] **Step 3: Commit**

```bash
git add tools/bench-mutation.mjs
git commit -m "test: add mutation benchmark (baseline: <closeMs>ms, <stateBytes> bytes)"
```

### Task 2: Kill inline generated-artifact refresh

**Files:**
- Modify: `apps/cli/src/commands.ts` (the `INLINE_GENERATED_ARTIFACT_REFRESH_COMMANDS` Set, ~line 8695, and `shouldRefreshGeneratedArtifactsAfterMutation`)
- Test: `tests/runtime/generated-artifact-staleness.test.ts` (create)

**Interfaces:**
- Consumes: existing `inspectSearchIndex(context)` from `apps/cli/src/search-cli.ts` (returns `{ stale: boolean, ... }` via content hash).
- Produces: mutation commands no longer rebuild search index / ledgers / sqlite cache / all projections inline. Staleness remains detectable via content hashes; `bwrk sync refresh` remains the explicit rebuild path. `bwrk doctor` must report stale artifacts as `info`, not `error`.

- [x] **Step 1: Write the failing test**

```ts
// tests/runtime/generated-artifact-staleness.test.ts
import { statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// Reuse the repo's existing CLI test harness. tests/runtime/cli.test.ts has a
// helper that creates a temp workspace and invokes main() — import the same
// helper (look for `createTestWorkspace` / `runCli` exports or copy the pattern).

describe("generated artifacts after mutation", () => {
  it("does not rewrite the search index inline on work close", async () => {
    const ws = await createTestWorkspace();
    await runCli(["init"], ws);
    const created = await runCli(["work", "create", "--title", "t", "--kind", "task", "--ready", "--json"], ws);
    const workId = created.json.result.meta.id;
    await runCli(["sync", "refresh", "--json"], ws); // build artifacts once
    const indexPath = join(ws, ".boreal", "runtime", "search-index.json");
    const before = statSync(indexPath).mtimeMs;

    await runCli(["agent", "start", workId, "--agent", "a1", "--json"], ws);
    await runCli(["agent", "finish", workId, "--agent", "a1", /* evidence+verdict+close flags */ "--json"], ws);

    expect(statSync(indexPath).mtimeMs).toBe(before); // not rewritten inline
    const status = await runCli(["sync", "status", "--json"], ws);
    expect(status.json.result?.searchIndexFresh ?? status.json.searchIndexFresh).toBe(false); // but detectably stale
  });
});
```

- [x] **Step 2: Run it, verify it fails** (`pnpm vitest run tests/runtime/generated-artifact-staleness.test.ts` — index mtime changes today).

- [x] **Step 3: Implement**

In `apps/cli/src/commands.ts`, empty the set and leave a tombstone comment:

```ts
// Inline refresh after mutations was removed: it rewrote every projection,
// the full search index, all ledgers, and the sqlite cache on each mutating
// command (O(all records) per mutation). Artifacts are content-hash stamped;
// staleness is detected by sync status/doctor and rebuilt by `sync refresh`.
const INLINE_GENERATED_ARTIFACT_REFRESH_COMMANDS = new Set<string>([]);
```

Then chase the other unconditional call sites found at `commands.ts:1238`, `:11874`, `:13864`, `:13868` — each of those is inside a specific command (read the surrounding function): keep the call **only** where the command's purpose *is* rebuilding (e.g. `sync refresh`, import/restore paths); delete it from mutation paths. Check `doctor.ts` treats `search.index` / `cache.sqlite` / `ledger.status` staleness (see `commands.ts:2732`) as non-error severity; downgrade if needed.

- [x] **Step 4: Run the new test and the full suite** (`pnpm vitest run tests/runtime/generated-artifact-staleness.test.ts && pnpm test`). Fix any test that asserted inline freshness by pointing it at `sync refresh` instead.

- [x] **Step 5: Re-run benchmark, commit**

```bash
node tools/bench-mutation.mjs 200
git add -A && git commit -m "perf: remove inline generated-artifact refresh from mutation commands (<closeMs>ms)"
```

### Task 3: Stop pretty-printing the state file

**Files:**
- Modify: `packages/storage/src/file-store.ts:93`
- Test: `tests/runtime/file-store.test.ts` (existing — extend)

- [ ] **Step 1: Write the failing test**

```ts
it("persists compact JSON", async () => {
  const store = new FileBorealStore({ rootDir });
  await store.write(async (w) => w.putWorkItem(sampleWorkItem()));
  const raw = await readFile(store.stateFile, "utf8");
  expect(raw.startsWith('{"schemaVersion"')).toBe(true); // no indentation
});
```

- [ ] **Step 2: Verify it fails**, then change `file-store.ts:93`:

```ts
await writeTextFileAtomic(this.stateFile, `${JSON.stringify(document)}\n`);
```

- [ ] **Step 3: Run `pnpm vitest run tests/runtime/file-store.test.ts` → PASS. Commit** `perf: write state file compact`.

### Task 4: Freeze-on-load reads — stop cloning on every get/list

**Files:**
- Modify: `packages/core/src/clone.ts` (add `deepFreeze`), `packages/core/src/index.ts` (export it)
- Modify: `packages/storage/src/memory-store.ts` (all `MemoryTransaction` read methods)
- Test: `tests/runtime/memory-store-immutability.test.ts` (create)

**Interfaces:**
- Produces: `deepFreeze<T>(value: T): T` (recursively `Object.freeze`s and returns the same reference). Read methods return **frozen shared references** instead of clones. Write methods (`put*`) still `deepClone` their input once (defensive copy of caller-owned data) and freeze it.

- [ ] **Step 1: Write the failing test**

```ts
// tests/runtime/memory-store-immutability.test.ts
import { describe, expect, it } from "vitest";
import { InMemoryBorealStore } from "@boreal/storage";

describe("memory store immutability", () => {
  it("returns frozen records from reads without cloning per call", async () => {
    const store = new InMemoryBorealStore({ workItems: [sampleWorkItem("bw_work_a")] });
    await store.read(async (reader) => {
      const [a] = await reader.listWorkItems();
      const [b] = await reader.listWorkItems();
      expect(Object.isFrozen(a)).toBe(true);
      expect(Object.isFrozen(a.labels)).toBe(true);
      expect(a).toBe(b); // same reference — no per-call clone
    });
  });

  it("does not let a put alias caller-owned mutable data", async () => {
    const store = new InMemoryBorealStore();
    const item = sampleWorkItem("bw_work_b");
    await store.write(async (w) => w.putWorkItem(item));
    (item as any).title = "mutated after put";
    await store.read(async (r) => {
      const got = await r.getWorkItem("bw_work_b" as any);
      expect(got?.title).not.toBe("mutated after put");
    });
  });
});
```

- [ ] **Step 2: Verify it fails** (reads are cloned, not frozen; `a !== b`).

- [ ] **Step 3: Implement `deepFreeze`**

```ts
// packages/core/src/clone.ts
export function deepClone<T>(value: T): T {
  return structuredClone(value);
}

export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Object.getOwnPropertyNames(value)) {
    deepFreeze((value as Record<string, unknown>)[key]);
  }
  return Object.freeze(value);
}
```

- [ ] **Step 4: Rewrite `MemoryTransaction` read/write paths**

In `memory-store.ts`: records stored in the state maps are **always frozen**. Every read method drops its `deepClone`/`cloneMaybe` wrapper and returns references directly, e.g.:

```ts
async listWorkItems(filter?: WorkItemFilter): Promise<readonly WorkItem[]> {
  return [...this.state.workItems.values()].filter((item) => matchesWorkFilter(item, filter));
}
async getWorkItem(id: WorkId): Promise<WorkItem | undefined> {
  return this.state.workItems.get(id);
}
```

Every `put*` becomes `set(id, deepFreeze(deepClone(record)))`. In `createState`, seed with `deepFreeze(deepClone(item))`. Delete `cloneMaybe`. In `InMemoryBorealStore.read/write`, drop the `deepClone(result)` on the return value (results are frozen; callers can't mutate them anyway) and drop the outer `cloneState` in `read()` (readers can't mutate frozen state).

Keep `cloneState` in `write()` for now — Task 5 removes it.

- [ ] **Step 5: Run new test + full suite.** Failures here are *findings*: any code that mutated a record returned from the store was silently relying on clones — fix the caller to spread (`{ ...work, status }`), which is already the dominant style in `runtime.ts`.

- [ ] **Step 6: Commit** `perf: freeze-on-load storage reads, clone only on put`.

### Task 5: Copy-on-write transactions — stop cloning state per write

**Files:**
- Modify: `packages/storage/src/memory-store.ts` (`InMemoryBorealStore.write`, `cloneState`)
- Test: extend `tests/runtime/memory-store-immutability.test.ts`

**Interfaces:**
- Produces: `write()` runs the operation against an **overlay transaction** (pending puts/deletes in fresh Maps layered over the shared frozen base); commit = `new Map([...base, ...pending])` per touched section (cheap: copies references, not records). A thrown operation discards the overlay — same rollback semantics as today.

- [ ] **Step 1: Write the failing test**

```ts
it("rolls back all puts when the operation throws", async () => {
  const store = new InMemoryBorealStore();
  await expect(
    store.write(async (w) => {
      await w.putWorkItem(sampleWorkItem("bw_work_x"));
      throw new Error("boom");
    })
  ).rejects.toThrow("boom");
  await store.read(async (r) => {
    expect(await r.getWorkItem("bw_work_x" as any)).toBeUndefined();
  });
});

it("write transactions read their own uncommitted puts", async () => {
  const store = new InMemoryBorealStore();
  await store.write(async (w) => {
    await w.putWorkItem(sampleWorkItem("bw_work_y"));
    expect(await w.getWorkItem("bw_work_y" as any)).toBeDefined();
    expect((await w.listWorkItems()).length).toBe(1);
  });
});
```

(First already passes via cloneState — keep it as a regression guard; second is the overlay contract.)

- [ ] **Step 2: Implement the overlay**

```ts
interface SectionOverlay<K, V> {
  readonly base: ReadonlyMap<K, V>;
  readonly pending: Map<K, V>;
  readonly deleted: Set<K>;
}

function overlayGet<K, V>(o: SectionOverlay<K, V>, id: K): V | undefined {
  if (o.deleted.has(id)) return undefined;
  return o.pending.get(id) ?? o.base.get(id);
}
function overlayValues<K, V>(o: SectionOverlay<K, V>): V[] {
  const out: V[] = [];
  for (const [id, v] of o.base) if (!o.deleted.has(id) && !o.pending.has(id)) out.push(v);
  out.push(...o.pending.values());
  return out;
}
function overlayCommit<K, V>(o: SectionOverlay<K, V>): Map<K, V> {
  const merged = new Map(o.base);
  for (const id of o.deleted) merged.delete(id);
  for (const [id, v] of o.pending) merged.set(id, v);
  return merged;
}
```

`MemoryTransaction` holds one `SectionOverlay` per section; `put*` = `pending.set(id, deepFreeze(deepClone(r))); deleted.delete(id)`; `delete*` = `deleted.add(id); pending.delete(id)`. `InMemoryBorealStore.write` builds overlays over `#state`, runs the op, and on success replaces `#state` with committed maps. Delete `cloneState`.

- [ ] **Step 3: Run tests, run benchmark, commit** `perf: copy-on-write transactions replace full-state clone (<closeMs>ms)`.

---

## Phase 2 — Slim the state document

### Task 6: Evict projections and context packs from persistence

**Files:**
- Modify: `packages/storage/src/file-store.ts` (`snapshotToDocument`, `documentToSnapshot`, version constant)
- Modify: `packages/engine/src/runtime.ts` (`getContextPack` — rebuild on miss instead of erroring)
- Test: extend `tests/runtime/file-store.test.ts`

**Interfaces:**
- Produces: `FILE_STORE_SCHEMA_VERSION = "boreal.file-store.v2"`; the persisted document has **no** `projections` / `contextPacks` sections. Loader accepts v1 (silently dropping those sections) and v2. Context packs live only in memory for the life of a process; `getContextPack(workId)` rebuilds on miss via the existing `refreshWorkContext` logic instead of throwing "run context rebuild".

- [x] **Step 1: Failing tests**

```ts
it("loads a v1 state file and drops derived sections", async () => {
  await writeFile(stateFile, JSON.stringify({ schemaVersion: "boreal.file-store.v1", ...allSections, projections: [someProjection], contextPacks: [somePack] }));
  const store = new FileBorealStore({ rootDir });
  await store.read(async (r) => {
    expect(await r.listProjections()).toEqual([]);
  });
});

it("writes v2 without derived sections", async () => {
  const store = new FileBorealStore({ rootDir });
  await store.write(async (w) => w.putWorkItem(sampleWorkItem()));
  const doc = JSON.parse(await readFile(store.stateFile, "utf8"));
  expect(doc.schemaVersion).toBe("boreal.file-store.v2");
  expect(doc.projections).toBeUndefined();
  expect(doc.contextPacks).toBeUndefined();
});
```

- [x] **Step 2: Implement.** In `documentToSnapshot`, accept `v1` **or** `v2`; for v1, ignore `projections`/`contextPacks`. In `snapshotToDocument`, omit both keys. In `runtime.ts` `getContextPack`, on cache miss call the module-level `refreshWorkContext(writer, work, actor, now)` inside a `store.write` and return the pack (replacing the `BOREAL_NOT_FOUND` throw at `runtime.ts:1041`).

- [x] **Step 3: Full suite; fix tests that asserted the old error. Commit** `perf: stop persisting derived projections/context packs (state v2 with v1 loader)`.

### Task 7: Hash-chained append-only event log

**Files:**
- Create: `packages/storage/src/event-log.ts`
- Modify: `packages/storage/src/file-store.ts` (route `putEvent`/`listEvents`/`putOperation`/`listOperations` to the log; drop `events`/`operations` from the persisted document)
- Modify: `packages/storage/src/index.ts` (export)
- Test: `tests/runtime/event-log.test.ts` (create)

**Interfaces:**
- Produces:

```ts
export interface EventLogEntry {
  readonly seq: number;               // 1-based, strictly increasing
  readonly prevHash: string;          // "sha256:..." of previous entry, "sha256:genesis" for seq 1
  readonly hash: string;              // hashContent({ seq, prevHash, record })
  readonly kind: "event" | "operation";
  readonly record: RuntimeEvent | RuntimeOperation;
}
export class FileEventLog {
  constructor(options: { readonly path: string });   // .boreal/log/events.jsonl
  append(kind: EventLogEntry["kind"], record: RuntimeEvent | RuntimeOperation): Promise<EventLogEntry>;
  readAll(): Promise<readonly EventLogEntry[]>;
  head(): Promise<{ readonly seq: number; readonly hash: string }>; // { seq: 0, hash: "sha256:genesis" } when empty
  verify(): Promise<{ readonly ok: boolean; readonly brokenAtSeq?: number }>;
}
```

- Consumes: `hashContent` from `@boreal/core` (`packages/core/src/hash.ts`).

- [x] **Step 1: Failing tests**

```ts
// tests/runtime/event-log.test.ts
it("appends chained entries with increasing seq", async () => {
  const log = new FileEventLog({ path: join(dir, "events.jsonl") });
  const a = await log.append("event", sampleEvent("e1"));
  const b = await log.append("event", sampleEvent("e2"));
  expect(a.seq).toBe(1);
  expect(b.seq).toBe(2);
  expect(b.prevHash).toBe(a.hash);
  expect((await log.verify()).ok).toBe(true);
});

it("detects a tampered entry", async () => {
  const log = new FileEventLog({ path });
  await log.append("event", sampleEvent("e1"));
  await log.append("event", sampleEvent("e2"));
  const lines = (await readFile(path, "utf8")).trim().split("\n");
  const tampered = JSON.parse(lines[0]); tampered.record.type = "forged";
  await writeFile(path, [JSON.stringify(tampered), lines[1]].join("\n") + "\n");
  const result = await log.verify();
  expect(result.ok).toBe(false);
  expect(result.brokenAtSeq).toBe(1);
});

it("head() is cheap and correct after reopen", async () => {
  const log1 = new FileEventLog({ path });
  await log1.append("event", sampleEvent("e1"));
  const log2 = new FileEventLog({ path });
  expect((await log2.head()).seq).toBe(1);
});
```

- [x] **Step 2: Implement `FileEventLog`.** Append = read last line only (open file, seek from end — or simplest correct version first: read file, take last line), compute `hash = hashContent({ seq, prevHash, record })`, append one JSON line with `appendFile`. Cache the head in the instance after first read so repeated appends in one process don't rescan. `verify()` recomputes each entry's hash and checks `prevHash` linkage.

- [x] **Step 3: Wire into `FileBorealStore`.** Log path: `join(dirname(this.stateFile), "..", "log", "events.jsonl")` — add it to `resolveWorkspacePaths` in `packages/core/src/workspace.ts` as `eventLogFile` instead of hardcoding. Inside `writeOnce`, buffer events/operations put during the transaction and append them to the log **after** the snapshot save succeeds (state first, then log — an orphaned state write without its events is detectable by doctor via seq gap; the reverse would fabricate history). `loadSnapshot` no longer reads events from the document; `listEvents`/`listOperations` seed from `FileEventLog.readAll()`. v2 loader: if a legacy document still contains `events`/`operations` and the log file does not exist, migrate them into the log on first write (one-time backfill: append each in array order).

- [x] **Step 4: Replace `ledgerSeq` derivation.** `runtime.ts:1002` and `runtime.ts:2185` compute `listEvents().length + 1`. Add `headSeq(): Promise<number>` to `BorealReader` (additive — allowed), implemented by memory store as `events.size` and by file store from `FileEventLog.head()`. Use `await reader.headSeq() + 1`.

- [x] **Step 5: Add a `.gitattributes` merge rule.** The repo already has a JSONL merge driver (`tests/runtime/jsonl-merge-driver.test.ts` — find its implementation with `grep -rn "jsonl-merge" tools/ apps/`). Register `*.boreal/log/events.jsonl merge=boreal-jsonl` the same way ledgers do. Note in the doctor: after a git merge of two divergent logs, seq/prevHash must be re-chained — add `FileEventLog.rechain(): Promise<number>` (rewrites seq/prevHash/hash in file order, returns entries rewritten) and surface it as `bwrk doctor --fix`.

- [x] **Step 6: Full suite + benchmark. State file for the bench workspace should drop by the events share. Commit** `feat: hash-chained append-only event log, evicted from state document`.

---

## Phase 3 — Incremental compute

### Task 8: Incremental readiness via reverse adjacency

**Files:**
- Modify: `packages/engine/src/runtime.ts` (`recomputeAllReadiness` call sites at `:781` and `:888`; add `recomputeReadinessFrom`)
- Test: `tests/runtime/incremental-readiness.test.ts` (create)

**Interfaces:**
- Produces:

```ts
async function recomputeReadinessFrom(writer: BorealWriter, changedWorkIds: readonly WorkId[]): Promise<number>
```

Walks the **reverse** dependency graph (blocker → blocked) from the changed items via `listGraphEdges()` (called **once**, indexed into a `Map<WorkId, WorkId[]>`), recomputing `deriveReadinessStatus` breadth-first until no status changes. `recomputeAllReadiness` stays for `recomputeReadiness()` (the explicit repair command) but also builds the edge index once per pass instead of calling `loadDependencies` (→ `listGraphEdges`) per item.

- [x] **Step 1: Failing test**

```ts
it("closing a blocker readies only its transitive dependents", async () => {
  const runtime = createBorealRuntime(); // in-memory
  const a = await runtime.createWork({ title: "a", kind: "task" });
  const b = await runtime.createWork({ title: "b", kind: "task", ready: true });
  const c = await runtime.createWork({ title: "c", kind: "task", ready: true });
  await runtime.addBlockingDependency({ blockedWorkId: b.meta.id, blockingWorkId: a.meta.id });
  await runtime.addBlockingDependency({ blockedWorkId: c.meta.id, blockingWorkId: b.meta.id });
  await runtime.markReady(a.meta.id);
  await runtime.claimWork({ workId: a.meta.id, agentId: "t" });
  await runtime.finishReservedWork({ workId: a.meta.id, agentId: "t", evidence: sampleEvidence(), verification: { verdict: "passed" }, close: { reason: "done" } });
  expect((await runtime.getWorkView(b.meta.id)).status).toBe("ready");
  expect((await runtime.getWorkView(c.meta.id)).status).toBe("blocked"); // b still open
});
```

(This behavior must be identical before and after — write it first against `main` behavior to lock the contract, then swap the implementation.)

- [x] **Step 2: Implement**

```ts
async function recomputeReadinessFrom(writer: BorealWriter, changedWorkIds: readonly WorkId[]): Promise<number> {
  const edges = (await writer.listGraphEdges()).filter(
    (e) => e.kind === "blocks" && e.fromType === "work" && e.toType === "work"
  );
  const blockedBy = new Map<WorkId, WorkId[]>();   // work -> its blockers
  const blocks = new Map<WorkId, WorkId[]>();      // work -> items it blocks
  for (const e of edges) {
    blockedBy.set(e.toId as WorkId, [...(blockedBy.get(e.toId as WorkId) ?? []), e.fromId as WorkId]);
    blocks.set(e.fromId as WorkId, [...(blocks.get(e.fromId as WorkId) ?? []), e.toId as WorkId]);
  }
  let changed = 0;
  const queue = [...new Set(changedWorkIds)];
  const seen = new Set<WorkId>();
  while (queue.length > 0) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const dependentId of blocks.get(id) ?? []) {
      const dependent = await writer.getWorkItem(dependentId);
      if (!dependent) continue;
      const deps = await Promise.all((blockedBy.get(dependentId) ?? []).map((d) => writer.getWorkItem(d)));
      const status = deriveReadinessStatus(
        { ...dependent, dependencyIds: (blockedBy.get(dependentId) ?? []).sort() },
        deps.filter(isWorkItem)
      );
      if (status !== dependent.status) {
        await writer.putWorkItem({ ...dependent, status });
        changed += 1;
        queue.push(dependentId);
      }
    }
  }
  return changed;
}
```

Replace `await recomputeAllReadiness(writer)` at `runtime.ts:781` (closeWork) and `:888` (finishReservedWork) with `await recomputeReadinessFrom(writer, [closed.meta.id])` / `[finalWork.meta.id]`.

- [x] **Step 3: Full suite (the agent-e2e and cli tests cover close cascades) + benchmark with `node tools/bench-mutation.mjs 500`. Commit** `perf: incremental readiness recompute from changed nodes`.

### Task 9: Scope context refresh to affected items

**Files:**
- Modify: `packages/engine/src/runtime.ts` (`closeWork`, `finishReservedWork` — after readiness recompute, refresh context only for the closed item; drop the pre-existing behavior of leaving all other packs stale-but-persisted, which Task 6 already made moot)
- Test: none new (Task 6's rebuild-on-miss covers correctness); verify by benchmark.

- [x] **Step 1: Confirm `refreshWorkContext` is now only called with the mutated work item in `closeWork`/`finishReservedWork`/`recordEvidence`/`verifyWork` (it already is — this step is verification, not change). Ensure `rebuildProjections` (the full rebuild) is reachable only from `sync refresh` / `context rebuild` commands.**

- [x] **Step 2: Run `pnpm test`, benchmark, commit** `perf: context packs rebuilt on demand only`.

---

## Phase 4 — Git-first object store

### Task 10: `ObjectDirBorealStore`

**Files:**
- Create: `packages/storage/src/object-store.ts`
- Modify: `packages/storage/src/index.ts` (export), `packages/core/src/workspace.ts` (`resolveWorkspacePaths` gains `objectsDir`)
- Test: `tests/runtime/object-store.test.ts` (create)

**Interfaces:**
- Produces: `class ObjectDirBorealStore implements BorealStore` with layout:

```
.boreal/objects/work/<id>.json          (one record per file, compact JSON + trailing newline)
.boreal/objects/evidence/<id>.json
.boreal/objects/verifications/<id>.json
.boreal/objects/agent-summaries/<id>.json
.boreal/objects/knowledge-sources/<id>.json
.boreal/objects/claims/<id>.json
.boreal/objects/decisions/<id>.json
.boreal/objects/edges/<id>.json
.boreal/objects/reservations/<id>.json
.boreal/objects/directive-acks/<id>.json
.boreal/objects/reviewer-heartbeats/<id>.json
.boreal/log/events.jsonl                (FileEventLog from Task 7)
```

Constructor: `new ObjectDirBorealStore({ rootDir, lock?: Partial<FileLockOptions> })`. Concurrency: same `withFileLock` + in-process write queue as `FileBorealStore`. `read()` loads all sections into an `InMemoryBorealStore` (freeze-on-load makes this one clone per record, once); `write()` does the same under the lock, runs the op via the overlay transaction, then **persists only the records the overlay touched** (write pending files, delete tombstoned files) — this is the payoff: a close touches ~5 files, not one 11 MB blob. Record ids are already filesystem-safe (`bw_work_<hex>`); still validate with `assertPathInside` before every write.

- [ ] **Step 1: Failing tests**

```ts
// tests/runtime/object-store.test.ts
it("round-trips records as one file per record", async () => {
  const store = new ObjectDirBorealStore({ rootDir });
  await store.write(async (w) => {
    await w.putWorkItem(sampleWorkItem("bw_work_a"));
    await w.putWorkItem(sampleWorkItem("bw_work_b"));
  });
  expect(existsSync(join(rootDir, ".boreal", "objects", "work", "bw_work_a.json"))).toBe(true);
  const reopened = new ObjectDirBorealStore({ rootDir });
  await reopened.read(async (r) => expect((await r.listWorkItems()).length).toBe(2));
});

it("a write touches only mutated record files", async () => {
  const store = new ObjectDirBorealStore({ rootDir });
  await store.write(async (w) => { await w.putWorkItem(sampleWorkItem("bw_work_a")); await w.putWorkItem(sampleWorkItem("bw_work_b")); });
  const aPath = join(rootDir, ".boreal", "objects", "work", "bw_work_a.json");
  const before = statSync(aPath).mtimeMs;
  await store.write(async (w) => w.putWorkItem({ ...sampleWorkItem("bw_work_b"), title: "changed" }));
  expect(statSync(aPath).mtimeMs).toBe(before);
});

it("delete removes the record file", async () => { /* put then deleteWorkItem then existsSync false */ });
it("rejects ids that escape the objects dir", async () => {
  const store = new ObjectDirBorealStore({ rootDir });
  await expect(store.write(async (w) => w.putWorkItem(sampleWorkItem("../../evil")))).rejects.toThrow();
});
```

- [ ] **Step 2: Implement.** Key detail: to persist only touched records, `write()` must see the overlay. Give `InMemoryBorealStore` an internal `writeWithChangeSet(op): Promise<{ result, changes: { section, id, record | null }[] }>` that Task 5's overlay already knows how to produce (pending = upserts, deleted = nulls). `ObjectDirBorealStore.write` = lock → load → `writeWithChangeSet` → for each change, `writeTextFileAtomic(sectionPath(id), JSON.stringify(record) + "\n")` or `rm` → append buffered events to `FileEventLog` → unlock. Loading = `readdir` each section dir, `readJsonFile` each file (bounded `maxBytes: 1MB` per record), validate with the section validators already used by `runtimeSnapshotSchemaIssues` (`packages/core/src/schema-validation.ts`) **per record on write, not the whole snapshot on read** — validating 392 files you didn't touch on every read is the old disease; validate on load only under `doctor --strict`.

- [ ] **Step 3: Run tests. Commit** `feat: per-record object store (ObjectDirBorealStore)`.

### Task 11: Store selection + migration command

**Files:**
- Modify: `apps/cli/src/context.ts` (store factory — find `new FileBorealStore` with `grep -n "FileBorealStore" apps/cli/src/context.ts`)
- Modify: `apps/cli/src/commands.ts` + `apps/cli/src/command-registry.ts` (new command `bwrk storage migrate`)
- Modify: `apps/cli/src/project-setup.ts` (`bwrk init` writes the marker; new workspaces start on objects)
- Test: `tests/runtime/storage-migrate.test.ts` (create)

**Interfaces:**
- Produces: `.boreal/project.json` gains `"storage": "file-v2" | "objects-v1"` (absent = `file-v2`). The CLI context reads it and constructs the matching store. `bwrk storage migrate --to objects --json`: under the state lock, load via `FileBorealStore`, write every record + event through `ObjectDirBorealStore`, verify record counts + event chain, rename `state.json` → `state.json.migrated-<timestamp>`, set the marker. `--to file` does the reverse (escape hatch). New `bwrk init` defaults to `objects-v1`.

- [ ] **Step 1: Failing test**

```ts
it("migrates a file-store workspace to objects and back", async () => {
  // seed via FileBorealStore: 3 work items, 1 edge, 2 events
  const result = await runCli(["storage", "migrate", "--to", "objects", "--json"], ws);
  expect(result.json.migrated).toBe(true);
  expect(result.json.records.workItems).toBe(3);
  expect(existsSync(join(ws, ".boreal", "runtime", "state.json"))).toBe(false);
  const list = await runCli(["work", "list", "--json"], ws);   // CLI now reads objects
  expect(list.json.result.length ?? list.json.length).toBe(3);
});
```

- [ ] **Step 2: Implement migration + factory.** Migration body: `const snapshot = await fileStore.snapshot(); const target = new ObjectDirBorealStore({ rootDir }); await target.write(async (w) => { for each section, for each record, await w.put...(record); });` then events: append each in original order to the log (they carry their own timestamps; the chain hash is new — that's fine, the chain starts at migration). Count-verify before renaming the old file. Update the marker with `writeTextFileAtomic`.

- [ ] **Step 3: Add `.gitignore` guidance in the same commit:** `.boreal/objects/` and `.boreal/log/` are **meant to be committed** (that's the point); `.boreal/cache/`, `.boreal/tmp/`, `.boreal/results/`, `.boreal/runtime/` stay ignored. Update `GENERATED_ARTIFACT_PATHS` in `apps/cli/src/git-worktree.ts:7` so objects/log are treated as collaboration paths, not generated artifacts.

- [ ] **Step 4: Run test + full suite + benchmark against a migrated workspace. Commit** `feat: storage migrate command and objects-first init`.

### Task 12: Optional SQLite read index (feature-detected)

**Files:**
- Create: `packages/storage/src/object-index.ts`
- Modify: `packages/storage/src/object-store.ts` (maintain index on commit; consult on `read()` to skip full directory loads for filtered lists)
- Test: `tests/runtime/object-index.test.ts` (create)

**Interfaces:**
- Produces: `.boreal/cache/index.sqlite` (gitignored), maintained incrementally from the write change-set via `node:sqlite` **when importable**, else a no-op index (`available: false`) and reads fall back to full directory load — which after Phases 1–3 is fast enough below ~5k records. Schema: one table `records(section TEXT, id TEXT PRIMARY KEY, status TEXT, kind TEXT, updated_at TEXT, content_hash TEXT, json TEXT)` + `head(seq INTEGER, hash TEXT)` for staleness (compare against event-log head; on mismatch, rebuild the index from the directories). Delete the old shell-out `sqlite-cache.ts` and its `refreshGeneratedArtifactsInline` usage once this lands.

- [ ] **Step 1: Failing tests** — index rebuilds when stale; `listWorkItems({ status })` served from index matches directory scan; store works identically when `node:sqlite` is unavailable (mock the import via constructor injection: `new ObjectDirBorealStore({ rootDir, sqlite: undefined })`).

- [ ] **Step 2: Implement with dependency injection**

```ts
// object-index.ts
export async function loadNodeSqlite(): Promise<typeof import("node:sqlite") | undefined> {
  try { return await import("node:sqlite"); } catch { return undefined; }
}
```

- [ ] **Step 3: Run tests. Commit** `feat: incremental sqlite read index for object store, retire shell-out cache`.

---

## Phase 5 — Deterministic git branch lifecycle

### Task 13: Branch naming module

**Files:**
- Create: `apps/cli/src/git-branch.ts`
- Test: `tests/runtime/git-branch.test.ts` (create)

**Interfaces:**
- Produces (pure functions, no I/O):

```ts
export function workBranchName(work: Pick<WorkItem, "kind" | "title"> & { readonly meta: { readonly id: string } }): string;
// epic  -> "epic/<shortId>-<slug>"      e.g. epic/5e51e2c5-harden-workflow-refs
// sprint-> "sprint/<shortId>-<slug>"
// task/other -> "work/<shortId>-<slug>"
export function shortWorkId(id: string): string;        // last 8 hex chars of bw_work_<hex>
export function slugify(title: string, maxLen?: number): string; // lowercase, [a-z0-9-], collapse dashes, default maxLen 40
```

- [ ] **Step 1: Failing tests**

```ts
it("mints deterministic branch names", () => {
  expect(workBranchName({ kind: "epic", title: "Harden Workflow Refs!", meta: { id: "bw_work_5e51e2c55b98c622" } }))
    .toBe("epic/5b98c622-harden-workflow-refs");
});
it("slugify strips unsafe chars and caps length", () => {
  expect(slugify("Ünsafe // Name --- here", 10)).toBe("nsafe-name");
});
it("same input always yields same branch", () => { /* call twice, expect equal */ });
```

- [ ] **Step 2: Implement (≈30 lines), run tests, commit** `feat: deterministic work branch naming`.

### Task 14: Claim records and enforces the branch

**Files:**
- Modify: `packages/core/src/records.ts` (extend `AgentReservation` with optional `readonly git?: { readonly branch: string; readonly baseSha: string }`)
- Modify: `packages/core/src/schema-validation.ts` (accept the new optional field)
- Modify: `apps/cli/src/commands.ts` (the `agent start` / `work claim` command handlers: after a successful runtime claim, ensure the branch)
- Test: `tests/runtime/git-branch-lifecycle.test.ts` (create; use a real temp git repo — `git init` in the test workspace, the CLI harness already runs in temp dirs)

**Interfaces:**
- Consumes: `workBranchName` (Task 13); `runGit` pattern from `apps/cli/src/git-worktree.ts:301` (extract `runGit` to a shared `apps/cli/src/git-exec.ts` and re-export — do this as the first step of this task).
- Produces: on claim, when the workspace is a git repo and not detached: compute `branch = workBranchName(work)`; if HEAD is already on it, record it; else `git switch -c <branch>` (or `git switch <branch>` if it exists); record `{ branch, baseSha: rev-parse HEAD }` on the reservation via a new runtime method `attachReservationGit(reservationId, git)` (a thin `store.write` that re-puts the reservation — additive to `BorealRuntime`). Behavior is **opt-out** via `--no-branch` flag and skipped with an `info` note when git is unavailable (keep non-git workspaces working).

- [ ] **Step 1: Failing test**

```ts
it("claim creates and records the work branch", async () => {
  const ws = await createTestWorkspace({ git: true });        // git init + initial commit
  await runCli(["init"], ws);
  const created = await runCli(["work", "create", "--title", "Fix parser", "--kind", "task", "--ready", "--json"], ws);
  const workId = created.json.result.meta.id;
  await runCli(["agent", "start", workId, "--agent", "a1", "--json"], ws);
  const branch = execSync("git symbolic-ref --short HEAD", { cwd: ws, encoding: "utf8" }).trim();
  expect(branch).toBe(`work/${workId.slice(-8)}-fix-parser`);
  const show = await runCli(["work", "show", workId, "--json"], ws);
  expect(show.json.result.reservation.git.branch).toBe(branch);
});

it("claim with --no-branch skips git entirely", async () => { /* HEAD unchanged, reservation.git undefined */ });
it("claim in a non-git directory succeeds with a finding, not an error", async () => { /* ... */ });
```

- [ ] **Step 2: Implement** (extract `git-exec.ts`; extend record + validator; wire the command handler; surface the branch in `work show` output).

- [ ] **Step 3: Run tests + suite, commit** `feat: claim mints/records deterministic work branch on reservation`.

### Task 15: Finish gate verifies branch + checkpoint

**Files:**
- Modify: `apps/cli/src/commands.ts` (`agent finish` handler: pre-flight git check before calling `runtime.finishReservedWork`)
- Modify: `packages/core/src/records.ts` (`WorkItem` gains optional `readonly git?: { readonly branch: string; readonly headSha: string }` stamped at close)
- Modify: `packages/core/src/enforcement-gaps.ts` (new gap code `"git.branch-mismatch"`)
- Test: extend `tests/runtime/git-branch-lifecycle.test.ts`

**Interfaces:**
- Produces: `agent finish` fails with `BOREAL_POLICY_VIOLATION` + gap `git.branch-mismatch` when the reservation has `git.branch` and HEAD is on a different branch; fails with the existing checkpoint-gap machinery when tracked files are dirty (reuse `CHECKPOINT_DIRTY_PATH_REASON_CODES` — a `--checkpoint-reason <code>` flag maps to those codes for legitimate skips). On success, stamps `{ branch, headSha }` on the closed work item. The error's `details.repairCommand` must be the exact `git switch <branch>` to run — agents follow `nextCommand`s.

- [ ] **Step 1: Failing tests**

```ts
it("refuses to finish from the wrong branch with a repair command", async () => {
  /* claim (records branch), then git switch -c somewhere-else, then finish */
  const result = await runCli(["agent", "finish", workId, ...finishFlags, "--json"], ws, { expectFailure: true });
  expect(result.json.code).toBe("BOREAL_POLICY_VIOLATION");
  expect(result.json.gaps[0].code).toBe("git.branch-mismatch");
  expect(result.json.details.repairCommand).toContain("git switch work/");
});

it("stamps branch and head sha on the closed work item", async () => {
  /* claim, commit a change on the branch, finish; work show -> git.headSha matches rev-parse */
});
```

- [ ] **Step 2: Implement, run, commit** `feat: finish gate enforces recorded branch and stamps head sha`.

### Task 16: Sprint launch branches off the epic branch

**Files:**
- Modify: the `sprint launch` handler in `apps/cli/src/commands.ts` (find with `grep -n '"sprint"' apps/cli/src/commands.ts`)
- Modify: `skills/boreal-sprint-launch/SKILL.md` + `workflows/40-work/launch-sprint.md` (document that branching is now automatic; delete the manual git instructions)
- Test: extend `tests/runtime/git-branch-lifecycle.test.ts`

**Interfaces:**
- Produces: `sprint launch` for a sprint whose container epic has a recorded/derivable branch: create `sprint/<shortId>-<slug>` **from the epic branch** (`git switch -c <sprint> <epicBranch>`), record it on the sprint work item. Same `--no-branch` opt-out and non-git degradation as Task 14.

- [ ] **Step 1: Failing test** — epic create → sprint launch → `git branch --contains <epic-branch-tip>` includes the sprint branch; sprint work item shows `git.branch`.

- [ ] **Step 2: Implement, update the two markdown docs, run, commit** `feat: sprint launch branches deterministically off epic branch`.

---

## Phase 6 — Code shape

### Task 17: Declare error domains at throw sites

**Files:**
- Modify: `packages/core/src/errors.ts` (`BorealError` constructor accepts optional `domain`), `packages/core/src/error-recovery.ts` (`notFoundDomain` checks `details.domain` first — `explicitRecordDomain` already does; the change is making throw sites use it)
- Modify: throw sites in `packages/engine/src/runtime.ts` and `apps/cli/src/*.ts` — find them: `grep -rn 'BOREAL_NOT_FOUND' packages apps/cli/src | grep -v test`
- Test: extend existing `tests/runtime/core.test.ts`

- [ ] **Step 1: Failing test** — `classifyBorealError("BOREAL_NOT_FOUND", { domain: "evidence" })` returns the evidence recovery summary even when no `evidenceId` field is present.
- [ ] **Step 2: Add `domain: "work" | "evidence" | "summary" | "workflow" | "lock"` to the `details` object at each `BOREAL_NOT_FOUND` / `BOREAL_POLICY_VIOLATION` throw site (mechanical; ~25 sites). Keep the sniffing heuristics as fallback for old spooled results; add a comment marking them deprecated.**
- [ ] **Step 3: Run suite, commit** `refactor: declare error domain at throw sites`.

### Task 18: Split `commands.ts` by command group

**Files:**
- Create: `apps/cli/src/commands/` — `work.ts`, `agent.ts`, `sprint.ts`, `evidence.ts`, `knowledge.ts`, `sync.ts`, `storage.ts`, `vault.ts`, `memory.ts`, `shared.ts` (formatters/context helpers used across groups)
- Modify: `apps/cli/src/commands.ts` shrinks to the dispatcher: `runCommand` + imports
- Test: no new tests — this is a **pure move refactor**; the existing `cli.test.ts`, `console-cli-contracts.test.ts`, and `cli-dist.test.ts` are the safety net

Procedure (repeat per group, one commit each — do NOT do this in one commit):

- [ ] **Step 1:** `grep -n 'case "work"' apps/cli/src/commands.ts` to find the group's dispatch block and its helper functions (helpers are the functions only that block calls — verify with grep before moving).
- [ ] **Step 2:** Move the block + private helpers verbatim into `apps/cli/src/commands/<group>.ts`, exporting one entry `export async function <group>Command(action, args, context, output, json): Promise<CommandResult>`. No logic edits — resist every temptation; behavior changes belong in their own commits.
- [ ] **Step 3:** `pnpm check && pnpm test` after each group. Commit `refactor: extract <group> commands`.

Order groups smallest-first (vault, storage, sync, …) to debug the pattern cheaply before tackling `work`/`agent`.

### Task 19: Directive machinery audit (decision task, not deletion task)

**Files:**
- Create: `docs/decisions/directive-machinery-scope.md`

- [ ] **Step 1:** Instrument nothing; instead measure statically: for each directive kind in `packages/core/src/agent-directive-registry.ts`, grep the skills/ and workflows/ trees for references. List directives that (a) duplicate a hard gate that already blocks the command, or (b) are referenced by no skill/workflow.
- [ ] **Step 2:** Write the decision doc: keep hard gates (closeout gates, reservation checks, the new git gates), propose the deletion list for advisory directives, with line-count savings. **Do not delete anything in this plan** — that's a follow-up plan the user approves from the decision doc.
- [ ] **Step 3:** Commit `docs: directive machinery scope decision`.

### Task 20: Final verification

- [ ] **Step 1:** `pnpm check && pnpm test` — all green.
- [ ] **Step 2:** `node tools/bench-mutation.mjs 500` on an objects-migrated workspace; record final numbers vs. Task 1 baseline in the PR description.
- [ ] **Step 3:** Migrate the dogfood workspace itself: `bwrk storage migrate --to objects --json` in this repo, run `bwrk doctor --strict --json`, and confirm `git status` shows small per-record diffs instead of an 11 MB `state.json`.
- [ ] **Step 4:** Use superpowers:finishing-a-development-branch to merge/PR.

---

## Self-review notes

- **Spec coverage:** audit items 1–4 → Tasks 2–9; item 5 (storage identity, git-first chosen) → Tasks 10–12; item 6 (branch lifecycle) → Tasks 13–16; item 7 (code shape) → Tasks 17–19. Migration-path gap from §2 → Task 6/11 versioned loaders. Lock TOCTOU from §2 is deliberately **not** in scope: it's a small race with benign worst case, and Phase 1–3 shrink the critical section that makes it observable; file as an issue.
- **Type consistency:** `recomputeReadinessFrom(writer, WorkId[])` (Task 8) matches call sites in Task 8 step 2; `EventLogEntry`/`FileEventLog` names used in Tasks 7, 10, 11; `workBranchName`/`shortWorkId`/`slugify` used in Tasks 13–16; reservation field is `git.branch`/`git.baseSha` in Tasks 14–15 consistently.
- **Known unknowns for the executor:** exact CLI flag names for `agent finish` (check `docs/cli/COMMANDS.md`), the CLI test harness helper names in `tests/runtime/cli.test.ts`, and the store factory location in `apps/cli/src/context.ts` — each task says how to find them with grep rather than guessing.
