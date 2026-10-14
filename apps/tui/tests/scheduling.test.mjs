import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_VERSION,
  ENVELOPE_SCHEMA,
  VersionedServiceClient,
  buildMonitoringModel,
} from '../dist/client.js';
import { businessDateFromInput, businessDateInput, businessDateLabel } from '../dist/scheduling.js';
import { detailLines } from '../dist/ui/dashboard.js';
import { actionForm, initialState, paletteCommands } from '../dist/ui/model.js';
import { formatWorkspaceView } from '../dist/ui/workspace-view.js';
import { runFullScreen } from '../dist/full-screen.js';
import { FakeTerminal, fixtureView, tick } from './fixtures.mjs';

const local = (year, month, day) => ({ kind: 'local_date', year, month, day });
const resolved = {
  kind: 'resolved_local',
  nominal_local: { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 },
  utc_instant_ms: 1793511000000,
  utc_offset_minutes: -360,
  timezone: 'America/Regina',
  tzdb_identity: 'tzdb:test',
  gap_policy: 'next_valid',
  fold_policy: 'earlier_offset',
};

test('typed date fields preserve exact existing semantics and blank means clear', () => {
  const instant = { kind: 'instant', at_ms: 1793511000000 };
  assert.equal(businessDateInput(instant), '2026-11-01');
  assert.deepEqual(businessDateFromInput('2026-11-01', instant), instant);
  assert.deepEqual(businessDateFromInput(businessDateInput(resolved), resolved), resolved);
  assert.deepEqual(businessDateFromInput('2026-11-02', resolved), local(2026, 11, 2));
  assert.equal(businessDateFromInput('   ', resolved), null);
  assert.deepEqual(businessDateFromInput('0000-02-29'), local(0, 2, 29));
  assert.deepEqual(businessDateFromInput('0001-01-01'), local(1, 1, 1));
  assert.deepEqual(businessDateFromInput('0096-02-29'), local(96, 2, 29));
  assert.throws(() => businessDateFromInput('2026-02-29'), /real calendar date/u);
  assert.throws(() => businessDateFromInput('2026-2-09'), /YYYY-MM-DD/u);
  assert.match(businessDateLabel(resolved), /America\/Regina \(UTC−06:00\)/u);
});

test('typed status facts distinguish server decisions from missing fields', () => {
  const view = fixtureView();
  const raw = view.monitoring.items[0];
  raw.due_today = true;
  raw.overdue = false;
  raw.blocking_external_wait_ids = ['vendor-approval'];
  raw.follow_up_due_wait_ids = ['vendor-approval'];
  const model = buildMonitoringModel({
    api_version: API_VERSION, schema_version: ENVELOPE_SCHEMA, operation_id: 'op_status', revision: 248,
    as_of: '2026-10-14T10:00:00Z', transport: 'ok', outcome: 'unchanged', error: null,
    data: { revision: 248, project_id: 'boreal-work', items: [raw] },
  });
  assert.equal(model.items[0].due_today, true);
  assert.equal(model.items[0].overdue, false);
  assert.deepEqual(model.items[0].blocking_external_wait_ids, ['vendor-approval']);
  assert.deepEqual(model.items[0].follow_up_due_wait_ids, ['vendor-approval']);
  const details = detailLines(model.items[0], view, 0, 100).map(line => line.text).join('\n');
  assert.match(details, /Due today\s+yes · service decision/u);
  assert.match(details, /Overdue\s+no · service decision/u);
  assert.match(details, /Blocking waits\s+vendor-approval/u);
  assert.match(details, /Follow-up due\s+vendor-approval/u);
  const absent = detailLines(view.monitoring.items[1], view, 0, 100).map(line => line.text).join('\n');
  assert.match(absent, /Due today\s+unavailable in this service snapshot/u);
});

