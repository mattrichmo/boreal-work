# Plan change 001 — Callable attempt recovery

**Plan:** `BW-final-state-2026-10-01`  
**Version:** 2  
**Date:** 2026-10-01  
**Source baseline:** `main@6ab1c078150993936d5d381822e7774d9e5cfade`

## Finding

The imported project has no ready tasks because T01 and T04 are in
`expired_review`. At revision 25, Boreal guidance advertises an allowed,
descriptor-bound `recover` action, but the callable CLI registry contains only
`recovery list` and `recovery resolve`. The latter resolves an already-created
obligation and cannot submit the missing action. The read-only route audit found
no generic action mutation application service either.

## Change

Add BW-S00-T05 as a no-prerequisite operational repair. It exposes the trusted
attempt recovery action through the Rust application/CLI/service boundary and
preserves canonical authorization, fences, operation readback, and the separate
obligation-resolution path. BW-S00-T90 now depends on T05 as well as the
original four S00 leaves. Existing task IDs, attempts, evidence, and gates are
unchanged.

The original `BOREAL_TEMPLATE.json` remains the immutable v1 import source.
`BOREAL_TEMPLATE_V2.json` is the full updated template for a fresh import; the
current project's additive T05 record is created through the supported v2
planning workflow rather than replaying the whole template.

## Evidence and limits

- Read-only queue snapshot: project `boreal-work`, revision 25; ready 0,
  `expired_review` 2.
- T01 and T04 each retain the original attempt/fence and report
  `lease_elapsed`; their checkpoint, summary, and verification gates remain
  open.
- `bwrk recovery list --project boreal-work --json` returned no obligations.
- `bwrk commands recover --json` rejected the unregistered path.
- The separate read-only implementation audit found no generic CLI/service
  submission route for `ActionKind::Recover`.
- Added `boreal-final-s00-t05` through the Rust v2 planning command at project
  revision 26 and recorded its prerequisite edge on S00-T90 at revision 27.

The T01/T04 attempts, evidence, and gates were not changed by this amendment.

## Bounded implementation-scope decision

Before editing code, the T05 implementer reported that a safe descriptor-bound
mutation requires one store transaction and its export; the original task
boundary covered only application, protocol, and CLI files. The implementer
requested these exact shared paths and proposed a typed
`submit_recover_action` transaction that checks project/entity/proof revisions,
attempt/fence/session, confirmation, evaluator authorization, and typed
disposition under the canonical write lock, then persists the operation
receipt, history, and resolution atomically. This remains distinct from
`recovery.resolve` and needs no schema or migration change.

At project revision 34, the coordinator approved the bounded request before
code edits and assigned the implementer as steward for exactly
`crates/store/src/recovery.rs` and `crates/store/src/lib.rs`; no other active
assignment owns those paths. The task packet was updated to include only this
transaction and its wiring. The task's dispatch policy was changed from
`automatic` to `operator_only` at revision 28 because the supported Luna
subagent session is authenticated as the existing operator principal; the
automatic policy required an Agent principal and had denied the guide. The
fresh session start at revision 28 created attempt
`attempt_cli_cli_1790886988937_53057_0`, fence 1, using registered source
version `sv_boreal-work_sha256:968e099c2ea99ebd8544dce1974d5bb4cf2cb5c8f8eb85c8d861fedea4b119c5`.
The implementation has not yet been reviewed or integrated. Task-local tests
remain prohibited by the packet; sprint validation is owned by T90.

The implementer then requested one additional, bounded guidance path because
`guidance.recover@v1` currently describes obligation resolution while this
action expires an attempt and creates the obligation. The coordinator approved
`crates/application/src/agent_tools.rs` for that directive's wording alignment
only, before editing; the task packet records the same limit. Other guidance
behavior remains outside this assignment.
