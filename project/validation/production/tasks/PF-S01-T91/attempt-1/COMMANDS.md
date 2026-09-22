# PF-S01-T91 attempt 1 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`

Source identity: branch `codex/apply-responsive-terminal-overlay`, HEAD
`784a41b3802c29a76721c55eef2e9493283396c2`, dirty worktree. The dirty state is
pre-existing integration context and is not a release identity.

Validation window: `2026-09-22T06:15:48Z` to `2026-09-22T06:15:48Z` UTC.

| Command | CWD | Exit | Observed result |
| --- | --- | ---: | --- |
| `python3 project/spec/validate_contracts.py` | `/Users/cybertron/Code/boreal-work` | 0 | `PASS`: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. |
| `python3 tools/plan.py validate` | `/Users/cybertron/Code/boreal-work/project/build-plan/production-completion` | 1 | Planning structure reported 22 sprints, 265 tasks, 48 M02 obligations, 56 acceptance rows, 265-node acyclic graph, and 17,134 local links, but failed with `PF-S01-T90: accepted without agent`. This is retained as a T92 blocker. |
| `python3 tools/plan.py graph-ready` | `/Users/cybertron/Code/boreal-work/project/build-plan/production-completion` | 0 | Advisory readiness query passed with no tasks; its warning states readiness is not authority. |
| `python3 tools/plan.py verify-package` | `/Users/cybertron/Code/boreal-work/project/build-plan/production-completion` | 0 | Issued plan package check passed: 444 files checked, 0 mismatches. |
| `python3 -m json.tool project/validation/production/sprints/PF-S01/remediation-map.json >/dev/null` | `/Users/cybertron/Code/boreal-work` | 0 | T91 remediation map parses as JSON. |
| `python3 -c '…manifest and conformance identity assertions…'` | `/Users/cybertron/Code/boreal-work` | 0 | `PASS`: 19 manifest entries, 48 obligations, 49 vectors, 49 metadata rows, all vectors unmeasured. The command verified every artifact/integration SHA-256 in the production contract manifest and the conformance joins/counts. |
| `git status --short --untracked-files=all -- <T91 allowlist>` | `/Users/cybertron/Code/boreal-work` | 0 | Exactly the six permitted T91 files are present as new files: the two sprint outputs plus START/COMMANDS/EVIDENCE/HANDOFF. |
| `python3 -c '…required-file presence assertions…'` | `/Users/cybertron/Code/boreal-work` | 0 | `PASS`: 6 required T91 files present and non-empty. |

## Scope checks

- T90 review files were read from `project/validation/production/sprints/PF-S01/`;
  its `findings` array is empty and its decision is `no_findings`.
- No Rust, TypeScript, service, database migration, verifier, race/fault, TUI,
  native-platform, installer, backup/restore, signing, performance,
  publication, or release command was run or claimed by T91.
- No command changed product source, contract manifests, protocol registries,
  plan authority, or execution state.
- A read-only protected-path status check still shows pre-existing dirty Rust
  paths and pre-existing/untracked production contract-manifest paths; those
  are outside this attempt's write set and were not modified by T91.
- The T92 matrix in `reconciliation.md` is the required rerun set; T92 must
  repeat the structural checks on its exact combined source identity and keep
  the planning-validator failure if it remains.