test('schedule and wait actions are keyboard-palette available as typed forms', () => {
  const view = fixtureView();
  view.workspace_actions_available = ['schedule_edit', 'wait_create', 'wait_resolve', 'wait_page'];
  view.workspace_views_available = ['waits'];
  const state = initialState(view);
  const commands = paletteCommands(view, state);
  for (const id of ['workspace:schedule', 'workspace:waits', 'workspace-action:schedule_edit', 'workspace-action:wait_create', 'workspace-action:wait_resolve', 'workspace-action:wait_page'])
    assert.equal(commands.find(command => command.id === id)?.disabled, false, `${id} is available`);

  const schedule = actionForm('schedule_edit', 'tui-104');
  assert.deepEqual(schedule.fields.map(field => [field.name, field.required]), [
    ['not_before', false], ['due', false], ['planned_start', false], ['planned_end', false],
  ]);
  assert.ok(schedule.fields.every(field => /YYYY-MM-DD/u.test(field.hint)));

  const create = actionForm('wait_create', 'tui-104');
  assert.equal(create.fields.find(field => field.name === 'affected_work_ids').value, '');
  assert.equal(create.fields.find(field => field.name === 'follow_up').required, false);
  assert.deepEqual(create.fields.find(field => field.name === 'category').choices, ['decision', 'approval', 'information', 'access', 'service', 'other']);
  assert.ok(!create.fields.some(field => /json/u.test(field.label)));

  const resolve = actionForm('wait_resolve');
  assert.deepEqual(resolve.fields.find(field => field.name === 'next_state').choices, ['resolved', 'cancelled']);
  const page = actionForm('wait_page');
  assert.deepEqual(page.fields.map(field => [field.name, field.required]), [
    ['limit', true], ['offset', true], ['expected_project_revision', false],
  ]);
  assert.ok(!resolve.fields.some(field => /json/u.test(field.label)));
});

const waitRecord = (wait_id, overrides = {}) => ({
  wait_id,
  source_work_id: 'source-1',
  affected_work_ids: ['tui-101', 'tui-104'],
  category: 'approval',
  reason: 'Vendor approval is required',
  accountable: { kind: 'person', reference: 'vendor:42', display_name: 'Avery Vendor' },
  expected_decision: 'Approve the release',
  expected_output: null,
  follow_up: local(2026, 10, 15),
  civil_time_setting_revision: 2,
  wait_revision: 3,
  state: 'open',
  created_by: 'operator-1',
  created_at_ms: 1791970000000,
  resolution: null,
  ...overrides,
});

test('wait inspection explains exactly which loaded dependents are blocked at matching revisions', () => {
  const view = fixtureView();
  const blocked = view.monitoring.items.find(item => item.work_id === 'tui-101');
  blocked.blocking_external_wait_ids = ['wait-vendor'];
  blocked.follow_up_due_wait_ids = ['wait-vendor'];
  const notBlocked = view.monitoring.items.find(item => item.work_id === 'tui-104');
  notBlocked.blocking_external_wait_ids = [];
  const text = formatWorkspaceView('waits', 'boreal-work', 248, '2026-10-14T10:00:00Z', {
    project_revision: 248,
    waits: [waitRecord('wait-vendor')],
  }, view.monitoring.items, 248);
  assert.match(text, /tui-101 · in_progress · service reports this wait is blocking/u);
  assert.match(text, /Follow-up is due according to the service/u);
  assert.match(text, /tui-104 · ready · service does not report this wait as currently blocking/u);
  assert.match(text, /Avery Vendor \(vendor:42\)/u);
  assert.match(text, /Follow-up 2026-10-15 \(civil date\)/u);
});

