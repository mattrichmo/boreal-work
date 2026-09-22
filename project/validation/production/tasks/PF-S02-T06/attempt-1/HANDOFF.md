# PF-S02-T06 — attempt 1 handoff

## Identity and disposition

Task / plan version / attempt: `PF-S02-T06 / production-completion v1 / attempt-1`

Worker / reviewer: bounded store worker / reviewer pending

State requested: `awaiting_integration`

Input source identity / final worker source identity: `HEAD
784a41b3802c29a76721c55eef2e9493283396c2`; final source remains dirty and
uncommitted. Worker file hashes:

```text
8ac85345aa306d1e65888afbf9e409df4d3a843d5a5f6456fa30e51081e1191a  crates/store/src/recovery.rs
6842104b80d704f7dcd05dc380a789c83d81150373342db4dd3b020935aabb47  crates/store/src/jobs.rs
2a7f43722c61a9f3e9ec73fe5d7737d2db2b6facffd0307d9322a6b90acf5191  crates/store/tests/production_recovery_records.rs
d905203aa71a0f126602338e1c532a429d8c18490a5715d6e40ee02e736da314  project/validation/production/tasks/PF-S02-T06/attempt-1/START.md
```

Prerequisite handoffs and accepted contract versions: PF-S02-T02 attempt 4 and
PF-S02-T03 attempt 4 accepted bounded store seams at the same combined source
identity. The worker consumed the PF-S02 sprint context and PF-S01 production
contract manifest at the dispatched revision.

## Changes and invariant

Exact changed files and granted boundary:

- `crates/store/src/recovery.rs`
- `crates/store/src/jobs.rs`
- `crates/store/tests/production_recovery_records.rs`
- this attempt's evidence files only

No protected/shared file was edited.

Invariant implemented/audited:

- Recovery obligations are independent of `attempt.current`, retain subject,
  fence, reason, resource state, next action and resolution identity, and keep
  append-only decision history.
- Resource reservations remain live through `active`, `release_pending`, or
  `unknown`; only an explicit release acknowledgement makes a resource
  reusable. A partial unique index rejects live overlap per project/resource.
- Existing attempt rows receive fail-closed unique indexes for one current work
  owner and one current session execution.
- External jobs are registered by operation/request digest, transition through
  explicit stages, preserve side-effect identity, and expose
  `readback_required` after a crash window. Same request replays; changed input
  conflicts.
- Recovery/job lists are project-scoped and keyset-bounded.

Before/after behavior and reproduced finding: the baseline expiry path can
clear current attempt/reservation state without an independent unresolved
recovery record. The proposed seam preserves that record and tested it after
clearing `current` in a real SQLite fixture.

## Shared integration request

The coordinator/store steward must apply these changes on the combined tree:

1. Register `pub mod recovery;` and `pub mod jobs;` exactly once in
   `crates/store/src/lib.rs`.
2. Add an ordered additive production migration/ledger step for the tables,
   triggers, and indexes created by `ensure_recovery_schema` and
   `ensure_external_job_schema`. It must run from the canonical opener, not as
   a first-use lazy write, and must verify fresh/upgrade/reopen/rollback
   behavior. Existing duplicate live rows must fail closed.
3. Invoke the schema seams from the canonical migration/open path only after
   the existing schema identity/preflight boundary succeeds.
4. Wire expiry/failure/uncertain-stop and resource stop/release application
   paths to create and resolve obligations transactionally with the root
   operation, audit, and project-revision bundle. The module-level APIs are
   storage primitives; they do not authorize lifecycle progress by themselves.
5. Wire verifier/Git/backup/update adapters to register and read back jobs
   before/after external side effects. A timeout or crash must remain pending
   or readback-required until an attributable reconciliation result is stored.

Required shared integration paths: `crates/store/src/lib.rs`, production schema
manifest/migration ordering, and the relevant application/service call sites.
The worker was not granted those paths and made no edits there.

## Validation

| Case / command argv and cwd | Source/binary/runtime identity | Expected assertion | Actual outcome / exit | Raw evidence |
| --- | --- | --- | --- | --- |
| `cargo test --locked -p boreal-store --test production_recovery_records` in repository | `784a41b…`, actual dirty tree | Registered module target runs | Exit 101 before tests; root lacks `jobs`/`recovery` registration | `COMMANDS.md` |
| `cargo clippy --offline -p boreal-store --all-targets -- -D warnings` in isolated registered copy | Current worker files plus temporary root registrations | Strict lint | Exit 0 | `COMMANDS.md` |
| `cargo test --offline -p boreal-store --test production_recovery_records` in isolated registered copy | Same worker files, disposable SQLite | Five T06 cases pass | Exit 0; 5 passed | `COMMANDS.md` |
| `cargo test --offline -p boreal-store` in isolated registered copy | Same worker files, temporary two-member workspace | Existing store suite remains green | Exit 0; all store targets passed, one intentional ignore | `COMMANDS.md` |
| `python3 project/spec/validate_contracts.py` in repository | Actual dirty tree | Contract parser remains valid | Exit 0 | `EVIDENCE.md` |
| `rustfmt --edition 2021 --check ...` and `git diff --check` | Worker files / actual tree | No worker formatting or whitespace errors | Exit 0 | `COMMANDS.md` |

Real service operation/readback IDs: none; no live service mutation was
attempted.

Verifier command/environment, receipt/artifact IDs: none; test fixtures are
explicitly not service receipts.

Review principal/decision/context: pending independent reviewer after shared
integration.

Native installed/published identity where required: not applicable to this
store-only attempt.

## Impact and residual work

Schema/migration/rollback impact: additive tables, triggers, partial unique
indexes, and bounded-query indexes are specified in the new module seams but
not yet in the canonical migration ledger. The steward must add and verify the
ordered migration and rollback/preflight behavior.

Protocol/status/reason/action compatibility: no protocol or status enum was
changed. Application status must consume unresolved recovery facts and keep
`expired_review`/intervention distinct from ordinary queued dependencies.

Authority/isolation/security/history impact: APIs require project-scoped
subjects and exact attempt/fence matching for resource ownership; operation,
actor authentication and audit authority still belong to application/root
integration. Historical records are retained rather than swept.

Source/memory/retention/package effects: none in this bounded lane.

Known limitations/new findings/approved optional deferrals: integration is
required before this task can be accepted. The coordinator must reconcile the
module-local transaction boundary with the root operation/revision/audit
boundary and add production call-site tests. This is mandatory work, not an
optional deferral.

Next safe task and required revalidation: apply the shared integration request,
run the repository focused target and full locked store/workspace gates, then
assign an independent reviewer against the exact combined source identity.

- [x] No test/run/peer/native success was inferred or fabricated.
- [x] Failures/history retained; secrets excluded from exported evidence.
- [x] All worker production paths fit the granted boundary; shared registration
      remains explicitly pending.
- [ ] Coordinator acceptance recorded; this handoff requests integration only.
