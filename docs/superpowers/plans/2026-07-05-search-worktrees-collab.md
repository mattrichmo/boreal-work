# Search Engine, Worktrees & Collaboration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make search cheap and incremental (FTS5), retire the duplicate cache, add event-log rotation, and ship the four missing collaboration features: worktree-per-agent, merge-driver wiring, sprint status, and reservation renewal automation — plus a cross-project status view.

**Architecture:** Seven phases, each independently shippable. Phase 1 fixes search: staleness by corpus hash (no rebuild-to-check), drops derived context-pack documents from the corpus, moves the index into the existing `.boreal/cache/index.sqlite` as an FTS5 table (feature-detected `node:sqlite`, in-memory fallback), and deletes the legacy shell-out `runtime-cache.sqlite`. Phase 2 adds hash-chain-preserving event-log rotation. Phases 3–7 are the feature gaps, smallest-risk-first ordering within each.

**Tech Stack:** TypeScript 5.7, Node >= 22, pnpm workspaces, vitest. No new dependencies; `node:sqlite` only behind the existing `loadNodeSqlite()` feature detection in `packages/storage/src/object-index.ts:60`.

## Global Constraints

- `"type": "module"`; source imports use `.js` extensions (existing convention).
- Node engines floor stays `>=22.0.0`; `node:sqlite` users must degrade gracefully when `loadNodeSqlite()` returns `undefined`.
- `BorealStore`/`BorealReader`/`BorealWriter` in `packages/storage/src/ports.ts`: additive changes only.
- Persisted format changes get a schema version bump + loader that accepts the previous version.
- All file writes via `writeTextFileAtomic` (`packages/storage/src/atomic-write.ts`).
- `pnpm check` and `pnpm test` green after every task; commit per task (`perf:`/`feat:`/`refactor:` prefixes).
- Commands now live in `apps/cli/src/commands/<group>.ts` (post-split); `apps/cli/src/commands.ts` is the dispatcher. Never add code back to the dispatcher.
- Work directly on `main` (agent sandboxes deny branch creation); verify `git status` is clean before starting, STOP if dirty.

## Established interfaces you will consume (verified present)

- `FileEventLog` (`packages/storage/src/event-log.ts:20`): `append(kind, record)`, `readAll()`, `head(): Promise<{seq, hash}>`, `verify(): Promise<{ok, brokenAtSeq?}>`, `rechain(): Promise<number>`.
- `loadNodeSqlite(): Promise<NodeSqliteModule | undefined>` and `objectIndexPath(rootDir)` (`packages/storage/src/object-index.ts`).
- `AgentReservation.git?: { branch, baseSha }` (`packages/core/src/records.ts:137`); `WorkItem.git?` at `:319`.
- `readSearchSnapshot(context)` (`apps/cli/src/search-cli.ts:259`), `searchIndexContentHash(snapshot)` (`packages/search/src/search-index.ts:192`).
- `workBranchName/shortWorkId/slugify` (`apps/cli/src/git-branch.ts`), `runGit` (`apps/cli/src/git-exec.ts`).
- Reverse-adjacency readiness helpers in `packages/engine/src/runtime.ts` (`recomputeReadinessFrom`, `graphDependencyIds`).
- Project registry: `packages/core/src/project-registry.ts` + `schemas/projects/project-registry.schema.json`.

---

## Phase 1 — Search & cache

### Task 1: Staleness by corpus hash (kill the rebuild-to-check)

**Files:**
- Modify: `packages/search/src/search-index.ts` (add `searchCorpusFingerprint`), `packages/search/src/index.ts` (export)
- Modify: `apps/cli/src/search-cli.ts` (`inspectSearchIndex` at `:67-` and `writeSearchIndexUnlocked` at `:230` use the fingerprint; the index document stores it)
- Test: `tests/runtime/search-staleness.test.ts` (create)

**Interfaces:**
- Produces: `searchCorpusFingerprint(snapshot: SearchCorpusSnapshot): ContentHash` — hashes only `[record.meta.id, record.meta.contentHash]` pairs per section (packs use `[pack.id, pack.contentHash ?? pack.id]`), via existing `hashContent`. O(records), no tokenization. `SearchIndexDocument` gains optional `corpusFingerprint?: ContentHash`; an index without it is treated as stale (forces one rebuild, no version break).

