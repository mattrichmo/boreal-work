# PF-S00-T91 attempt 1 command record

## Identity and scope

- Workspace: `/Users/cybertron/Code/boreal-work`
- Fixed input: `working-tree-aggregate:316566184c6d1b025c375edc810a70b99c70b623473044dd959ac7cd558d372a; HEAD:784a41b3802c29a76721c55eef2e9493283396c2; dirty`
- Branch: `codex/apply-responsive-terminal-overlay`
- This attempt's writes are limited to the PF-S00-T91 reconciliation outputs
  and attempt directory. No raw command log files were created.

## Checks run by this attempt

The following are the only validation checks run for T91. They are artifact,
planning, conflict, Markdown, or read-only identity checks; they are not
product acceptance or live-database checks.

| Exact command | CWD | Exit | Result / scope |
| --- | --- | ---: | --- |
| `python3 -m json.tool project/validation/production/sprints/PF-S00/remediation-map.json >/dev/null` | repository root | 0 | T91 remediation-map JSON syntax. |
| `python3 -m json.tool project/validation/production/sprints/PF-S00/findings.json >/dev/null` | repository root | 0 | Preserved T90 findings JSON syntax. |
| `python3 -m json.tool project/build-plan/production-completion/plan.json >/dev/null` | repository root | 0 | Plan authority JSON syntax; read-only. |
| `python3 -m json.tool project/build-plan/production-completion/execution/STATE.json >/dev/null` | repository root | 0 | Execution ledger JSON syntax; read-only. |
| `python3 -m json.tool project/validation/production/baseline/obligations-map.json >/dev/null` | repository root | 0 | 48-obligation map syntax. |
| `python3 -m json.tool project/validation/production/baseline/findings.json >/dev/null` | repository root | 0 | Baseline findings syntax. |
| `python3 -m json.tool project/validation/production/baseline/checks.json >/dev/null` | repository root | 0 | Baseline checks syntax. |
| `python3 -m json.tool project/validation/production/baseline/source-inventory.json >/dev/null` | repository root | 0 | Source inventory syntax. |
| `python3 tools/plan.py validate` | `project/build-plan/production-completion` | 0 | Structural plan validation passed; planning layer only. |
| `python3 tools/plan.py graph-ready` | `project/build-plan/production-completion` | 0 | No graph-ready task; readiness is advisory and not authority. |
| `python3 tools/plan.py conflicts PF-S00-T06 PF-S00-T91` | `project/build-plan/production-completion` | 0 | No conservative write-path overlap. |
| `python3 tools/plan.py conflicts PF-S00-T07 PF-S00-T91` | `project/build-plan/production-completion` | 0 | No conservative write-path overlap. |
| `python3 tools/plan.py conflicts PF-S00-T90 PF-S00-T91` | `project/build-plan/production-completion` | 0 | No conservative write-path overlap. |
| `python3 tools/plan.py conflicts PF-S00-T91 PF-S00-T92` | `project/build-plan/production-completion` | 0 | No conservative write-path overlap. |
| `python3 -c '...balanced Markdown fences and trailing whitespace over the T90/T91 Markdown set...'` | repository root | 0 | Markdown contract check passed. Exact expanded command is recorded below. |
| `git rev-parse HEAD` | repository root | 0 | HEAD is `784a41b3802c29a76721c55eef2e9493283396c2`. |
| `git branch --show-current` | repository root | 0 | Branch is `codex/apply-responsive-terminal-overlay`. |
| `git status --short --untracked-files=all -- project/validation/production/sprints/PF-S00/reconciliation.md project/validation/production/sprints/PF-S00/remediation-map.json project/validation/production/tasks/PF-S00-T91/attempt-1` | repository root | 0 | Only the three granted T91 output scopes are inspected; pre-existing unrelated work remains untouched. |
| `sha256sum` over the fixed review inputs and T91 reconciliation outputs | repository root | 0 | Digests are recorded in `EVIDENCE.md`; evidence/handoff files are excluded from their own digest claims. |

## Expanded Markdown command

```sh
python3 -c 'from pathlib import Path; paths=[Path("project/validation/production/sprints/PF-S00/review.md"),Path("project/validation/production/sprints/PF-S00/reconciliation.md"),Path("project/validation/production/tasks/PF-S00-T90/attempt-2/COMMANDS.md"),Path("project/validation/production/tasks/PF-S00-T90/attempt-2/EVIDENCE.md"),Path("project/validation/production/tasks/PF-S00-T90/attempt-2/HANDOFF.md"),Path("project/validation/production/tasks/PF-S00-T91/attempt-1/START.md"),Path("project/validation/production/tasks/PF-S00-T91/attempt-1/COMMANDS.md"),Path("project/validation/production/tasks/PF-S00-T91/attempt-1/EVIDENCE.md"),Path("project/validation/production/tasks/PF-S00-T91/attempt-1/HANDOFF.md")]; bad=[]; [(bad.append(f"{p}:trailing-whitespace:{i}") if line.rstrip("\\n").rstrip(" \\t") != line.rstrip("\\n") else None, bad.append(f"{p}:unbalanced-fence") if sum(1 for x in p.read_text().splitlines() if x.strip().startswith("```") ) % 2 else None) for p in paths for i,line in enumerate(p.read_text().splitlines(True),1)]; print("markdown_failures", bad); raise SystemExit(bool(bad))'
```

## Explicitly not run by T91

- `python3 tools/plan.py verify-package` was not rerun here; T90's inherited
  exit `1` mismatch at `execution/STATE.json` remains open and is a mandatory
  T92 rerun.
- `bwrk workflows show boreal.workflow.audit.v1 --json` was not rerun here;
  T90's exit `6` `service_busy` result remains blocked. No live lock was
  force-broken and no direct database inspection was performed.
- No Rust build/test, service lifecycle, native-platform, publication,
  release, or product-acceptance check was run.
