# PF-S02-T06 — attempt 1 evidence

Record ID / task / attempt / acceptance-row IDs: `PF-S02-T06 / attempt-1 / task checklist`

Evidence class: store source plus real-SQLite focused tests in an isolated
registered-source copy; repository integration is blocked on the protected
root registration.

Input source archive/commit/tree hash: `784a41b3802c29a76721c55eef2e9493283396c2`; dirty combined worktree.

Built binary/package/assets/schema/contract/runtime hashes and versions:

- No release binary was built for this bounded store seam.
- Contract validator passed against the current repository contract files.
- Final worker source hashes are recorded in `HANDOFF.md`.

Host OS/architecture / terminal geometry / clock or failpoint mode: local
macOS host; disposable in-memory SQLite; deterministic `unix-ms:*` fixture
timestamps; no terminal geometry or external process was involved.

Setup type: controlled real-SQLite store fixture. The fixture initializes one
project, two work items, one actor/session, and one current attempt, then
installs the proposed additive tables and indexes in the isolated registered
copy.

| Case | Expected | Observed |
| --- | --- | --- |
| Cleared current attempt | Expiry recovery remains unresolved and queryable | Passed |
| Duplicate live work/session/resource ownership | Database or transaction rejects overlap | Passed |
| Crash after external side effect | Job is `readback_required`, not guessed success; same request replays | Passed |
| Retention | Resolved obligation and recovery decision remain readable | Passed |
| Bounded/cursor queries | Limits are enforced and continuation returns the remaining rows | Passed |

Outcome: isolated registered-source checks passed; repository focused target
blocked before execution by missing coordinator registration.

Raw stdout/stderr/responses/artifacts and SHA-256: command outcomes and the
initial unregistered compiler failure are in `COMMANDS.md`; source hashes are
in `HANDOFF.md`. No secrets, live credentials, or external receipts were
captured.

Operation request identity/digest / authoritative readback: no live Boreal
operation was created. The test uses deterministic IDs only inside a
disposable SQLite fixture and does not claim service acceptance.

Receipt/source/configuration/review identities: no service receipt or
independent review identity exists for this worker attempt yet.

Independent witness/reviewer where required: pending coordinator assignment;
the worker does not self-accept.

Limitations and rerun requirement:

- The new modules are not registered in the actual `crates/store/src/lib.rs`.
- No production migration/ledger entry exists for the new tables or indexes.
- No current expiry/failure/stop lifecycle call site creates an obligation, and
  no application/service path consumes the bounded queries yet.
- New module mutations have their own short transaction but do not themselves
  append the project operation/audit/revision bundle; canonical root/application
  integration must provide that authority boundary.
- Rerun the repository-focused target, full workspace tests, migration tests,
  and an independent review after the shared integration patch is applied.
