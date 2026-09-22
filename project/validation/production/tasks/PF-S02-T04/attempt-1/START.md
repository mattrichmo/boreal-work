# PF-S02-T04 — Attempt 1 implementation start

## Identity and bounded scope

- Task / attempt: `PF-S02-T04` / `attempt-1`.
- Worker: bounded production-plan store worker.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Started: `2026-09-22T11:25:55Z` (America/Regina).
- Input revision: `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, branch
  `codex/apply-responsive-terminal-overlay`, dirty worktree.
- Exclusive production paths: `crates/store/src/profiles.rs` and
  `crates/store/tests/production_profile_requirements.rs`.
- Evidence path: this attempt directory only.
- Protected paths: `crates/store/src/lib.rs`, schema manifests, SQL migration
  ordering, Cargo manifests, protocol registries, execution state and package
  manifest. No protected path will be edited by this worker.

## Interpreted invariant

An acceptance profile version is an immutable, content-addressed definition,
not a best-effort row or reconstruction from observed gate rows. A work item
must retain a pinned required/optional declaration with provenance independent
of gate observations. Deleting or drifting an observation must therefore leave
the requirement visible and produce a typed integrity/quarantine outcome;
legacy empty definitions are usable only when authoritative provenance exists.
Task and container requirement subjects remain distinct.

## Baseline behavior and known discrepancy

The current seam validates JSON and delegates to the existing root
`ensure_acceptance_profile`, but the root insert uses `ON CONFLICT DO NOTHING`,
stores `{}` for built-in profiles, derives a placeholder digest from the
profile ID, and creates per-work gate rows without an independent declaration
set. The root module also remains the required integration owner and cannot be
edited in this attempt. The production profile table currently has only the
profile identity/definition columns; adding schema/root registration is an
integration request, not an ungranted edit.

## Intended bounded change

Implement the coherent profile/requirement model in the granted new module and
focused test target. The module will validate canonical JSON/digest identity,
reject conflicting same-version content when the root primitive is available,
model pinned task/container declarations with provenance, detect missing or
drifted observations, and expose explicit legacy/quarantine classifications.
Tests will exercise positive registration and sibling versions plus deletion,
default drift, legacy-empty and subject-separation cases. If persistence
requires root/schema work, record the exact coordinator integration patch
request instead of editing protected files.

## Verification strategy

1. Run the focused target through the public `boreal_store` crate after the
   module is registered in the combined tree; until then, use only tests that
   can compile within the granted boundary and record the registration blocker.
2. Run scoped rustfmt, focused test, `cargo test --locked -p boreal-store`,
   contract validation and `git diff --check` where possible.
3. Record exact commands, exits, source hashes, limitations and the shared
   `crates/store/src/lib.rs` integration request in `COMMANDS.md`,
   `EVIDENCE.md` and `HANDOFF.md`.

## Authority limits

This attempt cannot accept PF-S02-T04, change execution state, edit shared
registration, add migrations, or claim service/lifecycle/release evidence.
Failed and unsupported checks will be retained verbatim in the handoff.
