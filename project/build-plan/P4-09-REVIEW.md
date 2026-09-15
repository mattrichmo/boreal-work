# P4-09 readiness review

Date: 2026-09-15
Scope: `apps/tui`, `crates/migration`, workflow assets/validator, and
packaging/release documentation.

## Conclusion

P4-09 is not ready for acceptance. The snapshot contains useful early
implementation and passing focused checks, but no evidence of the required
P4-07 independent review, P4-08 reconciliation, or P4-09 fresh-install plus
imported-project end-to-end revalidation. S05 is still queued on P3-09 and
the S04 handoff (`milestones/M01-v2-product/sprints/S05-integration/SPRINT.md:1-5`).

## Implemented evidence

- TUI client and mounted controller: versioned envelopes, bounded JSON
  framing, typed errors, revision/as-of status models, attempt-fence and
  revision preconditions, action availability, and coalesced refresh are in
  `apps/tui/src/client.ts:9-15,47-61,620-830,871-1069`. The test fixture
  covers protocol rejection and UTF-8/frame bounds
  (`apps/tui/src/test.ts:97-125`), service-routed create/claim/accept/evidence/
  finish/release (`apps/tui/src/test.ts:285-303`), stale/blocked/queued/
  expired/open-gate states (`apps/tui/src/test.ts:305-336`), refresh
  coalescing (`apps/tui/src/test.ts:338-352`), and a fake Unix-socket mounted
  render (`apps/tui/src/test.ts:354-390`). The Node adapter is in
  `apps/tui/src/node-transport.ts:31-112`. The socket fixture also drops the
  first mount connection and verifies that a retry uses a fresh connection and
  recovers the revision-bound view (`apps/tui/src/test.ts:497-546`).
- TUI executable evidence: `apps/tui/src/entrypoint.ts:19-48` mounts one
  controller and renders one revision-bound snapshot. The package exposes
  `bwrk-tui` in `apps/tui/package.json:1-15`. The default entrypoint remains
  one-shot, while `--interactive` provides the bounded line shell with
  mutation confirmation. The remaining runtime limitation is that it has no
  subscription stream or automatic reconnect loop; the local socket fixture
  proves explicit mount retry only.
- Migration boundary: `crates/migration/src/lib.rs:18-41` defines explicit
  project/work/dependency/attempt/reservation/evidence/failure/summary/
  memory/Git sections; validation and canonical ordering are at
  `crates/migration/src/lib.rs:61-267`. Reports retain unsupported and
  ambiguous records (`:463-530`); dry-run plans are side-effect-free and
  produce no actions when unready (`:930-1000`); legacy JSON conversion is
  explicit and versioned (`:1157-1204`). The migration tests exercise
  round-trip, unsupported/ambiguous retention, deterministic export,
  non-mutation, rollback-like invalid-plan behavior, provenance, and
  explicit actions (`crates/migration/tests/format.rs`, 11 tests).
- Workflow assets and validator: ten embedded assets are declared in
  `crates/application/src/workflow_assets.rs:10-21`; the registry validates
  package authority, metadata/asset identity, required typed inputs and finish
  criteria, and unknown next refs (`:70-155,180-260`). The package declares
  ten assets at version `1.0.0` in `project/spec/workflows/package.json:1-26`,
  including explicit review and audit routes.
  The Python validator checks strict fields, SHA-256 identity, safe allowlisted
  `bwrk ... --json` command shapes, typed inputs, finish criteria, and refs
  (`project/spec/workflows/validator.py:156-240,323-390`); its negative tests
  include unknown fields, unsafe commands, unknown refs, authority changes,
  and transition-owner redefinition (`validator.py:450-540`).
- Packaging/release groundwork: `scripts/release/release_identity.py:23-25,
  243-256,269-283` builds and verifies deterministic protocol/schema/memory/
  directive/workflow identities. `docs/PACKAGING.md:3-45` documents manifest
  and check commands; `:47-69` documents a temp-only synthetic install/
  rollback simulation; `:71-87` explicitly lists what it does not prove.
  `docs/BUILD.md:6-24` provides the standalone-copy static/Rust/TUI check.

## Early implementation versus formal acceptance

The evidence above establishes component behavior and asset validation only.
It does not establish the task-index acceptance for P4-04, P4-05, P4-10,
P4-11, or P4-09 (`project/build-plan/TASK_INDEX.md:74-84`). In particular:

- Migration is a dependency-light, side-effect-free format/plan crate; it is
  not a store-integrated importer/exporter with real v1 fixture installation,
  backup, checkpoint/resume, or rehearsed v2 rollback. `docs/MIGRATION.md:45-67`
  assigns those responsibilities to a future store integrator.
