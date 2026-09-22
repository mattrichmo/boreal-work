# PF-S02-T11 — attempt 4 corrective handoff

## Identity and disposition

Task / plan / attempt: `PF-S02-T11 / production-completion v1 / attempt-4`  
Worker: corrective application adapter lane  
Reviewer: coordinator must assign an independent reviewer  
Disposition: **ready for independent review as a bounded contribution; full
task rejected/unaccepted**  
Repository: `/Users/cybertron/Code/boreal-work`  
Source HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Worktree: dirty combined tree; no unrelated changes were reset or overwritten.

## Changed paths

- `crates/application/src/evidence.rs`
- `crates/application/tests/production_external_jobs.rs`
- `project/validation/production/tasks/PF-S02-T11/attempt-4/START.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-4/COMMANDS.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-4/EVIDENCE.md`
- `project/validation/production/tasks/PF-S02-T11/attempt-4/HANDOFF.md`

`crates/application/src/runtime.rs` was inspected but not functionally
changed. `crates/cli/src/update.rs` retains an existing formatting-only
worktree change. `crates/memory/src/publisher.rs` does not exist and was not
created because the authoritative `Publisher` is in protected
`crates/memory/src/lib.rs`; creating an unregistered duplicate would be dead
code and a second state machine.

## Integration requests for the coordinator

1. Add a reviewed shared-boundary integration at the canonical evidence/store
   mutation seam so evidence admission, external-job admission, operation
   identity, audit, and proof-relevant revision commit atomically.
2. Add the same durable operation/job/readback context to the authoritative
   memory publisher, backup path, and update activation path. Memory publication
   must use the existing `Publisher` in `crates/memory/src/lib.rs`, not a new
   module here.
3. Wire expiry, stop, release, cancellation, and restart recovery to durable
   obligations and resource acknowledgements in store/service lifecycle paths.
4. Resolve the existing store clippy failure at
   `crates/store/src/profiles.rs:505` in its owning task; it is outside this
   attempt's write scope.
5. Run independent review, reconciliation, exact-tree revalidation, and the
   real-service/release acceptance matrix before accepting PF-S02-T11.

## Safe next action

Assign an independent reviewer to rerun the focused and package checks against
this exact combined tree, verify the new readback identity tests, and confirm
that the bounded contribution is integrated without promoting it to full task
acceptance. Preserve attempts 1–3 and this record.

- [x] No receipt, accepted proof, Git publication, backup result, update
      success, or lifecycle recovery completion was fabricated.
- [x] Pending/readback-required and resolved states remain distinct.
- [x] Readback is bound to project, job, operation, request digest, and
      side-effect identity.
- [x] Focused and package validation results are recorded with exact limits.
- [ ] Canonical verifier/memory/update/backup/lifecycle integration.
- [ ] Independent review, reconciliation, exact-tree revalidation, and task
      acceptance.

