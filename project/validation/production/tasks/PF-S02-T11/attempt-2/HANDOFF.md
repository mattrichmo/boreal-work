# PF-S02-T11 — attempt 2 handoff

## Identity and disposition

Task / plan version / attempt: `PF-S02-T11 / production-completion v1 / attempt-2`  
Worker: coordinator implementation lane  
Reviewer: not assigned  
Disposition: `blocked` / awaiting shared integration  
Starting source: branch `codex/apply-responsive-terminal-overlay`, HEAD
`784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree

## Changes

Within the assigned boundary:

- added a durable-job application adapter and typed resolution model to
  `crates/application/src/evidence.rs`;
- added the real SQLite-backed focused test at
  `crates/application/tests/production_external_jobs.rs`;
- added this attempt's evidence files.

Unchanged because no safe seam exists in the grant:

- `crates/application/src/runtime.rs`;
- `crates/memory/src/publisher.rs` (absent from the source tree);
- `crates/cli/src/update.rs`;
- canonical evidence-store/sqlite adapter/service/store-root paths;
- plan `STATE.json` and `PLAN_PACKAGE_MANIFEST.json`.

The existing dirty change in `crates/cli/src/update.rs` predates this attempt;
it was inspected but not modified here.

## Evidence summary

Focused adapter tests: 3/3 passed. Full application: passed. Full CLI: passed.
Contract validation, formatting check, and diff check: passed. Full memory
package: failed two concurrent publisher tests with lock-conflict errors; no
memory source was changed.

Exact commands, test names, and source hashes are in `COMMANDS.md`.

## Required next integration

1. Grant the memory steward the existing publisher implementation path or
   split/register it without introducing a second publisher.
2. Grant the canonical evidence transaction paths and bundle evidence
   admission/readback with external-job registration, operation identity,
   audit, and revision in one transaction.
3. Wire expiry/failure/stop/release to recovery obligations and resource
   acknowledgement in the canonical lifecycle boundary.
4. Add durable project/actor/operation context and installer/assets readback to
   update and backup adapters; uncertain effects must remain pending.
5. Move recovery/job schema installation into the ordered migration ledger and
   rerun the required fresh/reopen/upgrade checks.

This attempt is not acceptance evidence for PF-S02-T11 and must not be marked
accepted without those integrations and an independent review on the combined
tree.

- [x] No receipt, accepted proof, or external success was fabricated.
- [x] Pending and readback-required states remain distinct from resolved state.
- [x] Project and request-digest identity are checked on readback.
- [x] Prior evidence and the existing memory failures were preserved.
- [ ] Canonical verifier/memory/update/backup/recovery integration.
- [ ] Independent review and task acceptance.
