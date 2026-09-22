# PF-S01-T90 attempt 6 — commands and results

Workspace: `/Users/cybertron/Code/boreal-work`
Review source identity: `784a41b3802c29a76721c55eef2e9493283396c2`; worktree is dirty by design and is not a release identity.

| Command | Result |
| --- | --- |
| `python3 project/spec/validate_contracts.py` | passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| `python3 tools/plan.py validate` from `project/build-plan/production-completion` | passed: 22 sprints, 265 tasks, 48 M02 obligations, 56 acceptance rows, 265-node acyclic graph, 17,134 local links, 0 errors; planning structure only |
| `python3 tools/plan.py graph-ready` | passed as an advisory readiness query; returned no tasks and warned that readiness is not authority |
| `python3 tools/plan.py verify-package` | passed: 444 issued-plan files checked, 0 mismatches; plan package identity only |
| Read-only manifest/conformance identity check | passed: 0 manifest hash mismatches, 48 obligations, 49 vectors, 49 metadata rows, no dangling references, one-to-one metadata join, all required categories present, all dispositions `unmeasured` |

## Intentionally unrun / not claimed

No Rust build/test, service lifecycle, database migration, real verifier,
multi-process race/fault, TUI, native-platform, installer, backup/restore,
signing, performance, or production-release check was run or claimed by this
review. The structural validator outputs do not establish those behaviors.
