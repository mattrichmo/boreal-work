# PF-S01-T11 attempt 2 — commands and results

| Command | Result |
| --- | --- |
| `python3 -m json.tool project/spec/production/conformance-matrix.json` | passed |
| Conformance referential/category check | passed: 48 unique M02 obligations; 49 detailed vectors; 49 metadata rows; all obligation references resolve; required categories and allowed `unmeasured` dispositions are complete |
| `python3 project/spec/validate_contracts.py` | passed: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed |
| JSON parse for production/protocol/manifest integration files | passed |
| `python3 tools/plan.py validate` | passed: 22 sprints, 265 tasks, 48 M02 obligations, 56 acceptance rows, acyclic graph |
| `python3 tools/plan.py verify-package` | passed: 444 issued plan files, no mismatches |
| `python3 tools/plan.py graph-ready` | passed as a dependency-readiness check; no successor is authorized while T11 is unaccepted |

The worker attempt was interrupted before producing a matrix and is preserved
under `attempt-1/`. The coordinator authored the matrix and integrated the
shared contract/manifest/error-registry paths in this attempt. Rust/service,
native, migration, installer, and supported-platform checks were not claimed.
