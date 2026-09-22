# PF-S03-T04 attempt 4 — independent re-review handoff

## Identity and decision

- Task / plan / attempt: `PF-S03-T04` / production-completion plan /
  `attempt-4`.
- Source: HEAD `784a41b3802c29a76721c55eef2e9493283396c2`, dirty combined tree.
- Reviewer: Codex independent validation reviewer.
- Decision: **accepted for PF-S03-T04 only**.
- Coordinator action: record the bounded leaf review decision through the
  normal workflow; no coordinator ledger was edited here.

## Acceptance basis

1. Exact invalidated evidence is excluded from authoritative recency before
   choosing the newest current observation, while superseded/late/revoked
   facts remain diagnostic history.
2. Current failed, stale, and altered evidence remains authoritative and
   distinct from missing proof.
3. Review candidates are bound to exact proof subject and
   `AcceptanceInput.current_submission_id`; a newer approval for a foreign or
   newer submission cannot satisfy the current requirement.
4. Self-review rejection and authorization/exception vectors pass.
5. Public registration is present and unchanged.

## Exact validation

`cargo fmt --all -- --check`, `cargo check --locked -p boreal-domain --tests`,
the focused acceptance test, full `cargo test --locked -p boreal-domain`, and
strict focused/library clippy all passed. Focused and full counts, direct
regression commands, source hashes, and the typed service-busy workflow probe
are recorded in `COMMANDS.md` and `EVIDENCE.md`.

## Limits and next safe action

This handoff does not authorize or decide any dependent task, sprint gate,
service behavior, native artifact, publication, or release. The coordinator
should preserve attempts 1–3 and record this accepted leaf review before any
separate reconciliation/revalidation or successor decision.
