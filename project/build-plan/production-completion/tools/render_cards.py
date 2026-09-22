#!/usr/bin/env python3
"""Explicitly rerender task Markdown from coordinator-edited plan.json.
Only plan task cards are written. Does not modify application/source code.
Update counts, sprint/index/graph/register documents and regenerate FULL_PLAN separately
when changing the graph. Run plan.py validate before dispatching updated tasks.
"""
import argparse
import json
from pathlib import Path
import sys
sys.dont_write_bytecode = True
from render_common import task_body

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--write',action='store_true',help='Required to write updated task cards.')
    args=parser.parse_args()
    if not args.write:
        parser.error('No files changed. Pass --write to explicitly render coordinator plan changes.')
    root=Path(__file__).resolve().parent.parent
    plan=json.loads((root/'plan.json').read_text(encoding='utf-8'))
    for t in plan['tasks']:
        relative=Path(t['file'])
        if relative.is_absolute() or '..' in relative.parts:raise ValueError('Unsafe task path')
        dest=root/relative
        dest.parent.mkdir(parents=True,exist_ok=True)
        dest.write_text(task_body(plan,t,root).rstrip()+'\n',encoding='utf-8')
    print(f'Rendered {len(plan["tasks"])} task cards only. Update derived indexes/full export and run validation.')
if __name__=='__main__':main()
