#!/usr/bin/env python3
"""Read-only helpers for the Boreal production plan. No project/API side effects."""
from __future__ import annotations
import argparse
import hashlib
import json
import re
import sys
from pathlib import Path
from typing import Any
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parent.parent
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'tools'))
from render_common import task_body

def load(path: Path) -> dict[str, Any]:
    with path.open(encoding='utf-8') as handle:
        value = json.load(handle)
    if not isinstance(value, dict):
        raise ValueError(f'Expected JSON object: {path}')
    return value

def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()

def safe_path(value: str) -> bool:
    p = Path(value)
    return bool(value) and not p.is_absolute() and '..' not in p.parts

def outside_fences(text: str) -> str:
    out, fence, size = [], None, 0
    for line in text.splitlines():
        match = re.match(r'^\s*(`{3,}|~{3,})', line)
        if match:
            token = match.group(1)
            if fence is None:
                fence, size = token[0], len(token)
            elif token[0] == fence and len(token) >= size:
                fence = None
            continue
        if fence is None:
            out.append(line)
    return '\n'.join(out)

def link_errors(root: Path) -> tuple[list[str], int]:
    errors, count = [], 0
    for p in root.rglob('*.md'):
        rel = p.relative_to(root).as_posix()
        # Frozen originals keep their original repository-relative links verbatim.
        if rel.startswith('reference/originals/'):
            continue
        text = outside_fences(p.read_text(encoding='utf-8'))
        anchors = set(re.findall(r'<a\s+id="([^"]+)"', text))
        for match in re.finditer(r'(?<!!)\[[^\]\n]+\]\(([^)\n]+)\)', text):
            target = match.group(1).strip().split(' "', 1)[0]
            if re.match(r'^(?:https?://|mailto:|sandbox:)', target):
                continue
            target = unquote(target)
            count += 1
            if target.startswith('#'):
                if rel == 'FULL_PLAN.md' and target[1:] not in anchors:
                    errors.append(f'{rel}: missing standalone anchor {target}')
                continue
            dest = (p.parent / target.split('#', 1)[0]).resolve()
            if not dest.exists():
                errors.append(f'{rel}: missing link {target}')
    return errors, count

