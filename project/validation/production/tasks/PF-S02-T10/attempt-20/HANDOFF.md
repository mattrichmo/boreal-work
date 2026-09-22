# PF-S02-T10/T06 recovery-and-status remediation — attempt 20 handoff

## Disposition

**Bounded blocker handoff; not accepted.** The requested focused validation was
run and the attempt is closed without waiting on unrelated streams. No plan or
state files were edited, and no commit or push was made.

## Changed paths

Attempt 20 added only its evidence files:

- `project/validation/production/tasks/PF-S02-T10/attempt-20/START.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-20/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-20/EVIDENCE.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-20/HANDOFF.md`
- `project/validation/production/tasks/PF-S02-T10/attempt-20/INTEGRATION-REQUESTS.md`

The production changes visible in the worktree belong to earlier, still
unaccepted stream attempts and were not rewritten here.

## Cleared in the current tree

- Store profile-requirement targets and `production_integration`: pass.
- Recovery records: 11/11 pass.
- Store Clippy, formatting, contract validation, and diff checks: pass.
- Application status adapter compilation: reached tests; the former missing
  schedule/activation fields are no longer the reported compile blocker.

## Residual blockers

### P0 — Status snapshot remains N+1

`crates/store/src/lib.rs` still calls the per-work helper in the row loop, and
the exact 250-work regression reports 762 prepared statements. Add one
project-scoped loader returning a work-id keyed result map, preserve a per-work
diagnostic for malformed planning facts, and consume/remove that map while
decoding rows. Do not fall back to retry timestamps or make one bad planning
row abort healthy siblings.

### P0 — Guided lifecycle cannot claim the distinct-work fixture

The application test fails before expiry resolution with the canonical live
resource unique index. Resolve the actual current-tree key/fixture collision
at the store boundary without weakening
`boreal_resource_live_key`. Then resume the expiry portion of the test.

### P0 — Recovery resolution/resource acknowledgement still needs proof

The earlier post-expiry failure remains unproven in the current combined
application flow: resolving an obligation as `released` must either atomically
acknowledge the exact canonical reservation bound by project/work/attempt/fence
or be rejected until the explicit acknowledgement occurs. It must retain
operation/audit readback and idempotency, reject wrong project or stale
attempt/fence identity, allow distinct resource keys, and preserve a genuine
same-resource conflict. The passing isolated recovery tests do not establish
this full guided-flow contract.

## Next safe action

Create a new bounded remediation attempt after inspecting the current resource
key collision. Implement the project batch loader and the identity-bound
release/acknowledgement contract, add the requested regressions, then rerun the
exact command set in `COMMANDS.md`. Independent review and combined-tree
revalidation are still required before any ledger disposition.
