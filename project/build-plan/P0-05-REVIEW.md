# P0-05 independent contract review

Review task: P0-05 · historical reviewed snapshot: `p0-03.v2` · reviewer:
Luna Zeno · date: 2026-09-15. The historical review ran the structural
validator and inspected the combined spec, migration map, baseline matrix,
and linked v2 contracts. The current gate-owner addendum below covers the
present working tree.

Historical disposition: **findings produced; no blocker remained in the
contract fixture tree after the recorded reconciliation.** P0-02's missing
safe legacy measurements and P0-04's migration ambiguities remain explicit
phase limitations and were carried as approved deferrals into P0-06/P0-07;
they were not converted into invented baseline numbers or guessed imports.

| Finding | Severity | Reproduction / impact | Disposition | Owner / rerun |
| --- | --- | --- | --- | --- |
| R-001 | major | Guidance safe actions used flags not visibly represented in the CLI registry; a no-goal/recovery action could be non-executable. | fixed by declaring `--revision`, `--actor-role`, `--operator-reason`, `--reviewer`, `--gate`, `--include-expiry`, `--close`, and `--release`, plus validator coverage. | protocol/CLI steward; `validate_contracts.py` |
| R-002 | major | Parent and dependency IDs could be cross-project because scalar foreign keys did not bind the project scope. | fixed with project-scoped composite foreign keys and a cross-project rejection smoke case. | store owner; schema validator |
| R-003 | major | A reviewer could equal the attempt actor through a direct insert. | fixed with `review_no_self_review` trigger and typed `reviewer_cannot_review_own_attempt` registry entry. | application/store owner; schema validator |
| R-004 | medium | Nullable `gate.subject_ref` made SQLite uniqueness nullable-sensitive. | fixed by normalizing `subject_ref` to `NOT NULL DEFAULT ''`. | store owner; duplicate-gate smoke case |
| R-005 | medium | Structural validation did not exercise transition vectors or key schema constraints. | fixed by adding transition/clock/dependency/profile count checks, all-fixture CLI flag checks, SQLite constraint smoke tests, and an explicit P0-07 report. | integration owner; validator rerun |
| R-006 | observation | P0-02 cannot safely reproduce legacy timings under the current mismatched toolchain; P0-04 retains ambiguous legacy statuses/edges. | approved deferral: retain `unmeasured`/operator-review labels; no performance or migration-success claim. | baseline and migration owners; P5 baseline/import gates |

The review did not authorize P1 by itself. P0-06 reconciliation and P0-07
revalidation remain required before implementation dispatch.

## Current gate-owner review addendum (2026-09-15)

This addendum preserves the historical finding ledger above. It reviews the
current v2 working tree without changing Rust, TypeScript, or application
code. The current source/fixture content identity is
`c9e0c93944b5662412acec8d8bd7ddf3d72adaf2511b19d599f2a3e00a709e49` over
Rust/TypeScript/JSON source files under `crates/` and `apps/`, with contract
fixture digest
`62854a3381f8d8de7ba96836242afe9f5b75dfbc2f9e3747dc187c161c0bad36` over
`project/spec/`; the containing Git base is
`0e614ccc9e71d577a0ceb3dedfbfecdcc63cbdb8`, while the v2 package remains
untracked. This is measured working-tree evidence, not an immutable review
revision.

| Current check | Result | Review meaning |
| --- | --- | --- |
| `python3 project/spec/validate_contracts.py` | PASS — 8 protocol envelopes, 11 guidance fixtures, 8 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, SQLite schema parsed | The reconciled fixture tree is structurally coherent. |
| `python3 -m unittest discover -s project/spec/workflows -p 'test_*.py' -v` | PASS — 6 workflow validator tests | Workflow package rejection/allowlist behavior is covered. |
| `cargo test --workspace` | PASS — all workspace test binaries completed with zero failures | Current implementation exercises lifecycle, status/deadline/fence, evidence/closeout, protocol/CLI/service, source/memory, and migration paths. |
| `bash scripts/standalone-check.sh` | PASS in a temporary copy | Formatting, locked offline Rust tests, clippy, TUI typecheck, and mounted TUI tests passed. |

### Current findings

| Finding | Severity | Disposition | Owner / next action | Gate effect |
| --- | --- | --- | --- | --- |
| R-007 | major evidence-integrity | deferred — current v2 code and fixtures are untracked in the containing repository, so no immutable revision binds the measured results | repo integrator; checkpoint the package, record the resulting revision/digest, and rerun P0-07 | current working-tree validation may be reported; portable release/closeout evidence is not authorized |
| R-006 | observation | preserved as approved deferral — P0-02 legacy measurements and P0-04 ambiguous migration records remain unavailable/ambiguous | baseline and migration owners; run the pinned v1 reproduction/import gates | no legacy speedup or complete migration-parity claim |

The current checks found no new automated contract failure. They are not a
substitute for the immutable source checkpoint required by R-007, and the
passing v2 implementation tests do not reproduce the v1 baseline rows.
