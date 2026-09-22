# PF-S01-T02 attempt 1 — evidence

## Evidence identity

- Record: `PF-S01-T02/attempt-1`
- Evidence class: source/contract static inspection
- Setup: repository working tree; no database or live service touched
- Input prerequisite evidence: accepted `PF-S00-T92` attempt 6 and accepted `PF-S01-T01` review revision 2
- Product artifact: `project/spec/production/identity-revisions-authority.md`
- Acceptance status: **not accepted**; coordinator/reviewer decision remains outstanding

## Scope covered

The artifact defines project, workspace, database instance, restore epoch,
service instance, principal, actor, role, session, and delegation identity;
separates snapshot/entity/proof/attempt revisions and attempt fences; defines
credential lifecycle and threat cases; specifies operation ID and immutable
request digest scope; distinguishes pending, accepted, rejected, and unknown;
defines deadline/readback/not-found rules; covers wrong project/actor, stale
entity/proof/fence, restore, expiry, and role/delegation cases; and records
same-user filesystem/process limitations.

## Checks

The command results are in `COMMANDS.md`; raw logs are in this attempt
directory. Static checks can establish document structure/whitespace and
repository fixture validity only. They cannot establish authenticated service
behavior, transaction atomicity, restore implementation, or acceptance.

## Limitations

- No Rust source or protocol implementation was changed.
- No real service request, operation readback, database restore, credential
  rotation, process race, or same-UID adversarial test was run.
- The existing worktree was dirty before this attempt; the final handoff must
  identify the dirty source context and the coordinator must rerun relevant
  checks on the integrated tree.

