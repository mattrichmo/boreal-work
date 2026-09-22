# PF-S03-T03 attempt 2 — independent review handoff

## Identity and disposition

- Task / plan / attempt: `PF-S03-T03` / production-completion plan /
  `attempt-2`.
- Reviewer: Codex (OpenAI), independent validation reviewer; did not implement
  attempt 1 and did not edit product source.
- Independent decision: **REJECT for the bounded PF-S03-T03 leaf**.
- Decision scope: PF-S03-T03 only; no sprint, service, native, publication,
  release, reconciliation, or revalidation decision is made.
- Input/final source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, branch
  `codex/apply-responsive-terminal-overlay`, dirty worktree with 74 status
  entries. Exact reviewed source hashes are in `COMMANDS.md`.
- Accepted prerequisites:
  - PF-S03-T01 attempt 2 handoff, SHA-256
    `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
  - PF-S03-T02 attempt 4 handoff, SHA-256
    `b5bfb371a4e732f898309a18fae8b7fb677d1e0de6d7028c579b435f2a4c8d13`.
- Contract manifest:
  `project/spec/production/contract-manifest.json`, SHA-256
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.

## Reviewed boundary and integration result

Only these four review files were written:

- `project/validation/production/tasks/PF-S03-T03/attempt-2/START.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-2/COMMANDS.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-2/EVIDENCE.md`
- `project/validation/production/tasks/PF-S03-T03/attempt-2/HANDOFF.md`

Review artifact SHA-256 values at final readback are recorded in
`COMMANDS.md`.

The current coordinator/shared public registration is present at
`crates/domain/src/lib.rs:12` and the focused test uses the public
`boreal_domain::time_policy` import at line 8. The exact public-boundary
focused test, full domain package, check, workspace format, and strict
all-target clippy all passed on the current dirty tree.

Those green checks do not clear the four source/contract findings recorded in
`EVIDENCE.md`:

1. `PF-S03-T03-R1` — lease-only `ExpiryPending`/`Expired` state is reported as
   `HardBudgetElapsed` because the current shared `Attempt::expiry_reason`
   special-cases the phase without retaining the actual trigger.
2. `PF-S03-T03-R2` — `renew_lease` accepts `lease_ttl_ms=0` and can return an
   immediately expired or shortened candidate without fail-closed validation.
3. `PF-S03-T03-R3` — combined time policy still returns future schedule/retry
   timers while expiry review is active, contrary to the null-while-reviewing
   timer contract.
4. `PF-S03-T03-R4` — combined time policy leaves retry eligibility true under
   an unvalidated restart even while schedule eligibility/timers are
   suppressed.

These are leaf-scoped correctness gaps, not merely missing service evidence.
They block acceptance of AC-09. The shared `lib.rs` findings are reported for
the coordinator/domain steward; this reviewer did not modify that protected
file.

## Validation and residual work

- `cargo fmt --all -- --check`: passed, exit `0`.
- `cargo test --locked -p boreal-domain --test production_time_policy`: passed,
  `12/12`, exit `0`, using the public module import.
- `cargo test --locked -p boreal-domain`: passed, `96/96`, zero doc-test
  failures, exit `0`.
- `cargo check --locked -p boreal-domain --tests`: passed, exit `0`.
- `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings`:
  passed, exit `0`.
- `bwrk workflows show`, `work review-candidates`, and `work show` each
  returned typed `service_busy` with exit `6`; no live lock was broken and no
  coordinator mutation was attempted.
- No real service operation/readback, verifier receipt, native artifact,
  publication identity, or release identity exists for this leaf review.

Next safe task: create a corrective bounded implementation attempt owned by the
domain steward/coordinator, preserving this rejected review and attempt 1.
Correct the four findings with explicit lease-boundary, candidate-renewal,
expiry-review-timer, and restart-retry fixtures, then rerun the exact current
tree checks and assign a fresh independent PF-S03-T03 review. The PF-S03-T90,
T91, and T92 chain remains required.

- [x] No test/run/peer/native success was inferred or fabricated.
- [x] Failed attempt-1 evidence and this rejected review are preserved.
- [x] No production source, `STATE.json`, prior evidence, or unrelated path was
      edited.
- [x] Public shared registration and public test import were verified on the
      exact current dirty tree.
- [x] Acceptance is explicitly limited to the PF-S03-T03 leaf and remains
      rejected pending corrective work.
