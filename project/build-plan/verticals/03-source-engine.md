# Vertical 03 — Rust source engine

## Purpose

Build the Rust-owned source-intake vertical that turns explicitly scoped project
material into immutable, cited, searchable source versions. The vertical owns
capture, blob durability, parsing, extraction, indexing, provenance, trust
classification, retryable jobs, and retrieval boundaries. It does not promote
parsed material into published knowledge by implication; draft creation and
publication are the adjacent [memory-bank vertical](./04-memory-bank.md).

The design follows the v2 source lifecycle
`registered -> captured -> extracted -> indexed`, with visible
`capture_failed` and `extraction_failed` outcomes. See
[`SOURCE_ENGINE.md`](../../SOURCE_ENGINE.md),
[`STATE_AND_CONCURRENCY.md`](../../STATE_AND_CONCURRENCY.md), and
[`PRODUCT.md`](../../PRODUCT.md).

## Task-index alignment

This vertical is the detailed handoff for the following stable leaves in
[`../TASK_INDEX.md`](../TASK_INDEX.md):

| Task | Responsibility in this vertical | Prerequisites |
| --- | --- | --- |
| P3-01 | Content-addressed blobs, immutable source versions, scope, availability, and idempotent intake | P2-09 |
| P3-02 | Extraction jobs, parser identity, versioned FTS/search, and lag/staleness rules | P3-01 |
| P3-03 | Supply source-version/citation validation to Vertical 04, which owns the leaf | P3-01, P3-02 |
| P3-05 | Own bounded, revisioned retrieval and context views using Vertical 04's published-memory projection | P3-02, P3-04 |
| P3-06 | Supply blob/index integrity probes to Vertical 04, which owns doctor/repair | P2-09, P3-04 |

P3-03, P3-04, and P3-06 are implemented in
[the memory-bank vertical](./04-memory-bank.md); only P3-01, P3-02, and P3-05
are this agent's leaf ownership. Publication is the prerequisite for P3-05.
The product and
deployment choices required by P0-01, especially memory authority and host
boundary, must be recorded before P2-09 and before these source contracts are
frozen. P4-04 consumes this vertical's source/version/blob migration evidence;
it is not implemented here.

## Owned paths

- `crates/domain/src/source.rs` and source/citation/trust types and rules.
- `crates/store/src/source/`, blob metadata, migrations, integrity queries, and
  source/job transaction tests.
- `crates/application/src/source/`, extraction orchestration, retrieval use
  cases, scope policy, job commands, and source-side integrity probes.
- `crates/service/src/source_jobs.rs` and bounded background scheduling once
  the service crate exists.
- `crates/protocol/src/source.rs` and source/retrieval DTO fixtures once the
  protocol crate exists.
- `crates/cli/src/commands/memory_source.rs` (or the agreed source-command
  module) and machine-readable source/retrieval output.
- `tests/fixtures/source-engine/`, including bytes, parser outputs, malformed
  inputs, provenance cases, and migration fixtures.
- `docs/MIGRATION.md` only for source-specific import behavior and unsupported
  legacy records; do not edit legacy runtime modules.

The source/memory agent owns these paths in coordination with the application
and store integration owner. Shared schema or protocol changes require the
architecture steward's fixture update and an integration check, per
[`NEXT_AGENT_TASKS.md`](../../NEXT_AGENT_TASKS.md).

## Prerequisites

1. Freeze typed IDs, project identity, operation envelopes, revision semantics,
   and the initial SQLite schema/transition fixtures. Source records must use
   the same store revision and operation-id rules as work mutations.
2. Settle the provisional policy that Git is authoritative for published
   curated memory while SQLite owns intake, drafts, jobs, and indexes; this is
   R04 in [`DECISIONS.md`](../../DECISIONS.md) and is a hard prerequisite for
   the handoff to vertical 04.
3. Have the Rust domain/store/application path and short writer transaction
   boundary available. Slow capture, parsing, indexing, model work, and Git
   work must remain outside those transactions; see
   [`ARCHITECTURE.md`](../../ARCHITECTURE.md).
4. Define the first supported source kinds and limits: local project files,
   explicit URIs, and immutable Git references as applicable. Network-hosted
   sources require bounded redirects, bytes, duration, and resource use.
5. Establish the legacy mapping inputs from the old knowledge source, raw
   inbox, source-backed claim/decision, FTS, and context-pack behavior. Treat
   legacy code as behavioral reference only, as required by
   [`AGENTS.md`](../../../AGENTS.md) and
   [`docs/MIGRATION.md`](../../../docs/MIGRATION.md).

## Concrete outputs

