# BW-S02-T90 integrated package rerun — attempt 5

- Exact acceptance source: `32e46d19fac5f970388ff67c1234a2c19fa91ee8` (`fix(global-tui): accept current snapshot schema`).
- Source was already present as a local Git object; no fetch was needed. It was checked out in a new detached worktree so attempt-4 evidence and its commit remain intact.
- Prior attempt-4 source: `d1f8ae0b5d42c1886df5bba04930f3692d63e6ef`; prior evidence commit `4015297988c538892251719d0edd20219fbc428c` remains unchanged.
- Scope: rerun the integrated package smoke that failed at the packaged Global TUI schema check on attempt 4; preserve the raw output and package identity in this attempt directory.
- The fixed source changes Global TUI snapshot validation from schema 2 only to schema 2 or 3, and updates the fixture assertions. No code edits are made in this attempt.
- No acceptance/runtime plan transition, CI/release dispatch, push, or merge is performed.
