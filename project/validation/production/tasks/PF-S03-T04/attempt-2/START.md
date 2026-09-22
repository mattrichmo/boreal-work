# PF-S03-T04 attempt 2 — independent validation start

## Review identity and scope

- Task: `PF-S03-T04` — implement requirement, evidence and review interpretation.
- Attempt: `attempt-2`.
- Reviewer: Codex independent validation reviewer.
- Review date: `2026-09-22`.
- Decision scope: PF-S03-T04 only.
- Review disposition: `rejected` pending bounded reconciliation of the findings in `EVIDENCE.md`.
- No product code, `STATE.json`, prior evidence, coordinator record, sprint record, or unrelated path was edited.

This review validates the integrated pure-domain slice against the PF-S03-T04
card, the accepted PF-S03-T01 attempt-2 handoff, and the production
acceptance/proof contract. It makes no sprint, service, native, publication,
or release claim.

## Input identity

- Workspace: `/Users/cybertron/Code/boreal-work`.
- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`.
- Branch: `codex/apply-responsive-terminal-overlay`.
- Worktree: dirty combined tree; `git status --porcelain=v1` reported `64` entries before this review's evidence files.
- Host/toolchain: Darwin arm64; Rust `1.85.0`; Cargo `1.85.0`.
- PF-S03-T04 card SHA-256: `cda28b913779aaf8e8e36159548e46872cdc832c32c5122c37bc11d3acee5a12`.
- Accepted PF-S03-T01 handoff SHA-256: `6f3a4b5d96ada595b01b937e5fb99b99e41cccfdaa581f2bb5b4e7899552ee6e`.
- Production acceptance contract SHA-256: `da4c7796a801c185f33f0f309d82bc1a1a0f3aaa8ee6b3d546f49f7674714245`.
- Contract manifest SHA-256: `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`.
- Worker attempt-1 evidence SHA-256: captured in `COMMANDS.md`.

## Required review checks

The review covers complete-subject selection before recency; distinct
missing/failed/stale/altered/irrelevant/declaration/review facts; typed force
exceptions that preserve raw failure and exception ID; self-review and role
independence; task/container proof separation; and the integrated public
registration in `crates/domain/src/lib.rs`.

The public registration is present at `crates/domain/src/lib.rs:9`, and the
focused test imports `boreal_domain::acceptance` through that public boundary.
The worker's attempt-1 integration limitation is therefore resolved in the
reviewed tree.

## Workflow and authority probe

The required review workflow lookup was attempted with
`bwrk workflows show boreal.workflow.review.v1 --json`. Read-only candidate
selection was also attempted with `bwrk work show boreal-work PF-S03-T04
--json` and `bwrk work list boreal-work --json`. All three returned typed
`busy/service_busy` because the database owner was already held by another
process. No lock was broken and no lifecycle mutation was attempted. The
independent source review and fresh local Rust checks proceeded without using
that unavailable mutation path.