- A source-domain model with `source_id`, immutable `source_version_id`, source
  kind, origin URI/path or Git object, project/access scope, media type, byte
  count, capture time, content digest, parser/configuration identity,
  availability, state, warnings, and failure details.
- A citation model that addresses exact source-version locations by line,
  page, byte range, or Git path/revision and rejects ambiguous or stale
  references.
- A content-addressed blob adapter with atomic temp-write/rename, digest and
  byte-count verification, availability states, reference checks, and safe
  garbage-collection eligibility.
- Capture, extraction, and indexing job records with operation ID, input
  version/revision, state, retry-not-before, attempt count, last error, output
  digest, and parser/index identity.
- Scope validation for local paths, URIs, Git references, project identity, and
  access grants. Embedded commands, prompts, and code are retained as data and
  never dispatched as instructions.
- Deterministic parsing output and local full-text index integration that
  exposes index revision and lag. Embedding search remains a later derived
  optimization, not a first-release dependency.
- Application/API/CLI operations for register, capture, show/list, retry,
  extract/index status, and bounded retrieval/context-pack generation.
- Source fixtures, failure-injection harnesses, migration notes, and measured
  ingest-versus-claim/read concurrency results.

## Ordered steps

1. **[P3-01/P3-02] Freeze the contract.** Write source, source-version, blob, extraction,
   citation, trust, and retrieval fixtures. Specify legal state transitions,
   idempotency keys, revision fields, limits, and error outcomes before schema
   implementation. Include raw source, parsed extraction, draft memory, and
   published memory as distinct result kinds.
2. **[P3-01] Register intent.** Validate the project identity, actor, source kind,
   path/URI/Git reference, access scope, and operation ID. Create a registered
   source/job record in one short transaction. Registration stores intent and
   metadata only; it does not claim that bytes are available.
3. **[P3-01] Capture outside the writer transaction.** Resolve only allowed local
   paths or URIs, enforce byte/time/redirect/parser-resource bounds, read the
   exact input, and compute the content digest. For Git, resolve and record an
   immutable tree/blob object rather than a mutable branch name. Preserve
   capture diagnostics and never execute content.
4. **[P3-01] Durably write and verify blobs.** Stream bytes to a content-addressed
   temporary object, fsync/atomically install it, re-read or otherwise verify
   digest, size, and media type, then commit the blob reference and captured
   source version in a short SQLite transaction. Do not make a reference
   visible before the blob is verified; mark missing/corrupt availability
   explicitly.
5. **[P3-02] Extract asynchronously.** Select a committed source version, run a
   bounded parser identified by version/configuration, produce deterministic
   structured text and location maps, write output blobs, and record warnings,
   output digest, parser identity, and input revision. A parser crash leaves a
   retryable failed job and the immutable source intact.
6. **[P3-02] Index as derived data.** Build/rebuild local FTS documents from committed
   extraction output and published-memory inputs, tagging each row with input
   source/revision, index schema/algorithm version, and digest. A lagging or
   missing index is visible; retrieval may rebuild only under an explicit policy
   or return unavailable/stale, never silently current.
7. **[P3-03] Create cited drafts through vertical 04's boundary.** Expose source
   excerpts and citation tokens to the draft operation, but require an explicit
   actor/review action before a claim, note, or decision can become published.
   Reject citations whose source version or location no longer matches.
8. **[P3-05] Implement retrieval.** Support exact IDs, metadata/scope filters, source
   version lookup, local full-text search, and bounded context packs. Return
   source kind, source-version ID, citation location, trust/authority, content
   digest, Git revision when relevant, index revision, and lag. Materialize
   results before closing read transactions; serialize/render afterward.
9. **[P3-06] Add recovery and maintenance.** Make capture/extraction/index retries
   idempotent, reconcile jobs after service restart, verify blob references,
   report orphan/corrupt/missing objects, and make supported repairs no-op on a
   second run. Garbage collect only unreferenced blobs past the documented
   grace period and never delete evidence needed by a historical receipt.
10. **[P3-01..P3-06/P4-04] Run integration and migration checks.** Exercise three active workers,
    concurrent claims/reads, source updates at one URI, import of supported
    legacy sources/entries, unsupported-record reporting, and fresh-project
    rehydration. Record scoped/full test status, snapshots, digests, timings,
    changed paths, and known limitations in the handoff evidence.

## Invariants

- `source_version_id` identifies exact bytes or an immutable Git object; a
  changed capture creates a new version and never rewrites old citations.
- A source reference is visible only after its blob digest, byte count, and
  metadata have been verified. Missing or unavailable bytes are explicit.
