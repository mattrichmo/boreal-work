# PF-S02-T11 — attempt 21 targeted repair handoff

## Identity and disposition

- Task / attempt: `PF-S02-T11 / attempt-21`
- Input/final HEAD: `0d9611a017d5dc167e92fe79e8d65756fbac2d5a`
- Branch: `codex/apply-responsive-terminal-overlay`
- Disposition: **ready for independent review; bounded; not accepted**
- Commit/push/plan-state/ledger changes: none

## Changed paths

- `crates/application/src/runtime.rs`
- `crates/application/tests/production_external_jobs.rs`
- `project/validation/production/tasks/PF-S02-T11/attempt-21/`

No store or canonical terminal implementation was changed. Unrelated dirty
paths were preserved.

## Handoff summary

The standalone identity-bound request and acknowledgement helpers now fail
closed before any legacy store mutation. The canonical terminal store
transaction remains responsible for admitting `release_pending`; the existing
identity-bound recovery resolution remains responsible for the atomic
acknowledgement/reusable transition. The terminal post-check only verifies
that canonical admission occurred and reports an unknown outcome when a
non-canonical adapter leaves a matching resource active/unknown.

## Verification

Application unit/integration tests, focused recovery/store tests, strict
application clippy, owned-file rustfmt, final workspace formatting, and owned
diff checks passed. Exact commands, counts, source hashes, and the one
corrected intermediate clippy finding are in `COMMANDS.md`; behavior and
remaining scope are in `EVIDENCE.md`.

## Independent review questions

1. Confirm both standalone helper symbols reject before identity preflight or
   legacy mutation.
2. Confirm the real `SqliteAttemptAdapter` terminal test still reaches
   `release_pending` and identity-bound recovery resolution still releases the
   resource.
3. Confirm the fail-closed fallback test does not claim service or external
   adapter acceptance.
4. Keep the remaining atomic store seam as follow-up scope; do not restore the
   standalone mutation helpers without a committing store-boundary check.
