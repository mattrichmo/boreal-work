# PF-S03-T08 — attempt 4 start

## Identity and boundary

- Task: `PF-S03-T08` — property, differential and exhaustive transition tests.
- Plan: `PF-production-completion-2026-09-21`.
- Input/integrated source revision: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a` on
  `codex/apply-responsive-terminal-overlay`; worktree dirty with unrelated
  worker paths preserved.
- Worker: bounded pure-domain validation worker (Codex).
- Prior evidence: attempts 1 and 2, plus attempt 3, remain unchanged. Attempt 2
  rejected the leaf for six coverage/binding defects; attempt 3 was not treated
  as accepted evidence.

## Granted write boundary

- `crates/domain/tests/production_properties.rs`
- `project/validation/production/domain/`
- `project/validation/production/tasks/PF-S03-T08/attempt-4/`

No production implementation, application, CLI, store, plan/state, manifest,
protocol registry, or other worker path was edited. No reset, checkout, delete,
commit, or push was performed.

## Interpreted invariant

The pure decision and validation layer must remain deterministic over canonical
facts, actor/policy identity, and evaluation time. Every normative `T01`–`T18`
and `I01`–`I15` row must either execute a distinct pure-domain semantic
assertion or remain an explicit service-only boundary. In particular, I04 must
reject a competing fenced attempt, I06 must require an independent review, and
I08 must reject non-closed prerequisite outcomes while retaining raw facts.
Status/2 queued compatibility is preserved; no status/3 serializer is added or
advertised.

## Baseline and repair scope

An initial focused probe during setup was unsupported because the T08-owned
source record included by the test target was absent (exit `101`); this failed
observation is retained in `COMMANDS.md`. The repair added/updated only the
source-bound oracle record, executable test assertions, and attempt evidence.
The source record binds the current committed `HEAD`, contract bytes, domain
implementation bytes, test bytes, and the required regeneration rule for a
later integration revision.

Independent review and coordinator acceptance remain required; this attempt
does not close PF-S03-T08, PF-S03, or the release.
