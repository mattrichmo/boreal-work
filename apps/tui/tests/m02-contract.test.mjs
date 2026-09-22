/** Unit protocol/presentation vectors, not service E2E or release evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { actionAvailability, buildMonitoringModel } from '../dist/client.js';
import { detailLines, renderDashboard } from '../dist/ui/dashboard.js';
import { initialState } from '../dist/ui/model.js';
import { cellWidth } from '../dist/ui/cells.js';
import { fixtureView } from './fixtures.mjs';

function status(primary = 'paused') {
  return {
    api_version: '2', schema_version: 'boreal.protocol.envelope.v1',
    operation_id: 'op_unit_status', revision: 17, as_of: 'unix-ms:10',
    transport: 'ok', outcome: 'unchanged', error: null,
    data: { project_id: 'unit-test', revision: 17, total: 1, items: [{
      work_id: 'task', status: 'paused', claimable: false, next_action: 'resume_policy',
      primary_reason: primary, reason_codes: ['paused', 'prerequisite_open(upstream)'],
    }] },
  };
}

test('M02 primary reason and all secondary reasons survive service decoding', () => {
  const item = buildMonitoringModel(status()).items[0];
  assert.equal(item.primary_reason, 'paused');
  assert.deepEqual(item.reason_codes, ['paused', 'prerequisite_open(upstream)']);
  assert.equal(item.claimable, false);
  assert.equal(item.status, 'paused');
});

test('older service responses remain readable without a primary field', () => {
  const envelope = status();
  delete envelope.data.items[0].primary_reason;
  assert.equal(buildMonitoringModel(envelope).items[0].primary_reason, undefined);
});

test('contradictory primary reason is rejected, not locally repaired', () => {
  assert.throws(() => buildMonitoringModel(status('eligible')), /primary_reason/);
});

test('M02 reason detail stays bounded at required terminal sizes', () => {
  const view = fixtureView();
  const item = { ...view.monitoring.items[0], ...buildMonitoringModel(status()).items[0] };
  view.monitoring.items = [item];
  view.selected_work = item;
  const text = detailLines(item, view, 0, 60).map(line => line.text).join('\n');
  assert.match(text, /Primary: Paused/);
  assert.match(text, /upstream/);
  for (const [width, height] of [[80, 24], [100, 32], [144, 40], [44, 12]]) {
    const screen = renderDashboard(view, initialState(view), width, height);
    assert.equal(screen.plain().length, height);
    assert.ok(screen.plain().every(line => cellWidth(line) === width));
  }
});

test('a degraded row has one selectable identity and no mutation actions', () => {
  const envelope = status();
  envelope.data.diagnostics = [{ work_id: 'task', code: 'invalid_parent', detail: 'Parent unavailable.' }];
  const model = buildMonitoringModel(envelope);
  assert.equal(model.items.length, 1);
  assert.equal(model.items[0].diagnostic.code, 'invalid_parent');
  assert.deepEqual(model.items[0].reason_codes, ['paused', 'prerequisite_open(upstream)']);
  assert.ok(actionAvailability(model.items[0]).every(action => !action.enabled));
});
