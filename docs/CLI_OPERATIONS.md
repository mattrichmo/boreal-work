# Ownership, backups and diagnostic logs

Project selection uses the initialized current folder. `--project` verifies
that identity; it does not select another project's database.

## Reservations and ownership

`bwrk reservation list --json` combines canonical attempt leases and resource
reservations. Filter with `--owner ACTOR`, `--work ID`, and `--status`; paginate
with `--limit` (1–500) and `--offset`. Persisted lease state is not proof that a
process is alive. Deadlines and recovery requirements remain visible through
canonical status and recovery commands.

`bwrk lock inspect --json` reads project runtime ownership metadata and probes
existing OS advisory locks without changing their files. It also reports up to
100 unresolved recovery obligations. Metadata alone is not liveness proof;
unsupported lock probes are `unknown`. Use `recovery list` and identity-bound
`recovery resolve` to reconcile expired attempts and resource ownership.
There is no force-break command for live ownership.

## Recovery browsing

`bwrk snapshot list --limit 100 --offset 0 --json` lists the durable backup
journal, including incomplete effects. `bwrk snapshot show SNAPSHOT_ID --json`
reads a committed backup's manifest, validates its format and selected project,
and reports its lineage. Snapshot IDs are backup operation IDs. Browse
incomplete entries through `maintenance show`. Showing a manifest does not
revalidate every byte of the packaged database; restore performs those checks.
Existing explicit `backup` and `restore` own artifact creation and restoration.

## Diagnostic log rotation

```sh
bwrk storage rotate-log --input .boreal/logs/runner.log \
  --max-bytes 1048576 --expected-revision REV --yes --json
```

Only diagnostic `.log` files under `.boreal/logs/` qualify. Canonical SQLite
operations, audit events, evidence and JSONL histories are never rotated or
pruned by this command. Rotation is admitted with an operator session and
revision before the filesystem effect starts. The archive name is bound to
the operation ID, and readback is stored in the maintenance journal. Successful
exact retries return the committed result. Interrupted admitted effects require
inspection of the journal and files; they are never blindly repeated. Writers
with an old open file descriptor must reopen the live log and may continue
writing to the retained archive until they do so.

`operation prune` and `ledger delete` are retired behaviors. Explicit lifecycle
retirement and revocation preserve canonical history; derived projections can
be rebuilt without deleting their sources.

Lock inspection examines at most 500 directory entries and reports `truncated`
when the bound is reached. An interrupted diagnostic log rotation records a
`readback_required` maintenance state where journaling remains available; inspect
the original and archive paths before reconciliation.
