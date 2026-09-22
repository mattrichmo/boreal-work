# PF-S02-T11 — attempt 13 worker start

## Scope and source identity

- Task: `PF-S02-T11 — Wire application adapters to durable recovery and external jobs`
- Attempt: `13`
- Repository: `/Users/cybertron/Code/boreal-work`
- Input source: `HEAD 70514f0e` on `codex/apply-responsive-terminal-overlay`
- Worker paths only:
  - `crates/application/src/runtime.rs`
  - `crates/application/src/evidence.rs`
  - `crates/cli/src/update.rs`
  - `crates/application/tests/production_external_jobs.rs`
  - this attempt evidence directory

## Invariant

Every external side effect must be admitted with the project, operation,
request, and subject identity before it starts. An interrupted or unknown
effect remains pending/readback-required until attributable readback resolves
it; no adapter may synthesize a receipt, acceptance, release, publication, or
upgrade success. Expiry and stop/release preserve unresolved recovery until a
durable acknowledgement is recorded.

## Intended work

Audit the current adapter implementation at `70514f0e`, repair only defects
inside the granted worker paths, and add real adapter-level coverage for
identity binding, idempotent admission, pending/readback/rejected outcomes,
restart recovery, expiry/resource release, and durable update behavior.
Protected call sites and the monolithic memory root remain integration
requests; they are not bypassed or replaced by a disconnected module.

## Verification plan

Run the focused external-job target, application and CLI suites, memory tests,
recovery boundary tests, formatter/diff checks, and the repository contract
validator. Record exact results, limitations, and all protected-root requests
in `COMMANDS.md`, `EVIDENCE.md`, `HANDOFF.md`, and
`INTEGRATION-REQUESTS.md` as applicable. Do not edit plan/state or commit/push.