- Source content is untrusted data. Parser output and embedded prompts cannot
  alter work state, dispatch jobs, change access scope, or become trusted
  directives.
- Every excerpt/citation names an immutable source version and exact location;
  stale parser output cannot describe or publish a newer version.
- Capture, parse, index, and retrieval are not a second work tracker. They
  cannot create task status, reservations, attempts, or completion evidence.
- No SQLite transaction spans file/network capture, parsing, model calls, Git,
  waits, or serialization. One failed source cannot block claims or reads.
- Operation IDs make repeated register/capture/retry requests idempotent;
  unknown outcomes resolve by readback rather than blind duplication.
- Search, extraction, and context projections are rebuildable and report their
  input revision/algorithm and lag; canonical source metadata remains in the
  store and immutable blobs.
- Scope checks prevent cross-project reads, path traversal, URI escapes, and
  implicit global retrieval.

## Failure injections

- Same source concurrently ingested by multiple clients: one immutable version
  and one logical result, with duplicate operations returning the original.
- Same URI recaptured with changed bytes: two versions, old citations intact,
  and no content-hash collision or overwrite.
- Crash before blob install, after blob install before DB commit, and after DB
  commit: no visible dangling reference; safe retry or explicit orphan cleanup.
- Missing, truncated, tampered, or permission-denied blob: retrieval reports
  unavailable/corrupt and does not fabricate text.
- Parser timeout, resource exhaustion, malformed input, process crash, and
  stale parser result: failed/retryable status, preserved evidence, no stale
  promotion.
- Index crash, schema mismatch, interrupted rebuild, and lagging revision:
  bounded stale/unavailable response and idempotent rebuild.
- Unsafe local path, symlink escape, disallowed URI/redirect, cross-project
  source ID, and untrusted embedded instruction: structured rejection with no
  side effect.
- Large source under concurrent claim/read load: measure queue wait and SQLite
  transaction hold separately; claim/read latency must not include parsing.
- Service restart with queued/in-flight jobs: reconcile by operation ID and
  input revision without duplicate extraction or silent loss.

## Measurable acceptance

- The first-slice walkthrough registers/captures a source, extracts/indexes it,
  creates a cited draft, retrieves the citation, and hands it to publication;
  each response includes a stable operation ID, revision, digest, and state.
- 100 repeated captures of one immutable fixture, including concurrent clients,
  produce one verified blob/version per byte digest and zero duplicate logical
  source versions for identical operation/input identity.
- Changed bytes at one URI produce distinct source-version IDs; retrieval of
  the old citation remains byte/location correct and is never relabeled as the
  new version.
- All failure injections above produce typed outcomes, preserved failed job
  evidence, and an idempotent retry or documented terminal disposition.
- Scope/path/URI tests reject every escape fixture and show zero records from a
  different project. Embedded instruction fixtures cause no mutation.
- FTS retrieval returns the requested source ID/version, exact citation,
  authority/trust, digest, index revision, and explicit lag. Context packs stay
  within configured byte/token budgets.
- Under the shared benchmark workload, a large ingest and index run does not
  increase p95 claim transaction hold time beyond the agreed baseline budget;
  report p50/p95/max ingest, queue wait, transaction hold, read latency, WAL
  growth, and bytes processed separately, as required by
  [`DELIVERY_PLAN.md`](../../DELIVERY_PLAN.md).
- Fresh-clone and migration fixtures either fully restore supported source
  metadata/blobs or report each unavailable blob and unsupported record by ID;
  no silent drop is accepted.

## Excluded scope

- Semantic/embedding search, remote multi-host source service, global sharing,
  automatic web crawling, OCR/transcription, and arbitrary model providers.
- Automatic promotion of parsed text to claims, decisions, wiki pages, or
  published memory; review/publication belongs to vertical 04.
- Task scheduling, attempt lifecycle, evidence-gate policy, Git publication,
  TUI rendering, and a second source/work authority.
- Copying legacy vault/knowledge implementations or importing unsupported
  legacy records without an explicit disposition.

## Handoff evidence

Provide the source-to-v2 mapping, schema/protocol fixture IDs, migration dry-run
report, failure-injection matrix, exact test commands and fixture snapshot,
source/blob/parser/index digests, and changed-file list. Include measured
ingest, queue, transaction-hold, read, and claim timings under the same
workload with TUI on/off noted where applicable. State which checks were scoped
versus full integration, list unavailable/unsupported legacy records, and link
the publication contract and unresolved decision in
[`MEMORY_BANK.md`](../../MEMORY_BANK.md) and
[`DECISIONS.md`](../../DECISIONS.md).
