# PF-S02-T90 attempt 1 — independent review and finding classification

## Disposition

`blocked_not_accepted`.

This is a coordinator-prepared review packet, not an independent acceptance:
no separate reviewer identity was available for this exact source revision.
The packet is retained so a later reviewer can reproduce the findings without
reconstructing the work from chat history.

## Source boundary

- implementation source revision: `be79688ebefcd6004a9f6f60c4b27a8c99ca6e60`
- branch: `codex/apply-responsive-terminal-overlay`
- product tree: committed; unrelated untracked runtime data remains under
  `memory/` and is excluded from the implementation change
- required plan validation: passed (`22` sprints, `268` tasks, `66` explicit
  gate tasks, acyclic graph)

## Findings

1. **PF-S02-T90-001 — caller authentication boundary was incomplete.**
   Socket requests had a local credential check, while direct CLI dispatch did
   not. The coordinator added OS-identity credential derivation and direct
   dispatch authentication in `be79688e`. Both paths now fail closed on an
   unknown actor or mismatched credential. Independent review and a hostile
   identity test remain required before acceptance.

2. **PF-S02-T90-002 — backup/restore job readback was not durable.** The
   coordinator added the `boreal_maintenance_job` journal, stable operation
   binding, staged readback, exact replay, and unknown-outcome protocol flags in
   `be79688e`. The focused real-binary backup/restore test passes, but crash
   injection between each external-effect boundary and cross-process recovery
   remain open.

3. **PF-S02-T90-003 — status action context lacked real canonical facts.**
   Status projections now carry entity/proof revisions, authenticated session,
   source/configuration identity, integrity and missing-fact diagnostics. The
   action descriptor set remains fail-closed when proof facts are incomplete;
   this is safer than fabricating claim/close actions, but it is not yet the
   complete public action-context contract.

4. **PF-S02-T90-004 — full PF-S02 persistence scope is not certified.** The
   current source contains strong profile, recovery, operation and migration
   tests, but no independent leaf-by-leaf review proves all T01–T09 evidence at
   this exact revision. No release or sprint acceptance is claimed.

## Required next review

An independent reviewer must inspect this committed revision, rerun the listed
checks, classify each finding, and either accept bounded scope or create named
remediation children. T90 remains blocked until then.
