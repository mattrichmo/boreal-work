# R-ARCHIVE-TEST — scripts/validation/m02/source_archive_test.py

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `scripts/validation/m02/source_archive_test.py:L1–L103`  
**File SHA-256:** `f898c53fe8b0a7e607a35c0c95c2170bc90b01fb019d67aecc1f46fc02175937`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Archive regression and clean extraction exercises; keep source/package acceptance distinct.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,103p' 'scripts/validation/m02/source_archive_test.py'
```

## Exact baseline excerpt

````text
    1 | #!/usr/bin/env python3
    2 | """Exercise the real root source-ZIP generator; never substitutes a release build.
    3 | 
    4 | Use --archive FILE to inspect an already generated ZIP. --exercise also builds
    5 | and tests the TUI from an isolated extraction. No network or project database.
    6 | """
    7 | from __future__ import annotations
    8 | 
    9 | import argparse
   10 | from pathlib import Path, PurePosixPath
   11 | import subprocess
   12 | import tempfile
   13 | import zipfile
   14 | 
   15 | ROOT = Path(__file__).resolve().parents[3]
   16 | REQUIRED = (
   17 |     'IMPLEMENTATION_REPORT.md', 'Cargo.toml', 'Cargo.lock', 'create-zips.mjs',
   18 |     'install.sh', 'apps/tui/installer/wizard.cjs',
   19 |     'apps/tui/installer/wizard-body.cjs', 'apps/tui/src/client.ts',
   20 |     'apps/tui/src/ui/dashboard.ts', 'apps/tui/tests/m02-contract.test.mjs',
   21 |     'crates/domain/src/status_evaluator.rs', 'crates/domain/tests/m02_status.rs',
   22 |     'crates/store/src/status_evaluation.rs', 'crates/store/tests/m02_claim.rs',
   23 |     'crates/application/tests/m02_status_authority.rs',
   24 |     'crates/protocol/tests/m02_status_wire.rs',
   25 |     'project/validation/m02/REQUEST.md',
   26 |     'project/build-plan/M02-DETERMINISTIC-PLANNING-AND-PARITY.md',
   27 |     'scripts/validation/m02/source_archive_test.py',
   28 | )
   29 | FORBIDDEN_PARTS = {'.git', '.boreal', 'node_modules', 'dist', 'target', '__pycache__', 'coverage'}
   30 | TEXT_SUFFIXES = {'.json', '.lock', '.mjs', '.cjs', '.md', '.py', '.rb', '.rs', '.sh', '.sql', '.template', '.toml', '.ts', '.tsx', '.yaml', '.yml'}
   31 | 
   32 | 
   33 | def run(command: list[str], cwd: Path) -> None:
   34 |     print('+ ' + ' '.join(command), flush=True)
   35 |     subprocess.run(command, cwd=cwd, check=True, timeout=180)
   36 | 
   37 | 
   38 | def verify(archive: Path, scratch: Path, exercise: bool) -> None:
   39 |     with zipfile.ZipFile(archive) as source:
   40 |         names = source.namelist()
   41 |         if len(names) != len(set(names)):
   42 |             raise AssertionError('duplicate archive entry')
   43 |         for name in names:
   44 |             entry = PurePosixPath(name)
   45 |             if entry.is_absolute() or '..' in entry.parts or not entry.parts or entry.parts[0] != 'boreal-v2':
   46 |                 raise AssertionError(f'unsafe archive member: {name}')
   47 |             if FORBIDDEN_PARTS.intersection(entry.parts):
   48 |                 raise AssertionError(f'generated/runtime content leaked: {name}')
   49 |             if entry.suffix.lower() in {'.ttf', '.otf', '.woff', '.woff2', '.sqlite', '.db', '.exe', '.so', '.dylib'}:
   50 |                 raise AssertionError(f'binary/font/runtime content leaked: {name}')
   51 |         files = {name for name in names if not name.endswith('/')}
   52 |         bad = source.testzip()
   53 |         if bad:
   54 |             raise AssertionError(f'ZIP CRC failed: {bad}')
   55 |         for name in REQUIRED:
   56 |             key = 'boreal-v2/' + name
   57 |             if key not in files:
   58 |                 raise AssertionError(f'required source omitted: {name}')
   59 |             if source.read(key) != (ROOT / name).read_bytes():
   60 |                 raise AssertionError(f'source byte mismatch: {name}')
   61 |         # Catch omissions anywhere in the TUI, not just the entrypoint/wizard.
   62 |         tui_files = 0
   63 |         for path in (ROOT / 'apps/tui').rglob('*'):
   64 |             relative = path.relative_to(ROOT)
   65 |             if not path.is_file() or FORBIDDEN_PARTS.intersection(relative.parts):
   66 |                 continue
   67 |             if path.suffix.lower() not in TEXT_SUFFIXES and path.name not in {'.gitignore', '.gitattributes', '.gitkeep'}:
   68 |                 continue
   69 |             key = 'boreal-v2/' + relative.as_posix()
   70 |             if key not in files or source.read(key) != path.read_bytes():
   71 |                 raise AssertionError(f'full TUI tree is not byte-complete: {relative}')
   72 |             tui_files += 1
   73 |         source.extractall(scratch)
   74 |     print(f'PASS: {len(files)} ZIP files; {len(REQUIRED)} required paths; {tui_files} TUI text files byte-identical', flush=True)
   75 |     if exercise:
   76 |         checkout = scratch / 'boreal-v2'
   77 |         run(['npm', '--prefix', 'apps/tui', 'test'], checkout)
   78 |         run(['node', 'scripts/build-installer.mjs', '--check'], checkout)
   79 |         run(['python3', 'project/spec/validate_contracts.py'], checkout)
   80 |         print('PASS: isolated source extraction rebuilds/tests the TUI; installer identity and contract checks pass', flush=True)
   81 |     print('NOT A RELEASE GATE: no rebuilt Rust binary, live service E2E, independent audit, or platform release is implied.', flush=True)
   82 | 
   83 | 
   84 | def main() -> None:
   85 |     parser = argparse.ArgumentParser(description=__doc__)
   86 |     parser.add_argument('--archive', type=Path)
   87 |     parser.add_argument('--exercise', action='store_true')
   88 |     args = parser.parse_args()
   89 |     with tempfile.TemporaryDirectory(prefix='boreal-m02-archive-') as temporary:
   90 |         folder = Path(temporary)
   91 |         archive = args.archive.resolve() if args.archive else None
   92 |         if archive is None:
   93 |             output = folder / 'archives'
   94 |             run(['node', str(ROOT / 'create-zips.mjs'), '--output-dir', str(output)], ROOT)
   95 |             archives = list(output.glob('*.zip'))
   96 |             if len(archives) != 1:
   97 |                 raise AssertionError(f'expected one source ZIP, found {len(archives)}')
   98 |             archive = archives[0]
   99 |         verify(archive, folder / 'extracted', args.exercise)
  100 | 
  101 | 
  102 | if __name__ == '__main__':
  103 |     main()
````
