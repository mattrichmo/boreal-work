# PF-S01-T11 attempt 2 — independent review

Reviewer: Kepler  
Decision: **REJECT**  
Review scope: T11 integration artifact boundary only. No implementation, runtime, release, successor, or task-state authorization is made by this review.

## Reviewed boundary

Reviewed the registered T11 combined tree: `conformance-matrix.json`, `contract-manifest.json`, `DECISIONS.md`, `STATUS_MODEL.md`, `spec/manifest.json`, the protocol manifest, the error registry, the attempt-2 evidence records, the PF-S01-T11 card, and the accepted T05/T06/T07/T08/T09/T10 evidence.

## Findings

### 1. Contract-manifest artifact digest is not truthful

The `contract-manifest.json` digest for `project/spec/production/reason-registry.json` does not equal the SHA-256 of the artifact currently present in the combined tree. The recorded digest differs from the computed digest by one hexadecimal character. The listed integration digests do match, but the artifact map is not self-consistent as a whole.

This prevents the contract manifest from being an authoritative identity for the exact reviewed tree.

### 2. Eleven obligation vector references are dangling

The matrix contains 48 unique M02 obligations, all with an unaccepted state, a coverage-task entry, and at least one vector reference. However, these referenced vector IDs have no corresponding entries in the matrix's vector list:

`ACTION-01`, `CARRY-01`, `CLOSE-01`, `OVERRIDE-02`, `PLAN-01`, `PROFILE-02`, `REOPEN-01`, `RESTORE-01`, `REVIEW-04`, `ROLLUP-02`, and `TRANSITION-01`.

Therefore the apparent 48-obligation mapping is not an executable complete oracle. The missing definitions also remove directly inspectable coverage for action/transition/close/reopen/restore/profile/review/rollup paths that T11 is required to integrate.

### 3. Vector evidence disposition is not machine-readable at vector level

The matrix's evidence policy requires an explicit `pass`, `fail`, `unsupported`, or `unmeasured` disposition for each vector. The 38 vector objects contain `id`, `class`, `subject`, `preconditions`, `expected`, `evidence`, `owner_gate`, and `source`, but none contains an explicit disposition/state field. The attempt evidence describes “evidence state,” but that state is not represented on the vector records themselves.

`ORACLE-01` also expects missing owner/evidence state to be rejected, which exposes the same schema gap in the artifact being used as the oracle. A prose policy cannot substitute for the required machine-readable disposition.

### 4. Required category coverage is not explicit or complete

The matrix has useful vectors for status, authorization, races, restart, corruption, isolation, proof, migration, protocol, service, and release. It does not provide an explicit machine-readable category field covering the requested legal/illegal/boundary/race/restart/corruption/status-action/unknown-outcome/isolation/proof/migration/memory/backup/release dimensions. In particular, no vector is explicitly categorized as memory or backup, and the missing vector definitions above include action and transition coverage.

Consequently, category presence cannot be validated from the matrix without inferring semantics from vector IDs, classes, or prose. That is insufficient for T11's conformance-matrix boundary and leaves the memory/backup and several status-action/transition paths unproven at the integration-artifact level.

### 5. Plan/package validation was not completed

`COMMANDS.md` records the plan DAG/package validation as pending final STATE/manifest hash synchronization. The contract validator and JSON/cardinality checks pass, but the recorded evidence does not establish that the plan validator passed against the exact combined tree. T11 acceptance requires coherent plan/contract validation, so this remains an evidence gap even though runtime tests are intentionally deferred.

## Positive checks

- The obligation set counts as 48 unique M02 obligations, and every obligation is marked `unaccepted`.
- Every obligation has a coverage-task entry and at least one vector reference, subject to the dangling-vector defect above.
- `python3 project/spec/validate_contracts.py` is recorded as passing; JSON parsing and the basic 48-obligation/38-vector cardinality checks also pass.
- The protocol manifest retains protocol v2, leaves runtime target capabilities unadvertised, and specifies fail-closed handling for unknown target capabilities.
- The error registry entries are typed and the integrated `integrity_quarantined` entry is assigned to the T11 integration boundary without claiming implementation.
- `DECISIONS.md` and `STATUS_MODEL.md` preserve the target-contract/runtime distinction and do not fabricate Rust, native, service, migration, installer, backup, or release completion.
- The attempt-1 interruption and its evidence are preserved, and the reviewed changes remain within the registered T11 integration/evidence paths.

## Authority limit

This is an independent artifact review only. It does not accept T11, mark any obligation accepted, authorize T90/T91/T92 or any successor, authorize implementation or migration work, advertise target capabilities, or make a service/native/installer/backup/release claim. Runtime and implementation evidence may remain deferred, but the static integration defects above must be corrected and the exact combined tree revalidated before T11 can be accepted.

