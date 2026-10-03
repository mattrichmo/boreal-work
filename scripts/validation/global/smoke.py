#!/usr/bin/env python3
"""Exercise the real global CLI, framed service and built TUI in isolated state."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path
import socket
import struct
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--tui', type=Path, default=Path('apps/global-tui/dist/entrypoint.js'))
    args = parser.parse_args()
    binary, tui = args.binary.resolve(), args.tui.resolve()
    with tempfile.TemporaryDirectory(prefix='bg-') as temporary:
        root = Path(temporary)
        env = dict(os.environ, BOREAL_GLOBAL_ROOT=str(root/'global'))
        def cli(*argv, cwd=root):
            result = subprocess.run([str(binary), *argv, '--json'], cwd=cwd, env=env, text=True, capture_output=True, timeout=15)
            if result.returncode:
                raise AssertionError(f'{argv}: {result.stderr} {result.stdout}')
            envelope = json.loads(result.stdout)
            assert envelope['error'] is None, envelope
            return envelope['data']
        cli('global', 'bootstrap')
        assert (root/'global/global.sqlite').is_file()
        life = cli('global', 'project', 'add', '--name', 'Life')
        life_id = life['id']
        elsewhere = root/'elsewhere'
        elsewhere.mkdir()
        assert any(p['id'] == life_id for p in cli('dashboard', 'global', cwd=elsewhere)['projects'])
        assert not (elsewhere/'.boreal').exists()
        endpoint = root/'service.sock'
        service = subprocess.Popen([str(binary),'global','service','run','--socket',str(endpoint)], env=env, cwd=root, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for _ in range(100):
                if endpoint.exists(): break
                if service.poll() is not None: raise AssertionError(service.communicate())
                time.sleep(.05)
            assert endpoint.exists(), 'service did not start'
            def request(command, payload=None, operation=None, expected='success'):
                operation = operation or 'smoke_'+uuid.uuid4().hex
                request = {'request_id':operation,'payload':{'api_version':'2','schema_version':'boreal.global.request.v1','operation_id':operation,'command':command,'payload':payload or {}}}
                body=json.dumps(request).encode()
                with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
                    client.settimeout(5)
                    client.connect(str(endpoint))
                    client.sendall(struct.pack('!I',len(body))+body)
                    def read(n):
                        data=b''
                        while len(data)<n:
                            chunk=client.recv(n-len(data))
                            if not chunk: raise AssertionError('incomplete service response')
                            data+=chunk
                        return data
                    size=struct.unpack('!I',read(4))[0]
                    outer=json.loads(read(size))
                assert outer['request_id']==operation, outer
                response=outer['payload']
                assert response['api_version']=='2' and response['operation_id']==operation, response
                if expected=='failure':
                    assert response['error'] is not None, response
                    return response
                assert response['error'] is None, response
                return response['data']
            custom=request('workflow status add',{'project_id':life_id,'status_id':'errands','label':'Out and about','category':'active','position':3})
            task=request('todo add',{'project_id':life_id,'title':'Book dentist','status_id':'errands','priority':2})
            request('todo complete',{'item_id':task['id']})
            request('todo reopen',{'item_id':task['id']})
            business=request('project add',{'name':'New business'})
            milestone=request('milestone add',{'project_id':business['id'],'title':'Launch'})
            parent=request('task add',{'project_id':business['id'],'parent_id':milestone['id'],'title':'Contact suppliers'})
            child=request('subtask add',{'project_id':business['id'],'parent_id':parent['id'],'title':'Request quotes'})
            request('relationship add',{'source_id':parent['id'],'target_id':child['id'],'kind':'blocks'})
            request('relationship add',{'source_id':child['id'],'target_id':parent['id'],'kind':'blocks'},expected='failure')
            request('note add',{'project_id':business['id'],'title':'Supplier notes','body':'Phone calls happen outside the computer.'})
            code=root/'code'
            code.mkdir()
            cli('init',str(code),'--project','smoke-code','--actor','global-smoke','--yes','--agents','codex')
            metadata=json.loads((code/'.boreal/project.json').read_text())
            database=str(code / metadata['database'])
            cli('session','start','--project','smoke-code','--actor','global-smoke','--harness','global-smoke','--session','global-smoke-session','--db',database,cwd=code)
            code_status=cli('status',cwd=code)
            cli('work','create','smoke-code','code-task','Write checkout flow','--kind','task','--actor','global-smoke','--session','global-smoke-session','--db',database,'--expected-revision',str(code_status['revision']),cwd=code)
            cli('global','project','link',business['id'],'--workspace',str(code))
            linked=request('snapshot')['linked_projects']
            assert any(row['project_id']=='smoke-code' and row['availability']=='available' and row['counts']['total']==1 for row in linked), linked
            # Relocation/outage cannot silently turn known work into zero work.
            moved=root/'code-moved'
            code.rename(moved)
            unavailable=request('snapshot')['linked_projects']
            assert any(row['project_id']=='smoke-code' and row['availability']!='available' for row in unavailable), unavailable
            moved.rename(code)
            snapshot=request('snapshot')
            stale=request('todo edit',{'item_id':task['id'],'title':'Changed','expected_revision':snapshot['revision']-1},expected='failure')
            assert stale['outcome']=='conflict', stale
            op='smoke_replay'
            first=request('todo add',{'project_id':life_id,'title':'Fix fence'},operation=op)
            second=request('todo add',{'project_id':life_id,'title':'Fix fence'},operation=op)
            assert first==second
            request('todo add',{'project_id':life_id,'title':'Wrong replay'},operation=op,expected='failure')
            rendered=subprocess.run(['node',str(tui),'--socket',str(endpoint)],env=env,cwd=root,text=True,capture_output=True,timeout=15)
            assert rendered.returncode==0, rendered.stderr
            assert 'Life' in rendered.stdout and 'Book dentist' in rendered.stdout and 'New business' in rendered.stdout, rendered.stdout
            backup=root/'snapshot.json'
            export_summary=request('export',{'path':str(backup)})
            assert export_summary['exported'] is True and backup.is_file(), export_summary
            exported=json.loads(backup.read_text())
            snapshot=request('snapshot')
            exported_items={item['id']:item for item in exported['items']}
            snapshot_items={item['id']:item for item in snapshot['items']}
            assert snapshot_items.keys() <= exported_items.keys(), (snapshot_items, exported_items)
            assert all(exported_items[item_id]['title']==item['title'] for item_id,item in snapshot_items.items())
            assert export_summary['counts']['items']==len(exported_items)
            with tempfile.TemporaryDirectory(prefix='bg-restore-') as restore:
                restored_env=dict(env,BOREAL_GLOBAL_ROOT=restore)
                result=subprocess.run([str(binary),'global','import','--input',str(backup),'--json'],env=restored_env,cwd=root,text=True,capture_output=True,timeout=15)
                assert result.returncode==0, result.stdout+result.stderr
                result=subprocess.run([str(binary),'dashboard','global','--json'],env=restored_env,cwd=root,text=True,capture_output=True,timeout=15)
                restored=json.loads(result.stdout)['data']
                assert restored['items']==snapshot['items'] and restored['statuses']==snapshot['statuses']
            print('PASS global CLI cwd independence, configurable workflow, hierarchy, notes, dependency cycle rejection, revision conflict, durable replay, real framed TUI and export/import')
        finally:
            service.terminate()
            try: service.communicate(timeout=5)
            except subprocess.TimeoutExpired:
                service.kill();service.communicate()

if __name__=='__main__': main()
