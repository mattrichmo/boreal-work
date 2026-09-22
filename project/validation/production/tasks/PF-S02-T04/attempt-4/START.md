# PF-S02-T04 — Attempt 4 start

## Assignment

- Task: `PF-S02-T04` — persist immutable acceptance profiles and pinned requirements.
- Attempt: `4`.
- Worker scope: `crates/store/src/profiles.rs`, `crates/store/tests/production_profile_requirements.rs`, and this attempt evidence directory only.
- Worker must not edit plan/state, shared root/schema/application files, commit, or push.

## Input identity

- Branch: `codex/apply-responsive-terminal-overlay`.
- Input `HEAD`: `70514f0ed2521df710c3c913f50ff9d759f5e743`.
- Worktree: intentionally dirty combined tree containing unaccepted PF-S02-T10, PF-S02-T11, and PF-S03-T10 changes, plus nested local `memory/` runtime data.
- This attempt preserves those concurrent changes and makes no acceptance claim for them.

## Context read

Read before editing:

- `AGENTS.md`.
- `project/build-plan/production-completion/execution/AGENT_START.md`.
- `project/build-plan/production-completion/execution/PARALLEL_DISPATCH.md`.
- `project/build-plan/production-completion/execution/SHARED_FILES.md`.
- `project/build-plan/production-completion/sprints/PF-S02/SPRINT.md`.
- `project/build-plan/production-completion/sprints/PF-S02/tasks/PF-S02-T04.md`.
- PF-S02-T04 attempts 1–3 and their handoffs/evidence.
- PF-S02-T10 attempt 18 `EVIDENCE.md` and `COMMANDS.md`.
- `project/build-plan/REVIEW_GATES.md`.

## Investigation boundary

The combined-tree store suite reported two failures in the profile target at
lines 576 and 614. Reproduction showed both reads returned the schema-integrity
diagnostic `pinned requirement schema is not installed through the production
opener`, because the corruption fixtures intentionally dropped an immutable
child trigger and then immediately read back the row. The current strict
read-only schema check correctly fails closed before inspecting the corrupted
data. The remediation will preserve that check and restore the trigger after
the fixture-only corruption mutation, so the assertions exercise the intended
missing-child and malformed-declaration diagnostics without weakening
immutability enforcement.

## Acceptance posture

This is a bounded remediation handoff. It does not accept PF-S02-T04,
PF-S02-T10, PF-S02-T11, PF-S03-T10, PF-S02, or any production/release gate.
