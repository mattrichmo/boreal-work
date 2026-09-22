# R-TUI-TEST — apps/tui/tests/m02-contract.test.mjs

**Evidence class:** verbatim source-navigation excerpt from the supplied fresh ZIP, not runtime validation.  
**Source:** `apps/tui/tests/m02-contract.test.mjs:L1–L63`  
**File SHA-256:** `88ecb415061cb4ecb5521c20b4b17e60c613f4cee113f08604181bba44ac0931`  
**Archive SHA-256:** `09d72813db6b68728f567b14132454fb24fee289747cf9ca799830c9ee749d8c`

## Why this context matters

Existing presentation compatibility tests, not genuine lifecycle evidence.

## What the implementing agent must do

Load the current file at the dispatched source revision, the complete enclosing functions/types and relevant tests—not only this historical excerpt. Line numbers refer to the supplied baseline; later tasks may move code. Use symbols/content to relocate the section, read accepted upstream handoffs, and report conflicting contracts rather than choosing a convenient implementation. A `proposed_new` output in a task card does not exist in this baseline.

```sh
sed -n '1,63p' 'apps/tui/tests/m02-contract.test.mjs'
```

## Exact baseline excerpt

````text
    1 | /** Unit protocol/presentation vectors, not service E2E or release evidence. */
    2 | import test from 'node:test';
    3 | import assert from 'node:assert/strict';
    4 | import { actionAvailability, buildMonitoringModel } from '../dist/client.js';
    5 | import { detailLines, renderDashboard } from '../dist/ui/dashboard.js';
    6 | import { initialState } from '../dist/ui/model.js';
    7 | import { cellWidth } from '../dist/ui/cells.js';
    8 | import { fixtureView } from './fixtures.mjs';
    9 | 
   10 | function status(primary = 'paused') {
   11 |   return {
   12 |     api_version: '2', schema_version: 'boreal.protocol.envelope.v1',
   13 |     operation_id: 'op_unit_status', revision: 17, as_of: 'unix-ms:10',
   14 |     transport: 'ok', outcome: 'unchanged', error: null,
   15 |     data: { project_id: 'unit-test', revision: 17, total: 1, items: [{
   16 |       work_id: 'task', status: 'paused', claimable: false, next_action: 'resume_policy',
   17 |       primary_reason: primary, reason_codes: ['paused', 'prerequisite_open(upstream)'],
   18 |     }] },
   19 |   };
   20 | }
   21 | 
   22 | test('M02 primary reason and all secondary reasons survive service decoding', () => {
   23 |   const item = buildMonitoringModel(status()).items[0];
   24 |   assert.equal(item.primary_reason, 'paused');
   25 |   assert.deepEqual(item.reason_codes, ['paused', 'prerequisite_open(upstream)']);
   26 |   assert.equal(item.claimable, false);
   27 |   assert.equal(item.status, 'paused');
   28 | });
   29 | 
   30 | test('older service responses remain readable without a primary field', () => {
   31 |   const envelope = status();
   32 |   delete envelope.data.items[0].primary_reason;
   33 |   assert.equal(buildMonitoringModel(envelope).items[0].primary_reason, undefined);
   34 | });
   35 | 
   36 | test('contradictory primary reason is rejected, not locally repaired', () => {
   37 |   assert.throws(() => buildMonitoringModel(status('eligible')), /primary_reason/);
   38 | });
   39 | 
   40 | test('M02 reason detail stays bounded at required terminal sizes', () => {
   41 |   const view = fixtureView();
   42 |   const item = { ...view.monitoring.items[0], ...buildMonitoringModel(status()).items[0] };
   43 |   view.monitoring.items = [item];
   44 |   view.selected_work = item;
   45 |   const text = detailLines(item, view, 0, 60).map(line => line.text).join('\n');
   46 |   assert.match(text, /Primary: Paused/);
   47 |   assert.match(text, /upstream/);
   48 |   for (const [width, height] of [[80, 24], [100, 32], [144, 40], [44, 12]]) {
   49 |     const screen = renderDashboard(view, initialState(view), width, height);
   50 |     assert.equal(screen.plain().length, height);
   51 |     assert.ok(screen.plain().every(line => cellWidth(line) === width));
   52 |   }
   53 | });
   54 | 
   55 | test('a degraded row has one selectable identity and no mutation actions', () => {
   56 |   const envelope = status();
   57 |   envelope.data.diagnostics = [{ work_id: 'task', code: 'invalid_parent', detail: 'Parent unavailable.' }];
   58 |   const model = buildMonitoringModel(envelope);
   59 |   assert.equal(model.items.length, 1);
   60 |   assert.equal(model.items[0].diagnostic.code, 'invalid_parent');
   61 |   assert.deepEqual(model.items[0].reason_codes, ['paused', 'prerequisite_open(upstream)']);
   62 |   assert.ok(actionAvailability(model.items[0]).every(action => !action.enabled));
   63 | });
````
