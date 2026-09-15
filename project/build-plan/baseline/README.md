# P0-02 reproducible baseline

Owner: S00 baseline analyst. Separate **observed**, **reproduced**, and
**inferred** failures. Preserve live locks, legacy data, failed attempts, and
the current source snapshot. If the v1 toolchain cannot be pinned without
mutating the user's environment, mark a measurement unavailable rather than
manufacturing a number.

Capture command start/end, startup/digest, lock wait and hold, projection/
serialization, payload bytes, operation/result identity, changed-state flag,
retry count, and useful lifecycle timestamps for a fixed workload. Compare
TUI-on/off and 1/3/10/30/50 agents only after the same validation profile and
source fixture are available. The supplied audit is context, not a timing
trace or proof of root cause. Follow
[AUDIT_BASELINE.md](../../AUDIT_BASELINE.md),
[S00](../../../milestones/M01-v2-product/sprints/S00-contracts/SPRINT.md),
and [P0 handoff](../verticals/00-contracts-baseline.md).

Historical scaffold note (2026-09-14): `cargo test --workspace` from the v2
root exited 0, but the then-present four crates reported **zero tests**. This
was not a performance baseline or evidence of implemented lifecycle behavior;
the finding is retained as a historical addendum rather than applied to the
current source tree.

## Current gate-owner evidence (2026-09-15)

The current v2 working tree has measured implementation checks, but those
checks do not turn a v2 result into a v1 baseline. The source set used here is
identified by content digest
`c9e0c93944b5662412acec8d8bd7ddf3d72adaf2511b19d599f2a3e00a709e49` over the
Rust/TypeScript/JSON source files under `crates/` and `apps/`, plus contract
fixture digest
`62854a3381f8d8de7ba96836242afe9f5b75dfbc2f9e3747dc187c161c0bad36` over
`project/spec/`. The
containing Git repository is based at
`0e614ccc9e71d577a0ceb3dedfbfecdcc63cbdb8`, but the v2 package is untracked
there; the digest is therefore a working-tree identity, not an immutable
revision.

Measured results:

- `cargo test --workspace`: PASS; all workspace test binaries completed with
  zero failures, including lifecycle, status/deadline/fencing, evidence and
  closeout, protocol/CLI, service, source/memory, and migration suites.
- `bash scripts/standalone-check.sh`: PASS in a temporary copy; contract
  fixtures, formatting, locked offline Rust tests, clippy, TUI typecheck, and
  TUI mounted workflow/protocol/monitoring/refresh tests all passed.

These results are current v2 implementation evidence only. P0-02 remains
`unmeasured` for legacy lock/response/expiry/lifecycle/evidence/repair/
guide-finish timings and failure reproduction. The next action is to obtain a
pinned, disposable v1 executable/configuration/fixture, then attach measured
receipts to the matrix. Until that happens, no legacy speedup, v1 timing, or
complete parity claim is permitted.
