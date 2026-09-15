# Vertical 04 — Git-authoritative memory bank

## Purpose

Build the Rust-owned memory-bank vertical that turns reviewed, source-cited
drafts into portable published project knowledge. SQLite remains authoritative
for operational memory, source intake, drafts, publication jobs, and indexes;
Git is authoritative only for published curated notes and decisions at a
named revision. The boundary is deliberately recoverable rather than falsely
atomic: a database commit never claims a Git commit happened until the
publication identity is verified.

This vertical consumes immutable source versions from
[vertical 03](./03-source-engine.md), emits deterministic Markdown plus a
manifest in a dedicated memory worktree, imports external Git edits as visible
revisions/conflicts, and exposes revisioned retrieval. See
[`MEMORY_BANK.md`](../../MEMORY_BANK.md),
[`SOURCE_ENGINE.md`](../../SOURCE_ENGINE.md), and
[`STATE_AND_CONCURRENCY.md`](../../STATE_AND_CONCURRENCY.md).

## Task-index alignment

This vertical is the detailed handoff for the following stable leaves in
[`../TASK_INDEX.md`](../TASK_INDEX.md):

| Task | Responsibility in this vertical | Prerequisites |
| --- | --- | --- |
| P3-03 | Cited draft memory, review state, and the draft/published boundary | P3-01, P3-02 |
| P3-04 | Serialized Git publication, manifest/files, reimport, and crash recovery | P3-03 |
| P3-05 | Supply published-memory projection/metadata to Vertical 03, which owns the retrieval leaf | P3-02, P3-04 |
| P3-06 | Doctor, retention, and stable repair across publication/blob/index state | P2-09, P3-04 |

P0-01 is a mandatory upstream decision gate: it must explicitly settle Git vs
database memory authority, host boundary, startup, platform, and completion
policy before publication schemas or acceptance tests are frozen. P4-04 is the
downstream migration consumer: its dry-run importer must use this vertical's
manifest, Git-reference, source-citation, blob-availability, and unsupported
record dispositions. P3-01, P3-02, and P3-05 are implemented in
[the source-engine vertical](./03-source-engine.md); this agent owns P3-03,
P3-04, and P3-06. Coordinate the retrieval DTO and projection hook before
either agent edits a shared protocol fixture.

## Owned paths

- `crates/domain/src/memory.rs`, draft/review/publication states, entry IDs,
  citation and trust rules, and Git-revision identity types.
- `crates/store/src/memory/`, publication jobs/outbox, import records,
  manifests, index metadata, and transaction/migration tests.
- `crates/application/src/memory/`, draft/review/publish/import/retrieve use
  cases and reconciliation policy.
- `crates/service/src/memory_publisher.rs`, serialized Git writer queue,
  restart recovery, and index scheduling once the service crate exists.
- `crates/protocol/src/memory.rs` and draft/publish/retrieval fixtures once the
  protocol crate exists.
- `crates/cli/src/commands/memory.rs` (or the agreed memory-command module).
- `tests/fixtures/memory-bank/`, Git repositories/worktrees, manifests,
  conflict cases, and fresh-clone restoration fixtures.
- `docs/MIGRATION.md` for supported legacy memory mappings, source dispositions,
  and explicit unsupported-record reporting.

The publisher owns only the managed memory Git root/worktree. It must not stage
the application source repository or alter live task state. Shared schema and
API changes require the integration owner and protocol fixture updates.

## Prerequisites

1. Confirm R04 in [`DECISIONS.md`](../../DECISIONS.md): Git-authoritative
   published memory, SQLite-authoritative live operational state. If the
   product chooses DB-canonical memory instead, stop and revise this plan
   before implementing publication.
2. Complete vertical 03's immutable source versions, citation locations,
   content-addressed blobs, scope checks, and retrieval contract.
