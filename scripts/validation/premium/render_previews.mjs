#!/usr/bin/env node
/** Actual cell renderer output, using explicitly labelled fixture data. No visual mocks. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fixtureView } from '../../../apps/tui/tests/fixtures.mjs';
import { initialState, actionForm } from '../../../apps/tui/dist/ui/model.js';
import { renderDashboard } from '../../../apps/tui/dist/ui/dashboard.js';
const require = createRequire(import.meta.url);
const { createWizardState, renderWizard } = require('../../../apps/tui/installer/wizard.cjs');
const dest = resolve(process.argv[2] ?? 'responsive-previews');
mkdirSync(dest, { recursive: true });
const index=[];
function save(name, screen, description, theme='dark') {
    const caption=`BOREAL WORK / ${description} / ${screen.width}×${screen.height} cells / fixture data`;
    writeFileSync(resolve(dest, name + '.txt'), caption + '\n\n' + screen.plain().join('\n') + '\n');
    writeFileSync(resolve(dest, name + '.ansi'), screen.ansi(theme).join('\r\n') + '\r\n');
    writeFileSync(resolve(dest, name + '.cells.json'), JSON.stringify({ caption, description, theme, width: screen.width, height: screen.height, cells: screen.cells }));
    index.push({name,description,width:screen.width,height:screen.height,theme});
}
const view = fixtureView();
function dashboard(name,w,h,description,customize=()=>{},theme='dark') {
    const state=initialState(view,theme);customize(state);
    save(name,renderDashboard(view,state,w,h),description,theme);
}
dashboard('01-editor-wide-shallow',190,12,'wide editor panel / split');
dashboard('02-editor-compact',80,12,'short editor panel / queue');
dashboard('03-narrow-split',40,8,'narrow split / micro queue');
dashboard('04-narrow-inspector',40,8,'narrow split / full-view inspector',s=>{s.focus='inspector';s.inspectorTab=1;});
dashboard('05-tall-stacked',80,36,'tall workspace / stacked inspector');
dashboard('06-full-workspace',160,40,'roomy workspace / three panes');
dashboard('07-small-form',40,8,'compact create form / editable caret',s=>{s.modal=actionForm('create_work');s.modal.index=2;s.modal.fields[2].value='Ship a responsive terminal workspace';s.modal.fields[2].cursor=20;});
dashboard('08-micro-view-picker',24,6,'micro panel / view picker',s=>{s.modal={kind:'palette',scope:'views',value:'',index:8};});
dashboard('09-light-compact',104,12,'light terminal / split',()=>{},'light');
dashboard('10-mono-focus',80,12,'monochrome terminal / focused queue',s=>{s.zen=true;s.density='compact';s.ascii=true;},'mono');
const machine = createWizardState('machine', { prefix: '/home/operator/.local/boreal-v2', source: 'release', dashboard: true, verify: true });
save('11-installer-welcome',renderWizard(machine,100,36),'machine installer / full-size welcome');
machine.step=2;machine.cursor=1;
save('12-installer-editor-panel',renderWizard(machine,190,12),'machine installer / short editor panel');
save('13-installer-narrow',renderWizard(machine,40,8),'machine installer / narrow multi-select');
const project = createWizardState('project', { project_id:'boreal-work',project_root:'/workspace/boreal-work',database:'/workspace/boreal-work/.boreal/boreal.sqlite',memory_root:'/workspace/boreal-work/memory',agents:['codex','claude'],memory_layout:'child' });
project.step=1;project.cursor=1;
save('14-project-wide-shallow',renderWizard(project,160,16),'project setup / agent multi-select');
project.step=3;project.cursor=0;
save('15-project-review-small',renderWizard(project,40,8),'project setup / paged review');
renderWizard(project,40,8);project.scroll=project.maxOffset;
save('16-project-review-end',renderWizard(project,40,8),'project setup / final review page');
writeFileSync(resolve(dest,'index.json'),JSON.stringify(index,null,2)+'\n');
console.log(`Wrote ${index.length} actual-renderer previews to ${dest}`);
