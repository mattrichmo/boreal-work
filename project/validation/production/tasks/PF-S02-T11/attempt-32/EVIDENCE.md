# PF-S02-T11 — attempt 32 verifier bridge evidence

## Disposition

**Operation-identity and witnessed closeout validation repairs implemented; bounded validation passes.**

The verifier admission operation is now separated from receipt insertion:

- `EvidenceExecution` and receipt insertion retain the user operation ID.
- The verifier `OperationRecord`, `AuditEventRecord`, and external job use
  `verifier:<user-operation-id>`.
- Verifier readback and reconciliation use that same verifier operation ID,
  while the durable job ID remains `verifier:<user-operation-id>`.

The earlier `admitted -> running -> side_effect_started -> readback_required ->
reconciled` transition repair remains in place, and receipt operation semantics
were not changed.

## Verification

Passed, exact CLI tests:

- `service::tests::operation_readback_includes_the_durable_receipt_payload`
- `service::tests::witnessed_run_finish_reads_back_receipt_and_reaches_closeout_diagnostics`
- `service::tests::service_evidence_run_retains_failure_and_replays_the_receipt`
- `service::tests::unavailable_v3_service_routes_are_rejected_without_schema_mutation`

The witnessed durable-receipt validator now runs before project identity lookup
for finish requests. Foreign, missing, or mismatched witnessed receipt facts
therefore fail closed as `ReceiptInvalid`; the project identity context is
still validated before submit, summary, or close mutations.

Compile check passed:

```text
cargo check -p boreal-application -p boreal-store -p boreal-cli --bin bwrk
```

`git diff --check` passed for the owned source paths. The compile emitted only
pre-existing CLI warnings about an unused variable, unused update variants,
and unused update helper functions.

## Source hashes

- `crates/application/src/evidence_store.rs`
  `6aac778c525d860bef9f37abd43efe50caaec25c`
- `crates/cli/src/service.rs`
  `b2d957904aa71a0ea572e90cbe9b2d9f230beeaf`
- Validation source snapshot: `HEAD 0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
