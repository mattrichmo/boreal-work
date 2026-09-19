import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellWidth, clip, fit, wrap, eraseLast, inputTail, safeText } from '../dist/ui/cells.js';
import { Screen, FrameWriter } from '../dist/ui/screen.js';
import { StreamingKeyDecoder, decodeKeys } from '../dist/ui/keys.js';
import { initialState, reconcileSelection, visibleItems, paletteCommands, actionForm } from '../dist/ui/model.js';
import { renderDashboard, dashboardLayout, detailLines } from '../dist/ui/dashboard.js';
import { runFullScreen } from '../dist/full-screen.js';
import { parseTerminalArgs } from '../dist/entrypoint.js';
import { fixtureView, FakeController, FakeTerminal, tick } from './fixtures.mjs';
const require = createRequire(import.meta.url);
const { createWizardState, applyWizardKey, renderWizard, wizardResult, validateWizard, choices, wordmark } = require('../installer/wizard.cjs');
function bounded(screen) {
    assert.equal(screen.cells.length, screen.height);
    for (const row of screen.plain()) {
        assert.equal(cellWidth(row), screen.width, `row exceeds its terminal cell budget: ${row}`);
        assert.doesNotMatch(row, /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u);
    }
}
function project(overrides = {}) {
    return createWizardState('project', { project_id: 'boreal-work', project_root: '/workspace/boreal', database: '/workspace/boreal/.boreal/boreal.sqlite', memory_root: '/workspace/boreal/memory', memory_layout: 'child', agents: ['codex'], ...overrides });
}
// Terminal cell budgets and trust boundaries.
test('grapheme-aware widths, truncation, deletion and input tails', () => {
    assert.equal(cellWidth('e\u0301'), 1);
    assert.equal(cellWidth('世界'), 4);
    assert.equal(cellWidth('👩‍💻'), 2);
    assert.equal(cellWidth('🇨🇦'), 2);
    assert.equal(eraseLast('go👩‍💻'), 'go');
    assert.equal(eraseLast('e\u0301'), '');
    assert.equal(inputTail('ab世界', 3), '界');
    assert.equal(cellWidth(fit('世界test', 5)), 5);
    assert.ok(wrap('世界 / hello e\u0301', 3).every(line => cellWidth(line) <= 3));
    for (let n = 0; n < 15; n++)
        assert.ok(cellWidth(clip('Some 世界 👩‍💻 text', n)) <= n);
});
test('service strings cannot introduce ANSI, OSC, controls or bidi overrides', () => {
    assert.doesNotMatch(safeText('\x1b]52;c;bad\x07\r\n\u202e'), /[\x00-\x1f\u202e]/u);
    const view = fixtureView();
    view.monitoring.items[0].title = '\x1b[2J\x1b]0;title\x07世界';
    bounded(renderDashboard(view, initialState(view), 132, 40));
});
test('overwriting either half of a wide cell leaves a coherent grid', () => {
    const screen = new Screen(8, 2);
    screen.text(0, 0, '界界');
    screen.text(1, 0, 'A');
    bounded(screen);
    assert.equal(screen.plain()[0], ' A界    ');
    screen.text(2, 0, 'b');
    bounded(screen);
    assert.equal(screen.plain()[0], ' Ab     ');
});
test('row-diff renderer does not repaint unchanged frames or clear on navigation', () => {
    const chunks = [], writer = new FrameWriter(s => chunks.push(s)), screen = new Screen(12, 3);
    screen.text(1, 1, 'Before');
    writer.paint(screen);
    const first = chunks.length;
    writer.paint(screen);
    assert.equal(chunks.length, first);
    screen.text(1, 1, 'After ');
    writer.paint(screen);
    assert.doesNotMatch(chunks.at(-1), /\x1b\[2J/);
    assert.match(chunks.at(-1), /\x1b\[2;1H/);
    writer.paint(new Screen(14, 3));
    assert.match(chunks.at(-1), /\x1b\[2J/);
});
test('monochrome emits no colour SGR sequences', () => {
    const v = fixtureView();
    assert.doesNotMatch(renderDashboard(v, initialState(v), 100, 32).ansi('mono').join(''), /\x1b\[/);
});
test('streaming decoder retains split Unicode and split CSI input', () => {
    const decoder = new StreamingKeyDecoder(), bytes = new TextEncoder().encode('界');
    assert.deepEqual(decoder.push(bytes.slice(0, 2)), []);
    assert.deepEqual(decoder.push(bytes.slice(2)), ['界']);
    assert.deepEqual(decoder.push('\x1b['), []);
    assert.deepEqual(decoder.push('B'), ['down']);
    assert.deepEqual(decodeKeys('\x1b[Z\x1b[5~\x1b[6~\x1b[999~'), ['shift-tab', 'page-up', 'page-down']);
});
test('bracketed paste is a single inert event across chunk boundaries', () => {
    const decoder = new StreamingKeyDecoder();
    assert.deepEqual(decoder.push('\x1b[20'), []);
    assert.deepEqual(decoder.push('0~cq\r\n\x1b[2'), []);
    assert.deepEqual(decoder.push('01~'), ['paste:cq\r\n']);
});
test('standalone Escape is delivered only when the timeout flushes it', () => {
    const decoder = new StreamingKeyDecoder();
    assert.deepEqual(decoder.push('\x1b'), []);
    assert.equal(decoder.awaitingEscape, true);
    assert.deepEqual(decoder.flushEscape(), ['escape']);
});
for (const [width, height] of [[1, 1], [30, 10], [44, 14], [60, 20], [80, 24], [100, 32], [124, 40], [160, 48], [200, 60]]) {
    test(`dashboard and every modal stay cell-bounded at ${width}x${height}`, () => {
        const v = fixtureView(), s = initialState(v);
        for (const modal of [null, { kind: 'search', value: 'long query 世界' }, { kind: 'palette', value: '', index: 18 }, { kind: 'help', offset: 0 }, actionForm('create_work'), actionForm('evidence'), { kind: 'confirm', action: 'claim', workId: 'task-123', payload: {}, revision: 248, attempt: null, summary: 'Claim the selected work.', details: ['No mutation until confirmation.'], offset: 0 }]) {
            s.modal = modal;
            bounded(renderDashboard(v, s, width, height));
        }
    });
}
test('breakpoints remove panes, not contents, and narrow inspector is a full view', () => {
    assert.ok(dashboardLayout(132, 40).rail);
    assert.ok(dashboardLayout(100, 32).inspector);
    assert.equal(dashboardLayout(80, 24).inspector, undefined);
    const v = fixtureView(), s = initialState(v);
    s.detailOnly = true;
    s.focus = 'inspector';
    assert.match(renderDashboard(v, s, 80, 24).plain().join('\n'), /INSPECTOR/);
});
test('selection is stable by ID through reorder and reconciles when hidden', () => {
    const v = fixtureView(), s = initialState(v);
    s.selectedId = 'cli-017';
    v.monitoring.items.reverse();
    reconcileSelection(v, s);
    assert.equal(s.selectedId, 'cli-017');
    s.filter = 'closed';
    reconcileSelection(v, s);
    assert.equal(visibleItems(v, s).find(i => i.work_id === s.selectedId)?.status, 'closed');
});
test('search covers title, ID, description, owner and parent on the loaded page', () => {
    const v = fixtureView(), s = initialState(v);
    for (const q of ['tui-104', 'focused operator', 'sprint-06', 'operator']) {
        s.query = q;
        assert.ok(visibleItems(v, s).length > 0);
    }
    s.query = 'not-found';
    assert.deepEqual(visibleItems(v, s), []);
});
test('palette explains disabled actions and never invents unsupported commands', () => {
    const v = fixtureView(), s = initialState(v);
    s.modal = { kind: 'palette', value: 'finish', index: 0 };
    const command = paletteCommands(v, s)[0];
    assert.equal(command.id, 'action:finish');
    assert.equal(command.disabled, true);
    assert.ok(command.hint.length);
});
test('missing detail data is explicitly labelled instead of fabricated', () => {
    const v = fixtureView(), i = v.monitoring.items[0];
    delete i.gates;
    delete i.activity;
    delete i.dependencies;
    assert.match(detailLines(i, v, 1, 40).map(l => l.text).join(''), /not supplied/);
    assert.match(detailLines(i, v, 2, 40).map(l => l.text).join(''), /not included/);
});
test('service errors take precedence over the default Ready footer', () => {
    const v = fixtureView(), s = initialState(v);
    v.notice = { kind: 'error', message: 'Transport disconnected. Reconnect and read back.' };
    assert.match(renderDashboard(v, s, 132, 40).plain().join('\n'), /Transport disconnected/);
});
// Real interaction loop, using a fake controller only at the service boundary.
async function session(fn) {
    const c = new FakeController(), t = new FakeTerminal(), promise = runFullScreen(c, t, { auto_refresh_ms: 0, shutdown_drain_ms: 100 });
    try {
        await tick();
        await fn(c, t);
    }
    finally {
        t.emit('SIGTERM');
        await promise;
    }
    assert.equal(t.listeners.size, 0);
    assert.deepEqual(t.rawModes, [true, false]);
    assert.match(t.writes.at(-1), /\x1b\[\?1049l/);
}
test('paste outside a field cannot dispatch or quit; duplicate confirmation dispatches once', async () => {
    await session(async (c, t) => {
        t.send('\x1b[200~c\rq\x1b[201~');
        await tick();
        assert.equal(c.calls.length, 0);
        t.send('c\r\rc\r');
        await tick();
        assert.equal(c.calls.filter(x => x[0] === 'claim').length, 1);
    });
});
test('a stale revision cancels the exact confirmation without sending a mutation', async () => {
    await session(async (c, t) => { t.send('c'); c.data.monitoring.revision++; t.send('\r'); await tick(); assert.equal(c.calls.length, 0); assert.match(t.text(), /snapshot or attempt changed/); });
});
test('standalone Escape cancels the draft; later Enter only inspects', async () => {
    await session(async (c, t) => { t.send('c'); t.send('\x1b'); await new Promise(r => setTimeout(r, 55)); t.send('\r'); await tick(); assert.equal(c.calls.length, 0); });
});
test('create-work form accepts shortcut letters as text and submits the real fields', async () => {
    await session(async (c, t) => {
        t.send('n');
        t.send('task-new\r\rA proper q title\r\r\rA description\r');
        await tick();
        assert.equal(c.calls.length, 0);
        t.send('\r');
        await tick();
        const input = c.calls.find(x => x[0] === 'create_work')[1];
        assert.equal(input.title, 'A proper q title');
        assert.equal(input.kind, 'task');
        assert.equal(input.priority, 0);
        assert.equal(input.description, 'A description');
    });
});
test('JSON arrays are rejected as evidence; real receipt objects remain unchanged', async () => {
    await session(async (c, t) => {
        t.send('\x1b[B');
        t.send('e');
        t.send('[]\r');
        await tick();
        assert.equal(c.calls.length, 0);
        assert.match(t.text(), /JSON object/);
        t.send('\x15');
        t.send('\x1b[200~{"receipt_id":"proof-1","summary":"q c f"}\x1b[201~');
        t.send('\r\r');
        await tick();
        const call = c.calls.find(x => x[0] === 'evidence');
        assert.equal(call[1], 'tui-101');
        assert.deepEqual(call[2], { receipt_id: 'proof-1', summary: 'q c f' });
    });
});
test('unknown operations are read back, never automatically replayed', async () => {
    await session(async (c, t) => { c.data.pending_operations = [{ operation_id: 'op-unknown', action: 'claim', work_id: 'tui-104' }]; t.send('u'); await tick(); assert.deepEqual(c.calls, [['readback', 'op-unknown']]); });
});
test('later pages pause polling instead of being silently replaced by page zero', async () => {
    const c = new FakeController(), t = new FakeTerminal();
    c.data.monitoring.has_more = true;
    const p = runFullScreen(c, t, { auto_refresh_ms: 500 });
    await tick();
    t.send(']');
    await new Promise(r => setTimeout(r, 650));
    assert.equal(c.refreshes, 0);
    assert.match(t.text(), /polling paused/);
    t.send('F');
    await tick();
    assert.equal(c.refreshes, 1);
    t.send('q');
    await p;
});
test('resize preserves access to the currently focused inspector', async () => {
    await session(async (c, t) => { t.send('\r'); t.resize(60, 24); assert.match(t.writes.at(-1), /INSPECTOR/); });
});
test('EOF restores raw mode and disposes terminal resources', async () => {
    const t = new FakeTerminal();
    t.was_raw = true;
    const p = runFullScreen(new FakeController(), t, { auto_refresh_ms: 0 });
    await tick();
    t.emit('end');
    await p;
    assert.deepEqual(t.rawModes, [true, true]);
    assert.equal(t.listeners.size, 0);
});
test('NO_COLOR and explicit plain/theme flags resolve predictably', () => {
    const before = process.env.NO_COLOR;
    process.env.NO_COLOR = '';
    try {
        const options = parseTerminalArgs(['--socket', '/tmp/boreal.sock', '--project', 'p', '--theme', 'light', '--plain']);
        assert.equal(options.theme, 'mono');
        assert.equal(options.plain, true);
    }
    finally {
        if (before === undefined)
            delete process.env.NO_COLOR;
        else
            process.env.NO_COLOR = before;
    }
    assert.throws(() => parseTerminalArgs(['--socket', 's', '--project', 'p', '--theme', 'pink']), /theme/);
});
// Installer reducer and actual shared-renderer screens.
test('ASCII wordmark is five rows, terminal-sized, and contains no non-ASCII art', () => {
    const rows = wordmark();
    assert.equal(rows.length, 5);
    assert.ok(rows.every(r => cellWidth(r) < 76));
    assert.ok(rows.every(r => /^[# ]+$/.test(r)));
});
test('agent multi-select keeps both actual adapters and rejects zero selections', () => {
    const s = project();
    applyWizardKey(s, 'enter');
    applyWizardKey(s, ' ');
    assert.match(validateWizard(s), /at least one/);
    applyWizardKey(s, ' ');
    applyWizardKey(s, 'down');
    applyWizardKey(s, ' ');
    assert.deepEqual(s.agents, ['codex', 'claude']);
    applyWizardKey(s, 'enter');
    applyWizardKey(s, 'down');
    applyWizardKey(s, ' ');
    assert.equal(s.memory_layout, 'in-repo');
});
test('explicit CLI choices cannot be changed by the wizard', () => {
    const s = project({ agents: ['claude'], agents_locked: true, memory_locked: true });
    s.step = 1;
    applyWizardKey(s, ' ');
    assert.deepEqual(s.agents, ['claude']);
    assert.match(s.error, /fixed/);
    s.step = 2;
    applyWizardKey(s, 'down');
    applyWizardKey(s, ' ');
    assert.equal(s.memory_layout, 'child');
});
test('custom skill root rejects ambiguous multi-agent setup', () => {
    const s = project({ agents: ['codex', 'claude'], install_root: '/workspace/custom' });
    s.step = 1;
    assert.match(validateWizard(s), /one agent/);
});
test('prefix validation rejects relative, root, normalized root and control characters', () => {
    for (const prefix of ['relative', '/', '/tmp/..', '/tmp/bad\x1bpath']) {
        const s = createWizardState('machine', { prefix });
        s.step = 1;
        assert.notEqual(validateWizard(s), '');
    }
});
test('existing-command protection follows the edited destination', () => {
    const dir = mkdtempSync(join(tmpdir(), 'boreal-wizard-'));
    try {
        mkdirSync(join(dir, 'bin'));
        writeFileSync(join(dir, 'bin/bwrk'), 'v1');
        const s = createWizardState('machine', { prefix: '/not-an-install' });
        s.prefix = dir;
        s.step = 2;
        assert.ok(choices(s).some(c => c.id === 'replace_existing'));
        s.step = 4;
        assert.match(validateWizard(s), /Existing unrecognized/);
        s.replace_existing = true;
        assert.equal(validateWizard(s), '');
    }
    finally {
        rmSync(dir, { recursive: true, force: true });
    }
});
test('compact review must be scrolled before final confirmation', () => {
    const s = project({ project_root: '/workspace/' + 'nested/'.repeat(15), database: '/workspace/' + 'nested/'.repeat(15) + '.boreal/boreal.sqlite' });
    s.step = 3;
    bounded(renderWizard(s, 60, 24));
    assert.ok(s.maxOffset > 0);
    assert.equal(applyWizardKey(s, 'enter'), 'continue');
    assert.match(s.error, /Scroll/);
    applyWizardKey(s, 'end');
    assert.equal(applyWizardKey(s, 'enter'), 'submit');
    assert.deepEqual(wizardResult(s), { confirmed: true, agents: ['codex'], memory_layout: 'child' });
});
for (const [width, height] of [[30, 10], [48, 18], [60, 24], [80, 24], [100, 36], [144, 44]]) {
    test(`every installer screen stays bounded at ${width}x${height}`, () => {
        for (const state of [project({ agents: ['codex', 'claude'] }), createWizardState('machine', { prefix: '/home/operator/.local', source: 'release', dashboard: true, verify: true })]) {
            for (let step = 0; step < state.steps.length; step++) {
                state.step = step;
                bounded(renderWizard(state, width, height));
            }
        }
    });
}
test('wizard cancellation and back navigation produce no apply result', () => {
    const s = project();
    assert.equal(applyWizardKey(s, 'escape'), 'cancel');
    applyWizardKey(s, 'enter');
    assert.equal(applyWizardKey(s, 'escape'), 'continue');
    assert.equal(s.step, 0);
    assert.equal(applyWizardKey(s, 'ctrl-c'), 'cancel');
});
test('terminal control strings cannot leak shortcut letters into commands', () => {
    const d = new StreamingKeyDecoder();
    assert.deepEqual(d.push('\x1b]0;cqfs\x07'), []);
    assert.deepEqual(d.push('\x1bPqcf'), []);
    assert.deepEqual(d.push('\x1b\\r'), ['r']);
    d.push('\x1b]unfinished');
    assert.deepEqual(d.push('\x03'), ['ctrl-c']);
});
