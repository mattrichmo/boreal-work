# R-VALIDATOR — scripts/validation/m02/run_candidate.py

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/validation/m02/run_candidate.py:L1–L82`  
**File SHA-256:** `9632b3a1484fb5c99d3a186729876c18b5a494b24c7863eb13abdb9963e52af3`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing exact build/test commands and explicit fake-service versus real-service scope labels.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,82p' 'scripts/validation/m02/run_candidate.py'
```

## Exact baseline excerpt

````text
    1 | #!/usr/bin/env python3
    2 | """Record repeatable source-candidate checks, including unavailable tools.
    3 | 
    4 | Exit 1 if any command fails or cannot run. Even exit 0 would not certify M02:
    5 | independent sprint gates, genuine service E2E and platform releases are separate.
    6 | Evidence files are Markdown/JSON so the source archive retains failed runs.
    7 | """
    8 | from __future__ import annotations
    9 | 
   10 | import argparse
   11 | import datetime as dt
   12 | import json
   13 | from pathlib import Path
   14 | import platform
   15 | import shlex
   16 | import subprocess
   17 | import sys
   18 | 
   19 | ROOT = Path(__file__).resolve().parents[3]
   20 | CHECKS = [
   21 |     ('diff-whitespace', 'source hygiene only', ['git', 'diff', '--check']),
   22 |     ('contracts', 'structural existing contract/SQLite fixtures; not full M02', ['python3', 'project/spec/validate_contracts.py']),
   23 |     ('rust-format', 'Rust formatting; requires installed rustfmt', ['cargo', 'fmt', '--all', '--', '--check']),
   24 |     ('rust-domain', 'authored M02 evaluator tests', ['cargo', 'test', '--locked', '-p', 'boreal-domain', '--test', 'm02_status']),
   25 |     ('rust-store', 'authored canonical claim/race tests', ['cargo', 'test', '--locked', '-p', 'boreal-store', '--test', 'm02_claim']),
   26 |     ('rust-application', 'authored durable actor/status tests', ['cargo', 'test', '--locked', '-p', 'boreal-application', '--test', 'm02_status_authority']),
   27 |     ('rust-protocol', 'authored additive DTO tests', ['cargo', 'test', '--locked', '-p', 'boreal-protocol', '--test', 'm02_status_wire']),
   28 |     ('rust-workspace', 'full locked workspace tests', ['cargo', 'test', '--locked', '--workspace']),
   29 |     ('rust-cli-build', 'CLI build, not release packaging', ['cargo', 'build', '--locked', '-p', 'boreal-cli']),
   30 |     ('tui-typecheck', 'TypeScript compiler', ['npm', '--prefix', 'apps/tui', 'run', 'typecheck']),
   31 |     ('tui-tests', 'core suite + Node unit/presentation fixtures', ['npm', '--prefix', 'apps/tui', 'test']),
   32 |     ('installer-identity', 'generated wizard and embedded installer byte identity', ['node', 'scripts/build-installer.mjs', '--check']),
   33 |     ('shell-syntax', 'shell parser only', ['sh', '-n', 'install.sh']),
   34 |     ('zip-js-syntax', 'JavaScript parser only', ['node', '--check', 'create-zips.mjs']),
   35 |     ('wizard-js-syntax', 'JavaScript parser only', ['node', '--check', 'apps/tui/installer/wizard.cjs']),
   36 |     ('wizard-body-js-syntax', 'JavaScript parser only', ['node', '--check', 'apps/tui/installer/wizard-body.cjs']),
   37 |     ('premium', 'real PTYs and local fake release/controller fixtures, NOT Rust E2E', ['python3', 'scripts/validation/premium/validate_premium.py', '-v']),
   38 |     ('responsive', 'real PTYs and fake service fixtures, NOT Rust E2E', ['python3', 'scripts/validation/premium/validate_responsive.py', '-v']),
   39 |     ('source-archive', 'real root ZIP generator + isolated TUI rebuild; NOT release binary', ['python3', 'scripts/validation/m02/source_archive_test.py', '--exercise']),
   40 | ]
   41 | 
   42 | 
   43 | def main() -> int:
   44 |     parser = argparse.ArgumentParser(description=__doc__)
   45 |     parser.add_argument('--output', type=Path, required=True)
   46 |     args = parser.parse_args()
   47 |     output = args.output.resolve()
   48 |     output.mkdir(parents=True, exist_ok=True)
   49 |     rows = []
   50 |     for name, scope, command in CHECKS:
   51 |         print(f'CHECK {name}: {shlex.join(command)}', flush=True)
   52 |         try:
   53 |             process = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE,
   54 |                                      stderr=subprocess.STDOUT, check=False, timeout=180)
   55 |             code, text = process.returncode, process.stdout
   56 |             status = 'passed' if code == 0 else 'failed'
   57 |         except FileNotFoundError as error:
   58 |             code, text, status = 127, f'{error}\n', 'blocked_tool_unavailable'
   59 |         except subprocess.TimeoutExpired as error:
   60 |             code, status = 124, 'failed_timeout'
   61 |             captured = error.stdout or b''
   62 |             text = (captured.decode(errors='replace') if isinstance(captured, bytes) else captured) + '\nTIMEOUT\n'
   63 |         file = output / f'{name}.md'
   64 |         file.write_text(f'# {name}\n\nCommand: `{shlex.join(command)}`\n\nScope: {scope}\n\n'
   65 |                         f'Result: **{status}**; exit {code}.\n\n```text\n{text}\n```\n', encoding='utf-8')
   66 |         rows.append({'name': name, 'command': command, 'scope': scope, 'status': status, 'exit_code': code,
   67 |                      'evidence_file': file.name})
   68 |         print(f'{status}: {name} (exit {code})', flush=True)
   69 |     report = {
   70 |         'schema': 'boreal.m02.candidate-checks/1', 'as_of': dt.datetime.now(dt.timezone.utc).isoformat(),
   71 |         'host': platform.platform(), 'checks': rows,
   72 |         'all_executable_checks_passed': all(row['exit_code'] == 0 for row in rows),
   73 |         'm02_acceptance': 'not_certified', 'release_decision': 'do not ship',
   74 |         'independent_review': 'not performed',
   75 |         'warning': 'This runner does not certify sprint gates, migration parity, genuine service-backed lifecycle or supported release platforms.',
   76 |     }
   77 |     (output / 'checks.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
   78 |     return 0 if report['all_executable_checks_passed'] else 1
   79 | 
   80 | 
   81 | if __name__ == '__main__':
   82 |     sys.exit(main())
````
