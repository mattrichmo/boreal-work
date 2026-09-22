# PF-S00-T07 — coordinator attempt 3 command record

Commands were run from `/Users/cybertron/Code/boreal-work` unless noted.

| Command | Exit | Classification |
| --- | ---: | --- |
| `python3 -m json.tool project/build-plan/production-completion/plan.json` | 0 | Plan JSON syntax. |
| `python3 -m json.tool project/validation/production/baseline/obligations-map.json` | 0 | Generated 48-obligation map syntax. |
| `python3 -m json.tool project/validation/production/baseline/findings.json` | 0 | Baseline findings input syntax. |
| `python3 -m json.tool project/validation/production/baseline/source-inventory.json` | 0 | Baseline archive/source inventory syntax. |
| `python3 project/build-plan/production-completion/tools/plan.py validate` | 0 | Full 22-sprint planning graph and link validation. |
| `python3 project/build-plan/production-completion/tools/plan.py conflicts PF-S00-T07 PF-S00-T90` | 0 / no overlap | Conservative output-boundary check. |
| `git diff --check -- project/validation/production/baseline project/validation/production/tasks/PF-S00-T07/attempt-3` | 0 / no output | Artifact whitespace check. |

No Rust build, service lifecycle, genuine verifier, native-platform, TUI PTY,
installer, publication, or live database command was used as acceptance for
this documentation/coordination task.
