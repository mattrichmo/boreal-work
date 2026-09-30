import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalController } from '../dist/model.js';
import { runInteractive } from '../dist/interaction.js';
import { StreamingKeyDecoder } from '../dist/terminal/keys.js';
import { form, editField, validateForm, parseLabels, renderForm } from '../dist/forms.js';

const snapshot = () => ({ schema_version: 2, revision: 1,
  projects: [{ id: 'p1', name: 'Life', description: '', archived: false, created_at: '', updated_at: '' }],
  items: [{ id: 'i1', project_id: 'p1', parent_id: null, kind: 'task', title: 'A task', description: '', status_id: 'todo', priority: null, due_at: null, labels: [], archived: false, position: 0, created_at: '', updated_at: '' }],
  notes: [], statuses: [{ project_id: 'p1', status_id: 'todo', label: 'To do', category: 'todo', position: 0 }], relationships: [], associations: [] });
function harness(options = {}) {
  const calls = [], historyCalls = [];
  const client = { snapshot: async () => options.snapshot ?? snapshot(), history: async args => { historyCalls.push(args); return options.history ? options.history(args) : { events: [], total: 0, has_more: false, next_offset: null }; }, execute: async (command, payload) => { calls.push({ command, payload }); if (options.fail) throw new Error('write rejected for fixture'); return {}; } };
  const controller = new GlobalController(client); controller.setScope('p1'); controller.setRoute(options.route ?? 'list');
  const terminal = { isTty: true, output: '', raw: false, listener: undefined, write(s) { this.output += s; }, setRawMode(v) { this.raw = v; }, onData(fn) { this.listener = fn; return () => { this.listener = undefined; }; }, dimensions() { return { width: 80, height: 18 }; }, openLinkedWorkspace: options.openLinkedWorkspace };
  const run = runInteractive(controller, terminal);
  return { calls, historyCalls, controller, terminal, run, async key(s) { if (!terminal.listener) await new Promise(r => setTimeout(r, 0)); terminal.listener?.(s); await new Promise(r => setTimeout(r, 0)); } };
}

test('stream decoder preserves split UTF-8/escape and brackets clipboard data away from actions', () => {
  const decoder = new StreamingKeyDecoder();
  const bytes = new TextEncoder().encode('Café 家');
  const split = bytes.slice(0, 4), rest = bytes.slice(4);
  assert.deepEqual(decoder.push(split), ['C', 'a', 'f']);
  assert.deepEqual(decoder.push(rest), ['é', ' ', '家']);
  assert.deepEqual(decoder.push('\x1b['), []);
  assert.deepEqual(decoder.push('A'), ['up']);
  assert.deepEqual(decoder.push('\x1b[200~a\x1b[201~'), ['paste:a']);
});

test('paste payload cannot trigger archive and Ctrl-C safely restores terminal', async () => {
  const h = harness(); await h.key('\x1b[200~a\x1b[201~');
  assert.equal(h.calls.length, 0);
  await h.key('\x03'); await h.run;
  assert.equal(h.terminal.raw, false);
  assert.match(h.terminal.output, /\?1049l/);
});

test('quick capture retains Unicode and commas in its title and submits once', async () => {
  const h = harness(); await h.key('n'); await h.key('Café 家, groceries'); await h.key('\r'); await new Promise(r => setTimeout(r, 5));
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].command, 'todo add');
  assert.equal(h.calls[0].payload.title, 'Café 家, groceries');
  await h.key('q'); await h.run;
});

test('command palette quick capture performs the selected action', async () => {
  const h = harness(); await h.key(':'); await h.key('Quick capture'); await h.key('\r');
  await h.key('Call, then Café'); await h.key('\r');
  assert.equal(h.calls[0].command, 'todo add');
  assert.equal(h.calls[0].payload.title, 'Call, then Café');
  await h.key('\x03'); await h.run;
});

test('rejected form save keeps the form and shows the error for correction', async () => {
  const h = harness({ fail: true }); await h.key('n'); await h.key('Draft title'); await h.key('\r');
  assert.match(h.terminal.output, /Quick capture/);
  assert.match(h.terminal.output, /write rejected for fixture/);
  assert.match(h.terminal.output, /Draft title/);
  await h.key('\x03'); await h.run;
});

test('searchable picker keeps a selection beyond the first terminal page visible', async () => {
  const data = snapshot();
  data.items = Array.from({ length: 61 }, (_, index) => ({ ...data.items[0], id: `i${index + 1}`, title: `Task ${String(index + 1).padStart(2, '0')}`, position: index }));
  const h = harness({ snapshot: data }); await h.key('b');
  for (let i = 0; i < 55; i++) await h.key('\x1b[B');
  assert.match(h.terminal.output, /› Task 56/);
  await h.key('\x03'); await h.run;
});

test('refresh retains selected record identity when another client updates the snapshot', async () => {
  const data = snapshot(); const h = harness({ snapshot: data });
  await h.key('q'); await h.run;
  h.controller.selectId('i1');
  data.items[0].title = 'Changed elsewhere';
  await h.controller.refresh();
  assert.equal(h.controller.selectedId, 'i1');
  assert.equal(h.controller.selectedItem.title, 'Changed elsewhere');
});

