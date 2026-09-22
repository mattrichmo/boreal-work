# PF-S01-T91 attempt 2 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`  
Input HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`  
Branch: `codex/apply-responsive-terminal-overlay`  
Worktree: dirty  
Attempt start: `2026-09-22T06:39:52Z`

## Baseline before attempt-2 artifacts

These checks ran before the reconciliation/map and attempt-2 evidence files
were written. They are structural observations only.

| Command | CWD | Exit | Result |
| --- | --- | ---: | --- |
| `python3 project/spec/validate_contracts.py` | repository root | 0 | PASS: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `python3 tools/plan.py validate` | `project/build-plan/production-completion` | 2 | BLOCKED: plan helper JSON parse error in `execution/STATE.json`, line 413 column 9, `Expecting ',' delimiter`. |
| `python3 tools/plan.py graph-ready` | `project/build-plan/production-completion` | 2 | BLOCKED by the same `execution/STATE.json` parse error. |
| `python3 tools/plan.py verify-package` | `project/build-plan/production-completion` | 2 | BLOCKED by the same `execution/STATE.json` parse error. |
| `python3 -m json.tool project/spec/production/conformance-matrix.json` | repository root | 0 | PASS: conformance matrix parses. |
| `python3 -m json.tool project/build-plan/production-completion/execution/STATE.json` | repository root | 1 | BLOCKED: line 413 column 9 parse error. |
| `git diff --check` | repository root | 0 | PASS. |

The T90 attempt-7 record remains the source for the pre-correction counts:
accepted T11 manifest identity drift and 21 accepted task/attempt pointers.
The visible raw ledger must not be treated as a valid correction readback while
its JSON parse fails.

## Rerun after attempt-2 artifacts

| Command | CWD | Exit | Result |
| --- | --- | ---: | --- |
| `python3 project/spec/validate_contracts.py` | repository root | 0 | PASS: same contract counts as baseline. |
| `python3 tools/plan.py validate` | `project/build-plan/production-completion` | 2 | BLOCKED by `execution/STATE.json` line 413 parse error. |
| `python3 tools/plan.py graph-ready` | `project/build-plan/production-completion` | 2 | BLOCKED by the same state parse error; no advisory result available. |
| `python3 tools/plan.py verify-package` | `project/build-plan/production-completion` | 2 | BLOCKED by the same state parse error. |
| `python3 -m json.tool project/build-plan/production-completion/execution/STATE.json` | repository root | 1 | BLOCKED: `Expecting ',' delimiter: line 413 column 9 (char 21995)`. |
| `python3 -m json.tool project/spec/production/conformance-matrix.json` | repository root | 0 | PASS. |
| `python3 -m json.tool project/validation/production/sprints/PF-S01/remediation-map-attempt-2.json` | repository root | 0 | PASS. |
| `git diff --check` | repository root | 0 | PASS. |

Read-only manifest/conformance summary after the artifact write: 19 combined
manifest artifact/integration entries, 48 obligations, 49 vectors, and 49
vector-metadata rows. This does not replace the required valid-state pointer
and digest assertions.

## Post-correction rerun (final)

The coordinator applied the state-only corrections. The exact matrix was rerun
at `2026-09-22T06:53:06Z` on HEAD
`784a41b3802c29a76721c55eef2e9493283396c2` (dirty worktree; corrected
`STATE.json` SHA-256
`7d97fcf03c9051736e180968670cd061bc97f0b352c551a2fb17abd5c3ed7fee`).

| Command/assertion | CWD | Exit | Result |
| --- | --- | ---: | --- |
| `python3 -m json.tool project/build-plan/production-completion/execution/STATE.json` | repository root | 0 | PASS: STATE parses. |
| T11 digest, 10 task-level pointers, 11 accepted-attempt pointers, T01 attempt-2 preservation and attempt-3 supersession assertion | repository root | 0 | PASS: current manifest digest `131a0f2028629dab2ac372159cd19d67d33326e23085a8f1956fcbed3a155aa`; total repaired pointers 21. |
| `python3 project/spec/validate_contracts.py` | repository root | 0 | PASS: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `python3 tools/plan.py validate` | `project/build-plan/production-completion` | 0 | PASS: 22 sprints, 265 tasks, 48 obligations, 56 acceptance rows, 265-node acyclic graph, 17,134 local links. |
| `python3 tools/plan.py graph-ready` | `project/build-plan/production-completion` | 0 | PASS advisory only; candidate `PF-S01-T90`; not authorization. |
| `python3 tools/plan.py verify-package` | `project/build-plan/production-completion` | 0 | PASS: 444 files, 0 mismatches. |
| Manifest/conformance identity and join assertion | repository root | 0 | PASS: 19 manifest entries, 48 obligations, 49 vectors, 49 metadata rows, zero hash mismatches/dangling/join differences, all vector dispositions `unmeasured`. |
| `python3 -m json.tool project/spec/production/conformance-matrix.json` | repository root | 0 | PASS. |
| `git diff --check` | repository root | 0 | PASS. |

## Scope guard

No command in this attempt edited `execution/STATE.json`, `plan.json`, contract
artifacts, Rust, TypeScript, or any prior attempt. No runtime, service, native,
publication, or release command was run or claimed. The bounded reconciliation
is accepted only at T91's provenance-remediation layer; T90/T92 and all product
and release gates remain separate.
