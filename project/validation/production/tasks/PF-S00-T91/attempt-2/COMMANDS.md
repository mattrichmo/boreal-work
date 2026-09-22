# PF-S00-T91 — coordinator attempt 2 command record

Commands were run from `/Users/cybertron/Code/boreal-work` unless noted.

| Command | Exit | Classification |
| --- | ---: | --- |
| `python3 -m json.tool project/validation/production/sprints/PF-S00/findings.json` | 0 | T90 finding input syntax. |
| `python3 -m json.tool project/validation/production/sprints/PF-S00/remediation-map.json` | 0 | Reconciliation map syntax. |
| `python3 -m json.tool project/validation/production/baseline/obligations-map.json` | 0 | 48-obligation map syntax. |
| `python3 project/build-plan/production-completion/tools/plan.py validate` | 0 | Planning graph and link validation; no product acceptance. |
| `python3 project/build-plan/production-completion/tools/plan.py conflicts PF-S00-T90 PF-S00-T91` | 0 / no overlap | Review/reconciliation output boundary check. |
| `python3 project/build-plan/production-completion/tools/plan.py conflicts PF-S00-T91 PF-S00-T92` | 0 / no overlap | Reconciliation/revalidation output boundary check. |
| `git diff --check -- project/validation/production/sprints/PF-S00 project/validation/production/tasks/PF-S00-T91/attempt-2` | 0 / no output | Artifact whitespace check. |

No live database command, product source build, service lifecycle, native
platform, release, or publication result was used by this task.
