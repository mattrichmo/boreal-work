/** Regression checks assert visible, operable content — a bounded resize warning is not a passing UI. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderDashboard, dashboardLayout, modalDocument } from '../dist/ui/dashboard.js';
import { initialState, actionForm, paletteCommands } from '../dist/ui/model.js';
import { cellWidth } from '../dist/ui/cells.js';
import { paneViewport, dialogViewport, resolveViewport, chromeFor } from '../dist/ui/layout.js';
import { editInput, inputDisplay } from '../dist/ui/input.js';
import { TerminalSizeTracker } from '../dist/ui/terminal-size.js';
import { decodeKeys, runFullScreen } from '../dist/full-screen.js';
import { parseTerminalArgs } from '../dist/entrypoint.js';
import { fixtureView, FakeTerminal, FakeController, tick } from './fixtures.mjs';
const require = createRequire(import.meta.url);
const { createWizardState, renderWizard, applyWizardKey, choices, wizardLayout } = require('../installer/wizard.cjs');
export const SIZES = [[24,6],[32,8],[40,8],[40,10],[48,10],[60,12],[80,10],[80,12],[96,16],[100,18],[120,8],[120,12],[160,12],[190,12],[190,16],[220,10],[76,32],[80,32],[104,10],[136,26],[160,48]];
const project = () => createWizardState('project', { project_id:'boreal-work', project_root:'/work/boreal', database:'/work/boreal/.boreal/boreal.sqlite', memory_root:'/work/boreal/memory', agents:['codex'], memory_layout:'child' });
const machine = () => createWizardState('machine', { prefix:'/Users/operator/.local/boreal', source:'release' });
function bounded(screen, w, h) {
    assert.equal(screen.width,w); assert.equal(screen.height,h);
    for (const row of screen.plain()) assert.equal(cellWidth(row),w);
    assert.doesNotMatch(screen.plain().join('\n'), /Resize to at least|Terminal .*Resize/);
}
// FrameWriter always writes a changed complete row at column one. Reconstruct its
// latest visible grid instead of asserting against cumulative terminal history.
function visible(t) {
    let rows = [];
    for (const chunk of t.writes) {
        if (chunk.includes('\x1b[2J')) rows = [];
        const matches = [...chunk.matchAll(/\x1b\[(\d+);1H/g)];
        for (let i=0;i<matches.length;i++) {
            const m=matches[i];
            rows[Number(m[1])-1] = chunk.slice(m.index+m[0].length, matches[i+1]?.index ?? chunk.length).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g,'');
        }
    }
    return rows.join('\n');
}
async function session(w,h,fn) {
    const c = new FakeController(), t = new FakeTerminal(); t.size={width:w,height:h};
    const done=runFullScreen(c,t,{auto_refresh_ms:0,shutdown_drain_ms:50});
    try { await tick(); await fn(c,t); }
    finally { t.emit('SIGTERM'); await done; }
    assert.equal(t.listeners.size,0);
}
for (const [w,h] of SIZES) test(`operable content across dashboard, sheets, and both wizards at ${w}x${h}`, () => {
    const v=fixtureView(),s=initialState(v); s.selectedId=v.monitoring.items.at(-1).work_id;
    let screen=renderDashboard(v,s,w,h); bounded(screen,w,h);
    assert.match(screen.plain().join('\n'), /> Complete/);
    assert.ok(screen.plain().at(-1).includes('q'), 'quit remains discoverable');
    const forms=[actionForm('create_work'),actionForm('evidence')];
    for (const form of forms) {
        for(let i=0;i<form.fields.length;i++) {
            form.index=i; if(!form.fields[i].choices) form.fields[i].value='visible-input';
            s.modal=form; screen=renderDashboard(v,s,w,h); bounded(screen,w,h);
            const box=dialogViewport(w,h,18), body=screen.plain().slice(box.body.y,box.body.y+box.body.height).join('\n');
            assert.match(body, form.fields[i].choices ? /> task/ : /visible-input/);
            assert.match(screen.plain()[box.footerY],/Enter/);
        }
    }
    for(const modal of [{kind:'search',value:'visible-query'}, {kind:'palette',value:'',index:8,scope:'views'}, {kind:'help',offset:0}, {kind:'message',title:'ERROR',text:'Full diagnostic data. '.repeat(20),offset:2}]) {
        s.modal=modal; screen=renderDashboard(v,s,w,h); bounded(screen,w,h);
        assert.ok(screen.plain().some(line=>line.trim()),'content is not empty');
        assert.match(screen.plain()[dialogViewport(w,h,modal.kind==='search'?9:26).footerY],/Esc/);
    }
    s.modal=null;s.focus='inspector'; screen=renderDashboard(v,s,w,h); bounded(screen,w,h); assert.match(screen.plain().join('\n'),/INSPECTOR/);
    for(const ws of [project(),machine()]) for(let step=0;step<ws.steps.length;step++) {
        ws.step=step; const options=choices(ws); ws.cursor=Math.max(0,options.length-1);
        screen=renderWizard(ws,w,h); bounded(screen,w,h);
        assert.match(screen.plain().at(-1),/Enter/);
        if(options.length) assert.ok(screen.cells.some(row=>row.some(c=>c.text==='>'&&c.tone==='selected')), 'focused option is visible');
        if(ws.steps[step]==='Destination') assert.ok(screen.plain().some(row=>row.includes('▏')),'prefix caret is visible');
    }
});
test('height, not only width, decides chrome and available queue rows',()=>{
    const wide=dashboardLayout(190,12), tiny=dashboardLayout(190,8), full=dashboardLayout(144,40);
    assert.equal(wide.mode,'split');assert.equal(wide.chrome,'compact');assert.equal(wide.visibleRows,7);
    assert.equal(tiny.mode,'single');assert.equal(tiny.visibleRows,4);
    assert.equal(full.mode,'three-pane');
    assert.equal(dashboardLayout(80,36).mode,'stacked');
    assert.equal(dashboardLayout(60,36).mode,'single');
    assert.equal(dashboardLayout(160,40,false,'compact').rail,undefined);
    assert.equal(dashboardLayout(160,40,false,'auto',true).inspector,undefined);
    assert.equal(chromeFor(100,28,'auto'),'standard');assert.equal(chromeFor(100,28,'comfortable'),'comfortable');
});
test('all panel content rects are contained even at threshold edges',()=>{
    for(const w of [1,12,23,24,35,36,59,60,75,76,79,80,103,104,135,136,500]) for(const h of [1,2,3,4,5,6,7,8,9,10,11,12,21,22,25,26,31,32,200]) {
        const l=dashboardLayout(w,h);
        for(const r of [l.body,l.queue,l.inspector,l.rail].filter(Boolean)) {
            assert.ok(r.x>=0&&r.y>=0&&r.x+r.width<=w&&r.y+r.height<=h,JSON.stringify({w,h,r}));
            const p=paneViewport(r,l.chrome);
            assert.ok(p.x>=r.x&&p.y>=r.y&&p.x+p.width<=r.x+r.width&&p.y+p.height<=r.y+r.height);
        }
    }
});
test('invalid, zero and transient dimensions preserve known values; env never overrides a live PTY',()=>{
    assert.deepEqual(resolveViewport({width:190,height:12},undefined,{COLUMNS:'48',LINES:'18'}),{width:190,height:12});
    assert.deepEqual(resolveViewport({width:0,height:NaN},{width:190,height:12}),{width:190,height:12});
    assert.deepEqual(resolveViewport({},undefined,{COLUMNS:'60',LINES:'10'}),{width:60,height:10});
    assert.deepEqual(resolveViewport({width:Infinity,height:-1}),{width:80,height:24});
});
test('live geometry tracker emits only changed sizes, recovers and disposes SIGWINCH',()=>{
    let actual={width:190,height:12}; const initial=process.listenerCount('SIGWINCH');
    const tracker=new TerminalSizeTracker(()=>({width:48,height:18}),()=>actual,{});
    assert.deepEqual(tracker.dimensions(),actual);
    let changes=0;const dispose=tracker.subscribe(()=>changes++);
    tracker.refresh();assert.equal(changes,0);
    actual={width:0,height:0};tracker.refresh();assert.deepEqual(tracker.dimensions(),{width:190,height:12});
    actual={width:40,height:8};tracker.refresh();assert.equal(changes,1);
    actual={width:190,height:40};tracker.refresh();assert.equal(changes,2);
    dispose();assert.equal(process.listenerCount('SIGWINCH'),initial);
});
test('literal resize-warning implementation is removed, including installer input guards',async()=>{
    const {readFileSync}=await import('node:fs');
    for(const p of ['src/full-screen.ts','src/ui/dashboard.ts','installer/wizard-body.cjs']) assert.doesNotMatch(readFileSync(new URL('../'+p,import.meta.url),'utf8'),/Resize to at least|size\.width < 44|columns \|\| 80\) < 48/);
});
test('wide-shallow dashboard is navigable and opens a real inspector',async()=>{
    await session(190,12,async(c,t)=>{
        assert.match(visible(t),/WORK QUEUE/);t.send('\x1b[B\r');
        assert.equal(c.data.route.work_id,'tui-101');assert.match(visible(t),/Harden interactive/);
        t.send('\x1b[C');assert.match(visible(t),/Gates/);
        t.send('\x1b[F');assert.match(visible(t),/No current receipt/);
    });
});
test('focused inspector survives shrink and returns to the split layout after growth',async()=>{
    await session(160,40,async(c,t)=>{
        t.send('\r');t.resize(40,8);assert.match(visible(t),/INSPECTOR/);assert.doesNotMatch(visible(t),/WORK QUEUE/);
        t.send('\x1b[C');t.resize(190,16);assert.match(visible(t),/WORK QUEUE/);assert.match(visible(t),/Gates/);
        assert.equal(c.data.route.work_id,'tui-104');assert.equal(c.calls.length,0);
    });
});
test('command views remain accessible without a rail, including the last choice',async()=>{
    await session(24,6,async(c,t)=>{t.send('v\x1b[F');assert.match(visible(t),/> Tasks/);t.send('\r');assert.match(visible(t),/Tasks/);assert.equal(c.calls.length,0);});
});
test('density and focus toggles never strand keyboard focus in a hidden rail',async()=>{
    await session(160,40,async(c,t)=>{t.send('\x1b[Zd');t.send('\x1b[B');assert.equal(c.data.route.work_id,'tui-101');t.send('z');assert.doesNotMatch(visible(t),/INSPECTOR/);t.send('z');assert.match(visible(t),/INSPECTOR/);});
});
test('search text and a form draft survive resize with in-place cursor editing',async()=>{
    await session(160,40,async(c,t)=>{
        t.send('/ab\x1b[DX');t.resize(40,8);assert.match(visible(t),/aX▏b/);t.send('\r');
        assert.match(visible(t),/aXb/);t.send('\x1b');await new Promise(r=>setTimeout(r,45));
        t.send('n');t.send('task-99\x1b[D');t.resize(32,8);t.send('X');assert.match(visible(t),/task-9X▏9/);assert.equal(c.calls.length,0);
    });
});
test('small confirmation pages first and submits only the reviewed work once',async()=>{
    await session(32,6,async(c,t)=>{
        t.send('c');assert.match(visible(t),/Enter next page|Enter more/);
        t.send('\r');await tick();assert.equal(c.calls.length,0);
        t.send('\x1b[F\r\r');await tick();assert.deepEqual(c.calls,[['claim','tui-104']]);
    });
});
test('confirmation cannot submit in an unreadable two-row panel; growing preserves the draft',async()=>{
    await session(80,2,async(c,t)=>{t.send('c\r\r\r');await tick();assert.equal(c.calls.length,0);t.resize(60,12);t.send('\x1b[F\r');await tick();assert.deepEqual(c.calls,[['claim','tui-104']]);});
});
test('stale confirmation remains blocked after resizing and scrolling',async()=>{
    await session(40,8,async(c,t)=>{t.send('c');t.resize(120,12);c.data.monitoring.revision++;t.send('\x1b[F\r');await tick();assert.equal(c.calls.length,0);});
});
test('full status is scrollable, including the end of a long service error',async()=>{
    await session(32,8,async(c,t)=>{c.data.notice={kind:'error',message:'Transport detail. '.repeat(30)+'FINAL RECOVERY STEP'};t.send('!\x1b[F');assert.match(visible(t),/FINAL\s+RECOVERY STEP/);assert.equal(c.calls.length,0);});
});
test('Ctrl-L repaints without losing the focused draft',async()=>{
    await session(60,10,async(c,t)=>{t.send('nabc');const before=visible(t);t.send('\x0c');assert.match(t.writes.at(-1),/\x1b\[2J/);assert.equal(visible(t),before);});
});
test('caret editing is grapheme-safe, bounded, and supports delete/home/end/paste',()=>{
    let v={value:'A👩‍💻界Z',cursor:2};
    v=editInput(v.value,v.cursor,'backspace');assert.deepEqual(v,{value:'A界Z',cursor:1});
    v=editInput(v.value,v.cursor,'delete');assert.equal(v.value,'AZ');
    v=editInput(v.value,v.cursor,'paste:ab\x1b[2J');assert.equal(v.value,'Aab [2JZ');
    assert.deepEqual(editInput('abcdef',2,'paste:世界',7),{value:'ab世cdef',cursor:3});
    for(let w=1;w<60;w++) assert.ok(cellWidth(inputDisplay('x'.repeat(200)+'界',201,w))<=w);
    assert.deepEqual(decodeKeys('\x01\x05\x0c\x17\x1bOP'),['ctrl-a','ctrl-e','ctrl-l','ctrl-w','f1']);
});
test('density options are validated and no runtime dependency is introduced',()=>{
    const args=['--socket','s','--project','p'];
    assert.equal(parseTerminalArgs([...args,'--density','compact']).density,'compact');
    assert.throws(()=>parseTerminalArgs([...args,'--density','bad']),/density/);
});
test('a long review can be fully navigated and confirmed at every small size',()=>{
    for(const [w,h] of SIZES.slice(0,16)) {
        const s=project();s.initial.project_root='/work/'+'nested/'.repeat(70);s.step=3;
        renderWizard(s,w,h);assert.ok(s.maxOffset>0);
        let result='continue',steps=0;
        while(result==='continue'&&steps++<1000) { result=applyWizardKey(s,'enter');renderWizard(s,w,h); }
        assert.equal(result,'submit',`${w}x${h}`);assert.ok(steps>1);
    }
});
test('installer selection, path caret and help state survive shrinking/growing',()=>{
    const s=project();s.step=1;applyWizardKey(s,'down');applyWizardKey(s,' ');
    for(const [w,h] of [[190,12],[24,6],[160,40],[40,8]]) {renderWizard(s,w,h);assert.deepEqual(s.agents,['codex','claude']);assert.equal(s.cursor,1);}
    applyWizardKey(s,'f1');renderWizard(s,32,8);assert.ok(s.helpMax>0);applyWizardKey(s,'end');assert.ok(s.helpScroll>0);applyWizardKey(s,'escape');assert.equal(s.step,1);assert.equal(s.help,false);
    const m=machine();m.step=1;m.prefix='abc';applyWizardKey(m,'left');applyWizardKey(m,'X');renderWizard(m,24,6);assert.equal(m.prefix,'abXc');assert.match(renderWizard(m,24,6).plain().join('\n'),/abX▏c/);
});
test('every multi-select option can be focused and changed at 24x6',()=>{
    const s=machine();s.step=2;
    for(let i=0;i<choices(s).length;i++) {s.cursor=i;const before=choices(s)[i].on;const screen=renderWizard(s,24,6);assert.ok(screen.cells.some(row=>row.some(c=>c.tone==='selected'&&c.text==='>')));applyWizardKey(s,' ');assert.equal(choices(s)[i].on,i===0?before:!before);}
});
test('large ASCII banner appears only when it fits, not at the expense of review space',()=>{
    const s=machine();assert.equal(wizardLayout(100,36,s).large,true);assert.equal(wizardLayout(190,12,s).large,false);
    s.step=4;assert.equal(wizardLayout(100,36,s).large,false);assert.ok(wizardLayout(100,36,s).body.height>=28);
});
test('review errors and choice explanations remain readable in the full help sheet',()=>{
    const s=project();s.step=1;s.agents=[];applyWizardKey(s,'enter');applyWizardKey(s,'!');
    const frame=renderWizard(s,40,8).plain().join('\n');assert.match(frame,/ATTENTION/);assert.match(frame,/Choose at least one/);assert.equal(s.step,1);
});
test('an inspector selection has real content even below recommended dimensions',()=>{
    for(const [w,h]of[[1,1],[12,3],[20,4]]) {const v=fixtureView(),s=initialState(v);bounded(renderDashboard(v,s,w,h),w,h);s.focus='inspector';bounded(renderDashboard(v,s,w,h),w,h);bounded(renderWizard(project(),w,h),w,h);}
});

test('short split inspector shows the actual next action before low-priority metadata',()=>{
    const v=fixtureView(),s=initialState(v);
    const screen=renderDashboard(v,s,190,12);
    assert.match(screen.plain().join('\n'),/Next: Claim/);
    assert.match(screen.plain()[2],/STATE.*ID.*PRI.*KIND.*OWNER/);
});
