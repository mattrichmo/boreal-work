# PF-S02-T09 attempt-2 — identity-bound production bootstrap

## Scope

Implement the smallest shared primitive required to make fresh production
project initialization bind the project identity and canonical workspace
identity atomically and replay-safely.

## Input source

- Reviewer finding commit: `5584d461a8192cd06999f14069b3fe590b059406`
- The branch advanced concurrently to `6d2ded13616615ef7866695b6ac5fe1341583db8`
  before final evidence capture; this lane did not create or push that commit.
- Reviewer finding: production `init` committed `project.init` before the
  workspace binding and could later perform a binding-only repair.
- Existing compatibility behavior and prior attempt-1 evidence remain
  historical inputs; they are not overwritten.

## Boundaries

Changed only the store bootstrap seam, its application adapter, the CLI init
call site, the focused identity-boundary test, and this evidence directory.
No TUI, plan/state/ledger, memory, schema artifact, or unrelated lifecycle
behavior was changed by this lane.