- [ ] **Step 1: Write the failing test**

```ts
// tests/runtime/search-staleness.test.ts
import { describe, expect, it } from "vitest";
import { buildSearchIndex, searchCorpusFingerprint } from "@boreal/search";

describe("search corpus fingerprint", () => {
  it("is stable for identical corpora and cheap to compute", () => {
    const snapshot = sampleCorpus(); // build from test fixtures: 2 work items, 1 evidence
    expect(searchCorpusFingerprint(snapshot)).toBe(searchCorpusFingerprint(sampleCorpus()));
  });
  it("changes when any record contentHash changes", () => {
    const a = sampleCorpus();
    const b = { ...a, workItems: [{ ...a.workItems[0], meta: { ...a.workItems[0].meta, contentHash: "sha256:different" } }, ...a.workItems.slice(1)] };
    expect(searchCorpusFingerprint(a)).not.toBe(searchCorpusFingerprint(b));
  });
  it("is embedded in built indexes", () => {
    const snapshot = sampleCorpus();
    expect(buildSearchIndex(snapshot).corpusFingerprint).toBe(searchCorpusFingerprint(snapshot));
  });
});
```

- [ ] **Step 2: Verify it fails** (`pnpm vitest run tests/runtime/search-staleness.test.ts` — function not exported).

- [ ] **Step 3: Implement**

```ts
// in packages/search/src/search-index.ts
export function searchCorpusFingerprint(snapshot: SearchCorpusSnapshot): ContentHash {
  return hashContent({
    schemaVersion: SEARCH_INDEX_SCHEMA_VERSION,
    workItems: snapshot.workItems.map(metaPair),
    agentSummaries: (snapshot.agentSummaries ?? []).map(metaPair),
    evidence: snapshot.evidence.map(metaPair),
    knowledgeSources: snapshot.knowledgeSources.map(metaPair),
    claims: snapshot.claims.map(metaPair),
    decisions: snapshot.decisions.map(metaPair)
  });
}
function metaPair(record: { readonly meta: { readonly id: string; readonly contentHash?: string } }): readonly [string, string] {
  return [record.meta.id, record.meta.contentHash ?? ""];
}
```

(Deliberately excludes `contextPacks` — Task 2 removes them from the corpus; excluding them here avoids a second fingerprint change.) Add `corpusFingerprint: searchCorpusFingerprint(snapshot)` to the object returned by `buildSearchIndex`, and to the `SearchIndexDocument` interface as optional. In `apps/cli/src/search-cli.ts`, `inspectSearchIndex` compares the stored `corpusFingerprint` against `searchCorpusFingerprint(await readSearchSnapshot(context))` and only falls back to the old `searchIndexContentHash` path when the stored fingerprint is absent. Keep `searchIndexContentHash` itself for the fallback; do not call it on the fresh path.

- [ ] **Step 4: Run test + full suite.**

- [ ] **Step 5: Measure and commit**

Run: `time pnpm --silent bwrk sync status --json >/dev/null` — expect ~3.6s → well under 1s.

```bash
git add -A && git commit -m "perf: search staleness by corpus fingerprint, not index rebuild (<seconds>s sync status)"
```

### Task 2: Drop context packs/chunks from the search corpus

**Files:**
- Modify: `packages/search/src/search-index.ts:263` (`buildSearchEntries` — remove `contextPacks.flatMap(contextPackEntries)`; delete `contextPackEntry`, `contextPackEntries`, `contextChunkEntries`, `trimContextChunk`, and the `context_pack`/`context_chunk` members of `SearchDocumentType`, `TYPE_ORDER`, `isSearchDocumentType`)
- Modify: `apps/cli/src/search-cli.ts` (`readSearchSnapshot` stops loading `contextPacks`; `SearchCorpusSnapshot` in `search-index.ts` drops the field)
- Test: extend `tests/runtime/search-staleness.test.ts`; fix any search tests referencing the removed types (`grep -rn "context_chunk\|context_pack" tests/`)

