# PF-S02-T11 — attempt 8 independent bounded review handoff

## Identity and disposition

Task / plan / attempt: `PF-S02-T11 / production-completion v1 / attempt-8`  
Reviewer: independent reviewer  
Source: dirty combined worktree at `HEAD`
`784a41b3802c29a76721c55eef2e9493283396c2`  
Disposition: **bounded store contribution accepted; full task rejected/unaccepted**

## Reviewed contribution

- `crates/store/src/jobs.rs`
- `crates/store/tests/production_external_job_boundary.rs`

The contribution correctly fails closed for legacy public job registration,
transition, and read paths on canonical and bound stores; validates current
project/database lineage on identity-bound paths; binds operation, audit,
project, subject, actor, session, request digest, and replay identity; rolls
back illegal or mismatched mutations without fabricated job progress; and
retains the genuinely legacy schema-v2 fixture path.

## Fresh verification

- Focused external-job boundary: exit 0, 4/4 passed.
- Recovery and operation/audit suites: exit 0, 7/7 and 15/15 passed.
- Full `cargo test --locked -p boreal-store`: exit 0; executed tests passed,
  with one explicitly ignored release benchmark.
- `cargo fmt --all -- --check`: exit 0.
- `git diff --check`: exit 0.

## Required follow-up

Full PF-S02-T11 must remain rejected/unaccepted until the application/service
adapters route verifier, memory publication, backup, update, stop, release,
cancellation, and restart recovery through the durable identity-bound
job/readback boundary, with attributable real-service and release evidence.
The current evidence is store/package-test evidence only and must not be
represented as complete product acceptance.
