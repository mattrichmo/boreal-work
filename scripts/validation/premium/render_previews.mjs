#!/usr/bin/env node
/** Export the actual cell renderer, not a separate visual mockup. Fixture data only. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { fixtureView } from '../../../apps/tui/tests/fixtures.mjs';
import { initialState, actionForm } from '../../../apps/tui/dist/ui/model.js';
import { renderDashboard } from '../../../apps/tui/dist/ui/dashboard.js';
const require = createRequire(import.meta.url);
const { createWizardState, renderWizard } = require('../../../apps/tui/installer/wizard.cjs');
const dest = resolve(process.argv[2] ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../../premium-previews'));
mkdirSync(dest, { recursive: true });
function save(name, screen, caption) {
    writeFileSync(resolve(dest, name + '.txt'), caption + '\n\n' + screen.plain().join('\n') + '\n');
    writeFileSync(resolve(dest, name + '.ansi'), screen.ansi().join('\r\n') + '\r\n');
    writeFileSync(resolve(dest, name + '.cells.json'), JSON.stringify({ caption, width: screen.width, height: screen.height, cells: screen.cells }));
}
const view = fixtureView(), state = initialState(view);
save('01-dashboard-wide', renderDashboard(view, state, 144, 40), 'BOREAL WORK — actual renderer · demonstration fixture · 144×40 cells');
save('02-dashboard-compact', renderDashboard(view, state, 80, 24), 'BOREAL WORK — actual renderer · demonstration fixture · 80×24 cells');
state.modal = { kind: 'palette', value: '', index: 15 };
save('03-command-palette', renderDashboard(view, state, 132, 40), 'BOREAL WORK — actual renderer · command palette · 132×40 cells');
state.modal = actionForm('create_work');
state.modal.fields[0].value = 'task-105';
state.modal.index = 1;
save('04-create-work', renderDashboard(view, state, 100, 32), 'BOREAL WORK — actual renderer · create-work choice · 100×32 cells');
const machine = createWizardState('machine', { prefix: '/home/operator/.local/boreal-v2', source: 'release', dashboard: true, verify: true });
save('05-installer-welcome', renderWizard(machine, 100, 36), 'BOREAL WORK — actual renderer · machine installer · 100×36 cells');
machine.step = 2;
machine.cursor = 1;
save('06-installer-components', renderWizard(machine, 100, 36), 'BOREAL WORK — actual renderer · component multi-select · 100×36 cells');
const project = createWizardState('project', { project_id: 'boreal-work', project_root: '/workspace/boreal-work', database: '/workspace/boreal-work/.boreal/boreal.sqlite', memory_root: '/workspace/boreal-work/memory', agents: ['codex', 'claude'], memory_layout: 'child' });
project.step = 1;
project.cursor = 1;
save('07-project-agent-tools', renderWizard(project, 100, 36), 'BOREAL WORK — actual renderer · project agent multi-select · 100×36 cells');
project.step = 3;
project.cursor = 0;
save('08-project-review', renderWizard(project, 100, 36), 'BOREAL WORK — actual renderer · final setup review · 100×36 cells');
console.log('Actual renderer previews written to ' + dest);
