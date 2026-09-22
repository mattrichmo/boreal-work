from pathlib import Path
import os,re,json

def rel(root,src,dst): return os.path.relpath(root/dst,(root/src).parent)
def task_link(root,src,t): return f"[{t['id']}]({rel(root,src,t['file'])})"
def task_body(plan,t,root):
    src=t['file'];by={x['id']:x for x in plan['tasks']};sp={x['id']:x for x in plan['sprints']}[t['sprint']]
    L=lambda dst,label:f"[{label}]({rel(root,src,dst)})"
    deps=', '.join(task_link(root,src,by[x]) for x in t['depends_on']) or 'None within the task graph.'
    entries=', '.join(task_link(root,src,by[x]) for x in sp['entry_gate_tasks']) or 'None; baseline work may begin after coordinator dispatch.'
    reads=[]
    for k in dict.fromkeys(t['common_read_refs']+t['refs']):
        r=plan['references'][k]
        reads.append(f"| {L(r['context_file'],k)} | `{r['path']}:L{r['start']}–L{r['end']}` | {r['why']} |")
    paths=[]
    for p in t['write_paths']:
        owned='coordinator-managed integration' if p['path'] in t['integration_writes'] else 'task worker; exclusive lock required'
        paths.append(f"| `{p['path']}` | {p['baseline']} {p['scope']} | {owned} |")
    locks='\n'.join('- `'+p+'`' for p in t['integration_writes']) or 'No additional shared integration file is anticipated. Any new need requires a reviewed path-change request.'
    steps='\n'.join(f"{i+1}. {v}" for i,v in enumerate(t['steps']))
    checks='\n'.join('- [ ] '+v for v in t['checks'])
    legacy=', '.join(t['m02_obligations']) or 'Final-form expansion / integration control; no original obligation is removed.'
    findings=', '.join(t['finding_ids']) or 'No single inherited finding; execute the stated contract and report new findings.'
    ac=', '.join(t['acceptance_rows']) or 'Contributes to its sprint exit gate and linked acceptance matrix; not a stand-alone release claim.'
    ext=', '.join(t['external_inputs']) or 'No extra named external input beyond prerequisites, a capable executor and required reviewer.'
    decisions=', '.join(t.get('decision_ids',[])) or 'Consume the accepted contract; do not reopen settled product policy within this task.'
    seeds=[];future=[];crates=[]
    for p in t['writes']:
        m=re.match(r'crates/([^/]+)/',p)
        if m and m.group(1) not in crates:crates.append(m.group(1))
        m=re.match(r'crates/([^/]+)/tests/([^/]+)\.rs$',p)
        if m:future.append(f"cargo test --locked -p boreal-{m.group(1)} --test {m.group(2)}")
    if crates:
        seeds.append('cargo fmt --all -- --check')
        seeds += [f'cargo test --locked -p boreal-{c}' for c in crates]
    if any(p.startswith('apps/tui/') for p in t['writes']):seeds += ['npm --prefix apps/tui run typecheck','npm --prefix apps/tui test']
    if t['kind']=='contract' or t['lane'] in ['CONTRACT','PROTOCOL','WORKFLOW']:seeds.append('python3 project/spec/validate_contracts.py')
    if any('installer' in p or p=='install.sh' for p in t['writes']):seeds += ['node scripts/build-installer.mjs --check','sh -n install.sh']
    seeds=list(dict.fromkeys(seeds))
    seedtxt='\n'.join(seeds) if seeds else '# Select the applicable existing commands from VALIDATION_PLAYBOOK.md.\n# This artifact/coordination task must still prove its named acceptance criteria.'
    futuretxt=('\n\n**Task-specific test targets (proposed; runnable only after this task creates/registers them):**\n\n```sh\n'+'\n'.join(future)+'\n```') if future else ''
    if any(p.startswith('scripts/validation/production/') and p.endswith('.py') for p in t['writes']):
        futuretxt+='\n\nAny new production harness named in this write set must implement the standard strict harness interface in VALIDATION_PLAYBOOK.md. It is a proposed output, not an existing executable or a result already obtained.'
    policy=('Read `project/spec/production/contract-manifest.json` and the accepted topic contracts it references. These are PF-S01 outputs and must exist at the dispatched revision; the plan does not pretend they exist in the baseline.' if 'required_contract_manifest' in t else 'Read the inherited decisions and original M02 obligations. This task produces/reconciles the baseline or proposed contract; it does not authorize unapproved product behavior changes.')
    return f"""# {t['id']} — {t['title']}

**Sprint:** {L('sprints/'+t['sprint']+'/SPRINT.md',t['sprint']+' — '+sp['title'])}  
**Type / priority:** `{t['kind']}` / `{t['priority']}`  
**Owner:** {t['owner_role']} (`{t['lane']}`); assign one named worker.  
**Initial state:** `not_started` / unaccepted. Live coordinator state is in {L('execution/STATE.json','execution/STATE.json')}.  
**Parent exit gate:** {task_link(root,src,by[sp['exit_gate']])}. No task card is a completion receipt.

## 1. Dependency and decision gate

**Explicit task prerequisites:** {deps}

**Sprint entry prerequisites, also mandatory:** {entries}

**Decision context:** {decisions}

**External inputs needed for acceptance:** {ext}

Read each direct prerequisite’s accepted handoff and exact integrated source/evidence identity before editing. Graph readiness is not permission: the coordinator must also provide the input revision, exclusive write lease, available executor and review owner. Do not start a successor from a worker’s unreviewed claim or a failed/expired assignment.

## 2. Outcome and why this task exists

{sp['goal']}

**Task outcome:** {t['title']}. The ordered work and named acceptance checks below define its boundary; do not replace them with a broader rewrite or a thin scaffold.

**Known context/risk:** {sp['risks']}

**Inherited M02 coverage:** {legacy}  
**Known findings to inspect/reproduce:** {findings}  
**Final acceptance rows:** {ac}

See {L('reference/M02_CROSSWALK.md','the complete original-obligation crosswalk')} and {L('reference/FINDINGS.md','the source/finding register')}. Inherited report claims are partial/unaccepted; existing implementations may be retained only after this task proves the accepted contract.

## 3. Load this context before work

First read {L('execution/AGENT_START.md','the agent startup instructions')}, {L('execution/PARALLEL_DISPATCH.md','parallel/write-boundary rules')}, the sprint file, this entire task card and prerequisite handoffs. {policy}

| Read reference | Exact baseline source location | Why the agent needs it |
| --- | --- | --- |
{chr(10).join(reads)}

Source excerpts carry file hashes and line numbers. Load the full enclosing implementation/types plus the associated tests at the **current dispatched revision**; line numbers are baseline navigation aids, not permission to ignore moved code or changed upstream contracts. {L('reference/CONTRACT_INDEX.md','The contract index')} names the planned authoritative files to load after PF-S01.

## 4. Exclusive changes and off-limits boundaries

| Planned changed/output path | Baseline availability | Edit owner |
| --- | --- | --- |
{chr(10).join(paths)}

**Shared integration changes requiring coordinator/steward ownership:**

{locks}

The worker may implement only its non-shared listed files and its evidence directory. Submit precise integration patches for shared files; one steward applies them serially on the combined tree. An unregistered module or unintegrated patch is not accepted. A directory scope excludes protected shared manifests unless the coordinator explicitly grants that steward token. All unlisted production paths, other worktrees, live databases, legacy originals, secrets and prior evidence are read-only. See {L('execution/SHARED_FILES.md','shared-file locks')} for conflict rules.

**Evidence directory:** `{t['evidence_root']}`. Replace `<N>` with a new attempt number; never overwrite an earlier failed run.

## 5. Ordered implementation / investigation instructions

{steps}

## 6. Required acceptance checklist

{checks}
- [ ] The effective prerequisites, owner decisions, schema/protocol impacts and any baseline discrepancy are explicitly accounted for.
- [ ] Focused checks plus the required integration layer ran on the actual combined source/artifact identity; missing tools, skipped native checks and fixture-only success are not accepted results.
- [ ] All changes remain within the granted boundary; shared-file patches are integrated, and failed receipts/reviews/attempts/test results are preserved.
- [ ] The complete handoff and evidence exist and the coordinator records acceptance. Compilation alone does not close this task or its sprint.

## 7. Validation instructions and failure cases

Use {L('validation/VALIDATION_PLAYBOOK.md','the validation playbook')} and the {L('validation/ACCEPTANCE_MATRIX.md','real-service acceptance matrix')}. Before implementation, capture the current failing/unsupported behavior; after changes run the positive cases, the explicit rejection cases above and the relevant stale-revision, wrong-project, wrong-principal, deadline and retry/readback boundaries. For pure-domain or documentation work, test the applicable deterministic/contract cases and record why process races do not apply; do not invent a runtime pass.

**Existing seed commands** (from the supplied repository, not a claim they currently pass):

```sh
{seedtxt}
```
{futuretxt}

Unit/property inputs and owned corrupt-record setup are permitted when labeled accurately. Successful **service/lifecycle/release** evidence must use the actual built service, genuine declared verifier execution, valid attributable receipts and real required reviewer identities. Never hand-seed a passing receipt, normalize an incompatible DTO in the harness, or reuse a fake controller as acceptance. Record command argv/cwd, exit code, tool/runtime versions, source/binary hash, raw response/readback and artifact digests. Do not fabricate a result when a required capability is unavailable.

## 8. Handoff, review and recovery

Use {L('templates/TASK_HANDOFF.md','the task handoff template')} and {L('templates/EVIDENCE_RECORD.md','the evidence record template')}. Include exact changed files, base/final source, decisions/invariants, before/after behavior, all executed checks and failures, schema/protocol/migration/security impact, operation/receipt/review IDs where applicable, residual risks and the next safe task. Non-code work must provide equivalent verifiable artifacts rather than a generic “done.”

On a new blocker, stop the affected mutation/scope, retain work and evidence, and file {L('templates/FINDING.md','a finding')} plus {L('templates/CHANGE_REQUEST.md','a bounded change request')}. On unknown command outcome, use original operation readback; on a worker timeout, the coordinator confirms process/worktree stop before reassignment. No destructive reset, live-lock breaking or rewriting historical evidence is a recovery shortcut.

The independent review/reconciliation/revalidation chain is {task_link(root,src,by[sp['review_gate']])} → {task_link(root,src,by[sp['reconciliation_gate']])} → {task_link(root,src,by[sp['exit_gate']])}. This card remains an unaccepted plan until those required records exist.
"""
