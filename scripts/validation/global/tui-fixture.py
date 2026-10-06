#!/usr/bin/env python3
"""Seed disposable global state through the real CLI/service for TUI walkthroughs."""
import argparse,json,os,socket,struct,subprocess,time,uuid
from pathlib import Path

ROOT=Path(__file__).resolve().parents[3]

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',required=True,type=Path)
    parser.add_argument('--root',required=True,type=Path)
    args=parser.parse_args();binary=args.binary.resolve();root=args.root.expanduser().resolve()
    if root.exists() or root == ROOT or ROOT in root.parents:
        raise SystemExit('--root must be a new disposable directory outside the checkout')
    root.mkdir(mode=0o700);env=dict(os.environ,BOREAL_GLOBAL_ROOT=str(root/'global'))
    def cli(*argv,cwd=root):
        result=subprocess.run([str(binary),*argv,'--json'],cwd=cwd,env=env,capture_output=True,text=True,timeout=30)
        if result.returncode:raise RuntimeError(result.stdout+result.stderr)
        return json.loads(result.stdout)
    cli('global','bootstrap');endpoint=root/'s'
    service=subprocess.Popen([str(binary),'global','service','run','--socket',str(endpoint)],cwd=root,env=env,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
    try:
        for _ in range(100):
            if endpoint.exists():break
            if service.poll() is not None:raise RuntimeError(service.communicate()[1])
            time.sleep(.05)
        def request(command,payload=None):
            operation='fixture_'+uuid.uuid4().hex
            body=json.dumps({'request_id':operation,'payload':{'api_version':'2','schema_version':'boreal.global.request.v1','operation_id':operation,'command':command,'payload':payload or {}}}).encode()
            with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as client:
                client.settimeout(15);client.connect(str(endpoint));client.sendall(struct.pack('!I',len(body))+body)
                def read(n):
                    value=b''
                    while len(value)<n:
                        chunk=client.recv(n-len(value))
                        if not chunk:raise RuntimeError('short response')
                        value+=chunk
                    return value
                response=json.loads(read(struct.unpack('!I',read(4))[0]))['payload']
                if response['error']:raise RuntimeError(response['error'])
                return response['data']
        life=request('project add',{'name':'Life · Café 家','description':'Home, family, errands and personal plans.','labels':['personal'],'priority':1})
        business=request('project add',{'name':'Business launch','description':'Offline preparation alongside two linked code projects.','labels':['business'],'priority':3})
        for name in ['Travel','Garden','Learning','House repairs','Community','Reading','Fitness','Budget','Music','Family']:
            request('project add',{'name':name})
        for p in [life,business]:
            for sid,label,category,pos in [('inbox','Inbox','open',-1),('planned','Planned','open',1),('review','Review','active',6),('supplier','Supplier approval','waiting',7)]:
                request('workflow status add',{'project_id':p['id'],'status_id':sid,'label':label,'category':category,'position':pos})
        statuses=['todo','todo','todo','doing','waiting','blocked','review','supplier','planned','inbox']
        items=[]
        for i in range(60):
            p=life if i<40 else business
            item=request('todo add',{'project_id':p['id'],'title':f'QA-{i:02d} '+['Book dentist','Buy groceries','Call supplier','Review lease','Prepare taxes'][i%5],
                'description':('Details that wrap across several terminal lines. '*4)+f'Unique item {i}.',
                'status_id':statuses[i%len(statuses)] if i>=30 else 'todo','priority':i%4,'labels':['offline' if i%2 else 'computer'],
                'due_at':'2001-01-01T09:00:00Z' if i%11==0 else None,'position':i})
            items.append(item)
        milestone=request('milestone add',{'project_id':business['id'],'title':'Launch milestone'})
        task=request('task add',{'project_id':business['id'],'title':'Contact suppliers','parent_id':milestone['id']})
        child=request('subtask add',{'project_id':business['id'],'title':'Get three quotes','parent_id':task['id']})
        request('relationship add',{'source_id':child['id'],'target_id':items[40]['id'],'kind':'depends_on'})
        request('todo add',{'title':'Personal inbox capture','description':'No folder and no management project required.'})
        request('todo complete',{'item_id':items[2]['id']});request('todo reopen',{'item_id':items[2]['id']});request('todo archive',{'item_id':items[5]['id']})
        for p in [life,business]:
            request('note add',{'project_id':p['id'],'title':'Notes · Café 家','body':'First line: everyday plans.\n\nSecond paragraph: keep line breaks.\n'+ '\n'.join(f'Line {i}: long note reader and editor checks.' for i in range(30))})
        for i in range(2):
            code=root/f'code-{i}';code.mkdir();project=f'audit-code-{i}';actor=f'audit-actor-{i}';session=f'audit-session-{i}'
            cli('init',str(code),'--project',project,'--actor',actor,'--yes','--agents','codex')
            cli('session','start','--project',project,'--actor',actor,'--harness','global-audit','--session',session,cwd=code)
            revision=cli('status',cwd=code)['revision']
            cli('work','create',project,f'code-task-{i}',f'Build component {i}','--kind','task','--actor',actor,'--session',session,'--expected-revision',str(revision),cwd=code)
            cli('global','project','link',business['id'],'--workspace',str(code))
        state=request('snapshot');(root/'fixture.json').write_text(json.dumps(state,indent=2))
        assert len(state['items'])>=60 and len(state['projects'])>=12
        assert len(state.get('linked_projects',[]))==2
        print(json.dumps({'root':str(root),'global_root':env['BOREAL_GLOBAL_ROOT'],'life':life['id'],'business':business['id'],'items':len(state['items']),'projects':len(state['projects'])}))
    finally:
        service.terminate()
        try:service.communicate(timeout=5)
        except subprocess.TimeoutExpired:service.kill();service.communicate()
if __name__=='__main__':main()
