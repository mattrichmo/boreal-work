import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GlobalController } from '../dist/model.js';
import { GlobalServiceClient } from '../dist/client.js';
import { runInteractive } from '../dist/interaction.js';

const stamp = '2026-10-13T12:00:00Z';
const project = (id, name = id) => ({ id, name, description: '', archived: false, created_at: stamp, updated_at: stamp });
const item = (id, title = id, projectId = 'p1', position = 0) => ({ id, title, project_id: projectId, parent_id: null, kind: 'task', description: '', labels: [], status_id: 'todo', priority: null, due_at: null, archived: false, position, created_at: stamp, updated_at: stamp });
const status = (id, projectId = 'p1', position = 0) => ({ project_id: projectId, status_id: id, label: id, category: 'open', position });
const snapshot = (changes = {}) => ({ schema_version: 2, revision: 1, projects: [project('p1', 'Project 1')], items: [item('i1', 'Source item')], notes: [], statuses: [status('todo')], relationships: [], associations: [], ...changes });

function encode(value) {
  const body = Buffer.from(JSON.stringify(value));
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length);
  return Buffer.concat([header, body]);
}
async function waitFor(predicate, message = 'condition was not reached') {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.fail(message);
}

function interactiveHarness(client) {
  const controller = new GlobalController(client);
  const terminal = {
    isTty: true,
    output: '',
    listener: undefined,
    write(value) { this.output += value; },
    onData(listener) { this.listener = listener; return () => { this.listener = undefined; }; },
    dimensions() { return { width: 100, height: 30 }; },
    setRawMode() {},
  };
  const run = runInteractive(controller, terminal);
  return {
    controller,
    terminal,
    run,
    async key(value) {
      if (!terminal.listener) await new Promise(resolve => setTimeout(resolve, 0));
      terminal.listener?.(value);
      await new Promise(resolve => setTimeout(resolve, 0));
    },
  };
}

test('search uses server-filtered revision-pinned pages and retains selection through paging and refresh', async () => {
  const base = snapshot({
    snapshot_limit: 2,
    totals: { items: 102, projects: 1, statuses: 1 },
    items: [item('summary-1', 'Ordinary one', 'p1', 0), item('summary-2', 'Ordinary two', 'p1', 1)],
  });
  const matches = [item('page-101', 'needle first result', 'p1', 101), item('page-102', 'needle second result', 'p1', 102)];
  let revision = 1;
  const pageCalls = [];
  const client = {
    snapshot: async () => ({ ...structuredClone(base), revision }),
    execute: async (command, payload) => {
      assert.equal(command, 'task show');
      return matches.find(row => row.id === payload.item_id);
    },
    detailPage: async (collection, options) => {
      pageCalls.push({ collection, ...options });
      const rows = matches.slice(options.offset, options.offset + 1);
      const next = options.offset + rows.length < matches.length ? options.offset + rows.length : null;
      return { rows, total: matches.length, limit: options.limit, offset: options.offset, has_more: next !== null, next_offset: next, revision };
    },
  };
  const controller = new GlobalController(client);
  await controller.refresh();
  controller.setScope('p1');
  controller.setRoute('list');

  await controller.search('needle');
  assert.equal(controller.selectedRow()?.id, 'page-101');
  assert.deepEqual(pageCalls[0], { collection: 'items', projectId: 'p1', limit: 100, offset: 0, includeArchived: false, query: 'needle', expectedRevision: 1 });
  controller.selectId('page-101');
  assert.equal(await controller.loadMoreRows(), true);
  assert.equal(controller.selectedRow()?.id, 'page-101');
  assert.ok(controller.rows().some(row => row.id === 'page-102'));

  revision = 2;
  await controller.refresh();
  assert.equal(controller.selectedRow()?.id, 'page-101');
  assert.equal(controller.pageError, undefined);
  assert.equal(pageCalls.at(-1).expectedRevision, 2);
  assert.equal(pageCalls.at(-1).offset, 0);
});

test('refresh retains a selected server search match when only a server-searchable field matches', async () => {
  const dueDate = '2026-11-14';
  const base = snapshot({
    snapshot_limit: 1,
    totals: { items: 3, projects: 1, statuses: 1 },
    items: [item('summary-1', 'Unrelated summary row', 'p1', 0)],
  });
  const matches = [
    { ...item('page-101', 'First result without matching title', 'p1', 101), due_at: dueDate },
    { ...item('page-102', 'Selected result without matching title', 'p1', 102), due_at: dueDate },
  ];
  let revision = 1;
  const client = {
    snapshot: async () => ({ ...structuredClone(base), revision }),
    execute: async (command, payload) => {
      assert.equal(command, 'task show');
      return matches.find(row => row.id === payload.item_id);
    },
    detailPage: async (_collection, options) => {
      const rows = matches.slice(options.offset, options.offset + 1);
      const next = options.offset + rows.length < matches.length ? options.offset + rows.length : null;
      return { rows, total: matches.length, limit: options.limit, offset: options.offset, has_more: next !== null, next_offset: next, revision };
    },
  };
  const controller = new GlobalController(client);
  await controller.refresh();
  controller.setScope('p1');
  controller.setRoute('list');
  await controller.search(dueDate);
  assert.equal(await controller.loadMoreRows(), true);
  controller.selectId('page-102');
  assert.equal(controller.selectedRow()?.id, 'page-102');

  revision = 2;
  await controller.refresh();
  assert.equal(controller.selectedRow()?.id, 'page-102');
});

