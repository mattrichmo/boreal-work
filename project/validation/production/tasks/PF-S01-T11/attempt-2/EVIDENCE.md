# PF-S01-T11 attempt 2 — evidence

## Integrated result

The T11 integration contains:

- `project/spec/production/conformance-matrix.json`: 48 unique M02
  obligations, 49 machine-readable vectors (including action, transition,
  close, reopen, restore, carry-over, profile, review, and rollup vectors),
  explicit required-category coverage, stable subjects/classes,
  preconditions, expected outcomes, evidence disposition metadata, owner/gate,
  and contract references;
- `project/spec/production/contract-manifest.json`: production contract
  identity, accepted artifact map/digests, target capabilities, advertisement
  rule, required sprint gates, and shared integration digests;
- the project spec manifest's target contract identities and required paths;
- the protocol manifest's target identities, non-advertisement rule,
  status/2 compatibility rule, and typed quarantine extension;
- the error registry entries for quarantine, bounded source/receipt inputs,
  cleanup reconciliation, credential revocation, and unsupported targets;
- an explicit adoption record in `project/DECISIONS.md` and a status-model
  overlay which preserves the historical v1 description while separating
  target policy from runtime implementation claims.

## Boundaries and limitations

The target capabilities are not advertised as runtime capabilities. The
integration is a contract/oracle change only. It does not claim schema
migrations, Rust service implementation, genuine verifier receipts, native
race/fault evidence, v1 import parity, production installation, signing,
backup/restore, or release publication. Those remain later tasks and gates.

Attempt 1's interrupted worker record is preserved under
`project/validation/production/tasks/PF-S01-T11/attempt-1/`.

Kepler independently rejected the first exact-tree review twice for a stale
digest, dangling vectors, missing machine-readable category/disposition
coverage, and stale evidence wording; those records remain
`REVIEW-KEPLER.md` and `REVIEW-KEPLER-2.md`. After amendment and rerun,
`REVIEW-KEPLER-3.md` accepts the T11 integration artifact boundary. This does
not accept implementation, runtime, migration, native, installer, backup,
signing, release, or the PF-S01 sprint.
