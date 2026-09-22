#!/usr/bin/env python3
"""Record repeatable source-candidate checks, including unavailable tools.

Exit 1 if any command fails or cannot run. Even exit 0 would not certify M02:
independent sprint gates, genuine service E2E and platform releases are separate.
Evidence files are Markdown/JSON so the source archive retains failed runs.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path
import platform
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[3]
CHECKS = [
    ('diff-whitespace', 'source hygiene only', ['git', 'diff', '--check']),
    ('contracts', 'structural existing contract/SQLite fixtures; not full M02', ['python3', 'project/spec/validate_contracts.py']),
    ('rust-format', 'Rust formatting; requires installed rustfmt', ['cargo', 'fmt', '--all', '--', '--check']),
    ('rust-domain', 'authored M02 evaluator tests', ['cargo', 'test', '--locked', '-p', 'boreal-domain', '--test', 'm02_status']),
    ('rust-store', 'authored canonical claim/race tests', ['cargo', 'test', '--locked', '-p', 'boreal-store', '--test', 'm02_claim']),
    ('rust-application', 'authored durable actor/status tests', ['cargo', 'test', '--locked', '-p', 'boreal-application', '--test', 'm02_status_authority']),
    ('rust-protocol', 'authored additive DTO tests', ['cargo', 'test', '--locked', '-p', 'boreal-protocol', '--test', 'm02_status_wire']),
    ('rust-workspace', 'full locked workspace tests', ['cargo', 'test', '--locked', '--workspace']),
    ('rust-cli-build', 'CLI build, not release packaging', ['cargo', 'build', '--locked', '-p', 'boreal-cli']),
    ('tui-typecheck', 'TypeScript compiler', ['npm', '--prefix', 'apps/tui', 'run', 'typecheck']),
    ('tui-tests', 'core suite + Node unit/presentation fixtures', ['npm', '--prefix', 'apps/tui', 'test']),
    ('installer-identity', 'generated wizard and embedded installer byte identity', ['node', 'scripts/build-installer.mjs', '--check']),
    ('shell-syntax', 'shell parser only', ['sh', '-n', 'install.sh']),
    ('zip-js-syntax', 'JavaScript parser only', ['node', '--check', 'create-zips.mjs']),
    ('wizard-js-syntax', 'JavaScript parser only', ['node', '--check', 'apps/tui/installer/wizard.cjs']),
    ('wizard-body-js-syntax', 'JavaScript parser only', ['node', '--check', 'apps/tui/installer/wizard-body.cjs']),
    ('premium', 'real PTYs and local fake release/controller fixtures, NOT Rust E2E', ['python3', 'scripts/validation/premium/validate_premium.py', '-v']),
    ('responsive', 'real PTYs and fake service fixtures, NOT Rust E2E', ['python3', 'scripts/validation/premium/validate_responsive.py', '-v']),
    ('source-archive', 'real root ZIP generator + isolated TUI rebuild; NOT release binary', ['python3', 'scripts/validation/m02/source_archive_test.py', '--exercise']),
]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    rows = []
    for name, scope, command in CHECKS:
        print(f'CHECK {name}: {shlex.join(command)}', flush=True)
        try:
            process = subprocess.run(command, cwd=ROOT, text=True, stdout=subprocess.PIPE,
                                     stderr=subprocess.STDOUT, check=False, timeout=180)
            code, text = process.returncode, process.stdout
            status = 'passed' if code == 0 else 'failed'
        except FileNotFoundError as error:
            code, text, status = 127, f'{error}\n', 'blocked_tool_unavailable'
        except subprocess.TimeoutExpired as error:
            code, status = 124, 'failed_timeout'
            captured = error.stdout or b''
            text = (captured.decode(errors='replace') if isinstance(captured, bytes) else captured) + '\nTIMEOUT\n'
        file = output / f'{name}.md'
        file.write_text(f'# {name}\n\nCommand: `{shlex.join(command)}`\n\nScope: {scope}\n\n'
                        f'Result: **{status}**; exit {code}.\n\n```text\n{text}\n```\n', encoding='utf-8')
        rows.append({'name': name, 'command': command, 'scope': scope, 'status': status, 'exit_code': code,
                     'evidence_file': file.name})
        print(f'{status}: {name} (exit {code})', flush=True)
    report = {
        'schema': 'boreal.m02.candidate-checks/1', 'as_of': dt.datetime.now(dt.timezone.utc).isoformat(),
        'host': platform.platform(), 'checks': rows,
        'all_executable_checks_passed': all(row['exit_code'] == 0 for row in rows),
        'm02_acceptance': 'not_certified', 'release_decision': 'do not ship',
        'independent_review': 'not performed',
        'warning': 'This runner does not certify sprint gates, migration parity, genuine service-backed lifecycle or supported release platforms.',
    }
    (output / 'checks.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    return 0 if report['all_executable_checks_passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
