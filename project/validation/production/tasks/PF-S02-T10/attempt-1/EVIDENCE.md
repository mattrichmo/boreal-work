# PF-S02-T10 — attempt 1 evidence

## Disposition

**Blocked / awaiting coordinator integration.** This attempt was stopped at the
requested scope checkpoint before the canonical integration could be safely
completed. It does not accept PF-S02-T10.

## Observed source identity

```text
HEAD: 784a41b3802c29a76721c55eef2e9493283396c2
crates/store/src/lib.rs: b9febd62257e36c1ae691fcf76e1610dcbce2efc606c0bb8d83d69f1c4cb7420
project/spec/schema-production.sql: 3fd0d323955cf4d52ec06cf366fdf7abe47ac0a27b4ac2768492b5835095e1cf
```

The two production source files retain their pre-attempt hashes. A temporary
schema addition was tested as a probe, exposed a fresh-open identity failure,
and was removed before handoff. The only files added by this attempt are the
evidence records in this directory.

## Findings reproduced

1. The current production opener detects the additive identity/recovery/job
   modules, but the required persistence is still first-use/lazy integration;
   the ordered migration payload and fresh schema are not yet updated as one
   contract.
2. `create_work` still persists an empty `{}` profile definition and derives a
   placeholder digest, so observed gate rows remain the effective requirement
   source.
3. Root operation append paths do not yet guarantee identity-bound operation
   context and audit bundling across all canonical mutations.
4. The durable recovery/job primitives are not yet connected to expiry,
   uncertain-stop, release, or external-adapter root transactions.

## Validation limits

The rerun store migration and store-contract targets passed after the probe was
reverted. Those passes validate the existing combined tree only; they do not
prove the missing T10 behavior. The contract validator and formatting/diff
checks passed. No real service lifecycle or release claim is made.
