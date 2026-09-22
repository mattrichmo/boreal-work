# PF-S00-T07 — coordinator attempt 3 evidence

## Produced artifacts

- `project/validation/production/baseline/entry-packet.md`
- `project/validation/production/baseline/obligations-map.json`
- this attempt's `START.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md`

## Reconciliation result

- All 48 original M02 identifiers and titles are present in
  `obligations-map.json`, with proposed coverage links copied from the plan.
- The entry packet records the accepted S00 baseline inputs, the dirty-tree and
  archive discrepancy, known source findings, missing external inputs, and the
  D22/D27/cycle/gate/protocol decisions that remain subject to PF-S01.
- Findings are routed to their existing bounded owners; no finding was relabeled
  as fixed or accepted by this packet.
- The two earlier worker attempts remain recorded as interrupted in the
  coordinator ledger; their absence of output was not hidden.

## Source identity and limits

- HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Input aggregate: `3a3a4cab27b63d117e80234ce739bd7680823c22a40520696740280c525173b0`
- Working tree: dirty
- Archive: `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

The current aggregate changes as coordinator evidence is added; the final
accepted source identity must be recomputed when the ledger records this
attempt. This artifact is planning/evidence input only. S00 independent review,
reconciliation, exact-tree revalidation, and all product/release gates remain
open.
