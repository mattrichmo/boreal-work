# Source engine workflow

The Rust source engine turns raw project material into cited, retrievable
memory. It is an application workflow with durable stages, not a second work
tracker and not an agent that secretly edits published knowledge.

## Source states

```text
registered -> captured -> extracted -> indexed
       \-> capture_failed   \-> extraction_failed
```

An immutable `source_version_id` identifies exact bytes or a Git tree object,
not merely a mutable path or URL. A source record includes origin URI,
project/access scope, content digest, media type, byte count, captured time,
parser/configuration identity, and availability. A retry with the same input
and operation ID is idempotent. A changed source creates a new version; it
does not rewrite citations to the old version.

Sources are untrusted input. The parser treats embedded commands and prompts
as content, preserves their origin, and never executes them as workflow
instructions. File paths and URLs are validated against an explicit project
scope before access.

The filesystem catalog stores blobs by digest and atomically snapshots source
metadata, parser records, and rebuildable index state in `catalog.json`.
Reopening the catalog restores searchable state; a missing or corrupt blob is
still reported by doctor rather than silently recreated.

## Work split

1. Register a source intent and validate its path/URI and scope.
2. Capture bytes or an immutable Git reference outside the work-state write
   transaction. Bound bytes, time, redirects, and parser resources.
3. Store content by digest and commit metadata in a short transaction.
4. Parse/index asynchronously. Record parser version, warnings, and an output
   digest. Failed parsing remains visible and retryable.
5. Let a human or agent propose a cited draft note/decision. Draft review and
   Git publication are a separate memory-entry lifecycle. Source text does
   not become an authoritative claim merely because it was parsed.
6. Publish reviewed memory through the Git publication workflow in
   [MEMORY_BANK.md](MEMORY_BANK.md), then index the committed revision.

The service schedules jobs and records their operation IDs, state, last
error, retry-not-before, and input revision. It does not hold a SQLite write
transaction while downloading, parsing, embedding, waiting for a model, or
committing Git. One failed source does not prevent unrelated work claims or
status reads.

## Provenance and retrieval

Every derived excerpt points to an exact source version and location (for
example line, page, byte range, or Git path/revision). Retrieval distinguishes
raw source, parsed extraction, draft memory, and published memory. It reports
the index revision and any lag. A stale parser output cannot be published as
if it described a newer source version.

Search starts with IDs, metadata filters, and local full-text indexing. Add
embedding search only after a recall/precision benchmark and a clear
reindexing policy. A context pack is generated on demand with a byte/token
budget, source citations, and revision; it is not a new source of truth.

## Integration with work

Tasks may reference source or published-memory IDs. Evidence may reference a
source version or a Git snapshot. The source engine never copies live task
status into memory files. Work completion cannot silently promote a draft
into published memory; promotion is an explicit reviewed operation.

## Tests

Concurrent ingest of the same source, changed bytes at the same URI, restart
and metadata reload, parser crash and retry, missing blob, stale citation, unsafe path/URI, project scope
isolation, large-source backpressure, and Git publication during three active
workers. Measure ingest throughput separately from claim/read latency.