test('complete project, status, and parent choices page through capped summaries at one revision', async () => {
  const projects = Array.from({ length: 101 }, (_, index) => project(`p${index + 1}`, `Project ${index + 1}`));
  const items = Array.from({ length: 101 }, (_, index) => item(`item-${index + 1}`, `Parent ${index + 1}`, 'p1', index));
  const statuses = Array.from({ length: 101 }, (_, index) => status(`status-${index + 1}`, 'p1', index));
  const base = snapshot({
    revision: 9,
    snapshot_limit: 2,
    totals: { projects: 101, items: 101, statuses: 101 },
    projects: projects.slice(0, 2),
    items: items.slice(0, 2),
    statuses: statuses.slice(0, 2),
  });
  const calls = [];
  const data = { projects, items, statuses };
  const client = {
    snapshot: async () => structuredClone(base),
    execute: async () => ({}),
    detailPage: async (collection, options) => {
      calls.push({ collection, ...options });
      const full = data[collection].filter(row => !options.projectId || (row.project_id ?? row.id) === options.projectId);
      const rows = full.slice(options.offset, options.offset + options.limit);
      const next = options.offset + rows.length < full.length ? options.offset + rows.length : null;
      return { rows, total: full.length, limit: options.limit, offset: options.offset, has_more: next !== null, next_offset: next, revision: 9 };
    },
  };
  const controller = new GlobalController(client);
  await controller.refresh();
  const allProjects = await controller.completeChoices('projects');
  const projectItems = await controller.completeChoices('items', 'p1');
  const projectStatuses = await controller.completeChoices('statuses', 'p1');
  assert.equal(allProjects.length, 101);
  assert.equal(allProjects.at(-1).id, 'p101');
  assert.equal(projectItems.length, 101);
  assert.equal(projectItems.at(-1).id, 'item-101');
  assert.equal(projectStatuses.length, 101);
  assert.equal(projectStatuses.at(-1).status_id, 'status-101');
  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => call.expectedRevision === 9 && call.limit === 100));
  assert.ok(calls.some(call => call.collection === 'items' && call.projectId === 'p1' && call.offset === 100));
  assert.ok(calls.some(call => call.collection === 'statuses' && call.projectId === 'p1' && call.offset === 100));
});

test('failed complete-choice reads retain a visible page error instead of returning a partial picker', async () => {
  const base = snapshot({ snapshot_limit: 2, totals: { projects: 3 }, projects: [project('p1'), project('p2')] });
  const controller = new GlobalController({ snapshot: async () => structuredClone(base), execute: async () => ({}), detailPage: async () => { throw new Error('service unavailable'); } });
  await controller.refresh();
  await assert.rejects(controller.completeChoices('projects'), /service unavailable/);
  assert.equal(controller.pageLoading, false);
  assert.equal(controller.pageError, 'service unavailable');
});

test('detailed item form searches and selects project, parent, and status choices on page 101', async () => {
  const projects = Array.from({ length: 101 }, (_, index) => project(`p${index + 1}`, `Project ${index + 1}`));
  const items = ['p1', 'p101'].flatMap(projectId => Array.from({ length: 101 }, (_, index) => item(`${projectId}-item-${index + 1}`, `Parent in ${projectId} ${index + 1}`, projectId, index)));
  const statuses = ['p1', 'p101'].flatMap(projectId => Array.from({ length: 101 }, (_, index) => status(`${projectId}-status-${index + 1}`, projectId, index)));
  const base = snapshot({
    snapshot_limit: 2,
    totals: { projects: 101, items: 202, statuses: 202 },
    projects: projects.slice(0, 2),
    items: items.filter(row => row.project_id === 'p1').slice(0, 2),
    statuses: statuses.filter(row => row.project_id === 'p1').slice(0, 2),
  });
  const writes = [];
  const calls = [];
  const data = { projects, items, statuses };
  const client = {
    snapshot: async () => structuredClone(base),
    execute: async (command, payload, mutation) => {
      if (mutation) writes.push({ command, payload });
      return { operation_id: 'op-create', revision: 2 };
    },
    detailPage: async (collection, options) => {
      calls.push({ collection, ...options });
      const full = data[collection].filter(row => !options.projectId || (row.project_id ?? row.id) === options.projectId);
      const rows = full.slice(options.offset, options.offset + options.limit);
      const next = options.offset + rows.length < full.length ? options.offset + rows.length : null;
      return { rows, total: full.length, limit: options.limit, offset: options.offset, has_more: next !== null, next_offset: next, revision: 1 };
    },
  };
  const h = interactiveHarness(client);
  await waitFor(() => h.controller.snapshot, 'initial snapshot did not load');
  h.controller.setScope('p1');

  await h.key('N');
  await waitFor(() => h.terminal.output.includes('New task · details'), 'detailed item form did not open');
  await h.key('\t');
  await h.key('\r');
  await waitFor(() => h.terminal.output.includes('Choose destination'), 'destination project picker did not open');
  await h.key('Project 101');
  await h.key('\r');
  await waitFor(() => calls.some(call => call.collection === 'items' && call.projectId === 'p101' && call.offset === 100)
    && calls.some(call => call.collection === 'statuses' && call.projectId === 'p101' && call.offset === 100), 'new destination choices did not finish paging');

  await h.key('\t');
  await h.key('\t');
  await h.key('\r');
  await waitFor(() => h.terminal.output.includes('Choose parent'), 'parent picker did not open');
  await h.key('Parent in p101 101');
  await h.key('\r');
  await h.key('\t');
  await h.key('\r');
  await waitFor(() => h.terminal.output.includes('Choose workflow status'), 'status picker did not open');
  await h.key('p101-status-101');
  await h.key('\r');

  await h.key('\x1b[Z');
  await h.key('\x1b[Z');
  await h.key('\x1b[Z');
  await h.key('\x1b[Z');
  await h.key('Created from complete choices');
  await h.key('\x13');
  await waitFor(() => writes.length === 1, 'detailed item mutation did not submit');
  assert.equal(writes[0].command, 'task add');
  assert.equal(writes[0].payload.project_id, 'p101');
  assert.equal(writes[0].payload.parent_id, 'p101-item-101');
  assert.equal(writes[0].payload.status_id, 'p101-status-101');
  await h.key('\x03');
  await h.run;
});

