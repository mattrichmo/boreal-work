# PF-S01-T91 attempt 2 — handoff

## Status

**Accepted at the PF-S01-T91 coordinator provenance-remediation layer.**

This handoff records the bounded reconciliation of all three PF-S01-T90
attempt-7 findings. It does not accept the T90 review, PF-S01 sprint, T92 gate,
product, runtime, service, native, publication, release, or any successor gate.

## Dispositions

1. **T11 manifest digest:** fixed by a coordinator execution-state-only
   correction. T11's accepted source now binds the exact current manifest
   digest `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`
   without editing `contract-manifest.json`; the stale digest and finding remain
   historical.
2. **21 handoff pointers:** fixed by repairing ten accepted task-level T02–T11
   pointers and eleven accepted-attempt T01–T11 pointers to complete
   `HANDOFF.md` records. Every `START.md`, failed attempt, and historical
   pointer remains preserved. The T01 task-level canonical target is attempt 3.
3. **T01 stale text:** fixed by preserving attempt-2 `HANDOFF.md` unchanged and
   using the coordinator superseding attempt-3 `HANDOFF.md` for the task-level
   accepted handoff. The repaired accepted-attempt T01 pointer remains bound to
   the preserved attempt-2 `HANDOFF.md` record.

The detailed target set is in
`project/validation/production/sprints/PF-S01/remediation-map-attempt-2.json`.

## Verification and blocker

The post-correction matrix passes: `STATE.json` parses; the T11 digest, 21
pointer, and T01 preservation/supersession assertions pass; contract and plan
validation pass; graph readiness is advisory only; package verification passes
with 444 files and zero mismatches; the manifest/conformance join passes at
19/48/49/49 with zero mismatches and all vector dispositions `unmeasured`; and
`git diff --check` passes. No source or contract artifact was edited by this
attempt.

PF-S01-T92 must independently rerun the exact matrix in
`reconciliation-attempt-2.md`, including the T11 digest assertion, all 21
pointer/file-presence checks, T01 attempt-2 preservation and attempt-3
supersession, contract/plan/package validators, manifest/conformance join, and
exact-tree identity. This T91 acceptance does not pre-accept T92 or PF-S01.

## Changed files

Only these six files are changed by this attempt:

- `project/validation/production/sprints/PF-S01/reconciliation-attempt-2.md`
- `project/validation/production/sprints/PF-S01/remediation-map-attempt-2.json`
- `project/validation/production/tasks/PF-S01-T91/attempt-2/START.md`
- `project/validation/production/tasks/PF-S01-T91/attempt-2/COMMANDS.md`
- `project/validation/production/tasks/PF-S01-T91/attempt-2/EVIDENCE.md`
- `project/validation/production/tasks/PF-S01-T91/attempt-2/HANDOFF.md`

No Rust, TypeScript, plan JSON, contract artifact, or `execution/STATE.json` was
edited. Runtime, service, native, publication, and release acceptance remain
unclaimed. PF-S01-T92 remains the only independent sprint-exit gate.
