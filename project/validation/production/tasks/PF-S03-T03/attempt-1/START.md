# PF-S03-T03 attempt 1 — start record

## Task and source identity

- Task: `PF-S03-T03` — implement exact clock, schedule, retry, due, lease,
  hard-budget, expiry, and next-reevaluation predicates.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Checkpoint time: `2026-09-22T09:05:21Z`.
- Worktree: dirty; `git status --porcelain=v1` reported 72 entries at the
  checkpoint, including the assigned new source/test paths and unrelated
  pre-existing work.
- Allowed product paths: `crates/domain/src/time_policy.rs` and
  `crates/domain/tests/production_time_policy.rs` only.
- Allowed evidence path: this attempt directory only.
- Protected shared path: `crates/domain/src/lib.rs`; no edit is authorized.

## Loaded prerequisite and contract identity

- PF-S03 sprint and task card: `project/build-plan/production-completion/sprints/PF-S03/`;
  task card SHA-256 `892addfe415d344cba6ae32565d105a1774a22165d3758da8d1e1af15d33e36b`.
- Accepted PF-S03-T01 bounded handoff:
  `project/validation/production/tasks/PF-S03-T01/attempt-2/HANDOFF.md`,
  SHA-256 `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
- Accepted PF-S03-T02 bounded re-review handoff:
  `project/validation/production/tasks/PF-S03-T02/attempt-4/HANDOFF.md`,
  SHA-256 `b5bfb371a4e732f898309a18fae8b7fb677d1e0de6d7028c579b435f2a4c8d13`.
- Production contract manifest:
  `project/spec/production/contract-manifest.json`, SHA-256
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- The accepted prerequisite scopes are leaf-boundary review results only;
  they do not authorize sprint, service, migration, native, publication, or
  release acceptance.

## Interpreted invariant

The domain receives an explicit canonical clock and persisted attempt facts.
Deadline equality is expired (`as_of >= deadline`); lease renewal can move
only the renewable lease and never the hard budget measured from authoritative
`claimed_at`; due/overdue is informational and cannot steal ownership or close
work; retry eligibility is explicit, opt-in, bounded, and deterministic; stale
attempt/fence authority is rejected; failed/released/cancelled historical
clocks do not expire idle work; and an expired historical attempt remains
visible only when an unresolved recovery obligation is present. Backward or
unvalidated restart clock samples cannot resurrect an expiry or authorize a
write. A restart with validated monotonic evidence uses the conservative
effective instant and retains the original hard deadline.

## Planned implementation and verification

`time_policy.rs` will provide pure predicates for clock continuity, attempt
windows, authority/fence checks, lease renewal, schedule/due evaluation,
bounded exponential backoff, retry eligibility, expiry, and combined earliest
reevaluation. The focused test will cover exact deadlines, stale authority,
historical attempts, schedule/due equality, deterministic capped backoff,
restart/backward discontinuity, malformed inputs, and timer selection.

Baseline unsupported behavior was captured before implementation:

```text
cargo test --locked -p boreal-domain --test production_time_policy
exit 101: error: no test target named `production_time_policy`
```

The required focused and full domain checks will run after the files are
implemented. Pure-domain results will not be represented as service or
lifecycle acceptance. The local `bwrk prime boreal-work --json` probe already
returned typed `busy/service_busy` because another process owns the database;
no lock will be broken and no runtime success will be inferred.

## Coordinator integration request

After reviewing this worker's source/test and evidence, the coordinator should
ensure exactly this shared declaration exists:

```rust
pub mod time_policy;
```

in `crates/domain/src/lib.rs`, and ensure the focused test uses the public
`boreal_domain::time_policy` import. The coordinator must run the focused test,
full domain package, formatting, and test-target checks on the combined tree.
This worker will not edit `lib.rs` or claim that shared integration is its own.

## Worker audit addendum — 2026-09-22

The assigned source and test files were already present as untracked worker
artifacts when this bounded audit resumed; they were preserved and corrected
in place. The audit aligned schedule semantics with the accepted work-model
contract: `target_start_at`/`target_end_at` are planning estimates and do not
gate claims, derive overdue, or create reevaluation timers. Already-expired
attempt phases retain their durable hard-budget expiry reason. The focused
test now imports the public `boreal_domain::time_policy` module.

At readback, the shared dirty tree already contained an uncommitted
`crates/domain/src/lib.rs:12` `pub mod time_policy;` registration from another
lane. This worker did not edit that protected file. The coordinator request
remains to retain/verify that exact declaration on the final combined source
and review the public test import at
`crates/domain/tests/production_time_policy.rs:8`; no acceptance is inferred
from another lane's uncommitted integration.

Final scoped readback was run against the dirty combined tree with 74 status
entries: the focused target passed `12/12`, focused strict clippy passed,
`cargo check --locked -p boreal-domain --tests` passed, the full domain package
passed `96/96` with zero doc-test failures, and all-target strict clippy
passed. Scoped rustfmt check passed. An earlier current-tree
`cargo fmt --all -- --check` was blocked by a formatting diff in protected
shared `crates/domain/src/lib.rs` from the concurrent lane; the final rerun
passed after that lane changed state. That file was not changed here. Exact
command receipts and final digests are in `COMMANDS.md`,
`EVIDENCE.md`, and `HANDOFF.md`. The task remains unaccepted pending
independent review and coordinator/reconciliation gates.
