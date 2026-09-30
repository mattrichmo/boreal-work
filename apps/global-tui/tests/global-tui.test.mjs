import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GlobalProtocolError, GlobalServiceClient } from "../dist/client.js";
import { GlobalController, render, runInteractive, validateSnapshot } from "../dist/interface.js";
import { parseArgs } from "../dist/entrypoint.js";

const snapshot = {
  schema_version: 2, revision: 12,
  projects: [{ id:"life",name:"Life",description:"",archived:false,created_at:"now",updated_at:"now" }],
  items: [
    { id:"errand",project_id:"life",parent_id:null,kind:"task",title:"Pick up groceries",description:"",status_id:"inbox",priority:null,due_at:null,archived:false,position:0,created_at:"now",updated_at:"now" },
    { id:"done",project_id:"life",parent_id:null,kind:"task",title:"Finished",description:"",status_id:"done",priority:null,due_at:null,archived:false,position:1,created_at:"now",updated_at:"now" },
    { id:"cancelled",project_id:"life",parent_id:null,kind:"task",title:"Cancelled",description:"",status_id:"cancelled",priority:null,due_at:null,archived:false,position:2,created_at:"now",updated_at:"now" },
  ], notes:[], statuses:[
    {project_id:"life",status_id:"inbox",label:"Inbox",category:"open",position:0},
    {project_id:"life",status_id:"done",label:"Done",category:"completed",position:1},
    {project_id:"life",status_id:"cancelled",label:"Cancelled",category:"cancelled",position:2},
  ], relationships:[], associations:[]
};

function encode(value) { const payload=Buffer.from(JSON.stringify(value)); const head=Buffer.alloc(4); head.writeUInt32BE(payload.length); return Buffer.concat([head,payload]); }
async function socketFixture(handler) {
  const dir=await mkdtemp(join(tmpdir(),"global-tui-")); const path=join(dir,"service.sock");
  const server=createServer(socket=>{
    let bytes=Buffer.alloc(0);
    socket.on("data",chunk=>{
      bytes=Buffer.concat([bytes,chunk]); if(bytes.length<4)return;
      const n=bytes.readUInt32BE(); if(bytes.length<n+4)return;
      let req; try{req=JSON.parse(bytes.subarray(4,n+4).toString("utf8"));}catch{return;}
      handler(req,socket);
    });
  });
  await new Promise(resolve=>server.listen(path,resolve));
  return {path,close:async()=>{await new Promise(resolve=>server.close(resolve));await rm(dir,{recursive:true,force:true});}};
}
function envelope(req,data,outcome="changed",overrides={}) { return {request_id:req.request_id,payload:{api_version:"2",schema_version:"boreal.protocol.envelope.v1",operation_id:req.payload.operation_id,transport:"ok",outcome,data,error:null,...overrides}}; }

test("launch options expose all implemented color themes and reject unknown themes",()=>{
  assert.equal(parseArgs(["--socket","/tmp/global.sock","--interactive","--theme","light"]).theme,"light");
  assert.equal(parseArgs(["--socket","/tmp/global.sock","--theme","mono"]).theme,"mono");
  assert.throws(()=>parseArgs(["--socket","/tmp/global.sock","--theme","solarized"]),/dark, light, or mono/);
  assert.throws(()=>parseArgs(["--socket","/tmp/global.sock","--theme"]),/requires dark, light, or mono/);
});

test("client validates the outer framing and both versioned correlation envelopes",async t=>{
  const fixture=await socketFixture((req,socket)=>socket.end(encode(envelope(req,snapshot,"unchanged")))); t.after(fixture.close);
  const client=new GlobalServiceClient(fixture.path);
  assert.deepEqual(await client.snapshot(),snapshot);
});

test("client rejects mismatched versions and does not replay an unknown mutation",async t=>{
  const bad=await socketFixture((req,socket)=>socket.end(encode(envelope(req,snapshot,"unchanged",{schema_version:"wrong"})))); t.after(bad.close);
  await assert.rejects(new GlobalServiceClient(bad.path).snapshot(),/envelope schema mismatch/);
  let calls=0;
  const lost=await socketFixture((_req,socket)=>{calls++;socket.end();}); t.after(lost.close);
  const client=new GlobalServiceClient(lost.path,500);
  await assert.rejects(client.execute("todo complete",{item_id:"x"},true),error=>error instanceof GlobalProtocolError&&error.unknownOutcome&&error.readbackRequired);
  assert.equal(calls,1);
});

