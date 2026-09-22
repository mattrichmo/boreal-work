# PF-S03-T04 attempt 2 — independent validation evidence

## Attributable decision

**Reviewer:** Codex independent validation reviewer
**Task:** `PF-S03-T04` only
**Decision:** **REJECTED**
**Reason:** Fresh checks pass, but two PF-S03-T04 proof/review interpretation
findings fail the production acceptance contract and can produce an incorrect
effective result.

This is not a sprint, service, native, publication, or release decision.

## Evidence reviewed

- Full PF-S03-T04 card, SHA-256 `cda28b913779aaf8e8e36159548e46872cdc832c32c5122c37bc11d3acee5a12`.
- Accepted PF-S03-T01 attempt-2 handoff, SHA-256 `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
- Worker PF-S03-T04 attempt-1 evidence and handoff; the worker reported the task as awaiting integration, not accepted.
- Current `crates/domain/src/acceptance.rs`, SHA-256 `cc1f3e25fc1b5399c592aa793bf1ca70cc37f46a86b5c85bd8db525637bc5ffd`.
- Current `crates/domain/tests/production_acceptance_policy.rs`, SHA-256 `6aa0a3bf8178107e88b2a1d39fa9571814a3758f87d1993776d5a8931a702ff4`.
- Integrated `crates/domain/src/lib.rs`, SHA-256 `6f75fcd37496dbff5bc0d5a51b593696781f47818a44edffcd8617d6ef4f78b2`.
- Accepted production acceptance/proof contract, SHA-256 `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245`.

## Acceptance checks

| PF-S03-T04 concern | Result | Evidence |
| --- | --- | --- |
| Exact complete proof subject is considered before recency | **Rejected** | Exact subject equality is present, but invalidated exact-subject observations are sorted and selected before disposition is applied; see F-PF-S03-T04-01. |
| Missing, failed, stale, altered, irrelevant, declaration, and review facts remain distinct | **Passed for covered pure-domain cases** | `RawRequirementState`, `ReviewState`, and declaration diagnostics are separate; focused test passed. F-PF-S03-T04-01 still affects stale/altered selection precedence. |
| Valid typed force exception preserves raw failure and exception ID | **Passed for covered case** | Focused test passed; `Failed` remains raw and `SatisfiedByException(EX-17)` is returned. |
| Self-review and reviewer role independence | **Partially passed** | Self-review is rejected and role checks exist; focused self-review case passed. Exact sealed-submission binding remains missing; see F-PF-S03-T04-02. |
| Task proof versus container scope/closeout | **Passed for covered cases** | Public constructors reject attempt-bound container proof; closeout kinds and forbidden container attempts are distinct; focused tests passed. |
| Public registration | **Passed** | `crates/domain/src/lib.rs:9` exports `acceptance`; focused test imports the public module. |

## Findings

### F-PF-S03-T04-01 — P1 — invalidated exact proof can shadow valid proof

`crates/domain/src/acceptance.rs:804-818` sorts all exact-subject evidence by
`observed_at` and ID. `:839-873` then selects the last item and only afterward
interprets `Superseded`, `Late`, and `Revoked` dispositions. The production
contract requires explicitly superseded, revoked, late, foreign, and
integrity-invalid observations to be excluded from the authoritative
recency selection while retaining them as history, then requires the newest
valid observation to be selected (`acceptance-and-proof.md:64-80`).

Consequence: an older exact-subject `Current/Passed` observation can be
reported as stale or altered when a newer exact-subject `Superseded`, `Late`,
or `Revoked` observation exists. That can block a requirement that has valid
current proof, or cause a valid failed/current ordering to be replaced by an
invalidated observation. The existing foreign-newer test does not cover this
same-subject invalidation case.

Required bounded correction: classify/retain invalidated observations, but
filter them out of the authoritative candidate set before recency; add
regressions for newer superseded, late, and revoked observations over an
older valid proof, while retaining distinct diagnostics/history.

### F-PF-S03-T04-02 — P1 — review selection is not bound to a sealed submission

`ReviewDecision` stores `submission_id` at
`crates/domain/src/acceptance.rs:273-284`, but `AcceptanceSubject` has no
submission identity and `interpret_review` at `:961-980` selects reviews by
requirement identity and proof subject only. `submission_id` is never
compared with an expected current submission. A review for another sealed
submission in the same proof subject can therefore become the newest exact
review and contribute `Approved` to the current requirement.

The production contract defines review as a decision over one sealed
submission and requires exact submission binding (`acceptance-and-proof.md:
90-111`). This is a proof-scope leak independent of the self-review check.

Required bounded correction: carry the expected sealed submission identity in
the typed acceptance input/subject or equivalent exact review binding, reject
or classify mismatched-submission reviews as irrelevant/stale history, and
add a regression showing a newer review for another submission cannot approve
the current requirement.

## Fresh command evidence

All commands ran from the repository root on HEAD
`784a41b3802c29a76721c55eef2e9493283396c2` with Rust/Cargo `1.85.0`:

- `cargo fmt --all -- --check` — exit `0`.
- `cargo check --locked -p boreal-domain --tests` — exit `0`.
- `cargo test --locked -p boreal-domain --test production_acceptance_policy` — exit `0`, 10 passed.
- `cargo test --locked -p boreal-domain` — exit `0`, 69 passed, 0 doc tests.
- `cargo clippy --locked -p boreal-domain --test production_acceptance_policy -- -D warnings` — exit `0`.
- `cargo clippy --locked -p boreal-domain --lib -- -D warnings` — exit `0`.

The checks establish compilation, focused behavior, full domain behavior, and
strict lint cleanliness. They do not override the source-level findings.

## Scope limits and preserved history

The worker's attempt-1 evidence remains untouched. This review did not edit
product source, `STATE.json`, or any coordinator/sprint record. The
`service_busy` workflow probe is not treated as a product failure or as
acceptance evidence. No service/store projection, genuine verifier execution,
native installation, publication, or release behavior is claimed.