- Workflow validation proves the checked-in package boundary, not that every
  required route is implemented and enforced through the complete Rust
  guidance/transition path. The package now has ten assets, including
  separate `review` and `audit` assets; application routing and full parity
  enforcement remain open even though P4-10 requires route/context/plan/
  claim/evidence/finish/review/audit/handoff/health coverage
  (`project/build-plan/verticals/12-canonical-workflows.md:43-79`).
- Release identity and synthetic directory swapping are not a real installer,
  binary/toolchain package, TUI package, active-attempt pause/rebase/resume,
  upgrade compatibility, or platform release proof (`docs/PACKAGING.md:71-87`).
- The TUI controller tests use in-memory/fake service implementations. No
  evidence here demonstrates the full interactive mounted lifecycle against
  the packaged service, monitoring during unrelated concurrent mutations, or
  clean-install operation.

## Smallest remaining blockers to P4-09

1. Close prerequisites first: P2-09 still lacks no-goal
   guidance/directive-enforcement coverage, although its three-harness
   service-routed evidence/closeout and restart/readback transcript plus
   focused failure/replay coverage now pass
   (`project/build-plan/P2-09-REVALIDATION.md`); P3-09 has no accepted
   review/reconciliation/revalidation chain and remains open
   (`project/build-plan/P3-09-REVIEW.md:8-12,46-73`).
2. Complete the S04 mounted TUI handoff, including the production interactive
   lifecycle/monitoring proof required by `milestones/M01-v2-product/sprints/
   S04-tui/SPRINT.md:18-35`.
3. Finish P4-04 store-integrated dry-run/import, unsupported-data report,
   backup/checkpoint/resume, and rollback evidence; current migration tests
   alone are insufficient.
4. Finish P4-10/P4-05/P4-06/P4-11: complete canonical route coverage and
   enforcement, real package/install and upgrade/rollback checks, exact
   operator/harness walkthroughs, and packaged scripted plus unfamiliar-agent
   parity evidence.
5. Run the required independent P4-07 review, record dispositions in P4-08,
   then rerun P4-09 on the combined source snapshot with a fresh install and
   imported fixture. Until then, P4-09 must remain open and S06/P5 work stays
   gated (`milestones/M01-v2-product/sprints/S05-integration/SPRINT.md:28-48`).

P3/P2 prerequisites are explicitly still open; this report does not advance
or imply acceptance of either phase. No shared ledger was edited.

## Focused checks run

- `npm test` in `apps/tui`: PASS; TypeScript compiled and the mounted
  workflow/protocol/monitoring/refresh test printed its pass message.
- `npm run typecheck && npm test` in `apps/tui` on 2026-09-15: PASS; the
  fake-socket fixture also covered a dropped initial mount and recovery over a
  fresh connection.
- `cargo test -p boreal-migration`: PASS; 11 integration/doc tests, 0 failed.
- `cargo test -p boreal-application workflow_assets`: PASS; 3 workflow asset
  unit tests, 0 failed.
- `python3 project/spec/workflows/validator.py --root project/spec/workflows`:
  PASS; 10 assets, 38 command shapes, 91 CLI shapes available.
- `python3 project/spec/workflows/validator.py --self-test`: PASS; 6 tests.
- `python3 scripts/release/test_release_identity.py`: PASS; 5 tests.
- `bwrk prime --json`: not available for context; returned `BOREAL_CONFLICT`
  because `.boreal/runtime/state.lock` is owned by another live writer. The
  v2 instructions prohibit using legacy `bwrk` for this file-based plan, so
  no retry or lock intervention was performed.

## Follow-up addendum — 2026-09-15

The TUI now has an explicit `--interactive` line shell with deterministic
`help`, `refresh`, `select WORK_ID`, and `quit` commands. Default and piped
invocations remain one-shot. The shell safely rejects selections absent from
the current snapshot and keeps command-level refresh failures inside the
session. Lifecycle commands support structured evidence, confirmation, and
typed failure/unknown handling. A local fake-socket test also proves recovery
from a dropped initial mount by retrying on a fresh connection. This reduces
the earlier entrypoint limitation, but does not satisfy P4-02/P4-03 production
acceptance: packaged-service lifecycle proof, subscription semantics, full
keyboard navigation, and the independent P4-07/P4-08/P4-09 chain remain open.

## Follow-up after this review

The TUI now also has an explicit `--interactive` line shell with deterministic
`help`, `refresh`, `select WORK_ID`, and `quit` commands. Default and piped
invocations remain one-shot. Lifecycle commands support structured evidence,
confirmation, and typed failure/unknown handling. A local fake-socket test also
proves recovery from a dropped initial mount by retrying on a fresh connection.
This does not satisfy P4-02/P4-03 production acceptance: packaged-service
lifecycle proof, subscription semantics, full keyboard navigation, and the
independent P4-07/P4-08/P4-09 chain remain open.
