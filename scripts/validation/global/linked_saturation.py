#!/usr/bin/env python3
"""Qualify Global availability while linked refresh workers and queue saturate."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import socket
import sqlite3
import struct
import subprocess
import tempfile
import time
import uuid


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument(
        '--associations', type=int, default=80,
        help='linked associations to submit (must exceed the 8-worker + 64-job bound)',
    )
    args = parser.parse_args()
    if args.associations <= 72:
        parser.error('--associations must exceed the 8-worker + 64-job bound')

    binary = args.binary.resolve()
    with tempfile.TemporaryDirectory(prefix='boreal-linked-saturation-') as temporary:
        root = Path(temporary)
        env = dict(os.environ, BOREAL_GLOBAL_ROOT=str(root / 'global'))

        def cli(*argv: str, cwd: Path = root) -> dict:
            result = subprocess.run(
                [str(binary), *argv, '--json'], cwd=cwd, env=env,
                text=True, capture_output=True, timeout=30,
            )
            if result.returncode:
                raise AssertionError(f'{argv}: {result.stderr} {result.stdout}')
            envelope = json.loads(result.stdout)
            if envelope.get('error') is not None:
                raise AssertionError(f'{argv}: {envelope}')
            return envelope['data']

        cli('global', 'bootstrap')
        workspace = root / 'workspace'
        workspace.mkdir()
        cli(
            'init', str(workspace), '--project', 'saturation-project', '--actor',
            'saturation-agent', '--yes', '--agents', 'codex',
        )
        metadata = json.loads((workspace / '.boreal' / 'project.json').read_text())
        database = workspace / metadata['database']
        cli(
            'session', 'start', '--project', 'saturation-project', '--actor',
            'saturation-agent', '--harness', 'linked-saturation', '--session',
            'linked-saturation-session', '--db', str(database), cwd=workspace,
        )
        status = cli('status', cwd=workspace)
        cli(
            'work', 'create', 'saturation-project', 'saturation-task',
            'Keep one last-good linked sample', '--kind', 'task', '--actor',
            'saturation-agent', '--session', 'linked-saturation-session', '--db',
            str(database), '--expected-revision', str(status['revision']), cwd=workspace,
        )

        project = cli('global', 'project', 'add', '--name', 'Saturation 000')
        cli('global', 'project', 'link', project['id'], '--workspace', str(workspace))
        management_projects = [project['id']]

        endpoint = root / 'global.sock'
        service = subprocess.Popen(
            [str(binary), 'global', 'service', 'run', '--socket', str(endpoint)],
            cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE,
        )
        lock = None
        try:
            for _ in range(200):
                if endpoint.exists():
                    break
                if service.poll() is not None:
                    raise AssertionError(service.communicate()[1].decode(errors='replace'))
                time.sleep(0.025)
            if not endpoint.exists():
                raise AssertionError('Global service did not start')

            def request(command: str, payload: dict | None = None) -> tuple[dict, float]:
                operation = 'saturation_' + uuid.uuid4().hex
                body = json.dumps({
                    'request_id': operation,
                    'payload': {
                        'api_version': '2',
                        'schema_version': 'boreal.global.request.v1',
                        'operation_id': operation,
                        'command': command,
                        'payload': payload or {},
                    },
                }).encode()
                started = time.perf_counter()
                with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                    client.settimeout(5)
                    client.connect(str(endpoint))
                    client.sendall(struct.pack('!I', len(body)) + body)

                    def read(size: int) -> bytes:
                        data = bytearray()
                        while len(data) < size:
                            chunk = client.recv(size - len(data))
                            if not chunk:
                                raise AssertionError('Global service returned a short frame')
                            data.extend(chunk)
                        return bytes(data)

                    response_size = struct.unpack('!I', read(4))[0]
                    outer = json.loads(read(response_size))
                elapsed_ms = (time.perf_counter() - started) * 1000
                if outer['request_id'] != operation:
                    raise AssertionError(f'response correlation mismatch: {outer}')
                response = outer['payload']
                if response['operation_id'] != operation:
                    raise AssertionError(f'operation correlation mismatch: {response}')
                if response['error'] is not None:
                    raise AssertionError(f'{command}: {response}')
                return response['data'], elapsed_ms

            target_id = management_projects[0]
            target = None
            for _ in range(20):
                initial, _ = request('snapshot')
                target = next(
                    row for row in initial['linked_projects']
                    if row['management_project_id'] == target_id
                )
                if target['availability'] in {'available', 'stale'} and target.get('counts', {}).get('total') == 1:
                    break
                time.sleep(0.05)
            assert target is not None
            if target['availability'] not in {'available', 'stale'} or target['counts']['total'] != 1:
                raise AssertionError(f'could not establish the last-good sample: {target}')

            for index in range(1, args.associations):
                project = cli('global', 'project', 'add', '--name', f'Saturation {index:03d}')
                cli('global', 'project', 'link', project['id'], '--workspace', str(workspace))
                management_projects.append(project['id'])

            connection = sqlite3.connect(database, timeout=1, isolation_level=None)
            mode = connection.execute('PRAGMA journal_mode=DELETE').fetchone()[0].lower()
            if mode != 'delete':
                raise AssertionError(f'could not prepare disposable workspace lock: {mode}')
            connection.execute('BEGIN EXCLUSIVE')
            lock = connection
            try:
                probe = sqlite3.connect(database, timeout=0.05)
                try:
                    probe.execute('SELECT name FROM sqlite_master LIMIT 1').fetchone()
                except sqlite3.OperationalError as error:
                    if 'locked' not in str(error).lower():
                        raise
                else:
                    raise AssertionError('exclusive test lock did not block a linked read')
                finally:
                    probe.close()

                saturated, snapshot_latency_ms = request('snapshot')
                rows = saturated['linked_projects']
                if len(rows) != args.associations:
                    raise AssertionError(f'linked enumeration was incomplete: {len(rows)} rows')
                target = next(row for row in rows if row['management_project_id'] == target_id)
                if target['availability'] != 'stale' or target['counts']['total'] != 1:
                    raise AssertionError(f'last-good counts were lost during saturation: {target}')
                queue_rejections = [
                    row for row in rows
                    if row.get('error') == 'linked refresh worker queue is full'
                ]
                if len(queue_rejections) < args.associations - 72:
                    raise AssertionError(
                        f'queue saturation was not observed: {len(queue_rejections)} rejections'
                    )

                _, todo_latency_ms = request('todo add', {
                    'title': 'Global todo during linked saturation',
                })
                _, note_latency_ms = request('note add', {
                    'title': 'Global note during linked saturation',
                    'body': 'Linked worker and queue pressure must stay isolated.',
                })
                if max(todo_latency_ms, note_latency_ms) >= 1000:
                    raise AssertionError(
                        f'Global writes were delayed under linked saturation: '
                        f'todo={todo_latency_ms:.1f} ms note={note_latency_ms:.1f} ms'
                    )

                # Let all accepted jobs hit the deliberately held lock. Their
                # failures must keep cached counts and expose measured wait/run.
                time.sleep(2.5)
                settled, _ = request('snapshot')
                rows = settled['linked_projects']
                target = next(row for row in rows if row['management_project_id'] == target_id)
                if target['availability'] != 'stale' or target['counts']['total'] != 1:
                    raise AssertionError(f'late failure replaced the last-good sample: {target}')
                measured_waits = [row['pool_wait_ms'] for row in rows if isinstance(row.get('pool_wait_ms'), int)]
                measured_refreshes = [
                    row['refresh_duration_ms'] for row in rows
                    if isinstance(row.get('refresh_duration_ms'), int)
                ]
                if not measured_waits or max(measured_waits) <= 0:
                    raise AssertionError('pool wait was not exposed in linked sample metrics')
                if not measured_refreshes:
                    raise AssertionError('refresh duration was not exposed in linked sample metrics')
                if max(measured_refreshes) <= 0:
                    raise AssertionError(f'linked refresh durations were not measurable: {measured_refreshes}')
            finally:
                lock.rollback()
                lock.close()
                lock = None

            print(json.dumps({
                'status': 'PASS',
                'associations': args.associations,
                'queue_rejections': len(queue_rejections),
                'snapshot_latency_ms': round(snapshot_latency_ms, 2),
                'global_todo_latency_ms': round(todo_latency_ms, 2),
                'global_note_latency_ms': round(note_latency_ms, 2),
                'max_pool_wait_ms': max(measured_waits),
                'max_refresh_duration_ms': max(measured_refreshes),
                'last_good_total': target['counts']['total'],
                'last_good_availability': target['availability'],
            }, sort_keys=True))
        finally:
            if lock is not None:
                lock.rollback()
                lock.close()
            service.terminate()
            try:
                service.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                service.kill()
                service.communicate()


if __name__ == '__main__':
    main()
