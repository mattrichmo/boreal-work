#!/usr/bin/env python3
"""Exercise the real root source-ZIP generator; never substitutes a release build.

Use --archive FILE to inspect an already generated ZIP. --exercise also builds
and tests the TUI from an isolated extraction. No network or project database.
"""
from __future__ import annotations

import argparse
from pathlib import Path, PurePosixPath
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[3]
REQUIRED = (
    'IMPLEMENTATION_REPORT.md', 'Cargo.toml', 'Cargo.lock', 'create-zips.mjs',
    'install.sh', 'apps/tui/installer/wizard.cjs',
    'apps/tui/installer/wizard-body.cjs', 'apps/tui/src/client.ts',
    'apps/tui/src/ui/dashboard.ts', 'apps/tui/tests/m02-contract.test.mjs',
    'crates/domain/src/status_evaluator.rs', 'crates/domain/tests/m02_status.rs',
    'crates/store/src/status_evaluation.rs', 'crates/store/tests/m02_claim.rs',
    'crates/application/tests/m02_status_authority.rs',
    'crates/protocol/tests/m02_status_wire.rs',
    'project/validation/m02/REQUEST.md',
    'project/build-plan/M02-DETERMINISTIC-PLANNING-AND-PARITY.md',
    'scripts/validation/m02/source_archive_test.py',
)
FORBIDDEN_PARTS = {'.git', '.boreal', 'node_modules', 'dist', 'target', '__pycache__', 'coverage'}
TEXT_SUFFIXES = {'.json', '.lock', '.mjs', '.cjs', '.md', '.py', '.rb', '.rs', '.sh', '.sql', '.template', '.toml', '.ts', '.tsx', '.yaml', '.yml'}


def run(command: list[str], cwd: Path) -> None:
    print('+ ' + ' '.join(command), flush=True)
    subprocess.run(command, cwd=cwd, check=True, timeout=180)


def verify(archive: Path, scratch: Path, exercise: bool) -> None:
    with zipfile.ZipFile(archive) as source:
        names = source.namelist()
        if len(names) != len(set(names)):
            raise AssertionError('duplicate archive entry')
        for name in names:
            entry = PurePosixPath(name)
            if entry.is_absolute() or '..' in entry.parts or not entry.parts or entry.parts[0] != 'boreal-v2':
                raise AssertionError(f'unsafe archive member: {name}')
            if FORBIDDEN_PARTS.intersection(entry.parts):
                raise AssertionError(f'generated/runtime content leaked: {name}')
            if entry.suffix.lower() in {'.ttf', '.otf', '.woff', '.woff2', '.sqlite', '.db', '.exe', '.so', '.dylib'}:
                raise AssertionError(f'binary/font/runtime content leaked: {name}')
        files = {name for name in names if not name.endswith('/')}
        bad = source.testzip()
        if bad:
            raise AssertionError(f'ZIP CRC failed: {bad}')
        for name in REQUIRED:
            key = 'boreal-v2/' + name
            if key not in files:
                raise AssertionError(f'required source omitted: {name}')
            if source.read(key) != (ROOT / name).read_bytes():
                raise AssertionError(f'source byte mismatch: {name}')
        # Catch omissions anywhere in the TUI, not just the entrypoint/wizard.
        tui_files = 0
        for path in (ROOT / 'apps/tui').rglob('*'):
            relative = path.relative_to(ROOT)
            if not path.is_file() or FORBIDDEN_PARTS.intersection(relative.parts):
                continue
            if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {'.gitignore', '.gitattributes', '.gitkeep'}:
                continue
            key = 'boreal-v2/' + relative.as_posix()
            if key not in files or source.read(key) != path.read_bytes():
                raise AssertionError(f'full TUI tree is not byte-complete: {relative}')
            tui_files += 1
        source.extractall(scratch)
    print(f'PASS: {len(files)} ZIP files; {len(REQUIRED)} required paths; {tui_files} TUI text files byte-identical', flush=True)
    if exercise:
        checkout = scratch / 'boreal-v2'
        run(['npm', '--prefix', 'apps/tui', 'test'], checkout)
        run(['node', 'scripts/build-installer.mjs', '--check'], checkout)
        run(['python3', 'project/spec/validate_contracts.py'], checkout)
        print('PASS: isolated source extraction rebuilds/tests the TUI; installer identity and contract checks pass', flush=True)
    print('NOT A RELEASE GATE: no rebuilt Rust binary, live service E2E, independent audit, or platform release is implied.', flush=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path)
    parser.add_argument('--exercise', action='store_true')
    args = parser.parse_args()
    with tempfile.TemporaryDirectory(prefix='boreal-m02-archive-') as temporary:
        folder = Path(temporary)
        archive = args.archive.resolve() if args.archive else None
        if archive is None:
            output = folder / 'archives'
            run(['node', str(ROOT / 'create-zips.mjs'), '--output-dir', str(output)], ROOT)
            archives = list(output.glob('*.zip'))
            if len(archives) != 1:
                raise AssertionError(f'expected one source ZIP, found {len(archives)}')
            archive = archives[0]
        verify(archive, folder / 'extracted', args.exercise)


if __name__ == '__main__':
    main()
