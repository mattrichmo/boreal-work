# Task handoff — PF-S03-T08 attempt 4

## Identity and disposition

- Task / plan / attempt: `PF-S03-T08` / `PF-production-completion-2026-09-21` /
  `attempt-4`.
- Worker: bounded pure-domain validation worker (Codex).
- Reviewer: independent review still required.
- State requested: `ready_for_review`.
- Input/final committed source identity:
  `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`, dirty combined worktree.
- Prerequisites/context: PF-S03 sprint/T08/T10 cards, transition table,
  status/action contract, reason registry, contract manifest, and attempts 1–3
  were read; prior failed/rejected evidence is retained.

## Changes and invariant

Changed only within the granted boundary:

- `crates/domain/tests/production_properties.rs`
- `project/validation/production/domain/PF-S03-T08-ORACLE.md`
- `project/validation/production/domain/PF-S03-T08-ORACLE-SOURCE.md`
- `project/validation/production/tasks/PF-S03-T08/attempt-4/`

The executable target now source-binds the current committed revision and
bound bytes, and maps every `T01`–`T18` / `I01`–`I15` vector to a distinct
semantic assertion or an explicit pure-domain limit. I04/I06/I08 are covered
by typed competing-fence, independent-review, and close-only dependency
assertions respectively. Schedule/availability/integrity behavior, history
invariance, minimal counterexamples, policy identity, and status/2 queued
compatibility remain explicit.

No production implementation, application, CLI, store, schema, protocol,
plan/state, or other worker path was changed. No shared integration request is
needed. No commit or push was performed.

## Validation

| Command | Exit / result |
| --- | --- |
| `cargo test --locked -p boreal-domain --test production_properties -- --nocapture` | 0; 23/23 passed. |
| `cargo test --locked -p boreal-domain` | 0; 139 unit/integration tests passed, doc-tests 0/0. |
| `cargo clippy --locked -p boreal-domain --all-targets -- -D warnings` | 0; passed. |
| `rustfmt --edition 2021 --check crates/domain/tests/production_properties.rs` | 0; passed. |
| `cargo fmt --all -- --check` | 1; unrelated pre-existing drift in `crates/cli/src/update.rs` and `crates/memory/tests/publisher.rs`. |
| `python3 project/spec/validate_contracts.py` | 0; passed. |
| `git diff --check` | 0; passed. |

Exact argv, cwd, toolchain, source hashes, failed intermediate observations,
and the regeneration rule are in `COMMANDS.md`; the full evidence and layer
limits are in `EVIDENCE.md`.

## Impact and residual work

- Schema/migration/protocol/application/service impact: none; this is a test
  and evidence-only change.
- Authority/history impact: pure validators fail closed for competing fences,
  missing/foreign/stale proof, self-review, rejected outcomes, and non-closed
  dependencies while retaining raw historical facts.
- Pure-domain limits: no store transaction, service operation journal,
  authenticated route, genuine verifier, external process recovery, or
  status/3 serialization claim is made. T18 and I14 remain explicit service
  boundaries.
- Regeneration: if final integration changes `HEAD` or any bound file, update
  `PF-S03-T08-ORACLE-SOURCE.md`, recompute its hashes, rerun focused
  `production_properties -- --nocapture`, and refresh this attempt's identity
  records. The current exact source subject is the hash above.
- Next safe task: independent review of attempt-4, then coordinator
  reconciliation and PF-S03-T90 → T91 → T92 revalidation on the exact combined
  tree. This handoff does not claim task, sprint, or release acceptance.

- [x] No test/run/peer/native success was inferred or fabricated.
- [x] Failed/intermediate/history records remain preserved.
- [x] All changed paths fit the granted boundary.
- [x] Acceptance remains pending independent review and coordinator decision.
