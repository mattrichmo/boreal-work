# PF-S02-T04 — Attempt 5 start record

## Scope

- Task: `PF-S02-T04` — persist immutable acceptance profiles and pinned requirements.
- Attempt: `5`.
- Input source: `3017a1dbebaa7945f82b2a2512ec0c1eabbd69c9` (`HEAD` at dispatch).
- Worktree: dirty before this attempt due to coordinator evidence changes and the untracked local `memory/` runtime repository. Those paths were not edited.
- Worker write set: `crates/store/src/profiles.rs`, `crates/store/tests/production_profile_requirements.rs`, and this attempt directory only.
- Protected integration path: `crates/store/src/lib.rs`; no edit was made here.

## Prerequisites and contract

The accepted bounded prerequisite handoffs read before editing were:

- `PF-S02-T02/attempt-4/HANDOFF.md` — accepted transaction/store seam.
- `PF-S02-T03/attempt-4/HANDOFF.md` — accepted identity/revision seam, with broader root wiring limitation retained.
- `project/spec/production/contract-manifest.json` — `boreal.acceptance/2` and pinned source/profile contracts.

The invariant is that profile content and resolved requirement declarations are immutable, versioned, content-bound, and independent from observed gate/receipt rows. A missing current snapshot is corruption, never an empty acceptance policy.

## Baseline

The existing focused target passed 13 tests on the input source before this attempt. The input file hashes were:

```text
c709d56e7f4cbe02eb84a7a2e6a5911ed71c6b3c3d2c4684ba8888bab9f59e2b  crates/store/src/profiles.rs
28535da49cf5f2d620873519feee0960c77e3b217dae1c88aebac4c079c0efb4  crates/store/tests/production_profile_requirements.rs
```
