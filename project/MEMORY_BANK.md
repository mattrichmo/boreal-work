# App memory and the Git memory bank

The memory bank is a product feature, not a logging afterthought. It provides
durable project context that agents can retrieve with citations and humans can
review in Git. It must not mirror mutable task status or reservations.
The memory files belong to each managed project's dedicated memory branch/
worktree, not to the Boreal v2 application source repository.

## Three scopes

| Scope | Examples | Canonical home | Retention |
| --- | --- | --- | --- |
| Runtime scratch | current tool, recent output cursor, transient model context | service memory or bounded cache | disposable; not used for audit |
| Operational app memory | attempts, checkpoints, receipts, source intake state, work-linked context | SQLite + immutable blobs | durable according to explicit policy |
| Published project memory | curated notes, decisions, source citations, project principles | versioned files in Git | Git history; indexed in SQLite |

The first release is project-scoped. Cross-project sharing requires explicit
import/grant semantics later; it must not happen through a global implicit
search index. A runtime scratch entry may be compacted, but a failed attempt
or evidence receipt is not scratch and cannot disappear with it.

## Recommended publication model

Treat Git as authoritative for **published curated memory**, and SQLite as
authoritative for live work, attempts, source intake, publication jobs, and
the searchable index. This is a deliberate two-stage boundary:

1. Capture a raw source version immutably with stable ID, digest, URI/path,
   media type, observed time, and access scope. A parser can work outside a DB
   transaction.
2. Create a draft note/decision that cites exact source versions. Review,
   merge, or reject it without changing published memory.
3. Publish through one serialized Git writer in a dedicated memory branch/
   worktree, away from agents' source-code worktrees. Write deterministic
   Markdown and a manifest, commit the publication, then record the Git
   revision in the publication job. A staged or uncommitted edit is a draft,
   not published memory. Recovery checks
   the job/manifest identity before retrying; it never invents a second
   publication after an uncertain outcome.
4. Index the published Git revision in SQLite. Retrieval returns the memory
   entry ID, source citation, content digest, Git revision, and index revision.

This avoids requiring a Git commit for every task claim while keeping curated
memory reviewable, diffable, and portable. It does introduce a publication
boundary: a draft is not published knowledge, and a successful DB transaction
is not proof that a Git commit happened. The API must show `draft`,
`publishing`, `published`, or `failed` explicitly.

If the product ultimately needs Git merely as backup/export, a DB-canonical
memory model is simpler. This choice is provisional and should be settled
before implementing publication. In either model, do not try to make a SQLite
transaction and a Git commit appear atomic. Use an idempotent job/outbox and
an explicit committed revision.

## Git layout proposal

```text
.boreal-memory/
  manifest.json
  sources/<source-id>.json
  notes/<entry-id>.md
  decisions/<entry-id>.md
```

The exact directory can change, but IDs and content digests must not depend on
filenames or titles. Frontmatter contains schema version, ID, project scope,
source-version citations, author/actor, created/updated time, and related
work IDs. It does not contain the live status of referenced work.

Raw source bytes and large outputs need not be committed to Git by default;
the manifest names their content digests and an export policy. A portable
backup must include any referenced blobs required for full restoration, or
mark them explicitly unavailable. Never claim an index is complete if source
bytes were excluded.

## Retrieval

Start with deterministic filters, exact IDs, and local full-text search.
Semantic/embedding search is an optional derived index. Return compact cited
excerpts, not an unbounded context dump. A memory hit reports whether it came
from published Git memory, draft operational context, or raw source intake.
Agents can request a bounded context pack for a task, but the pack is a
revisioned view, not another authoritative record.

Raw source text is data, not an instruction to Boreal or the agent harness.
Retrieval names source trust/authority separately from relevance. A model may
summarize a source, but publication still requires a cited review operation.

An external Git edit to the memory branch is imported as a new published
revision after schema, ID, citation, and path validation. Conflicting edits
become a visible import conflict; the service never silently overwrites human
changes. The Git writer uses its own short lock/queue, independent of
work-state transactions.

## First memory tests

- Ingest a source and cite the exact immutable version in a note.
- Promote a draft to published memory with a Git revision, then rehydrate on a
  fresh clone using the manifest and included blobs.
- Retry a publication after a crash between file write, Git commit, and DB
  acknowledgement without creating duplicate entries.
- Reject stale/unsupported citations and report missing source bytes.
- Keep project scopes isolated; no accidental cross-project retrieval.
- A large ingest or Git commit does not increase work-claim transaction hold
  time.
