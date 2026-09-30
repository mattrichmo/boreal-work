#!/usr/bin/env python3
"""Exercise an ACTUALLY installed prefix, never an ambient bwrk or dummy binary.

Called by package-smoke.sh after building, installing and hashing the release.
Temporary projects and user home are disposable. No receipts are fabricated.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--prefix', type=Path, required=True)
    args = parser.parse_args()
    prefix = args.prefix.resolve(strict=True)
    binary = prefix / 'bin/bwrk'
    if not binary.is_file() or binary.is_symlink():
        raise RuntimeError('absolute installed binary is missing or a symlink')
    manifest = json.loads((prefix / 'share/boreal/release.json').read_text())
    for asset in manifest['assets']:
        path = prefix / asset['path']
        if not path.resolve(strict=True).is_relative_to(prefix) or path.is_symlink():
            raise RuntimeError(f'unsafe installed asset: {path}')
        actual = 'sha256:' + hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != asset['sha256']:
            raise RuntimeError(f'installed bytes differ from release manifest: {path}')
    with tempfile.TemporaryDirectory(prefix='bwrk-two-project-') as directory:
        root = Path(directory)
        home = root / 'home'; home.mkdir()
        env = dict(os.environ, HOME=str(home), XDG_CONFIG_HOME=str(home/'config'),
                   XDG_CACHE_HOME=str(home/'cache'), XDG_DATA_HOME=str(home/'data'),
                   CI='1', NO_COLOR='1')
        def invoke(cwd: Path, *argv: str, success: bool = True) -> dict:
            result = subprocess.run([str(binary), *argv, '--json'], cwd=cwd, env=env,
                                    text=True, capture_output=True, timeout=60, check=False)
            if success != (result.returncode == 0):
                raise RuntimeError(f'{argv}: exit {result.returncode}\n{result.stdout}\n{result.stderr}')
            if not success:
                return {}
            payload = json.loads(result.stdout)
            if payload.get('outcome') not in ('changed', 'unchanged'):
                raise RuntimeError(f'non-success machine envelope: {payload}')
            return payload
        a, b, absent = (root/name for name in ('a', 'b', 'uninitialized'))
        for path in (a,b,absent): path.mkdir()
        invoke(a, 'init', 'smoke-a', '--yes', '--agents', 'codex')
        invoke(b, 'init', 'smoke-b', '--yes', '--agents', 'codex')
        for path, project in ((a,'smoke-a'),(b,'smoke-b')):
            result=invoke(path,'status')
            if result['data']['project_id'] != project:
                raise RuntimeError('project selection crossed workspaces')
            # Repeated reads exercise the same persisted identity, not a fabricated fixture.
            again=invoke(path,'status')
            if again['data']['project_id'] != project:
                raise RuntimeError('restart/readback changed project identity')
            invoke(path,'doctor')
            if not (path/'.boreal/project.json').is_file():
                raise RuntimeError('init did not persist local metadata')
        invoke(absent,'status',success=False)
        invoke(a,'status','--project','smoke-b',success=False)
        metadata=json.loads((b/'.boreal/project.json').read_text())
        # An explicit foreign DB is never a way around local workspace identity.
        foreign=metadata.get('database') or metadata.get('db')
        if not isinstance(foreign,str):
            foreign=str(b/'.boreal/boreal.db')
        elif not Path(foreign).is_absolute():
            foreign=str(b/foreign)
        invoke(a,'status','--db',foreign,'--project','smoke-b',success=False)
        if (absent/'.boreal').exists():
            raise RuntimeError('a read initialized an unrelated directory')
    print('PASS: installed asset hashes, explicit local init, repeated status/doctor, two-project and uninitialized rejection')

if __name__ == '__main__':
    main()
