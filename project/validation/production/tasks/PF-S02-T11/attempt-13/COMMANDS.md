# PF-S02-T11 — attempt 13 verification commands

## Source and scope

- Input/base source: `HEAD 70514f0ed2521df7103c3c913f50ff9d759f5e743`
- Branch: `codex/apply-responsive-terminal-overlay`
- Worker edits in this attempt: `crates/application/src/evidence.rs`,
  `crates/application/tests/production_external_jobs.rs`, and this evidence
  directory.
- `crates/application/src/runtime.rs` and `crates/cli/src/update.rs` were
  audited but not changed in this attempt.
- No commit, push, plan/state, sprint-gate, or protected-root mutation was
  performed. The pre-existing untracked `memory/` runtime tree was preserved.

## Checks

| Command | Result |
| --- | --- |
| `cargo test --locked -p boreal-application --test production_external_jobs` | PASS — 11 passed, including replay non-duplication. |
| `cargo test --locked -p boreal-application --lib runtime::tests` | PASS — 6 passed. |
| `cargo test --locked -p boreal-application` | BLOCKED — 40 unit tests and boundary/knowledge/status targets passed; `p2_guided_flow_claims_three_harnesses_and_fences_recovery` failed on `UNIQUE constraint failed: boreal_resource_reservation.project_id, boreal_resource_reservation.resource_key`. The failure is in the protected store-backed lifecycle path, not the T11 focused target. |
| `cargo test --locked -p boreal-cli update::tests` | PASS — 5 update adapter tests passed. |
| `cargo test --locked -p boreal-memory` | PASS — 9 unit tests, 22 publisher tests, 0 doc-test failures. |
| `cargo test --locked -p boreal-store --test production_recovery_records --test production_external_job_boundary` | PASS — 11 recovery and 4 external-job tests passed. |
| `rustfmt --edition 2021 --check` on all four worker source/test paths | PASS. |
| `cargo fmt --all -- --check` | BLOCKED — unrelated pre-existing formatting drift remains in `crates/domain/tests/production_properties.rs` and `crates/store/src/recovery.rs`; the worker-owned paths pass. |
| `python3 project/spec/validate_contracts.py` | PASS — 8 envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transitions, 19 clock/dependency cases, 52 mappings, and schema parsing. |
| `git diff --check` | PASS. |

The focused build emits expected dead-code warnings for identity-bound
recovery methods and the not-yet-registered CLI update seam because their
protected callers are outside this worker set.

## Worker-file identities at handoff

```text
crates/application/src/runtime.rs                 6d35a839c235e7fa6e2b3ec355a3c2bc12c0a130f7e09479b2a4e1b3ab520d7e
crates/application/src/evidence.rs                43577fa09f1ad1fd622b97ae42b121fb945c92718e7b05ff857f18d78032461d
crates/cli/src/update.rs                          454f99531ceb6981e78a9c4c7f44d55e34461f2a5675eca4d0a57f2ddde62e3d
crates/application/tests/production_external_jobs.rs 48fd15b48e8c09c7b33ac02798df72bfee35d2001446407a7ab450ceb172afa1
```
