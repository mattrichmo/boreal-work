import test from 'node:test';
import assert from 'node:assert/strict';
import {
  API_VERSION,
  ENVELOPE_SCHEMA,
  VersionedServiceClient,
} from '../dist/client.js';
import { actionForm, initialState, paletteCommands } from '../dist/ui/model.js';
import { formatWorkspaceView } from '../dist/ui/workspace-view.js';
import { fixtureView } from './fixtures.mjs';

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
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id: operationId,
    data: {
      api_version: API_VERSION,
      schema_version: ENVELOPE_SCHEMA,
      operation_id: operationId,
      revision,
      as_of: '2026-10-14T10:00:00Z',
      transport: 'ok',
      outcome,
      data,
      error: null,
    },
  };
}

function requestEnvelope(operation_id, expected_revision, data) {
  return {
    api_version: API_VERSION,
    schema_version: ENVELOPE_SCHEMA,
    operation_id,
    expected_revision,
    attempt_id: null,
    attempt_fence: null,
    data,
  };
}

const intakeItem = {
  project_id: 'boreal-work',
  intake_id: 'intake-1',
  bucket_id: 'inbox',
  kind: 'question',
  lifecycle: 'captured',
  content: 'Which acceptance criteria apply?',
  content_revision: 2,
  content_digest: `sha256:${'a'.repeat(64)}`,
  captured_at: '2026-10-14T09:00:00Z',
  updated_at: '2026-10-14T09:00:00Z',
  revisit_at_utc_ms: null,
};

test('intake inbox and actions are available through typed dashboard forms', () => {
  const view = fixtureView();
  view.workspace_actions_available = ['intake_page', 'intake_disposition', 'intake_promote'];
  view.workspace_views_available = ['intake'];
  const commands = paletteCommands(view, initialState(view));
  for (const id of [
    'workspace:intake',
    'workspace-action:intake_page',
    'workspace-action:intake_disposition',
    'workspace-action:intake_promote',
  ]) assert.equal(commands.find(command => command.id === id)?.disabled, false, `${id} is enabled`);

  assert.deepEqual(actionForm('intake_page').fields.map(field => [field.name, field.value]), [
    ['limit', '50'], ['offset', '0'],
  ]);
  assert.deepEqual(actionForm('intake_disposition').fields.find(field => field.name === 'lifecycle').choices,
    ['triaged', 'deferred', 'resolved', 'archived']);
  assert.deepEqual(actionForm('intake_promote').fields.find(field => field.name === 'target_kind').choices,
    ['draft_work', 'source_version', 'memory_draft']);
});

test('intake view shows lifecycle, content revision, pagination, and content', () => {
  const text = formatWorkspaceView('intake', 'boreal-work', 44, '2026-10-14T10:00:00Z', {
    project_id: 'boreal-work', project_revision: 44, total: 27, offset: 12, limit: 12, has_more: true,
    items: [{ ...intakeItem, lifecycle: 'deferred', revisit_at_utc_ms: 1791970000000 }],
  });
  assert.match(text, /1 shown of 27 · offset 12 · page size 12/u);
  assert.match(text, /More available · open Intake page at offset 13\./u);
  assert.match(text, /intake-1 · question · deferred/u);
  assert.match(text, /content revision 2/u);
  assert.match(text, /Which acceptance criteria apply\?/u);
  assert.match(text, /Revisit 2026-10-14T/u);
});

test('versioned intake client sends paged reads and revision-bound mutations', async () => {
  const calls = [];
  const transport = {
    async roundTrip(frame) {
      const request = decodeFrame(frame);
      calls.push(request.data);
      const command = request.data.command;
      let readback;
      let outcome = 'unchanged';
      let revision = 44;
      if (command === 'intake_list_v1') {
        const offset = request.data.intake_list.offset;
        readback = {
          schema_version: 'boreal.intake_list_readback.v1', project_id: 'boreal-work',
          project_revision: 44, total: 25, offset, limit: 12, has_more: offset === 12,
          items: offset >= 25 ? [] : [intakeItem],
        };
      } else if (command === 'intake_disposition_v1') {
        outcome = 'changed'; revision = 45;
        readback = {
          schema_version: 'boreal.intake_disposition_readback.v1', project_id: 'boreal-work',
          intake_id: 'intake-1', lifecycle: 'triaged', content_revision: 2,
          revisit_at_utc_ms: null, replayed: false,
        };
      } else if (command === 'intake_promote_v1') {
        outcome = 'changed'; revision = 46;
        readback = {
          schema_version: 'boreal.intake_promote_readback.v1', project_id: 'boreal-work',
          intake_id: 'intake-1', promotion_id: 'op_intake_promote', target_kind: 'draft_work',
          target_id: 'task-1', content_revision: 2, replayed: false,
        };
      } else throw new Error(`unexpected route ${command}`);
      return encodeFrame(appEnvelope(request.operation_id, revision, outcome, { readback }));
    },
  };
  const client = new VersionedServiceClient(transport, { project_id: 'boreal-work' });
  const page = await client.readIntake('boreal-work', 12, 12);
  assert.equal(page.data.items[0].intake_id, 'intake-1');
  assert.deepEqual(calls[0].intake_list, { schema_version: 'boreal.intake_list.v1', limit: 12, offset: 12 });
  const pastEnd = await client.readIntake('boreal-work', 12, 50);
  assert.equal(pastEnd.data.items.length, 0);

  const disposition = await client.updateIntakeDisposition(requestEnvelope('op_intake_disposition', 44, {
    project_id: 'boreal-work',
    disposition: {
      schema_version: 'boreal.intake_disposition.v1', expected_project_revision: 44,
      expected_content_revision: 2, intake_id: 'intake-1', lifecycle: 'triaged', revisit_at_utc_ms: null,
    },
  }));
  assert.equal(disposition.data.lifecycle, 'triaged');
  assert.equal(calls[2].disposition.expected_project_revision, 44);

  const promotion = await client.promoteIntake(requestEnvelope('op_intake_promote', 45, {
    project_id: 'boreal-work',
    promotion: {
      schema_version: 'boreal.intake_promote.v1', expected_project_revision: 45,
      expected_content_revision: 2, intake_id: 'intake-1', target_kind: 'draft_work', target_id: 'task-1',
    },
  }));
  assert.equal(promotion.data.target_id, 'task-1');
  assert.equal(calls[3].promotion.expected_content_revision, 2);
});
