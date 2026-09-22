# R-MEMORY-DOC — project/MEMORY_BANK.md

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `project/MEMORY_BANK.md:L1–L105`  
**File SHA-256:** `5ffc775e4e9fa845563d9b6759b90a7b53a41d2711f39923c6934fa9d6c83dad`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Curated Git memory, live drafts, publication jobs, reconciliation and citations.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,105p' 'project/MEMORY_BANK.md'
```

## Exact baseline excerpt

````text
    1 | # App memory and the Git memory bank
    2 | 
    3 | The memory bank is a product feature, not a logging afterthought. It provides
    4 | durable project context that agents can retrieve with citations and humans can
    5 | review in Git. It must not mirror mutable task status or reservations.
    6 | The memory files belong to each managed project's dedicated memory branch/
    7 | worktree, not to the Boreal v2 application source repository.
    8 | 
    9 | ## Three scopes
   10 | 
   11 | | Scope | Examples | Canonical home | Retention |
   12 | | --- | --- | --- | --- |
   13 | | Runtime scratch | current tool, recent output cursor, transient model context | service memory or bounded cache | disposable; not used for audit |
   14 | | Operational app memory | attempts, checkpoints, receipts, source intake state, work-linked context | SQLite + immutable blobs | durable according to explicit policy |
   15 | | Published project memory | curated notes, decisions, source citations, project principles | versioned files in Git | Git history; indexed in SQLite |
   16 | 
   17 | The first release is project-scoped. Cross-project sharing requires explicit
   18 | import/grant semantics later; it must not happen through a global implicit
   19 | search index. A runtime scratch entry may be compacted, but a failed attempt
   20 | or evidence receipt is not scratch and cannot disappear with it.
   21 | 
   22 | ## Recommended publication model
   23 | 
   24 | Treat Git as authoritative for **published curated memory**, and SQLite as
   25 | authoritative for live work, attempts, source intake, publication jobs, and
   26 | the searchable index. This is a deliberate two-stage boundary:
   27 | 
   28 | 1. Capture a raw source version immutably with stable ID, digest, URI/path,
   29 |    media type, observed time, and access scope. A parser can work outside a DB
   30 |    transaction.
   31 | 2. Create a draft note/decision that cites exact source versions. Review,
   32 |    merge, or reject it without changing published memory.
   33 | 3. Publish through one serialized Git writer in a dedicated memory branch/
   34 |    worktree, away from agents' source-code worktrees. Write deterministic
   35 |    Markdown and a manifest, commit the publication, then record the Git
   36 |    revision in the publication job. A staged or uncommitted edit is a draft,
   37 |    not published memory. Recovery checks
   38 |    the job/manifest identity before retrying; it never invents a second
   39 |    publication after an uncertain outcome.
   40 | 4. Index the published Git revision in SQLite. Retrieval returns the memory
   41 |    entry ID, source citation, content digest, Git revision, and index revision.
   42 | 
   43 | This avoids requiring a Git commit for every task claim while keeping curated
   44 | memory reviewable, diffable, and portable. It does introduce a publication
   45 | boundary: a draft is not published knowledge, and a successful DB transaction
   46 | is not proof that a Git commit happened. The API must show `draft`,
   47 | `publishing`, `published`, or `failed` explicitly.
   48 | 
   49 | If the product ultimately needs Git merely as backup/export, a DB-canonical
   50 | memory model is simpler. This choice is provisional and should be settled
   51 | before implementing publication. In either model, do not try to make a SQLite
   52 | transaction and a Git commit appear atomic. Use an idempotent job/outbox and
   53 | an explicit committed revision.
   54 | 
   55 | ## Git layout proposal
   56 | 
   57 | ```text
   58 | .boreal-memory/
   59 |   manifest.json
   60 |   sources/<source-id>.json
   61 |   notes/<entry-id>.md
   62 |   decisions/<entry-id>.md
   63 | ```
   64 | 
   65 | The exact directory can change, but IDs and content digests must not depend on
   66 | filenames or titles. Frontmatter contains schema version, ID, project scope,
   67 | source-version citations, author/actor, created/updated time, and related
   68 | work IDs. It does not contain the live status of referenced work.
   69 | 
   70 | Raw source bytes and large outputs need not be committed to Git by default;
   71 | the manifest names their content digests and an export policy. A portable
   72 | backup must include any referenced blobs required for full restoration, or
   73 | mark them explicitly unavailable. Never claim an index is complete if source
   74 | bytes were excluded.
   75 | 
   76 | ## Retrieval
   77 | 
   78 | Start with deterministic filters, exact IDs, and local full-text search.
   79 | Semantic/embedding search is an optional derived index. Return compact cited
   80 | excerpts, not an unbounded context dump. A memory hit reports whether it came
   81 | from published Git memory, draft operational context, or raw source intake.
   82 | Agents can request a bounded context pack for a task, but the pack is a
   83 | revisioned view, not another authoritative record.
   84 | 
   85 | Raw source text is data, not an instruction to Boreal or the agent harness.
   86 | Retrieval names source trust/authority separately from relevance. A model may
   87 | summarize a source, but publication still requires a cited review operation.
   88 | 
   89 | An external Git edit to the memory branch is imported as a new published
   90 | revision after schema, ID, citation, and path validation. Conflicting edits
   91 | become a visible import conflict; the service never silently overwrites human
   92 | changes. The Git writer uses its own short lock/queue, independent of
   93 | work-state transactions.
   94 | 
   95 | ## First memory tests
   96 | 
   97 | - Ingest a source and cite the exact immutable version in a note.
   98 | - Promote a draft to published memory with a Git revision, then rehydrate on a
   99 |   fresh clone using the manifest and included blobs.
  100 | - Retry a publication after a crash between file write, Git commit, and DB
  101 |   acknowledgement without creating duplicate entries.
  102 | - Reject stale/unsupported citations and report missing source bytes.
  103 | - Keep project scopes isolated; no accidental cross-project retrieval.
  104 | - A large ingest or Git commit does not increase work-claim transaction hold
  105 |   time.
````
