# Agent Directive Legacy Backfill

This note defines how historical closeout records move into the directive-aware model without inventing agent actions that did not happen.

## Backfill Boundary

Modern directive coverage is a durable `DirectiveAcknowledgementRecord` linked to at least one real proof record:

- the closeout summary ID;
- evidence IDs;
- verification IDs;
- the summary artifact URI;
- a handoff or summary ID used as handoff context.

A backfill may create a durable acknowledgement only when the original directive identity and proof context are available from trusted command output, a preserved result spool, or another durable record. If the directive ID, bundle source, or agent action would have to be guessed, the record must stay legacy-compatible instead of being modernized.

## Doctor Classifications

`bwrk doctor --json` exposes the migration boundary through separate diagnostics:

- `summary.directive_coverage`: current-policy closeout summaries that have no durable directive acknowledgement proof. This is advisory under strict mode until legacy migration/backfill is complete.
- `summary.legacy_directive_compatibility`: closeout summaries that are intentionally legacy-compatible because they predate directive acknowledgement policy or are explicitly marked with `legacy_backfill`.
- Existing legacy diagnostics such as `summary.legacy_closeout_coverage`, `summary.legacy_checkpoint_coverage`, and `summary.legacy_artifact_coverage` continue to identify older summary/checkpoint/artifact gaps.

## Safe Modernization

Use `bwrk directives ack create <directive-id>` only when all of these are true:

- the directive ID came from an actual `agentDirectives` bundle;
- the bundle source fields are known: registry version, command path, generated time, and source hash when available;
- the acknowledgement outcome can be stated truthfully;
- every referenced evidence, verification, summary, artifact URI, or handoff exists in the current workspace.

The command should link concrete proof with flags such as `--summary`, `--evidence`, `--verification`, `--artifact-uri`, and `--handoff`. The reason text should explain why the historical action satisfies, defers, or cannot satisfy the directive.

## Legacy-Only Records

Leave a record legacy-only when any of these are true:

- no original directive bundle or directive ID is available;
- the agent action was completed before directive acknowledgement policy existed;
- the closeout was created by `summary backfill` or carries a `legacy_backfill` force or dirty-path reason;
- the summary, evidence, verification, or artifact only proves the work outcome, not that the agent saw and acknowledged a directive.

Legacy-only records are not errors by themselves. They are explicit migration facts that prevent fabricated acknowledgements while keeping older closeout data readable.

## Backfill Workflow

1. Run `bwrk sync refresh --json` and `bwrk doctor --strict --json`.
2. Read `summary.directive_coverage` and `summary.legacy_directive_compatibility`.
3. For each current-policy gap, search for preserved command output or result spools that contain the original directive bundle.
4. Create acknowledgements only for records with real directive identity and proof links.
5. Leave the rest classified by doctor as legacy-compatible or document why they cannot be safely modernized.
