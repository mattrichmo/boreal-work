# PF-S03-T08 — remediation attempt 4 integration requests

These are coordinator requests only. This worker did not edit plan/state,
commit, push, or protected implementation paths.

## IR-1 — Rebind the source record to the integrated commit

The worker tested committed `HEAD`
`0d9611a017d5dc167e92fe79e8d65756fbac2d5a`. After the coordinator integrates
the attempt, if `git rev-parse HEAD` differs, update only the T08-owned source
record's `current_source_revision` to the exact final commit and recompute the
`artifact::` SHA-256 values for every changed bound file, including:

- `crates/domain/tests/production_properties.rs`
- `project/validation/production/domain/PF-S03-T08-ORACLE.md`
- each listed domain implementation file if a protected integration changes it
- the normative contract files if their accepted source changes

Then rerun:

```text
cargo test --locked -p boreal-domain --test production_properties -- --nocapture
```

and update attempt-4 `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md` with the
final commit and hashes. A changed domain implementation or contract requires
the corresponding focused/full checks again; no old receipt may be reused.

## IR-2 — Preserve the compatibility boundary

Do not add a public status/3 serializer as part of this evidence integration.
Keep the status/2 projection as `queued` plus the scheduled-start reason and a
denied claim before activation. Any serializer or protocol change requires its
own contract-owner path and review; it is outside this worker's write set.

## IR-3 — Workspace formatting drift

`cargo fmt --all -- --check` remains blocked by unrelated drift in
`crates/cli/src/update.rs` and `crates/memory/tests/publisher.rs`. The owning
workers/coordinator may format those paths separately. This worker must not
repair them or convert the bounded domain receipt into a workspace-wide pass.

## IR-4 — Acceptance boundary

Run the PF-S03-T08 independent review, then the required PF-S03-T90 → T91 →
T92 review/reconciliation/revalidation chain. Pure-domain evidence does not
close service-only T18/I14 behavior or claim task, sprint, or release
acceptance.