test('dependency picker can search and choose an item beyond the snapshot sample', async () => {
  const allItems = Array.from({ length: 101 }, (_, index) => item(`item-${index + 1}`, index === 100 ? 'Needle target on page 101' : `Task ${index + 1}`, 'p1', index));
  const base = snapshot({ snapshot_limit: 100, totals: { projects: 1, items: 101, statuses: 1 }, items: allItems.slice(0, 100) });
  const writes = [];
  const detailCalls = [];
  const client = {
    snapshot: async () => structuredClone(base),
    history: async () => ({ events: [], total: 0, has_more: false, next_offset: null }),
    execute: async (command, payload, mutation) => {
      if (mutation) writes.push({ command, payload });
      return { operation_id: 'op-1', revision: 2 };
    },
    detailPage: async (collection, options) => {
      detailCalls.push({ collection, ...options });
      const rows = allItems.filter(row => row.project_id === options.projectId).slice(options.offset, options.offset + options.limit);
      const next = options.offset + rows.length < allItems.length ? options.offset + rows.length : null;
      return { rows, total: allItems.length, limit: options.limit, offset: options.offset, has_more: next !== null, next_offset: next, revision: 1 };
    },
  };
  const h = interactiveHarness(client);
  await waitFor(() => h.controller.snapshot, 'initial snapshot did not load');
  await h.key('b');
  await waitFor(() => h.terminal.output.includes('Choose dependency'), 'dependency picker did not open after paging');
  assert.deepEqual(detailCalls.map(call => call.offset), [0, 100]);
  await h.key('Needle target on page 101');
  await waitFor(() => h.terminal.output.includes('Needle target on page 101'), 'search did not reveal the page-101 picker result');
  await h.key('\r');
  await waitFor(() => writes.length === 1, 'dependency mutation did not submit');
  assert.equal(writes[0].command, 'relationship add');
  assert.equal(writes[0].payload.target_id, 'item-101');
  await h.key('\x03');
  await h.run;
});

test('detailPage forwards its expected revision to the versioned service request', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'global-picker-page-'));
  const socketPath = join(directory, 'service.sock');
  let requestSeen;
  const server = createServer(socket => {
    let received = Buffer.alloc(0);
    socket.on('data', chunk => {
      received = Buffer.concat([received, chunk]);
      if (received.length < 4) return;
      const size = received.readUInt32BE(0);
      if (received.length < size + 4) return;
      const request = JSON.parse(received.subarray(4, size + 4).toString('utf8'));
      requestSeen = request;
      socket.end(encode({
        request_id: request.request_id,
        payload: {
          api_version: '2', schema_version: 'boreal.protocol.envelope.v1', operation_id: request.payload.operation_id,
          outcome: 'unchanged', transport: 'ok', data: { rows: [], total: 0, limit: 100, offset: 0, has_more: false, next_offset: null, revision: 12 }, error: null,
        },
      }));
    });
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  });
  const client = new GlobalServiceClient(socketPath);
  await client.detailPage('items', { projectId: 'p1', limit: 100, offset: 200, query: 'needle', expectedRevision: 12 });
  assert.equal(requestSeen.payload.command, 'detail page');
  assert.deepEqual(requestSeen.payload.payload, { collection: 'items', project_id: 'p1', limit: 100, offset: 200, query: 'needle', expected_revision: 12 });
});