test('workflow editor offers semantic backend categories and submits selected category', async () => {
  const h = harness(); h.controller.setRoute('workflow');
  await h.key('s'); await h.key('ready'); await h.key('\r'); await h.key('Ready'); await h.key('\r');
  await h.key('\x1b[C'); await h.key('\r'); await h.key('\r');
  assert.equal(h.calls[0].command, 'workflow status add');
  assert.equal(h.calls[0].payload.category, 'active');
  await h.key('\x03'); await h.run;
});

test('archive recovery dispatches the item unarchive command for a selected archived item', async () => {
  const data = snapshot(); data.items[0].archived = true;
  const h = harness({ snapshot: data }); h.controller.setRoute('archive');
  await h.key('u');
  assert.equal(h.calls[0].command, 'todo unarchive');
  assert.equal(h.calls[0].payload.item_id, 'i1');
  await h.key('\x03'); await h.run;
});

test('focus navigation follows shared route order and inspector arrows change tabs and scroll', async () => {
  const h = harness(); h.controller.setRoute('overview'); h.controller.focus = 'navigation';
  await h.key('\x1b[B'); assert.equal(h.controller.route, 'projects');
  h.controller.focus = 'inspector';
  await h.key('\x1b[C'); assert.equal(h.controller.inspectorTab, 'relationships');
  await h.key('\x1b[B'); assert.equal(h.controller.inspectorOffset, 1);
  await h.key('\x03'); await h.run;
});

test('history reader pages through server history and reports page counts', async () => {
  const events = Array.from({ length: 110 }, (_, i) => ({ operation_id: `op${i}`, revision: i + 1, command: 'todo edit', entity_kind: 'item', entity_id: 'i1', title: `Event ${i + 1}`, summary: `Changed ${i + 1}`, created_at: '2026-09-30T00:00:00Z' }));
  const h = harness({ history: ({ offset = 0, limit = 50 }) => ({ events: events.slice(offset, offset + limit), total: events.length, has_more: offset + limit < events.length, next_offset: offset + limit < events.length ? offset + limit : null }) });
  h.controller.setRoute('history'); await h.key('\r');
  assert.match(h.terminal.output, /Activity history · 1–50 of 110/);
  await h.key('\x1b[6~');
  assert.equal(h.historyCalls.at(-1).offset, 50);
  assert.match(h.terminal.output, /Activity history · 51–100 of 110/);
  await h.key('\x1b[5~');
  assert.equal(h.historyCalls.at(-1).offset, 0);
  assert.match(h.terminal.output, /Activity history · 1–50 of 110/);
  await h.key('\x03'); await h.run;
});

test('card reorder asks backend to move relative to its adjacent sibling', async () => {
  const h = harness(); await h.key(']');
  assert.equal(h.calls[0].command, 'todo reorder');
  assert.equal(h.calls[0].payload.item_id, 'i1');
  assert.equal(h.calls[0].payload.direction, 'down');
  await h.key('\x03'); await h.run;
});

for (const [label, callback, expected] of [
  ['successful', async () => {}, /Returned from linked workspace/],
  ['failed', async () => { throw new Error('fixture handoff failure'); }, /Handoff failed: Error: fixture handoff failure/]
]) {
  test(`${label} linked handoff restores the full global screen and raw mode`, async () => {
    const data = snapshot(); data.associations.push({ project_id: 'p1', kind: 'workspace', identity: 'workspace-1', path: '/tmp/workspace', updated_at: '' });
    const h = harness({ snapshot: data, route: 'links', openLinkedWorkspace: callback });
    await h.key('H'); await new Promise(r => setTimeout(r, 10));
    assert.equal(h.terminal.raw, true);
    assert.ok(h.terminal.output.split('\x1b[?1049h').length >= 3, 'alternate screen should be entered again after handoff');
    assert.match(h.terminal.output, /Linked|workspace-1/);
    assert.match(h.terminal.output, expected);
    await h.key('\x03'); await h.run;
  });
}

test('help stays visible and reports actionable controls at narrow terminal width', async () => {
  const h = harness(); await h.key('?');
  assert.match(h.terminal.output, /Global manager help/);
  assert.match(h.terminal.output, /dependency/);
  await h.key('\x03'); await h.run;
});

test('labeled form preserves commas and exposes late active fields on short terminals', () => {
  const state = form('Project', [
    { key: 'name', label: 'Name', value: 'Life, work' },
    { key: 'notes', label: 'Notes', value: 'line one\nline two', kind: 'multiline' },
    { key: 'priority', label: 'Priority', value: '7', kind: 'number' }
  ]);
  state.active = 2;
  state.active = 1;
  const lines = renderForm(state, 30, 8).join('\n');
  assert.match(lines, /Priority/);
  assert.match(lines, /line one\n  line two/);
  const values = validateForm(state);
  assert.equal(values.name, 'Life, work');
  assert.deepEqual(parseLabels('home, urgent, family'), ['home', 'urgent', 'family']);
  assert.match(renderForm(state, 30, 8).join('\n'), /▏/);
  editField(state, '\n'); editField(state, '家');
  assert.equal(state.fields[1].value, 'line one\nline two\n家');
});