test('wait inspection with mismatched revisions avoids inferring blocked state and bounds display', () => {
  const view = fixtureView();
  view.monitoring.items.find(item => item.work_id === 'tui-101').blocking_external_wait_ids = ['wait-vendor'];
  const waits = Array.from({ length: 50 }, (_, index) => waitRecord(`wait-${index}`));
  const text = formatWorkspaceView('waits', 'boreal-work', 249, '2026-10-14T10:00:00Z', {
    project_revision: 249,
    total: 101,
    offset: 0,
    limit: 50,
    has_more: true,
    waits,
  }, view.monitoring.items, 248);
  assert.match(text, /does not match the loaded status revision 248/u);
  assert.match(text, /blocked status unavailable for this revision/u);
  assert.doesNotMatch(text, /service reports this wait is blocking/u);
  assert.match(text, /Showing 50 of 101 external waits · page offset 0 · limit 50/u);
  assert.match(text, /More waits are available from offset 50/u);
  assert.doesNotMatch(text, /wait-50 · open/u);
  const envelopeMismatch = formatWorkspaceView('waits', 'boreal-work', 250, '2026-10-14T10:00:00Z', {
    project_revision: 249, total: 1, offset: 0, limit: 50, has_more: false, waits: [waitRecord('wait-vendor')],
  }, view.monitoring.items, 249);
  assert.match(envelopeMismatch, /does not match the service envelope revision 250/u);
  assert.match(envelopeMismatch, /blocked status unavailable for this revision/u);
  assert.doesNotMatch(envelopeMismatch, /service reports this wait is blocking/u);
});

function decodeFrame(frame) {
  const length = new DataView(frame.buffer, frame.byteOffset, frame.byteLength).getUint32(0, false);
  return JSON.parse(new TextDecoder().decode(frame.slice(4, 4 + length)));
}

function encodeFrame(value) {
  const body = new TextEncoder().encode(JSON.stringify(value));
  const frame = new Uint8Array(4 + body.length);
  new DataView(frame.buffer).setUint32(0, body.length, false);
  frame.set(body, 4);
  return frame;
}

function appEnvelope(operationId, revision, outcome, data) {
  return {
    api_version: API_VERSION, schema_version: ENVELOPE_SCHEMA, operation_id: operationId,
    data: {
      api_version: API_VERSION, schema_version: ENVELOPE_SCHEMA, operation_id: operationId,
      revision, as_of: '2026-10-14T10:00:00Z', transport: 'ok', outcome, data, error: null,
    },
  };
}

function requestEnvelope(operationId, revision, data) {
  return {
    api_version: API_VERSION, schema_version: ENVELOPE_SCHEMA, operation_id: operationId,
    expected_revision: revision, attempt_id: null, attempt_fence: null, data,
  };
}

