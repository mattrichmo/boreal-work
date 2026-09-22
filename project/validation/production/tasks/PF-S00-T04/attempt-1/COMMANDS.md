# PF-S00-T04 attempt 1 commands

All commands were read-only. No command altered application, plan, execution state, database, Cargo, or TUI files.

| # | Command | CWD | Exit | Applicability |
|---|---|---|---:|---|
| 1 | `sed`/`rg` reads of mandated plan, context, handoff, registry, protocol, application, store, CLI, update, and TUI files | `/Users/cybertron/Code/boreal-work` | 0 | Source navigation and inventory only. Some combined output was truncated by the display wrapper; findings cite the current files directly. |
| 2 | `bwrk prime --json` | `/Users/cybertron/Code/boreal-work` | 0 process / rejected envelope | Returned `invalid_argument`, `missing project identifier`; no project ID was invented and no state changed. This is the T01 file-based-plan/runtime distinction, not a task failure. |
| 3 | `python3 project/spec/validate_contracts.py` | `/Users/cybertron/Code/boreal-work` | 0 | Fresh current-tree contract/fixture check: 8 protocol envelopes, 11 guidance fixtures, 10 workflow assets, 18 legal/15 illegal transition vectors, 19 clock/dependency cases, 52 conformance mappings, SQLite schema parsed. Fixture/contract evidence only. |
| 4 | `jq empty project/validation/production/baseline/findings.json` | `/Users/cybertron/Code/boreal-work` | 0 | Machine-readable artifact syntax check. |
| 5 | `git status --short -- <assigned paths>` | `/Users/cybertron/Code/boreal-work` | 0 | Confirmed only the assigned new baseline/evidence paths are task outputs; unrelated existing changes were not touched. |

## Deliberately not run

No Cargo build/test, Rust formatter, service launch, CLI lifecycle execution, TUI real-service run, install/upgrade, publication, or release check was run. The task requested a bounded source inventory and explicitly forbids promoting fixture/source inspection into production proof. Those checks belong to downstream acceptance tasks and PF-S00 review/reconciliation/revalidation.
