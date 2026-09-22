# PF-S03-T03 attempt 3 — bounded corrective implementation start

## Identity and write boundary

- Task: `PF-S03-T03` — exact clock, schedule, retry, due, lease,
  hard-budget, expiry, and next-reevaluation predicates.
- Attempt: `attempt-3`, corrective implementation after the independent
  attempt-2 rejection.
- Worker: bounded corrective implementation worker; this record is not an
  independent review and does not claim task acceptance.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Start/readback time: `2026-09-22T09:39:38Z` UTC baseline; final checks were
  rerun after the corrective edits.
- Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty; `git status --porcelain=v1` reported 74 entries. Existing
  unrelated changes were preserved.

Owned write paths for this attempt are exactly:

- `crates/domain/src/time_policy.rs`
- `crates/domain/tests/production_time_policy.rs`
- `project/validation/production/tasks/PF-S03-T03/attempt-3/`

Protected shared registration `crates/domain/src/lib.rs` was read-only. The
current dirty tree already contains `pub mod time_policy;` at line 12, and the
focused test imports `boreal_domain::time_policy::*` at line 8. No other
production path, plan ledger, database, prior attempt, service, or shared file
was edited.

## Contracts and source identities loaded

- Task card SHA-256:
  `892addfe415d344cba6ae32565d105a1774a22165d3758da8d1e1af15d33e36b`.
- Production contract manifest:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
- Status/action contract:
  `b2b41ffd640811118e2c8f0ac0ba9c60d79cc46ccc73135cdcf609ae384b3a94`.
- Execution/submission contract:
  `539088128f18bc6fef8bbd855ca6a140c4d02ba33bffc799179b128c2a8393a4`.
- Transition table:
  `4a22bceb49b8d40d96a872f2ae3aed8b79a81d5636339c609914a05b3a2a9d38`.
- Status model:
  `688595dc7d305a19e018ba727df4c850bc6a6d441e53cd4e537f02d9dc77a914`.
- Lifecycle contract:
  `5bc921025b3f4e85efbde9b4f58dc459275be9ec7d126d7c6030fd0c628933a9`.
- Accepted prerequisite handoffs retained from prior work:
  - PF-S03-T01 attempt 2:
    `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
  - PF-S03-T02 attempt 4:
    `b5bfb371a4e732f898309a18fae8b7fb677d1e0de6d7028c579b435f2a4c8d13`.
- Attempt-2 review artifacts retained unchanged:
  - `START.md`: `0f2e7ee868de9d08a16a568e4dc226185ed9011b138e435543825f38df38a745`.
  - `COMMANDS.md`: `a0fca83af6f67dde5376f79ee459c3fbbd294977cff72a65da958de281d35618`.
  - `EVIDENCE.md`: `55d51108666005d9e7880c12ccb076b6454afa94cb7e1ca9f20ed93a04d2cb79`.
  - `HANDOFF.md`: `639ea26c11d13c850ad2d53af5798a60ac7e79cb693976a6b0e3f9acdb69ca4f`.

Final implementation source hashes at handoff readback:

- `crates/domain/src/time_policy.rs`:
  `58ee17cdcad6e4cd7f42f75f68c5526471ce278d8c6f098c011f5207b5d2ac58`.
- `crates/domain/tests/production_time_policy.rs`:
  `c535f8269097726cfafa6e28d2329a6e10d6c93434eef9868514b052761dc12d`.
- Read-only `crates/domain/src/lib.rs`:
  `504bb99b658217c8bb3d605f6e7b30b3f4080f14ed1f4928ca4b37121ef45538`.

## Rejected history reproduced and retained

Attempt 1 implemented the initial pure time-policy slice. Its history remains
in `attempt-1/`: the focused target was initially absent (exit 101), then had
three implementation/test failures before passing; a later combined-tree
check/test readback saw 84 unrelated dependency-integration errors (exit 101),
and one workspace format check was blocked by protected shared `lib.rs` before
a later rerun passed. Attempt 1 was not acceptance.

Attempt 2 independently rejected the leaf for four major findings, all read
against the public registration and current contracts:

1. Lease-only `ExpiryPending`/`Expired` state used shared `Attempt::expiry_reason`
   and reported `HardBudgetElapsed` instead of the elapsed lease trigger.
2. `renew_lease` accepted zero or shortening candidates because it only checked
   the old authority window.
3. Combined evaluation emitted future schedule/retry/exception/readback timers
   while expiry review was active.
4. Combined evaluation left retry eligible after an unvalidated restart.

The exact attempt-2 rejection and all review limitations remain in
`attempt-2/EVIDENCE.md` and `attempt-2/HANDOFF.md`; no prior evidence was
overwritten.

## Interpreted invariant and corrective plan

Deadline equality remains authoritative; lease ownership and immutable hard
budget remain separate; due/overdue remains informational; historical terminal
attempt clocks remain non-owning unless recovery is pending; and backward or
unvalidated restart clocks fail closed.

This attempt will:

- derive expiry reason from the earliest elapsed canonical deadline, or require
  an explicit retained reason for phase-only recovery;
- reject renewal candidates that are not strictly after the renewal instant or
  that shorten the persisted lease;
- suppress schedule/retry eligibility and every forward reevaluation timer
  while expiry review or clock reconciliation is active; and
- add public-boundary regressions for all four rejected findings, retaining
  normal active, historical, retry, schedule, and restart behavior.

Expected verification is pure-domain only: focused target, full domain package,
workspace format check, domain test-target check, and strict all-target domain
clippy. Independent re-review, coordinator reconciliation, and PF-S03-T92
remain required after this attempt.
