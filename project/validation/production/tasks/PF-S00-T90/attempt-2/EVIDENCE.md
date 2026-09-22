# PF-S00-T90 attempt 2 evidence

## Evidence identity

- Task/attempt: `PF-S00-T90` / `2`
- Evidence class: source and file-based contract/dispatch review
- Reviewer/agent: independent validation subagent,
  `01a0c62c-f386-7950-936c-a28218342509`
- Assigned source: `working-tree-aggregate:b8b1aeb028553c6594bc0a9d5a674c7df3fb2b8c6dfe25a4d84014d13ef4fb55; HEAD:784a41b3; dirty`
- Observed checkout: HEAD `784a41b3802c29a76721c55eef2e9493283396c2`, branch
  `codex/apply-responsive-terminal-overlay`, dirty.
- Evidence record: this file and `COMMANDS.md`; no separate raw logs were
  written because the granted evidence boundary contains only this attempt
  directory and the two sprint review outputs.

## Observations

1. `obligations-map.json` has 48 entries, the expected original ID set, 48
   mapped, and zero accepted. Every entry remains explicitly historical and
   unaccepted.
2. `baseline/findings.json` has 27 entries and all have non-empty owner fields.
   The six external-input rows have explicit status and downstream gates;
   absent/restricted capabilities remain blockers, not passes.
3. T03's 23-command record is 16 pass / 7 fail. Its evidence classes and
   handoff language distinguish static, fixture, unit, store,
   application/service-boundary, and package results from genuine service,
   native, published, and release evidence.
4. The production-completion plan reports `proposed_not_adopted`; the execution
   ledger reports `not_adopted`. The entry packet keeps D22/D27, cycle,
   protocol, gate, review, expiry, status, and identity changes as proposals.
5. The dispatch conflict checks for T06/T90 and T07/T90 report no conservative
   path overlap. The state records T06/T07 coordinator self-acceptance,
   however, which is a separate independence failure.
6. Plan structural validation passed. Package verification remains failed on
   `execution/STATE.json`; this is retained as an inherited open discrepancy.
7. The required audit workflow resolver returned `service_busy` (exit 6), so no
   live audit receipt or database/service observation is part of this evidence.

## Negative claims and limitations

- This record does not claim a product build, service lifecycle, native target,
  installed artifact, release, publication, platform coverage, or external
  reviewer capacity.
- It does not update `execution/STATE.json`, plan authority, source code, or
  prior evidence.
- The current T90 attempt is attributable by its assigned worker identity, but
  the ledger has no T90 reviewer field and no T92 gate owner. T91 reconciliation
  and T92 exact-tree revalidation remain mandatory.
- T06/T07 self-acceptance is preserved as a finding; no history was rewritten.