3. Complete the domain/store transaction and revision foundations described in
   [`DELIVERY_PLAN.md`](../../DELIVERY_PLAN.md), including operation-id
   idempotency, audit events, and no-long-transaction rules.
4. Define memory-root layout and Git mode (in-repo, child, sibling, or
   submodule) plus access/role policy. Published memory belongs to the managed
   project's dedicated memory branch/worktree, not the v2 application source
   tree; see [`MEMORY_BANK.md`](../../MEMORY_BANK.md).
5. Freeze deterministic Markdown/frontmatter and manifest schemas, entry ID and
   content-digest rules, citation format, supported statuses, and import
   conflict policy. Titles and filenames must not change identity.
6. Decide the first publication authority and permissions before tests are
   called acceptance. Open questions in [`DECISIONS.md`](../../DECISIONS.md)
   must not become hidden code defaults.

## Concrete outputs

- Typed memory entry/draft models for notes, decisions, citations,
  review disposition, source trust, related work references, and publication
  state (`draft`, `publishing`, `published`, `failed`, plus visible conflict or
  unavailable conditions).
- Deterministic `.boreal-memory/manifest.json`, `sources/<source-id>.json`,
  `notes/<entry-id>.md`, and `decisions/<entry-id>.md` output, with schema
  version, project scope, IDs, source-version citations, actor, timestamps,
  content digests, and referenced blob/export policy.
- SQLite publication/outbox records containing operation ID, entry IDs,
  expected input revision, deterministic manifest identity, Git root/worktree,
  job state, attempt/retry data, last error, and verified committed revision.
- One serialized Git publisher with a dedicated short lock/queue, atomic file
  writes, deterministic commit preparation, commit verification, and no Git
  operation inside work-state transactions.
- Recovery/reconciliation that resolves uncertain outcomes by manifest/commit
  identity, imports external Git revisions after validation, and surfaces
  conflicts without overwriting human changes.
- Versioned FTS/index integration over committed memory plus source metadata;
  retrieval returns entry ID, excerpt, citation, content digest, Git revision,
  index revision/lag, and source authority/trust.
- CLI/API operations for draft create/show/review, publish/status/retry,
  import/reconcile, memory show/search, bounded context packs, and doctor
  diagnostics.
- Fresh-clone restore, blob completeness, crash/retry, migration, and
  concurrent-worker fixtures with measurable publication and claim latency.

## Ordered steps

1. **[P0-01/P3-03/P3-04] Freeze memory contracts.** Create fixtures for entry IDs, frontmatter,
   manifests, citations, trust, review transitions, publication envelopes,
   import conflicts, and retrieval results. Define which fields are curated
   memory versus mutable work metadata; live status, reservations, and
   attempts must be absent from published files.
2. **[P3-03] Model drafts and review.** Accept only existing immutable source-version
   citations, exact locations, project scope, actor, and content. Create a
   draft in SQLite with a content digest and source refs. Let review approve,
   reject, merge, supersede, or defer while preserving the draft and review
   history. Parsing alone cannot create an authoritative claim.
3. **[P3-04] Validate publication inputs.** Recheck citation availability, source
   version, location, scope, entry schema, duplicate identity, and expected
   SQLite revision immediately before enqueueing publication. Record a stable
   operation ID and deterministic manifest identity in one short transaction.
4. **[P3-04] Implement the outbox/job boundary.** Commit `publishing` intent and its
   input revision to SQLite, then release the transaction. The job worker reads
   the committed intent, never holds a work transaction while waiting, and
   serializes publication per memory Git root. Retries use the same operation
   and manifest identity.
5. **[P3-04] Write deterministic Git content.** In a dedicated memory worktree, render
   canonical Markdown/frontmatter and manifest, write atomically, validate
   paths, inspect the diff, and commit only the intended memory files. Do not
   stage source-code worktrees, unreviewed drafts, raw bytes, or live task
   status. Raw/large blobs stay content-addressed outside Git unless the
   explicit export policy requires them.