- [ ] **Step 1: Failing test** — build an index from a corpus and assert `index.documents.every(d => d.type !== "context_pack" && d.type !== "context_chunk")` fails to compile / the types no longer exist; simpler runtime form:

```ts
it("indexes only primary records", () => {
  const index = buildSearchIndex(sampleCorpus());
  const types = new Set(index.documents.map((d) => d.type));
  expect([...types].sort()).toEqual(["evidence", "work"]); // per sampleCorpus contents
});
```

- [ ] **Step 2: Implement the removals.** If any CLI search command exposes `--type context_pack` (check `grep -rn "context_pack" apps/cli/src/`), remove the option and mention `work`/`evidence` types in its help text instead. Records remain reachable: packs carry `subjectId`, and searching the subject work item is the supported path.

- [ ] **Step 3: Run suite; rebuild dogfood index (`pnpm --silent bwrk sync refresh --json`) and record the new `search-index.json` size (expect ~45 MB → ~10 MB). Commit** `perf: stop double-indexing derived context packs (<size>)`.

### Task 3: FTS5 search in index.sqlite

**Files:**
- Create: `packages/storage/src/search-fts.ts`
- Modify: `packages/storage/src/object-index.ts` (feed FTS table from the same mutation change-set), `packages/storage/src/index.ts` (exports)
- Modify: `apps/cli/src/search-cli.ts` (query path prefers FTS; JSON index file no longer written when FTS is active)
- Test: `tests/runtime/search-fts.test.ts` (create)

**Interfaces:**
- Consumes: `loadNodeSqlite()`, `objectIndexPath(rootDir)`, the tokenizer helpers `tokenize`/`expandTokenBoundaries` (export them from `packages/search/src/search-index.ts` — they stay the shared text normalizer).
- Produces:

```ts
export interface FtsSearchOptions { readonly limit?: number; readonly types?: readonly string[]; }
export interface FtsSearchResult {
  readonly recordId: string; readonly type: string; readonly title: string;
  readonly summary: string; readonly score: number; readonly snippet?: string;
}
export class FtsSearchIndex {
  static async open(rootDir: string): Promise<FtsSearchIndex | undefined>; // undefined when node:sqlite or FTS5 unavailable
  upsert(entries: readonly FtsDocumentInput[]): void;   // FtsDocumentInput = { recordId, type, title, summary, idText, labelText, bodyText, stateText }
  remove(recordIds: readonly string[]): void;
  query(text: string, options?: FtsSearchOptions): readonly FtsSearchResult[];
  count(): number;
}
```

Schema inside the existing `index.sqlite`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(
  record_id UNINDEXED, type UNINDEXED, title, summary, id_text, label_text, body_text, state_text,
  tokenize = 'unicode61 remove_diacritics 2'
);
-- ranking: bm25(search_fts, 0, 0, 8.0, 5.0, 10.0, 6.0, 3.0, 4.0)  (title, summary, id, labels, body, state)
```

Feature detection: `FtsSearchIndex.open` returns `undefined` if `loadNodeSqlite()` is undefined **or** `CREATE VIRTUAL TABLE` throws (FTS5 compiled out). Callers fall back to the existing JSON index path unchanged.

- [ ] **Step 1: Failing tests**

```ts
// tests/runtime/search-fts.test.ts
it("indexes and ranks by BM25 with field weights", async () => {
  const fts = await FtsSearchIndex.open(rootDir);
  if (!fts) return; // environment without sqlite: covered by fallback test below
  fts.upsert([
    doc("bw_work_a", "work", "parser crash on empty input", "..."),
    doc("bw_work_b", "work", "docs update", "mentions parser once in body")
  ]);
  const results = fts.query("parser crash");
  expect(results[0].recordId).toBe("bw_work_a");
});
it("prefix queries match", async () => { /* query "pars*" or auto-append * to last token; expect bw_work_a */ });
it("upsert replaces prior doc for the same recordId", async () => { /* upsert twice, count() stays 1 */ });
it("falls back to JSON index when sqlite is unavailable", async () => {
  // search CLI path: force fallback by passing sqlite: undefined via test seam, assert results still returned
});
```

- [ ] **Step 2: Implement `search-fts.ts`** (~150 lines). Query builds an FTS5 MATCH string: sanitize input (strip FTS5 operators `"':*()-`), quote each token, append `*` to the final token for prefix behavior, `ORDER BY bm25(search_fts, ...)`. `snippet(search_fts, 6, '[', ']', '…', 12)` for the snippet column.