test("controller binds writes to snapshot revision and board/list render the same item records",async()=>{
  let current=structuredClone(snapshot); const writes=[];
  const fake={snapshot:async()=>structuredClone(current),execute:async(command,payload)=>{writes.push({command,payload});current={...current,revision:current.revision+1};return {revision:current.revision};}};
  const controller=new GlobalController(fake); await controller.refresh(); controller.projectId="life";
  controller.route="list"; const list=render(controller);
  controller.route="board"; const board=render(controller);
  assert.match(list,/Pick up groceries/); assert.match(board,/Pick up groceries/);
  controller.route="list"; await controller.mutate("todo complete",{item_id:"errand"});
  assert.equal(writes[0].payload.expected_revision,12); assert.equal(controller.snapshot.revision,13);
});

test("linked rollups stay paired with their own workspace under one management project",async()=>{
  const current=structuredClone(snapshot);
  current.projects.push({id:"business",name:"Business",description:"",archived:false,created_at:"now",updated_at:"now"});
  current.associations=[
    {project_id:"business",kind:"workspace",identity:"workspace-a",path:"/work/a",updated_at:"now"},
    {project_id:"business",kind:"workspace",identity:"workspace-b",path:"/work/b",updated_at:"now"},
  ];
  current.linked_projects=[
    {management_project_id:"business",project_id:"workspace-a",path:"/work/a",availability:"available",revision:2,as_of:"now",counts:{ready:2},error:null},
    {management_project_id:"business",project_id:"workspace-b",path:"/work/b",availability:"available",revision:9,as_of:"now",counts:{ready:9},error:null},
  ];
  const controller=new GlobalController({snapshot:async()=>structuredClone(current),execute:async()=>({})});
  await controller.refresh();controller.projectId="business";controller.route="board";
  let screen=render(controller,120,30);
  assert.match(screen,/workspace-a/);
  assert.match(screen,/ready:? 2/);
  assert.match(screen,/workspace-b/);
  assert.match(screen,/ready:? 9/);
  controller.route="links";screen=render(controller,120,30);
  controller.selected=0; controller.focus="inspector"; screen=render(controller,70,30);
  assert.match(screen,/workspace-a/); assert.match(screen,/ready:? 2/); assert.doesNotMatch(screen,/ready:? 9/);
  controller.selected=1; screen=render(controller,70,30);
  assert.match(screen,/workspace-b/); assert.match(screen,/ready:? 9/); assert.doesNotMatch(screen,/ready:? 2/);
});

test("snapshot validation, terminal escaping, clipping, and unknown writes fail closed",async()=>{
  assert.throws(()=>validateSnapshot({...snapshot,schema_version:99}),/schema or revision/);
  let current=structuredClone(snapshot); const fake={snapshot:async()=>current,execute:async()=>{throw new GlobalProtocolError("lost response",{unknownOutcome:true,operationId:"op_17",readbackRequired:true});}};
  const controller=new GlobalController(fake); await controller.refresh();
  current={...current,projects:[{...current.projects[0],name:"Life\u001b[31m"+"X".repeat(500)}]}; await controller.refresh();
  controller.route="projects";
  const screen=render(controller,40,12);
  assert.equal(screen.includes("\u001b"),false); assert.ok(screen.split("\n").every(line=>line.length<=40)); assert.ok(screen.split("\n").length<=12);
  await assert.rejects(controller.mutate("todo complete",{item_id:"errand"}),/lost response/);
  assert.equal(controller.unresolvedOperation,"op_17");
  await assert.rejects(controller.mutate("todo complete",{item_id:"errand"}),/unknown outcome/);
});

