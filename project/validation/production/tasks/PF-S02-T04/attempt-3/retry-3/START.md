# PF-S02-T04 — retry 3 start record

## Identity and authorized boundary

- Task / retry: `PF-S02-T04` / retry `3`.
- Workspace: `/Users/cybertron/Code/boreal-work`.
- Input HEAD: `abf87bb528b55632499bb246c10aeb902680a582` on
  `codex/apply-responsive-terminal-overlay`; worktree already dirty.
- Production write set: `crates/store/src/profiles.rs` and
  `crates/store/tests/production_profile_requirements.rs` only.
- Evidence write set: this new `attempt-3/retry-3/` directory only.
- Protected paths preserved: `crates/store/src/lib.rs`, schema/migration
  files, plan/state ledgers, and all previous evidence.

The existing `attempt-3/` already contains START/COMMANDS/EVIDENCE/HANDOFF,
and evidence directories for attempts 4–8 also exist. To preserve that history,
this retry is recorded in the nested `retry-3/` directory rather than replacing
the existing attempt-3 files. The live `execution/STATE.json` currently lists
only T04 attempts 1–2; coordinator reconciliation is required before any
ledger update or acceptance.

## Prerequisites and accepted contract

- PF-S01-T92 AC-01: accepted; `attempt-3/HANDOFF.md`.
- PF-S02-T02: accepted bounded leaf; `attempt-4/HANDOFF.md`.
- PF-S02-T03: accepted bounded leaf; `attempt-4/HANDOFF.md`.
- `project/spec/production/contract-manifest.json` exists and all 14 referenced
  contract artifact hashes match. Manifest SHA-256:
  `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa1`.
- The pinned-profile contract remains `boreal.acceptance/2`; no settled policy
  or schema/migration ordering was changed.

## Interpreted invariant

For a given project/work/proof revision, the immutable pinned gate declarations
must be exactly the declarations resolved from the separately stored immutable
profile version. A weaker but internally digest-consistent pin must fail at
write time; the same coordinated corruption must be quarantined at readback.
Deleting an observed gate remains an evidence gap and cannot reduce required
declarations.

## Baseline and validation strategy

The focused profile target passed 19/19 before edits. Implemented the narrow
profile-to-pin equality check and regressions for forged and coordinated
corrupt snapshots. Ran the profile target, adjacent production integration
targets, scoped rustfmt and diff checks. Full store/workspace/release gates were
not part of this bounded retry.
