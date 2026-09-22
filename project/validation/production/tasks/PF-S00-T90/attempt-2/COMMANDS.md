# PF-S00-T90 attempt 2 command record

## Identity

- Workspace: `/Users/cybertron/Code/boreal-work`
- Assigned source: `working-tree-aggregate:b8b1aeb028553c6594bc0a9d5a674c7df3fb2b8c6dfe25a4d84014d13ef4fb55; HEAD:784a41b3; dirty`
- Observed HEAD: `784a41b3802c29a76721c55eef2e9493283396c2`
- Branch: `codex/apply-responsive-terminal-overlay`
- Reviewer/agent: independent validation subagent, `01a0c62c-f386-7950-936c-a28218342509`
- No command wrote to the repository; no raw stdout/stderr log files were created.

## Checks run

| Exact command | CWD | Exit | Result / scope |
| --- | --- | ---: | --- |
| `python3 -m json.tool project/validation/production/baseline/obligations-map.json >/dev/null` | repository root | 0 | Obligations-map JSON syntax. |
| `python3 -m json.tool project/validation/production/baseline/findings.json >/dev/null` | repository root | 0 | Baseline findings JSON syntax. |
| `python3 -m json.tool project/validation/production/baseline/checks.json >/dev/null` | repository root | 0 | Baseline checks JSON syntax. |
| `python3 tools/plan.py validate` | `project/build-plan/production-completion` | 0 | Plan structure passed: 22 sprints, 264 tasks, 48 original obligations, 113 source references, 56 acceptance rows. Planning layer only. |
| `python3 tools/plan.py graph-ready` | `project/build-plan/production-completion` | 0 | Returned no graph-ready tasks and warned readiness is not authority. |
| `python3 tools/plan.py conflicts PF-S00-T06 PF-S00-T90` | `project/build-plan/production-completion` | 0 | No conservative path overlap. |
| `python3 tools/plan.py conflicts PF-S00-T07 PF-S00-T90` | `project/build-plan/production-completion` | 0 | No conservative path overlap. |
| `python3 tools/plan.py verify-package` | `project/build-plan/production-completion` | 1 | Mismatch remains at `execution/STATE.json`; retained as an open planning-package discrepancy. |
| `bwrk workflows show boreal.workflow.audit.v1 --json` | repository root | 6 | `service_busy`; offline audit resolver could not acquire the existing database owner. No live state was mutated. |
| `python3 -m json.tool project/validation/production/sprints/PF-S00/findings.json >/dev/null` | repository root | 0 | This attempt's findings JSON syntax. |
| `python3 - <<'PY' ... balanced fences/trailing whitespace check ... PY` | repository root | 0 | Simple Markdown checks for `review.md`, `COMMANDS.md`, `EVIDENCE.md`, and `HANDOFF.md`. |
| `git status --short -- project/validation/production/sprints/PF-S00/review.md project/validation/production/sprints/PF-S00/findings.json project/validation/production/tasks/PF-S00-T90/attempt-2` | repository root | 0 | Confirmed only the granted review and attempt paths are new from this attempt. |

## Commands attempted during context loading

| Exact command/result | Interpretation |
| --- | --- |
| `sed -n '1,220p' boreal.yaml` — exit 2, file not found | No repository-root `boreal.yaml` was available for workflow resolution. |
| `bwrk workflows show boreal.workflow.audit.v1 --json` from the plan directory — exit 2, unknown command path | The plan-directory invocation did not resolve the workflow command; the repository-root invocation above reached the offline resolver and returned `service_busy`. |

The checks above validate syntax, planning structure, path conflicts, and
command availability only. They do not prove product behavior, a real service,
native packaging, publication, release, or an external review capacity.