- [ ] **Step 3: Wire population.** In `object-index.ts`, the mutation path already receives the change-set per write (built in the previous plan's Task 12); for each changed record build an `FtsDocumentInput` using the same field extraction as `workEntry`/`evidenceEntry`/etc. — move those field-extraction functions (`search-index.ts:267-353`) into a new shared module `packages/search/src/fields.ts` exporting `searchFieldsForRecord(type, record): FtsDocumentInput` and have BOTH the JSON index builder and FTS consume it (single source of truth for what's searchable). Full rebuild path (`sync refresh`): clear + re-upsert all records.

- [ ] **Step 4: Query path.** In `search-cli.ts`, the search command tries `FtsSearchIndex.open` first; on hit, map `FtsSearchResult` into the existing CLI result shape (keep `--explain` on the JSON fallback only — document that in the command help). When FTS is active, `writeSearchIndexUnlocked` becomes a no-op that deletes a leftover `search-index.json` if present, and `inspectSearchIndex` reports `{ mode: "fts", stale: false, documentCount: fts.count() }` — freshness is transactional now.

- [ ] **Step 5: Run suite; on the dogfood workspace run `pnpm --silent bwrk search "workflow ref" --json | head` and confirm sub-second results and no `search-index.json` regeneration. Commit** `feat: FTS5 search index inside index.sqlite with JSON fallback`.

### Task 4: Retire the legacy shell-out SQLite cache

**Files:**
- Modify: `apps/cli/src/commands/sync.ts:140` (drop `rebuildSQLiteCache` from refresh; drop its result field), `apps/cli/src/commands/health.ts` / `apps/cli/src/doctor.ts` (remove `cache.sqlite` freshness checks; keep a one-time cleanup that deletes `.boreal/cache/runtime-cache.sqlite`)
- Delete: `packages/storage/src/sqlite-cache.ts` and its export in `packages/storage/src/index.ts`
- Test: `grep -rn "rebuildSQLiteCache\|runtime-cache" tests/ apps/ packages/` — update the callers list first, then delete

- [ ] **Step 1:** Enumerate consumers with the grep above (known: `commands/sync.ts`, doctor freshness code near old `commands.ts:2732` logic, import-export). For each, remove the sqlite-cache branch; where a JSON payload shape included `sqliteCache`, keep the key but emit `{ retired: true }` for one release so `--json` consumers don't break on missing keys.
- [ ] **Step 2:** Add to `doctor --fix`: if `.boreal/cache/runtime-cache.sqlite` exists, delete it and report `cache.sqlite.retired`.
- [ ] **Step 3:** `pnpm check && pnpm test`; run `pnpm --silent bwrk sync refresh --json` and `bwrk doctor --strict --json` on the dogfood workspace. Commit `refactor: retire legacy shell-out sqlite cache (index.sqlite is the only cache)`.

---

## Phase 2 — Event-log rotation

### Task 5: Chain-preserving log rotation

**Files:**
- Modify: `packages/storage/src/event-log.ts` (add `rotate` + archive-aware `verify`/`readAll`)
- Modify: `apps/cli/src/commands/storage.ts` (new `bwrk storage rotate-log [--max-bytes N]`), doctor suggests rotation past a threshold
- Test: extend `tests/runtime/event-log.test.ts`

**Interfaces:**
- Produces:

```ts
async rotate(): Promise<{ readonly archivedPath: string; readonly archivedEntries: number }>;
// events.jsonl -> events-<NNNN>.jsonl.archived (NNNN = zero-padded rotation number);
// fresh events.jsonl begins with a genesis entry:
//   { seq: <lastSeq + 1>, prevHash: <archived head hash>, hash: ..., kind: "event",
//     record: <RuntimeEvent type "log.rotated", payload { archivedPath, archivedHead }> }
async verifyDeep(): Promise<{ readonly ok: boolean; readonly brokenAtSeq?: number; readonly archives: number }>;
// walks archives oldest-first then the live log; checks each file's internal chain AND the cross-file link
```

