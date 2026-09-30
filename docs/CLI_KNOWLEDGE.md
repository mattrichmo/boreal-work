# Knowledge, context, and intake CLI

These commands are project scoped. Reads return a `revision` so a caller can
associate the result with a consistent project snapshot. Mutations require
`--yes` and `--expected-revision`; they also accept the normal actor, session,
and operation identity options. `--input` reads a JSON object from a path
confined to the selected project root.

## Decisions

```text
boreal decision create PROJECT [DECISION_ID] --title TEXT --body TEXT --reason TEXT [--source-version ID] [--supersedes ID] --yes --expected-revision N
boreal decision supersede PROJECT PRIOR_DECISION_ID [--input FILE] --title TEXT --body TEXT --reason TEXT [--source-version ID] --yes --expected-revision N
boreal decision list PROJECT [--limit N] [--offset N]
boreal decision show PROJECT DECISION_ID
```

The JSON input keys are `decision_id`, `title`, `body`, `rationale`, optional
`source_version_id`, and optional `supersedes_id`. A decision is immutable;
superseding creates a new decision linked to the prior one.

## Cited knowledge claims

```text
boreal knowledge claim create PROJECT [CLAIM_ID] --input FILE --yes --expected-revision N
boreal knowledge claim list PROJECT [--limit N] [--offset N]
boreal knowledge claim show PROJECT CLAIM_ID
boreal knowledge claim review PROJECT CLAIM_ID --decision accepted|rejected|needs_revision --reason TEXT --yes --expected-revision N
```

Claim JSON keys: `claim_id`, `statement`, `source_version_id`,
`citation_location`, optional `supersedes_id`. The source must belong to the
same project and be available. Claims retain a content digest and immutable
review history.

## Context and search

```text
boreal knowledge context show PROJECT [--work WORK_ID] [--query TEXT] [--limit N]
boreal knowledge context search PROJECT --query TEXT [--work WORK_ID] [--limit N]
boreal knowledge context rebuild PROJECT
boreal search query PROJECT --query TEXT [--limit N]
boreal search index PROJECT
```

Context combines current work and acceptance profiles, dependency/evidence
facts, sources, decisions, claims and reviews, intake, operational memory,
source retrieval, and published Git memory when available. Search results
preserve source citations and identify their source/index revisions. Rebuild
refreshes the operational projection and available source and published-memory
indexes; all are derived data and can be regenerated.

## Intake

```text
boreal intake promote PROJECT INTAKE_ID --target-kind draft_work|source_version|memory_draft --target-id ID --yes --expected-revision N
boreal intake disposition PROJECT INTAKE_ID --state captured|triaged|deferred|resolved|archived [--revisit-at-ms UNIX_MS] --yes --expected-revision N
```

Promotion captures the current intake content revision and digest, validates
the project-local target, and stores a replayable promotion record. Disposition
changes pass through the typed intake lifecycle planner; deferral requires a
valid revisit time.

### Atomic intake-to-work promotion

`bwrk intake promote --project PROJECT INTAKE_ID --target-kind draft_work
--target-id WORK_ID --create-work --expected-revision N --yes` creates work
and its intake provenance in one transaction. Optional `--input PATH` supplies
project-confined JSON fields `title`, `description`, `kind`, `parent`, `priority`,
`dispatch`, and `acceptance_profile` (`focused` or `reviewed`). Defaults are a
focused task using the intake content. Without `--create-work`, the target must
already exist in the same project.
