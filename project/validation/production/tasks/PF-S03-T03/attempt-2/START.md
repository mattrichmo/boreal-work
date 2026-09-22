# PF-S03-T03 attempt 2 — independent review start

## Identity and bounded review

- Task: `PF-S03-T03` — exact clock, schedule, retry, due, lease,
  hard-budget, expiry, and next-reevaluation predicates.
- Attempt: `attempt-2`, independent review of implementation attempt 1 and the
  current integrated dirty tree.
- Reviewer: Codex (OpenAI), independent validation reviewer; not the attempt-1
  implementation worker.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Review start: `2026-09-22T09:24:33Z`; Rust checks completed by
  `2026-09-22T09:25:17Z`; artifact/dispatch readback completed by
  `2026-09-22T09:28:35Z` UTC.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; `git status --porcelain=v1` reported 74 entries. Existing
  unrelated changes were preserved.
- Review write boundary: this attempt directory only:
  `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md`.
- Product source, product tests, prior attempts, plans, contracts, and
  `project/build-plan/production-completion/execution/STATE.json` are
  read-only for this review.
- Scope decision: PF-S03-T03 leaf only. No sprint, service, native,
  publication, release, reconciliation, or revalidation decision is made.

## Inputs read

- Full task card:
  `project/build-plan/production-completion/sprints/PF-S03/tasks/PF-S03-T03.md`.
- PF-S03 sprint, production-completion master plan, project/build-plan README,
  project README, root master plan, and root `AGENT_HANDOFF.md`.
- PF-S03-T03 attempt-1 `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and
  `HANDOFF.md`.
- Accepted prerequisite handoffs:
  - PF-S03-T01 attempt 2 `HANDOFF.md`, SHA-256
    `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
  - PF-S03-T02 attempt 4 `HANDOFF.md`, SHA-256
    `b5bfb371a4e732f898309a18fae8b7fb677d1e0de6d7028c579b435f2a4c8d13`.
- Contract manifest:
  `project/spec/production/contract-manifest.json`, SHA-256
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
- Relevant status/decision contracts: D20, D21, D27 in
  `project/DECISIONS.md`; clock/expiry sections of
  `project/STATUS_MODEL.md`; `project/spec/production/status-and-actions.md`;
  `project/spec/production/execution-submission-contract.md`;
  `project/spec/transition-table.md`; `project/spec/WORK_MODEL_SCENARIOS.md`;
  and `project/spec/production/conformance-matrix.json`.
- Review workflow asset `skills/boreal-review/boreal.yaml` and
  `project/spec/workflows/review.json`.

## Public-boundary verification target

The exact current tree contains the coordinator/shared registration at
`crates/domain/src/lib.rs:12`:

```rust
pub mod time_policy;
```

The focused test uses the public boundary at
`crates/domain/tests/production_time_policy.rs:8`:

```rust
use boreal_domain::time_policy::*;
```

This review verifies those facts and reruns the focused target on the public
crate import. The current `lib.rs` is a concurrent dirty shared file; this
review does not normalize or edit it.

## Review invariant

The leaf must make deadline equality authoritative, preserve a renewable lease
as distinct from the immutable hard budget, retain historical evidence without
letting old clocks expire idle work, preserve recovery obligations, keep retry
backoff deterministic and bounded, keep due/overdue informational, and fail
closed at clock discontinuity or malformed input. The result must also expose
the earliest relevant reevaluation without scheduling work that expiry review
has already fenced.

The review will record both passing checks and any source/contract gaps. A
focused pure-domain pass is not task acceptance when a required boundary case
is uncovered.
