# PF-S01-T91 attempt 2 — evidence

## Evidence class and scope

- **Evidence class:** coordinator provenance remediation and structural
  reconciliation.
- **Review input:** PF-S01-T90 attempt 7, rejected with three findings.
- **Prior evidence:** PF-S01-T91 attempt 1, preserved and superseded for this
  finding set; no historical file was edited.
- **Source:** `HEAD 784a41b3802c29a76721c55eef2e9493283396c2`, branch
  `codex/apply-responsive-terminal-overlay`, dirty worktree.
- **Write boundary:** only the two attempt-2 sprint outputs and four attempt-2
  evidence files named in `START.md`.

## Observed evidence

The current contract manifest hashes to
`131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`. T90
records that the pre-correction T11 accepted-source token was
`dcb757903063fd1aef64f910ebc3f1a5c6fa01990c38bb955f1901aa644fad99`.
Reconciling that token is coordinator state-only; the manifest is not edited.

T90 records 21 accepted task/attempt pointer defects. The required canonical
targets and counts are captured in the remediation map: ten task-level T02–T11
slots and eleven accepted-attempt T01–T11 slots, all ending in existing
`HANDOFF.md` files. T01 attempt 2 remains stale historical text. The existing
T01 attempt-3 handoff is the required superseding coordinator record and must be
used by the accepted state.

At the pre-correction baseline, the raw `execution/STATE.json` visibly
contained newer `HANDOFF.md` strings and the T01 attempt-3 record, but a valid
readback was unavailable: both `python3 -m json.tool` and the plan helper
failed at line 413 with `Expecting ',' delimiter`. That baseline failure is
preserved below; after the coordinator correction, the ledger parses and the
bounded assertions pass.

## Baseline validation results

- Contract validator: PASS, exit 0.
- Plan validator: BLOCKED, exit 2, invalid `execution/STATE.json`.
- Graph readiness: BLOCKED, exit 2, invalid `execution/STATE.json`.
- Package verification: BLOCKED, exit 2, invalid `execution/STATE.json`.
- Conformance JSON parse: PASS, exit 0.
- Git diff check: PASS, exit 0.

The post-correction result is intentionally pending. It must be populated only
after the coordinator applies the state corrections and the exact rerun matrix
passes on the corrected source identity.

## Post-correction evidence

The coordinator applied the state-only corrections without changing product
source or contract bytes. `STATE.json` now parses. The exact read-only
assertions pass: T11 binds the current manifest digest
`131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`; ten
accepted task-level and eleven accepted-attempt pointers resolve to existing
`HANDOFF.md` files; T01 attempt-2 stale text is preserved; and the task-level
and attempt-3 superseding handoff are selected. Total repaired pointers: 21.

The contract validator passes. Plan validation passes with 22 sprints, 265
tasks, 48 obligations, 56 acceptance rows, an acyclic 265-task graph, and
17,134 local links. Graph readiness passes as advisory and returns PF-S01-T90
only. Package verification passes for 444 files with zero mismatches. The
manifest/conformance join passes with 19 entries, 48 obligations, 49 vectors,
49 vector-metadata rows, zero hash mismatches/dangling/join differences, and
all vector evidence dispositions `unmeasured`. `git diff --check` passes.

The corrected source identity is HEAD
`784a41b3802c29a76721c55eef2e9493283396c2`, branch
`codex/apply-responsive-terminal-overlay`, dirty worktree; corrected STATE
SHA-256 is
`7d97fcf03c9051736e180968670cd061bc97f0b352c551a2fb17abd5c3ed7fee`.

## Acceptance boundary

This evidence supports acceptance only at PF-S01-T91's coordinator
provenance-remediation layer. It does not accept the T90 review, PF-S01-T92,
the PF-S01 sprint, product/runtime/service/native behavior, publication, or
release gates.

## Not run and not claimed

No Rust or TypeScript build/test, service lifecycle, database migration, real
verifier, multi-process race/fault, TUI, native, installer, backup/restore,
signing, performance, publication, or release check was run. No PF-S01,
PF-S01-T91, or PF-S01-T92 acceptance is claimed. No successor is authorized.