test('versioned client uses exact typed schedule and wait service commands', async () => {
  const calls = [];
  const currentWait = waitRecord('wait-vendor');
  const transport = {
    async roundTrip(frame) {
      const request = decodeFrame(frame);
      calls.push(request.data);
      let readback;
      let outcome = 'unchanged';
      let revision = 248;
      if (request.data.command === 'work_schedule_readback_v1') {
        readback = {
          schema_version: 'boreal.work_schedule_readback.v1', project_revision: 248,
          work_id: 'tui-104', schedule_revision: 2,
          schedule: { not_before: null, due: local(2026, 10, 15), planned_start: null, planned_end: null },
          legacy_due_at: null,
        };
      } else if (request.data.command === 'work_schedule_update_v1') {
        outcome = 'changed'; revision = 249;
        readback = {
          schema_version: 'boreal.work_schedule_readback.v1', operation_id: request.operation_id,
          replayed: false, project_revision: 249, work_id: 'tui-104', schedule_revision: 3,
          schedule: request.data.schedule_update.schedule,
        };
      } else if (request.data.command === 'external_wait_readback_v1') {
        readback = { schema_version: 'boreal.external_wait_readback.v1', project_revision: 248, waits: [currentWait] };
      } else if (request.data.command === 'external_wait_list_v1') {
        const waits = request.data.wait_list.offset === 0 ? [currentWait] : [];
        readback = { schema_version: 'boreal.external_wait_list_readback.v1', project_revision: 248,
          total: 1, offset: request.data.wait_list.offset, limit: request.data.wait_list.limit, has_more: false, waits };
      } else if (request.data.command === 'external_wait_create_v1') {
        outcome = 'changed'; revision = 249;
        readback = {
          schema_version: 'boreal.external_wait_readback.v1', operation_id: request.operation_id,
          replayed: false, project_revision: 249, wait: currentWait,
        };
      } else if (request.data.command === 'external_wait_resolve_v1') {
        outcome = 'changed'; revision = 249;
        readback = {
          schema_version: 'boreal.external_wait_readback.v1', operation_id: request.operation_id,
          replayed: false, project_revision: 249, wait: { ...currentWait, state: 'resolved', wait_revision: 4 },
        };
      } else throw new Error(`unexpected route ${request.data.command}`);
      return encodeFrame(appEnvelope(request.operation_id, revision, outcome, { readback }));
    },
  };
  const client = new VersionedServiceClient(transport, { project_id: 'boreal-work' });
  const schedule = await client.readWorkSchedule('boreal-work', 'tui-104');
  assert.equal(schedule.data.schedule_revision, 2);
  const updated = await client.updateWorkSchedule(requestEnvelope('op_schedule', 248, {
    project_id: 'boreal-work', work_id: 'tui-104',
    schedule_update: {
      schema_version: 'boreal.work_schedule_update.v1', expected_project_revision: 248,
      expected_schedule_revision: 2,
      schedule: { not_before: null, due: local(2026, 10, 16), planned_start: null, planned_end: null },
    },
  }));
  assert.equal(updated.data.schedule_revision, 3);
  assert.deepEqual(updated.data.schedule.due, local(2026, 10, 16));
  const listed = await client.readExternalWaits('boreal-work');
  assert.equal(listed.data.waits[0].wait_id, 'wait-vendor');
  const firstPage = await client.readExternalWaitPage('boreal-work', 25, 0, 248);
  assert.equal(firstPage.data.total, 1);
  assert.equal(firstPage.data.waits[0].wait_id, 'wait-vendor');
  const pastEndPage = await client.readExternalWaitPage('boreal-work', 25, 50, 248);
  assert.deepEqual(pastEndPage.data.waits, []);
  await client.readExternalWaits('boreal-work', 'wait-vendor');
  await client.createExternalWait(requestEnvelope('op_wait_create', 248, {
    project_id: 'boreal-work',
    wait_create: {
      schema_version: 'boreal.external_wait_create.v1', expected_project_revision: 248,
      expected_wait_revision: 0, wait_id: 'wait-new', source_work_id: 'tui-104',
      affected_work_ids: ['tui-101'], category: 'approval', reason: 'Approval needed',
      accountable: { kind: 'role', role: 'operator' }, expected_decision: null,
      expected_output: null, follow_up: null,
    },
  }));
  await client.resolveExternalWait(requestEnvelope('op_wait_resolve', 248, {
    project_id: 'boreal-work',
    wait_resolve: {
      schema_version: 'boreal.external_wait_resolve.v1', expected_project_revision: 248,
      expected_wait_revision: 3, wait_id: 'wait-vendor', next_state: 'resolved',
      outcome: 'approved', detail: 'Approved', output_ref: null,
      supplied_by: { kind: 'person', reference: 'vendor:42', display_name: 'Avery Vendor' },
    },
  }));
  assert.deepEqual(calls.map(call => call.command), [
    'work_schedule_readback_v1', 'work_schedule_update_v1', 'external_wait_readback_v1',
    'external_wait_list_v1', 'external_wait_list_v1', 'external_wait_readback_v1',
    'external_wait_create_v1', 'external_wait_resolve_v1',
  ]);
  assert.deepEqual(calls[1].schedule_update, {
    schema_version: 'boreal.work_schedule_update.v1', expected_project_revision: 248,
    expected_schedule_revision: 2,
    schedule: { not_before: null, due: local(2026, 10, 16), planned_start: null, planned_end: null },
  });
  assert.deepEqual(calls[3].wait_list, { schema_version: 'boreal.external_wait_list.v1', limit: 25, offset: 0, expected_project_revision: 248 });
  assert.equal(calls[5].wait_id, 'wait-vendor');
  assert.equal(calls[6].wait_create.expected_wait_revision, 0);
  assert.deepEqual(calls[6].wait_create.affected_work_ids, ['tui-101']);
  assert.equal(calls[7].wait_resolve.expected_wait_revision, 3);
});

