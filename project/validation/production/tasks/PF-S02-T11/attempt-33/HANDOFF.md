# PF-S02-T11 — attempt 33 handoff

## Disposition

Bounded `finish_close` replay-identity remediation implemented and validated.
Coordinator review is still required before changing the task ledger.

## Changed path

- `crates/cli/src/main.rs`
  - expanded `finish_close_request_digest` to cover the complete typed receipt;
  - added explicit stable names for gate kind, attestation, and result values;
  - hardened `finish_result_readback` against parent/result identity and digest
    mismatches;
  - persisted the parent request digest in the terminal result payload;
  - added focused digest and corrupted-readback tests.

No commit or push was performed. No store core, plan/state/ledger, or
`memory/` files were changed by this remediation lane.

## Next safe action

Have an independent reviewer inspect this exact working-tree file and rerun
the focused closeout/replay tests. Then regenerate the final source-bound
PF-S02-T11 evidence after the coordinator integrates any adjacent changes.