6. **[P3-04] Verify and acknowledge.** After commit, read the commit/tree and manifest
   back, verify project scope, operation ID, entry IDs, content digests, and
   parent revision, then commit `published` plus the exact Git revision in a
   short SQLite transaction. If the DB acknowledgement is uncertain, leave
   the job recoverable; never create a second publication merely because the
   client timed out.
7. **[P3-04/P3-06] Recover every boundary.** Inject and handle crashes before staging, after
   file write, after commit before DB acknowledgement, and after acknowledgement
   before index scheduling. Reconcile by job/manifest/commit identity; mark
   ambiguous or conflicting state visibly and require operator resolution where
   identity cannot be proven.
8. **[P3-04] Import external Git revisions.** Detect branch/worktree changes, validate
   manifest schema, IDs, project scope, citations, paths, digests, and blob
   availability, then record a new published revision and rebuild derived
   indexes. Human conflicts are preserved as import-conflict records; never
   silently overwrite or force-reset the memory branch.
9. **[P3-05/P3-06] Index committed memory.** Index only validated published revisions, tag
   records with Git revision and index schema/revision, and expose lag during
   rebuild. Retrieval may include drafts/raw inputs only when explicitly asked
   and must label their authority separately from published Git memory.
10. **[P4-04/P3-06] Restore and migrate.** Rehydrate a fresh clone from manifest and included
    blobs, report unavailable references, and import the reduced supported
    legacy format. Preserve supported source IDs, citations, decisions, Git
    references, failed evidence, and historical attempts where in scope.
    Report legacy claims or vault records lacking a v2 representation instead
    of dropping them.
11. **[P3-03..P3-06/P4-04] Integrate with work and hand off.** Prove publication does not block
    claims/status reads, run the full first memory slice, update migration
    notes, and deliver the required handoff evidence. Keep the next TUI lane on
    the versioned API rather than exposing SQLite or Git internals.

## Invariants

- SQLite is authoritative for drafts, source intake, publication jobs, index
  state, and operational memory; Git at a verified named revision is
  authoritative for published curated memory.
- A draft is never presented as published. A successful SQLite transaction is
  not proof of a Git commit; `publishing`, `published`, `failed`, conflict, and
  unavailable states remain explicit.
- Publication is idempotent by operation ID plus deterministic manifest/entry
  identity. Retries reconcile an existing commit before creating or accepting
  another one.
- No transaction spans Git, filesystem/network/model work, waits, or UI
  rendering. Git locks/queues are independent of work-state writer locks.
- Every published note/decision carries exact immutable source-version
  citations, project scope, schema version, actor/timestamps, and content
  digest. It never copies live task status, reservations, or attempt state.
- Git paths and frontmatter cannot change entry identity. A staged or
  uncommitted edit is not published memory.
- Import validates schema, IDs, scope, citations, blobs, and paths. External
  edits become a new revision or visible conflict; human-authored changes are
  never silently overwritten.
- Published-memory retrieval reports Git revision, source citation/trust,
  content digest, index revision, and lag. Derived search/context projections
  are rebuildable and cannot become a second authority.
- Failed drafts, failed jobs, uncertain outcomes, conflicts, missing blobs,
  and historical review evidence remain inspectable and recoverable.
- Project scopes are isolated; cross-project use requires explicit later
  import/grant semantics, not a global implicit index.

## Failure injections

- Draft cites missing, stale, wrong-scope, unsupported, or unavailable source
  version: reject publication with precise citation diagnostics and preserve
  the draft.
- Concurrent publish requests for the same entry/root: one serialized commit;
  duplicates resolve to the original operation/commit identity.
- Crash before outbox commit, after outbox commit, during file write, after
  commit before DB acknowledgement, and during index scheduling: restart
  recovery yields one of the documented states without duplicate entries.
- Dirty memory worktree, unrelated staged files, branch movement, missing
  repository, permission failure, hook failure, or lock contention: fail safe,
  preserve user edits, and return retry/operator guidance.
