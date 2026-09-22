# PF-S02-T11 — attempt 12 worker start

## Scope

Task / plan / attempt: `PF-S02-T11 / production-completion v1 / attempt-12`

Repository: `/Users/cybertron/Code/boreal-work`

Input source: `HEAD b543d410` on `codex/apply-responsive-terminal-overlay`.

The previous application adapter review attempts (9–11) are preserved and
remain unaccepted. This attempt repairs the declared worker paths only:

- `crates/application/src/runtime.rs`
- `crates/application/src/evidence.rs`
- `crates/cli/src/update.rs`
- `crates/application/tests/production_external_jobs.rs`
- this evidence directory

## Invariant and intended change

External work must be admitted with the original project/operation/request
identity before the side effect starts. Interrupted work remains pending or
readback-required until attributable readback reconciles it; rejected and
failed outcomes remain terminal without fabricating receipts, acceptance, or
release completion. Expiry/release must expose the durable recovery
obligation and leave resource acknowledgement unresolved until an explicit
acknowledgement is recorded.

The implementation adds reusable application-level execution/recovery seams
and adapter-level tests. Memory publication is not edited: the current memory
crate has a monolithic protected `crates/memory/src/lib.rs` and no
`crates/memory/src/publisher.rs`; registering a new module and connecting its
canonical job port is therefore an explicit integration request. The same
protected-root limitation applies to the CLI/update call site in
`crates/cli/src/main.rs` and application adapter registration.

## Verification strategy

Run the task-specific application external-job target, package checks for
memory and CLI, formatting/diff checks, and the relevant store boundary suite.
Record exact commands, source/file identities, results, limitations, and the
bounded integration requests in this attempt directory. No task acceptance or
plan-ledger change is performed by this worker.
