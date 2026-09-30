# CLI workflow reference

These commands use the project store and application APIs. Read commands return bounded pages; `--out` writes a new, confined file in the project workspace and does not modify canonical records.

## Discover work

```text
bwrk prime --project PROJECT [--json]
bwrk work list --project PROJECT [--all] [--status STATUS[,STATUS...]] [--kind KIND] [--container WORK_ID] [--query TEXT] [--label LABEL] [--limit N] [--offset N] [--json]
bwrk work ready --project PROJECT [same filters]
bwrk work parallel --project PROJECT [same filters]
bwrk work recent-closed --project PROJECT [same filters]
bwrk work review-candidates --project PROJECT [same filters]
bwrk work next --project PROJECT [same selector filters]
bwrk work labels set --project PROJECT WORK_ID [--labels LABEL[,LABEL...]] --expected-revision N
```

Discovery reads a full, stable project status snapshot, applies filters, then paginates. `--label` and `--labels` can be repeated or contain comma-separated values; a work item must match every requested label. Labels are lowercased and deduplicated when set. `ready` and `parallel` only return actor-claimable tasks. `recent-closed` orders by the latest close event. `prime` includes status, contextual guidance, and the embedded workflow index; it fails if those reads observed different project revisions.

## Summary and handoff

```text
bwrk summary list --project PROJECT [--work WORK_ID] [--limit N] [--offset N] [--json]
bwrk summary show --project PROJECT SUMMARY_ID [--json]
bwrk summary render --project PROJECT SUMMARY_ID [--out PATH] [--json]
bwrk summary compose --project PROJECT --work WORK_ID [--body NOTE]
bwrk summary create --project PROJECT --work WORK_ID (--body TEXT | --input PATH) --attempt ATTEMPT_ID --fence N --expected-revision N
bwrk summary backfill --project PROJECT --input PATH --expected-revision N --yes
bwrk summary backfill show --project PROJECT IMPORT_ID
bwrk handoff compose --project PROJECT --work WORK_ID [--note TEXT] [--out PATH]
bwrk handoff show --project PROJECT --work WORK_ID [--out PATH]
```

`summary compose` assembles a current work briefing; optional `--body` adds literal context under an “Additional context” heading (`--note` is also accepted). `summary create` records durable, immutable body content with its digest and size in the same transaction as summary metadata; `--body` is literal text and `--input` reads bounded UTF-8 Markdown or text from a project-confined file. Creation requires the current attempt owner, session, fence, and expected revision. `summary backfill` imports legacy metadata without making it eligible as proof. Handoff composes from the latest saved summary when available, otherwise from current work context; `--note` appends session-specific context.

List/show return saved body content. Render and handoff `--out` create a new file under the project root and refuse to overwrite an existing file. Saved summary bodies remain in canonical storage; rendered files are convenience artifacts.

## Templates

```text
bwrk template list --project PROJECT
bwrk template show --project PROJECT TEMPLATE_ID
bwrk template validate --project PROJECT --input PATH [--var NAME=VALUE]
bwrk template run --project PROJECT TEMPLATE_ID [--var NAME=VALUE] [--apply --prefix ID --expected-revision N --yes]
bwrk template run --project PROJECT --input .boreal/templates/NAME.json [--var NAME=VALUE] [--apply --prefix ID --expected-revision N --yes]
bwrk template capture --project PROJECT --work WORK_ID --out .boreal/templates/NAME.json
```

Project templates are versioned JSON assets in `.boreal/templates/`. Each item can set `dependencies` (prerequisite item keys), `labels`, and `acceptance_profile` (`focused` or `reviewed`, default `focused`). Dependencies use close-only policy; unknown keys and dependency cycles fail validation. `list` includes built-ins and validated project assets; IDs cannot shadow a built-in or another asset. `validate` checks the schema and reports declared parameters. `run` substitutes supplied variables and first returns a dry-run plan; applying requires an explicit `--apply --yes`, an expected project revision, and a generated work ID prefix. The full hierarchy, dependency graph, labels, and acceptance profiles are validated before writes and persisted in one canonical transaction. `--dry-run` cannot be combined with `--apply`. Capture preserves parent/dependency links, labels, and focused/reviewed profiles, and rejects partial dependency graphs. It writes a new template file and never overwrites an existing one.

## Trusted directives

```text
bwrk directives list --project PROJECT
bwrk directives show --project PROJECT DIRECTIVE_ID
bwrk directives compile --project PROJECT [--work WORK_ID]
bwrk directives render --project PROJECT [--work WORK_ID]
bwrk directives ack create --project PROJECT DIRECTIVE_ID --expected-revision N
bwrk directives ack list --project PROJECT [--limit N] [--offset N]
bwrk directives ack show --project PROJECT ACK_ID
```

Only directives in the versioned trusted registry can be acknowledged. An acknowledgement records that the instruction was seen; it does not satisfy a gate or grant authority. `compile` and `render` use current contextual guidance and action descriptors.

## Bounded history and exports

```text
bwrk work history --project PROJECT WORK_ID [--limit N] [--offset N]
bwrk operation list --project PROJECT [--limit N] [--offset N]
bwrk operation stats --project PROJECT
bwrk export json --project PROJECT [--limit N] [--offset N] [--out PATH]
bwrk export markdown --project PROJECT [--limit N] [--offset N] [--out PATH]
```

Work history applies the work filter before offset and limit. Exports include a bounded work page, operation page, and observed revision; they are generated files, not canonical project writes.