- Manifest/file tampering, path traversal, duplicate IDs, digest mismatch,
  unsupported schema, wrong project scope, and missing referenced blob during
  import: reject or mark unavailable; never overwrite or claim completeness.
- External edit conflicts with a local pending publication: create an
  explicit conflict and require reconciliation; do not force-push/reset.
- Git commit succeeds but process loses the revision; read back by manifest
  identity before retrying. If more than one candidate exists, stop automatic
  recovery and surface ambiguity.
- Large Markdown/blob export or index rebuild under three active workers:
  claim/read transactions remain bounded and unaffected; publication queue
  backpressure is visible.
- Fresh clone omits a required blob or has a stale index: restore metadata,
  report unavailable content and index lag, and never report a complete pack.

## Measurable acceptance

- The first memory slice ingests one fixture source, creates a cited draft,
  reviews it, publishes deterministic Markdown/manifest, records a verified
  Git revision, indexes it, and retrieves the entry with citation, digest,
  Git revision, and index revision.
- Replaying the same publish operation at least 100 times, including concurrent
  callers and client timeouts, yields one logical entry and one manifest
  identity; every duplicate returns/read-resolves the original outcome.
- Each publication crash injection above is recovered by an automated
  reconciliation test with no duplicate entry, no lost failed evidence, and a
  visible failed/conflict/unavailable state when proof is insufficient.
- A fresh clone restores every supported published entry and citation, or
  reports each excluded blob/reference by ID and digest. Unsupported legacy
  records appear in a migration report and are never silently discarded.
- External valid Git edits import as a named revision; invalid or conflicting
  edits are rejected with a durable conflict record and leave the prior
  published revision intact.
- Retrieval distinguishes published Git memory, draft operational context,
  and raw source; it returns exact provenance, authority/trust, revision, and
  lag, and context packs stay within configured byte/token limits.
- During the agreed three-worker/large-source benchmark, p95 claim transaction
  hold and ordinary status-read latency remain within the baseline budget while
  publication runs. Report p50/p95/max queue wait, Git duration, SQLite hold,
  read latency, index lag, WAL/checkpoint effects, payload bytes, retries, and
  duplicate-publication count, following
  [`DELIVERY_PLAN.md`](../../DELIVERY_PLAN.md).
- Published output is byte-for-byte deterministic for the same input revision,
  entry content, and schema version; a formatting-only rerun produces no
  semantic duplicate.
- Doctor/recovery run twice is a no-op after repair, while failed attempts,
  conflicts, and historical publication evidence remain queryable.

## Excluded scope

- Git as an authority for work claims, attempts, reservations, scheduling, or
  audit events; work-state export is a separate optional concern.
- Remote collaboration/authentication, merge automation beyond explicit local
  conflict reporting, global/cross-project memory, semantic/embedding search,
  and automatic knowledge adjudication.
- Raw-byte Git mirroring by default, unbounded context dumps, model-mediated
  publication without review, automatic task-status mirroring, and the TUI.
- Legacy vault/knowledge runtime reuse, broad legacy workflow porting, and
  silent lossy migration.

## Handoff evidence

Include the final publication authority decision, memory schema/frontmatter and
manifest fixtures, exact Git repository/worktree configuration, operation and
commit identities, crash/recovery matrix, import/export dry-run report, blob
completeness report, and changed-file list. Attach exact commands, fixture
snapshots, Git diffs/logs, SQLite job/revision readbacks, retrieval responses,
and test results. Report scoped versus full integration checks, benchmark
timings and payload sizes, unresolved conflicts/unavailable blobs, migration
limitations, and the API fixtures required by the TUI handoff. Cite the source
contract in [`SOURCE_ENGINE.md`](../../SOURCE_ENGINE.md) and the implementation
sequence/acceptance in [`DELIVERY_PLAN.md`](../../DELIVERY_PLAN.md).
