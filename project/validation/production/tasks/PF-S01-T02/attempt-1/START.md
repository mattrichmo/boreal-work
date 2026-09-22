# PF-S01-T02 attempt 1 — start

## Identity and boundary

- Task: `PF-S01-T02`
- Attempt: `1`
- Worker lane: named `CONTRACT` worker
- Worker: Codex (implementation worker; exact reviewer is not assigned here)
- Input prerequisite: accepted `PF-S00-T92` attempt 6; accepted `PF-S01-T01` contract review revision 2
- Exclusive product path: `project/spec/production/identity-revisions-authority.md`
- Exclusive evidence path: `project/validation/production/tasks/PF-S01-T02/attempt-1/`
- Protected paths: source, plan/state ledgers, database, shared files, and all other evidence are read-only

## Interpreted invariant

The local product needs one application-owned identity context and four
independent concurrency/proof domains: project snapshot revision, entity
revision, proof-context revision, and attempt revision/fence. Every mutation
must authenticate actor/role/delegation in project scope, carry an operation ID
and immutable request digest, and resolve accepted/rejected/pending/unknown
outcomes through authoritative readback. Restore epochs and same-user
filesystem limits must prevent false continuity without claiming protection
from unrestricted same-UID database edits.

## Intended change

Add the normative PF-S01-T02 contract at the exclusive product path. Do not
change Rust source, protocol fixtures, plan files, runtime state, database,
shared manifests, or prior evidence. Produce fresh attempt evidence only in
this directory.

## Verification strategy

Run the repository contract validator, Markdown whitespace/fence checks, and
`git diff --check` against the changed artifact. Record exact source/tree
identity, commands, outcomes, and limits. This is contract/static evidence;
it is not runtime/service acceptance and does not claim coordinator acceptance.