test('keyboard forms inspect and submit schedules and externally resolved waits', async () => {
  class SchedulingController {
    data = fixtureView();
    calls = [];
    wait = waitRecord('wait-vendor');
    view() { return this.data; }
    navigate(route) {
      this.data.route = route;
      this.data.selected_work = this.data.monitoring.items.find(item => item.work_id === route.work_id) ?? null;
      return this.data;
    }
    async refresh() { return this.data; }
    async readWorkSchedule(workId) {
      return {
        api_version: API_VERSION, schema_version: ENVELOPE_SCHEMA, operation_id: 'op_schedule_read',
        revision: this.data.monitoring.revision, as_of: '2026-10-14T10:00:00Z', transport: 'ok', outcome: 'unchanged', error: null,
        data: { schema_version: 'boreal.work_schedule_readback.v1', project_revision: this.data.monitoring.revision,
          work_id: workId, schedule_revision: 7,
          schedule: { not_before: null, due: null, planned_start: null, planned_end: null }, legacy_due_at: null },
      };
    }
    async readProjectCivilTime() {
      return {
        api_version: API_VERSION, schema_version: ENVELOPE_SCHEMA, operation_id: 'op_civil_read',
        revision: this.data.monitoring.revision, as_of: '2026-10-14T10:00:00Z', transport: 'ok', outcome: 'unchanged', error: null,
        data: { schema_version: 'boreal.project_civil_time_readback.v1', project_revision: this.data.monitoring.revision,
          setting: { setting_revision: 1, timezone: 'America/Regina', tzdb_identity: 'tzdb:test', changed_by: 'operator', changed_at_ms: 1 } },
      };
    }
    async readExternalWaits(waitId) {
      this.calls.push(['readExternalWaits', waitId]);
      const waits = waitId ? (this.wait.wait_id === waitId ? [this.wait] : []) : [this.wait];
      return {
        api_version: API_VERSION, schema_version: ENVELOPE_SCHEMA, operation_id: 'op_wait_read',
        revision: this.data.monitoring.revision, as_of: '2026-10-14T10:00:00Z', transport: 'ok', outcome: 'unchanged', error: null,
        data: { schema_version: 'boreal.external_wait_readback.v1', project_revision: this.data.monitoring.revision, waits },
      };
    }
    async readExternalWaitPage(limit, offset, expectedRevision) {
      this.calls.push(['readExternalWaitPage', limit, offset, expectedRevision]);
      return {
        api_version: API_VERSION, schema_version: ENVELOPE_SCHEMA, operation_id: 'op_wait_page',
        revision: this.data.monitoring.revision, as_of: '2026-10-14T10:00:00Z', transport: 'ok', outcome: 'unchanged', error: null,
        data: { schema_version: 'boreal.external_wait_list_readback.v1', project_revision: this.data.monitoring.revision,
          total: 51, offset, limit, has_more: false, waits: [waitRecord('wait-page-50')] },
      };
    }
    mutationResult(action, data) {
      this.data.monitoring.revision += 1;
      const operation_id = `op_${action}_${this.data.monitoring.revision}`;
      return { ok: true, data, envelope: { operation_id, outcome: 'changed', revision: this.data.monitoring.revision } };
    }
    async updateWorkSchedule(workId, scheduleRevision, schedule) {
      this.calls.push(['updateWorkSchedule', workId, scheduleRevision, schedule]);
      const revision = this.data.monitoring.revision + 1;
      return this.mutationResult('schedule_update', {
        schema_version: 'boreal.work_schedule_readback.v1', operation_id: 'op_schedule_mutation', replayed: false,
        project_revision: revision, work_id: workId, schedule_revision: scheduleRevision + 1, schedule,
      });
    }
    async createExternalWait(input) {
      this.calls.push(['createExternalWait', input]);
      const revision = this.data.monitoring.revision + 1;
      this.wait = { ...waitRecord(input.wait_id, input), wait_revision: 1, state: 'open' };
      return this.mutationResult('wait_create', {
        schema_version: 'boreal.external_wait_readback.v1', operation_id: 'op_wait_create', replayed: false,
        project_revision: revision, wait: this.wait,
      });
    }
    async resolveExternalWait(input) {
      this.calls.push(['resolveExternalWait', input]);
      const revision = this.data.monitoring.revision + 1;
      this.wait = { ...this.wait, state: input.next_state, wait_revision: input.expected_wait_revision + 1,
        resolution: { outcome: input.outcome, detail: input.detail, output_ref: input.output_ref,
          supplied_by: input.supplied_by, recorded_by: 'operator', recorded_as: 'operator', recorded_at_ms: 1 } };
      return this.mutationResult('wait_resolve', {
        schema_version: 'boreal.external_wait_readback.v1', operation_id: 'op_wait_resolve', replayed: false,
        project_revision: revision, wait: this.wait,
      });
    }
    constructor() {
      this.data.workspace_actions_available = ['schedule_edit', 'wait_create', 'wait_resolve', 'wait_page'];
      this.data.workspace_views_available = ['waits'];
    }
  }

  const controller = new SchedulingController();
  const terminal = new FakeTerminal();
  terminal.size = { width: 160, height: 48 };
  const done = runFullScreen(controller, terminal, { auto_refresh_ms: 0, shutdown_drain_ms: 50 });
  try {
    await tick();
    terminal.send('pEdit work dates\r');
    await tick();
    terminal.send('2026-10-20\r\r\r\r');
    await tick();
    assert.match(terminal.text(), /Update business dates for tui-104/u);
    terminal.send('\x1b[F\r');
    await tick();
    const scheduleCall = controller.calls.find(call => call[0] === 'updateWorkSchedule');
    assert.ok(scheduleCall, 'schedule operation runs from the keyboard-confirmed form');
    assert.equal(scheduleCall[1], 'tui-104');
    assert.equal(scheduleCall[2], 7);
    assert.deepEqual(scheduleCall[3], { not_before: local(2026, 10, 20), due: null, planned_start: null, planned_end: null });

    terminal.send('pRecord external wait\r');
    terminal.send('\r\rNeed vendor approval\rtui-101\r\rvendor:42\rAvery Vendor\r\r\r\r\r');
    await tick();
    assert.match(terminal.text(), /Record external wait/u);
    terminal.send('\x1b[F\r');
    await tick();
    const createCall = controller.calls.find(call => call[0] === 'createExternalWait');
    assert.ok(createCall, 'external wait is created only after confirmation');
    assert.deepEqual(createCall[1].affected_work_ids, ['tui-101']);
    assert.equal(createCall[1].follow_up, null);
    assert.deepEqual(createCall[1].accountable, { kind: 'person', reference: 'vendor:42', display_name: 'Avery Vendor' });

    const createdWaitId = createCall[1].wait_id;
    terminal.send('pResolve external wait\r');
    terminal.send(`${createdWaitId}\r\r\rApproved by vendor\r\r\rvendor:42\rAvery Vendor\r\r`);
    await tick();
    assert.ok(controller.calls.some(call => call[0] === 'readExternalWaits' && call[1] === createdWaitId),
      'resolution checks the exact latest wait before confirming');
    assert.ok(terminal.text().includes(`Resolve external wait ${createdWaitId}`));
    terminal.send('\x1b[F\r');
    await tick();
    const resolveCall = controller.calls.find(call => call[0] === 'resolveExternalWait');
    assert.ok(resolveCall, 'external wait is resolved only after confirmation');
    assert.equal(resolveCall[1].expected_wait_revision, 1);
    assert.equal(resolveCall[1].next_state, 'resolved');
    assert.equal(resolveCall[1].outcome, 'decision_provided');

    terminal.send('pOpen external wait page\r');
    await tick();
    terminal.send('\r\r\r');
    await tick();
    assert.deepEqual(controller.calls.find(call => call[0] === 'readExternalWaitPage'),
      ['readExternalWaitPage', 50, 50, undefined]);
    assert.match(terminal.text(), /Showing 1 of 51 external waits · page offset 50 · limit 50/u);
  } finally {
    terminal.emit('SIGTERM');
    await done;
  }
});
