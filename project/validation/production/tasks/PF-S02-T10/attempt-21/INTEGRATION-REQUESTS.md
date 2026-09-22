# PF-S02-T10 status-batching remediation — attempt 21 integration requests

1. Independently inspect the batch query for project scoping, optional-table
   guards, grouped work identity, and earliest activation semantics.
2. Confirm that `read_project_status_in_transaction` removes planning results
   while decoding rows and preserves the existing per-row diagnostic behavior
   when a planning timestamp is corrupt.
3. Re-run the exact batching test, the complete storage-remediation target,
   the full store suite, strict all-target store Clippy, formatting, contract,
   and diff checks on the exact combined source revision.
4. Keep the separate canonical resource acknowledgement/guided-flow failure
   from attempt 20 open; this attempt intentionally does not modify recovery,
   reservation, or application code.
5. Do not mark PF-S02-T10 accepted from this handoff alone. Acceptance still
   requires the combined-tree integration review and the plan's required
   production evidence.
