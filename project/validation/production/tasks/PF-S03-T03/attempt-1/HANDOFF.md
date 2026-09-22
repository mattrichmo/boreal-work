# Task handoff — PF-S03-T03 implementation attempt 1

## Identity and disposition

- Task / plan / attempt: `PF-S03-T03` / production-completion plan / `attempt-1`.
- Worker: implementation worker for the bounded domain time-policy slice.
- Independent reviewer: not yet assigned/run for this attempt.
- State requested: **awaiting_integration**; this handoff is not task acceptance.
- Input source identity: dirty `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`,
  branch `codex/apply-responsive-terminal-overlay`.
- Final worker source identity: same dirty HEAD plus the two assigned source/test
  files and attempt-1 evidence files; the shared tree also contained another
  lane's uncommitted public module registration. Exact SHA-256 values are in
  `COMMANDS.md`.
- Accepted prerequisites read:
  - PF-S03-T01 attempt 2 bounded independent acceptance of typed inputs/public
    boundary, handoff SHA-256
    `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
  - PF-S03-T02 attempt 4 bounded independent acceptance of precedence/reason
    ordering, handoff SHA-256
    `b5bfb371a4e732f898309a18fae8b7fb677d1e0de6d7028c579b435f2a4c8d13`.
- Contract manifest SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.

Final scoped artifact SHA-256:

- `crates/domain/src/time_policy.rs`:
  `d3d83676b3d0fdf65346c409c6311278d304bed309b333aa4b28811a7516630e`
- `crates/domain/tests/production_time_policy.rs`:
  `c2150e3455d431bc9931c5e30e108ecaa6b0f8071512ae514968d4ea11630a67`

## Changes and invariant

Exact worker-owned changed paths:

- `crates/domain/src/time_policy.rs`
- `crates/domain/tests/production_time_policy.rs`
- `project/validation/production/tasks/PF-S03-T03/attempt-1/START.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-1/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-1/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-1/HANDOFF.md`

`crates/domain/src/lib.rs` was protected and was not edited by this worker. The
coordinator/steward integration request is exactly:

```rust
pub mod time_policy;
```

The current shared readback already shows that declaration at
`crates/domain/src/lib.rs:12`, authored by another lane, and the focused test
now uses:

```rust
use boreal_domain::time_policy::*;
```

The coordinator must retain/verify the declaration on the final combined tree,
preserve the existing fixtures, run the combined-tree focused/full domain
checks, and record the resulting public-boundary source identity. No other
production or shared path is requested.

The implemented invariant is deterministic time policy over canonical facts:
deadline equality expires; lease renewal does not move the immutable hard
budget; stale attempt/fence authority is denied; historical failed/released/
cancelled/completed attempts do not lend clocks to idle work; unresolved
recovery remains reviewable; due/overdue is informational; retry is bounded and
deterministic; and clock backward/restart discontinuity cannot silently grant
authority or resurrect expiry; planning target estimates do not gate claims or
due state. `EVIDENCE.md` links each acceptance behavior to
the focused test that exercises it.

Before this attempt the task-specific test target did not exist (`cargo test
... --test production_time_policy` exit `101`). Existing domain source had
separate attempt/schedule pieces but no worker-owned unified pure policy for
stale authority, historical recovery, restart/discontinuity, bounded retry,
and combined reevaluation. Known task findings addressed are F05 (malformed /
lexical attempt-clock risk) and F14 (incomplete scheduling and safe timer
semantics), within this domain-only boundary.

## Validation

| Case / command argv and cwd | Source/runtime identity | Expected assertion | Actual outcome / exit | Evidence |
| --- | --- | --- | --- | --- |
| `rustfmt --edition 2021 --check crates/domain/src/time_policy.rs crates/domain/tests/production_time_policy.rs` from repository root | Rust `1.85.0`; assigned files | Assigned files formatted | Passed / `0` | `COMMANDS.md` |
| `cargo fmt --all -- --check` from repository root | Rust `1.85.0`; dirty combined tree | Workspace formatted | Passed / `0`; an earlier current-tree readback failed on protected shared `crates/domain/src/lib.rs` module ordering, with no assigned-file diff reported | `COMMANDS.md` |
| `cargo check --locked -p boreal-domain --tests` from repository root | HEAD `784a41b3`; assigned source/test | Domain test targets compile | Passed / `0` | `COMMANDS.md` |
| `cargo test --locked -p boreal-domain --test production_time_policy -- --nocapture` from repository root | Public `boreal_domain::time_policy` import; SHA in `COMMANDS.md` | Exact clock/schedule/retry/expiry vectors | Passed: `12/12` / `0` | `EVIDENCE.md` focused coverage table |
| `cargo test --locked -p boreal-domain` from repository root | Current dirty combined tree | Full domain package remains green | Passed: `96/96`, `0` doc-test failures / `0` | `COMMANDS.md` |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` from repository root | Same | Strict domain lint | Passed / `0` | `COMMANDS.md` |
| `bwrk prime boreal-work --json` and workflow lookup | Local DB owner `process:68913...` | Read project/workflow context | Typed `busy/service_busy`; no mutation | `START.md`, `COMMANDS.md` |

The initial unsupported target, intermediate compile/assertion failures, the
intermediate shared-tree check/test failure with 84 unrelated dependency
integration errors, later shared-tree formatting block, and busy workflow
result remain preserved. No test result was inferred as service/lifecycle
acceptance.

Real service operation/readback IDs: none.
Verifier command/environment, receipt/artifact IDs: none.
Independent review decision: pending; no reviewer identity is claimed.
Native installed/published identity: not applicable and not run.

## Impact and residual work

- Schema/migration/rollback: none introduced by this pure module.
- Protocol/status/reason/action compatibility: no existing status evaluator or
  protocol path was edited. The requested `lib.rs` registration is additive;
  public integration and any status/application/store wiring remain coordinator
  work under their own boundaries.
- Authority/isolation/security/history: the domain result distinguishes stale
  identity/fence, elapsed clocks, clock reconciliation, historical attempts,
  and pending recovery. Store/application transactions still must enforce the
  same predicates and physical stop/resource isolation; this worker does not
  claim those runtime guarantees.
- Source/memory/retention/package: no effect claimed.
- Known limitations: the public `lib.rs` registration is another lane's
  uncommitted shared change and must be retained/verified during reconciliation;
  an earlier shared-tree formatting block is preserved in `COMMANDS.md`, while
  the final workspace formatting rerun passed; the local Boreal workflow
  service was busy; no real service/lifecycle evidence or independent review
  exists yet.

Next safe task: coordinator retains/verifies the exact `lib.rs` registration on
the final combined source, then an independent PF-S03-T03 reviewer reruns
focused/full domain checks.
Any finding is preserved in a new bounded attempt directory; the
PF-S03-T90/T91/T92 review, reconciliation, and revalidation chain remains
required. This handoff does not request or imply task, sprint, or production
acceptance.

- [x] No test/run/peer/native success was inferred or fabricated.
- [x] Failures/history retained; no secrets included.
- [x] All worker changes fit the declared boundary; shared registration remains
      an explicit coordinator request and is not claimed as this worker's
      integration.
- [x] Acceptance criteria are linked to focused evidence; coordinator and
      independent-review decisions remain separate.
