import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalController } from '../dist/model.js';
import { runInteractive, runLineInterface } from '../dist/interaction.js';
import { StreamingKeyDecoder } from '../dist/terminal/keys.js';
import { form, editField, validateForm, parseLabels, renderForm } from '../dist/forms.js';

const snapshot = () => ({ schema_version: 2, revision: 1,
  projects: [{ id: 'p1', name: 'Life', description: '', archived: false, created_at: '', updated_at: '' }],
  items: [{ id: 'i1', project_id: 'p1', parent_id: null, kind: 'task', title: 'A task', description: '', status_id: 'todo', priority: null, due_at: null, labels: [], archived: false, position: 0, created_at: '', updated_at: '' }],
  notes: [], statuses: [{ project_id: 'p1', status_id: 'todo', label: 'To do', category: 'todo', position: 0 }], relationships: [], associations: [] });
function harness(options = {}) {
  const calls = [], historyCalls = [], linkedPageCalls=[]; let snapshotCalls = 0;
  const client = { snapshot: async () => { snapshotCalls++; if(options.failSnapshotAfter!==undefined&&snapshotCalls>options.failSnapshotAfter)throw new Error('snapshot unavailable'); if(options.failFirstSnapshot&&snapshotCalls===1)throw new Error('service unavailable'); return options.snapshot ?? snapshot(); }, history: async args => { historyCalls.push(args); return options.history ? options.history(args) : { events: [], total: 0, has_more: false, next_offset: null }; }, linkedShow: async (projectId,identity) => options.linkedShow?.(projectId,identity), linkedPage: async (projectId,identity,args) => { linkedPageCalls.push({projectId,identity,...args}); return options.linkedPage?.(projectId,identity,args); }, execute: async (command, payload, mutation) => { if(mutation)calls.push({ command, payload }); if (options.fail&&mutation) throw new Error('write rejected for fixture'); if(options.conflict&&mutation)throw Object.assign(new Error('revision conflict'),{errorCode:'revision_conflict'}); if(!mutation&&/show$/.test(command))return options.snapshot?.items?.find(i=>i.id===payload.item_id)??snapshot().items[0]; return { operation_id: `op${calls.length}`, revision: calls.length+1 }; } };
  const controller = new GlobalController(client); controller.setScope('p1'); controller.setRoute(options.route ?? 'list');
  const terminal = { isTty: true, output: '', raw: false, listener: undefined, write(s) { this.output += s; }, setRawMode(v) { this.raw = v; }, onData(fn) { this.listener = fn; return () => { this.listener = undefined; }; }, dimensions() { return { width: 80, height: 18 }; }, openLinkedWorkspace: options.openLinkedWorkspace };
  const run = runInteractive(controller, terminal);
  return { calls, historyCalls, linkedPageCalls, controller, terminal, run, async key(s) { if (!terminal.listener) await new Promise(r => setTimeout(r, 0)); terminal.listener?.(s); await new Promise(r => setTimeout(r, 0)); } };
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
  assert.deepEqual(decoder.push('\x1b['), []);
  assert.deepEqual(decoder.push('A'), ['up']);
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

test('linked workspace reader labels partial detail and loads later pages on Enter', async () => {
  const data=snapshot();data.associations.push({project_id:'p1',kind:'workspace',identity:'workspace-1',path:'/tmp/workspace',updated_at:''});
  const rows=Array.from({length:63},(_,i)=>({work_id:`w${i+1}`,project_id:'execution-1',title:`Linked task ${i+1}`,kind:'task',parent_id:null,lifecycle:'active',display_status:'In progress',status:'active',priority:0,reason_codes:[]}));
  const h=harness({snapshot:data,route:'links',linkedShow:async()=>({management_project_id:'p1',project_id:'workspace-1',path:'/tmp/workspace',availability:'available',revision:4,as_of:'2026-09-30T12:00:00Z',counts:{items:63},items:rows.slice(0,50),items_total:63,items_has_more:true}),linkedPage:async(_project,_identity,{offset=0,limit=50})=>({items:rows.slice(offset,offset+limit),total:rows.length,limit,offset,next_offset:offset+limit<rows.length?offset+limit:null,has_more:offset+limit<rows.length,revision:4,as_of:'2026-09-30T12:00:00Z',availability:'available',error:null})});
  await h.key('\r');
  assert.match(h.terminal.output,/Showing 50 of 63 linked work items · PgDn\/Enter loads next page/);
  await h.key('\r');
  assert.deepEqual(h.linkedPageCalls,[{projectId:'p1',identity:'workspace-1',limit:50,offset:50}]);
  assert.match(h.terminal.output,/Showing 63 of 63 linked work items · all available items shown/);
  assert.equal(h.controller.snapshot.linked_projects[0].items.length,63);
  assert.equal(h.controller.snapshot.linked_projects[0].items.at(-1).title,'Linked task 63');
  await h.key('\x03');await h.run;
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

test('multiline viewport pins title and recovery hints while following the wrapped cursor', () => {
  const body=Array.from({length:40},(_,i)=>`line ${i+1} 家`).join('\n');
  const state=form('Long note', [{key:'body',label:'Body',value:body,kind:'multiline'}]);
  const lines=renderForm(state,80,17).join('\n');
  assert.match(lines,/Long note/);
  assert.match(lines,/line 40 家▏/);
  assert.match(lines,/Ctrl-S save/);
  assert.doesNotMatch(lines,/line 1 家/);
});

test('form date and optional priority rules reject invalid input and explain valid ranges', () => {
  const state=form('Edit',[
    {key:'due',label:'Due date',value:'2026-02-30',kind:'date'},
    {key:'priority',label:'Priority',value:'256',kind:'number'}
  ]);
  assert.equal(validateForm(state),undefined);
  assert.match(state.error,/YYYY-MM-DD/);
  state.fields[0].value='2026-09-30';state.fields[1].value='255';
  assert.deepEqual(validateForm(state),{due:'2026-09-30',priority:255});
  assert.match(renderForm(state,50,12).join('\n'),/explicit offset/);
  assert.match(renderForm(state,50,12).join('\n'),/0 to 255/);
});

test('blank optional priority is omitted for detailed create and project edit', async () => {
  const h=harness();await h.key('N');await h.key('New detailed task');
  for(const key of ['\t','\t','\t','\t','\t','\t','\t','\t','\x13'])await h.key(key);
  assert.equal(h.calls[0].command,'todo add');assert.equal(Object.hasOwn(h.calls[0].payload,'priority'),false);
  h.controller.setRoute('projects');await h.key('e');await h.key('\x13');
  assert.equal(h.calls[1].command,'project edit');assert.equal(Object.hasOwn(h.calls[1].payload,'priority'),false);
  await h.key('\x03');await h.run;
});

test('line parser removes quotes, handles escaped quotes and backslashes, and preserves Unicode and commas', async () => {
  const h=harness();const output=[];
  async function* lines(){yield 'add "Call, then Café 家 and say \\"hi\\" \\\\ home"';yield 'quit';}
  await runLineInterface(h.controller,lines(),value=>output.push(value));
  assert.equal(h.calls[0].payload.title,'Call, then Café 家 and say "hi" \\ home');
});

test('line parser reports unmatched quotes and continues to the next command', async () => {
  const h=harness();const output=[];
  async function* lines(){yield 'add "unfinished';yield 'add valid title';yield 'quit';}
  await runLineInterface(h.controller,lines(),value=>output.push(value));
  assert.match(output.join(''),/unmatched quote/);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].payload.title,'valid title');
});

test('known commit with failed refresh consumes the form and retry reads only', async () => {
  const h=harness({failSnapshotAfter:1});
  await h.key('n');await h.key('Call supplier');await h.key('\r');
  assert.equal(h.calls.length,1);
  assert.match(h.terminal.output,/Saved; refresh failed/);
  await h.key('r');
  assert.equal(h.calls.length,1,'refresh retry must not issue another mutation');
  assert.match(h.terminal.output,/snapshot unavailable/);
  await h.key('\x03');await h.run;
});

test('revision conflict refreshes safely while retaining form text for deliberate reapply', async () => {
  const h=harness({conflict:true});await h.key('n');await h.key('Keep my draft');await h.key('\r');
  assert.equal(h.calls.length,1);
  assert.match(h.terminal.output,/Revision conflict/);
  assert.match(h.terminal.output,/Keep my draft/);
  await h.key('\x03');await h.run;
});

test('global detailed capture defaults to Personal inbox and exposes destination, parent and workflow mapping', async () => {
  const h=harness();h.controller.setScope(undefined);await h.key('N');
  assert.match(h.terminal.output,/Personal inbox/);
  assert.match(h.terminal.output,/Destination/);
  assert.match(h.terminal.output,/Parent/);
  assert.match(h.terminal.output,/Workflow status/);
  await h.key('\x03');await h.run;
});

test('Escape from a searchable form picker returns to the retained form draft', async () => {
  const h=harness();await h.key('N');await h.key('Draft title');await h.key('\r');await h.key('\r');
  assert.match(h.terminal.output,/Choose destination/);
  await h.key('L');await h.key('i');await h.key('f');await h.key('e');await h.key('\x1b');await new Promise(r=>setTimeout(r,45));
  assert.match(h.terminal.output,/Draft title/);
  assert.match(h.terminal.output,/Destination/);
  await h.key('\x03');await h.run;
});

test('unscoped quick capture stores in Personal inbox with no project owner', async () => {
  const h=harness();h.controller.setScope(undefined);await h.key('n');await h.key('Pick up bread');await h.key('\r');
  assert.equal(h.calls[0].payload.project_id,null);
  assert.equal(h.calls[0].payload.title,'Pick up bread');
  await h.key('\x03');await h.run;
});

test('initial service failure leaves a retryable screen and blocks writes until read succeeds', async () => {
  const h=harness({failFirstSnapshot:true});
  await new Promise(r=>setTimeout(r,0));
  assert.match(h.terminal.output,/Global manager unavailable/);
  await h.key('r');
  assert.ok(h.controller.snapshot);
  await h.key('n');await h.key('Unsafe before read');await h.key('\r');
  assert.equal(h.calls.length,1,'write is allowed only after successful readback');
  assert.equal(h.calls[0].command,'todo add');
  await h.key('\x03');await h.run;
});

test('moving an item requires explicit target status and deliberate parent mapping despite reused status IDs', async () => {
  const data=snapshot();
  data.projects.push({id:'p2',name:'Business',description:'',archived:false,created_at:'',updated_at:''});
  data.statuses.push({project_id:'p2',status_id:'todo',label:'Ready',category:'active',position:0});
  data.items.push({...data.items[0],id:'old-parent',title:'Old parent',kind:'milestone',parent_id:null});
  data.items.push({...data.items[0],id:'new-parent',project_id:'p2',title:'New parent',kind:'milestone',parent_id:null});
  data.items[0].parent_id='old-parent';
  const h=harness({snapshot:data});
  await h.key('e');await new Promise(r=>setTimeout(r,10));
  await h.key('\t');await h.key('\t');await h.key('\r');
  for(const ch of 'Business')await h.key(ch);await h.key('\r');
  assert.match(h.terminal.output,/Workflow status/);
  await h.key('\x13');
  assert.match(h.terminal.output,/Choose a valid parent/);
  assert.equal(h.calls.length,0);
  await h.key('\r');await h.key('\r');
  await h.key('\t');await h.key('\r');await h.key('\r');
  await h.key('\x13');await new Promise(r=>setTimeout(r,10));
  assert.equal(h.calls.length,1);
  assert.equal(h.calls[0].payload.project_id,'p2');
  assert.equal(h.calls[0].payload.status_id,'todo');
  assert.equal(h.calls[0].payload.parent_id,null);
  await h.key('\x03');await h.run;
});
