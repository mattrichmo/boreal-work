# PF-S03-T10 — attempt 7 handoff

## Identity and disposition

- Task: `PF-S03-T10` — complete deterministic oracle coverage for status and transitions.
- Attempt: `7` — protected store/application adapter integration.
- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743`.
- State: **blocked / immediate handoff**.
- Decision: **not accepted**. Independent review, protected integration, and
  exact-tree revalidation remain required.
- Production source changed by attempt 7: **none**.
- Evidence added by attempt 7: `START.md`, `COMMANDS.md`, `EVIDENCE.md`,
  `INTEGRATION-REQUESTS.md`, this handoff.
- Plan/state/ledger edits: none.
- Commit/push: none.

## Current result

The current combined tree already contains the protected store-side fields and
snapshot reader needed to carry canonical planning facts into a status row.
The application adapter remains the compile blocker: its `StatusContext`
literal does not yet pass `schedule` and `activation_at`, and its
`StatusWorkInput`/status/2 presentation mapping has not yet been integrated.

I stopped before editing those paths at the user's request for an immediate
handoff and removed the partial local edit, so no half-applied adapter change
is being claimed.

## Checks

Passed:

- `cargo fmt --all -- --check`
- `python3 project/spec/validate_contracts.py`
- `git diff --check`
- `cargo test --locked -p boreal-domain --test production_properties` — 21/21

Blocked:

- `cargo check --locked -p boreal-application`
  - `crates/application/src/status.rs:291`: missing `StatusContext.activation_at`
    and `StatusContext.schedule`;
  - `crates/application/src/evidence.rs:687`: unrelated current-tree
    PF-S02-T11 borrow/move error.

Exact command output and tool versions are recorded in `COMMANDS.md`.

## Required next safe action

Apply IR-1 and IR-2 in the granted application path, then run focused
application status tests and the full application crate. Separately reconcile
the PF-S02-T11 error, independently review the protected store planning query,
and rerun the combined store/application checks. Do not update `STATE.json` or
mark T10 accepted from this bounded handoff.
