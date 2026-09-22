# PF-S03-T02 attempt 1 — evidence

## Record and evidence class

- Task / attempt: `PF-S03-T02` / `attempt-1`.
- Acceptance row: `AC-08` contribution; leaf evidence only, not coordinator acceptance.
- Evidence class: pure domain source and focused deterministic tests.
- Input source: `HEAD:784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree.
- Accepted prerequisite: PF-S03-T01 attempt 2, bounded to typed inputs and the
  public domain boundary; handoff SHA-256 `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Host/toolchain: Darwin arm64; `rustc 1.85.0`; `cargo 1.85.0`.

## Implemented invariant

`status_evaluator.rs` now makes the evaluator's decision phases explicit:

- all applicable reasons are collected before selecting the primary branch;
- terminal lifecycle wins first, expiry review wins the expiry-versus-hard-hold
  tie, hard intervention wins before draft/current-attempt/proof/dispatch/
  dependency/readiness branches, and the selected `next_action` follows that
  branch;
- hard-reason primary selection uses an explicit intervention/configuration
  priority with stable-code tie-breaking rather than accidentally using
  lexical order as status policy;
- failed technical proof yields `needs_verification`/`provide_evidence`, an
  explicitly failed required review yields `blocked`/`resolve_hold`, and an
  open required review after technical proof yields
  `awaiting_review`/`request_review`;
- expiry retains `expiry_review_required`, both elapsed-clock reasons, active
  attempt state, holds, and prerequisite facts;
- prerequisite IDs, gate gaps, reason facts, and affected dependents are
  normalized deterministically. Exact duplicate facts are removed without
  collapsing distinct typed variants; primary reason remains first and all
  secondary reasons use stable lexical ordering; and
- draft, retry-wait, queued, paused, operator-only, claimed, active,
  complete, and proof branches expose their typed safe next actions.

No store, service, process, JSON, terminal, schema, protocol, or persistence
dependency was introduced.

## Focused acceptance evidence

`production_status_precedence.rs` contains six tests covering:

1. paused plus open prerequisite, including both reasons and resume action;
2. expiry plus hard hold, including the selected expiry tie rule, both clocks,
   active attempt, prerequisite, and review-expiry action;
3. failed technical proof versus rejected review versus missing review, with
   distinct statuses, primary reasons, secondary reasons, and actions;
4. intervention-priority primary selection where lexical order would differ;
5. equivalent permutation of holds, prerequisites, gates, dependents, and
   affected facts producing an equal `StatusDecision`; and
6. next-action mapping across draft, retry, queue, pause, operator-only,
   claimed, active, and complete branches.

Observed final results:

- `cargo test --locked -p boreal-domain --test production_status_precedence`:
  6 passed, 0 failed.
- `cargo test --locked -p boreal-domain`: 68 passed, 0 failed; 0 doc tests.
- `cargo check --locked -p boreal-domain --tests`: passed.
- `cargo fmt --all -- --check`: passed.
- strict focused and full domain clippy: passed.

## Finding and baseline disposition

The task card names inherited finding F02 (open prerequisite previously
outranking explicit pause and hiding secondary facts). The current candidate
already contained a partial collection fix, but this task adds fresh
production vectors and completes the precedence/reason contract, including
explicit hard-reason primary selection and proof/review distinctions. F02 is
not independently closed by this worker; the PF-S03 review/reconciliation/
revalidation chain remains required.

## Limits and failed/blocked observations

- The first focused test run failed because its expected expiry list omitted
  the applicable `attempt_active` secondary reason. The failure is preserved in
  `COMMANDS.md`; the assertion was corrected and the rerun passed.
- The first strict focused clippy run failed on two owned-file diagnostics;
  both were fixed and the final strict checks passed.
- `bwrk prime boreal-work --json` and read-only workflow probes returned typed
  `service_busy` for the existing database owner. No lock was broken and no
  runtime state was changed.
- This evidence does not claim service/lifecycle, store snapshot completeness,
  genuine verifier receipts, migration, race/fault, TUI, native, installer,
  publication, performance, signing, or release acceptance.
