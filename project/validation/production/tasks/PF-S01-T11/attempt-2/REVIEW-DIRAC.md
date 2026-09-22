# PF-S01-T11 attempt 2 — independent contract integration review

Reviewer: independent review (Dirac)
Scope: registered T11 integration artifacts and attempt-2 evidence only
Kepler review: `REVIEW-KEPLER.md` appeared during the parallel review; it was read
only and was not overwritten.
Decision: REJECTED — bounded T11 integration is not yet internally consistent or fully validated.

## Findings

### T11-2-R1 — Contract manifest artifact digest mismatch [P1]

`project/spec/production/contract-manifest.json` records the SHA-256 for
`project/spec/production/reason-registry.json` as:

```text
fb47a166efc1bcef7b94300e638ff67bf45b24dc1767d4475301525946ce70
```

The current file hashes to:

```text
fb47a166efc1bcef7b94300e638ff67bf45b24dc1767dcd4475301525946ce70
```

The registered artifact map therefore does not bind the exact current
prerequisite contract set. This violates T11’s identity-drift objective and
the required “update contract/schema/protocol/workflow identities together”
instruction. The other checked artifact and integration digests matched, but
that does not make the manifest internally coherent.

Anchors: `contract-manifest.json:23-37`; T11 task card lines 77–82;
`conformance-matrix.json:87-88`; `COMMANDS.md:8-9`.

Required disposition: reconcile the manifest digest against the exact intended
`reason-registry.json` source, rerun identity validation, and preserve the
resulting source/artifact identity.

### T11-2-R2 — Required plan DAG/package validation is still pending [P1]

The attempt evidence explicitly reports plan DAG/package validation as
“pending final STATE/manifest hash synchronization.” T11’s acceptance checklist
requires all references, route names, schemas, task DAG, and independent review
assignments to be validated before releasing the contract candidate, and also
requires focused checks plus the integration layer on the actual combined
source/artifact identity. A pending check is not an accepted result.

Anchors: T11 task card lines 75–92; `COMMANDS.md:3-14`; `HANDOFF.md:10-13`.

Required disposition: complete the read-only DAG/package/state/manifest
validation after resolving R1, record command, revision, digest, and outcome,
and retain any unsupported or failed result rather than converting it to pass.

### T11-2-R3 — Eleven obligation vector references are dangling [P1]

The 48 obligations each have at least one vector reference, but the matrix
does not define these referenced vector IDs: `ACTION-01`, `CARRY-01`,
`CLOSE-01`, `OVERRIDE-02`, `PLAN-01`, `PROFILE-02`, `REOPEN-01`,
`RESTORE-01`, `REVIEW-04`, `ROLLUP-02`, and `TRANSITION-01`. The cardinality
check recorded in `COMMANDS.md` does not validate referential closure, so the
oracle is not executable-complete for those action, transition, close, reopen,
restore, profile, review, and rollup paths.

Anchors: `conformance-matrix.json:7-55,57-95`; `COMMANDS.md:5-7`.

Required disposition: define each referenced vector with the required fields,
or remove/repoint the obligation reference through an attributable reviewed
amendment; then run a referential-closure check.

### T11-2-R4 — Vector-level evidence disposition is not machine-readable [P1]

The matrix policy requires an explicit `pass`, `fail`, `unsupported`, or
`unmeasured` disposition, but the vector objects contain no disposition/state
field. The prose policy and the `ORACLE-01` description do not supply a
machine-readable value that a validator can check.

Anchors: `conformance-matrix.json:3-5,57-95`; `COMMANDS.md:5-8`.

Required disposition: add the required vector-level disposition field/schema
and make the validator reject missing or fabricated states, while preserving
the distinction between target-contract coverage and later runtime evidence.

### T11-2-R5 — Required coverage categories are not explicit [P1]

The matrix has useful classes and subjects, but no machine-readable category
field for the required legal/illegal/boundary/race/restart/corruption,
status-action, unknown-outcome, isolation, proof, migration, memory, backup,
and release dimensions. Memory and backup coverage are not explicitly
represented, and several missing vector definitions overlap action/transition
coverage. Category presence therefore requires inference from IDs or prose.

Anchors: T11 task card lines 77–82; `conformance-matrix.json:57-95`.

Required disposition: add explicit category coverage and validator checks for
the required dimensions, including memory and backup, or record a reviewed
bounded deferral with owner/gate and non-acceptance consequence.

## Observed strengths and bounded checks

- The conformance matrix declares 48 obligations and 38 machine-readable
  vectors with subjects, classes, preconditions, expected outcomes, evidence,
  owner/gate, and source references: `conformance-matrix.json:1-6,57-95`;
  `COMMANDS.md:5-7`.
- Oracle integrity and contract-identity drift are represented as explicit
  vectors rather than hand-edited success labels: `conformance-matrix.json:87-88`.
- The production manifest names the integrated artifact map, target
  capabilities, required gates, and a non-advertisement rule. Runtime
  capabilities remain empty and target writes are gated on implementation,
  migration, real-service/release evidence, and PF-S01-T92:
  `contract-manifest.json:10-21,46-57`.
- The protocol manifest and error registry contain the target-only capability
  policy, fail-closed compatibility behavior, quarantine extension, and the
  T09-derived size/cleanup/credential/unsupported error entries:
  `protocol-manifest.json:22-51`; `error-registry.json:10-17`.
- The adoption record preserves the historical decisions and labels the
  production contracts as target-only rather than claiming runtime support:
  `project/DECISIONS.md:73-95`; `project/STATUS_MODEL.md:16-31`.
- Evidence explicitly disclaims Rust/service, native, migration, installer,
  signing, backup/restore, and release acceptance: `EVIDENCE.md:23-32`;
  `COMMANDS.md:9-14`.
- Attempt 1 is preserved and not used as inferred conformance evidence:
  `START.md:10-15`; `EVIDENCE.md:31-32`.
- The parallel Kepler review independently records the same digest and pending
  validation defects and additionally identifies the dangling references,
  missing vector dispositions, and incomplete category encoding:
  `REVIEW-KEPLER.md:13-41`. It remains a separate review record.

## Boundary decision

Do not accept PF-S01-T11 attempt 2 yet. Reconcile R1 through R5 within the
registered T11 integration/evidence boundary, then obtain a new independent
review. This review does not accept PF-S01 as a sprint, does not authorize
target capability advertisement, and makes no implementation, service,
native, migration, installer, signing, backup/restore, or release claim.
