# PF-S02-T91 attempt 1 — reconciliation record

## Disposition

`bounded_correction_recorded_not_accepted`.

## Reconciled implementation

The coordinator integrated the following bounded corrections at source
revision `be79688ebefcd6004a9f6f60c4b27a8c99ca6e60`:

- direct and socket project commands bind the caller to the local OS
  credential and authenticate it against the stored actor binding;
- backup and restore register durable maintenance jobs, preserve request
  digests, retain nonterminal stages, return readback for exact replay, and
  emit protocol-level unknown/readback-required outcomes for unresolved jobs;
- status snapshots expose canonical entity/proof/session/source/configuration
  facts and integrity diagnostics to the application projection;
- the production oracle no longer self-binds to a tracked commit hash: its
  external manifest binds live source revision and artifact SHA-256 values.

## Validation recorded

- `cargo fmt --all -- --check` — passed
- `cargo test --locked --workspace` with generated external oracle manifest —
  passed
- `cargo test --locked -p boreal-cli --bin bwrk` — 82 passed
- `cargo test --locked -p boreal-cli --test production_backup_restore` — passed
- `cargo build --locked -p boreal-cli --bin bwrk` — passed
- `npm --prefix apps/tui run typecheck` — passed
- `npm --prefix apps/tui test` — 98 passed
- plan validator — passed with zero errors

## Unresolved dispositions

This reconciliation does not accept T90 or PF-S02. The full action descriptor
projection is still fail-closed rather than complete, independent review is
missing, hostile/native/service crash evidence is incomplete, and the broader
PF-S02 leaf evidence chain has not been independently certified. No successor
unlock or release claim is made.
