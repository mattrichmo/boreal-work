# P0-07 contract revalidation

Historical snapshot: `p0-03.v2` · validator: coordinator integration check ·
date: 2026-09-15. The fixture-only revalidation below is preserved. The
current gate-owner revalidation addendum records measured implementation and
standalone evidence without treating it as a v1 baseline.

## Executed checks

| Check | Result |
| --- | --- |
| `python3 project/spec/validate_contracts.py` | PASS — 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, SQLite schema parsed |
| Parse every `project/spec/**/*.json` fixture | PASS — 48 JSON fixtures |
| SQLite schema with foreign keys, project-scoped parent/dependency links, current-attempt/session uniqueness, normalized gate uniqueness, append-only audit/receipt, and self-review trigger | PASS — in-memory smoke assertions |
| Frozen defaults and aliases | PASS — hard `2h`, renewable lease `30m`, `--ttl` lease alias, heartbeat/renewal cannot extend hard deadline |
| Guidance and protocol trusted actions | PASS — registry references resolve, safe argv lists contain `--json`, `shell=false`, and all flags are declared in CLI grammar |
| Workflow package | PASS — 10 unique refs, typed inputs, allowlisted command steps, explicit finish criteria, next refs resolve |
| Baseline and migration evidence | PASS with limits — observed/unmeasured baseline and explicit keep/rework/defer/historical-only/unsupported mapping remain preserved; no unproven timing or guessed migration claim |

## Gate disposition

Historical gate disposition: `PASS WITH APPROVED DEFERRALS`. The P0 contract artifacts are internally
consistent and ready for P1 implementation. P0-02's safe legacy timing
reproduction and P0-04's ambiguous-record resolution remain follow-up work;
they do not block domain/store coding, but they continue to block any claim of
legacy speedup or complete migration parity. P0-05 findings are reconciled in
[P0-06-RECONCILIATION.md](P0-06-RECONCILIATION.md).

Next leaves: P1-01 typed domain/transitions and P1-03 SQLite implementation may
start in disjoint code paths. P1-02/P1-04/P1-05/P1-06 wait for those inputs;
P1-07/P1-08/P1-09 remain mandatory before P2.

## Current gate-owner revalidation addendum (2026-09-15)

The current v2 source/fixture working tree was revalidated without editing
Rust, TypeScript, or application code. Source identity is content digest
`c9e0c93944b5662412acec8d8bd7ddf3d72adaf2511b19d599f2a3e00a709e49` over
Rust/TypeScript/JSON source files under `crates/` and `apps/`; the contract
fixture digest is
`62854a3381f8d8de7ba96836242afe9f5b75dfbc2f9e3747dc187c161c0bad36` over
`project/spec/`, based at containing-repository commit
`0e614ccc9e71d577a0ceb3dedfbfecdcc63cbdb8`. The v2 package is untracked;
therefore this is a measured working-tree result, not immutable release
evidence.

| Current check | Result |
| --- | --- |
| `python3 project/spec/validate_contracts.py` | PASS — 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, SQLite schema parsed |
| `python3 -m unittest discover -s project/spec/workflows -p 'test_*.py' -v` | PASS — 6 workflow validator tests |
| `cargo test --workspace` | PASS — all workspace test binaries completed with zero failures; current tests cover lifecycle/status/deadline/fencing, evidence/close intent, protocol/CLI/service, source/memory, and migration paths |
| `bash scripts/standalone-check.sh` | PASS in a temporary copy — contract fixtures, Rust formatting, locked offline Rust tests, clippy, TUI typecheck, and mounted TUI workflow/protocol/monitoring/refresh tests all passed |

### Current gate disposition

`PASS WITH APPROVED DEFERRALS FOR THE CURRENT WORKING TREE.` This disposition
is supported by the measured checks above and makes no claim that P0-02 has
been reproduced. The exact remaining blockers are:

1. **R-006 / legacy evidence:** no pinned v1 executable, configuration,
   disposable fixture, or receipt set exists for legacy timings/failures;
   P0-04 ambiguous migration records also remain operator-review only. This
   blocks legacy speedup and complete migration-parity claims.
2. **R-007 / source provenance:** the current v2 package is untracked, so the
   measured result is not bound to an immutable source revision. The repo
   integrator must checkpoint it, record the immutable revision/digest, and
   rerun this current check set.

P0-07 therefore authorizes only the stated current working-tree contract
result with those deferrals. It does not authorize a release claim or erase
the historical P0-05 findings. Next actions are the immutable checkpoint plus
rerun, followed by the separate pinned-v1 baseline/import work.
