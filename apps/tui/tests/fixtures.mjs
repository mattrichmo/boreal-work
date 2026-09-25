/** Deterministic demonstration data. Used only by tests and labelled previews. */
import { actionAvailability } from '../dist/client.js';
export function fixtureView() {
    const records = [
        ['tui-104', 'Refine the work queue and inspector', 'ready', 'task', 220],
        ['tui-101', 'Harden interactive terminal lifecycle', 'in_progress', 'task', 250],
        ['install-08', 'Ship the multi-screen installer', 'in_progress', 'task', 240],
        ['svc-042', 'Resolve operation readback contract', 'blocked', 'task', 235],
        ['proof-19', 'Verify receipt and closeout behavior', 'needs_verification', 'task', 210],
        ['cli-017', 'Validate command routing parity', 'ready', 'task', 200],
        ['release-02', 'Boreal Work 0.2 release readiness', 'in_progress', 'milestone', 255],
        ['sprint-06', 'Operator experience / hardening', 'in_progress', 'sprint', 230],
        ['ops-031', 'Review expired operator leases', 'expired_review', 'task', 190],
        ['docs-026', 'Document installation and recovery', 'ready', 'task', 150],
        ['svc-039', 'Close the pagination contract gap', 'blocked', 'task', 180],
        ['test-075', 'Exercise narrow terminal layouts', 'ready', 'task', 180],
        ['test-071', 'Verify UTF-8 split input handling', 'closed', 'task', 175],
        ['cli-015', 'Preserve machine-readable output', 'closed', 'task', 175],
        ['test-070', 'Guard against terminal injection', 'closed', 'task', 170],
        ['ops-032', 'Complete workstation smoke checks', 'queued', 'task', 100],
    ];
    const items = records.map(([id, title, status, kind, priority]) => ({
        work_id: id, project_id: 'boreal-work', title, status, display_status: status,
        kind, priority, parent_id: kind === 'task' ? 'sprint-06' : null,
        claimable: status === 'ready', reason_codes: status === 'blocked' ? ['dependency_open'] : [],
        next_action: status === 'ready' ? 'claim' : status === 'in_progress' ? 'attach_evidence' : null,
        description: id === 'tui-104'
            ? 'Build a focused operator workspace: scan work at a glance, inspect ownership and proof, and act without losing context. Preserve the authoritative service contracts.'
            : 'Acceptance is determined by the project service. This is demonstration data, not a live project snapshot.',
        dependencies: [{ work_id: 'test-071', status: 'closed', satisfied: true }],
        gates: { open: [{ gate_id: 'terminal-smoke', kind: 'receipt', required: true, state: 'open', reason: 'Attach verification output before closing.' }], satisfied: [{ gate_id: 'design-review', kind: 'review', required: true, state: 'satisfied' }] },
        activity: [{ kind: 'created', occurred_at: '2026-09-18T19:10:00Z', actor_id: 'operator', summary: 'Work added to the operator-experience sprint.' }, { kind: 'dependency_satisfied', occurred_at: '2026-09-18T20:42:00Z', actor_id: 'test-agent', summary: 'UTF-8 input handling verified.' }],
        attempt: status === 'in_progress' ? { attempt_id: 'attempt-' + id, fence: 4, phase: 'running', actor_id: 'operator', lease_deadline: '2026-09-18T23:00:00Z' } : null,
    }));
    // Explicit mock-server actions, not client-side fallback policy.
    for (const item of items) {
        const names = ['claim','accept_attempt','attach_evidence','finish_close','release'];
        const allowed = item.status === 'ready' ? ['claim'] : item.status === 'in_progress'
            ? ['attach_evidence','release'] : [];
        const descriptor = action => ({action,target:{project_id:item.project_id,work_id:item.work_id,entity_revision:1},
            expected_project_revision:248,expected_entity_revision:1,expected_proof_revision:1,attempt:item.attempt,
            required_roles:['agent'],required_inputs:[],confirmation:'Confirm this fixture action',read_only:false,recovery:false});
        item.actions = {allowed:allowed.map(descriptor),denied:names.filter(name=>!allowed.includes(name)).map(action=>({
            descriptor:descriptor(action),reason:{code:'fixture_denial',detail:'The mock server denies this action'},recovery:['inspect']}))};
    }
    const selected = items[0];
    return {
        mounted: true,
        route: { kind: 'work', project_id: 'boreal-work', work_id: selected.work_id },
        monitoring: { revision: 248, as_of: '2026-09-18T21:42:08Z', total: items.length, items, truncated: false,
            next_status_change_at: null, project_id: 'boreal-work', project_name: 'Boreal Work',
            offset: 0, limit: 100, has_more: false, next_offset: null,
            counts: { matched: items.length, ready: 4, in_progress: 4, blocked: 2, expired_review: 1, closed: 3, queued: 1 } },
        selected_work: selected,
        actions: [{ action: 'create_work', enabled: true, reason: null, requires_confirmation: true }, ...actionAvailability(selected, new Set(), { receipt_available: false })],
        notice: null, stale_revision: null, busy_actions: [], pending_operations: [], selected_receipt_available: false,
    };
}
export class FakeTerminal {
    is_tty = true;
    was_raw = false;
    size = { width: 132, height: 40 };
    writes = [];
    rawModes = [];
    listeners = new Map();
    dimensions() { return this.size; }
    write(value) { this.writes.push(value); }
    setRawMode(value) { this.rawModes.push(value); }
    resume() { }
    pause() { }
    on(name, listener) { this.listeners.set(name, listener); return () => this.listeners.delete(name); }
    onData(fn) { return this.on('data', fn); }
    onResize(fn) { return this.on('resize', fn); }
    onSignal(signal, fn) { return this.on(signal, fn); }
    onEnd(fn) { return this.on('end', fn); }
    send(value) { this.listeners.get('data')?.(value); }
    resize(width, height) { this.size = { width, height }; this.listeners.get('resize')?.(); }
    emit(event) { this.listeners.get(event)?.(); }
    text() { return this.writes.join('').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, ''); }
}
/** An in-memory test double. Production imports no test fixtures. */
export class FakeController {
    data = fixtureView();
    calls = [];
    refreshes = 0;
    view() { return this.data; }
    navigate(route) {
        this.data.route = route;
        this.data.selected_work = this.data.monitoring.items.find(item => item.work_id === route.work_id) ?? null;
        this.data.actions = [{ action: 'create_work', enabled: true, reason: null, requires_confirmation: true }, ...(this.data.selected_work ? actionAvailability(this.data.selected_work, new Set(), { receipt_available: this.data.selected_receipt_available }) : [])];
        return this.data;
    }
    async refresh() { this.refreshes++; return this.data; }
    async nextPage() { this.calls.push(['page']); return this.data; }
    async readback(id) { this.calls.push(['readback', id]); this.data.pending_operations = []; return {}; }
    async result(action, ...args) {
        this.calls.push([action, ...args]);
        this.data.monitoring.revision++;
        return { ok: true, envelope: { outcome: 'changed', revision: this.data.monitoring.revision } };
    }
    createProject(input) { return this.result('create_project', input); }
    createWork(input) { return this.result('create_work', input); }
    claim(id, execution) { return this.result('claim', id, execution); }
    acceptStart(id) { return this.result('accept_start', id); }
    addEvidence(id, receipt) { return this.result('evidence', id, receipt); }
    finish(id, summary) { return this.result('finish', id, summary); }
    release(id, reason) { return this.result('release', id, reason); }
}
export const tick = () => new Promise(resolve => setTimeout(resolve, 10));