def validate(plan: dict[str, Any], state: dict[str, Any], baseline_root: Path | None) -> dict[str, Any]:
    errors: list[str] = []
    tasks = plan['tasks']; by = {t['id']: t for t in tasks}
    sprints = {s['id']: s for s in plan['sprints']}
    refs = plan['references']
    if len(by) != len(tasks): errors.append('Duplicate task IDs.')
    if len(sprints) != len(plan['sprints']): errors.append('Duplicate sprint IDs.')
    if state.get('plan_id') != plan['plan_id'] or state.get('plan_version') != plan['version']:
        errors.append('State/plan identity or version mismatch.')
    expected_counts = {
        'sprints': len(sprints), 'tasks': len(tasks),
        'scoped_work_tasks': sum(t['number'] < 90 for t in tasks),
        'explicit_gate_tasks': sum(t['number'] >= 90 for t in tasks),
        'original_m02_obligations': len(plan['m02_coverage']),
        'source_references': len(refs), 'acceptance_rows': len(plan['acceptance']),
    }
    if plan['counts'] != expected_counts: errors.append('Plan counts do not match actual contents.')
    if set(state['tasks']) != set(by): errors.append('State task IDs differ from plan task IDs.')
    decisions = {d['id'] for d in plan['decisions']}
    externals = {x['id'] for x in plan['external_inputs']}
    for t in tasks:
        sid = t['sprint']
        if sid not in sprints:
            errors.append(f'{t["id"]}: unknown sprint {sid}'); continue
        expected = list(dict.fromkeys(t['depends_on'] + sprints[sid]['entry_gate_tasks']))
        if t['effective_dependencies'] != expected:
            errors.append(f'{t["id"]}: effective dependencies omit/add an undeclared entry gate.')
        for dep in expected:
            if dep not in by: errors.append(f'{t["id"]}: unknown dependency {dep}')
            if dep == t['id']: errors.append(f'{t["id"]}: self-dependency')
        for rid in t['common_read_refs'] + t['refs']:
            if rid not in refs: errors.append(f'{t["id"]}: missing source ref {rid}')
        for x in t.get('external_inputs', []):
            if x not in externals: errors.append(f'{t["id"]}: unknown external input {x}')
        for x in t.get('decision_ids', []):
            if x not in decisions: errors.append(f'{t["id"]}: unknown decision {x}')
        for path in t['writes'] + t['integration_writes'] + [t['file']]:
            if not safe_path(path): errors.append(f'{t["id"]}: unsafe path {path}')
        file = ROOT / t['file']
        if not file.is_file(): errors.append(f'{t["id"]}: missing task card')
        else:
            expected_text = task_body(plan, t, ROOT).rstrip() + '\n'
            if file.read_text(encoding='utf-8') != expected_text:
                errors.append(f'{t["id"]}: rendered card differs from plan.json')
        if not t['steps'] or not t['checks']: errors.append(f'{t["id"]}: missing instructions/acceptance')
    seen: set[str] = set(); active: list[str] = []
    def visit(tid: str) -> None:
        if tid in active:
            errors.append('Dependency cycle: ' + ' -> '.join(active + [tid])); return
        if tid in seen or tid not in by: return
        active.append(tid)
        for dep in by[tid]['effective_dependencies']: visit(dep)
        active.pop(); seen.add(tid)
    for tid in by: visit(tid)
    for sid, s in sprints.items():
        actual = {t['id'] for t in tasks if t['sprint'] == sid}
        if set(s['tasks']) != actual: errors.append(f'{sid}: sprint task list mismatch')
        leaves = {t['id'] for t in tasks if t['sprint'] == sid and t['number'] < 90 and t['kind'] != 'remediation'}
        if not leaves.issubset(set(by[s['review_gate']]['depends_on'])):
            errors.append(f'{sid}: review omits leaf prerequisite')
        for correction in (t for t in tasks if t['sprint'] == sid and t['kind'] == 'remediation'):
            if correction['id'] not in by[s['reconciliation_gate']]['depends_on']:
                errors.append(f'{sid}: reconciliation omits remediation {correction["id"]}')
            if s['reconciliation_gate'] in correction['effective_dependencies'] or s['exit_gate'] in correction['effective_dependencies']:
                errors.append(f'{correction["id"]}: remediation cannot depend on its own reconciliation/revalidation gate')
        if s['review_gate'] not in by[s['reconciliation_gate']]['depends_on']:
            errors.append(f'{sid}: missing review-to-reconciliation dependency')
        if s['reconciliation_gate'] not in by[s['exit_gate']]['depends_on']:
            errors.append(f'{sid}: missing reconciliation-to-revalidation dependency')
        if s['entry_gate_tasks'] != [d + '-T92' for d in s['depends_on']]:
            errors.append(f'{sid}: malformed sprint-entry gates')
    if len(plan['m02_coverage']) != 48: errors.append('Original M02 coverage must retain all 48 IDs.')
    for legacy, targets in plan['m02_coverage'].items():
        if not targets or any(t not in by for t in targets): errors.append(f'{legacy}: unresolved coverage')
    for d in plan['decisions']:
        if d['owner_task'] not in by: errors.append(f'{d["id"]}: unknown decision owner')
    for f in plan['findings']:
        if f['source_ref'] not in refs or any(t not in by for t in f['tasks']):
            errors.append(f'{f["id"]}: finding mapping unresolved')
    for a in plan['acceptance']:
        if a['implementation_task'] not in by or a['acceptance_task'] not in by:
            errors.append(f'{a["id"]}: acceptance ownership unresolved')
    allowed = {'not_started','assigned','in_progress','blocked','awaiting_integration','ready_for_review','accepted','rejected'}
    for tid, entry in state['tasks'].items():
        if entry.get('state') not in allowed: errors.append(f'{tid}: unknown execution state')
        if entry.get('state') != 'accepted' or tid not in by: continue
        missing = [d for d in by[tid]['effective_dependencies'] if state['tasks'].get(d, {}).get('state') != 'accepted']
        if missing: errors.append(f'{tid}: accepted before prerequisites {missing}')
        for field in ('agent','reviewer','input_source','accepted_source','handoff','evidence'):
            if not entry.get(field): errors.append(f'{tid}: accepted without {field}')
        if by[tid]['kind'] in ('review','revalidation'):
            producers = {state['tasks'][leaf['id']].get('agent') for leaf in tasks
                         if leaf['sprint'] == by[tid]['sprint'] and leaf['number'] < 90}
            if entry.get('agent') in producers or entry.get('reviewer') in producers:
                errors.append(f'{tid}: independent gate reviewer also implemented a reviewed leaf')
    checked_refs = 0
    index = load(ROOT / 'reference/BASELINE_SOURCE_INDEX.json')
    indexed = {r['path']: r for r in index['files']}
    for key, r in refs.items():
        if not (ROOT / r['context_file']).is_file(): errors.append(f'{key}: missing source excerpt')
        if r['path'] not in indexed or indexed[r['path']]['sha256'] != r['file_sha256']:
            errors.append(f'{key}: source hash not bound to baseline index')
        if baseline_root:
            p = baseline_root / r['path']
            if not p.is_file() or digest(p) != r['file_sha256']:
                errors.append(f'{key}: baseline source file mismatch')
            else:
                lines = p.read_text(encoding='utf-8').splitlines()
                if not 1 <= r['start'] <= r['end'] <= len(lines):
                    errors.append(f'{key}: invalid source line range')
                excerpt = '\n'.join(f'{i+1:>5} | {lines[i]}' for i in range(r['start']-1, r['end']))
                if excerpt not in (ROOT / r['context_file']).read_text(encoding='utf-8'):
                    errors.append(f'{key}: excerpt content mismatch')
                checked_refs += 1
    if baseline_root:
        for row in index['files']:
            p = baseline_root / row['path']
            if not p.is_file() or digest(p) != row['sha256']:
                errors.append(f'Baseline changed/missing: {row["path"]}')
    links, count = link_errors(ROOT); errors.extend(links)
    return {'result': 'passed' if not errors else 'failed', 'scope': 'planning structure only; no product tests or release acceptance',
            'counts': expected_counts, 'tasks_in_acyclic_graph': len(seen),
            'local_markdown_links_checked': count, 'baseline_excerpts_verified': checked_refs,
            'baseline_files_verified': len(index['files']) if baseline_root else 0,
            'initial_or_current_accepted_tasks': sum(x['state'] == 'accepted' for x in state['tasks'].values()),
            'errors': errors}