`seq` continues across rotations (no reset) so `headSeq()` and `ledgerSeq` stay monotonic. `readAll()` reads the live file only (hot path unchanged); a new `readAllIncludingArchives()` exists for export/audit.

- [ ] **Step 1: Failing tests**

```ts
it("rotation preserves the verifiable chain across files", async () => {
  const log = new FileEventLog({ path });
  for (let i = 0; i < 5; i += 1) await log.append("event", sampleEvent(`e${i}`));
  const { archivedEntries } = await log.rotate();
  expect(archivedEntries).toBe(5);
  await log.append("event", sampleEvent("post"));
  expect((await log.head()).seq).toBe(7); // 5 archived + genesis + 1 new
  expect((await log.verifyDeep()).ok).toBe(true);
});
it("verifyDeep detects a tampered archive", async () => { /* rotate, corrupt archived line 2, expect ok:false */ });
it("rotation genesis links the archived head hash", async () => { /* parse first line of new log, prevHash === archived last hash */ });
```

- [ ] **Step 2: Implement.** Archive naming: scan dir for `events-*.jsonl.archived`, next number = max + 1. Rotation runs under the store's write lock (expose it via the store or take the same `withFileLock` on the log's own `<path>.lock`). The `log.rotated` runtime event uses `createRecordMeta`/`randomId` from `@boreal/core` like other events.

