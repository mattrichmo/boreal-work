# R-SOURCE-DOC — project/SOURCE_ENGINE.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/SOURCE_ENGINE.md:L1–L76`  
**File SHA-256:** `774e52797de345c7398debbd67fd75850cc676626f77cba76cc81d03e151937a`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Versioned source intake, parsing, citation, filtering, retrieval and index authority.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,76p' 'project/SOURCE_ENGINE.md'
```

## Exact baseline excerpt

````text
    1 | # Source engine workflow
    2 | 
    3 | The Rust source engine turns raw project material into cited, retrievable
    4 | memory. It is an application workflow with durable stages, not a second work
    5 | tracker and not an agent that secretly edits published knowledge.
    6 | 
    7 | ## Source states
    8 | 
    9 | ```text
   10 | registered -> captured -> extracted -> indexed
   11 |        \-> capture_failed   \-> extraction_failed
   12 | ```
   13 | 
   14 | An immutable `source_version_id` identifies exact bytes or a Git tree object,
   15 | not merely a mutable path or URL. A source record includes origin URI,
   16 | project/access scope, content digest, media type, byte count, captured time,
   17 | parser/configuration identity, and availability. A retry with the same input
   18 | and operation ID is idempotent. A changed source creates a new version; it
   19 | does not rewrite citations to the old version.
   20 | 
   21 | Sources are untrusted input. The parser treats embedded commands and prompts
   22 | as content, preserves their origin, and never executes them as workflow
   23 | instructions. File paths and URLs are validated against an explicit project
   24 | scope before access.
   25 | 
   26 | The filesystem catalog stores blobs by digest and atomically snapshots source
   27 | metadata, parser records, and rebuildable index state in `catalog.json`.
   28 | Reopening the catalog restores searchable state; a missing or corrupt blob is
   29 | still reported by doctor rather than silently recreated.
   30 | 
   31 | ## Work split
   32 | 
   33 | 1. Register a source intent and validate its path/URI and scope.
   34 | 2. Capture bytes or an immutable Git reference outside the work-state write
   35 |    transaction. Bound bytes, time, redirects, and parser resources.
   36 | 3. Store content by digest and commit metadata in a short transaction.
   37 | 4. Parse/index asynchronously. Record parser version, warnings, and an output
   38 |    digest. Failed parsing remains visible and retryable.
   39 | 5. Let a human or agent propose a cited draft note/decision. Draft review and
   40 |    Git publication are a separate memory-entry lifecycle. Source text does
   41 |    not become an authoritative claim merely because it was parsed.
   42 | 6. Publish reviewed memory through the Git publication workflow in
   43 |    [MEMORY_BANK.md](MEMORY_BANK.md), then index the committed revision.
   44 | 
   45 | The service schedules jobs and records their operation IDs, state, last
   46 | error, retry-not-before, and input revision. It does not hold a SQLite write
   47 | transaction while downloading, parsing, embedding, waiting for a model, or
   48 | committing Git. One failed source does not prevent unrelated work claims or
   49 | status reads.
   50 | 
   51 | ## Provenance and retrieval
   52 | 
   53 | Every derived excerpt points to an exact source version and location (for
   54 | example line, page, byte range, or Git path/revision). Retrieval distinguishes
   55 | raw source, parsed extraction, draft memory, and published memory. It reports
   56 | the index revision and any lag. A stale parser output cannot be published as
   57 | if it described a newer source version.
   58 | 
   59 | Search starts with IDs, metadata filters, and local full-text indexing. Add
   60 | embedding search only after a recall/precision benchmark and a clear
   61 | reindexing policy. A context pack is generated on demand with a byte/token
   62 | budget, source citations, and revision; it is not a new source of truth.
   63 | 
   64 | ## Integration with work
   65 | 
   66 | Tasks may reference source or published-memory IDs. Evidence may reference a
   67 | source version or a Git snapshot. The source engine never copies live task
   68 | status into memory files. Work completion cannot silently promote a draft
   69 | into published memory; promotion is an explicit reviewed operation.
   70 | 
   71 | ## Tests
   72 | 
   73 | Concurrent ingest of the same source, changed bytes at the same URI, restart
   74 | and metadata reload, parser crash and retry, missing blob, stale citation, unsafe path/URI, project scope
   75 | isolation, large-source backpressure, and Git publication during three active
   76 | workers. Measure ingest throughput separately from claim/read latency.
````