def intersect(a: str, b: str) -> bool:
    def normalize(p: str) -> str: return p.rstrip('/')
    x, y = normalize(a), normalize(b)
    return x == y or (a.endswith('/') and y.startswith(x + '/')) or (b.endswith('/') and x.startswith(y + '/'))

def packet(plan: dict[str, Any], tid: str) -> str:
    by = {t['id']: t for t in plan['tasks']}
    if tid not in by: raise ValueError(f'Unknown task: {tid}')
    t = by[tid]
    files = ['execution/AGENT_START.md', 'execution/PARALLEL_DISPATCH.md',
             f'sprints/{t["sprint"]}/SPRINT.md', t['file']]
    files += [plan['references'][r]['context_file'] for r in dict.fromkeys(t['common_read_refs'] + t['refs'])]
    header = f'# Task context packet: {tid}\n\nRead-only export, not dispatch authority. Supply current source, accepted prerequisite handoffs, contracts, write allocation and reviewer separately. Relative links below retain their original plan locations; the source path above each section identifies their base.\n'
    return header + '\n\n'.join(f'---\n\n## Original plan file: `{p}`\n\n' + (ROOT / p).read_text(encoding='utf-8') for p in files)

def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subs = parser.add_subparsers(dest='command', required=True)
    check = subs.add_parser('validate', help='Validate the graph, cards, links and live-state structure.')
    check.add_argument('--baseline-root', type=Path, help='Optional untouched extracted baseline for hash/range validation.')
    subs.add_parser('graph-ready', help='List dependency-ready unstarted/rejected tasks; not dispatch authorization.')
    con = subs.add_parser('conflicts', help='Conservative whole-file/directory overlap check.')
    con.add_argument('task_a'); con.add_argument('task_b')
    pac = subs.add_parser('packet', help='Print a selected task plus startup/sprint/source context to stdout.')
    pac.add_argument('task_id')
    subs.add_parser('verify-package', help='Verify immutable issued-file manifest; expected to change after coordinator edits.')
    args = parser.parse_args()
    try:
        plan = load(ROOT / 'plan.json'); state = load(ROOT / 'execution/STATE.json')
        by = {t['id']: t for t in plan['tasks']}
        if args.command == 'validate':
            result = validate(plan, state, args.baseline_root)
            print(json.dumps(result, indent=2)); return 0 if not result['errors'] else 1
        if args.command == 'graph-ready':
            ready = []
            for t in plan['tasks']:
                if state['tasks'][t['id']]['state'] not in ('not_started', 'rejected'): continue
                if all(state['tasks'][d]['state'] == 'accepted' for d in t['effective_dependencies']):
                    ready.append({'id':t['id'], 'title':t['title'], 'lane':t['lane'],
                                  'external_inputs_to_verify':t['external_inputs'], 'decision_context':t.get('decision_ids', [])})
            print(json.dumps({'warning':'Dependency readiness only. Coordinator must verify adoption/decisions, actual authority, source, external capability, reviewer and disjoint write allocation before dispatch.', 'tasks':ready}, indent=2)); return 0
        if args.command == 'conflicts':
            if args.task_a not in by or args.task_b not in by: raise ValueError('Unknown task ID.')
            a,b = by[args.task_a],by[args.task_b]
            pairs = lambda left,right: [{'a':x,'b':y} for x in left for y in right if intersect(x,y)]
            print(json.dumps({'task_a':a['id'], 'task_b':b['id'],
                'worker_conflicts':pairs(a['worker_writes'],b['worker_writes']),
                'shared_integration_overlaps':pairs(a['integration_writes'],b['integration_writes']),
                'worker_vs_shared_conflicts':pairs(a['worker_writes'],b['integration_writes'])+pairs(a['integration_writes'],b['worker_writes']),
                'note':'Conservative paths only. Semantic/schema conflicts and active coordinator tokens still require review.'},indent=2)); return 0
        if args.command == 'packet': print(packet(plan,args.task_id)); return 0
        if args.command == 'verify-package':
            manifest=load(ROOT/'PLAN_PACKAGE_MANIFEST.json');bad=[]
            for row in manifest['files']:
                p=ROOT/row['path']
                if not p.is_file() or p.stat().st_size!=row['bytes'] or digest(p)!=row['sha256']:bad.append(row['path'])
            print(json.dumps({'scope':'Issued plan package bytes, not source/product acceptance','files_checked':len(manifest['files']),'mismatches':bad},indent=2)); return 1 if bad else 0
        return 2
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f'Plan helper error: {exc}',file=sys.stderr); return 2
if __name__ == '__main__':
    raise SystemExit(main())
