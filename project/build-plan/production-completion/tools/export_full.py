#!/usr/bin/env python3
"""Compile the plan's Markdown into one self-contained reference. Plan files only."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import unquote

ROOT=Path(__file__).resolve().parent.parent

def anchor(path: str) -> str:
    return 'file-' + re.sub(r'[^a-z0-9]+', '-', path.lower()).strip('-')

def ordered_files(plan: dict) -> list[str]:
    intro=['README.md','MASTER_PLAN.md','RELEASE_SCOPE.md','FINAL_ARCHITECTURE.md',
           'DEPENDENCY_GRAPH.md','WAVE_GUIDE.md','TASK_INDEX.md',
           'execution/COORDINATOR_RUNBOOK.md','execution/AGENT_START.md',
           'execution/PARALLEL_DISPATCH.md','execution/SHARED_FILES.md',
           'execution/STATE_MODEL.md','execution/EXTERNAL_INPUTS.md',
           'reference/DECISION_REGISTER.md','reference/CONTRACT_INDEX.md',
           'reference/FINDINGS.md','reference/M02_CROSSWALK.md',
           'validation/VALIDATION_PLAYBOOK.md','validation/EVIDENCE_POLICY.md',
           'validation/ACCEPTANCE_MATRIX.md']
    by={t['id']:t for t in plan['tasks']}
    tasks=[]
    for s in plan['sprints']:
        tasks.append(f'sprints/{s["id"]}/SPRINT.md')
        tasks += [by[tid]['file'] for tid in s['tasks']]
    final=['BACKLOG_AND_NON_GOALS.md','FINAL_FORM_ACCEPTANCE_CHECKLIST.md']
    templates=[p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'templates').glob('*.md'))]
    refs=['reference/SOURCE_CATALOG.md'] + [r['context_file'] for r in plan['references'].values()]
    originals=[p.relative_to(ROOT).as_posix() for p in sorted((ROOT/'reference/originals').glob('*.md'))]
    qa=['PLAN_VALIDATION.md']
    order=intro+tasks+final+templates+refs+originals+qa
    extra=sorted(p.relative_to(ROOT).as_posix() for p in ROOT.rglob('*.md')
                 if p.relative_to(ROOT).as_posix() not in order and p.name!='FULL_PLAN.md')
    return list(dict.fromkeys(order+extra))

def transform(text: str, source: str, paths: set[str]) -> str:
    out=[];fence=None;size=0
    def replace(m: re.Match) -> str:
        label,target=m.group(1),m.group(2).strip()
        if re.match(r'^(?:https?://|mailto:|sandbox:)',target):return m.group(0)
        if target.startswith('#'):return m.group(0)
        target=unquote(target.split(' "',1)[0]);base=target.split('#',1)[0]
        resolved=(ROOT/source).parent.joinpath(base).resolve()
        try:rel=resolved.relative_to(ROOT).as_posix()
        except ValueError:return f'{label} (`{target}`)'
        if rel=='FULL_PLAN.md':return '[the consolidated document](#full-plan-start)'
        if rel in paths:return f'[{label}](#{anchor(rel)})'
        # Non-Markdown helpers/manifests remain explicit pack paths, not broken standalone links.
        return f'{label} (`{rel}` in the folder pack)'
    for line in text.splitlines():
        m=re.match(r'^\s*(`{3,}|~{3,})',line)
        if m:
            token=m.group(1)
            if fence is None:fence,size=token[0],len(token)
            elif token[0]==fence and len(token)>=size:fence=None
            out.append(line);continue
        out.append(re.sub(r'(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)',replace,line) if fence is None else line)
    return '\n'.join(out)

def compile_full() -> str:
    plan=json.loads((ROOT/'plan.json').read_text(encoding='utf-8'))
    files=ordered_files(plan);paths=set(files)
    header=f'''<a id="full-plan-start"></a>
# Boreal Work — FULL PRODUCTION COMPLETION PLAN

**Issue:** 2026-09-21 · **State:** proposed, not adopted · **Execution acceptance:** 0 of {plan['counts']['tasks']} tasks.

This standalone compendium contains all 22 sprints, all 264 task cards, governance, validation, traceability, templates and 113 verbatim source-context excerpts. It is a reference archive, **not one giant subagent prompt**. Dispatch a selected task packet with its required context and accepted upstream handoffs. No application files were changed and no product validation was performed to create this plan.

**Baseline archive:** `{plan['baseline']['archive']}`  
**SHA-256:** `{plan['baseline']['sha256']}`

The folder pack additionally supplies the machine-readable plan/state, read-only helpers and issue-file hashes. Links to included Markdown point to anchors within this document; executable/helper/data paths identify files in that pack. Historical originals are preserved as quoted text, not adopted wholesale over unresolved decisions.

## Navigation

- [Start and file guide](#{anchor('README.md')})
- [Master sprint plan](#{anchor('MASTER_PLAN.md')})
- [Proposed final architecture and transition/status tables](#{anchor('FINAL_ARCHITECTURE.md')})
- [Every task index](#{anchor('TASK_INDEX.md')})
- [Parallel-agent rules](#{anchor('execution/PARALLEL_DISPATCH.md')})
- [Required owner decisions](#{anchor('reference/DECISION_REGISTER.md')})
- [All original M02 mappings](#{anchor('reference/M02_CROSSWALK.md')})
- [Real-service acceptance matrix](#{anchor('validation/ACCEPTANCE_MATRIX.md')})
- [Final form acceptance checklist](#{anchor('FINAL_FORM_ACCEPTANCE_CHECKLIST.md')})

## Sprint navigation

'''
    header+='\n'.join(f'- [{s["id"]} — {s["title"]}](#{anchor("sprints/"+s["id"]+"/SPRINT.md")})' for s in plan['sprints'])
    pieces=[header]
    for path in files:
        text=(ROOT/path).read_text(encoding='utf-8')
        prefix=f'\n\n---\n\n<a id="{anchor(path)}"></a>\n\n**Plan file:** `{path}`\n\n'
        if path.startswith('reference/originals/'):
            runs=[len(x) for x in re.findall(r'`+',text)]
            fence='`'*max(4,max(runs or [0])+1)
            text=f'# Frozen original — {Path(path).name}\n\nVerbatim historical input. SHA-256 `{hashlib.sha256(text.encode()).hexdigest()}`. This text may contain older source paths, scopes and unaccepted claims; the original file in the pack preserves its bytes.\n\n{fence}text\n{text}\n{fence}'
        else:text=transform(text,path,paths)
        pieces.append(prefix+text.rstrip())
    return '\n'.join(pieces)+'\n'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write',action='store_true',help='Write FULL_PLAN.md inside this plan folder.')
    args=parser.parse_args()
    text=compile_full()
    if args.write:
        dest=ROOT/'FULL_PLAN.md';dest.write_text(text,encoding='utf-8')
        print(f'Wrote {dest.name}: {dest.stat().st_size:,} bytes')
    else:print(text,end='')
if __name__=='__main__':main()
