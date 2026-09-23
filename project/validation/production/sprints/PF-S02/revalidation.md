# PF-S02 exact-tree revalidation — attempt 1

## Decision

`blocked_not_accepted`; no successor unlock.

## Tested source

`be79688ebefcd6004a9f6f60c4b27a8c99ca6e60` on
`codex/apply-responsive-terminal-overlay`.

## Results

The locked Rust workspace, production oracle (23/23), T10 oracle (4/4), CLI
unit suite (82/82), backup/restore readback test, Rust format/build checks,
TUI typecheck, TUI suite (98/98), plan validation and diff check passed.

## Remaining gate conditions

The record does not certify PF-S02 because an independent reviewer has not
verified the exact tree, the complete public action descriptor contract is not
finished, and genuine service/native fault and release evidence remain open.
