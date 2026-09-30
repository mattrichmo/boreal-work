# Maintenance commands

These commands are review-first tools for finding exact duplicates and
publishing versioned summaries. They preserve work, source, draft, review,
attempt, and published memory history.

## Find duplicates

```sh
bwrk duplicate scan --project PROJECT --limit 1000 --json
```

The scan takes one bounded SQLite snapshot for work, source versions,
decisions, claims, and memory drafts. It groups only identical normalized
content within the same record kind. Groups are sorted by kind and stable
identity digest. If the requested per-kind bound would truncate records, the
command asks for a higher `--limit` instead of returning a partial scan. When `memory/manifest.json`
exists, the CLI separately validates the committed Git manifest and notes and
adds exact content-digest groups for published memory with their Git revision.
An invalid or dirty publication checkout is reported as an error, not treated
as an empty scan.

## Review and apply a merge relationship

Create a JSON file inside the selected project, such as `merge.json`:

```json
{
  "source_kind": "work",
  "source_id": "task-copy",
  "canonical_kind": "work",
  "canonical_id": "task-main"
}
```

Then build and review the plan:

```sh
bwrk merge plan --project PROJECT --input merge.json --json
```

The plan returns a digest bound to the project revision, both endpoint
identities, and their content digests. Apply that exact plan:

```sh
bwrk merge apply --project PROJECT --input merge.json \
  --plan PLAN_DIGEST --expected-revision REVISION --yes --json
```

Inspect either side of a recorded relationship with the same `merge.json`:

```sh
bwrk merge show --project PROJECT --input merge.json --json
```

Merge apply requires operator authority. For SQLite work records it appends an immutable
alias/supersession relationship. It does not cancel or close either work item,
redirect existing references, alter a source or memory file, or transfer
acceptance evidence. A work endpoint with a current attempt blocks the merge.
If any project revision or endpoint identity changed after planning, create a
new plan.

Published Git entries can be consolidated through the reviewed memory
publication boundary. The plan reports the committed Git revision, manifest
identity, and both note digests. Add the operator-authored consolidated text
and copy the manifest fields and digests from that plan into the apply input:

```json
{
  "source_kind": "published_memory",
  "source_id": "entry-old",
  "canonical_kind": "published_memory",
  "canonical_id": "entry-main",
  "source_revision": 42,
  "source_digest": "SOURCE_DIGEST_FROM_PLAN",
  "canonical_digest": "CANONICAL_DIGEST_FROM_PLAN",
  "source_citations": ["SOURCE_VERSION_ID_1", "SOURCE_VERSION_ID_2"],
  "git_revision": "GIT_REVISION_FROM_PLAN",
  "manifest_identity": "MANIFEST_IDENTITY_FROM_PLAN",
  "merged_body": "Reviewed consolidated content with the claims to retain.",
  "title": "Consolidated knowledge",
  "review_reason": "Why this consolidation should be published."
}
```

Apply creates a new cited SQLite draft whose text records the exact superseded
entry IDs and Git revision. It returns `awaiting_independent_review`; it does
not claim that the entries have merged or been published. Use the returned
draft ID for an independent `memory review`, then publish the approved review
with the exact manifest identity returned by apply. The normal publisher
commits a new version, while both old notes and their Git history remain
intact. Source citations carry into the new draft and must still resolve to
available registered sources.

## Analyze and apply a compaction summary

```sh
bwrk compact analyze --project PROJECT --minimum-bytes 2048 --limit 1000 --json
```

Analysis lists retained SQLite content and validated published Git notes above the selected size threshold and
returns a plan digest per exact source identity. It never generates or
publishes summary prose. Add a reviewed summary to a JSON input file using the
candidate's exact fields:

```json
{
  "source_kind": "memory_draft",
  "source_id": "draft-123",
  "source_revision": 42,
  "source_digest": "SOURCE_DIGEST_FROM_ANALYSIS",
  "summary": "A concise, source-cited summary that retains the important claims."
}
```

```sh
bwrk compact apply --project PROJECT --input compact.json \
  --plan PLAN_DIGEST --expected-revision REVISION --yes --json
```

Read the summary history for that source with `bwrk compact show --project
PROJECT --input compact.json --limit 20 --offset 0 --json`. The read is
revision-consistent and paginated; raise `--offset` using `summary_next_offset`
to read older versions. The newest summary is identified by
`current_summary_id` only when its source digest still matches the current
source. Older versions remain available in the history. For a
`published_memory` candidate, apply input must also include its `git_revision`
`manifest_identity`, `source_citations`, and `source_revision` from analysis.
The `summary` becomes a new cited draft
recording which entry at which Git revision it supersedes. Apply reports
`awaiting_independent_review`; use the returned draft ID for an independent
`memory review`, followed by normal `memory publish` using the returned
manifest identity. This publishes through the durable publication job and
Git publisher. The prior note stays in repository history.

Compaction apply requires operator authority. The result stores a new immutable summary version bound to the source revision
and digest. It rejects active work attempts. It does not overwrite the source
or historical work content and does not claim to reduce storage. Source
versions are omitted from compaction because their retained record contains
only provenance and a content digest, not the original text. Published-note
compaction preserves registered source citations and uses the validated
manifest and committed Git revision as its source identity.

## Initialize project memory

```sh
bwrk memory init --project PROJECT --json
```

`bwrk vault init` is an exact alias. Both create `memory/notes/` and add
`memory/index.md` only when it is missing. They leave existing files alone.
The first verified memory publication creates the manifest.

## Durability and retry behavior

SQLite merge lineage and compaction summaries use the normal revision-checked
application/store mutation boundary and immutable operation journal.
Published-memory apply durably records a cited draft before independent
review; its body binds the pending supersession to the exact note IDs and Git
revision. A
mutation needs `--expected-revision` and `--yes`; repeat the exact operation
identity to read back the original result. Plans are data for operator review,
not authority to bypass actor permissions or the fresh revision check.
