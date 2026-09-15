# P0-06 contract-review reconciliation

Historical snapshot: `p0-03.v2` · reconciler: coordinator · date: 2026-09-15.
The historical reconciliation is preserved below; the current gate-owner
reconciliation addendum records the working-tree evidence and remaining
provenance blocker.

All finding-producing review records are preserved in
[P0-05-REVIEW.md](P0-05-REVIEW.md). The five implementation findings were
fixed in the combined tree and the baseline/migration limitations were
explicitly deferred with owners rather than weakened.

| Finding | Disposition | Changed artifact | Rerun / follow-up | Gate effect |
| --- | --- | --- | --- | --- |
| R-001 | fixed | `project/spec/cli-contract.json`, `validate_contracts.py` | structural validator; future parser tests in P2-04 | unblocks contract validation |
| R-002 | fixed | `project/spec/schema-v2.sql` | SQLite cross-project FK smoke case | unblocks P1 schema implementation |
| R-003 | fixed | `project/spec/schema-v2.sql`, `protocol/error-registry.json` | self-review trigger smoke case | unblocks review-gate implementation |
| R-004 | fixed | `project/spec/schema-v2.sql` | duplicate normalized gate smoke case | unblocks gate persistence |
| R-005 | fixed | `project/spec/validate_contracts.py`, fixture manifest | semantic validator, JSON parse, SQL execution | P0-07 reruns all |
| R-006 | deferred | `baseline/REPRO_MATRIX.md`, `legacy-map/RECORD_MAPPING.md` | named P0/P5 reproduction/import follow-ups; preserve unmeasured/ambiguous labels | does not block v2 implementation, blocks performance/parity claims |

No `bwrk` records or legacy `.boreal` state were changed. The historical
record made P0-07 the next gate; the current disposition is recorded below.

## Current gate-owner reconciliation addendum (2026-09-15)

The current v2 source content identity is
`c9e0c93944b5662412acec8d8bd7ddf3d72adaf2511b19d599f2a3e00a709e49` over
Rust/TypeScript/JSON source files under `crates/` and `apps/`; the contract
fixture digest is
`62854a3381f8d8de7ba96836242afe9f5b75dfbc2f9e3747dc187c161c0bad36` over
`project/spec/`. Both are based on containing-repository commit
`0e614ccc9e71d577a0ceb3dedfbfecdcc63cbdb8`. The v2 package is untracked, so
this digest is not an immutable checkpoint. This task changed only planning
and review records; it did not alter Rust, TypeScript, application code, or
legacy state.

| Current item | Disposition | Evidence / required follow-up | Gate effect |
| --- | --- | --- | --- |
| R-001–R-005 | fixed, historical fixes retained | `validate_contracts.py`, workflow validator, current Rust tests, and standalone check all pass | No current automated contract failure observed |
| R-006 | deferred, historical approved deferral retained | Pinned v1 executable/configuration/fixture and migration ambiguity resolution are still absent; keep `unmeasured`/operator-review labels | Blocks legacy speedup and complete migration-parity claims |
| R-007 | deferred — evidence-integrity blocker | Repo integrator must checkpoint the current v2 package, record its immutable revision/digest, and rerun P0-07 | Blocks portable release/closeout evidence; does not invalidate measured working-tree results |

### Current measured rerun set

- `python3 project/spec/validate_contracts.py`: PASS — 8 protocol envelopes,
  11 guidance fixtures, 8 workflow assets, 18 legal/15 illegal transition
  vectors, 19 clock/dependency cases, and SQLite schema parsed.
- `python3 -m unittest discover -s project/spec/workflows -p 'test_*.py' -v`:
  PASS — 6 workflow validator tests.
- `cargo test --workspace`: PASS — all workspace test binaries completed with
  zero failures.
- `bash scripts/standalone-check.sh`: PASS in a temporary copy — formatting,
  locked offline Rust tests, clippy, TUI typecheck, and mounted TUI tests.

P0-06 is reconciled for the current working tree with R-006 and R-007
explicitly deferred. The next action is to checkpoint the package and rerun
P0-07 against that revision; the separate next action for P0-02 is the pinned
v1 measurement run. Neither action is performed by this file-only update.
