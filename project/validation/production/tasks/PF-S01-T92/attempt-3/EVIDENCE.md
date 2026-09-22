# PF-S01-T92 attempt 3 — evidence

## Evidence class and scope

This is an independent exact-tree structural/provenance revalidation for
AC-01. The reviewer did not implement a PF-S01 leaf. The evidence subject is
the dirty combined worktree at HEAD
`784a41b3802c29a76721c55eef2e9493283396c2`, not a clean release artifact.

The current state ledger parses, the prior T90 attempt-7 findings remain
preserved, T90 attempt 8 accepted the bounded finding-classification task
after T91 remediation, and T91 attempt 2 remains bounded to coordinator
provenance remediation. The current T92 assertions independently verify that
the corrected T11 digest, handoff pointers, and T01 supersession are present.

## Provenance assertions

- T11's accepted source binds the current contract-manifest digest
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Ten accepted task-level T02–T11 pointers and eleven accepted-attempt T01–T11
  pointers resolve to existing `HANDOFF.md` files; no accepted slot targets
  `START.md`.
- T01 attempt 2 remains the preserved stale historical handoff with its
  pending-review/do-not-start wording. T01 attempt 3 is the accepted
  task-level superseding provenance correction.
- The current `STATE.json` SHA-256 is
  `05b1efb15d2b74fecccc6cf913b11a08a80e57db84ea5b6a5cac5bc801b75704` and its
  JSON readback succeeds.

## Structural check evidence

`python3 project/spec/validate_contracts.py` passed with the exact contract
counts recorded in `COMMANDS.md`. From the plan directory, `plan.py validate`
passed with zero errors; the current validator no longer reports the prior T90
reviewer-attribution blocker. `graph-ready` returned an empty advisory list
and was not treated as authority. `verify-package` checked 444 issued files
with zero mismatches.

The read-only manifest/conformance assertion passed with 19 manifest entries,
48 obligations, 49 vectors, 49 vector-metadata rows, 14 required categories,
zero hash mismatches, zero dangling references, zero join differences, and
all vector evidence dispositions `unmeasured`. `git diff --check` passed.

## Gate result

All required checks and provenance readbacks for AC-01 passed, so this attempt
accepts PF-S01-T92 at the contract-layer gate. It does not claim that the
Rust/service runtime, database migrations, genuine verifier, concurrency or
fault behavior, TUI, native artifacts, installers, backup/restore, signing,
performance, publication, or production release are accepted. Those layers
remain owned by their registered later tasks and gates.

The worktree remains dirty and every conformance vector remains unmeasured;
those limitations are retained rather than relabeled as product acceptance.
