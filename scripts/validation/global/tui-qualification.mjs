#!/usr/bin/env node
/** Real-service qualification for the global TUI's richer daily-use fixtures. */
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {resolve,dirname} from 'node:path';
const args=process.argv.slice(2);const socket=args[args.indexOf('--socket')+1];const entry=resolve(args[args.indexOf('--entrypoint')+1]??'apps/global-tui/dist/entrypoint.js');
const moduleAt=name=>import(pathToFileURL(resolve(dirname(entry),name)).href);
const [{GlobalServiceClient},{GlobalController},{render},{cellWidth},{runInteractive}]=await Promise.all([moduleAt('client.js'),moduleAt('model.js'),moduleAt('view.js'),moduleAt('terminal/cells.js'),moduleAt('interaction.js')]);
const client=new GlobalServiceClient(socket,15000);const c=new GlobalController(client);await c.refresh();
assert.ok(c.snapshot.items.length>=60);assert.ok(c.projects.length>=12);
const life=c.projects.find(p=>p.name.startsWith('Life'));const business=c.projects.find(p=>p.name==='Business launch');
const sizes=[[36,12],[52,16],[80,24],[100,28],[140,36]];
function frame(){for(const [w,h]of sizes){const output=render(c,w,h);assert.ok(output.split('\n').length<=h,`${c.route}: height ${w}x${h}`);assert.ok(output.split('\n').every(line=>cellWidth(line)<=w),`${c.route}: cell width ${w}x${h}`);}}
c.setScope(life.id);c.setRoute('board');assert.ok(c.boardStatuses.length>=8);
for(let column=0;column<c.boardStatuses.length;column++){
 c.moveBoardColumn(column-c.boardColumn);const cards=c.boardCards();
 if(cards.length){c.selectId(cards.at(-1).id);assert.equal(c.selectedRow().id,c.boardSelected.id);for(const[w,h]of sizes){const output=render(c,w,h);assert.ok(output.includes(c.boardSelected.title.split(' ')[0]),`hidden board card at ${w}x${h}: ${c.boardSelected.title}`);}}
 frame();
}
for(const route of ['list','todos','planning','projects','overview','notes','archive','history','inbox','links']){
 c.setScope(route==='links'?business.id:undefined);c.setRoute(route);
 const rows=c.rows();if(rows.length)c.selectId(rows.at(-1).id);frame();
 if(['list','projects'].includes(route)&&rows.length){const row=c.selectedRow();const title=row.title??row.name;for(const[w,h]of sizes){assert.ok(render(c,w,h).includes(title.split(' ')[0]),`hidden ${route} selected row at ${w}x${h}: ${title}`);}}
}
c.setScope();c.setRoute('inbox');assert.ok(c.rows().some(i=>i.title==='Personal inbox capture'));
c.setScope(business.id);c.setRoute('links');assert.equal(c.rows().filter(a=>a.kind==='workspace').length,2);
for(const a of c.rows()){const detail=await client.linkedShow(a.project_id,a.identity);assert.equal(detail.availability,'available');assert.ok(detail.items?.some(i=>i.title.startsWith('Build component')));}
const history=await client.history({limit:200});assert.ok(history.events?.length);assert.ok(history.events.some(e=>e.command==='todo archive'));
// Keyboard events here drive actual versioned service mutations.
c.setScope(life.id);c.setRoute('list');let listener;let latest='';let raw=false;
const terminal={isTty:true,dimensions:()=>({width:80,height:24}),write:v=>{latest=v},setRawMode:v=>{raw=v},onData:fn=>{listener=fn;return()=>{listener=undefined}},onSignal:()=>()=>{}};
const running=runInteractive(c,terminal);
const wait=async pred=>{const deadline=Date.now()+10000;while(!pred()){if(Date.now()>deadline)throw new Error(`TUI state timed out. Last frame: ${latest}`);await new Promise(r=>setTimeout(r,20));}};
try{
 await wait(()=>!!listener);listener('?');assert.match(latest,/help/i);listener('\x1b');await new Promise(r=>setTimeout(r,60));
 const before=c.snapshot.revision;listener('\x1b[200~a\x1b[201~');await new Promise(r=>setTimeout(r,100));assert.equal(c.snapshot.revision,before,'paste triggered an action');
 const captureTitle=`Real-${Date.now()} Café 家, errands`;
 listener('n');listener(captureTitle+'\r');await wait(()=>c.snapshot.items.some(i=>i.title===captureTitle));await new Promise(r=>setTimeout(r,80));
 const created=c.snapshot.items.find(i=>i.title===captureTitle);c.selectId(created.id);
 listener('c');await wait(()=>c.snapshot.items.find(i=>i.id===created.id)?.status_id==='done');await new Promise(r=>setTimeout(r,80));
 listener('o');await wait(()=>c.snapshot.items.find(i=>i.id===created.id)?.status_id==='todo');await new Promise(r=>setTimeout(r,80));
 listener('a');await wait(()=>c.snapshot.items.find(i=>i.id===created.id)?.archived===true);await new Promise(r=>setTimeout(r,80));
 c.setRoute('archive');c.selectId(created.id);listener('u');await wait(()=>c.snapshot.items.find(i=>i.id===created.id)?.archived===false);await new Promise(r=>setTimeout(r,80));
 c.setRoute('board');const todoColumn=c.boardStatuses.findIndex(s=>s.status_id==='todo');c.moveBoardColumn(todoColumn-c.boardColumn);const first=c.boardCards()[0];c.selectId(first.id);const rev=c.snapshot.revision;listener(']');await wait(()=>c.snapshot.revision>rev);await new Promise(r=>setTimeout(r,80));assert.equal(c.boardCards()[1].id,first.id,'atomic reorder did not change visible card order');
 c.setScope();c.setRoute('history');listener('\r');await wait(()=>latest.includes('1–50'));await new Promise(r=>setTimeout(r,80));listener('\x1b[C');await wait(()=>latest.includes('51–100'));listener('\x1b');await new Promise(r=>setTimeout(r,80));
 listener('q');await running;assert.equal(raw,false);
 console.log('PASS real global TUI: 60+ items, 12 projects, 10 statuses, five viewport sizes, visible board/list selection, inbox, history, two linked work drilldowns, Unicode quick capture, paste safety, complete/reopen/archive/restore, atomic visible reorder, older history pagination and terminal cleanup');
}finally{listener?.('\x03');await running;}
