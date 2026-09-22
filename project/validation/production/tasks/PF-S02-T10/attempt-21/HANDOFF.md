# PF-S02-T10 status-batching remediation — attempt 21 handoff

## Status

**Ready for independent review; not accepted.**

The 762-prepared-statement status-snapshot regression is fixed by a single
project-scoped planning-facts loader. The loader is guarded when the v3
planning tables are absent, keyed by work identity, and consumed by the
existing snapshot decoder. Cycle assignment activation behavior and project
filtering remain in the SQL source of truth. Malformed per-work activation
values still become row diagnostics rather than hiding valid siblings.

Latest focused rerun: `status_gate_queries_are_batched_for_large_projects`
passed **1/1** (`0 failed`, `14 filtered out`) on the final handoff tree.

## Validation

All requested store-scoped checks passed on the final source revision:

- exact `status_gate_queries_are_batched_for_large_projects`: **1 passed**;
- full `storage_remediation`: **15 passed**;
- full `boreal-store`: **all targets passed**;
- strict all-target store Clippy: **passed**;
- Rust formatting: **passed**;
- contract validator: **passed**;
- `git diff --check`: **passed**.

## Deliberately not claimed

- PF-S02-T10 task acceptance;
- recovery/resource acknowledgement completion;
- application or CLI acceptance;
- full workspace or real-service acceptance;
- release or production cutover.

The attempt did not edit plan/state, commit, or push. Review the integration
requests before updating any ledger disposition.