- [ ] **Step 3: CLI + doctor.** `bwrk storage rotate-log` calls it and prints the result; doctor emits an `info` finding `log.rotation-suggested` when `events.jsonl` exceeds 10 MB (`--max-bytes` overrides). Archived files: add `.boreal/log/*.archived` to `.gitattributes` with the same `merge=boreal-jsonl` rule; they stay committed (they're history).

- [ ] **Step 4: Suite + commit** `feat: chain-preserving event log rotation`.

---

## Phase 3 — Worktree-per-agent

### Task 6: `--worktree` on claim

**Files:**
- Modify: `apps/cli/src/commands/agent.ts` (claim path: after branch resolution, optionally create the worktree), `apps/cli/src/git-branch.ts` (add `workWorktreePath`)
- Modify: `packages/core/src/records.ts` (reservation `git` object gains optional `readonly worktreePath?: string`), `packages/core/src/schema-validation.ts` (accept it)
- Test: `tests/runtime/git-worktree-lifecycle.test.ts` (create; real `git init` temp repos, as in `tests/runtime/git-branch-lifecycle.test.ts` — copy its harness setup)

**Interfaces:**
- Produces: `workWorktreePath(repoRoot: string, branch: string): string` → sibling dir `join(dirname(repoRoot), `${basename(repoRoot)}--${branch.replaceAll("/", "-")}`)`. Claim with `--worktree`: `git worktree add <path> <branch>` (creating the branch there instead of switching HEAD in the main checkout — the main checkout's HEAD is **not** touched), reservation records `git: { branch, baseSha, worktreePath }`. `agent finish` (Task 7) and `work show` surface it. `--no-branch` still bypasses everything.

- [ ] **Step 1: Failing tests**

```ts
it("claim --worktree creates a sibling worktree and leaves main HEAD alone", async () => {
  const { ws, headBefore } = await gitWorkspace();
  const workId = await createReadyWork(ws, "Fix parser");
  await runCli(["agent", "start", workId, "--agent", "a1", "--worktree", "--json"], ws);
  const expected = workWorktreePath(ws, `work/${workId.slice(-8)}-fix-parser`);
  expect(existsSync(join(expected, ".git"))).toBe(true);
  expect(execSync("git symbolic-ref --short HEAD", { cwd: ws, encoding: "utf8" }).trim()).toBe(headBefore); // untouched
  const show = await runCli(["work", "show", workId, "--json"], ws);
  expect(show.json.data.reservation.git.worktreePath).toBe(expected);
});
it("two agents can claim two items concurrently without HEAD contention", async () => {
  /* claim A --worktree, claim B --worktree; both worktrees exist; git worktree list shows 3 entries */
});
it("re-claim of the same work reuses the existing worktree", async () => { /* second start doesn't error on existing dir */ });
```

- [ ] **Step 2: Implement.** Use `runGit(repoRoot, ["worktree", "add", path, "-b", branch])`; if branch exists, omit `-b`; if the worktree path already exists AND `git -C <path> rev-parse --abbrev-ref HEAD` equals the branch, reuse it; otherwise error `BOREAL_CONFLICT` with the path in details. Record on reservation before writing the claim event.

- [ ] **Step 3: Suite + commit** `feat: claim --worktree isolates each agent in its own checkout`.

### Task 7: Finish gate honors the worktree

**Files:**
- Modify: `apps/cli/src/commands/agent.ts` (finish pre-flight: when reservation has `worktreePath`, run the branch/checkpoint verification against that path, not `cwd`), and the post-close cleanup: `--remove-worktree` flag runs `git worktree remove <path>` after successful close (refuses if dirty)
- Test: extend `tests/runtime/git-worktree-lifecycle.test.ts`

- [ ] **Step 1: Failing tests**

```ts
it("finish verifies the recorded worktree, not the invoking cwd", async () => {
  /* claim --worktree; commit a change inside the worktree; run agent finish FROM the main
     checkout (cwd = ws); expect success and work.git.headSha === rev-parse in the worktree */
});
it("finish --remove-worktree prunes the worktree after close", async () => {
  /* after successful finish, expect worktree dir gone and `git worktree list` back to 1 */
});
it("finish refuses when the worktree has uncommitted tracked changes", async () => {
  /* dirty worktree -> BOREAL_POLICY_VIOLATION with existing checkpoint gap code, details.worktreePath set */
});
```

- [ ] **Step 2: Implement** — the existing branch-verification helper takes a rootDir; pass `reservation.git.worktreePath ?? context.workspaceRoot`. `--remove-worktree` only after close succeeds; failure to remove is a warning, not an error.
- [ ] **Step 3: Suite + commit** `feat: finish gate verifies and optionally removes the agent worktree`.

---

## Phase 4 — Merge-driver wiring

### Task 8: Install and police the JSONL merge driver

**Files:**
- First: locate the driver implementation: `grep -rn "boreal-jsonl" tools/ apps/ packages/ tests/ --include="*.ts" --include="*.mjs" -l` (a merge driver script exists — `tests/runtime/jsonl-merge-driver.test.ts` tests it). Note its invocation path.
- Modify: `apps/cli/src/project-setup.ts` (`bwrk init` sets the git config), `apps/cli/src/doctor.ts` (detect missing config + detect merged-but-unrechained log)
- Test: `tests/runtime/merge-driver-wiring.test.ts` (create)

**Interfaces:**
- Produces: `bwrk init` (and `doctor --fix`) runs `git config merge.boreal-jsonl.driver "<node invocation of the driver script> %O %A %B"` in the repo (local config, not global). Doctor findings: `git.merge-driver-missing` (warning, fix installs it) and `log.rechain-needed` (error) when `FileEventLog.verify()` reports a break AND the file's entries are individually valid (the union-merge signature: two interleaved chains) — repair action `bwrk doctor --fix` calls `rechain()`.

- [ ] **Step 1: Failing tests**

```ts
it("init installs the merge driver config", async () => {
  const ws = await gitWorkspace();
  await runCli(["init"], ws);
  const driver = execSync("git config merge.boreal-jsonl.driver", { cwd: ws, encoding: "utf8" }).trim();
  expect(driver).toContain("%O %A %B");
});
it("doctor detects and fixes a missing merge driver", async () => { /* unset config, doctor --json -> finding; doctor --fix -> config present */ });
it("doctor detects an unrechained merged log and fix rechains it", async () => {
  /* build two logs with common prefix + divergent suffixes, concatenate (simulating union merge),
     doctor --json -> log.rechain-needed; doctor --fix -> verify().ok === true */
});
```

- [ ] **Step 2: Implement.** The rechain-detection heuristic: `verify()` fails at seq N, but every line parses and every entry's OWN hash matches its content — only linkage is broken. That distinguishes merge-interleave (repairable) from corruption (not repairable — keep that as `log.corrupt`, error, no auto-fix).
- [ ] **Step 3: Suite + commit** `feat: init installs jsonl merge driver; doctor repairs merged event logs`.

---

## Phase 5 — Sprint status

### Task 9: `bwrk sprint status`

**Files:**
- Modify: `apps/cli/src/commands/sprint.ts` (new action), `apps/cli/src/command-registry.ts` (register `sprint status`), `docs/cli/COMMANDS.md`
- Test: `tests/runtime/sprint-status.test.ts` (create)

**Interfaces:**
- Consumes: `workDependencyScopeIds`-style scoping — the sprint's member items are those reachable via `graphDependencyIds` from the sprint container plus items whose `containerId`/parent link the codebase uses for sprint membership (verify with `grep -n "containerId" packages/engine/src/runtime.ts apps/cli/src/commands/sprint.ts` and reuse whatever `sprint close` uses to enumerate members — do not invent a second membership definition).
- Produces JSON:

```ts
interface SprintStatusResult {
  readonly sprintId: string; readonly title: string; readonly status: string;
  readonly counts: { readonly total: number; readonly closed: number; readonly verified: number;
                     readonly ready: number; readonly blocked: number; readonly inProgress: number };
  readonly reservations: readonly { workId: string; title: string; agentId: string;
                                    expiresAt?: string; branch?: string }[];
  readonly topBlockers: readonly { workId: string; title: string; blocksCount: number }[]; // transitive dependents, desc, top 5
  readonly staleClaims: readonly { workId: string; agentId: string; expiresAt: string }[]; // expired but unreaped
}
```

Human output (`no --json`): a compact table per section — reuse the existing dashboard formatting helpers in `apps/cli/src/cli-ui.ts` (`grep -n "formatTable\|renderTable" apps/cli/src/cli-ui.ts` to find the exact names).

- [ ] **Step 1: Failing test**

```ts
it("rolls up counts, reservations, and top blockers for a sprint", async () => {
  /* create sprint container + 4 member tasks; block t3 by t1 and t4 by t1; claim t2 as agent-x;
     close t1's dependency chain partially */
  const status = await runCli(["sprint", "status", sprintId, "--json"], ws);
  expect(status.json.data.counts.total).toBe(4);
  expect(status.json.data.reservations[0].agentId).toBe("agent-x");
  expect(status.json.data.topBlockers[0].workId).toBe(t1); // blocks 2 transitively
});
```

- [ ] **Step 2: Implement.** `topBlockers`: build the reverse adjacency (blocker → blocked) once from `listGraphEdges`, BFS per open member, count reachable open dependents. `staleClaims`: reservations with `expiresAt <= now` and `status === "active"`.
- [ ] **Step 3: Suite + docs + commit** `feat: sprint status rollup command`.

---

## Phase 6 — Reservation renewal automation

### Task 10: `agent renew --all` + daemon heartbeat

**Files:**
- Modify: `apps/cli/src/commands/agent.ts` (extend renew to `--all --agent <id> [--extend <duration>]`), `apps/cli/src/command-registry.ts`, `docs/cli/COMMANDS.md`
- Modify: `apps/daemon/src/runtime.ts` (watch cycle also renews reservations for agents with a fresh heartbeat file — inspect what the daemon watch cycle already does first: read `apps/daemon/src/runtime.ts` fully before editing)
- Test: `tests/runtime/agent-renew-all.test.ts` (create)

**Interfaces:**
- Produces: `bwrk agent renew --all --agent <id> --extend 30m --json` renews every active reservation owned by `<id>` to `now + duration` (duration parser: support `Nm`/`Nh`; reject others with `BOREAL_INVALID_INPUT`). Output: `{ renewed: [{ workId, reservationId, expiresAt }], skipped: [...] }`. The runtime already has `renewWorkReservation` — this is a loop over `listActiveReservationsForAgent` calling it.

- [ ] **Step 1: Failing test**

```ts
it("renews all active reservations for one agent", async () => {
  /* claim two items as agent-x with short expiries, one item as agent-y */
  const result = await runCli(["agent", "renew", "--all", "--agent", "agent-x", "--extend", "30m", "--json"], ws);
  expect(result.json.data.renewed.length).toBe(2);
  /* agent-y's reservation expiresAt unchanged */
});
it("rejects bad durations", async () => { /* --extend fortnight -> exit 2, BOREAL_INVALID_INPUT */ });
```

- [ ] **Step 2: Implement CLI, then the daemon hook:** in the daemon's periodic cycle, for each agent with an active reservation whose `expiresAt` is within 2× the cycle interval, renew by the configured lease duration and log it. Keep it opt-in via daemon config flag `renewReservations: true` if the daemon has a config surface (check `apps/daemon/src/index.ts`); otherwise always-on with a log line.
- [ ] **Step 3: Suite + commit** `feat: bulk reservation renewal and daemon heartbeat`.

---

## Phase 7 — Cross-project status

### Task 11: `bwrk global status`

**Files:**
- Modify: `apps/cli/src/commands/registry.ts` (or wherever `bwrk projects`-style commands live — `grep -rn "project-registry" apps/cli/src/commands/` first), `apps/cli/src/command-registry.ts`, `docs/cli/COMMANDS.md`
- Test: `tests/runtime/global-status.test.ts` (create)

**Interfaces:**
- Consumes: the project registry (`packages/core/src/project-registry.ts`) — the existing registry commands show how projects are registered and resolved; reuse their loading helper.
- Produces: `bwrk global status --json`: for each registered project, open its store read-only and report `{ projectId, rootDir, storage, workOpen, workReady, workBlocked, activeReservations, lastEventAt, ok }`; unreachable projects report `{ ok: false, error }` without failing the whole command. Exit 0 unless `--strict` and any project is unreachable. Human output: one table row per project.

- [ ] **Step 1: Failing test**

```ts
it("summarizes every registered project and tolerates a broken one", async () => {
  /* register two temp workspaces (one valid, one with rootDir deleted) in a temp registry */
  const result = await runCli(["global", "status", "--json"], ws, { env: registryEnv });
  expect(result.json.data.projects.length).toBe(2);
  expect(result.json.data.projects.filter((p) => p.ok).length).toBe(1);
});
```

- [ ] **Step 2: Implement.** Store opening per project respects each project's `storage` marker (the factory from the previous plan's Task 11 — `grep -rn "objects-v1" apps/cli/src/context.ts`). Read-only: use `store.read`, never `write`, so a locked project can't block (reads take no lock).
- [ ] **Step 3: Suite + docs + commit** `feat: global status across registered projects`.

### Task 12: Final verification

- [ ] **Step 1:** `pnpm check && pnpm test` all green.
- [ ] **Step 2:** Dogfood pass on this repo: `time bwrk sync status --json` (expect < 1s), `bwrk search "workflow" --json | head`, `bwrk sprint status <a-real-sprint-id> --json`, `bwrk storage rotate-log`, `bwrk doctor --strict --json` → ok.
- [ ] **Step 3:** Record before/after numbers (sync status seconds, search index bytes on disk, runtime-cache.sqlite deleted) in the final commit message; push after user review.

---

## Self-review notes

- **Spec coverage:** search items 1–3 → Tasks 1–3; legacy cache retirement → Task 4; log rotation → Task 5; worktree-per-agent → Tasks 6–7; merge-driver wiring + rechain detection → Task 8; sprint status → Task 9; renewal automation → Task 10; global status → Task 11.
- **Sequencing:** Tasks 1–2 are prerequisites for 3 (shared field extraction, corpus definition). Task 4 is independent after 3. Phases 3–7 are mutually independent and can run as parallel prompts EXCEPT Tasks 6–7 (same files, sequential) — safe parallel batches: {5}, {6→7}, {8}, {9}, {10}, {11}.
- **Type consistency:** `FtsSearchIndex`/`FtsDocumentInput` used in Tasks 3 only; `rotate`/`verifyDeep` in Task 5 and doctor wiring in Task 8 both extend `FileEventLog`; `worktreePath` lives under the existing `reservation.git` object in Tasks 6–7; `SprintStatusResult`/renew output shapes are self-contained per task.
- **Known unknowns flagged for executors** (with grep instructions in-task): merge-driver script location, sprint membership helper, daemon cycle structure, project-registry command file, table-formatting helper names.
