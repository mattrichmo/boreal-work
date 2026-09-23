# PF-S02-T92 attempt 1 — exact-tree revalidation

## Disposition

`not_accepted_blocked_by_missing_independent_review`.

## Exact source under test

- implementation revision: `be79688ebefcd6004a9f6f60c4b27a8c99ca6e60`
- branch: `codex/apply-responsive-terminal-overlay`
- binary: `target/debug/bwrk` built with `cargo build --locked -p boreal-cli --bin bwrk`
- oracle input: generated external production manifest bound to the tested
  source revision; the tracked self-referential hash mechanism is not used

## Revalidation results

- full locked workspace Rust tests — passed
- production oracle with external manifest: 23/23 — passed
- production T10 oracle — 4/4 — passed
- CLI unit tests — 82/82 — passed
- backup/restore readback test — passed
- Rust format check — passed
- CLI build — passed
- TUI typecheck — passed
- TUI suite — 98/98 — passed
- plan validation — passed with zero errors
- `git diff --check` — passed

## Acceptance limits

This is exact-tree revalidation evidence, not sprint acceptance. No separate
reviewer has signed the PF-S02 chain. Genuine hostile caller tests, crash
injection across every backup/restore boundary, real service/native release
smoke tests, and leaf-by-leaf PF-S02 handoff certification remain required.