test("keyboard flow creates a project, custom status, task, completes and reopens it, then restores terminal",async t=>{
  const state={schema_version:2,revision:0,projects:[],items:[],notes:[],statuses:[],relationships:[],associations:[]};
  const commands=[];
  const fake={snapshot:async()=>structuredClone(state),execute:async(command,payload)=>{
    commands.push({command,payload});state.revision++;
    if(command==="project add") {state.projects.push({id:"business",name:payload.name,description:"",archived:false,created_at:"now",updated_at:"now"});for(const [status_id,label,category,position] of [["todo","To do","open",0],["doing","Doing","active",1],["done","Done","completed",2],["cancelled","Cancelled","cancelled",3]])state.statuses.push({project_id:"business",status_id,label,category,position});}
    if(command==="workflow status add")state.statuses.push({project_id:payload.project_id,status_id:payload.status_id,label:payload.label,category:payload.category,position:payload.position});
    if(command==="todo add"||command==="task add")state.items.push({id:"task_1",project_id:payload.project_id,parent_id:payload.parent_id??null,kind:"task",title:payload.title,description:"",status_id:"todo",priority:0,due_at:null,archived:false,position:0,created_at:"now",updated_at:"now"},{id:"task_2",project_id:payload.project_id,parent_id:null,kind:"task",title:"Review taxes",description:"",status_id:"todo",priority:0,due_at:null,archived:false,position:1,created_at:"now",updated_at:"now"});
    if(command==="todo complete")state.items[0].status_id="done";
    if(command==="todo reopen")state.items[0].status_id="todo";
    return {revision:state.revision};
  }};
  const controller=new GlobalController(fake);let listener;let raw=false;let output="";
  const terminal={isTty:true,write:value=>{output+=value;},onData:fn=>{listener=fn;return()=>{listener=undefined;}},setRawMode:value=>{raw=value;},dimensions:()=>({width:100,height:24})};
  const running=runInteractive(controller,terminal);
  t.after(()=>listener?.("\u0003"));
  const wait=async pred=>{for(let i=0;i<30&&!pred();i++)await new Promise(resolve=>setTimeout(resolve,2));assert.ok(pred(),"keyboard mutation completed");};
  const key=value=>listener?.(value);
  await wait(()=>!!listener);
  key("2");key("n");key("New business\u0013");await wait(()=>controller.snapshot?.projects.length===1);
  key("\r");key("7");key("s");key("review\tReview\t\u001b[C\u0013");await wait(()=>controller.snapshot?.statuses.some(s=>s.status_id==="review"));
  key("3");key("n");key("Prepare launch\r");await wait(()=>controller.snapshot?.items.length===2);
  key("/");key("launch\r");await wait(()=>controller.searchQuery==="launch");
  await new Promise(resolve=>setImmediate(resolve)); // Let the asynchronous form save close before sending the next key.
  assert.equal(controller.items.length,1);assert.match(render(controller),/Filter: launch/);assert.match(render(controller),/Prepare launch/);assert.doesNotMatch(render(controller),/Review taxes/);
  key("x");assert.equal(controller.items.length,2);assert.equal(controller.searchQuery,"");
  key("c");await wait(()=>controller.snapshot?.items[0]?.status_id==="done");
  key("o");await wait(()=>controller.snapshot?.items[0]?.status_id==="todo");
  key("q");await running;
  assert.deepEqual(commands.map(x=>x.command),["project add","workflow status add","todo add","todo complete","todo reopen"]);
  assert.equal(raw,false);assert.match(output,/\u001b\[\?1049l/);
});

test("unknown mutation is reconciled through operation show without replay",async()=>{
  let snapshots=0;const calls=[];
  const fake={snapshot:async()=>{snapshots++;return structuredClone(snapshot);},execute:async(command,payload)=>{calls.push({command,payload});if(command==="todo complete")throw new GlobalProtocolError("connection lost",{unknownOutcome:true,operationId:"op_unknown",readbackRequired:true});return {operation_id:payload.operation_id,revision:13,result:{id:"errand"},request_digest:"digest",created_at:"now"};}};
  const controller=new GlobalController(fake);await controller.refresh();
  await assert.rejects(controller.mutate("todo complete",{item_id:"errand"}),/connection lost/);
  assert.equal(calls.length,1);
  assert.match(await controller.resolveUnknownOperation(),/committed at revision 13/);
  assert.deepEqual(calls.map(c=>c.command),["todo complete","operation show"]);
  assert.equal(controller.unresolvedOperation,undefined);assert.equal(snapshots,2);
});
